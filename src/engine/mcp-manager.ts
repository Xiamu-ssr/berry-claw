// ============================================================
// Berry-Claw — MCP Manager
// ============================================================
// Manages MCP server connections with two lifecycle modes:
//   - Shared: global MCP servers that live with AgentManager
//   - Per-Agent: MCP servers that live with each agent instance
//
// Tools are registered as first-class citizens (one Berry tool
// per MCP tool), agents see a flat tool list with no awareness
// of the tool's origin.

import { MCPClient } from '@berry-agent/mcp';
import { createMCPTools } from '@berry-agent/mcp';
import type { ToolRegistration } from '@berry-agent/core';
import type { MCPServerConfig } from './mcp-config.js';

interface ManagedServer {
  client: MCPClient;
  config: MCPServerConfig;
  tools: ToolRegistration[];
}

export class MCPManager {
  /** Shared servers — one per server name, global across all agents */
  private sharedServers = new Map<string, ManagedServer>();

  /** Per-agent servers — agentId → (serverName → ManagedServer) */
  private agentServers = new Map<string, Map<string, ManagedServer>>();

  /**
   * Start all shared MCP servers. Called during AgentManager initialization.
   * Failed connections are logged but don't block startup.
   */
  async startSharedServers(configs: Record<string, MCPServerConfig>): Promise<void> {
    for (const [name, config] of Object.entries(configs)) {
      if (!config.enabled) continue;
      if (!config.shared) continue; // Only shared servers here

      try {
        const client = new MCPClient({ name, transport: config.transport });
        await client.connect();
        // prefix is always populated by mcp-config's normalizeEntry —
        // no need to re-default here.
        const tools = await createMCPTools(client, { prefix: config.prefix });
        this.sharedServers.set(name, { client, config, tools });
      } catch (err) {
        console.error(`[MCP] Failed to start shared server "${name}":`, err instanceof Error ? err.message : err);
      }
    }
  }

  /**
   * Start per-agent MCP servers for the given agent.
   * Returns all tools available to this agent (shared + per-agent).
   * Failed connections are logged but don't block agent init.
   */
  async startAgentServers(
    agentId: string,
    configs: Record<string, MCPServerConfig>,
  ): Promise<ToolRegistration[]> {
    const perAgent = new Map<string, ManagedServer>();

    for (const [name, config] of Object.entries(configs)) {
      if (!config.enabled) continue;
      if (config.shared) continue; // Only per-agent servers here

      try {
        const client = new MCPClient({ name, transport: config.transport });
        await client.connect();
        // prefix is always populated by mcp-config's normalizeEntry.
        const tools = await createMCPTools(client, { prefix: config.prefix });
        perAgent.set(name, { client, config, tools });
      } catch (err) {
        console.error(`[MCP] Failed to start per-agent server "${name}" for agent "${agentId}":`, err instanceof Error ? err.message : err);
      }
    }

    if (perAgent.size > 0) {
      this.agentServers.set(agentId, perAgent);
    }

    return this.getToolsForAgent(agentId);
  }

  /**
   * Release all per-agent MCP servers for the given agent.
   * Called when an agent is destroyed or fully reloaded.
   */
  async releaseAgent(agentId: string): Promise<void> {
    const servers = this.agentServers.get(agentId);
    if (!servers) return;

    for (const [name, managed] of servers) {
      try {
        await managed.client.disconnect();
      } catch (err) {
        console.error(`[MCP] Error disconnecting per-agent server "${name}" for agent "${agentId}":`, err instanceof Error ? err.message : err);
      }
    }

    this.agentServers.delete(agentId);
  }

  /**
   * Get all tools available to an agent (shared + per-agent).
   */
  getToolsForAgent(agentId: string): ToolRegistration[] {
    const tools: ToolRegistration[] = [];

    // Shared tools
    for (const managed of this.sharedServers.values()) {
      tools.push(...managed.tools);
    }

    // Per-agent tools
    const perAgent = this.agentServers.get(agentId);
    if (perAgent) {
      for (const managed of perAgent.values()) {
        tools.push(...managed.tools);
      }
    }

    return tools;
  }

  /**
   * Get connection status for all MCP servers, grouped for UI display.
   */
  getStatus(): {
    shared: Array<{ name: string; connected: boolean; toolCount: number }>;
    perAgent: Record<string, Array<{ name: string; connected: boolean; toolCount: number }>>;
  } {
    const shared = Array.from(this.sharedServers.entries()).map(([name, m]) => ({
      name,
      connected: m.client.connected,
      toolCount: m.tools.length,
    }));

    const perAgent: Record<string, Array<{ name: string; connected: boolean; toolCount: number }>> = {};
    for (const [agentId, servers] of this.agentServers) {
      perAgent[agentId] = Array.from(servers.entries()).map(([name, m]) => ({
        name,
        connected: m.client.connected,
        toolCount: m.tools.length,
      }));
    }

    return { shared, perAgent };
  }

  /**
   * Shutdown all MCP connections (both shared and per-agent).
   * Called when AgentManager is shutting down.
   */
  async shutdown(): Promise<void> {
    // Disconnect shared servers
    for (const [name, managed] of this.sharedServers) {
      try {
        await managed.client.disconnect();
      } catch (err) {
        console.error(`[MCP] Error disconnecting shared server "${name}":`, err instanceof Error ? err.message : err);
      }
    }
    this.sharedServers.clear();

    // Disconnect all per-agent servers
    for (const agentId of Array.from(this.agentServers.keys())) {
      await this.releaseAgent(agentId);
    }
  }
}