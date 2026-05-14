/**
 * Berry-Claw Server — HTTP + WebSocket (thin shell over engine)
 */
import express from 'express';
import cors from 'cors';
import { WebSocketServer, WebSocket } from 'ws';
import { createServer } from 'node:http';
import { resolve, join } from 'node:path';
import { existsSync } from 'node:fs';
import { AgentManager } from './engine/agent-manager.js';
import { loadMCPLayer, loadMergedMCPConfig } from './engine/mcp-config.js';
import { CONFIG_SCHEMA_VERSION, type AgentEntry } from './engine/config-manager.js';
import { createObserveRouter, fetchOpenRouterPricing } from '@berry-agent/observe';
import type { AgentEvent } from '@berry-agent/core';
import { WEB_SEARCH_CREDENTIAL_META, type CredentialKeyMeta } from '@berry-agent/tools-common';
import { deriveAgentFact, deriveTeamFact, deriveSystemFact } from './facts/derive.js';
import { SYSTEM_FACT_ID } from '@berry-agent/claw-contracts';
import { FACT_KINDS, type FactChange } from '@berry-agent/claw-contracts';
import {
  SAFETY_LEVELS,
  asSafetyLevel,
  readProjectSafety,
  writeProjectSafety,
  type SafetyLevel,
} from './engine/safety.js';
import type { AskBridge, AskQuestion, AskAnswer } from '@berry-agent/safe';
import { randomUUID } from 'node:crypto';
import { createKeyStore, generateIdentity, hasIdentity, loadIdentity } from './auth/keystore.js';
import { AuthStore } from './auth/challenge.js';
import { assertWsAuth, requireAuth } from './auth/middleware.js';
import { zAuthChallengeRequest, zAuthVerifyRequest } from '@berry-agent/claw-contracts';
import type { ChatTimelineEvent } from '@berry-agent/claw-contracts';
import { ensurePromptPackDirectory, listPromptPacks } from '@berry-agent/prompt-pack';

/**
 * Mask API keys for display: show a short prefix + a run of bullets + last 3
 * characters. Anything <= 8 chars is fully bulleted to avoid leaking keys.
 * Example: sk-proj-abc...xyz → "sk-pro••••••••xyz"
 */
function maskKey(key: string): string {
  if (!key) return '';
  if (key.length <= 8) return '•'.repeat(key.length);
  return key.slice(0, 6) + '•'.repeat(8) + key.slice(-3);
}

function makeTimelineEvent(
  kind: ChatTimelineEvent['kind'],
  title: string,
  detail?: string,
  tone?: ChatTimelineEvent['tone'],
): ChatTimelineEvent {
  return {
    id: randomUUID(),
    kind,
    title,
    detail,
    timestamp: Date.now(),
    tone,
    collapsed: true,
  };
}

function timelineForAgentEvent(event: AgentEvent): ChatTimelineEvent | null {
  switch (event.type) {
    case 'query_start':
      return makeTimelineEvent('query', '用户提示已提交');
    case 'api_call':
      return makeTimelineEvent('api_call', '调用模型', `${event.messages} messages · ${event.tools} tools`, 'info');
    case 'api_response':
      return makeTimelineEvent('api_response', `模型响应完成：${event.model}`, `${event.usage.inputTokens}↓ ${event.usage.outputTokens}↑ · ${event.stopReason}`, 'good');
    case 'compaction':
      return makeTimelineEvent('compaction', '上下文已压缩', `释放 ${event.tokensFreed.toLocaleString()} tokens`, 'warn');
    case 'memory_flush':
      return makeTimelineEvent('memory', '记忆已写入', `${event.reason} · ${event.charsSaved} chars`, 'good');
    case 'guard_decision':
      return makeTimelineEvent('guard', `安全策略：${event.decision.action}`, event.toolName, event.decision.action === 'deny' ? 'bad' : 'info');
    case 'delegate_start':
      return makeTimelineEvent('delegate', '委派任务开始', event.message, 'info');
    case 'delegate_end':
      return makeTimelineEvent('delegate', '委派任务完成', undefined, 'good');
    case 'crash_recovered':
      return makeTimelineEvent('system', '已恢复崩溃会话', `${event.artifactCount} artifacts`, 'warn');
    case 'status_change':
      return event.detail ? makeTimelineEvent('status', `状态：${event.status}`, event.detail) : null;
    default:
      return null;
  }
}

function contextTokensForApiResponse(event: Extract<AgentEvent, { type: 'api_response' }>): number {
  const read = event.usage.cacheReadTokens ?? 0;
  const write = event.usage.cacheWriteTokens ?? 0;
  const model = event.model.toLowerCase();
  if (model.includes('claude') || model.includes('anthropic')) {
    return event.usage.inputTokens + read + write;
  }
  return event.usage.inputTokens;
}

export interface StartServerOptions {
  appDir?: string;
}

const AGENT_PATCH_FIELDS = [
  'name',
  'model',
  'workspace',
  'project',
  'tools',
  'disabledTools',
  'skillDirs',
  'disabledSkills',
  'enabledSkills',
  'reasoningEffort',
  'promptPack',
  'safetyLevel',
  'team',
] as const;

type AgentPatchField = typeof AGENT_PATCH_FIELDS[number];

function pickAgentPatch(body: unknown): Partial<AgentEntry> {
  if (!body || typeof body !== 'object') return {};
  const source = body as Record<AgentPatchField, unknown>;
  const patch: Partial<AgentEntry> = {};
  for (const field of AGENT_PATCH_FIELDS) {
    if (source[field] !== undefined) {
      (patch as Record<AgentPatchField, unknown>)[field] = source[field];
    }
  }
  return patch;
}

