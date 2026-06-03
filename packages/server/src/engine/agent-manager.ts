/**
 * Agent Manager — 多 Agent 实例管理
 */
import {
  DefaultCredentialStore,
  ManagedAgentRuntime,
} from '@berry-agent/core';
import type {
  CredentialStore,
  AgentEvent,
  QueryResult,
  ContentBlock,
  AgentSnapshot,
  AgentChatMessage,
  AgentSessionView,
} from '@berry-agent/core';
import type { AskAnswer, AskBridge, PendingApproval } from '@berry-agent/safe';
import {
  resolveSafetyLevel,
  type SafetyLevel,
} from '@berry-agent/safe';
import { createObserver, type Observer, type ModelPricing } from '@berry-agent/observe';
import { ConfigManager, type AgentEntry } from './config-manager.js';
import type { PromptBlockInfo } from '@berry-agent/claw-contracts';
import { join } from 'node:path';
import type { TierId } from '@berry-agent/models';
import type { TeamState } from '@berry-agent/team';
import { FactBus } from '../facts/bus.js';
import { deriveAgentFact, deriveSystemFact } from '../facts/derive.js';
import { MCPManager } from '@berry-agent/mcp';
import type { MCPServerConfig, MCPServerStatusView } from '@berry-agent/mcp';
import { SkillMarketService } from './skill-market.js';
import { TeamHost } from './team-host.js';
import { AgentRuntimeFactory } from './agent-runtime-factory.js';
import { AgentChatHost } from './agent-chat-host.js';
import { AgentContextHost } from './agent-context-host.js';
import { AgentFileHost, type AgentBrowseRoot, type AgentFileContent, type AgentFileList } from './agent-file-host.js';
import { AgentLifecycleHost } from './agent-lifecycle-host.js';
import { AgentMcpHost } from './agent-mcp-host.js';
import { AgentReloadHost } from './agent-reload-host.js';
import { AgentSessionHost } from './agent-session-host.js';
import { createDefaultPricingOverrides } from './pricing-overrides.js';
import { Worker, type WorkerAgentMount } from '@berry-agent/worker';

export type AgentInstance = WorkerAgentMount<AgentEntry>;

export interface AgentManagerOptions {
  appDir?: string;
  credentialFilePath?: string;
}

export class AgentManager {
  readonly config: ConfigManager;
  readonly observer: Observer;
  readonly credentials: CredentialStore;
  /** Worker daemon that owns live runtimes. Replaces the previous
   *  in-line ManagedRuntimeRegistry — the worker handles mount lifecycle
   *  and is ready to participate in cross-process lease/failover when a
   *  RuntimeOrchestrator is supplied (M2). */
  private worker!: Worker<AgentEntry>;
  /** Single outbound stream of truth; server WS relays verbatim. */
  readonly factBus = new FactBus();
  private readonly runtimeFactory: AgentRuntimeFactory;
  private readonly chatHost: AgentChatHost;
  private readonly teamHost: TeamHost;
  private readonly contextHost: AgentContextHost;
  private readonly fileHost: AgentFileHost;
  private readonly lifecycleHost: AgentLifecycleHost;
  private readonly agentMcpHost: AgentMcpHost;
  private readonly reloadHost: AgentReloadHost;
  private readonly sessionHost: AgentSessionHost;
  /** Pricing overrides (built-in + OpenRouter). Mutated at runtime after
   *  OpenRouter fetch so that per-agent collectors see the updated map. */
  pricingOverrides: Record<string, ModelPricing>;
  /** Server port (set by startServer after binding). Used by berry_status. */
  port: number = 3210;
  /** Server start timestamp. Used by berry_status to compute uptime. */
  readonly startTime = Date.now();
  /**
   * MCP server connection manager (shared + per-agent). The `onChange` hook
   * lets MCPManager tell us to re-emit SystemFact without knowing anything
   * about FactBus — preserves the SDK/product layering. Per-agent MCP
   * changes still flow through the surrounding agent-fact emissions issued
   * by init/restart code; emitting SystemFact on every MCP tick is enough
   * to refresh the global MCP tab cheaply.
   */
  readonly mcpManager: MCPManager = new MCPManager({
    onChange: () => this.emitSystemFact(),
  });
  /**
   * Skill Market service. Browses the ClawHub registry and installs skill
   * packages under `~/.berry-claw/skills/`. Construction is deferred to
   * the constructor body so it can see `this.config`.
   */
  skillMarket!: SkillMarketService;
  /**
   * Host-supplied HITL approval bridge. Wired by the server layer (see
   * {@link setAskBridge}) once the WebSocket transport is up — before the
   * bridge is installed, safety mode `auto` fails-closed on any listed
   * tool. Kept as a mutable field so server.ts can swap bridges without
   * reconstructing the AgentManager.
   *
   * The bridge is shared by every agent constructed after it's set.
   * Agents created **before** the bridge is installed will capture the
   * then-current (undefined) bridge in their guard closure — call
   * `reloadAgent(id)` to pick up a newly installed bridge.
   */
  private askBridge: AskBridge | undefined;

