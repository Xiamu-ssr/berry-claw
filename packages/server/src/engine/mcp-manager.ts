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
//
// Startup uses Promise.allSettled so one slow / broken MCP server
// never blocks the rest. Failed entries are retained with status
// metadata so the UI can surface them and offer a single-server
// restart.

import { MCPClient } from '@berry-agent/mcp';
import { createMCPTools } from '@berry-agent/mcp';
import type { ToolRegistration } from '@berry-agent/core';
import type { MCPServerConfig } from './mcp-config.js';
import { defaultMCPPrefix } from './mcp-constants.js';

export type MCPServerStatus = 'connecting' | 'connected' | 'failed' | 'disabled';

interface ManagedServer {
  /** null while connecting, after failure, or while disabled. */
  client: MCPClient | null;
  config: MCPServerConfig;
  /** Empty when status !== 'connected'. */
  tools: ToolRegistration[];
  status: MCPServerStatus;
  lastError?: string;
  /** ISO timestamp of the last startup / restart attempt. */
  lastStartedAt?: string;
}

/** Public shape returned by {@link MCPManager.getStatus}. */
export interface MCPServerStatusView {
  name: string;
  connected: boolean;
  toolCount: number;
  status: MCPServerStatus;
  lastError?: string;
  lastStartedAt?: string;
}

export interface MCPManagerOptions {
  /**
   * Invoked whenever a managed server's status changes (startup, restart,
   * failure). Host products use this to refresh their fact feeds.
   */
  onChange?: () => void;
}

export class MCPManager {
  /** Shared servers — one per server name, global across all agents */
  private sharedServers = new Map<string, ManagedServer>();

  /** Per-agent servers — agentId → (serverName → ManagedServer) */
  private agentServers = new Map<string, Map<string, ManagedServer>>();

  private readonly onChange?: () => void;

  constructor(options: MCPManagerOptions = {}) {
    this.onChange = options.onChange;
  }

  /**
   * Start all shared MCP servers in parallel. Called during AgentManager
   * initialization. Failed connections do NOT block startup — they're
   * retained with `status: 'failed'` so the UI can restart them later.
   */
  async startSharedServers(configs: Record<string, MCPServerConfig>): Promise<void> {
    const entries = Object.entries(configs).filter(([, c]) => c.shared);
    await Promise.allSettled(
      entries.map(([name, config]) => this.connectOne('shared', null, name, config)),
    );
  }

  /**
   * Start per-agent MCP servers in parallel. Returns all tools available to
   * this agent (shared + per-agent). Failed connections are retained with
   * status metadata; they just contribute 0 tools.
   */
  async startAgentServers(
    agentId: string,
    configs: Record<string, MCPServerConfig>,
  ): Promise<ToolRegistration[]> {
    const entries = Object.entries(configs).filter(([, c]) => !c.shared);
    await Promise.allSettled(
      entries.map(([name, config]) => this.connectOne('agent', agentId, name, config)),
    );
    return this.getToolsForAgent(agentId);
  }

  /**
   * Restart a single shared MCP server in place. Disconnects the previous
   * client (if any) then re-invokes the connect pipeline. The caller is
   * responsible for sourcing the latest config from the 3-layer cascade.
   */
  async restartShared(name: string, config: MCPServerConfig): Promise<MCPServerStatusView> {
    const prev = this.sharedServers.get(name);
    if (prev?.client) {
      try { await prev.client.disconnect(); } catch { /* swallow: we're tearing down */ }
    }
    await this.connectOne('shared', null, name, config);
    return this.describe(this.sharedServers.get(name)!, name);
  }

  /** Restart a single per-agent MCP server in place. */
  async restartAgent(
    agentId: string,
    name: string,
    config: MCPServerConfig,
  ): Promise<MCPServerStatusView> {
    const prev = this.agentServers.get(agentId)?.get(name);
    if (prev?.client) {
      try { await prev.client.disconnect(); } catch { /* swallow: we're tearing down */ }
    }
    await this.connectOne('agent', agentId, name, config);
    return this.describe(this.agentServers.get(agentId)!.get(name)!, name);
  }

  /**
   * Disable a single shared MCP server at runtime. Disconnects the client
   * (if any) and transitions the entry to `status: 'disabled'` so the UI
   * toggle reflects it and the LLM stops seeing its tools.
   *
   * Runtime-only: next process restart will re-read `.mcp.json`, so
   * persistence belongs to the file. The companion enable path is simply
   * `restartShared`, which re-reads the cascade and reconnects.
   */
  async disableShared(name: string, config: MCPServerConfig): Promise<MCPServerStatusView> {
    const prev = this.sharedServers.get(name);
    if (prev?.client) {
      try { await prev.client.disconnect(); } catch { /* swallow: tearing down */ }
    }
    this.storeManaged('shared', null, name, {
      client: null,
      config,
      tools: [],
      status: 'disabled',
    });
    this.emitChange();
    return this.describe(this.sharedServers.get(name)!, name);
  }

  /** Disable a single per-agent MCP server at runtime. See `disableShared`. */
  async disableAgent(
    agentId: string,
    name: string,
    config: MCPServerConfig,
  ): Promise<MCPServerStatusView> {
    const prev = this.agentServers.get(agentId)?.get(name);
    if (prev?.client) {
      try { await prev.client.disconnect(); } catch { /* swallow: tearing down */ }
    }
    this.storeManaged('agent', agentId, name, {
      client: null,
      config,
      tools: [],
      status: 'disabled',
    });
    this.emitChange();
    return this.describe(this.agentServers.get(agentId)!.get(name)!, name);
  }

