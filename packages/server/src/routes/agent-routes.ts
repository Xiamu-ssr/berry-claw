import type { Express } from 'express';
import type { AgentManager } from '../engine/agent-manager.js';
import { deriveAgentFact, deriveSessionFact, deriveTeamFact, deriveSystemFact } from '../facts/derive.js';
import {
  FACT_KINDS,
  SYSTEM_FACT_ID,
  zAgentPatchRequest,
  zAgentPauseRequest,
  zAgentUpsertRequest,
  type FactChange,
} from '@berry-agent/claw-contracts';

export function registerAgentRoutes(app: Express, manager: AgentManager): void {
  /** List agents. */
  app.get('/api/agents', (_req, res) => {
    const agents = manager.config.listAgents();
    res.json({ agents });
  });

  /**
   * Snapshot endpoint for FactBus consumers. UIs call this once on mount
   * to seed their cache, then patch incrementally from the fact_changed
   * WS channel. `kind` may be 'agent' | 'team' | 'session' | 'all'.
   */
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
      await manager.ensureTeamsLoaded();
      for (const { id } of manager.config.listAgents()) {
        const team = manager.getTeam(id);
        if (!team) continue;
        const fact = await deriveTeamFact(team);
        changes.push({ kind: 'team', id, fact });
      }
    }
    if (kinds.includes('system')) {
      changes.push({ kind: 'system', id: SYSTEM_FACT_ID, fact: deriveSystemFact(manager) });
    }
    if (kinds.includes('session')) {
      for (const { id } of manager.config.listAgents()) {
        for (const view of await manager.listSessionStates(id)) {
          changes.push({ kind: 'session', id: view.id, fact: deriveSessionFact(view) });
        }
      }
    }

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

  app.post('/api/agents/:id/pause', (req, res) => {
    const parsed = zAgentPauseRequest.safeParse(req.body ?? {});
    if (!parsed.success) return res.status(400).json({ error: parsed.error.message });
    try {
      res.json(manager.pauseAgent(req.params.id, parsed.data.reason));
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  /** Current context token size for the active session of an agent. */
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

  /** Create/update agent. */
  app.put('/api/agents/:id', async (req, res) => {
    const parsed = zAgentUpsertRequest.safeParse(req.body ?? {});
    if (!parsed.success) return res.status(400).json({ error: parsed.error.message });
    manager.config.setAgent(req.params.id, parsed.data);
    await manager.reloadAgent(req.params.id);
    res.json({ ok: true });
  });

  /** Patch agent (partial update, useful for toggles). */
  app.patch('/api/agents/:id', async (req, res) => {
    const current = manager.config.getAgent(req.params.id);
    if (!current) return res.status(404).json({ error: 'Agent not found' });
    const parsed = zAgentPatchRequest.safeParse(req.body ?? {});
    if (!parsed.success) return res.status(400).json({ error: parsed.error.message });
    const patch = parsed.data;
    const merged = { ...current, ...patch };
    manager.config.setAgent(req.params.id, merged);
    await manager.reloadAgent(req.params.id);
    res.json({ ok: true, entry: merged });
  });

  /** Delete agent registry entry. SDK-owned agent home is left untouched. */
  app.delete('/api/agents/:id', async (req, res) => {
    await manager.removeAgent(req.params.id);
    res.json({ ok: true });
  });

  /** Read-only file browser for the current agent's project/workspace root. */
  app.get('/api/agents/:id/files', async (req, res) => {
    try {
      const path = typeof req.query.path === 'string' ? req.query.path : '';
      const result = await manager.listAgentFiles(req.params.id, path);
      res.json(result);
    } catch (err: any) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(message.includes('not found') || message.includes('ENOENT') ? 404 : 400).json({ error: message });
    }
  });

  app.get('/api/agents/:id/files/content', async (req, res) => {
    try {
      const path = typeof req.query.path === 'string' ? req.query.path : '';
      if (!path) return res.status(400).json({ error: 'path query required' });
      const result = await manager.readAgentFile(req.params.id, path);
      res.json(result);
    } catch (err: any) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(message.includes('not found') || message.includes('ENOENT') ? 404 : 400).json({ error: message });
    }
  });
}