  constructor(options: AgentManagerOptions = {}) {
    this.config = new ConfigManager({ appDir: options.appDir });
    this.credentials = new DefaultCredentialStore({
      filePath: options.credentialFilePath ?? join(this.config.appDir, 'credentials.json'),
    });
    const pricingOverrides = createDefaultPricingOverrides();
    this.pricingOverrides = pricingOverrides;
    this.observer = createObserver({ dbPath: join(this.config.appDir, 'observe.db'), pricingOverrides });
    this.runtimeFactory = new AgentRuntimeFactory({
      config: this.config,
      credentials: this.credentials,
      observer: this.observer,
      pricingOverrides: this.pricingOverrides,
      askBridge: () => this.askBridge,
      onStatusChange: (agentId) => this.emitAgentFact(agentId),
      getAgentStatus: (agentId) => this.getAgentStatus(agentId),
      currentModel: (agentId) => this.currentModel(agentId),
      port: () => this.port,
      startTime: this.startTime,
    });
    this.worker = new Worker<AgentEntry>({
      env: this.runtimeFactory.env,
      registryHooks: {
        onDisposeError: (agentId: string, err: unknown) => {
          console.warn(`[agent-manager] disposing agent ${agentId} threw:`, err);
        },
      },
    });
    this.chatHost = new AgentChatHost({
      getRuntime: (agentId) => this.getRuntime(agentId),
      pricingOverrides: () => this.pricingOverrides,
      emitSessionFact: (view) => this.emitSessionFact(view),
    });
    this.teamHost = new TeamHost({
      config: this.config,
      factBus: this.factBus,
      getRuntime: (agentId) => this.getRuntime(agentId),
      getLiveRuntime: (agentId) => this.worker.get(agentId)?.runtime,
      dropAgent: (agentId) => this.dropAgent(agentId),
    });
    this.contextHost = new AgentContextHost({
      config: this.config,
      getRuntime: (agentId) => this.getRuntime(agentId),
    });
    this.fileHost = new AgentFileHost(this.config);
    this.lifecycleHost = new AgentLifecycleHost({
      liveAgentIds: () => this.worker.ids(),
      dropAgent: (agentId) => this.dropAgent(agentId),
      emitAgentFact: (agentId) => this.emitAgentFact(agentId),
      emitSystemFact: () => this.emitSystemFact(),
    });
    this.agentMcpHost = new AgentMcpHost({
      config: this.config,
      mcpManager: this.mcpManager,
      getInstance: (agentId) => this.worker.get(agentId),
      liveAgentIds: () => this.worker.ids(),
      emitAgentFact: (agentId) => this.emitAgentFact(agentId),
    });
    this.reloadHost = new AgentReloadHost({
      config: this.config,
      getInstance: (agentId) => this.worker.get(agentId),
      dropAgent: (agentId) => this.dropAgent(agentId),
      getRuntime: (agentId) => this.getRuntime(agentId),
      emitAgentFact: (agentId) => this.emitAgentFact(agentId),
    });
    this.sessionHost = new AgentSessionHost({
      config: this.config,
      factBus: this.factBus,
      getRuntime: (agentId) => this.getRuntime(agentId),
    });
    // Skill market — browses external sources and installs under globalSkillsDir.
    // Stateless service; safe to construct unconditionally on boot.
    this.skillMarket = new SkillMarketService(this.config.globalSkillsDir());
  }

