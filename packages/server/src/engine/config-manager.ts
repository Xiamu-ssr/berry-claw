/**
 * Config Manager — ~/.berry-claw/config.json
 *
 * 3-layer schema:
 *   providerInstances:  Layer 1 (where apiKey lives)
 *   models:             Layer 2 (model-first aggregation + failover order)
 *   tiers:              Layer 3 (strong / balanced / fast → modelId)
 *   agents[].model:     "tier:X" | "model:X" | "raw:..." | bare modelId
 *
 * Current-schema only: configs that don't match this shape are either empty
 * (fresh install) or corrupt. We keep the file strictly typed to catch drift
 * early.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync, renameSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { AgentHome } from '@berry-agent/core';
import type {
  ModelBinding,
  ProviderInstance,
  TierId,
  ModelsRegistry,
} from '@berry-agent/models';
import { MCP_CONFIG_FILENAME } from './mcp-constants.js';

/**
 * Current on-disk schema version for `~/.berry-claw/config.json`.
 * Anything else is rejected by {@link ConfigManager}'s normalizer. Bump
 * this when the schema changes.
 */
export const CONFIG_SCHEMA_VERSION = 2 as const;
export type ConfigSchemaVersion = typeof CONFIG_SCHEMA_VERSION;

// ===== New schema types =====

/** Layer 1 — stored form (on disk). Same shape as ProviderInstance. */
export type ProviderInstanceEntry = ProviderInstance;

/** Layer 2 — stored form. */
export type ModelEntry = ModelBinding;

/** Layer 3 — partial by design; setup wizard enforces completeness. */
export type TierEntry = Partial<Record<TierId, string>>;

export interface AgentEntry {
  name: string;
  /** "tier:strong" | "model:claude-opus-4.7" | "raw:{...}" | bare model id. */
  model: string;
  /**
   * Agent's **private** workspace directory. Always exists. Holds the agent's
   * own memory/*, SOUL.md, daily notes, identity files, etc. Independent of
   * any project the agent is working on — agents keep their identity when
   * switching projects.
   */
  workspace?: string;
  /**
   * Optional path to the project root the agent is currently working in.
   * When set, SDK's projectContext kicks in:
   *   - project/AGENTS.md is prepended to system prompt
   *   - project/.berry/ becomes the shared team/worklist data dir
   * The agent still has its private `workspace` — project workdir and
   * workspace coexist. Leave undefined for agents that don't target a project
   * (e.g. general-purpose chat agents).
   */
  project?: string;
  tools?: string[];
  /**
   * Tool names to hide from this agent, after registration. Matched by the
   * **Berry-registered name** (the name the agent actually sees), which for
   * MCP tools is `${prefix}${upstreamName}` (prefix defaults to
   * `${serverName}_`). I.e. store `playwright_browser_click`, not
   * `browser_click`. Renaming an MCP server or changing its prefix will
   * silently un-disable previously-disabled tools — UI should re-resolve.
   */
  disabledTools?: string[];
  skillDirs?: string[];
  /** Explicit skill blacklist applied after global/per-agent discovery. */
  disabledSkills?: string[];
  /**
   * Names of skills (from the global skill market under
   * `~/.berry-claw/skills/`) that this agent is allowed to see.
   * Anything installed globally but not listed here is filtered out before
   * the SDK sees it (by computing a blacklist at agent load time).
   * Default (undefined / empty array) = no market skills visible.
   */
  enabledSkills?: string[];
  /** Unified reasoning effort level (provider-mapped). */
  reasoningEffort?: 'none' | 'low' | 'medium' | 'high' | 'max' | 'xhigh';
  /** SDK prompt pack id. Resolved from ConfigManager.promptPacksDir(). */
  promptPack?: string;

  /**
   * Safety mode override for this agent. When set, bypasses the project-
   * level and global-level safety settings. See {@link SafetyLevel} —
   * cascade agent > project > global > 'default'. Stored as a plain string
   * to keep the on-disk config schema decoupled from the safety module;
   * validation happens at read time via {@link resolveSafetyLevel}.
   */
  safetyLevel?: 'trust' | 'default' | 'auto';

