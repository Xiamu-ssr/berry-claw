/**
 * Agent Manager — 多 Agent 实例管理
 */
import {
  Agent,
  DefaultCredentialStore,
  FileSessionStore,
  estimateTokens,
} from '@berry-agent/core';
import {
  TOOL_BROWSER,
  TOOL_EDIT_FILE,
  TOOL_FIND_FILES,
  TOOL_GREP,
  TOOL_LIST_FILES,
  TOOL_READ_FILE,
  TOOL_SHELL,
  TOOL_WEB_FETCH,
  TOOL_WEB_SEARCH,
  TOOL_WRITE_FILE,
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
} from '@berry-agent/core';
import { compositeGuard, denyList } from '@berry-agent/safe';
import type { ToolGuard } from '@berry-agent/core';
import { resolve as resolvePath, relative as relativePath } from 'node:path';
import { createObserver, createCollector, calculateCost, type Observer, type ModelPricing } from '@berry-agent/observe';
import {
  createAllTools,
  createBrowserTool,
  createWebFetchTool,
  createWebSearchTool,
  WEB_SEARCH_CREDENTIAL_KEYS,
  type WebSearchProviderName,
} from '@berry-agent/tools-common';
import { ConfigManager, type AgentEntry } from './config-manager.js';
import { SessionManager, type ChatMessage } from './session-manager.js';
import { buildBaseSystemPrompt, listPromptBlocks, type PromptBlockInfo } from './prompt-blocks.js';
import { join } from 'node:path';
import { createFileMemoryProvider } from '@berry-agent/memory-file';
import { selectProvider } from '@berry-agent/models';
import { Team, type TeamState } from '@berry-agent/team';
import { mkdirSync, existsSync } from 'node:fs';
import { FactBus } from '../facts/bus.js';
import { deriveAgentFact, deriveTeamFact } from '../facts/derive.js';

const TOOL_GROUPS: Record<string, readonly string[]> = {
  file: [TOOL_READ_FILE, TOOL_WRITE_FILE, TOOL_LIST_FILES, TOOL_EDIT_FILE],
  shell: [TOOL_SHELL],
  search: [TOOL_GREP, TOOL_FIND_FILES],
  web_fetch: [TOOL_WEB_FETCH],
  web_search: [TOOL_WEB_SEARCH],
  browser: [TOOL_BROWSER],
};

const TOOL_GROUP_LABELS: Record<string, string> = {
  file: 'File',
  shell: 'Shell',
  search: 'Search',
  web_fetch: 'Web Fetch',
  web_search: 'Web Search',
  browser: 'Browser',
};

export function getToolGroup(toolName: string): string {
  for (const [group, names] of Object.entries(TOOL_GROUPS)) {
    if (names.includes(toolName)) return TOOL_GROUP_LABELS[group] ?? group;
  }
  return 'Other';
}

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
  // When no provider is configured the SDK returns a stub tool automatically.
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
  workspace: string,
  entry: AgentEntry,
  credentials: CredentialStore,
): ToolRegistration[] {
  const tools = [
    ...createAllTools(workspace),
    createWebFetchTool(),
    buildWebSearchTool(credentials),
    createBrowserTool(),
  ];

  if (entry.tools === undefined) return tools;
  const allowedToolNames = new Set(
    entry.tools.flatMap((name) => TOOL_GROUPS[name] ?? [name]),
  );
  return tools.filter((tool) => allowedToolNames.has(tool.definition.name));
}

/**
 * ToolGuard that allows path-bearing tool inputs whose target resolves
 * inside **any** of the given root directories. Mirrors @berry-agent/safe's
 * single-root directoryScope() but OR-combines multiple roots, which is
 * needed when an agent is bound to a project: files may live under the
 * project root or under the agent's own workspace (memory/notes/skills).
 */