  /**
   * Install (or replace) the HITL approval bridge. Agents that have
   * already been instantiated keep their current guard — call
   * `reloadAgent(id)` on each active agent to rebuild guards with the
   * new bridge. For the typical boot flow (server up → setAskBridge →
   * first initAgent) this isn't needed.
   */
  setAskBridge(bridge: AskBridge | undefined): void {
    this.askBridge = bridge;
  }

  /** Read the current bridge. Exposed for diagnostics / tests. */
  getAskBridge(): AskBridge | undefined {
    return this.askBridge;
  }

  /**
   * Return the effective safety level for an agent id (after the
   * agent > project > global cascade). Exposed so server endpoints and
   * facts can surface the resolved value in the UI without re-running
   * the resolver themselves.
   */
  resolveSafetyFor(agentId: string): SafetyLevel {
    const entry = this.config.getAgent(agentId);
    if (!entry) return 'default';
    return resolveSafetyLevel(entry.safetyLevel, entry.project, this.config.get().safetyLevel);
  }

  /** Initialize a managed runtime from config. */
  private initRuntime(agentId: string): ManagedAgentRuntime {
    const id = agentId;
    const entry = this.config.getAgent(id);
    if (!entry) throw new Error(`Agent "${id}" not found in config`);

    const mount = this.worker.runAgentSync(
      id,
      entry,
      this.runtimeFactory.specFor(id, entry),
      this.runtimeFactory.hooksFor(id),
    );

    this.agentMcpHost.startAgent(id);

    // Auto-rehydrate team: if this agent has a project and SDK team state
    // names this agent as leader, reopen the team,
    // mount leader tools, and revive every teammate's live runtime facade
    // (via team.rehydrateAll) so the leader's spawn_teammate call doesn't
    // hit "already exists" after a host restart.
    //
    // Rehydrate asynchronously; callers that need the result await
    // waitForTeamRehydrate(agentId). In practice this is small file IO plus
    // teammate runtime re-instantiation.
    if (mount.projectRoot) {
      this.teamHost.rehydrateOnAgentInit(id, mount.runtime, mount.projectRoot);
    }

    // First-time instantiation flips `instantiated: false → true` on the
    // agent's fact. Emit so UIs can drop the "config-only" badge.
    this.emitAgentFact(id);

    return mount.runtime;
  }

  /** Remove an agent from the cache and release its per-agent MCP servers. */
  private async dropAgent(agentId: string): Promise<void> {
    await this.worker.stopAgent(agentId);
    await this.agentMcpHost.releaseAgent(agentId);
  }

  /** Remove an agent from persisted product config and release host runtime state. */
  async removeAgent(agentId: string): Promise<void> {
    await this.dropAgent(agentId);
    this.config.removeAgent(agentId);
    this.factBus.emitAgent(agentId, null);
  }

  getRuntime(agentId: string): ManagedAgentRuntime {
    const instance = this.worker.get(agentId);
    if (instance) return instance.runtime;
    return this.initRuntime(agentId);
  }

  /** Recreate live agent runtimes so init-only wiring such as toolGuard is rebuilt. */
  rebuildLiveAgents(predicate?: (id: string, entry: AgentEntry) => boolean): Promise<void> {
    return this.reloadHost.rebuildLiveAgents(predicate);
  }

  rebuildLiveAgentsForModel(modelId: string): Promise<void> {
    return this.reloadHost.rebuildLiveAgentsForModel(modelId);
  }

  rebuildLiveAgentsForTier(tier: TierId): Promise<void> {
    return this.reloadHost.rebuildLiveAgentsForTier(tier);
  }

