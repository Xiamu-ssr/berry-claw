/**
 * Agent Manager — 多 Agent 实例管理
 */
import {
  Agent,
  AgentScope,
  DefaultCredentialStore,
  FileEventLogStore,
  FileSessionStore,
  estimateTokens,
} from '@berry-agent/core';
import type {
  CredentialStore,
  AgentEvent,
  QueryResult,
  ToolRegistration,
  Session,
  ContentBlock,
  ToolUseContent,
  ToolResultContent,
  Middleware,
  AgentSnapshot,
  SessionEvent,
} from '@berry-agent/core';
import type { ChatStep, ChatTimelineEvent, ChatTimelineItem, InferenceInfo, ToolCallInfo } from '@berry-claw/contracts';
import type { AskBridge } from '@berry-agent/safe';
import { buildToolGuard, resolveSafetyLevel, type SafetyLevel } from './safety.js';
import { createBerryTools } from './berry-tools.js';
import type { ModelEntry } from './config-manager.js';
import type { TierId } from '@berry-agent/models';
import { createObserver, createCollector, calculateCost, type Observer, type ModelPricing } from '@berry-agent/observe';
import {
  createAllTools,
  createWebFetchTool,
  createWebSearchTool,
  WEB_SEARCH_CREDENTIAL_KEYS,
  type WebSearchProviderName,
  type ShellToolOptions,
} from '@berry-agent/tools-common';
import { createSandbox, type SandboxConfig } from '@berry-agent/safe';
import type { CommandExecutor } from '@berry-agent/core';
import { ConfigManager, type AgentEntry } from './config-manager.js';
import { SessionManager, type ChatMessage } from './session-manager.js';
import { buildBaseSystemPrompt, listPromptBlocks, type PromptBlockInfo } from './prompt-blocks.js';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createFileMemoryProvider } from '@berry-agent/memory-file';
import { selectProvider } from '@berry-agent/models';
import { Team, type TeamState } from '@berry-agent/team';
import { mkdirSync, existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { FactBus } from '../facts/bus.js';
import { deriveAgentFact, deriveTeamFact, deriveSystemFact } from '../facts/derive.js';
import { MCPManager } from './mcp-manager.js';
import { loadMergedMCPConfig, ensureDefaultAgentMCP } from './mcp-config.js';
import { listInstalledSkillNamesSync, SkillMarketService } from './skill-market.js';

/**
 * Pick a web_search provider based on which credential key is present.
 * Order of preference: Tavily → Brave → SerpAPI.
 */
function pickWebSearchProvider(credentials: CredentialStore): WebSearchProviderName | null {
  const order: WebSearchProviderName[] = ['tavily', 'brave', 'serpapi'];
  for (const provider of order) {
    const key = WEB_SEARCH_CREDENTIAL_KEYS[provider];
    if (credentials.get(key)) return provider;
  }
  return null;
}

function buildWebSearchTool(credentials: CredentialStore): ToolRegistration {
  const provider = pickWebSearchProvider(credentials) ?? 'tavily';
  // When no provider is configured the SDK returns a diagnostic tool.
  return createWebSearchTool({ provider, credentials });
}

/**
 * Build the *full* tool registration list for an agent, honoring only the
 * static `entry.tools` whitelist (tool groups / explicit names). The
 * `disabledTools` soft-toggle is NOT applied here — it is applied via the
 * SDK's instance-level `setAllowedTools()` so tools can be re-enabled at
 * runtime without destroying the Agent instance.
 */
function buildTools(
  scope: import('@berry-agent/core').AgentScope,
  entry: AgentEntry,
  credentials: CredentialStore,
  sandboxEnabled: boolean = true,
): ToolRegistration[] {
  // Build shell options with optional sandbox
  const shellOptions: ShellToolOptions = {};
  if (sandboxEnabled) {
    const sandboxConfig = scope.toSandboxConfig();
    const executor = createSandbox(sandboxConfig);
    if (executor) {
      shellOptions.executor = executor;
      console.log(`[sandbox] Shell commands run inside OS sandbox (platform: ${process.platform})`);
      console.log(`[sandbox] Writable: ${scope.writableRoots.join(', ')}`);
    } else {
      console.warn(`[sandbox] OS sandbox not available on ${process.platform}. Shell commands run unsandboxed.`);
    }
  }

  // Browser automation is provided via MCP (`@playwright/mcp`), not as a
  // built-in tool — see mcp-config.ts default template and MCPManager.
  const tools = [
    ...createAllTools(scope, shellOptions),
    createWebFetchTool(),
    buildWebSearchTool(credentials),
  ];

  if (entry.tools === undefined) return tools;
  // Build group→toolNames index from registered tools, then expand
  // entry.tools (which may contain group names like 'file' or 'shell')
  // into concrete tool names.
  const groupToNames = new Map<string, string[]>();
  for (const tool of tools) {
    const g = tool.definition.group ?? 'other';
    if (!groupToNames.has(g)) groupToNames.set(g, []);
    groupToNames.get(g)!.push(tool.definition.name);
  }
  const allowedToolNames = new Set(
    entry.tools.flatMap((name) => groupToNames.get(name) ?? [name]),
  );
  return tools.filter((tool) => allowedToolNames.has(tool.definition.name));
}

export interface AgentInstance {
  id: string;
  agent: Agent;
  entry: AgentEntry;
}

export interface AgentManagerOptions {
  appDir?: string;
  credentialFilePath?: string;
}

export class AgentManager {
  readonly config: ConfigManager;
  readonly sessions: SessionManager;
  readonly observer: Observer;
  readonly credentials: CredentialStore;
  private agents = new Map<string, AgentInstance>();
  /** Single outbound stream of truth; server WS relays verbatim. */
  readonly factBus = new FactBus();
  /**
   * Per-leader-agent Team instances. Keyed by the *leader* agent id.
   * Populated lazily: either on agent init (if a team.json already exists
   * in the project) or when the user explicitly starts a team for this
   * agent via startTeam().
   */
  private teams = new Map<string, Team>();
  /**
   * In-flight rehydrate promises keyed by leader agent id. initAgent fires
   * team rehydration as async work; callers that need to see the result
   * (notably GET /api/teams on a cold boot) await the promise here.
   */
  private pendingRehydrates = new Map<string, Promise<void>>();
  private activeAgentId: string;
  /** Pricing overrides (built-in + OpenRouter). Mutated at runtime after
   *  OpenRouter fetch so that per-agent collectors see the updated map. */
  pricingOverrides: Record<string, ModelPricing>;
  /**
   * Per-agent observe collectors. Each agent gets its own collector so that
   * agentId is correctly stamped into sessions / turns / llm_calls.
   * The database connection is shared (all collectors write to the same DB).
   */
  private agentCollectors = new Map<string, { middleware: Middleware; eventListener: (event: AgentEvent) => void }>();
  /** Per-agent session stores (FileSessionStore). Kept so we can delete / mutate sessions directly. */
  private agentSessionStores = new Map<string, import('@berry-agent/core').SessionStore>();
  /** Server port (set by startServer after binding). Used by berry_status. */
  port: number = 3210;
  /** Server start timestamp. Used by berry_status to compute uptime. */
  readonly startTime = Date.now();
  /** Whether a restart has been scheduled (idempotent guard). */
  private restartScheduled = false;
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
    this.sessions = new SessionManager();
    this.credentials = new DefaultCredentialStore({
      filePath: options.credentialFilePath ?? join(this.config.appDir, 'credentials.json'),
    });
    // Model name aliases: zenmux proxies use "provider/model" naming, map to standard pricing
    const sonnet4: ModelPricing = { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 };
    const haiku4: ModelPricing = { input: 0.8, output: 4, cacheRead: 0.08, cacheWrite: 1 };
    const opus4: ModelPricing = { input: 15, output: 75, cacheRead: 1.5, cacheWrite: 18.75 };
    const pricingOverrides: Record<string, ModelPricing> = {
      'anthropic/claude-sonnet-4-20250514': sonnet4,
      'anthropic/claude-sonnet-4.6': sonnet4,
      'anthropic/claude-haiku-4-20250414': haiku4,
      'anthropic/claude-haiku-4.5': haiku4,
      'anthropic/claude-opus-4-20250514': opus4,
      'anthropic/claude-opus-4.6': opus4,
    };
    this.pricingOverrides = pricingOverrides;
    this.observer = createObserver({ dbPath: join(this.config.appDir, 'observe.db'), pricingOverrides });
    // Skill market — browses external sources and installs under globalSkillsDir.
    // Stateless service; safe to construct unconditionally on boot.
    this.skillMarket = new SkillMarketService(this.config.globalSkillsDir());
    // Persisted defaultAgent may be empty; fall back to the first configured
    // agent so the app still boots into a usable state after restart.
    this.activeAgentId = this.config.defaultAgent || this.config.listAgents()[0]?.id || '';
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
    return resolveSafetyLevel(entry, entry.project, this.config.get());
  }

  /** Get or create an agent instance by ID */
  getAgent(agentId?: string): Agent {
    const id = agentId ?? this.activeAgentId;
    const existing = this.agents.get(id);
    if (existing) return existing.agent;
    return this.initAgent(id);
  }

  /**
   * Resolve a model spec ('tier:X' / 'model:X' / 'raw:...' / bare id) against
   * the current registry and produce a core-compatible ProviderInput (static
   * config OR resolver w/ failover). Used by every path that sets the agent's
   * provider — init, reload, and switchModel — so failover wiring stays
   * consistent and there's only one rotation log format.
   */
  private buildProviderInput(
    agentId: string,
    spec: string,
  ): import('@berry-agent/core').ProviderInput {
    return selectProvider(spec, this.config.toModelsRegistry(), {
      onRotate: (from, to, err) => {
        console.warn(
          `[agent:${agentId}] provider failover: ${from.providerId} → ${to.providerId}`,
          err,
        );
      },
    });
  }

  /** Initialize an agent from config */
  initAgent(agentId?: string): Agent {
    const id = agentId ?? this.activeAgentId;
    const entry = this.config.getAgent(id);
    if (!entry) throw new Error(`Agent "${id}" not found in config`);

    // Resolve model spec ('tier:X' / 'model:X' / 'raw:...' / bare id) against
    // the registry view of the config, producing either a static ProviderConfig
    // (raw escape hatch) or a ProviderResolver with failover support.
    const providerInput = this.buildProviderInput(id, entry.model);

    const workspace = entry.workspace ?? this.config.agentWorkspace(id);
    if (!existsSync(workspace)) mkdirSync(workspace, { recursive: true });

    // AgentHome centralizes the on-disk layout — berry-claw owns the root
    // (`workspace`), the SDK owns everything below it (sessions/, skills/,
    // .mcp.json, MEMORY.md, AGENTS.md). Every
    // path below comes from `home` so the two sides can't drift.
    const home = this.config.agentHomeFor(workspace);

    // Seed a default per-agent .mcp.json on first init so new agents
    // get playwright-mcp out of the box. No-op when the file exists.
    ensureDefaultAgentMCP(home.mcpConfigPath);

    // The SDK-owned layout is authoritative: each session lives at
    // `<workspace>/sessions/<sid>/messages.json` plus `events.jsonl`.
    // Claw reads only the current SDK session files.
    const sessionsDir = home.sessionsDir;
    if (!existsSync(sessionsDir)) mkdirSync(sessionsDir, { recursive: true });

    // Per-agent skill pool. Auto-created even when empty so tools that
    // enumerate it (future `create_skill`) don't have to race the first
    // write. One-level scan in both the SDK and in
    // `listInstalledSkillNamesSync` means a sibling `drafts/` subtree (for
    // pending auto-generated skills) is naturally invisible to the agent
    // until an entry is promoted out of it.
    const perAgentSkillsDir = home.skillsDir;
    if (!existsSync(perAgentSkillsDir)) mkdirSync(perAgentSkillsDir, { recursive: true });

    // Resolve project root early so it is available for system prompt injection.
    const projectRoot = entry.project;
    if (projectRoot) {
      if (!existsSync(projectRoot)) mkdirSync(projectRoot, { recursive: true });
      // Ensure project/.berry/ exists for worklist/team-shared data.
      const berryDir = join(projectRoot, '.berry');
      if (!existsSync(berryDir)) mkdirSync(berryDir, { recursive: true });
    }

    // Build scope — single source of truth for agent's writable paths
    const scope = new AgentScope(workspace, projectRoot);

    // Build tools based on scope
    const tools = buildTools(scope, entry, this.credentials);

    // Memory provider: FTS5-backed search over
    //   - {workspace}/MEMORY.md + memory/*.md  (personal)
    //   - {project}/AGENTS.md  (shared, if the agent is bound to a project)
    // Teammates on the same project all point at the same projectDir, so
    const memoryProvider = createFileMemoryProvider({
      workspaceDir: workspace,
      projectDir: projectRoot,
    });
    // sync() builds the FTS index; fire-and-forget is fine — it uses sync IO internally
    // and finishes near-instantly. The first search call will hit a warm index.
    memoryProvider.sync().catch(() => {/* best-effort */});

    // Compose the toolGuard chain from the effective safety mode.
    // Cascade: agent > project > global > 'default' (see ./safety.ts).
    // writeScopeGuard, denyList, and optional HITL are stacked by buildToolGuard.
    const safetyLevel = resolveSafetyLevel(entry, projectRoot, this.config.get());
    const toolGuard = buildToolGuard(safetyLevel, {
      scope,
      askBridge: this.askBridge,
      agentId: id,
    });

    // Per-agent observe collector: each agent gets its own collector so that
    // agentId is correctly stamped into sessions / turns / llm_calls. The DB
    // connection is shared (same file), but the mutable state (currentSessionId,
    // currentTurnId, pendingApiCalls, etc.) is isolated per agent.
    const collector = createCollector({
      db: this.observer.db,
      pricingOverrides: this.pricingOverrides,
      agentId: id,
    });
    this.agentCollectors.set(id, collector);
    const store = new FileSessionStore(sessionsDir);
    this.agentSessionStores.set(id, store);

    // Compose skill inputs: per-agent pool first (wins on name collision
    // after the SDK's first-wins dedup), then user-configured custom
    // skillDirs (trusted as-is — these are absolute paths the user set
    // intentionally), then the global market pool.
    //
    // Visibility gated by `enabledSkills` whitelist for BOTH the per-agent
    // and global pools: anything installed there but not explicitly enabled
    // ends up on disabledSkills. This is what keeps self-authored skills
    // from auto-activating the moment they land on disk — the user still
    // has to check the box in Agents Tab.
    const globalSkillsDir = this.config.globalSkillsDir();
    const builtinSkillsDir = this.config.builtinSkillsDir();
    const enabledSet = new Set(entry.enabledSkills ?? []);
    const installedGlobal = listInstalledSkillNamesSync(globalSkillsDir);
    const installedPerAgent = listInstalledSkillNamesSync(perAgentSkillsDir);
    const marketBlacklist = installedGlobal.filter(n => !enabledSet.has(n));
    const perAgentBlacklist = installedPerAgent.filter(n => !enabledSet.has(n));
    // Each entry carries default provenance so skills without explicit
    // frontmatter get attributed correctly at load time:
    //   - per-agent pool → defaultSource 'per-agent' + the authoring agent id
    //   - user-configured custom dirs → left bare (user-specified, no
    //     opinion about source); skills there can self-declare via frontmatter
    //   - user-writable global pool → defaultSource 'global'
    //   - builtin (ships inside the package) → defaultSource 'global',
    //     read-only — lives last so a user-written override at the writable
    //     global path wins the SDK's first-match dedup.
    const composedSkillDirs = [
      { dir: perAgentSkillsDir, defaultSource: 'per-agent' as const, defaultAuthorAgent: id },
      ...(entry.skillDirs ?? []),
      { dir: globalSkillsDir, defaultSource: 'global' as const },
      { dir: builtinSkillsDir, defaultSource: 'global' as const },
    ];
    const composedDisabledSkills = [
      ...marketBlacklist,
      ...perAgentBlacklist,
      ...(entry.disabledSkills ?? []),
    ];

    const agent = new Agent({
      provider: providerInput,
      model: entry.model,
      reasoningEffort: entry.reasoningEffort,
      promptPack: entry.promptPack,
      promptPackDir: this.config.promptPacksDir(),
      modelResolver: (modelRef) => this.buildProviderInput(id, modelRef),
      tools,
      cwd: projectRoot ?? workspace,
      home,
      project: projectRoot,
      memory: memoryProvider,
      skillDirs: composedSkillDirs,
      disabledSkills: composedDisabledSkills,
      sessionStore: store,
      toolGuard,
      middleware: [collector.middleware],
      onEvent: (event) => {
        collector.eventListener(event);
        // Status changes are high-signal UI updates — flow them through
        // the FactBus so every subscriber (AgentsPage / ChatHeader / etc.)
        // refreshes off the same event.
        if (event.type === 'status_change') {
          this.emitAgentFact(id);
        }
      },
    });
    agent.setSystemPrompt(buildBaseSystemPrompt(entry, workspace));

    // Apply initial disabledTools via SDK instance-level deny-list.
    agent.setToolDenylist(entry.disabledTools ?? []);

    // Mount berry system management tools (berry_status, berry_restart, berry_config)
    const berryTools = createBerryTools({
      getActiveAgentId: () => this.activeAgentId,
      getAgentStatus: (id) => this.getAgentStatus(id),
      currentModel: () => this.currentModel(),
      listAgents: () => this.config.listAgents(),
      getTiers: () => this.config.getTiers(),
      listProviderInstances: () => this.config.listProviderInstances(),
      listModels: () => this.config.listModels(),
      getAgent: (id) => this.config.getAgent(id),
      setModel: (id, entry) => { this.config.setModel(id, entry as unknown as ModelEntry); try { this.reloadAgent(id); } catch { /* agent may not be running */ } },
      setTier: (tier, modelId) => this.config.setTier(tier as TierId, modelId),
      reloadAgent: (id) => this.reloadAgent(id),
      scheduleRestart: (reason) => this.scheduleRestart(reason),
      port: this.port,
      startTime: this.startTime,
    });
    for (const tool of berryTools) {
      agent.addTool(tool);
    }

    this.agents.set(id, { id, agent, entry });

    // Fire-and-forget MCP server initialization: per-agent MCP tools are
    // mounted asynchronously via agent.addTool(). This keeps initAgent sync
    // while allowing MCP connections (which involve sub-process spawning and
    // HTTP handshakes) to resolve on their own schedule. The agent is usable
    // immediately — MCP tools appear as they connect.
    this.startAgentMCP(id).catch((err) => {
      console.error(`[agent:${id}] MCP initialization failed:`, err instanceof Error ? err.message : err);
    });

    // Auto-rehydrate team: if this agent has a project and the project
    // already has a team.json naming this agent as leader, reopen the team,
    // mount leader tools, and revive every teammate's live Agent instance
    // (via team.rehydrateAll) so the leader's spawn_teammate call doesn't
    // hit "already exists" after a host restart.
    //
    // Intentionally synchronous (awaited) despite initAgent being a sync
    // method — so we block the first getAgent() call until the team is up.
    // Callers that awaited getAgent() via a microtask see a fully-wired
    // team. In practice this is IO: a readFile + spawns, <10ms on dev boxes.
    if (projectRoot) {
      try {
        this.tryRehydrateTeamSync(id, agent, projectRoot);
      } catch (err) {
        console.warn(`[agent:${id}] team rehydrate failed:`, err);
      }
    }

    // First-time instantiation flips `instantiated: false → true` on the
    // agent's fact. Emit so UIs can drop the "config-only" badge.
    this.emitAgentFact(id);

    return agent;
  }

  /**
   * Start per-agent MCP servers and mount their tools.
   * Called as fire-and-forget from initAgent — the agent is usable
   * immediately, MCP tools are added as they connect.
   *
   * Config source is the 3-layer .mcp.json cascade:
   *   global  = ~/.berry-claw/.mcp.json
   *   project = <entry.project>/.mcp.json   (if bound to a project)
   *   agent   = <entry.workspace>/.mcp.json
   * Later layers override earlier ones field-by-field. Only servers
   * with shared=false reach this per-agent start path.
   */
  private async startAgentMCP(agentId: string): Promise<void> {
    const instance = this.agents.get(agentId);
    if (!instance) return;
    const entry = instance.entry;
    const workspace = entry.workspace ?? this.config.agentWorkspace(agentId);

    const mcpConfigs = loadMergedMCPConfig({
      globalPath: this.config.globalMCPPath(),
      projectPath: entry.project ? this.config.projectMCPPath(entry.project) : undefined,
      agentPath: this.config.agentMCPPath(workspace),
    });
    if (Object.keys(mcpConfigs).length === 0) return;

    const mcpTools = await this.mcpManager.startAgentServers(agentId, mcpConfigs);
    for (const tool of mcpTools) {
      instance.agent.addTool(tool);
    }

    // Re-apply disabledTools now that MCP tools are registered.
    instance.agent.setToolDenylist(entry.disabledTools ?? []);

    this.emitAgentFact(agentId);
  }

  /** Remove an agent from the cache and release its per-agent MCP servers. */
  private dropAgent(agentId: string): void {
    this.agents.delete(agentId);
    // Fire-and-forget: per-agent MCP servers are released asynchronously
    this.mcpManager.releaseAgent(agentId).catch((err) => {
      console.error(`[agent:${agentId}] MCP release failed:`, err instanceof Error ? err.message : err);
    });
  }

  /**
   * Synchronous wrapper around tryRehydrateTeam. It still has to await
   * TeamStore.load(), but we block by awaiting at call sites that are
   * sync-available (initAgent isn't sync anymore — see below). Keeping the
   * public method async and having callers await is the cleaner fix; we
   * use this helper name for clarity and leave the real async wait on a
   * single awaiting caller.
   */
  private tryRehydrateTeamSync(agentId: string, agent: Agent, project: string): void {
    // Delegate to the async version; store the promise on a per-id map so
    // callers can await `waitForTeamRehydrate(agentId)` if they need the
    // result immediately. The /api/teams endpoint does this.
    const p = this.tryRehydrateTeam(agentId, agent, project).catch((err) => {
      console.warn(`[agent:${agentId}] team rehydrate failed:`, err);
    });
    this.pendingRehydrates.set(agentId, p);
  }

  /** Resolves when the team for `agentId` has finished rehydrating (or immediately if none pending). */
  async waitForTeamRehydrate(agentId: string): Promise<void> {
    const p = this.pendingRehydrates.get(agentId);
    if (p) await p;
  }

  /**
   * Attempt to reopen an existing team for this agent on startup. A no-op
   * when no <project>/.berry/team.json exists yet. Mounts leader tools on
   * success. Implementation detail: we check for the file directly instead
   * of calling Team.open() (which would auto-create), because auto-creating
   * a team for every project-bound agent would silently turn everyone into
   * a solo leader.
   */
  private async tryRehydrateTeam(agentId: string, agent: Agent, project: string): Promise<void> {
    if (this.teams.has(agentId)) return;
    const teamFile = join(project, '.berry', 'team.json');
    if (!existsSync(teamFile)) return;
    // Only the team's leader should rehydrate here. Non-leader agents that
    // happen to share the same project root would otherwise hit Team.open's
    // leaderId sanity check and throw — teammates instead get revived via
    // the leader's `team.rehydrateAll()` call a few lines below.
    try {
      const raw = JSON.parse(await readFile(teamFile, 'utf-8')) as { leaderId?: string };
      if (raw.leaderId && raw.leaderId !== agentId) return;
    } catch {
      // Corrupt / unreadable — fall through so Team.open surfaces the real error.
    }
    const team = await Team.open({
      leaderId: agentId,
      leader: agent,
      project,
      ...this.teamHooks(agentId, project),
    });
    this.mountLeaderTools(agent, team);
    // Revive live teammate Agent instances from the persisted roster so the
    // leader's spawn_teammate / message_teammate calls work after a host
    // restart without the leader having to "already exists" dance.
    const revived = team.rehydrateAll();
    if (revived.length > 0) {
      console.log(`[team:${agentId}] rehydrated ${revived.length} teammate(s): ${revived.join(', ')}`);
    }
    this.teams.set(agentId, team);
  }

  private mountLeaderTools(agent: Agent, team: Team): void {
    for (const tool of team.leaderTools()) {
      agent.addTool(tool);
    }
  }

  /**
   * Explicitly start a team for the given agent (must have a project).
   * Idempotent — if a team already exists, returns the current state and
   * mounts the leader tools if not already mounted.
   */
  async startTeam(agentId: string, teamName?: string): Promise<TeamState> {
    const entry = this.config.getAgent(agentId);
    if (!entry) throw new Error(`Agent "${agentId}" not found`);
    if (!entry.project) {
      throw new Error(`Agent "${agentId}" has no project. Bind the agent to a project before starting a team.`);
    }
    const agent = this.getAgent(agentId);
    let team = this.teams.get(agentId);
    if (!team) {
      team = await Team.open({
        leaderId: agentId,
        leader: agent,
        project: entry.project,
        name: teamName,
        ...this.teamHooks(agentId, entry.project),
      });
      this.teams.set(agentId, team);
      this.mountLeaderTools(agent, team);
    }
    await this.emitTeamFact(agentId);
    return team.state;
  }

  /**
   * Build the Team hooks (agentFactory / onDisband / agentLookup /
   * availableTiers) for a given leader + project. Factored out because
   * both startTeam and tryRehydrateTeam need the same set.
   */
  private teamHooks(leaderId: string, _project: string) {
    return {
      agentFactory: async (spec: Parameters<NonNullable<Parameters<typeof Team.open>[0]['agentFactory']>>[0]) => {
        return this.createTeammateAgent(spec);
      },
      onDisband: async (teammateId: string) => {
        // Remove the teammate's AgentEntry from the registry. Leaves the
        // session log on disk (kept for audit). The dead in-memory Agent
        // instance is dropped so memory doesn't leak.
        this.dropAgent(teammateId);
        try { this.config.removeAgent(teammateId); } catch { /* already gone */ }
        // Teammate vanished → emit deletion + refresh team fact so the
        // UI drops the card and re-renders the teammate list in one pass.
        this.factBus.emitAgent(teammateId, null);
        this.emitTeamFact(leaderId).catch(() => {});
      },
      agentLookup: (teammateId: string): Agent | undefined => {
        // The host's view of this agent: if it's live in memory, return it;
        // otherwise try to wake it lazily via getAgent(). We ignore errors
        // so Team.rehydrateAll can skip broken entries gracefully.
        if (!this.config.getAgent(teammateId)) return undefined;
        if (this.agents.has(teammateId)) return this.agents.get(teammateId)?.agent;
        try { return this.getAgent(teammateId); } catch { return undefined; }
      },
      availableTiers: (): string[] => {
        return Object.keys(this.config.getTiers());
      },
    };
  }

  /**
   * Create a first-class teammate agent. Implementation of the Team
   * `agentFactory` hook. Writes an AgentEntry with team metadata, then
   * kicks off initAgent to get a live Agent instance.
   *
   * v1.2: teammates are regular agents. They live in config.json,
   * show up in the Agents tab, and have their own session store under
   * ~/.berry-claw/agents/<teammate-id>/. The only distinguishing mark is
   * `entry.team = { leaderId, role }`.
   */
  private async createTeammateAgent(spec: {
    id: string;
    role: string;
    systemPrompt: string;
    tier?: string;
    model?: string;
    inheritTools?: boolean;
    project: string;
    leaderId: string;
  }): Promise<Agent> {
    if (this.config.getAgent(spec.id)) {
      throw new Error(`Agent id "${spec.id}" already exists in the registry. Pick a different teammate id.`);
    }
    // Pick the model reference. `tier:<name>` is the preferred form; it
    // stays stable as models get swapped. Fall back to explicit model, and
    // finally to the leader's model so the teammate at least runs.
    let modelRef: string;
    if (spec.tier) {
      modelRef = `tier:${spec.tier}`;
    } else if (spec.model) {
      modelRef = spec.model;
    } else {
      const leaderEntry = this.config.getAgent(spec.leaderId);
      modelRef = leaderEntry?.model ?? Object.values(this.config.getTiers())[0] ?? 'claude-opus-4.7';
    }

    const entry: AgentEntry = {
      name: spec.role,
      model: modelRef,
      project: spec.project,
      team: { leaderId: spec.leaderId, role: spec.role },
    };
    this.config.setAgent(spec.id, entry);
    const workspace = this.config.agentWorkspace(spec.id);
    const home = this.config.agentHomeFor(workspace);
    await writeFile(home.agentMdPath, spec.systemPrompt, 'utf-8');
    // initAgent below will create the agent instance lazily; getAgent is
    // the happy path because it returns the cached instance on subsequent
    // calls (and initAgent under the hood if missing).
    return this.getAgent(spec.id);
  }

  /** Get the team this agent leads (if any). */
  getTeam(agentId: string): Team | undefined {
    return this.teams.get(agentId);
  }

  /** Has this agent been instantiated in-memory? (vs. lazy, still just an entry in config). */
  isAgentLive(agentId: string): boolean {
    return this.agents.has(agentId);
  }

  /**
   * Disband a team: disband each teammate, delete team.json + messages.jsonl
   * + worklist.json, drop from the teams registry. The leader Agent is
   * kept; its tools are NOT removed (v1: SDK has no removeTool). Next full
   * agent re-init (e.g. hot reload of project binding) will rebuild without
   * the team tools.
   *
   * The .berry/ directory itself is left in place — it may contain other
   * project artifacts (future: skills, config) that aren't team-owned.
   */
  async disbandTeam(agentId: string): Promise<void> {
    const team = this.teams.get(agentId);
    if (!team) throw new Error(`No team for agent "${agentId}".`);
    // Disband each teammate sequentially so state.save() stays consistent.
    const ids = team.state.teammates.map((t) => t.id);
    for (const id of ids) {
      await team.disbandTeammate(id);
    }
    // Delete team + message + worklist files on disk.
    const berry = join(team.state.project, '.berry');
    for (const f of ['team.json', 'messages.jsonl', 'worklist.json']) {
      const p = join(berry, f);
      if (existsSync(p)) {
        try { (await import('node:fs/promises')).unlink(p); } catch { /* best effort */ }
      }
    }
    this.teams.delete(agentId);
    this.factBus.emitTeam(agentId, null);
  }

  /**
   * Hot-reload an agent's configuration. Instead of dropping the cached
   * instance (which would destroy in-memory session state), we mutate the
   * running Agent via SDK hot-reload API so the next turn picks up changes.
   *
   * Supports: env prompt, model, allowedTools (via disabledTools in entry).
   */
  reloadAgent(agentId: string): void {
    const cached = this.agents.get(agentId);
    const entry = this.config.getAgent(agentId);
    if (!entry) {
      this.dropAgent(agentId);
      this.emitAgentFact(agentId); // emits null → deletion
      return;
    }
    if (!cached) {
      this.emitAgentFact(agentId); // config-only edit still updates AgentFact
      return;
    }

    // 0. Project change forces a rebuild. Project root affects cwd, scope
    // guard, projectContext (which injects AGENTS.md into system prompt),
    // and the .berry/ directory — none of which are hot-swappable. Drop the
    // cached instance so the next getAgent() re-runs initAgent() fresh.
    if (
      (entry.project ?? null) !== (cached.entry.project ?? null) ||
      (entry.promptPack ?? null) !== (cached.entry.promptPack ?? null)
    ) {
      this.dropAgent(agentId);
      this.emitAgentFact(agentId);
      return;
    }

    // 1. Runtime base prompt — keep the host-owned env block in memory.
    //    Agent behavior text itself lives in <workspace>/AGENTS.md and is
    //    re-read by the SDK at query time.
    const workspace = cached.entry.workspace ?? this.config.agentWorkspace(agentId);
    const fullPrompt = buildBaseSystemPrompt(entry, workspace);
    cached.agent.setSystemPrompt(fullPrompt);

    // 2. Model (if changed) — switchModel resolves the ref through the
    //    host modelResolver, drops any stale resolver, and persists to agent.json.
    //    The "config.json is the single source of truth" rule holds: next
    //    inference sees exactly what the user asked for, no silent rollback.
    try {
      if (entry.model && entry.model !== cached.entry.model) {
        cached.agent.switchModel(entry.model);
      }
    } catch (err) {
      console.warn(`[reload] model switch failed for ${agentId}:`, err);
    }

    // 2.5 Reasoning effort (if changed) — setLevel drops any attached
    // resolver; failover will resume when the user next changes the model
    // (which rebuilds a fresh resolver via switchModel + modelResolver).
    if (entry.reasoningEffort !== cached.entry.reasoningEffort) {
      cached.agent.setReasoningEffort(entry.reasoningEffort as 'none' | 'low' | 'medium' | 'high' | 'max' | 'xhigh');
    }

    // 3. Disabled tools are owned by the SDK's instance-level deny-list.
    cached.agent.setToolDenylist(entry.disabledTools ?? []);

    // 4. Refresh stored entry snapshot so subsequent reads see latest config
    cached.entry = entry;

    this.emitAgentFact(agentId);
  }

  /** Switch active agent */
  switchAgent(agentId: string): void {
    const entry = this.config.getAgent(agentId);
    if (!entry) throw new Error(`Agent "${agentId}" not found`);
    const prevActive = this.activeAgentId;
    this.activeAgentId = agentId;
    // Persist selection so restart doesn't drop the active agent/session list.
    this.config.update({ defaultAgent: agentId });
    // Both the previous active and the new active agent change their
    // isActive field — emit facts for both so the UI toggles in a
    // single round-trip.
    if (prevActive && prevActive !== agentId) this.emitAgentFact(prevActive);
    this.emitAgentFact(agentId);
  }

  /**
   * Switch model for the current agent.
   *
   * Delegates to Agent.switchModel() which resolves the model ref through
   * the host modelResolver (tier/model/raw spec, with failover). Writes the
   * new model back to config so currentModel() and the UI have a single
   * source of truth.
   */
  switchModel(model: string): void {
    // Agent.switchModel resolves the ref via the host modelResolver, drops any stale
    // resolver, and persists to agent.json — single source of truth.
    this.getAgent().switchModel(model);

    // Persist the model choice so the UI and currentModel() agree.
    const entry = this.config.getAgent(this.activeAgentId);
    if (entry) {
      entry.model = model;
      this.config.setAgent(this.activeAgentId, entry);
      this.config.save();
      // Update the in-memory snapshot so getAgent() / currentModel() see it
      const cached = this.agents.get(this.activeAgentId);
      if (cached) cached.entry = entry;
    }
    this.emitAgentFact(this.activeAgentId);
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
    const team = this.teams.get(leaderId);
    if (!team) {
      this.factBus.emitTeam(leaderId, null);
      return;
    }
    const fact = await deriveTeamFact(team, { messageCount });
    this.factBus.emitTeam(leaderId, fact);
  }

  /**
   * Derive + emit the singleton SystemFact. Call this after any mutation
   * that changes global infra state visible in SystemFact — currently that
   * means shared-MCP lifecycle events (start, disconnect, shutdown).
   */
  emitSystemFact(): void {
    this.factBus.emitSystem(deriveSystemFact(this));
  }

  /** Live AgentInstance or undefined — used by fact derivers. */
  getInstance(agentId: string): AgentInstance | undefined {
    return this.agents.get(agentId);
  }

  /** Create a new empty SDK session and sync it into SessionManager. */
  async createSession(agentId?: string): Promise<import('./session-manager.js').SessionState> {
    const id = agentId ?? this.activeAgentId;
    const agent = this.getAgent(id);
    const sdkSession = await agent.createSession();
    const state = hydrateSessionState(sdkSession, id);
    this.sessions.upsertState(state);
    this.sessions.switchSession(sdkSession.id);
    return state;
  }

  /**
   * Clear the oldest/current session for an agent.
   * Empties message history AND clears the event log so resume won't rebuild
   * old messages. Keeps the same session id.
   */
  async clearSession(agentId?: string): Promise<string> {
    const id = agentId ?? this.activeAgentId;
    const agent = this.getAgent(id);
    const store = this.agentSessionStores.get(id);
    const existingIds = await agent.listSessions();
    let sessionId: string;

    if (existingIds.length > 0) {
      sessionId = existingIds[0];
      // Clear both the event log and session store — true empty-session reset.
      await agent.clearSession(sessionId);
    } else {
      const created = await agent.createSession();
      sessionId = created.id;
    }

    // Re-hydrate UI state with empty messages
    const fresh = await agent.getSession(sessionId);
    const state = hydrateSessionState(
      fresh ?? { id: sessionId, messages: [], createdAt: Date.now(), lastAccessedAt: Date.now(), metadata: { totalInputTokens: 0, totalOutputTokens: 0, totalCacheReadTokens: 0, totalCacheWriteTokens: 0, compactionCount: 0 } },
      id,
    );
    this.sessions.upsertState(state);
    this.sessions.switchSession(sessionId);
    return sessionId;
  }

  /**
   * Load a persisted SDK session from disk and hydrate berry-claw's richer UI
   * session state cache. This makes sessions survive server restarts instead of
   * living only in SessionManager's in-memory map.
   */
  async loadSessionState(sessionId: string, agentId?: string): Promise<import('./session-manager.js').SessionState | null> {
    const cached = this.sessions.getState(sessionId);

    const targetId = agentId ?? this.activeAgentId;
    if (!targetId || !this.config.getAgent(targetId)) return cached;

    const agent = this.getAgent(targetId);
    const session = await agent.getSession(sessionId);
    if (!session) return cached;

    const eventLog = new FileEventLogStore(agent.home.sessionsDir);
    const events = await eventLog.getEvents(sessionId);
    const state = hydrateSessionState(session, agentId ?? this.activeAgentId, events);
    this.sessions.upsertState(state);
    return state;
  }

  /** Read SDK session todos for UI side panels. */
  async getSessionTodos(sessionId: string, agentId?: string): Promise<import('@berry-agent/core').TodoItem[]> {
    const state = await this.loadSessionState(sessionId, agentId);
    const targetId = agentId ?? state?.agentId ?? this.activeAgentId;
    if (!targetId || !this.config.getAgent(targetId)) return [];
    const agent = this.getAgent(targetId);
    return agent.getTodos(sessionId);
  }

  /** List all persisted sessions for an agent, hydrated for UI.
   *  When agentId is omitted, uses the active agent. */
  async listSessionStates(agentId?: string): Promise<import('./session-manager.js').SessionState[]> {
    const targetId = agentId ?? this.activeAgentId;
    if (!targetId || !this.config.getAgent(targetId)) {
      return this.sessions.listSessions();
    }

    const agent = this.getAgent(targetId);
    const ids = await agent.listSessions();
    for (const id of ids) {
      await this.loadSessionState(id, targetId);
    }
    return this.sessions.listSessions().filter((s) => s.agentId === targetId);
  }

  /**
   * Chat with active agent.
   *
   * `prompt` accepts either a plain string or a ContentBlock[] for
   * multimodal input (text + image blocks). The SDK provider adapters
   * handle wire-format translation; all we do here is pass through +
   * persist a string-only preview into session.messages (the full
   * content lives on the SDK's Message objects / event log).
   */
  async chat(
    prompt: string | import('@berry-agent/core').ContentBlock[],
    options?: {
      sessionId?: string;
      agentId?: string;
      requestId?: string;
      onEvent?: (event: AgentEvent) => void;
      onUserMessagePersisted?: (message: ChatMessage, sessionId: string) => void;
    },
  ): Promise<{ sessionId: string; userMessage: ChatMessage; result: QueryResult; assistantMessage: ChatMessage }> {
    const agent = this.getAgent(options?.agentId);
    let sessionId = options?.sessionId ?? this.sessions.currentSessionId;

    if (sessionId) {
      const existing = this.sessions.getState(sessionId) ?? await this.loadSessionState(sessionId, options?.agentId);
      if (!existing) throw new Error(`Session not found: ${sessionId}`);
      this.sessions.switchSession(sessionId);
    } else {
      const targetId = options?.agentId ?? this.activeAgentId;
      const created = await agent.createSession();
      sessionId = created.id;
      this.sessions.upsertState(hydrateSessionState(created, targetId));
    }

    const userMessage = this.sessions.addUserMessage(sessionId, prompt, {
      status: 'pending',
      delivery: 'turn',
      requestId: options?.requestId,
    });
    options?.onUserMessagePersisted?.(userMessage, sessionId);

    const toolCalls: ChatMessage['toolCalls'] = [];
    let streamText = '';
    let thinkingText = '';
    const inferences: import('./session-manager.js').InferenceInfo[] = [];

    try {
      const result = await agent.send(prompt, {
        resume: sessionId,
        stream: true,
        onEvent: (event: AgentEvent) => {
          if (event.type === 'api_response') {
            const cost = calculateCost(
              event.model,
              event.usage.inputTokens,
              event.usage.outputTokens,
              event.usage.cacheReadTokens ?? 0,
              event.usage.cacheWriteTokens ?? 0,
              this.pricingOverrides,
            );
            inferences.push({
              model: event.model,
              inputTokens: event.usage.inputTokens,
              outputTokens: event.usage.outputTokens,
              cacheWriteTokens: event.usage.cacheWriteTokens,
              cacheReadTokens: event.usage.cacheReadTokens,
              stopReason: event.stopReason,
              cost: cost.totalCost,
            });
            options?.onEvent?.({ ...event, cost: cost.totalCost } as any);
          } else {
            options?.onEvent?.(event);
            if (event.type === 'text_delta') streamText += event.text;
            else if (event.type === 'thinking_delta') thinkingText += event.thinking;
            else if (event.type === 'tool_call') toolCalls.push({ name: event.name, input: event.input, toolUseId: event.toolUseId });
            else if (event.type === 'tool_result') {
              const match = [...toolCalls].reverse().find(t =>
                (event.toolUseId && t.toolUseId === event.toolUseId) ||
                (!event.toolUseId && t.name === event.name && t.isError === undefined),
              );
              if (match) {
                match.isError = event.isError;
                match.result = event.output;
              }
            }
          }
        },
      });

      this.sessions.updateMessage(sessionId, userMessage.id, { status: 'completed' });
      const assistantMessage = this.sessions.addAssistantMessage(
        result.sessionId,
        result.text,
        toolCalls.length > 0 ? toolCalls : undefined,
        { inputTokens: result.usage.inputTokens, outputTokens: result.usage.outputTokens },
        thinkingText || undefined,
        inferences,
        { status: 'completed', delivery: 'turn', requestId: options?.requestId },
      );

      return { sessionId, userMessage, result, assistantMessage };
    } catch (err) {
      this.sessions.updateMessage(sessionId, userMessage.id, { status: 'failed' });
      throw err;
    }
  }

  /** Introspect an agent */
  inspectAgent(agentId?: string): {
    id: string;
    entry: AgentEntry;
    runtime: AgentSnapshot | null;
  } {
    const id = agentId ?? this.activeAgentId;
    const entry = this.config.getAgent(id);
    if (!entry) throw new Error(`Agent "${id}" not found`);
    const instance = this.agents.get(id);
    return {
      id,
      entry,
      runtime: instance ? instance.agent.snapshot() : null,
    };
  }

  /** Structured prompt block registry for inspect/edit UIs. */
  async describePromptBlocks(agentId?: string): Promise<PromptBlockInfo[]> {
    const id = agentId ?? this.activeAgentId;
    const entry = this.config.getAgent(id);
    if (!entry) throw new Error(`Agent "${id}" not found`);
    const runtime = this.agents.get(id)?.agent.snapshot() ?? null;
    const workspace = entry.workspace ?? this.config.agentWorkspace(id);
    return listPromptBlocks({
      agentId: id,
      entry,
      workspace,
      runtimeSkills: runtime?.skills ?? [],
    });
  }

  /** Status snapshot for an agent, or null if the instance isn't created yet. */
  getAgentStatus(agentId: string): { status: string; detail?: string } | null {
    const inst = this.agents.get(agentId);
    if (!inst) return null;
    return { status: inst.agent.status, detail: inst.agent.statusDetail };
  }

  /**
   * Return the current context token size and window for the active session
   * of the given agent. Falls back to 0 / default window when no session is
   * active or the agent isn't instantiated yet.
   */
  async getAgentContextSize(agentId?: string, sessionId?: string): Promise<{ current: number; window: number } | null> {
    const id = agentId ?? this.activeAgentId;
    const instance = this.agents.get(id);
    if (!instance) return null;
    const ctxWindow = instance.agent.snapshot().compaction?.contextWindow ?? 200_000;
    const targetSessionId = sessionId ?? this.sessions.currentSessionId;
    if (!targetSessionId) return { current: 0, window: ctxWindow };
    const session = await instance.agent.getSession(targetSessionId);
    if (!session) return { current: 0, window: ctxWindow };
    // Use API-returned full input tokens (system+tools+messages) as ground truth.
    // Fall back to message-only estimate when no API call has happened yet.
    const current = session.metadata.lastInputTokens ?? estimateTokens(session.messages);
    return { current, window: ctxWindow };
  }

  /**
   * Current model info for the active agent. We report the model id as seen
   * by the agent's live provider — this may be the upstream remoteModelId
   * after failover, which is exactly what the UI should surface.
   */
  currentModel(): { model: string; providerName: string; type: string } | null {
    const instance = this.agents.get(this.activeAgentId);
    if (!instance) return null;
    const config = instance.agent.currentProvider;
    const entry = this.config.getAgent(this.activeAgentId);
    // Best-effort: prefer the agent entry's model spec for display purposes;
    // fall back to the raw model id coming out of the provider.
    return {
      model: entry?.model ?? config.model,
      providerName: config.type,
      type: config.type,
    };
  }

  get activeAgent(): string { return this.activeAgentId; }

  /**
   * Schedule a graceful server restart. Sets a flag and calls process.exit(0)
   * after a 500ms delay so the current turn can complete. Idempotent —
   * calling multiple times is safe.
   */
  scheduleRestart(reason?: string): void {
    if (this.restartScheduled) return;
    this.restartScheduled = true;
    const msg = reason ? `Restart requested: ${reason}` : 'Restart requested';
    console.log(`[system] ${msg}. Exiting in 500ms.`);
    setTimeout(() => process.exit(0), 500);
  }

  close(): void { this.observer.close(); }
}

