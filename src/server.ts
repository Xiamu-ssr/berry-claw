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
import { loadMCPLayer } from './engine/mcp-config.js';
import { createObserveRouter, fetchOpenRouterPricing } from '@berry-agent/observe';
import type { AgentEvent } from '@berry-agent/core';
import { WEB_SEARCH_CREDENTIAL_META, type CredentialKeyMeta } from '@berry-agent/tools-common';
import { deriveAgentFact, deriveTeamFact } from './facts/derive.js';
import { FACT_KINDS, type FactChange } from './facts/types.js';

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

export interface StartServerOptions {
  appDir?: string;
}

export async function startServer(port: number, options: StartServerOptions = {}) {
  const manager = new AgentManager({ appDir: options.appDir });

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
    const globalLayer = loadMCPLayer(join(manager.config.appDir, '.mcp.json'), 'global');
    await manager.mcpManager.startSharedServers(globalLayer);
    const status = manager.mcpManager.getStatus();
    if (status.shared.length > 0) {
      console.log(`[MCP] Started ${status.shared.length} shared servers: ${status.shared.map(s => s.name).join(', ')}`);
    }
  } catch (err) {
    console.error('[MCP] Shared server startup failed:', err instanceof Error ? err.message : err);
  }

  const app = express();
  app.use(cors());
  app.use(express.json());

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
      schemaVersion: 2,
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
    // session facts: not yet wired into FactBus; Phase 2 intentionally
    // stops at agent + team. Session dimension added later once we define
    // how session lifecycle events integrate with the bus.

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

  /** MCP server connection status */
  app.get('/api/mcp/status', (_req, res) => {
    res.json(manager.mcpManager.getStatus());
  });

  /** Current context token size for the active session of an agent */
  app.get('/api/agents/:id/context-size', async (req, res) => {
    try {
      const size = await manager.getAgentContextSize(req.params.id);
      if (!size) return res.status(404).json({ error: 'Agent not found or not initialized' });
      res.json(size);
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  /** Create/update agent */
  app.put('/api/agents/:id', (req, res) => {
    const { name, systemPrompt, model, workspace, project, tools, disabledTools, skillDirs, disabledSkills } = req.body;
    if (!name || !model) return res.status(400).json({ error: 'name and model required' });
    manager.config.setAgent(req.params.id, {
      name, systemPrompt, model, workspace, project, tools, disabledTools, skillDirs, disabledSkills,
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
    const merged = { ...current, ...req.body };
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

  /** Edit a prompt block at its source (config custom prompt / workspace AGENT.md). */
  app.put('/api/agents/:id/prompt-blocks/:blockId', async (req, res) => {
    const entry = manager.config.getAgent(req.params.id);
    if (!entry) return res.status(404).json({ error: 'Agent not found' });
    const content = typeof req.body?.content === 'string' ? req.body.content : '';

    try {
      switch (req.params.blockId) {
        case 'custom_prompt': {
          manager.config.setAgent(req.params.id, {
            ...entry,
            systemPrompt: content.trim() ? content : undefined,
          });
          manager.reloadAgent(req.params.id);
          break;
        }
        case 'workspace_agent_md': {
          const { writeFile } = await import('node:fs/promises');
          const workspace = entry.workspace ?? manager.config.agentWorkspace(req.params.id);
          await writeFile(join(workspace, 'AGENT.md'), content, 'utf-8');
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
  // Memory API — per-agent MEMORY.md + per-project .berry-discoveries.md
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
   * Read the shared project discoveries for an agent's project binding.
   * Returns { project, content } where content is the raw markdown.
   * Also pulls AGENTS.md / PROJECT.md when present so the UI can show
   * the full "what this team knows" picture in one panel.
   */
  app.get('/api/agents/:id/project/knowledge', async (req, res) => {
    const entry = manager.config.getAgent(req.params.id);
    if (!entry) return res.status(404).json({ error: 'agent not found' });
    if (!entry.project) return res.json({ project: null, files: [] });
    const { join } = await import('node:path');
    const { readFile } = await import('node:fs/promises');
    const files: Array<{ path: string; content: string }> = [];
    for (const name of ['AGENTS.md', 'PROJECT.md', '.berry-discoveries.md']) {
      try {
        const content = await readFile(join(entry.project, name), 'utf-8');
        if (content.trim().length > 0) files.push({ path: name, content });
      } catch { /* missing file is fine */ }
    }
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

  const webDist = resolve(import.meta.dirname, '../web/dist');
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

  wss.on('connection', (ws) => {
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
          // 1-agent-1-session: "new session" means clear the current session (max compaction)
          const sessionId = await manager.clearSession(msg.agentId);
          const state = await manager.loadSessionState(sessionId, msg.agentId);
          ws.send(JSON.stringify({
            type: 'session_created',
            sessionId,
            messages: state?.messages ?? [],
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
        switch (event.type) {
          case 'text_delta':
            ws.send(JSON.stringify({ type: 'text_delta', text: event.text }));
            break;
          case 'thinking_delta':
            ws.send(JSON.stringify({ type: 'thinking_delta', thinking: event.thinking }));
            break;
          case 'tool_call':
            ws.send(JSON.stringify({ type: 'tool_call', name: event.name, input: event.input }));
            break;
          case 'tool_result':
            ws.send(JSON.stringify({ type: 'tool_result', name: event.name, isError: event.isError }));
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
            }));
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