  async waitForTeamRehydrate(agentId: string): Promise<void> {
    await this.teamHost.waitForRehydrate(agentId);
  }

  async syncMcpHands(agentId?: string): Promise<void> {
    if (agentId) {
      await this.agentMcpHost.syncAgent(agentId);
      return;
    }

    await Promise.all(this.worker.ids().map((id) => this.agentMcpHost.syncAgent(id)));
  }

  async setSharedMcpEnabled(
    name: string,
    config: MCPServerConfig,
    enabled: boolean,
  ): Promise<MCPServerStatusView> {
    return this.agentMcpHost.setSharedEnabled(name, config, enabled);
  }

  async setAgentMcpEnabled(
    agentId: string,
    name: string,
    config: MCPServerConfig,
    enabled: boolean,
  ): Promise<MCPServerStatusView> {
    return this.agentMcpHost.setAgentEnabled(agentId, name, config, enabled);
  }

  async startTeam(agentId: string, teamName?: string): Promise<TeamState> {
    return this.teamHost.startTeam(agentId, teamName);
  }

  getTeam(agentId: string) {
    return this.teamHost.getTeam(agentId);
  }

  async ensureTeamsLoaded(): Promise<void> {
    for (const { id, entry } of this.config.listAgents()) {
      if (entry.project && !this.isAgentLive(id)) {
        try { this.getRuntime(id); } catch { /* ignore per-agent init failures */ }
      }
    }
    await Promise.all(
      this.config.listAgents().map(({ id }) => this.waitForTeamRehydrate(id)),
    );
  }

  async resolveTeamForAgent(agentId: string) {
    const entry = this.config.getAgent(agentId);
    if (!entry?.project) return null;
    if (!this.isAgentLive(agentId)) {
      try { this.getRuntime(agentId); } catch { return null; }
    }
    await this.waitForTeamRehydrate(agentId);
    return this.getTeam(agentId) ?? null;
  }

  /** Has this agent been instantiated in-memory? (vs. lazy, still just an entry in config). */
  isAgentLive(agentId: string): boolean {
    return this.worker.has(agentId);
  }

  async disbandTeam(agentId: string): Promise<void> {
    await this.teamHost.disbandTeam(agentId);
  }

  /**
   * Hot-reload an agent's configuration. Instead of dropping the cached
   * instance (which would destroy in-memory session state), we mutate the
   * running SDK runtime so the next turn picks up changes.
   *
   * Supports: env prompt, model, reasoning effort, disabledTools. Changes
   * that affect init-only wiring (project/model/safety guard) rebuild.
   */
  reloadAgent(agentId: string): Promise<void> {
    return this.reloadHost.reloadAgent(agentId);
  }

  /**
   * Switch model for an agent.
   *
   * Delegates through the runtime reload host, which resolves the model ref
   * through the host modelResolver (tier/model refs, with failover). Writes the
   * new model back to config so currentModel() and the UI have a single
   * source of truth.
   */
  switchModel(agentId: string, model: string): Promise<void> {
    return this.reloadHost.switchModel(agentId, model);
  }

  // ----- Fact bus helpers -----

  /**
   * Derive + emit an AgentFact for the given id. Call this after any
   * mutation that changes fields visible in AgentFact (model, status,
   * tools, disabledTools, isActive, project, etc.). Idempotent.
   */
  emitAgentFact(agentId: string): void {
    const fact = deriveAgentFact(this, agentId);
    this.factBus.emitAgent(agentId, fact);
  }

  /**
   * Derive + emit a TeamFact for the given leader agent id. Returns early
   * if no team exists for that id. Caller may pass a cached messageCount.
   */
  async emitTeamFact(leaderId: string, messageCount?: number): Promise<void> {
    await this.teamHost.emitTeamFact(leaderId, messageCount);
  }

  /**
   * Derive + emit the singleton SystemFact. Call this after any mutation
   * that changes global infra state visible in SystemFact — currently that
   * means shared-MCP lifecycle events (start, disconnect, shutdown).
   */
  emitSystemFact(): void {
    this.factBus.emitSystem(deriveSystemFact(this));
  }