  /**
   * Release all per-agent MCP servers for the given agent.
   * Called when an agent is destroyed or fully reloaded.
   */
  async releaseAgent(agentId: string): Promise<void> {
    const servers = this.agentServers.get(agentId);
    if (!servers) return;

    for (const [name, managed] of servers) {
      if (!managed.client) continue;
      try {
        await managed.client.disconnect();
      } catch (err) {
        console.error(`[MCP] Error disconnecting per-agent server "${name}" for agent "${agentId}":`, err instanceof Error ? err.message : err);
      }
    }

    this.agentServers.delete(agentId);
    this.emitChange();
  }

  /**
   * Get all tools available to an agent (shared + per-agent).
   *
   * Only `connected` servers contribute tools — `failed`, `connecting`, and
   * `disabled` entries all carry `tools: []`. This is the single gate that
   * keeps unhealthy MCP servers out of the LLM's tool schema.
   */
  getToolsForAgent(agentId: string): ToolRegistration[] {
    const tools: ToolRegistration[] = [];

    for (const managed of this.sharedServers.values()) {
      tools.push(...managed.tools);
    }

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
   * Returned shape includes both `status` and a derived `connected` boolean
   * for UI convenience.
   */
  getStatus(): {
    shared: MCPServerStatusView[];
    perAgent: Record<string, MCPServerStatusView[]>;
  } {
    const shared = Array.from(this.sharedServers.entries()).map(([name, m]) => this.describe(m, name));

    const perAgent: Record<string, MCPServerStatusView[]> = {};
    for (const [agentId, servers] of this.agentServers) {
      perAgent[agentId] = Array.from(servers.entries()).map(([name, m]) => this.describe(m, name));
    }

    return { shared, perAgent };
  }

  /**
   * Shutdown all MCP connections (both shared and per-agent).
   * Called when AgentManager is shutting down.
   */
  async shutdown(): Promise<void> {
    for (const [name, managed] of this.sharedServers) {
      if (!managed.client) continue;
      try {
        await managed.client.disconnect();
      } catch (err) {
        console.error(`[MCP] Error disconnecting shared server "${name}":`, err instanceof Error ? err.message : err);
      }
    }
    this.sharedServers.clear();

    for (const agentId of Array.from(this.agentServers.keys())) {
      await this.releaseAgent(agentId);
    }

    this.emitChange();
  }

  // ===== internals =====

  /**
   * Connect (or reconnect) a single server. Writes `connecting` first for UI
   * immediacy, then either promotes it to `connected` with the
   * populated tools list, or marks it `failed` with the error message.
   * Never throws — failures are logged and retained in the managed map so
   * they surface in `getStatus()`.
   */
  private async connectOne(
    scope: 'shared' | 'agent',
    agentId: string | null,
    name: string,
    config: MCPServerConfig,
  ): Promise<void> {
    // Disabled servers short-circuit before we spin up any subprocess.
    if (!config.enabled) {
      this.storeManaged(scope, agentId, name, {
        client: null,
        config,
        tools: [],
        status: 'disabled',
      });
      this.emitChange();
      return;
    }

    // Placeholder so UIs see a yellow "connecting" pill immediately.
    this.storeManaged(scope, agentId, name, {
      client: null,
      config,
      tools: [],
      status: 'connecting',
    });
    this.emitChange();

    try {
      const client = new MCPClient({
        name,
        transport: config.transport,
        // Skip-if-slow: hard-cap the SDK's 60s initialize default so one
        // broken server can't gate the whole startup pipeline.
        connectTimeoutMs: 10_000,
      });
      await client.connect();
      // Three-state prefix:
      //   explicit string / "" → pass through verbatim as `prefix`
      //   undefined → let the adapter auto-detect against the live tool
      //               list, falling back to `${name}_` when the server
      //               hasn't already baked that identifier into its names.
      const tools = await createMCPTools(
        client,
        config.prefix !== undefined
          ? { prefix: config.prefix }
          : { autoPrefix: defaultMCPPrefix(name) },
      );
      this.storeManaged(scope, agentId, name, {
        client,
        config,
        tools,
        status: 'connected',
        lastStartedAt: new Date().toISOString(),
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const label = scope === 'shared' ? 'shared' : `agent "${agentId}"`;
      console.error(`[MCP] ${label} server "${name}" failed:`, msg);
      this.storeManaged(scope, agentId, name, {
        client: null,
        config,
        tools: [],
        status: 'failed',
        lastError: msg,
        lastStartedAt: new Date().toISOString(),
      });
    } finally {
      this.emitChange();
    }
  }

  private storeManaged(
    scope: 'shared' | 'agent',
    agentId: string | null,
    name: string,
    entry: ManagedServer,
  ): void {
    if (scope === 'shared') {
      this.sharedServers.set(name, entry);
      return;
    }
    // scope === 'agent'
    const key = agentId ?? '';
    let bucket = this.agentServers.get(key);
    if (!bucket) {
      bucket = new Map();
      this.agentServers.set(key, bucket);
    }
    bucket.set(name, entry);
  }

  private describe(m: ManagedServer, name: string): MCPServerStatusView {
    return {
      name,
      connected: m.status === 'connected',
      toolCount: m.tools.length,
      status: m.status,
      lastError: m.lastError,
      lastStartedAt: m.lastStartedAt,
    };
  }

  private emitChange(): void {
    // Never let a misbehaving listener bubble up — fact emission is best-effort.
    try { this.onChange?.(); } catch (err) {
      console.error('[MCP] onChange listener threw:', err);
    }
  }
}
