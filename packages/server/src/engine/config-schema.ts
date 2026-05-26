import type {
  ModelBinding,
  ProviderInstance,
  TierId,
} from '@berry-agent/models';
import type { SafetyLevel } from '@berry-agent/safe/levels';
import { zAgentEntry, type AgentEntry as ContractAgentEntry } from '@berry-agent/claw-contracts';

/**
 * Current on-disk schema version for `~/.berry-claw/config.json`.
 * Anything else is rejected by normalizer. Bump this when the schema changes.
 */
export const CONFIG_SCHEMA_VERSION = 2 as const;
export type ConfigSchemaVersion = typeof CONFIG_SCHEMA_VERSION;

/** Layer 1 — stored form (on disk). Same shape as ProviderInstance. */
export type ProviderInstanceEntry = ProviderInstance;

/** Layer 2 — stored form. */
export type ModelEntry = ModelBinding;

/** Layer 3 — partial by design; setup wizard enforces completeness. */
export type TierEntry = Partial<Record<TierId, string>>;

/**
 * Product-owned agent registry row. The field contract lives in
 * @berry-agent/claw-contracts so config files, REST handlers, and client code
 * cannot drift into parallel AgentEntry shapes.
 */
export type AgentEntry = ContractAgentEntry;

export interface AppConfig {
  schemaVersion: ConfigSchemaVersion;
  providerInstances: Record<string, ProviderInstanceEntry>;
  models: Record<string, ModelEntry>;
  tiers: TierEntry;
  agents: Record<string, AgentEntry>;
  defaultAgent: string;
  /**
   * Global (app-wide) fallback safety level. Used when neither the agent
   * entry nor SDK project safety specifies one. Undefined
   * means "no opinion" -> the resolver falls through to its 'default' floor.
   */
  safetyLevel?: SafetyLevel;
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

const DEFAULT_SESSION_TTL_MS = 86_400_000;
const DEFAULT_CHALLENGE_TTL_MS = 300_000;

export const EMPTY_CONFIG: AppConfig = {
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

/**
 * Type-normalize a parsed config blob. We don't migrate from older schemas:
 * if the file shape is wrong, throw so the user can fix or wipe the file.
 */
export function normalizeConfig(raw: Partial<AppConfig>): AppConfig {
  if (raw.schemaVersion !== CONFIG_SCHEMA_VERSION) {
    throw new Error(
      `Unsupported config schemaVersion: ${raw.schemaVersion}. `
      + `Expected ${CONFIG_SCHEMA_VERSION}. Delete ~/.berry-claw/config.json to reset.`,
    );
  }
  return {
    schemaVersion: CONFIG_SCHEMA_VERSION,
    providerInstances: { ...(raw.providerInstances ?? {}) },
    models: normalizeModels(raw.models ?? {}),
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

export function cleanAgentEntry(entry: unknown): AgentEntry {
  const parsed = zAgentEntry.parse(entry);
  return Object.fromEntries(
    Object.entries(parsed).filter(([, value]) => value !== undefined),
  ) as AgentEntry;
}

function normalizeSafetyClassifier(raw: Partial<AppConfig>['safetyClassifier']): AppConfig['safetyClassifier'] | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  return {
    ...(typeof raw.model === 'string' && raw.model.trim() ? { model: raw.model.trim() } : {}),
    ...(typeof raw.enabled === 'boolean' ? { enabled: raw.enabled } : {}),
    ...(typeof raw.skipStage2 === 'boolean' ? { skipStage2: raw.skipStage2 } : {}),
  };
}

function normalizeModels(rawModels: Record<string, ModelEntry>): Record<string, ModelEntry> {
  return Object.fromEntries(
    Object.entries(rawModels).map(([id, entry]) => {
      const contextWindow = typeof entry.contextWindow === 'number'
        && Number.isFinite(entry.contextWindow)
        && entry.contextWindow >= 4_000
        && entry.contextWindow <= 10_000_000
        ? Math.floor(entry.contextWindow)
        : undefined;
      return [id, {
        ...entry,
        id,
        ...(contextWindow ? { contextWindow } : {}),
      }];
    }),
  );
}

function normalizeAgents(rawAgents: Record<string, unknown>): Record<string, AgentEntry> {
  return Object.fromEntries(
    Object.entries(rawAgents).map(([id, entry]) => [id, cleanAgentEntry(entry)]),
  );
}
