import type { Express } from 'express';
import type { AgentManager } from '../engine/agent-manager.js';
import { zSessionCreateRequest } from '@berry-agent/claw-contracts';

export function registerSessionRoutes(app: Express, manager: AgentManager): void {
  /** List sessions for an agent (or active agent if no agentId param). */
  app.get('/api/sessions', async (req, res) => {
    const agentId = req.query.agentId as string | undefined;
    const states = await manager.listSessionStates(agentId);
    res.json({ sessions: states });
  });

  /** Create a new SDK-owned session for an agent. */
  app.post('/api/sessions', async (req, res) => {
    try {
      const parsed = zSessionCreateRequest.safeParse(req.body ?? {});
      if (!parsed.success) return res.status(400).json({ error: parsed.error.message });
      const state = await manager.createSession(parsed.data.agentId);
      res.status(201).json(state);
    } catch (err: any) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(message.includes('not found') ? 404 : 400).json({ error: message });
    }
  });

  /** Current SDK todo scratchpad for a session. */
  app.get('/api/sessions/:id/todos', async (req, res) => {
    const agentId = req.query.agentId as string | undefined;
    const todos = await manager.getSessionTodos(req.params.id, agentId);
    res.json({ todos });
  });

  /** SDK session detail plus observe summary. */
  app.get('/api/sessions/:id', async (req, res) => {
    const agentId = req.query.agentId as string | undefined;
    const rawLimit = Number(req.query.limit);
    const eventLimit = Number.isFinite(rawLimit) && rawLimit > 0
      ? Math.min(2000, Math.floor(rawLimit))
      : undefined;
    const state = await manager.loadSessionState(req.params.id, agentId, { eventLimit });
    if (!state) return res.status(404).json({ error: 'Session not found' });
    const observeSummary = manager.observer.analyzer.sessionSummary(req.params.id);
    res.json({ ...state, observe: observeSummary });
  });

  /** Delete a SDK-owned session. */
  app.delete('/api/sessions/:id', async (req, res) => {
    const agentId = req.query.agentId as string | undefined;
    await manager.deleteSession(req.params.id, agentId);
    res.json({ ok: true });
  });
}