  /**
   * Team membership marker. When set, this agent is a teammate in the team
   * led by `team.leaderId`. The teammate is still a *first-class agent* in
   * this config (visible in the Agents tab, has its own session store) —
   * the team relation is purely metadata.
   *
   * v1.2 (2026-04-22): introduced to stop having two kinds of agents. All
   * agents are AgentEntry rows; the team field just describes who leads
   * whom. Spawn_teammate writes a new AgentEntry with this field set.
   */
  team?: {
    leaderId: string;
    /** Human-readable role (e.g. "code reviewer"). */
    role: string;
  };
}

export interface AppConfig {
  schemaVersion: ConfigSchemaVersion;
  providerInstances: Record<string, ProviderInstanceEntry>;
  models: Record<string, ModelEntry>;
  tiers: TierEntry;
  agents: Record<string, AgentEntry>;
  defaultAgent: string;
  /**
   * Global (app-wide) fallback safety level. Used when neither the agent
   * entry nor the project's `.berry/safety.json` specifies one. Undefined
   * means "no opinion" → the resolver falls through to its 'default' floor.
   */
  safetyLevel?: 'trust' | 'default' | 'auto';
  /** Global LLM classifier used by safety level `auto`. */
  safetyClassifier?: {
    /** Model ref, e.g. tier:fast or a Layer-2 model id. */
    model?: string;
    /** false disables the classifier and falls back to HITL approval. */
    enabled?: boolean;
    /** Skip classifier Stage 2 reasoning for lower latency. */
    skipStage2?: boolean;
  };
  auth: {
    sessionTtlMs: number;
    challengeTtlMs: number;
    allowAnonymous: boolean;
  };
}

const DEFAULT_APP_DIR = process.env.BERRY_CLAW_HOME ?? join(homedir(), '.berry-claw');
const DEFAULT_SESSION_TTL_MS = 86_400_000;
const DEFAULT_CHALLENGE_TTL_MS = 300_000;

const EMPTY_CONFIG: AppConfig = {
  schemaVersion: CONFIG_SCHEMA_VERSION,
  providerInstances: {},
  models: {},
  tiers: {},
  agents: {},
  defaultAgent: '',
  auth: {
    sessionTtlMs: DEFAULT_SESSION_TTL_MS,
    challengeTtlMs: DEFAULT_CHALLENGE_TTL_MS,
    allowAnonymous: false,
  },
};

export interface ConfigManagerOptions {
  appDir?: string;
}

export class ConfigManager {
  private config: AppConfig;
  readonly appDir: string;
  readonly configPath: string;

  constructor(options: ConfigManagerOptions = {}) {
    this.appDir = options.appDir ?? DEFAULT_APP_DIR;
    this.configPath = join(this.appDir, 'config.json');

    if (!existsSync(this.appDir)) mkdirSync(this.appDir, { recursive: true });

    if (existsSync(this.configPath)) {
      const raw = readFileSync(this.configPath, 'utf-8');
      const parsed = JSON.parse(raw) as Partial<AppConfig>;
      this.config = normalize(parsed);
    } else {
      this.config = { ...EMPTY_CONFIG };
      this.save();
    }

    const agentsDir = join(this.appDir, 'agents');
    if (!existsSync(agentsDir)) mkdirSync(agentsDir, { recursive: true });
  }

  // ===== Core =====

  get(): AppConfig { return structuredClone(this.config); }

  save(): void {
    writeFileSync(this.configPath, JSON.stringify(this.config, null, 2), 'utf-8');
  }

  update(patch: Partial<AppConfig>): void {
    Object.assign(this.config, patch);
    this.save();
  }

  /** Produce a ModelsRegistry view that @berry-agent/models consumes. */
  toModelsRegistry(): ModelsRegistry {
    return {
      providers: this.config.providerInstances,
      models: this.config.models,
      tiers: this.config.tiers,
    };
  }

  // ===== Layer 1: Provider Instances =====

  listProviderInstances(): Array<{ id: string; entry: ProviderInstanceEntry }> {
    return Object.entries(this.config.providerInstances).map(([id, entry]) => ({ id, entry }));
  }

