import { fetchOpenRouterPricing } from '@berry-agent/observe';
import type { AgentManager } from './engine/agent-manager.js';
import { loadMCPLayer } from './engine/mcp-config.js';

export async function installOpenRouterPricing(manager: AgentManager): Promise<void> {
  try {
    const openRouterPricing = await fetchOpenRouterPricing();
    const count = Object.keys(openRouterPricing).length;
    if (count > 0) {
      Object.assign(manager.pricingOverrides, openRouterPricing);
      console.log(`[pricing] Loaded ${count} models from OpenRouter`);
    }
  } catch {
    // Best effort: built-in pricing still works.
  }
}

export async function startSharedMcpServers(manager: AgentManager): Promise<void> {
  try {
    const globalLayer = loadMCPLayer(manager.config.globalMCPPath(), 'global');
    await manager.mcpManager.startSharedServers(globalLayer);
    const status = manager.mcpManager.getStatus();
    if (status.shared.length > 0) {
      console.log(`[MCP] Started ${status.shared.length} shared servers: ${status.shared.map(s => s.name).join(', ')}`);
    }
    manager.emitSystemFact();
  } catch (err) {
    console.error('[MCP] Shared server startup failed:', err instanceof Error ? err.message : err);
  }
}
