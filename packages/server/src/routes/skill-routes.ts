import type { Express } from 'express';
import type { AgentManager } from '../engine/agent-manager.js';
import { zSkillInstallRequest, zSkillSourceId } from '@berry-agent/claw-contracts';

export function registerSkillRoutes(app: Express, manager: AgentManager): void {
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
    const source = zSkillSourceId.safeParse(String(req.query.source ?? ''));
    const q = req.query.q ? String(req.query.q) : undefined;
    if (!source.success) return res.status(400).json({ error: source.error.message });
    try {
      const items = await manager.skillMarket.list(source.data, q);
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
    const parsed = zSkillInstallRequest.safeParse(req.body ?? {});
    if (!parsed.success) return res.status(400).json({ error: parsed.error.message });
    const { sourceId, slug } = parsed.data;
    try {
      const installed = await manager.skillMarket.install(sourceId, slug);
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
      for (const { id } of manager.config.listAgents()) {
        manager.emitAgentFact(id);
      }
      res.json({ ok: true });
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });
}