  getProviderInstance(id: string): ProviderInstanceEntry | null {
    return this.config.providerInstances[id] ?? null;
  }

  setProviderInstance(id: string, entry: ProviderInstanceEntry): void {
    this.config.providerInstances[id] = { ...entry, id };
    this.save();
  }

  removeProviderInstance(id: string): void {
    delete this.config.providerInstances[id];
    // Also strip references from models.
    for (const model of Object.values(this.config.models)) {
      model.providers = model.providers.filter(p => p.providerId !== id);
    }
    this.save();
  }

  // ===== Layer 2: Model Bindings =====

  listModels(): Array<{ id: string; entry: ModelEntry }> {
    return Object.entries(this.config.models).map(([id, entry]) => ({ id, entry }));
  }

  getModel(id: string): ModelEntry | null {
    return this.config.models[id] ?? null;
  }

  setModel(id: string, entry: ModelEntry): void {
    this.config.models[id] = { ...entry, id };
    this.save();
  }

  removeModel(id: string): void {
    delete this.config.models[id];
    // Strip from tiers.
    for (const tier of Object.keys(this.config.tiers) as TierId[]) {
      if (this.config.tiers[tier] === id) delete this.config.tiers[tier];
    }
    this.save();
  }

  // ===== Layer 3: Tiers =====

  getTiers(): TierEntry { return { ...this.config.tiers }; }

  setTier(tier: TierId, modelId: string | null): void {
    if (modelId === null) {
      delete this.config.tiers[tier];
    } else {
      this.config.tiers[tier] = modelId;
    }
    this.save();
  }

  // ===== Convenience surface used by agent-manager =====

  /** First model id that has at least one provider (for defaults / fallbacks). */
  firstConfiguredModelId(): string | null {
    for (const [id, model] of Object.entries(this.config.models)) {
      if (model.providers.length > 0) return id;
    }
    return null;
  }

  // ===== Agents =====

  setAgent(id: string, entry: AgentEntry): void {
    const workspace = entry.workspace ?? join(this.appDir, 'agents', id);
    const cleanEntry = cleanAgentEntry({ ...entry, workspace });
    this.config.agents[id] = cleanEntry;
    if (!existsSync(workspace)) {
      mkdirSync(workspace, { recursive: true });
    }
    this.save();
  }

  removeAgent(id: string): void {
    const entry = this.config.agents[id];
    delete this.config.agents[id];
    if (this.config.defaultAgent === id) {
      this.config.defaultAgent = Object.keys(this.config.agents)[0] ?? '';
    }
    this.save();

    // Move the workspace to `agents/.trash/<id>-<timestamp>/` instead of
    // deleting it. Removing an agent in the UI shouldn't also destroy its
    // memory.sqlite / conversation history / user-placed skills — those
    // belong to the human, not to the config entry. Users can `rm -rf` the
    // trash dir themselves, or a future GC sweep can reap it.
    //
    // Not fatal if the move fails: the config entry is already gone, and a
    // stale workspace just becomes another orphan the user can deal with
    // manually.
    const workspace = entry?.workspace ?? join(this.appDir, 'agents', id);
    if (existsSync(workspace)) {
      try {
        const trashRoot = join(this.appDir, 'agents', '.trash');
        if (!existsSync(trashRoot)) mkdirSync(trashRoot, { recursive: true });
        const stamp = new Date().toISOString().replace(/[:.]/g, '-');
        renameSync(workspace, join(trashRoot, `${id}-${stamp}`));
      } catch (err) {
        console.warn(`[agent-trash] failed to move ${workspace} to trash:`, err);
      }
    }
  }

  getAgent(id?: string): AgentEntry | null {
    const agentId = id ?? this.config.defaultAgent;
    return this.config.agents[agentId] ?? null;
  }

  listAgents(): Array<{ id: string; entry: AgentEntry }> {
    return Object.entries(this.config.agents).map(([id, entry]) => ({ id, entry }));
  }

