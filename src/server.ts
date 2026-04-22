/**
 * Berry-Claw Server — HTTP + WebSocket (thin shell over engine)
 */
import express from 'express';
import cors from 'cors';
import { WebSocketServer, WebSocket } from 'ws';
import { createServer } from 'node:http';
import { resolve, join } from 'node:path';
import { existsSync } from 'node:fs';
import { AgentManager, getToolGroup } from './engine/agent-manager.js';
import { createObserveRouter } from '@berry-agent/observe';
import type { AgentEvent } from '@berry-agent/core';
import { WEB_SEARCH_CREDENTIAL_META, type CredentialKeyMeta } from '@berry-agent/tools-common';

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

export function startServer(port: number) {
  const manager = new AgentManager();
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
  app.get('/api/agents/statuses', (_req, res) => {
    const out: Record<string, { status: string; detail?: string }> = {};
    for (const { id } of manager.config.listAgents()) {
      const snap = manager.getAgentStatus(id);
      out[id] = snap ?? { status: 'idle' };
    }
    res.json({ statuses: out });
  });

  /** Create/update agent */
  app.put('/api/agents/:id', (req, res) => {
    const { name, systemPrompt, model, workspace, tools, disabledTools, skillDirs, disabledSkills } = req.body;
    if (!name || !model) return res.status(400).json({ error: 'name and model required' });
    manager.config.setAgent(req.params.id, {
      name, systemPrompt, model, workspace, tools, disabledTools, skillDirs, disabledSkills,
    });
    // Hot reload: drop cached Agent instance so next query re-reads config
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
    // Force-init any project-bound agent that isn't live yet. This is the
    // only point where we proactively wake agents — without it the Teams
    // tab would show "no teams" on a fresh server boot until the user hits
    // chat, because agent instances (and thus team rehydration) are lazy.
    // Cost: one extra init per project-bound agent on first Teams load.
    for (const { id, entry } of manager.config.listAgents()) {
      if (entry.project && !manager.isAgentLive(id)) {
        try { manager.getAgent(id); } catch { /* ignore per-agent init failures */ }
      }
    }
    // Wait for any in-flight rehydrates to settle. This is the reliable
    // way — setImmediate-polling was flaky because the rehydrate promise
    // includes a readFile + per-teammate agent.spawn.
    await Promise.all(
      manager.config.listAgents().map(({ id }) => manager.waitForTeamRehydrate(id)),
    );

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
  app.get('/api/agents/:id/inspect', (req, res) => {
    try {
      const info = manager.inspectAgent(req.params.id);
      const runtime = info.runtime
        ? {
            ...info.runtime,
            tools: info.runtime.tools.map((t: { name: string; description: string }) => ({
              ...t,
              group: getToolGroup(t.name),
            })),
          }
        : null;
      res.json({ ...info, runtime });
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  // ============================
  // Session API
  // ============================

  /** List sessions — 1 agent 1 session: returns at most the current agent's active session. */
  app.get('/api/sessions', async (_req, res) => {
    const sessionId = manager.sessions.currentSessionId;
    if (!sessionId) {
      return res.json({ sessions: [] });
    }
    const state = manager.sessions.getState(sessionId);
    if (state) {
      return res.json({ sessions: [state] });
    }
    // Try to hydrate from agent store
    try {
      const hydrated = await manager.loadSessionState(sessionId);
      if (hydrated) return res.json({ sessions: [hydrated] });
    } catch { /* ignore */ }
    return res.json({ sessions: [] });
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

  wss.on('connection', (ws) => {
    console.log('🔌 Client connected');

    ws.on('message', async (data) => {
      try {
        const msg = JSON.parse(data.toString());

        switch (msg.type) {
          case 'chat':
            await handleChat(ws, manager, msg.prompt, msg.sessionId);
            break;
      case 'new_session': {
        try {
          const agent = manager.getAgent();
          const sessionId = manager.sessions.currentSessionId;
          if (!sessionId) {
            ws.send(JSON.stringify({ type: 'error', message: 'No active session to compact.' }));
            break;
          }
          const result = await agent.compactSession(sessionId, { reason: 'user_request' });
          ws.send(JSON.stringify({
            type: 'session_compacted',
            sessionId,
            tokensFreed: result.tokensFreed,
            layersApplied: result.layersApplied,
          }));
        } catch (err: any) {
          ws.send(JSON.stringify({ type: 'error', message: err.message }));
        }
        break;
      }
          case 'resume_session': {
            const hydrated = await manager.loadSessionState(msg.sessionId);
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
              ws.send(JSON.stringify({ type: 'interject_acked', text }));
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

    ws.on('close', () => console.log('🔌 Client disconnected'));
  });

  server.listen(port, () => {
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

async function handleChat(ws: WebSocket, manager: AgentManager, prompt: string, sessionId?: string) {
  // Reject chat if no agent is configured
  if (!manager.activeAgent || !manager.config.getAgent(manager.activeAgent)) {
    ws.send(JSON.stringify({ type: 'error', message: 'No agent configured. Create an agent first.' }));
    return;
  }

  ws.send(JSON.stringify({ type: 'start' }));

  try {
    const { result, assistantMessage } = await manager.chat(prompt, {
      sessionId,
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
    ws.send(JSON.stringify({ type: 'error', message: err.message }));
  }
}