function hydrateSessionState(
  session: Session,
  agentId?: string,
  events?: SessionEvent[],
): import('./session-manager.js').SessionState {
  const eventMessages = events && events.length > 0 ? hydrateChatMessagesFromEvents(events) : [];
  const messages = eventMessages.length > 0 ? eventMessages : hydrateChatMessages(session.messages);
  const eventTimes = events?.map((event) => event.timestamp).filter((time) => Number.isFinite(time)) ?? [];
  return {
    id: session.id,
    title: deriveSessionTitleFromMessages(messages) ?? deriveSessionTitle(session),
    messages,
    createdAt: eventTimes.length > 0 ? Math.min(...eventTimes) : session.createdAt,
    lastActiveAt: eventTimes.length > 0 ? Math.max(...eventTimes) : session.lastAccessedAt,
    agentId,
  };
}

function deriveSessionTitle(session: Session): string | undefined {
  const firstUser = session.messages.find(m => m.role === 'user' && typeof m.content === 'string');
  if (!firstUser || typeof firstUser.content !== 'string') return undefined;
  return firstUser.content.length > 30 ? `${firstUser.content.slice(0, 30)}...` : firstUser.content;
}

function deriveSessionTitleFromMessages(messages: ChatMessage[]): string | undefined {
  const firstUser = messages.find((m) => m.role === 'user' && m.content && m.content !== '(image)');
  if (!firstUser) return undefined;
  return firstUser.content.length > 30 ? `${firstUser.content.slice(0, 30)}...` : firstUser.content;
}