  /** Emit a SessionFact derived from the SDK-owned session view. */
  emitSessionFact(view: AgentSessionView): void {
    this.sessionHost.emit(view);
  }

  /** Hydrate a SDK session view and emit its fact, if it still exists. */
  async emitSessionFactFor(agentId: string, sessionId: string): Promise<void> {
    await this.sessionHost.emitFor(agentId, sessionId);
  }

  /** Live AgentInstance or undefined — used by fact derivers. */
  getInstance(agentId: string): AgentInstance | undefined {
    return this.worker.get(agentId);
  }

  /** Create a new empty SDK session and return the SDK-owned UI view. */
  async createSession(agentId: string): Promise<AgentSessionView> {
    return this.sessionHost.create(agentId);
  }

  /**
   * Load a persisted SDK session from disk and hydrate a UI view. Claw does
   * not maintain its own message history; messages and events stay in the SDK
   * session directory.
   */
  async loadSessionState(sessionId: string, agentId: string, options?: { eventLimit?: number }): Promise<AgentSessionView | null> {
    return this.sessionHost.load(sessionId, agentId, options);
  }

  /** Persist a human approval request as a SDK-owned session event. */
  async recordApprovalRequest(approval: PendingApproval): Promise<void> {
    await this.sessionHost.recordApprovalRequest(approval);
  }

  /** Persist a human approval answer as a SDK-owned session event. */
  async recordApprovalDecision(approval: PendingApproval, answer: AskAnswer): Promise<void> {
    await this.sessionHost.recordApprovalDecision(approval, answer);
  }

  /** Read SDK session todos for UI side panels. */
  async getSessionTodos(sessionId: string, agentId: string): Promise<import('@berry-agent/core').TodoItem[]> {
    return this.sessionHost.todos(sessionId, agentId);
  }

  async readAgentMemory(agentId: string): Promise<{ path: string; content: string }> {
    return this.contextHost.readMemory(agentId);
  }

  async writeAgentMemory(agentId: string, content: string): Promise<{ path: string; bytes: number }> {
    return this.contextHost.writeMemory(agentId, content);
  }

  async readAgentProjectKnowledge(agentId: string): Promise<{ project: string | null; files: Array<{ path: string; content: string }> }> {
    return this.contextHost.readProjectKnowledge(agentId);
  }

  /** List all persisted sessions for an agent, hydrated for UI. */
  async listSessionStates(agentId: string): Promise<AgentSessionView[]> {
    return this.sessionHost.list(agentId);
  }

  getAgentBrowseRoot(agentId: string): AgentBrowseRoot {
    return this.fileHost.browseRoot(agentId);
  }

  async listAgentFiles(agentId: string, requestPath = ''): Promise<AgentFileList> {
    return this.fileHost.list(agentId, requestPath);
  }

  async readAgentFile(agentId: string, requestPath = ''): Promise<AgentFileContent> {
    return this.fileHost.read(agentId, requestPath);
  }

  /** Delete a session from the SDK-owned session directory. */
  async deleteSession(sessionId: string, agentId: string): Promise<void> {
    await this.sessionHost.delete(sessionId, agentId);
  }

  /**
   * Chat with an agent.
   *
   * `prompt` accepts either a plain string or a ContentBlock[] for
   * multimodal input (text + image blocks). The SDK provider adapters
   * handle wire-format translation. Claw only emits a transient pending
   * user bubble for the frontend; durable messages and event replay live in
   * the SDK-owned session directory.
   */
  async chat(
    prompt: string | ContentBlock[],
    options: {
      agentId: string;
      sessionId?: string;
      requestId?: string;
      onEvent?: (event: AgentEvent) => void;
      onUserMessagePersisted?: (message: AgentChatMessage, sessionId: string) => void;
  },
  ): Promise<{ sessionId: string; userMessage: AgentChatMessage; result: QueryResult; assistantMessage: AgentChatMessage }> {
    return this.chatHost.send(prompt, options);
  }

