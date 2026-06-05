import type { Express } from 'express';
import {
  FACT_KINDS,
  SYSTEM_FACT_ID,
  zAgentPauseRequest,
  type FactChange,
} from '@berry-agent/claw-contracts';
import type { ClawServices } from '../engine/services.js';
import { deriveAgentFact, deriveSessionFact } from '../facts/derive.js';

/**
 * Agent routes — thin maps over the a8s client. a8s owns agents; this module
 * lists/inspects/drives them through @berry-agent/client. The product `name`
 * (display metadata) rides a8s's opaque `entry` record on the agent.
 */
export function registerAgentRoutes(app: Express, svc: ClawServices): void {
  const { client } = svc;

  /** Product name for an agent (from a8s's opaque entry), best-effort. */
  const nameFor = (entry: unknown, fallback: string): string => {
    const e = entry as { name?: string } | undefined;
    return e?.name ?? fallback;
  };

  /** List agents (id + product entry) straight from a8s. */
  app.get('/api/agents', async (_req, res) => {
    try {
      const { agents } = await client.listAgents();
      res.json({ agents: agents.map((a) => ({ id: a.agentId, workerId: a.workerId ?? null })) });
    } catch (err) {
      res.status(502).json({ error: a8sError(err) });
    }
  });

  /**
   * Fact snapshot endpoint: seed the frontend cache. Derived live from a8s
   * (listAgents + per-agent snapshot + session views). `kind` filters.
   */
  app.get('/api/facts', async (req, res) => {
    const kindParam = (req.query.kind as string) || 'all';
    const kinds = kindParam === 'all' ? FACT_KINDS : [kindParam];
    const changes: FactChange[] = [];
    try {
      const { agents } = await client.listAgents();

      if (kinds.includes('agent')) {
        for (const a of agents) {
          const fact = await deriveAgentFact(client, a.agentId, { workerId: a.workerId ?? null });
          changes.push({ kind: 'agent', id: a.agentId, fact });
        }
      }
      if (kinds.includes('session')) {
        for (const a of agents) {
          const { sessions } = await client.listSessions(a.agentId).catch(() => ({ sessions: [] }));
          for (const s of sessions) {
            changes.push({
              kind: 'session',
              id: s.id,
              fact: deriveSessionFact({ ...s, agentId: a.agentId, messages: [] }),
            });
          }
        }
      }
      if (kinds.includes('system')) {
        changes.push({ kind: 'system', id: SYSTEM_FACT_ID, fact: { id: SYSTEM_FACT_ID, mcpShared: [], installedSkills: [] } });
      }
      // team facts: collaboration is skill-driven now; no in-process teams.
      res.json({ changes });
    } catch (err) {
      res.status(502).json({ error: a8sError(err) });
    }
  });

  /** Per-agent status map (cheap; from snapshots). */
  app.get('/api/agents/statuses', async (_req, res) => {
    try {
      const { agents } = await client.listAgents();
      const out: Record<string, { status: string; detail?: string }> = {};
      await Promise.all(agents.map(async (a) => {
        const s = await client.agentStatus(a.agentId).catch(() => null);
        out[a.agentId] = s ? { status: s.status, detail: s.detail } : { status: 'idle' };
      }));
      res.json({ statuses: out });
    } catch (err) {
      res.status(502).json({ error: a8sError(err) });
    }
  });

  /** Abort the current turn. */
  app.post('/api/agents/:id/pause', async (req, res) => {
    const parsed = zAgentPauseRequest.safeParse(req.body ?? {});
    if (!parsed.success) return res.status(400).json({ error: parsed.error.message });
    try {
      const r = await client.pauseAgent(req.params.id, parsed.data.reason);
      res.json({ agentId: req.params.id, paused: r.paused, status: r.status, detail: r.detail });
    } catch (err) {
      res.status(502).json({ error: a8sError(err) });
    }
  });

  /** Context-window usage for a session. */
  app.get('/api/agents/:id/context-size', async (req, res) => {
    try {
      const sessionId = typeof req.query.sessionId === 'string' ? req.query.sessionId : undefined;
      const size = await client.agentContextSize(req.params.id, sessionId);
      res.json(size);
    } catch (err) {
      res.status(502).json({ error: a8sError(err) });
    }
  });

  /** Delete an agent (a8s removes it from the cluster). */
  app.delete('/api/agents/:id', async (req, res) => {
    try {
      await client.deleteAgent(req.params.id);
      svc.facts.emitAgent(req.params.id, null);
      res.json({ ok: true });
    } catch (err) {
      res.status(502).json({ error: a8sError(err) });
    }
  });

  void nameFor; // reserved for when a8s entry metadata is surfaced
}

function a8sError(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
