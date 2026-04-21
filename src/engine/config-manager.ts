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
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
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
  workspace?: string;
  tools?: string[];
  disabledTools?: string[];
  skillDirs?: string[];
  disabledSkills?: string[];
}

export interface AppConfig {
  schemaVersion: 2;
  providerInstances: Record<string, ProviderInstanceEntry>;
  models: Record<string, ModelEntry>;
  tiers: TierEntry;
  agents: Record<string, AgentEntry>;
  defaultAgent: string;
}

const APP_DIR = join(homedir(), '.berry-claw');
const CONFIG_PATH = join(APP_DIR, 'config.json');

const EMPTY_CONFIG: AppConfig = {
  schemaVersion: 2,
  providerInstances: {},
  models: {},
  tiers: {},
  agents: {},
  defaultAgent: '',
};

export class ConfigManager {
  private config: AppConfig;
  readonly appDir: string;
  readonly configPath: string;

  constructor() {
    this.appDir = APP_DIR;
    this.configPath = CONFIG_PATH;

    if (!existsSync(APP_DIR)) mkdirSync(APP_DIR, { recursive: true });

    if (existsSync(CONFIG_PATH)) {
      const raw = readFileSync(CONFIG_PATH, 'utf-8');
      const parsed = JSON.parse(raw) as Partial<AppConfig>;
      this.config = normalize(parsed);
    } else {
      this.config = { ...EMPTY_CONFIG };
      this.save();
    }

    const agentsDir = join(APP_DIR, 'agents');
    if (!existsSync(agentsDir)) mkdirSync(agentsDir, { recursive: true });
  }

  // ===== Core =====

  get(): AppConfig { return structuredClone(this.config); }

  save(): void {
    writeFileSync(CONFIG_PATH, JSON.stringify(this.config, null, 2), 'utf-8');
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
    return agent?.workspace ?? join(this.appDir, 'agents', id);
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
 * — if the file shape is wrong (non-2 schemaVersion or missing fields) we
 * throw so the user can fix or wipe the file. Partial fields are defaulted.
 */
function normalize(raw: Partial<AppConfig>): AppConfig {
  if (raw.schemaVersion !== 2) {
    throw new Error(
      `Unsupported config schemaVersion: ${raw.schemaVersion}. ` +
      `Expected 2. Delete ~/.berry-claw/config.json to reset, or run the migration tool.`,
    );
  }
  return {
    schemaVersion: 2,
    providerInstances: { ...(raw.providerInstances ?? {}) },
    models: { ...(raw.models ?? {}) },
    tiers: { ...(raw.tiers ?? {}) },
    agents: { ...(raw.agents ?? {}) },
    defaultAgent: typeof raw.defaultAgent === 'string' ? raw.defaultAgent : '',
  };
}
