/**
 * Config Manager — ~/.berry-claw/config.json
 *
 * 3-layer schema:
 *   providerInstances:  Layer 1 (where apiKey lives)
 *   models:             Layer 2 (model-first aggregation + failover order)
 *   tiers:              Layer 3 (strong / balanced / fast → modelId)
 *   agents[].model:     "tier:X" | "model:X" | "raw:..." | bare modelId
 *
 * No legacy compatibility: configs that don't match this shape are either
 * empty (fresh install) or corrupt (user runs the migration script once and
 * we're done). We keep the file strictly typed to catch drift early.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import type { ProviderConfig } from '@berry-agent/core';
import type {
  ProviderInstance,
  ModelBinding,
  TierId,
  ModelsRegistry,
} from '@berry-agent/models';
import { RAW_PRESET_ID, getPreset } from '@berry-agent/models';
import { MCP_CONFIG_FILENAME } from './mcp-constants.js';

/**
 * Current on-disk schema version for `~/.berry-claw/config.json`.
 * Anything else is rejected by {@link ConfigManager}'s normalizer. Bump
 * this when the schema changes AND update the migration tool.
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
  systemPrompt?: string;
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
   *   - project/AGENTS.md (or PROJECT.md) is prepended to system prompt
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
  /**
   * @deprecated Use `enabledSkills` + global skill market. Kept for backward
   * compatibility with existing agent entries. Still flows through to SDK's
   * `disabledSkills` as an additional blacklist.
   */
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
  reasoningEffort?: 'none' | 'low' | 'medium' | 'high' | 'max';

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
}

const DEFAULT_APP_DIR = join(homedir(), '.berry-claw');

const EMPTY_CONFIG: AppConfig = {
  schemaVersion: CONFIG_SCHEMA_VERSION,
  providerInstances: {},
  models: {},
  tiers: {},
  agents: {},
  defaultAgent: '',
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

  // ===== Convenience / legacy surface used by agent-manager =====

  /**
   * Build a bare-metal ProviderConfig from a user-facing model id by picking
   * the first provider in its binding. Used as a fallback or by code that
   * cannot yet go through selectProvider(). Returns null when the model id
   * has no providers configured.
   */
  toProviderConfig(modelId?: string): ProviderConfig | null {
    const id = modelId ?? this.firstConfiguredModelId();
    if (!id) return null;
    const binding = this.config.models[id];
    if (!binding || binding.providers.length === 0) return null;
    const ref = binding.providers[0]!;
    const instance = this.config.providerInstances[ref.providerId];
    if (!instance) return null;
    return buildProviderConfigFromInstance(instance, ref.remoteModelId ?? id);
  }

  /** First model id that has at least one provider (for defaults / fallbacks). */
  firstConfiguredModelId(): string | null {
    for (const [id, model] of Object.entries(this.config.models)) {
      if (model.providers.length > 0) return id;
    }
    return null;
  }

  // ===== Agents =====

  setAgent(id: string, entry: AgentEntry): void {
    if (!entry.workspace) {
      entry.workspace = join(this.appDir, 'agents', id);
    }
    this.config.agents[id] = entry;
    if (!existsSync(entry.workspace)) {
      mkdirSync(entry.workspace, { recursive: true });
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

  /** Path to an agent workspace's MCP layer (`<workspace>/.mcp.json`). */
  agentMCPPath(workspace: string): string {
    return join(workspace, MCP_CONFIG_FILENAME);
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
   * Per-agent skill pool (`<workspace>/skills/`). Scanned one level deep by
   * the SDK and by {@link listInstalledSkillNamesSync}, so the sibling
   * `<workspace>/skills/drafts/` subtree stays invisible to the agent until
   * a skill is promoted out of it — that convention is how auto-generated
   * (Hermes-style) skill drafts live without polluting system prompt.
   */
  agentSkillsDir(workspace: string): string {
    return join(workspace, 'skills');
  }

  /**
   * Per-agent conversation store (`<workspace>/.berry/conversations/`),
   * where `FileSessionStore` persists the message array used to resume
   * chats. Intentionally distinct from the SDK-owned
   * `<workspace>/.berry/sessions/` (JsonlEventLog for audit/replay) so
   * the two data shapes never collide on disk.
   */
  agentConversationsDir(workspace: string): string {
    return join(workspace, '.berry', 'conversations');
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

function buildProviderConfigFromInstance(
  instance: ProviderInstance,
  model: string,
): ProviderConfig {
  const preset = getPreset(instance.presetId);
  if (instance.presetId === RAW_PRESET_ID) {
    return {
      type: instance.type ?? 'openai',
      baseUrl: instance.baseUrl,
      apiKey: instance.apiKey,
      model,
    };
  }
  return {
    type: preset?.type ?? instance.type ?? 'openai',
    baseUrl: instance.baseUrl ?? preset?.baseUrl,
    apiKey: instance.apiKey,
    model,
  };
}

/**
 * Type-normalize a parsed config blob. We don't migrate from older schemas
 * — if the file shape is wrong (non-current schemaVersion or missing fields)
 * we throw so the user can fix or wipe the file. Partial fields are defaulted.
 */
function normalize(raw: Partial<AppConfig>): AppConfig {
  if (raw.schemaVersion !== CONFIG_SCHEMA_VERSION) {
    throw new Error(
      `Unsupported config schemaVersion: ${raw.schemaVersion}. ` +
      `Expected ${CONFIG_SCHEMA_VERSION}. Delete ~/.berry-claw/config.json to reset, or run the migration tool.`,
    );
  }
  return {
    schemaVersion: CONFIG_SCHEMA_VERSION,
    providerInstances: { ...(raw.providerInstances ?? {}) },
    models: { ...(raw.models ?? {}) },
    tiers: { ...(raw.tiers ?? {}) },
    agents: { ...(raw.agents ?? {}) },
    defaultAgent: typeof raw.defaultAgent === 'string' ? raw.defaultAgent : '',
  };
}
