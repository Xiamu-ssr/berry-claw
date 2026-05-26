import type { Hand, ManagedAgentRuntime } from '@berry-agent/core';
import { MCPManager } from '@berry-agent/mcp';
import type { MCPServerConfig, MCPServerStatusView } from '@berry-agent/mcp';
import type { ConfigManager, AgentEntry } from './config-manager.js';
import { loadMergedMCPConfig } from './mcp-config.js';

export interface AgentMcpInstance {
  runtime: ManagedAgentRuntime;
  entry: AgentEntry;
}

export interface AgentMcpHostOptions {
  config: ConfigManager;
  mcpManager: MCPManager;
  getInstance: (agentId: string) => AgentMcpInstance | undefined;
  liveAgentIds: () => string[];
  emitAgentFact: (agentId: string) => void;
}

export class AgentMcpHost {
  private pendingStarts = new Set<Promise<void>>();
  private mountedHands = new Map<string, Map<string, Hand>>();
  private closed = false;

  constructor(private readonly options: AgentMcpHostOptions) {}

  startAgent(agentId: string): void {
    const mcpStart = this.startAgentMCP(agentId).catch((err) => {
      console.error(`[agent:${agentId}] MCP initialization failed:`, err instanceof Error ? err.message : err);
    }).finally(() => {
      this.pendingStarts.delete(mcpStart);
    });
    this.pendingStarts.add(mcpStart);
  }

  async releaseAgent(agentId: string): Promise<void> {
    try {
      await this.options.mcpManager.releaseAgent(agentId);
    } catch (err) {
      console.error(`[agent:${agentId}] MCP release failed:`, err instanceof Error ? err.message : err);
    } finally {
      this.mountedHands.delete(agentId);
    }
  }

  async syncAgent(agentId: string): Promise<void> {
    if (this.closed) return;
    const latest = this.options.getInstance(agentId);
    if (!latest) {
      this.mountedHands.delete(agentId);
      return;
    }
    await this.syncRuntimeHands(agentId, latest.runtime, this.options.mcpManager.getHandsForAgent(agentId));
    latest.runtime.setToolDenylist(latest.entry.disabledTools ?? []);
    this.options.emitAgentFact(agentId);
  }

  async setSharedEnabled(
    name: string,
    config: MCPServerConfig,
    enabled: boolean,
  ): Promise<MCPServerStatusView> {
    const status = enabled
      ? await this.options.mcpManager.restartShared(name, config)
      : await this.options.mcpManager.disableShared(name, config);
    await Promise.all(this.options.liveAgentIds().map((id) => this.syncAgent(id)));
    return status;
  }

  async setAgentEnabled(
    agentId: string,
    name: string,
    config: MCPServerConfig,
    enabled: boolean,
  ): Promise<MCPServerStatusView> {
    const status = enabled
      ? await this.options.mcpManager.restartAgent(agentId, name, config)
      : await this.options.mcpManager.disableAgent(agentId, name, config);
    await this.syncAgent(agentId);
    return status;
  }

  async close(): Promise<void> {
    this.closed = true;
    await Promise.allSettled([...this.pendingStarts]);
    await this.options.mcpManager.shutdown();
    this.mountedHands.clear();
  }

  private async startAgentMCP(agentId: string): Promise<void> {
    if (this.closed) return;
    const instance = this.options.getInstance(agentId);
    if (!instance) return;
    const entry = instance.entry;
    const workspace = entry.workspace ?? this.options.config.agentWorkspace(agentId);

    const mcpConfigs = loadMergedMCPConfig({
      globalPath: this.options.config.globalMCPPath(),
      projectPath: entry.project ? this.options.config.projectMCPPath(entry.project) : undefined,
      agentPath: this.options.config.agentHomeFor(workspace).mcpConfigPath,
    });
    if (this.closed) return;
    if (Object.keys(mcpConfigs).length === 0) return;

    await this.options.mcpManager.startAgentServers(agentId, mcpConfigs);
    if (this.closed) return;
    const latest = this.options.getInstance(agentId);
    if (latest !== instance) return;
    await this.syncAgent(agentId);
  }

  private async syncRuntimeHands(
    agentId: string,
    runtime: ManagedAgentRuntime,
    currentHands: Hand[],
  ): Promise<void> {
    const previous = this.mountedHands.get(agentId) ?? new Map<string, Hand>();
    const next = new Map(currentHands.map((hand) => [hand.id, hand]));

    for (const [handId] of previous) {
      if (!next.has(handId)) {
        await runtime.removeHand(handId);
      }
    }

    for (const [handId, hand] of next) {
      if (previous.get(handId) === hand) continue;
      if (runtime.hasHand(handId)) {
        await runtime.removeHand(handId);
      }
      runtime.addHand(hand);
    }

    if (next.size) this.mountedHands.set(agentId, next);
    else this.mountedHands.delete(agentId);
  }
}