function hydrateChatMessagesFromEvents(events: SessionEvent[]): ChatMessage[] {
  const out: ChatMessage[] = [];
  const openTools = new Map<string, { tool: ToolCallInfo; step: ChatStep; message: ChatMessage }>();
  let currentAssistant: ChatMessage | null = null;
  let pendingTimeline: ChatTimelineItem[] = [];
  let pendingEvents: ChatTimelineEvent[] = [];
  let pendingInference: InferenceInfo | undefined;

  const pushTimelineEvent = (event: ChatTimelineEvent) => {
    if (currentAssistant) {
      currentAssistant.events = [...(currentAssistant.events ?? []), event];
      currentAssistant.timeline = [...(currentAssistant.timeline ?? []), { type: 'event', event }];
    } else {
      pendingEvents = [...pendingEvents, event];
      pendingTimeline = [...pendingTimeline, { type: 'event', event }];
    }
  };

  const ensureAssistantForActivity = (event: SessionEvent): ChatMessage => {
    if (currentAssistant) return currentAssistant;
    const message: ChatMessage = {
      id: `activity_${event.id}`,
      role: 'assistant',
      content: '',
      timestamp: event.timestamp,
      status: 'completed',
      delivery: 'turn',
      events: pendingEvents.length > 0 ? pendingEvents : undefined,
      timeline: pendingTimeline.length > 0 ? pendingTimeline : undefined,
    };
    out.push(message);
    currentAssistant = message;
    pendingEvents = [];
    pendingTimeline = [];
    return message;
  };

  const ensureActivityStep = (message: ChatMessage, event: SessionEvent): ChatStep => {
    const existing = message.steps?.at(-1);
    if (existing) return existing;
    const step: ChatStep = {
      id: `step_${event.id}`,
      toolCalls: [],
      status: 'completed',
      inference: pendingInference,
    };
    message.steps = [...(message.steps ?? []), step];
    message.timeline = [...(message.timeline ?? []), { type: 'step', step }];
    if (pendingInference) {
      message.inferences = [...(message.inferences ?? []), pendingInference];
      pendingInference = undefined;
    }
    return step;
  };

  for (const event of events) {
    switch (event.type) {
      case 'user_message': {
        const message = chatUserMessageFromEvent(event, out.length);
        if (message) {
          out.push(message);
          currentAssistant = null;
        }
        break;
      }

      case 'assistant_message': {
        const step = chatStepFromAssistantEvent(event, pendingInference);
        const message: ChatMessage = {
          id: `msg_${event.id}`,
          role: 'assistant',
          content: step?.text ?? '',
          timestamp: event.timestamp,
          status: 'completed',
          delivery: 'turn',
          steps: step ? [step] : undefined,
          events: pendingEvents.length > 0 ? pendingEvents : undefined,
          timeline: [
            ...pendingTimeline,
            ...(step ? [{ type: 'step' as const, step }] : []),
          ],
          inferences: pendingInference ? [pendingInference] : undefined,
          thinking: step?.thinking,
          toolCalls: step && step.toolCalls.length > 0 ? step.toolCalls : undefined,
        };
        if (message.content || message.steps?.length || message.events?.length) {
          out.push(message);
          currentAssistant = message;
          if (step) {
            for (const tool of step.toolCalls) {
              if (tool.toolUseId) openTools.set(tool.toolUseId, { tool, step, message });
            }
          }
        }
        pendingInference = undefined;
        pendingEvents = [];
        pendingTimeline = [];
        break;
      }

      case 'tool_use_start':
      case 'tool_use': {
        const message = ensureAssistantForActivity(event);
        const step = ensureActivityStep(message, event);
        const existing = event.toolUseId ? openTools.get(event.toolUseId) : undefined;
        if (!existing) {
          const tool: ToolCallInfo = {
            name: event.name,
            input: event.input,
            toolUseId: event.toolUseId,
          };
          step.toolCalls = [...step.toolCalls, tool];
          message.toolCalls = [...(message.toolCalls ?? []), tool];
          if (event.toolUseId) openTools.set(event.toolUseId, { tool, step, message });
        }
        break;
      }

      case 'tool_use_end':
      case 'tool_result': {
        const ref = openTools.get(event.toolUseId);
        if (ref) {
          ref.tool.result = event.type === 'tool_use_end' ? event.output : event.content;
          ref.tool.isError = event.isError;
        } else {
          const message = ensureAssistantForActivity(event);
          const step = ensureActivityStep(message, event);
          const tool: ToolCallInfo = {
            name: event.toolUseId,
            input: {},
            toolUseId: event.toolUseId,
            result: event.type === 'tool_use_end' ? event.output : event.content,
            isError: event.isError,
          };
          step.toolCalls = [...step.toolCalls, tool];
          message.toolCalls = [...(message.toolCalls ?? []), tool];
        }
        break;
      }

      case 'thinking': {
        const message = ensureAssistantForActivity(event);
        const step = ensureActivityStep(message, event);
        step.thinking = `${step.thinking ?? ''}${event.thinking}`;
        message.thinking = `${message.thinking ?? ''}${event.thinking}`;
        break;
      }

      case 'api_response':
        pendingInference = {
          model: event.model,
          inputTokens: event.usage.inputTokens,
          outputTokens: event.usage.outputTokens,
          cacheReadTokens: event.usage.cacheReadTokens,
          cacheWriteTokens: event.usage.cacheWriteTokens,
          stopReason: event.stopReason,
        };
        pushTimelineEvent(timelineEventFromSessionEvent(event));
        break;

      case 'query_start':
      case 'api_request':
      case 'api_call':
      case 'compaction_marker':
      case 'memory_flush':
      case 'guard_decision':
      case 'delegate_start':
      case 'delegate_end':
      case 'crash_recovered': {
        pushTimelineEvent(timelineEventFromSessionEvent(event));
        break;
      }

      default:
        break;
    }
  }

  return out.filter((message) =>
    message.role === 'user' ||
    message.content ||
    message.timeline?.length ||
    message.steps?.length ||
    message.toolCalls?.length,
  );
}

