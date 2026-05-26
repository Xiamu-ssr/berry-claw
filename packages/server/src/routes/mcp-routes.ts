import type { Express } from 'express';
import type { AgentManager } from '../engine/agent-manager.js';
import { loadMCPLayer, loadMergedMCPConfig } from '../engine/mcp-config.js';
import { zMcpEnabledRequest } from '@berry-agent/claw-contracts';

export function registerMcpRoutes(app: Express, manager: AgentManager): void {
  /** Enable or disable a single shared (global-layer) MCP server by name. */
  app.post('/api/mcp/shared/:name/enabled', async (req, res) => {
    const name = req.params.name;
    const parsed = zMcpEnabledRequest.safeParse(req.body ?? {});
    if (!parsed.success) return res.status(400).json({ error: parsed.error.message });
    const { enabled } = parsed.data;
    try {
      const globalLayer = loadMCPLayer(manager.config.globalMCPPath(), 'global');
      const config = globalLayer[name];
      if (!config || !config.shared) {
        return res.status(404).json({ error: `shared MCP server "${name}" not found in global .mcp.json` });
      }
      const status = await manager.setSharedMcpEnabled(name, config, enabled);
      res.json({ ok: true, status });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  /** Enable or disable a single per-agent MCP server. */
  app.post('/api/mcp/agent/:agentId/:name/enabled', async (req, res) => {
    const { agentId, name } = req.params;
    const parsed = zMcpEnabledRequest.safeParse(req.body ?? {});
    if (!parsed.success) return res.status(400).json({ error: parsed.error.message });
    const { enabled } = parsed.data;
    const entry = manager.config.getAgent(agentId);
    if (!entry) {
      return res.status(404).json({ error: `agent "${agentId}" not found` });
    }
    const workspace = manager.config.agentWorkspace(agentId);
    try {
      const merged = loadMergedMCPConfig({
        globalPath: manager.config.globalMCPPath(),
        projectPath: entry.project ? manager.config.projectMCPPath(entry.project) : undefined,
        agentPath: manager.config.agentHomeFor(workspace).mcpConfigPath,
      });
      const config = merged[name];
      if (!config || config.shared) {
        return res.status(404).json({ error: `per-agent MCP server "${name}" not found for agent "${agentId}"` });
      }
      const status = await manager.setAgentMcpEnabled(agentId, name, config, enabled);
      res.json({ ok: true, status });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });
}