  agentWorkspace(agentId?: string): string {
    const id = agentId ?? this.config.defaultAgent;
    const agent = this.config.agents[id];
    return agent?.workspace ?? join(this.appDir, 'agents', id);
  }

  /**
   * Construct an AgentHome for the given agent id. berry-claw owns the
   * root directory ({@link agentWorkspace}); the SDK's AgentHome owns the
   * internal layout (sessions/events/skills/.mcp.json). Callers that
   * previously reached for `agentSessionsDir` / `agentSkillsDir` /
   * `agentMCPPath` should go through this getter instead so the layout
   * stays a single-source-of-truth on the SDK side.
   */
  agentHome(agentId?: string): AgentHome {
    return new AgentHome(this.agentWorkspace(agentId));
  }

  /** Same as {@link agentHome} but starting from a concrete workspace path. */
  agentHomeFor(workspace: string): AgentHome {
    return new AgentHome(workspace);
  }

  // ===== MCP path resolution (single source of truth) =====
  //
  // The 3-layer `.mcp.json` cascade is addressed here and ONLY here; every
  // consumer (server bootstrap, agent-manager, facts/derive) calls these
  // methods instead of reconstructing `join(..., '.mcp.json')` inline.
  // This keeps the filename constant and path shape in one place.

  /** Path to the global MCP layer (`~/.berry-claw/.mcp.json`). */
  globalMCPPath(): string {
    return join(this.appDir, MCP_CONFIG_FILENAME);
  }

  /**
   * Path to an agent workspace's MCP layer. Delegates to {@link AgentHome}
   * so berry-claw doesn't own the "which filename / which subdir" decision
   * — that lives in the SDK alongside the other agent-local paths.
   */
  agentMCPPath(workspace: string): string {
    return this.agentHomeFor(workspace).mcpConfigPath;
  }

  /** Path to a project's MCP layer (`<projectRoot>/.mcp.json`). */
  projectMCPPath(projectRoot: string): string {
    return join(projectRoot, MCP_CONFIG_FILENAME);
  }

  // ===== Skill market path (single source of truth) =====
  //
  // Global skill pool for skills installed from the Skill Market. Each
  // subdirectory is a self-contained skill package (SKILL.md + resources
  // + berry-claw-written `_meta.json`). Per-agent enable/disable is a
  // product concern; this method just vends the path.

  /** Path to the global skill pool (`~/.berry-claw/skills/`). */
  globalSkillsDir(): string {
    const dir = join(this.appDir, 'skills');
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    return dir;
  }

  /**
   * Per-agent skill pool. Delegates to {@link AgentHome.skillsDir} — the
   * subpath is SDK-owned now, which keeps the skill loader and berry-claw's
   * `listInstalledSkillNamesSync` scanning the same place by construction
   * rather than by matching string literals on both sides. The sibling
   * `skills/drafts/` convention (auto-generated Hermes-style drafts kept
   * invisible until promoted) is unchanged — the loader scans one level
   * deep, so nested subdirs stay out of the index.
   */
  agentSkillsDir(workspace: string): string {
    return this.agentHomeFor(workspace).skillsDir;
  }

  /**
   * Built-in skill pool shipped inside the berry-claw package itself
   * (`<pkg>/skills/builtin/`). These are curated meta-skills — e.g.
   * `skill-authoring`, which teaches agents how to write new skills.
   * Every agent picks them up as global-scoped skills, read-only at
   * runtime (the user's `globalSkillsDir()` is a separate, writable pool).
   *
   * Resolved via `import.meta.url` so the path is correct both in the
   * monorepo and in the published npm package. The package-local copy is
   * created by prepack; the repo-root path is the source of truth in dev.
   */
  builtinSkillsDir(): string {
    const here = dirname(fileURLToPath(import.meta.url));
    const packageLocal = join(here, '../../skills/builtin');
    if (existsSync(packageLocal)) return packageLocal;
    return join(here, '../../../../skills/builtin');
  }

  /**
   * Per-agent session store. Delegates to {@link AgentHome.sessionsDir}; the
   * SDK keeps messages.json and events.jsonl under the same session folder.
   */
  agentSessionsDir(workspace: string): string {
    return this.agentHomeFor(workspace).sessionsDir;
  }