function chatUserMessageFromEvent(
  event: Extract<SessionEvent, { type: 'user_message' }>,
  index: number,
): ChatMessage | null {
  if (typeof event.content === 'string') {
    return {
      id: `msg_${event.id || index}`,
      role: 'user',
      content: event.content,
      timestamp: event.timestamp,
      status: 'completed',
      delivery: 'turn',
    };
  }

  const blocks = Array.isArray(event.content) ? event.content : [];
  const text = blocks
    .filter((b): b is Extract<ContentBlock, { type: 'text' }> => b.type === 'text')
    .map((b) => b.text)
    .join('\n');
  const imageBlocks = blocks
    .filter((b): b is Extract<ContentBlock, { type: 'image' }> => b.type === 'image')
    .map((b) => ({ type: 'image' as const, data: b.data, mediaType: b.mediaType }));

  if (!text && imageBlocks.length === 0) return null;
  return {
    id: `msg_${event.id || index}`,
    role: 'user',
    content: text || '(image)',
    timestamp: event.timestamp,
    status: 'completed',
    delivery: 'turn',
    blocks: imageBlocks.length > 0 ? imageBlocks : undefined,
  };
}

function chatStepFromAssistantEvent(
  event: Extract<SessionEvent, { type: 'assistant_message' }>,
  inference?: InferenceInfo,
): ChatStep | null {
  const text = event.content
    .filter((b): b is Extract<ContentBlock, { type: 'text' }> => b.type === 'text')
    .map((b) => b.text)
    .join('\n');
  const thinking = event.content
    .filter((b): b is Extract<ContentBlock, { type: 'thinking' }> => b.type === 'thinking')
    .map((b) => b.thinking)
    .join('\n') || undefined;
  const toolCalls: ToolCallInfo[] = event.content
    .filter((b): b is ToolUseContent => b.type === 'tool_use')
    .map((tool) => ({
      name: tool.name,
      input: tool.input,
      toolUseId: tool.id,
    }));

  if (!text && !thinking && toolCalls.length === 0 && !inference) return null;
  return {
    id: `step_${event.id}`,
    text: text || undefined,
    thinking,
    toolCalls,
    inference,
    status: 'completed',
  };
}

