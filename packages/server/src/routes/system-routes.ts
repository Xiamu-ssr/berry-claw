import type { Express } from 'express';
import type { AgentManager } from '../engine/agent-manager.js';
import { zSystemRestartRequest } from '@berry-agent/claw-contracts';

export function registerSystemRoutes(app: Express, manager: AgentManager, port: number): void {
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

  app.post('/api/system/restart', async (req, res) => {
    const parsed = zSystemRestartRequest.safeParse(req.body ?? {});
    if (!parsed.success) return res.status(400).json({ error: parsed.error.message });
    const result = await manager.requestRestart(parsed.data.reason);
    res.json({ ok: true, ...result });
  });
}