function buildMultiRootScope(roots: string[]): ToolGuard {
  const resolvedRoots = roots.map((r) => resolvePath(r));
  const pathFields = ['path', 'file', 'filename', 'dir', 'directory', 'target'];
  return async ({ input }) => {
    for (const field of pathFields) {
      const value = input[field];
      if (typeof value !== 'string') continue;
      // Try each root; allow if any contains the path.
      const anyMatch = resolvedRoots.some((root) => {
        const abs = resolvePath(root, value);
        return !relativePath(root, abs).startsWith('..');
      });
      if (!anyMatch) {
        return {
          action: 'deny',
          reason: `Path "${value}" is outside all allowed roots: ${resolvedRoots.join(', ')}`,
        };
      }
    }
    return { action: 'allow' };
  };
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
  private pricingOverrides: Record<string, ModelPricing>;
  /**
   * Per-agent observe collectors. Each agent gets its own collector so that
   * agentId is correctly stamped into sessions / turns / llm_calls.
   * The database connection is shared (all collectors write to the same DB).
   */
  private agentCollectors = new Map<string, { middleware: Middleware; eventListener: (event: AgentEvent) => void }>();

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
    // Persisted defaultAgent may be empty; fall back to the first configured
    // agent so the app still boots into a usable state after restart.
    this.activeAgentId = this.config.defaultAgent || this.config.listAgents()[0]?.id || '';
  }

  /** Get or create an agent instance by ID */
  getAgent(agentId?: string): Agent {
    const id = agentId ?? this.activeAgentId;
    const existing = this.agents.get(id);
    if (existing) return existing.agent;
    return this.initAgent(id);
  }

  /** Initialize an agent from config */
  initAgent(agentId?: string): Agent {
    const id = agentId ?? this.activeAgentId;
    const entry = this.config.getAgent(id);
    if (!entry) throw new Error(`Agent "${id}" not found in config`);

    // Resolve model spec ('tier:X' / 'model:X' / 'raw:...' / bare id) against
    // the registry view of the config, producing either a static ProviderConfig
    // (raw escape hatch) or a ProviderResolver with failover support.
    const providerInput = selectProvider(entry.model, this.config.toModelsRegistry(), {
      onRotate: (from, to, err) => {
        console.warn(
          `[agent:${id}] provider failover: ${from.providerId} → ${to.providerId}`,
          err,
        );
      },
    });

    const workspace = entry.workspace ?? this.config.agentWorkspace(id);
    if (!existsSync(workspace)) mkdirSync(workspace, { recursive: true });

    const sessionsDir = join(this.config.appDir, 'sessions', id);
    if (!existsSync(sessionsDir)) mkdirSync(sessionsDir, { recursive: true });

    // Resolve project root early so it is available for system prompt injection.
    const projectRoot = entry.project;
    if (projectRoot) {
      if (!existsSync(projectRoot)) mkdirSync(projectRoot, { recursive: true });
      // Ensure project/.berry/ exists for worklist/team-shared data.
      const berryDir = join(projectRoot, '.berry');
      if (!existsSync(berryDir)) mkdirSync(berryDir, { recursive: true });
    }

    // Build system prompt — inject environment context so the agent knows
    // its own workspace and project bindings. This is the single source of
    // truth for "where am I operating?" introspection.
    const systemPrompt = buildBaseSystemPrompt(entry, workspace);

    // Build tools based on config
    const tools = buildTools(workspace, entry, this.credentials);

    // Memory provider: FTS5-backed search over
    //   - {workspace}/MEMORY.md + memory/*.md  (personal)
    //   - {project}/AGENTS.md, PROJECT.md, .berry-discoveries.md  (shared,
    //     if the agent is bound to a project)
    // Teammates on the same project all point at the same projectDir, so
    // save_discovery from any of them shows up in every other's search.
    const memoryProvider = createFileMemoryProvider({
      workspaceDir: workspace,
      projectDir: projectRoot,
    });
    // sync() builds the FTS index; fire-and-forget is fine — it uses sync IO internally
    // and finishes near-instantly. The first search call will hit a warm index.
    memoryProvider.sync().catch(() => {/* best-effort */});

    // Directory scoping: allow BOTH project root (work files) AND agent
    // workspace (private memory/notes). directoryScope() is single-root, so
    // compose an OR guard that allows paths inside either root.
    const allowedRoots = projectRoot ? [projectRoot, workspace] : [workspace];
    const multiRootScope = buildMultiRootScope(allowedRoots);

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

    const agent = new Agent({
      provider: providerInput,
      reasoningEffort: entry.reasoningEffort,
      systemPrompt,
      tools,
      cwd: projectRoot ?? workspace,
      workspace,
      project: projectRoot,
      memory: memoryProvider,
      skillDirs: entry.skillDirs,
      sessionStore: new FileSessionStore(sessionsDir),
      toolGuard: compositeGuard(
        multiRootScope,
        denyList(['rm -rf /', 'rm -rf ~', 'DROP TABLE', 'DROP DATABASE']),
      ),
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

    // Apply initial disabledTools via SDK allow-list (soft toggle)
    const initialDisabled = new Set(entry.disabledTools ?? []);
    if (initialDisabled.size > 0) {
      const all = agent.getTools().map(t => t.name);
      agent.setAllowedTools(all.filter(n => !initialDisabled.has(n)));
    }

    this.agents.set(id, { id, agent, entry });

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
        this.agents.delete(teammateId);
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
      systemPrompt: spec.systemPrompt,
      model: modelRef,
      project: spec.project,
      team: { leaderId: spec.leaderId, role: spec.role },
    };
    this.config.setAgent(spec.id, entry);
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
   * Supports: systemPrompt, model, allowedTools (via disabledTools in entry).
   */
  reloadAgent(agentId: string): void {
    const cached = this.agents.get(agentId);
    const entry = this.config.getAgent(agentId);
    if (!entry) {
      this.agents.delete(agentId);
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
    if ((entry.project ?? null) !== (cached.entry.project ?? null)) {
      this.agents.delete(agentId);
      return;
    }

    // 1. System prompt
    cached.agent.setSystemPrompt(entry.systemPrompt ?? '');

    // 2. Model (if changed) — hot swap via static ProviderConfig using the
    //    first provider in the new model's binding. A full resolver swap on
    //    hot reload would require tearing down the Agent instance, which the
    //    reload path explicitly avoids.
    let providerSwitched = false;
    try {
      if (entry.model && entry.model !== cached.entry.model) {
        const nextCfg = resolveStaticProviderConfig(entry.model, this.config);
        if (nextCfg) {
          cached.agent.switchProvider(nextCfg);
          providerSwitched = true;
        }
      }
    } catch (err) {
      console.warn(`[reload] model switch failed for ${agentId}:`, err);
    }

    // 2.5 Reasoning effort (if changed)
    if (entry.reasoningEffort !== cached.entry.reasoningEffort) {
      const currentProvider = cached.agent.currentProvider;
      cached.agent.switchProvider({
        ...currentProvider,
        reasoningEffort: entry.reasoningEffort,
      });
    }

    // 3. Allowed tools = (all registered) − disabledTools
    const disabled = new Set(entry.disabledTools ?? []);
    if (disabled.size === 0) {
      cached.agent.setAllowedTools(null);
    } else {
      const all = cached.agent.getTools().map(t => t.name);
      cached.agent.setAllowedTools(all.filter(n => !disabled.has(n)));
    }

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
   * Uses the same 3-layer resolution as initAgent(): tier/model/raw spec,
   * falling back to the first provider of a bare model id. For hot swap we
   * collapse down to a static ProviderConfig so switchProvider() can accept
   * it without having to rewire the Agent instance.
   *
   * v0.4 fix: writes the new model back to config so currentModel() and
   * the UI have a single source of truth. Without this the chat frontend
   * and the agent settings page show stale values after a switch.
   */
  switchModel(model: string): void {
    const staticCfg = resolveStaticProviderConfig(model, this.config);
    if (!staticCfg) throw new Error(`Model "${model}" not found`);
    this.getAgent().switchProvider(staticCfg);

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

  /** Live AgentInstance or undefined — used by fact derivers. */
  getInstance(agentId: string): AgentInstance | undefined {
    return this.agents.get(agentId);
  }

  /**
   * Create a new empty SDK session and sync it into SessionManager.
   * Returns the created session state so callers can immediately use the real sessionId.
   */
  async createSession(agentId?: string): Promise<import('./session-manager.js').SessionState> {
    const agent = this.getAgent(agentId);
    const sdkSession = await agent.createSession();
    const state = hydrateSessionState(sdkSession, agentId ?? this.activeAgentId);
    this.sessions.upsertState(state);
    this.sessions.switchSession(sdkSession.id);
    return state;
  }

  /**
   * Load a persisted SDK session from disk and hydrate berry-claw's richer UI
   * session state cache. This makes sessions survive server restarts instead of
   * living only in SessionManager's in-memory map.
   */
  async loadSessionState(sessionId: string, agentId?: string): Promise<import('./session-manager.js').SessionState | null> {
    const cached = this.sessions.getState(sessionId);
    if (cached && cached.messages.length > 0) return cached;

    const targetId = agentId ?? this.activeAgentId;
    if (!targetId || !this.config.getAgent(targetId)) return cached;

    const agent = this.getAgent(targetId);
    const session = await agent.getSession(sessionId);
    if (!session) return cached;

    const state = hydrateSessionState(session, agentId ?? this.activeAgentId);
    this.sessions.upsertState(state);
    return state;
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
    } else {
      const created = await agent.createSession();
      sessionId = created.id;
      this.sessions.upsertState(hydrateSessionState(created));
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
      const result = await agent.query(prompt, {
        resume: sessionId,
        stream: true,
        onEvent: (event) => {
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
            else if (event.type === 'tool_call') toolCalls.push({ name: event.name, input: event.input });
            else if (event.type === 'tool_result') {
              const last = [...toolCalls].reverse().find(t => t.name === event.name);
              if (last) last.isError = event.isError;
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

      // Hydrate tool result content from the SDK session so UI can show tool output
      try {
        const sdkSession = await agent.getSession(result.sessionId);
        if (sdkSession) {
          const hydrated = hydrateChatMessages(sdkSession.messages);
          const lastAssistant = [...hydrated].reverse().find((m) => m.role === 'assistant');
          if (lastAssistant?.toolCalls && lastAssistant.toolCalls.length > 0) {
            this.sessions.updateMessage(sessionId, assistantMessage.id, { toolCalls: lastAssistant.toolCalls });
          }
        }
      } catch {
        // Ignore hydration errors — the message is already stored with basic tool info
      }

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
    runtime: ReturnType<Agent['inspect']> | null;
  } {
    const id = agentId ?? this.activeAgentId;
    const entry = this.config.getAgent(id);
    if (!entry) throw new Error(`Agent "${id}" not found`);
    const instance = this.agents.get(id);
    return {
      id,
      entry,
      runtime: instance ? instance.agent.inspect() : null,
    };
  }

  /** Structured prompt block registry for inspect/edit UIs. */
  async describePromptBlocks(agentId?: string): Promise<PromptBlockInfo[]> {
    const id = agentId ?? this.activeAgentId;
    const entry = this.config.getAgent(id);
    if (!entry) throw new Error(`Agent "${id}" not found`);
    const runtime = this.agents.get(id)?.agent.inspect() ?? null;
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
  async getAgentContextSize(agentId?: string): Promise<{ current: number; window: number } | null> {
    const id = agentId ?? this.activeAgentId;
    const instance = this.agents.get(id);
    if (!instance) return null;
    const ctxWindow = instance.agent.inspect().compaction?.contextWindow ?? 200_000;
    const sessionId = this.sessions.currentSessionId;
    if (!sessionId) return { current: 0, window: ctxWindow };
    const session = await instance.agent.getSession(sessionId);
    if (!session) return { current: 0, window: ctxWindow };
    const current = estimateTokens(session.messages);
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

  close(): void { this.observer.close(); }
}

/**
 * Resolve a model spec (tier:X / model:X / raw:... / bare id) down to a
 * static ProviderConfig. Used by hot-swap paths that can't rewire the
 * Agent instance; chooses the binding's first provider and returns null
 * when the spec can't be resolved.
 */
function resolveStaticProviderConfig(
  spec: string,
  config: ConfigManager,
): import('@berry-agent/core').ProviderConfig | null {
  try {
    const registry = config.toModelsRegistry();
    const resolved = selectProvider(spec, registry);
    if ('resolve' in resolved && typeof (resolved as { resolve?: unknown }).resolve === 'function') {
      return (resolved as { resolve: () => import('@berry-agent/core').ProviderConfig }).resolve();
    }
    return resolved as import('@berry-agent/core').ProviderConfig;
  } catch {
    // Bare model id that isn't in the registry? Fall back to first provider.
    return config.toProviderConfig(spec);
  }
}

function hydrateSessionState(session: Session, agentId?: string): import('./session-manager.js').SessionState {
  return {
    id: session.id,
    title: deriveSessionTitle(session),
    messages: hydrateChatMessages(session.messages),
    createdAt: session.createdAt,
    lastActiveAt: session.lastAccessedAt,
    agentId,
  };
}

function deriveSessionTitle(session: Session): string | undefined {
  const firstUser = session.messages.find(m => m.role === 'user' && typeof m.content === 'string');
  if (!firstUser || typeof firstUser.content !== 'string') return undefined;
  return firstUser.content.length > 30 ? `${firstUser.content.slice(0, 30)}...` : firstUser.content;
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
      isError: result?.isError,
      result: result?.content,
    };
  });
}