function timelineEventFromSessionEvent(event: SessionEvent): ChatTimelineEvent {
  const base = {
    id: event.id || randomUUID(),
    timestamp: event.timestamp,
    collapsed: true,
  };
  switch (event.type) {
    case 'query_start':
      return { ...base, kind: 'query', title: '用户提示已提交' };
    case 'api_call':
      return { ...base, kind: 'api_call', title: '调用模型', detail: `${event.inputTokens}↓ ${event.outputTokens}↑`, tone: 'info' };
    case 'api_request':
      return { ...base, kind: 'api_call', title: '调用模型', detail: `${event.messages.length} messages · ${event.tools.length} tools`, tone: 'info' };
    case 'api_response':
      return {
        ...base,
        kind: 'api_response',
        title: `模型响应完成：${event.model}`,
        detail: `${event.usage.inputTokens}↓ ${event.usage.outputTokens}↑ · ${event.stopReason}`,
        tone: 'good',
      };
    case 'compaction_marker':
      return {
        ...base,
        kind: 'compaction',
        title: '上下文已压缩',
        detail: `释放 ${event.tokensFreed.toLocaleString()} tokens`,
        tone: 'warn',
      };
    case 'memory_flush':
      return { ...base, kind: 'memory', title: '记忆已写入', detail: `${event.reason} · ${event.charsSaved} chars`, tone: 'good' };
    case 'guard_decision':
      return {
        ...base,
        kind: 'guard',
        title: `安全策略：${event.decision.action}`,
        detail: event.toolName,
        tone: event.decision.action === 'deny' ? 'bad' : 'info',
      };
    case 'delegate_start':
      return { ...base, kind: 'delegate', title: '委派任务开始', detail: event.message, tone: 'info' };
    case 'delegate_end':
      return { ...base, kind: 'delegate', title: '委派任务完成', tone: 'good' };
    case 'crash_recovered':
      return { ...base, kind: 'system', title: '已恢复崩溃会话', detail: `${event.artifactCount} artifacts`, tone: 'warn' };
    default:
      return { ...base, kind: 'system', title: event.type };
  }
}