  /** Force-abort the current turn for an agent. The SDK persists query_end(error). */
  pauseAgent(agentId: string, reason = 'paused by user'): { agentId: string; paused: boolean; status: string; detail?: string } {
    const inst = this.worker.get(agentId);
    if (!inst) {
      return { agentId, paused: false, status: 'idle' };
    }
    const paused = inst.runtime.pause(reason);
    const status = inst.runtime.getStatus();
    this.emitAgentFact(agentId);
    return {
      agentId,
      paused,
      status: status.status,
      detail: status.detail,
    };
  }

  /** Queue a human interjection through the SDK runtime facade. */
  interjectAgent(text: string, agentId: string): { agentId: string; status: string; detail?: string } {
    const runtime = this.getRuntime(agentId);
    runtime.interject(text);
    const status = runtime.getStatus();
    this.emitAgentFact(agentId);
    return { agentId, status: status.status, detail: status.detail };
  }

  /** Introspect an agent */
  inspectAgent(agentId: string): {
    id: string;
    entry: AgentEntry;
    runtime: AgentSnapshot | null;
  } {
    const entry = this.config.getAgent(agentId);
    if (!entry) throw new Error(`Agent "${agentId}" not found`);
    const instance = this.worker.get(agentId);
    return {
      id: agentId,
      entry,
      runtime: instance ? instance.runtime.snapshot() : null,
    };
  }

  /** Structured prompt block registry for inspect/edit UIs. */
  async describePromptBlocks(agentId: string): Promise<PromptBlockInfo[]> {
    return this.contextHost.describePromptBlocks(agentId);
  }

  /** Edit a SDK-owned prompt/context block and return the refreshed block list. */
  async writePromptBlock(agentId: string, blockId: string, content: string): Promise<PromptBlockInfo[]> {
    return this.contextHost.writePromptBlock(agentId, blockId, content);
  }

  /** Status snapshot for an agent, or null if the instance isn't created yet. */
  getAgentStatus(agentId: string): { status: string; detail?: string } | null {
    const inst = this.worker.get(agentId);
    if (!inst) return null;
    const status = inst.runtime.getStatus();
    return { status: status.status, detail: status.detail };
  }

  /**
   * Return the current context token size and window for a session of the
   * given agent. Falls back to default window when no session is active.
   */
  async getAgentContextSize(agentId: string, sessionId?: string): Promise<{ current: number; window: number } | null> {
    return this.getRuntime(agentId).contextSize(sessionId);
  }

  /**
   * Current model info for an agent. We report the model id as seen by the
   * agent's live provider — this may be the upstream remoteModelId after
   * failover, which is exactly what the UI should surface. Null when the
   * agent isn't instantiated yet.
   */
  currentModel(agentId: string): { model: string; providerName: string; type: string } | null {
    const instance = this.worker.get(agentId);
    if (!instance) return null;
    const config = instance.runtime.currentProvider;
    const entry = this.config.getAgent(agentId);
    return {
      model: entry?.model ?? config.model,
      providerName: config.type,
      type: config.type,
    };
  }

  /**
   * Request a restart-like lifecycle action.
   *
   * Default is a safe runtime reload. A bare Node process cannot reliably
   * restart itself; process.exit(0) only works when an external supervisor
   * (pm2/systemd/launchd/docker restart policy) owns the process. In dev,
   * exiting leaves the frontend alive and the backend port closed.
   */
  requestRestart(reason?: string): Promise<{ mode: 'runtime_reload' | 'process_exit'; message: string }> {
    return this.lifecycleHost.requestRestart(reason);
  }

  /** Drop live runtime objects and re-emit facts from persisted file state. */
  reloadRuntime(_reason?: string): Promise<void> {
    return this.lifecycleHost.reloadRuntime();
  }

  async close(): Promise<void> {
    for (const id of this.worker.ids()) {
      await this.dropAgent(id);
    }
    await this.agentMcpHost.close();
    this.observer.close();
  }
}