  /** Path to product-managed SDK PromptPack directory (`~/.berry-claw/prompt-packs`). */
  promptPacksDir(): string {
    const dir = join(this.appDir, 'prompt-packs');
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    return dir;
  }

  // ===== Status =====

  get defaultAgent(): string { return this.config.defaultAgent; }

  get isConfigured(): boolean {
    return (
      Object.keys(this.config.providerInstances).length > 0 &&
      Object.keys(this.config.models).length > 0
    );
  }
}

// ============================================================
// Helpers
// ============================================================

/**
 * Type-normalize a parsed config blob. We don't migrate from older schemas
 * — if the file shape is wrong (non-current schemaVersion or missing fields)
 * we throw so the user can fix or wipe the file. Partial fields are defaulted.
 */
function normalize(raw: Partial<AppConfig>): AppConfig {
  if (raw.schemaVersion !== CONFIG_SCHEMA_VERSION) {
    throw new Error(
      `Unsupported config schemaVersion: ${raw.schemaVersion}. ` +
      `Expected ${CONFIG_SCHEMA_VERSION}. Delete ~/.berry-claw/config.json to reset.`,
    );
  }
  return {
    schemaVersion: CONFIG_SCHEMA_VERSION,
    providerInstances: { ...(raw.providerInstances ?? {}) },
    models: { ...(raw.models ?? {}) },
    tiers: { ...(raw.tiers ?? {}) },
    agents: normalizeAgents(raw.agents ?? {}),
    defaultAgent: typeof raw.defaultAgent === 'string' ? raw.defaultAgent : '',
    safetyLevel: raw.safetyLevel,
    safetyClassifier: normalizeSafetyClassifier(raw.safetyClassifier),
    auth: {
      sessionTtlMs: raw.auth?.sessionTtlMs ?? EMPTY_CONFIG.auth.sessionTtlMs,
      challengeTtlMs: raw.auth?.challengeTtlMs ?? EMPTY_CONFIG.auth.challengeTtlMs,
      allowAnonymous: raw.auth?.allowAnonymous ?? EMPTY_CONFIG.auth.allowAnonymous,
    },
  };
}

function normalizeSafetyClassifier(raw: Partial<AppConfig>['safetyClassifier']): AppConfig['safetyClassifier'] | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  return {
    ...(typeof raw.model === 'string' && raw.model.trim() ? { model: raw.model.trim() } : {}),
    ...(typeof raw.enabled === 'boolean' ? { enabled: raw.enabled } : {}),
    ...(typeof raw.skipStage2 === 'boolean' ? { skipStage2: raw.skipStage2 } : {}),
  };
}

function normalizeAgents(rawAgents: Record<string, AgentEntry>): Record<string, AgentEntry> {
  return Object.fromEntries(
    Object.entries(rawAgents).map(([id, entry]) => [id, cleanAgentEntry(entry)]),
  );
}

function cleanAgentEntry(entry: AgentEntry): AgentEntry {
  const {
    name,
    model,
    workspace,
    project,
    tools,
    disabledTools,
    skillDirs,
    disabledSkills,
    enabledSkills,
    reasoningEffort,
    promptPack,
    safetyLevel,
    team,
  } = entry;

  return {
    name,
    model,
    ...(workspace !== undefined ? { workspace } : {}),
    ...(project !== undefined ? { project } : {}),
    ...(tools !== undefined ? { tools } : {}),
    ...(disabledTools !== undefined ? { disabledTools } : {}),
    ...(skillDirs !== undefined ? { skillDirs } : {}),
    ...(disabledSkills !== undefined ? { disabledSkills } : {}),
    ...(enabledSkills !== undefined ? { enabledSkills } : {}),
    ...(reasoningEffort !== undefined ? { reasoningEffort } : {}),
    ...(promptPack !== undefined ? { promptPack } : {}),
    ...(safetyLevel !== undefined ? { safetyLevel } : {}),
    ...(team !== undefined ? { team } : {}),
  };
}