function hydrateChatMessages(messages: Session['messages']): ChatMessage[] {
  const out: ChatMessage[] = [];

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i]!;

    if (msg.role === 'user') {
      // Real user prompt
      if (typeof msg.content === 'string') {
        out.push({
          id: `msg_${msg.createdAt}_${i}`,
          role: 'user',
          content: msg.content,
          timestamp: msg.createdAt ?? Date.now(),
          status: 'completed',
          delivery: 'turn',
        });
        continue;
      }

      // Multimodal user prompt (text + image blocks) or synthetic tool_result carrier
      const blocks = Array.isArray(msg.content) ? msg.content : [];
      const hasUserText = blocks.some(b => b.type === 'text');
      const hasImage = blocks.some(b => b.type === 'image');
      if (!hasUserText && !hasImage) continue;

      const text = blocks
        .filter((b): b is Extract<ContentBlock, { type: 'text' }> => b.type === 'text')
        .map(b => b.text)
        .join('\n');
      const imageBlocks = blocks
        .filter((b): b is Extract<ContentBlock, { type: 'image' }> => b.type === 'image')
        .map(b => ({ type: 'image' as const, data: b.data, mediaType: b.mediaType }));
      if (text || imageBlocks.length > 0) {
        out.push({
          id: `msg_${msg.createdAt}_${i}`,
          role: 'user',
          content: text || '(image)',
          timestamp: msg.createdAt ?? Date.now(),
          status: 'completed',
          delivery: 'turn',
          blocks: imageBlocks.length > 0 ? imageBlocks : undefined,
        });
      }
      continue;
    }

    // Assistant message: collect visible text + tool calls + thinking
    const blocks = typeof msg.content === 'string' ? [] : msg.content;
    const text = typeof msg.content === 'string'
      ? msg.content
      : blocks.filter((b): b is Extract<ContentBlock, { type: 'text' }> => b.type === 'text').map(b => b.text).join('\n');

    const thinking = typeof msg.content === 'string'
      ? undefined
      : blocks.filter((b): b is Extract<ContentBlock, { type: 'thinking' }> => b.type === 'thinking').map(b => b.thinking).join('\n') || undefined;

    const toolCalls = typeof msg.content === 'string'
      ? undefined
      : hydrateToolCalls(blocks, messages[i + 1]);

    // Skip empty assistant messages that have no visible content.
    // These can appear when a query aborts before the model outputs any
    // tokens (e.g. tool crash, guard deny, or transient API error). Sending
    // an empty assistant message to the LLM API causes a 400.
    if (!text && !thinking && (!toolCalls || toolCalls.length === 0)) {
      continue;
    }

    out.push({
      id: `msg_${msg.createdAt}_${i}`,
      role: 'assistant',
      content: text,
      timestamp: msg.createdAt ?? Date.now(),
      status: 'completed',
      delivery: 'turn',
      toolCalls: toolCalls && toolCalls.length > 0 ? toolCalls : undefined,
      thinking,
    });
  }

  return out;
}

function hydrateToolCalls(blocks: ContentBlock[], nextMessage?: Session['messages'][number]): ChatMessage['toolCalls'] {
  const toolUses = blocks.filter((b): b is ToolUseContent => b.type === 'tool_use');
  if (toolUses.length === 0) return undefined;

  const resultById = new Map<string, ToolResultContent>();
  if (nextMessage?.role === 'user' && Array.isArray(nextMessage.content)) {
    for (const block of nextMessage.content) {
      if (block.type === 'tool_result') {
        resultById.set(block.toolUseId, block);
      }
    }
  }

  return toolUses.map((toolUse) => {
    const result = resultById.get(toolUse.id);
    return {
      name: toolUse.name,
      input: toolUse.input,
      toolUseId: toolUse.id,
      isError: result?.isError,
      result: result?.content,
    };
  });
}
