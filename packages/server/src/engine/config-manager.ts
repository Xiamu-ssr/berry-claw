/**
 * Config Manager — ~/.berry-claw/config.json
 *
 * 3-layer schema:
 *   providerInstances:  Layer 1 (where apiKey lives)
 *   models:             Layer 2 (model-first aggregation + failover order)
 *   tiers:              Layer 3 (strong / balanced / fast → modelId)
 *   agents[].model:     "tier:X" | "model:X" | bare modelId
 *
 * Current-schema only: configs that don't match this shape are either empty
 * (fresh install) or corrupt. We keep the file strictly typed to catch drift
 * early.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { AgentHome } from '@berry-agent/core';
import type { ModelsRegistry, TierId } from '@berry-agent/models';
import { ClawHome, ensureDir } from './claw-home.js';
import {
  cleanAgentEntry,
  EMPTY_CONFIG,
  normalizeConfig,
  type AgentEntry,
  type AppConfig,
  type ModelEntry,
  type ProviderInstanceEntry,
  type TierEntry,
} from './config-schema.js';
export {
  CONFIG_SCHEMA_VERSION,
  type AgentEntry,
  type AppConfig,
  type ConfigSchemaVersion,
  type ModelEntry,
  type ProviderInstanceEntry,
  type TierEntry,
} from './config-schema.js';

const DEFAULT_APP_DIR = process.env.BERRY_CLAW_HOME ?? join(homedir(), '.berry-claw');

export interface ConfigManagerOptions {
  appDir?: string;
}

export class ConfigManager {
  private config: AppConfig;
  private readonly home: ClawHome;
  readonly appDir: string;
  readonly configPath: string;

  constructor(options: ConfigManagerOptions = {}) {
    this.home = new ClawHome(options.appDir ?? DEFAULT_APP_DIR);
    this.appDir = this.home.appDir;
    this.configPath = this.home.configPath;
    this.home.ensureRoot();

    if (existsSync(this.configPath)) {
      const raw = readFileSync(this.configPath, 'utf-8');
      const parsed = JSON.parse(raw) as Partial<AppConfig>;
      this.config = normalizeConfig(parsed);
    } else {
      this.config = { ...EMPTY_CONFIG };
      this.save();
    }

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
    const workspace = entry.workspace ?? this.home.ensureAgentWorkspace(id);
    const cleanEntry = cleanAgentEntry({ ...entry, workspace });
    this.config.agents[id] = cleanEntry;
    ensureDir(workspace);
    this.save();
  }

  removeAgent(id: string): void {
    delete this.config.agents[id];
    if (this.config.defaultAgent === id) {
      this.config.defaultAgent = Object.keys(this.config.agents)[0] ?? '';
    }
    this.save();
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
    return agent?.workspace ?? this.home.agentWorkspace(id);
  }

  /**
   * Construct an AgentHome for the given agent id. berry-claw owns only the
   * root directory ({@link agentWorkspace}); the SDK's AgentHome owns every
   * internal path below it.
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
    return this.home.globalMCPPath();
  }

  /** Path to a project's MCP layer (`<projectRoot>/.mcp.json`). */
  projectMCPPath(projectRoot: string): string {
    return this.home.projectMCPPath(projectRoot);
  }

  // ===== Skill market path (single source of truth) =====
  //
  // Global skill pool for skills installed from the Skill Market. Each
  // subdirectory is a self-contained skill package (SKILL.md + resources
  // + berry-claw-written `_meta.json`). Per-agent enable/disable is a
  // product concern; this method just vends the path.

  /** Path to the global skill pool (`~/.berry-claw/skills/`). */
  globalSkillsDir(): string {
    return this.home.globalSkillsDir();
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
    return this.home.builtinSkillsDir();
  }

  /** Path to product-managed SDK PromptPack directory (`~/.berry-claw/prompt-packs`). */
  promptPacksDir(): string {
    return this.home.promptPacksDir();
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