export async function startServer(port: number, options: StartServerOptions = {}) {
  const manager = new AgentManager({ appDir: options.appDir });
  ensurePromptPackDirectory(manager.config.promptPacksDir());
  const keyStore = createKeyStore(manager.config.appDir);
  if (!hasIdentity(keyStore)) {
    generateIdentity(keyStore);
  }
  const authStore = new AuthStore(keyStore, manager.config.get().auth);
  const authOptions = {
    allowAnonymous: manager.config.get().auth.allowAnonymous,
    auth: authStore,
  };
  if (authOptions.allowAnonymous) {
    console.warn('⚠ AUTH DISABLED: config.auth.allowAnonymous=true');
  }

  // Pre-fetch OpenRouter pricing so that cost calculations work for models
  // not in the built-in pricing table (e.g. deepseek, moonshot, etc.).
  // This is best-effort: if the fetch fails we still boot the server.
  try {
    const openRouterPricing = await fetchOpenRouterPricing();
    const count = Object.keys(openRouterPricing).length;
    if (count > 0) {
      Object.assign(manager.pricingOverrides, openRouterPricing);
      console.log(`[pricing] Loaded ${count} models from OpenRouter`);
    }
  } catch {
    // ignore — built-in pricing still works
  }

  // Start shared MCP servers from the global .mcp.json layer.
  // Entries with shared=false are skipped inside MCPManager — they're
  // started per-agent in agent-manager's startAgentMCP().
  try {
    const globalLayer = loadMCPLayer(manager.config.globalMCPPath(), 'global');
    await manager.mcpManager.startSharedServers(globalLayer);
    const status = manager.mcpManager.getStatus();
    if (status.shared.length > 0) {
      console.log(`[MCP] Started ${status.shared.length} shared servers: ${status.shared.map(s => s.name).join(', ')}`);
    }
    // Seed the initial SystemFact so WS subscribers that join after startup
    // — and the /api/facts snapshot — see the shared-MCP state right away.
    manager.emitSystemFact();
  } catch (err) {
    console.error('[MCP] Shared server startup failed:', err instanceof Error ? err.message : err);
  }

  const app = express();
  app.use(cors());
  app.use(express.json());

  app.post('/api/auth/challenge', (req, res) => {
    try {
      zAuthChallengeRequest.parse(req.body ?? {});
      res.json(authStore.issueChallenge());
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  app.post('/api/auth/verify', (req, res) => {
    try {
      const body = zAuthVerifyRequest.parse(req.body ?? {});
      const token = authStore.verify(body.nonce, body.signature);
      res.json({ sessionToken: token.token, expiresAt: token.expiresAt });
    } catch (err: any) {
      res.status(401).json({ error: err.message });
    }
  });

  app.get('/api/auth/instance', (_req, res) => {
    res.json(loadIdentity(keyStore));
  });

  app.use('/api', requireAuth(authOptions));

  // ============================
  // Config API — v2 schema (3-layer: providers → models → tiers)
  // ============================

  /** Get full config (apiKeys masked for safety) */
  app.get('/api/config', (_req, res) => {
    const config = manager.config.get();
    const maskedProviders = Object.fromEntries(
      Object.entries(config.providerInstances).map(([k, v]) => [
        k,
        { ...v, apiKey: maskKey(v.apiKey) },
      ]),
    );
    res.json({
      schemaVersion: CONFIG_SCHEMA_VERSION,
      providerInstances: maskedProviders,
      models: config.models,
      tiers: config.tiers,
      agents: config.agents,
      defaultAgent: config.defaultAgent,
    });
  });

  /** Configuration status */
  app.get('/api/config/status', (_req, res) => {
    res.json({
      configured: manager.config.isConfigured,
      firstModel: manager.config.firstConfiguredModelId(),
      tiers: manager.config.getTiers(),
    });
  });

  // --- Layer 1: Provider Instances ---

  app.get('/api/config/provider-instances', (_req, res) => {
    const items = manager.config.listProviderInstances().map(({ id, entry }) => ({
      id,
      entry: { ...entry, apiKey: maskKey(entry.apiKey) },
    }));
    res.json({ providerInstances: items });
  });

  app.put('/api/config/provider-instances/:id', (req, res) => {
    const { presetId, apiKey, baseUrl, type, knownModels, label } = req.body ?? {};
    if (!presetId) return res.status(400).json({ error: 'presetId required' });
    const existing = manager.config.getProviderInstance(req.params.id);
    const resolvedKey = apiKey || existing?.apiKey;
    if (!resolvedKey) {
      return res.status(400).json({ error: 'apiKey required for new provider instances' });
    }
    manager.config.setProviderInstance(req.params.id, {
      id: req.params.id,
      presetId,
      apiKey: resolvedKey,
      baseUrl,
      type,
      knownModels,
      label,
    });
    res.json({ ok: true });
  });

  app.delete('/api/config/provider-instances/:id', (req, res) => {
    manager.config.removeProviderInstance(req.params.id);
    res.json({ ok: true });
  });

  /** Fetch live models for a configured provider instance. */
  app.get('/api/config/provider-instances/:id/models', async (req, res) => {
    const entry = manager.config.getProviderInstance(req.params.id);
    if (!entry) return res.status(404).json({ error: 'Provider instance not found' });
    const { listModels } = await import('@berry-agent/models');
    try {
      const result = await listModels(entry);
      res.json(result);
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  /** Built-in provider presets (static catalog). */
  app.get('/api/config/presets', async (_req, res) => {
    const { listBuiltinPresets } = await import('@berry-agent/models');
    res.json({ presets: listBuiltinPresets() });
  });

  // --- Layer 2: Models ---

  app.get('/api/config/models', (_req, res) => {
    res.json({ models: manager.config.listModels() });
  });

  app.put('/api/config/models/:id', (req, res) => {
    const { providers, label } = req.body ?? {};
    if (!Array.isArray(providers) || providers.length === 0) {
      return res.status(400).json({ error: 'providers[] with at least one entry required' });
    }
    manager.config.setModel(req.params.id, {
      id: req.params.id,
      label,
      providers,
    });
    // Hot reload so agents pointing at this model pick up the new binding.
    try { manager.initAgent(); } catch { /* non-fatal */ }
    res.json({ ok: true });
  });

  app.delete('/api/config/models/:id', (req, res) => {
    manager.config.removeModel(req.params.id);
    res.json({ ok: true });
  });

  // --- Layer 3: Tiers ---

  app.get('/api/config/tiers', (_req, res) => {
    res.json({ tiers: manager.config.getTiers() });
  });

  app.put('/api/config/tiers/:tier', (req, res) => {
    const tier = req.params.tier;
    if (tier !== 'strong' && tier !== 'balanced' && tier !== 'fast') {
      return res.status(400).json({ error: `Unknown tier "${tier}"` });
    }
    const { modelId } = req.body ?? {};
    manager.config.setTier(tier, typeof modelId === 'string' ? modelId : null);
    res.json({ ok: true });
  });

  // Legacy workspace endpoint removed — each agent has its own workspace

  // ============================
  // Credentials API
  // ============================
  // Single source of truth: SDK tool-common registries. Merge all categories
  // here so the product doesn't keep a parallel list.
  const KNOWN_CREDENTIAL_KEYS: readonly CredentialKeyMeta[] = [
    ...WEB_SEARCH_CREDENTIAL_META,
    // Add other categories here as the SDK grows (e.g. browser auth tokens).
  ];

  /** List known credential keys + whether each is configured */
  app.get('/api/credentials', (_req, res) => {
    const store = manager.credentials;
    const items = KNOWN_CREDENTIAL_KEYS.map(entry => ({
      ...entry,
      configured: store.has?.(entry.key) ?? false,
      source: store.source?.(entry.key) ?? null,
    }));
    res.json({ credentials: items });
  });

  /** Set or update a credential (writes to backing file, 600 perms) */
  app.put('/api/credentials/:key', async (req, res) => {
    const { key } = req.params;
    const { value } = req.body ?? {};
    if (!KNOWN_CREDENTIAL_KEYS.some(e => e.key === key)) {
      return res.status(400).json({ error: `Unknown credential key: ${key}` });
    }
    if (typeof value !== 'string' || !value.trim()) {
      return res.status(400).json({ error: 'value must be a non-empty string' });
    }
    const store = manager.credentials as { set?: (k: string, v: string) => Promise<void> };
    if (!store.set) return res.status(500).json({ error: 'Credential store not writable' });
    try {
      await store.set(key, value.trim());
      res.json({ ok: true, key, source: manager.credentials.source?.(key) ?? null });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  /** Delete a credential (file-backed only; env vars are not touched) */
  app.delete('/api/credentials/:key', async (req, res) => {
    const { key } = req.params;
    const store = manager.credentials as { delete?: (k: string) => Promise<void> };
    if (!store.delete) return res.status(500).json({ error: 'Credential store not writable' });
    try {
      await store.delete(key);
      res.json({ ok: true, key });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  /**
   * Flat model list used by the chat-area model switcher and the AgentsPage
   * model dropdown — view-only projection of Layer-2 bindings.
   */
  app.get('/api/models', (_req, res) => {
    const bindings = manager.config.listModels();
    res.json({
      models: bindings.map(({ id, entry }) => ({
        model: id,
        providerName: entry.providers[0]?.providerId ?? '',
        type: 'model',
      })),
      current: manager.currentModel(),
    });
  });

  app.get('/api/prompt-packs', (_req, res) => {
    res.json({ promptPacks: listPromptPacks(manager.config.promptPacksDir()) });
  });

  /** Switch model at runtime (accepts tier:X / model:X / raw:... / bare id). */
  app.post('/api/models/switch', (req, res) => {
    const { model } = req.body;
    if (!model) return res.status(400).json({ error: 'model required' });
    try {
      manager.switchModel(model);
      res.json({ ok: true, current: manager.currentModel() });
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  // ============================
  // Agent API
  // ============================

  /** List agents */
  app.get('/api/agents', (_req, res) => {
    const agents = manager.config.listAgents();
    res.json({ agents, activeAgent: manager.activeAgent });
  });

  /**
   * Runtime status snapshot for every initialized agent instance. Uninstantiated
   * agents are reported as 'idle' so the UI can still render a pill.
   */
  /**
   * Snapshot endpoint for FactBus consumers. UIs call this once on mount
   * to seed their cache, then patch incrementally from the fact_changed
   * WS channel. `kind` may be 'agent' | 'team' | 'session' | 'all'.
   */
  /**
   * Ensure project-bound leader agents are initialized and any persisted
   * `.berry/team.json` is rehydrated into live Team instances. Without
   * this, /api/teams could show a team from disk while /api/facts?kind=team
   * returned nothing on a fresh boot, because FactStore only saw live teams.
   */
  async function ensureTeamsLoaded(): Promise<void> {
    for (const { id, entry } of manager.config.listAgents()) {
      if (entry.project && !manager.isAgentLive(id)) {
        try { manager.getAgent(id); } catch { /* ignore per-agent init failures */ }
      }
    }
    await Promise.all(
      manager.config.listAgents().map(({ id }) => manager.waitForTeamRehydrate(id)),
    );
  }

  app.get('/api/facts', async (req, res) => {
    const kindParam = (req.query.kind as string) || 'all';
    const kinds = kindParam === 'all' ? FACT_KINDS : [kindParam];
    const changes: FactChange[] = [];

    if (kinds.includes('agent')) {
      for (const { id } of manager.config.listAgents()) {
        const fact = deriveAgentFact(manager, id);
        if (fact) changes.push({ kind: 'agent', id, fact });
      }
    }
    if (kinds.includes('team')) {
      await ensureTeamsLoaded();
      for (const { id } of manager.config.listAgents()) {
        const team = manager.getTeam(id);
        if (!team) continue;
        const fact = await deriveTeamFact(team);
        changes.push({ kind: 'team', id, fact });
      }
    }
    if (kinds.includes('system')) {
      // Singleton — always exactly one entry keyed by SYSTEM_FACT_ID.
      changes.push({ kind: 'system', id: SYSTEM_FACT_ID, fact: deriveSystemFact(manager) });
    }
    // session facts: not yet wired into FactBus; Phase 2 intentionally
    // stops at agent + team + system. Session dimension added later once we
    // define how session lifecycle events integrate with the bus.

    res.json({ changes });
  });

  app.get('/api/agents/statuses', (_req, res) => {
    const out: Record<string, { status: string; detail?: string }> = {};
    for (const { id } of manager.config.listAgents()) {
      const snap = manager.getAgentStatus(id);
      out[id] = snap ?? { status: 'idle' };
    }
    res.json({ statuses: out });
  });

  // MCP status now flows through the fact channel: GET /api/facts?kind=system
  // for the snapshot, and the WS `fact_changed` channel for live updates.
  // The old /api/mcp/status endpoint has been removed.

  /** Current context token size for the active session of an agent */
  app.get('/api/agents/:id/context-size', async (req, res) => {
    try {
      const sessionId = typeof req.query.sessionId === 'string' ? req.query.sessionId : undefined;
      const size = await manager.getAgentContextSize(req.params.id, sessionId);
      if (!size) return res.status(404).json({ error: 'Agent not found or not initialized' });
      res.json(size);
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  /** Create/update agent */
  app.put('/api/agents/:id', (req, res) => {
    const { name, model, workspace, project, tools, disabledTools, skillDirs, disabledSkills, enabledSkills, reasoningEffort, promptPack, safetyLevel } = req.body;
    if (!name || !model) return res.status(400).json({ error: 'name and model required' });
    // Validate safetyLevel if provided; reject unknown values rather than
    // silently dropping them so config UIs surface the typo.
    if (safetyLevel !== undefined && asSafetyLevel(safetyLevel) === null) {
      return res.status(400).json({ error: `safetyLevel must be one of: ${SAFETY_LEVELS.join(', ')}` });
    }
    manager.config.setAgent(req.params.id, {
      name, model, workspace, project, tools, disabledTools, skillDirs, disabledSkills,
      enabledSkills, reasoningEffort, promptPack, safetyLevel,
    });
    // Hot reload emits an AgentFact via the FactBus — all connected tabs
    // refresh off that single event.
    manager.reloadAgent(req.params.id);
    res.json({ ok: true });
  });

  /** Patch agent (partial update — useful for toggle tool/skill) */
  app.patch('/api/agents/:id', (req, res) => {
    const current = manager.config.getAgent(req.params.id);
    if (!current) return res.status(404).json({ error: 'Agent not found' });
    const patch = pickAgentPatch(req.body);
    const merged = { ...current, ...patch };
    manager.config.setAgent(req.params.id, merged);
    manager.reloadAgent(req.params.id);
    res.json({ ok: true, entry: merged });
  });

  /** Delete agent */
  app.delete('/api/agents/:id', (req, res) => {
    manager.config.removeAgent(req.params.id);
    manager.factBus.emitAgent(req.params.id, null);
    res.json({ ok: true });
  });

  /** Switch active agent */
  app.post('/api/agents/:id/activate', (req, res) => {
    try {
      manager.switchAgent(req.params.id);
      res.json({ ok: true, activeAgent: req.params.id });
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  // ----------------------------
  // Safety API — three-tier mode (trust / default / auto)
  // ----------------------------
  // The effective level for an agent is resolved from
  //   agent.safetyLevel  > <projectRoot>/.berry/safety.json > appConfig.safetyLevel
  // by src/engine/safety.ts. Endpoints below just edit one layer each and
  // trigger `reloadAgent` so the new guard takes effect without a restart.
  //
  // Per-agent setting already flows through PATCH /api/agents/:id (any field
  // on AgentEntry, including safetyLevel, is merged + persisted + reloaded).
  // These extra endpoints cover the other two layers plus a unified GET.

  /** Snapshot all three layers — handy for the Agents-tab dropdown UI. */
  app.get('/api/safety', (_req, res) => {
    const config = manager.config.get();
    const agents = manager.config.listAgents().map(({ id, entry }) => {
      const projectLevel = entry.project ? (readProjectSafety(entry.project)?.level ?? null) : null;
      return {
        id,
        agentLevel: entry.safetyLevel ?? null,
        projectLevel,
        projectRoot: entry.project ?? null,
        effective: manager.resolveSafetyFor(id),
      };
    });
    res.json({
      levels: SAFETY_LEVELS,
      globalLevel: config.safetyLevel ?? null,
      agents,
    });
  });

  /** Set (or clear) the app-wide safety level. */
  app.patch('/api/safety/global', (req, res) => {
    const level = req.body?.level;
    if (level !== null && asSafetyLevel(level) === null) {
      return res.status(400).json({ error: `level must be null or one of: ${SAFETY_LEVELS.join(', ')}` });
    }
    manager.config.update({ safetyLevel: level ?? undefined });
    // Reload every live agent so each picks up the new effective level.
    for (const { id } of manager.config.listAgents()) {
      try { manager.reloadAgent(id); } catch { /* not running → fine */ }
    }
    res.json({ ok: true, globalLevel: level ?? null });
  });

  /** Set (or clear) the project-level safety file. */
  app.patch('/api/safety/project', (req, res) => {
    const { projectRoot, level } = req.body ?? {};
    if (typeof projectRoot !== 'string' || !projectRoot) {
      return res.status(400).json({ error: 'projectRoot (string) required' });
    }
    if (level !== null && asSafetyLevel(level) === null) {
      return res.status(400).json({ error: `level must be null or one of: ${SAFETY_LEVELS.join(', ')}` });
    }
    try {
      writeProjectSafety(projectRoot, (level as SafetyLevel | null) ?? null);
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
    // Reload every agent whose project matches — they're the only ones
    // whose effective level could have changed.
    for (const { id, entry } of manager.config.listAgents()) {
      if (entry.project === projectRoot) {
        try { manager.reloadAgent(id); } catch { /* not running → fine */ }
      }
    }
    res.json({ ok: true, projectRoot, level: level ?? null });
  });

  // ----------------------------
  // HITL approval bridge (safety mode: auto)
  // ----------------------------
  // Live map of questions the agent is waiting on. Each key is a UUID
  // generated per askBridge() call; the value holds the resolver so the
  // POST /api/safety/ask/:id endpoint can wake the agent up.
  // The bridge broadcasts the question over WS (as a `safety_ask` event),
  // the UI renders a dialog, the user answers via POST, the Promise resolves.
  // Timeouts are handled inside askList itself — if the human never answers,
  // the agent sees a "timed out" deny from safe, and we GC the pending entry
  // here via the finalize() callback.
  interface PendingAsk {
    question: AskQuestion;
    createdAt: number;
    resolve: (answer: AskAnswer) => void;
  }
  const pendingAsks = new Map<string, PendingAsk>();

  const askBridge: AskBridge = (question) => {
    return new Promise<AskAnswer>((resolve) => {
      const id = randomUUID();
      pendingAsks.set(id, { question, createdAt: Date.now(), resolve });
      broadcast('safety_ask', { id, question });
    });
  };
  manager.setAskBridge(askBridge);

  /** Human answers a pending question. */
  app.post('/api/safety/ask/:id', (req, res) => {
    const entry = pendingAsks.get(req.params.id);
    if (!entry) return res.status(404).json({ error: 'unknown or already-resolved question id' });
    const approved = req.body?.approved === true;
    const note = typeof req.body?.note === 'string' ? req.body.note : undefined;
    pendingAsks.delete(req.params.id);
    entry.resolve({ approved, note });
    // Echo the resolution to all clients so multiple tabs stop showing the
    // dialog — the first responder wins; others see it close.
    broadcast('safety_ask_resolved', { id: req.params.id, approved, note });
    res.json({ ok: true });
  });

  /** Inspect outstanding approval questions (diagnostic / reconnect). */
  app.get('/api/safety/ask', (_req, res) => {
    const items = [...pendingAsks.entries()].map(([id, p]) => ({
      id,
      question: p.question,
      createdAt: p.createdAt,
    }));
    res.json({ pending: items });
  });

  // ----------------------------
  // Skill Market API
  // ----------------------------
  // Source listing + browse + install/uninstall. Writes flow through
  // SkillMarketService (globalSkillsDir) and emit SystemFact on change
  // so connected UIs refresh both the Skill Market tab and per-agent
  // SkillsPanel off the same event.

  /** List available sources (id, displayName, available flag). */
  app.get('/api/skills/sources', async (_req, res) => {
    try {
      const sources = await manager.skillMarket.listSources();
      res.json({ sources });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  /** Browse / search one source. */
  app.get('/api/skills/available', async (req, res) => {
    const source = String(req.query.source ?? '');
    const q = req.query.q ? String(req.query.q) : undefined;
    if (source !== 'clawhub') {
      return res.status(400).json({ error: 'source must be "clawhub"' });
    }
    try {
      const items = await manager.skillMarket.list(source, q);
      res.json({ items });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  /** Snapshot of globally-installed skills. */
  app.get('/api/skills/installed', async (_req, res) => {
    try {
      const installed = await manager.skillMarket.listInstalled();
      res.json({ installed });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  /** Install a skill from a source into the global pool. */
  app.post('/api/skills/install', async (req, res) => {
    const { sourceId, slug } = req.body ?? {};
    if (sourceId !== 'clawhub' || typeof slug !== 'string' || !slug) {
      return res.status(400).json({ error: 'sourceId ("clawhub") and slug required' });
    }
    try {
      const installed = await manager.skillMarket.install(sourceId, slug);
      // Broadcast new SystemFact so Skill Market / Agents SkillsPanel refresh.
      manager.emitSystemFact();
      res.json({ ok: true, installed });
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  /** Uninstall a globally-installed skill by name. */
  app.delete('/api/skills/:name', async (req, res) => {
    try {
      await manager.skillMarket.uninstall(req.params.name);
      manager.emitSystemFact();
      // Each agent's disabledSkills is computed at init time from the
      // global pool — after uninstall that blacklist may shrink. Re-derive
      // AgentFacts so connected UIs see the updated enabledSkills surface.
      for (const { id } of manager.config.listAgents()) {
        manager.emitAgentFact(id);
      }
      res.json({ ok: true });
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  // ----------------------------
  // MCP Enable/Disable API
  // ----------------------------
  // Single-server granularity toggle for both shared (global) and per-agent
  // MCP servers. The cascade is re-read on every enable so a user who edits
  // `.mcp.json` and then flips the toggle picks up the change without a full
  // server bounce. Emits SystemFact via onChange; for per-agent servers we
  // additionally re-derive that agent's fact so the Agents tab refreshes.
  //
  //   enable  → equivalent to restart: reconnect with fresh config.
  //   disable → disconnect the client and mark the entry `disabled`
  //             (runtime-only; .mcp.json remains the persistent source of truth).

  /** Enable or disable a single shared (global-layer) MCP server by name. */
  app.post('/api/mcp/shared/:name/enabled', async (req, res) => {
    const name = req.params.name;
    const enabled = Boolean(req.body?.enabled);
    try {
      const globalLayer = loadMCPLayer(manager.config.globalMCPPath(), 'global');
      const config = globalLayer[name];
      if (!config || !config.shared) {
        return res.status(404).json({ error: `shared MCP server "${name}" not found in global .mcp.json` });
      }
      const status = enabled
        ? await manager.mcpManager.restartShared(name, config)
        : await manager.mcpManager.disableShared(name, config);
      res.json({ ok: true, status });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  /** Enable or disable a single per-agent MCP server. */
  app.post('/api/mcp/agent/:agentId/:name/enabled', async (req, res) => {
    const { agentId, name } = req.params;
    const enabled = Boolean(req.body?.enabled);
    const entry = manager.config.getAgent(agentId);
    if (!entry) {
      return res.status(404).json({ error: `agent "${agentId}" not found` });
    }
    const workspace = manager.config.agentWorkspace(agentId);
    try {
      // Re-merge the 3-layer cascade so edits to any layer are picked up.
      const merged = loadMergedMCPConfig({
        globalPath: manager.config.globalMCPPath(),
        projectPath: entry.project ? manager.config.projectMCPPath(entry.project) : undefined,
        agentPath: manager.config.agentMCPPath(workspace),
      });
      const config = merged[name];
      if (!config || config.shared) {
        return res.status(404).json({ error: `per-agent MCP server "${name}" not found for agent "${agentId}"` });
      }
      const status = enabled
        ? await manager.mcpManager.restartAgent(agentId, name, config)
        : await manager.mcpManager.disableAgent(agentId, name, config);
      // Keep AgentFact.mcp in sync without waiting for the next generic tick.
      manager.emitAgentFact(agentId);
      res.json({ ok: true, status });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // ----------------------------
  // Team API (leader-scoped)
  // ----------------------------
  // A team is always keyed by its leader agent id. An agent can lead at
  // most one team at a time (tracked inside AgentManager.teams).

  /**
   * Global list of all currently-loaded teams. Each entry gives enough for
   * a TeamsPage card: leader id/name, project, teammate count, team name.
   * Teams that have been created on disk but not yet rehydrated (their
   * leader agent hasn't been initialized this process) won't show here —
   * we only list teams whose leader is live in AgentManager.
   */
  app.get('/api/teams', async (_req, res) => {
    await ensureTeamsLoaded();

    const teams: Array<{ leaderId: string; leaderName: string; state: any }> = [];
    for (const { id, entry } of manager.config.listAgents()) {
      const team = manager.getTeam(id);
      if (team) {
        teams.push({ leaderId: id, leaderName: entry.name, state: team.state });
      }
    }
    res.json({ teams });
  });

  /** Start (or fetch) the team led by this agent. Requires agent.project. */
  app.post('/api/agents/:id/team/start', async (req, res) => {
    try {
      const state = await manager.startTeam(req.params.id, req.body?.name);
      res.json({ ok: true, team: state });
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  /**
   * Helper: ensure the leader agent is initialized + its team (if any) is
   * rehydrated from disk. Returns the team, or null if the agent has no
   * project / no team.json. Centralizes the cold-boot lazy-init dance so
   * every team-read endpoint doesn't have to repeat it.
   */
  async function resolveTeam(agentId: string) {
    const entry = manager.config.getAgent(agentId);
    if (!entry?.project) return null;
    if (!manager.isAgentLive(agentId)) {
      try { manager.getAgent(agentId); } catch { return null; }
    }
    await manager.waitForTeamRehydrate(agentId);
    return manager.getTeam(agentId) ?? null;
  }

  /** Current team snapshot (null if none). */
  app.get('/api/agents/:id/team', async (req, res) => {
    const team = await resolveTeam(req.params.id);
    res.json({ team: team?.state ?? null });
  });

  /** Team message log (append-only JSONL read back). */
  app.get('/api/agents/:id/team/messages', async (req, res) => {
    const team = await resolveTeam(req.params.id);
    if (!team) return res.status(404).json({ error: 'No team for this agent' });
    const messages = await team.readMessages();
    res.json({ messages });
  });

  /** Disband the team (delete team.json + disband all teammates). */
  app.delete('/api/agents/:id/team', async (req, res) => {
    try {
      // resolveTeam handles cold-boot lazy init — without it, a fresh
      // server that hasn't yet touched the leader agent would 400 here.
      const team = await resolveTeam(req.params.id);
      if (!team) return res.status(400).json({ error: 'No team for this agent' });
      await manager.disbandTeam(req.params.id);
      res.json({ ok: true });
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  /** Worklist snapshot (read-only; mutations go through the agent's `worklist` tool). */
  app.get('/api/agents/:id/team/worklist', async (req, res) => {
    const team = await resolveTeam(req.params.id);
    if (!team) return res.status(404).json({ error: 'No team for this agent' });
    const tasks = await team.worklist.list();
    res.json({ tasks });
  });

  /** Inspect agent (system prompt, tools, skills, provider) */
  app.get('/api/agents/:id/inspect', async (req, res) => {
    try {
      const info = manager.inspectAgent(req.params.id);
      const promptBlocks = await manager.describePromptBlocks(req.params.id);
      const runtime = info.runtime
        ? {
            ...info.runtime,
            promptBlocks,
          }
        : { promptBlocks };
      res.json({ ...info, runtime });
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  /** Edit a prompt block at its source (workspace AGENTS.md / project AGENTS.md). */
  app.put('/api/agents/:id/prompt-blocks/:blockId', async (req, res) => {
    const entry = manager.config.getAgent(req.params.id);
    if (!entry) return res.status(404).json({ error: 'Agent not found' });
    const content = typeof req.body?.content === 'string' ? req.body.content : '';

    try {
      switch (req.params.blockId) {
        case 'workspace_agent_md': {
          const { writeFile } = await import('node:fs/promises');
          const workspace = entry.workspace ?? manager.config.agentWorkspace(req.params.id);
          const home = manager.config.agentHomeFor(workspace);
          await writeFile(home.agentMdPath, content, 'utf-8');
          manager.reloadAgent(req.params.id);
          break;
        }
        case 'project_context': {
          if (!entry.project) {
            return res.status(400).json({ error: 'Agent has no project, cannot edit project context' });
          }
          const { writeFile } = await import('node:fs/promises');
          await writeFile(join(entry.project, 'AGENTS.md'), content, 'utf-8');
          // project_context is a query-time block — SDK re-reads on every query,
          // so no reload needed. But we still re-emit so the UI refreshes.
          break;
        }
        default:
          return res.status(400).json({ error: `Prompt block "${req.params.blockId}" is read-only or unknown` });
      }

      const promptBlocks = await manager.describePromptBlocks(req.params.id);
      res.json({ ok: true, promptBlocks });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // ============================
  // Memory API — per-agent MEMORY.md + per-project AGENTS.md
  // ============================

  /** Read agent's personal MEMORY.md (empty string if file doesn't exist yet). */
  app.get('/api/agents/:id/memory', async (req, res) => {
    const entry = manager.config.getAgent(req.params.id);
    if (!entry) return res.status(404).json({ error: 'agent not found' });
    const { join } = await import('node:path');
    const { readFile } = await import('node:fs/promises');
    const workspace = manager.config.agentWorkspace(req.params.id);
    const memPath = join(workspace, 'MEMORY.md');
    try {
      const content = await readFile(memPath, 'utf-8');
      res.json({ path: memPath, content });
    } catch {
      res.json({ path: memPath, content: '' });
    }
  });

  /** Overwrite agent's MEMORY.md. Mainly for letting the user curate it. */
  app.put('/api/agents/:id/memory', async (req, res) => {
    const entry = manager.config.getAgent(req.params.id);
    if (!entry) return res.status(404).json({ error: 'agent not found' });
    const content = typeof req.body?.content === 'string' ? req.body.content : '';
    const { join } = await import('node:path');
    const { writeFile } = await import('node:fs/promises');
    const workspace = manager.config.agentWorkspace(req.params.id);
    await writeFile(join(workspace, 'MEMORY.md'), content, 'utf-8');
    res.json({ ok: true, bytes: content.length });
  });

  /**
   * Read the shared project knowledge for an agent's project binding.
   * Project AGENTS.md is the only shared project knowledge source.
   */
  app.get('/api/agents/:id/project/knowledge', async (req, res) => {
    const entry = manager.config.getAgent(req.params.id);
    if (!entry) return res.status(404).json({ error: 'agent not found' });
    if (!entry.project) return res.json({ project: null, files: [] });
    const { join } = await import('node:path');
    const { readFile } = await import('node:fs/promises');
    const files: Array<{ path: string; content: string }> = [];
    const name = 'AGENTS.md';
    try {
      const content = await readFile(join(entry.project, name), 'utf-8');
      if (content.trim().length > 0) files.push({ path: name, content });
    } catch { /* missing file is fine */ }
    res.json({ project: entry.project, files });
  });

  // ============================
  // Session API
  // ============================

  /** List sessions for an agent (or active agent if no agentId param). */
  app.get('/api/sessions', async (req, res) => {
    const agentId = req.query.agentId as string | undefined;
    const states = await manager.listSessionStates(agentId);
    res.json({ sessions: states });
  });

  /** Current SDK todo scratchpad for a session. */
  app.get('/api/sessions/:id/todos', async (req, res) => {
    const agentId = req.query.agentId as string | undefined;
    const todos = await manager.getSessionTodos(req.params.id, agentId);
    res.json({ todos });
  });

  /** Get session detail + messages */
  app.get('/api/sessions/:id', async (req, res) => {
    const state = await manager.loadSessionState(req.params.id);
    const observeSummary = manager.observer.analyzer.sessionSummary(req.params.id);
    res.json({ id: req.params.id, messages: state?.messages ?? [], observe: observeSummary });
  });

  /** Delete session */
  app.delete('/api/sessions/:id', (req, res) => {
    manager.sessions.deleteSession(req.params.id);
    res.json({ ok: true });
  });

  // ============================
  // Observe API (from @berry-agent/observe)
  // ============================

  app.use('/api/observe', createObserveRouter(manager.observer));

  // ============================
  // System API
  // ============================

  app.get('/api/system/status', (_req, res) => {
    const agents = manager.config.listAgents();
    const agentStatuses: Record<string, { status: string; detail?: string }> = {};
    for (const { id } of agents) {
      const snap = manager.getAgentStatus(id);
      agentStatuses[id] = snap ?? { status: 'idle' };
    }
    res.json({
      port,
      uptimeSeconds: Math.floor((Date.now() - manager.startTime) / 1000),
      activeAgent: manager.activeAgent,
      currentModel: manager.currentModel(),
      tiers: manager.config.getTiers(),
      agents: agents.map(({ id, entry }) => ({
        id,
        name: entry.name,
        model: entry.model,
        status: agentStatuses[id]?.status ?? 'idle',
      })),
      configured: manager.config.isConfigured,
    });
  });

  app.post('/api/system/restart', (req, res) => {
    const reason = req.body?.reason as string | undefined;
    res.json({ ok: true, message: 'Restart scheduled. Server will exit in 500ms.' });
    res.on('finish', () => {
      manager.scheduleRestart(reason);
    });
  });

  // ============================
  // Static frontend (production)
  // ============================

  const webDist = process.env.BERRY_CLAW_WEB_DIST
    ? resolve(process.env.BERRY_CLAW_WEB_DIST)
    : resolve(import.meta.dirname, '../../electron/renderer/dist');
  if (existsSync(webDist)) {
    app.use(express.static(webDist));
    app.get('/{*splat}', (_req, res) => {
      res.sendFile(join(webDist, 'index.html'));
    });
  }

  // ============================
  // HTTP + WebSocket
  // ============================

  const server = createServer(app);
  const wss = new WebSocketServer({ server, path: '/ws' });
  /** Active WebSocket clients. The FactBus subscription below pushes
   *  fact_changed events to every client verbatim — the sole cross-tab
   *  sync channel. Per-request broadcasts (like chat stream events) still
   *  go through the client-specific ws handle. */
  const clients = new Set<WebSocket>();

  function broadcast(type: string, payload: Record<string, unknown>): void {
    const msg = JSON.stringify({ type, ...payload });
    for (const client of clients) {
      if (client.readyState === 1 /* OPEN */) {
        client.send(msg);
      }
    }
  }

  // Relay FactBus → every WS client. This replaces the previous ad-hoc
  // config_changed / status_change / session_* events with one unified
  // fact_changed channel.
  manager.factBus.on((change) => {
    broadcast('fact_changed', change as unknown as Record<string, unknown>);
  });

  wss.on('connection', (ws, req) => {
    if (!assertWsAuth(req, authOptions)) {
      ws.close(4001, 'unauthorized');
      return;
    }
    clients.add(ws);
    console.log('🔌 Client connected');

    ws.on('message', async (data) => {
      try {
        const msg = JSON.parse(data.toString());

        switch (msg.type) {
          case 'chat': {
            // Two shapes accepted:
            //   { type:'chat', prompt:'hi', sessionId, agentId }                 — plain text
            //   { type:'chat', prompt:[{type:'text',...},{type:'image',data,mediaType}], sessionId, agentId }
            //     — multimodal turn; blocks pass straight through to Agent.query().
            const payload = msg.prompt;
            await handleChat(ws, manager, payload, msg.sessionId, msg.requestId, msg.agentId);
            break;
          }
      case 'new_session': {
        try {
          const state = await manager.createSession(msg.agentId);
          ws.send(JSON.stringify({
            type: 'session_created',
            sessionId: state.id,
            messages: state.messages ?? [],
          }));
        } catch (err: any) {
          ws.send(JSON.stringify({ type: 'error', message: err.message }));
        }
        break;
      }
          case 'switch_agent': {
            try {
              manager.switchAgent(msg.agentId);
              ws.send(JSON.stringify({ type: 'agent_switched', agentId: msg.agentId }));
            } catch (err: any) {
              ws.send(JSON.stringify({ type: 'error', message: err.message }));
            }
            break;
          }
          case 'resume_session': {
            const hydrated = await manager.loadSessionState(msg.sessionId, msg.agentId);
            const state = hydrated ?? manager.sessions.switchSession(msg.sessionId);
            ws.send(JSON.stringify({
              type: 'session_resumed',
              sessionId: msg.sessionId,
              messages: state?.messages ?? [],
            }));
            break;
          }
          case 'switch_model':
            try {
              manager.switchModel(msg.model);
              ws.send(JSON.stringify({
                type: 'timeline_event',
                event: makeTimelineEvent('model', `模型已切换：${msg.model}`, undefined, 'info'),
              }));
              ws.send(JSON.stringify({ type: 'model_switched', model: msg.model }));
            } catch (err: any) {
              ws.send(JSON.stringify({ type: 'error', message: err.message }));
            }
            break;
          case 'interject': {
            const text = typeof msg.text === 'string' ? msg.text : '';
            if (!text.trim()) {
              ws.send(JSON.stringify({ type: 'error', message: 'interject text required' }));
              break;
            }
            try {
              manager.getAgent().interject(text);
              ws.send(JSON.stringify({
                type: 'interject_acked',
                text,
                status: 'queued',
                delivery: 'interject',
                behavior: 'same_turn',
              }));
            } catch (err: any) {
              ws.send(JSON.stringify({ type: 'error', message: err.message }));
            }
            break;
          }
        }
      } catch (err: any) {
        ws.send(JSON.stringify({ type: 'error', message: err.message }));
      }
    });

    ws.on('close', () => {
      clients.delete(ws);
      console.log('🔌 Client disconnected');
    });
  });

  server.listen(port, () => {
    manager.port = port;
    console.log(`🐾 Berry-Claw server at http://localhost:${port}`);
    console.log(`📁 Agents dir: ${join(manager.config.appDir, 'agents')}`);
    if (manager.config.isConfigured) {
      const firstModel = manager.config.firstConfiguredModelId();
      if (firstModel) console.log(`🤖 First model: ${firstModel}`);
    } else {
      console.log('⚠️  No providers configured. Open Settings → Providers to add one.');
    }
  });

  return { server, manager };
}

async function handleChat(
  ws: WebSocket,
  manager: AgentManager,
  prompt: string | import('@berry-agent/core').ContentBlock[],
  sessionId?: string,
  requestId?: string,
  agentId?: string,
) {
  // Reject chat if no agent is configured
  const targetAgentId = agentId ?? manager.activeAgent;
  if (!targetAgentId || !manager.config.getAgent(targetAgentId)) {
    ws.send(JSON.stringify({ type: 'error', message: 'No agent configured. Create an agent first.' }));
    return;
  }

  ws.send(JSON.stringify({ type: 'start' }));

  let resolvedSessionId = sessionId;

  try {
    const { result, assistantMessage } = await manager.chat(prompt, {
      sessionId,
      requestId,
      agentId: targetAgentId,
      onUserMessagePersisted: (message, createdSessionId) => {
        resolvedSessionId = createdSessionId;
        ws.send(JSON.stringify({
          type: 'user_message_persisted',
          sessionId: createdSessionId,
          message,
        }));
      },
      onEvent: (event: AgentEvent) => {
        const timeline = timelineForAgentEvent(event);
        if (timeline && event.type !== 'api_response') {
          ws.send(JSON.stringify({ type: 'timeline_event', event: timeline }));
        }
        switch (event.type) {
          case 'text_delta':
            ws.send(JSON.stringify({ type: 'text_delta', text: event.text }));
            break;
          case 'thinking_delta':
            ws.send(JSON.stringify({ type: 'thinking_delta', thinking: event.thinking }));
            break;
          case 'tool_call':
            ws.send(JSON.stringify({
              type: 'tool_call',
              name: event.name,
              input: event.input,
              toolUseId: event.toolUseId,
            }));
            break;
          case 'tool_result':
            ws.send(JSON.stringify({
              type: 'tool_result',
              name: event.name,
              isError: event.isError,
              toolUseId: event.toolUseId,
              output: event.output,
            }));
            break;
          case 'compaction':
            ws.send(JSON.stringify({
              type: 'compaction',
              sessionId: resolvedSessionId ?? sessionId,
              tokensFreed: event.tokensFreed,
              layersApplied: event.layersApplied,
              contextBefore: event.contextBefore,
              contextAfter: event.contextAfter,
              contextWindow: event.contextWindow,
              thresholdPct: event.thresholdPct,
              triggerReason: event.triggerReason,
            }));
            break;
          case 'status_change':
            ws.send(JSON.stringify({ type: 'status_change', agentId: manager.activeAgent, status: event.status, detail: event.detail }));
            break;
          case 'api_call':
            ws.send(JSON.stringify({ type: 'api_call', messages: event.messages, tools: event.tools }));
            break;
          case 'todo_updated':
            ws.send(JSON.stringify({
              type: 'todo_updated',
              sessionId: event.sessionId,
              todos: event.todos,
              timestamp: event.timestamp,
            }));
            break;
          case 'retry':
            ws.send(JSON.stringify({
              type: 'retry',
              scope: event.scope,
              attempt: event.attempt,
              maxAttempts: event.maxAttempts,
              reason: event.reason,
              errorMessage: event.errorMessage,
              delayMs: event.delayMs,
            }));
            break;
          case 'api_response':
            ws.send(JSON.stringify({
              type: 'api_response',
              model: event.model,
              usage: event.usage,
              stopReason: event.stopReason,
              cost: (event as any).cost,
              contextTokens: contextTokensForApiResponse(event),
            }));
            if (timeline) {
              ws.send(JSON.stringify({ type: 'timeline_event', event: timeline }));
            }
            break;
        }
      },
    });

    ws.send(JSON.stringify({
      type: 'done',
      sessionId: result.sessionId,
      message: assistantMessage,
      usage: result.usage,
      totalUsage: result.totalUsage,
      toolCalls: result.toolCalls,
    }));
  } catch (err: any) {
    ws.send(JSON.stringify({
      type: 'error',
      message: err.message,
      requestId,
      sessionId: resolvedSessionId,
    }));
  }
}
