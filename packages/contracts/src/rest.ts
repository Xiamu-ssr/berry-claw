import { z } from 'zod';
import {
  zAgentFact,
  zFactChange,
  zInstalledSkill,
  zReasoningEffort,
  zSkillMarketItem,
  zSystemFact,
  zTeamFact,
} from './facts.js';
import { zAgentSessionView } from '@berry-agent/core/chat-schema';
import {
  TIER_IDS,
  modelBindingSchema,
  modelProviderRefSchema,
  providerInstanceSchema,
  providerTypeSchema,
} from '@berry-agent/models';
import { zTeamMessage, zTeamState, zWorklistTask } from '@berry-agent/team';
import type {
  ModelBinding,
  ModelProviderRef,
  ProviderInstance,
  ProviderPreset,
  TierId,
} from '@berry-agent/models';
import type { TeamMessage, TeamState, WorklistTask, WorklistTaskStatus } from '@berry-agent/team';
import { zSafetyLevel } from './safety.js';

export type { TeamMessage, TeamState, WorklistTask, WorklistTaskStatus } from '@berry-agent/team';

export const zFactsResponse = z.object({
  changes: z.array(zFactChange),
});
export type FactsResponse = z.infer<typeof zFactsResponse>;

export const zAgentTeamMarker = z.object({
  leaderId: z.string().min(1),
  role: z.string().min(1),
}).strict();
export type AgentTeamMarker = z.infer<typeof zAgentTeamMarker>;

export const zAgentEntry = z.object({
  name: z.string().min(1),
  model: z.string().min(1),
  workspace: z.string().optional(),
  project: z.string().optional(),
  tools: z.array(z.string()).optional(),
  disabledTools: z.array(z.string()).optional(),
  skillDirs: z.array(z.string()).optional(),
  disabledSkills: z.array(z.string()).optional(),
  enabledSkills: z.array(z.string()).optional(),
  reasoningEffort: zReasoningEffort.optional(),
  promptPack: z.string().optional(),
  safetyLevel: zSafetyLevel.optional(),
  team: zAgentTeamMarker.optional(),
}).strict();
export type AgentEntry = z.infer<typeof zAgentEntry>;

export const zAgentsResponse = z.object({
  agents: z.array(z.object({ id: z.string(), entry: zAgentEntry })),
  activeAgent: z.string(),
});
export type AgentsResponse = z.infer<typeof zAgentsResponse>;

export const zFactSnapshot = z.object({
  agents: z.array(zAgentFact).optional(),
  teams: z.array(zTeamFact).optional(),
  system: zSystemFact.optional(),
});
export type FactSnapshot = z.infer<typeof zFactSnapshot>;

export const zTierId = z.enum(TIER_IDS as readonly ['strong', 'balanced', 'fast']);
export type ConfigTierId = TierId;

export const zModelProviderRef = modelProviderRefSchema;
export type ConfigModelProviderRef = ModelProviderRef;

export const zProviderType = providerTypeSchema;

export const zProviderInstance = providerInstanceSchema.extend({
  id: z.string().min(1),
  apiKey: z.string(),
  type: zProviderType.optional(),
});
export type ConfigProviderInstance = ProviderInstance;

export const zModelBinding = modelBindingSchema.extend({
  id: z.string().min(1),
});
export type ConfigModelBinding = ModelBinding;

export const zTiers = z.object({
  strong: z.string().optional(),
  balanced: z.string().optional(),
  fast: z.string().optional(),
});
export type ConfigTiers = Partial<Record<TierId, string>>;

export const zSafetyClassifierConfig = z.object({
  model: z.string().optional(),
  enabled: z.boolean().optional(),
  skipStage2: z.boolean().optional(),
});
export type SafetyClassifierConfig = z.infer<typeof zSafetyClassifierConfig>;

export const zConfigResponse = z.object({
  schemaVersion: z.literal(2),
  providerInstances: z.record(zProviderInstance),
  models: z.record(zModelBinding),
  tiers: zTiers,
  agents: z.record(zAgentEntry),
  defaultAgent: z.string(),
  safetyClassifier: zSafetyClassifierConfig.nullable().optional(),
});
export type ConfigResponse = z.infer<typeof zConfigResponse>;

export const zConfigStatusResponse = z.object({
  configured: z.boolean(),
  firstModel: z.string().nullable(),
  tiers: zTiers,
});
export type ConfigStatusResponse = z.infer<typeof zConfigStatusResponse>;

export const zProviderInstanceUpsertRequest = z.object({
  presetId: z.string().min(1),
  apiKey: z.string().optional(),
  baseUrl: z.string().optional(),
  type: zProviderType.optional(),
  knownModels: z.array(z.string()).optional(),
  label: z.string().optional(),
});
export type ProviderInstanceUpsertRequest = z.infer<typeof zProviderInstanceUpsertRequest>;

export const zProviderPreset = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  baseUrl: z.string(),
  type: zProviderType,
  apiKeyDocsUrl: z.string().optional(),
  listModelsPath: z.string().optional(),
  knownModels: z.array(z.string()),
});
export type ConfigProviderPreset = ProviderPreset;

export const zProviderPresetsResponse = z.object({
  presets: z.array(zProviderPreset),
});
export type ProviderPresetsResponse = z.infer<typeof zProviderPresetsResponse>;

export const zProviderInstancesResponse = z.object({
  providerInstances: z.array(z.object({
    id: z.string().min(1),
    entry: zProviderInstance,
  })),
});
export type ProviderInstancesResponse = z.infer<typeof zProviderInstancesResponse>;

export const zProviderModelsResponse = z.object({
  models: z.array(z.string()),
});
export type ProviderModelsResponse = z.infer<typeof zProviderModelsResponse>;

export const zConfigModelsResponse = z.object({
  models: z.array(z.object({
    id: z.string().min(1),
    entry: zModelBinding,
  })),
});
export type ConfigModelsResponse = z.infer<typeof zConfigModelsResponse>;

export const zModelBindingUpsertRequest = z.object({
  providers: z.array(zModelProviderRef).min(1),
  label: z.string().optional(),
  contextWindow: z.union([z.number(), z.string()]).nullable().optional(),
});
export type ModelBindingUpsertRequest = z.infer<typeof zModelBindingUpsertRequest>;

export const zConfigTiersResponse = z.object({
  tiers: zTiers,
});
export type ConfigTiersResponse = z.infer<typeof zConfigTiersResponse>;

export const zTierUpdateRequest = z.object({
  modelId: z.string().nullable().optional(),
});
export type TierUpdateRequest = z.infer<typeof zTierUpdateRequest>;

export const zCredentialUpdateRequest = z.object({
  value: z.string().min(1),
}).strict();
export type CredentialUpdateRequest = z.infer<typeof zCredentialUpdateRequest>;

export const zModelSwitchRequest = z.object({
  model: z.string().min(1),
}).strict();
export type ModelSwitchRequest = z.infer<typeof zModelSwitchRequest>;

export const zAgentUpsertRequest = zAgentEntry;
export type AgentUpsertRequest = z.infer<typeof zAgentUpsertRequest>;

export const zAgentPatchRequest = zAgentEntry.partial().strict();
export type AgentPatchRequest = z.infer<typeof zAgentPatchRequest>;

export const zAgentPauseRequest = z.object({
  reason: z.string().optional(),
}).strict();
export type AgentPauseRequest = z.infer<typeof zAgentPauseRequest>;

export const zMcpEnabledRequest = z.object({
  enabled: z.boolean(),
}).strict();
export type McpEnabledRequest = z.infer<typeof zMcpEnabledRequest>;

export const zTeamStartRequest = z.object({
  name: z.string().optional(),
}).strict();
export type TeamStartRequest = z.infer<typeof zTeamStartRequest>;

export const zTeamsResponse = z.object({
  teams: z.array(z.object({
    leaderId: z.string().min(1),
    leaderName: z.string().min(1),
    state: zTeamState,
  })),
});
export type TeamsResponse = {
  teams: Array<{ leaderId: string; leaderName: string; state: TeamState }>;
};

export const zAgentTeamResponse = z.object({
  team: zTeamState.nullable(),
});
export type AgentTeamResponse = { team: TeamState | null };

export const zTeamMessagesResponse = z.object({
  messages: z.array(zTeamMessage),
});
export type TeamMessagesResponse = { messages: TeamMessage[] };

export const zTeamWorklistResponse = z.object({
  tasks: z.array(zWorklistTask),
});
export type TeamWorklistResponse = { tasks: WorklistTask[] };

export const zModelCatalogItem = z.object({
  model: z.string().min(1),
  providerName: z.string(),
  type: z.string(),
  contextWindow: z.number().int().positive().optional(),
});
export type ModelCatalogItem = z.infer<typeof zModelCatalogItem>;

export const zModelsResponse = z.object({
  models: z.array(zModelCatalogItem),
  current: z.string().nullable(),
});
export type ModelsResponse = z.infer<typeof zModelsResponse>;

export const zPromptPackInfo = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string().optional(),
  version: z.string(),
  builtin: z.boolean(),
  path: z.string().optional(),
});
export type PromptPackInfo = z.infer<typeof zPromptPackInfo>;

export const zPromptPacksResponse = z.object({
  promptPacks: z.array(zPromptPackInfo),
});
export type PromptPacksResponse = z.infer<typeof zPromptPacksResponse>;

export const zPromptBlockSource = z.enum([
  'project_context',
  'env',
  'workspace_agent_md',
  'skills_index',
  'custom',
]);
export type PromptBlockSource = z.infer<typeof zPromptBlockSource>;

export const zPromptBlockInfo = z.object({
  id: z.string().min(1),
  source: zPromptBlockSource,
  title: z.string(),
  description: z.string(),
  order: z.number().int(),
  active: z.boolean(),
  scope: z.enum(['base', 'query-time']),
  cache: z.enum(['stable', 'dynamic']),
  editable: z.boolean(),
  path: z.string().optional(),
  text: z.string(),
});
export type PromptBlockInfo = z.infer<typeof zPromptBlockInfo>;

export const zPromptBlocksResponse = z.object({
  promptBlocks: z.array(zPromptBlockInfo),
});
export type PromptBlocksResponse = z.infer<typeof zPromptBlocksResponse>;

export const zPromptBlockUpdateResponse = zPromptBlocksResponse.extend({
  ok: z.literal(true),
});
export type PromptBlockUpdateResponse = z.infer<typeof zPromptBlockUpdateResponse>;

export const zPromptBlockUpdateRequest = z.object({
  content: z.string(),
});
export type PromptBlockUpdateRequest = z.infer<typeof zPromptBlockUpdateRequest>;

export const zAgentMemoryUpdateRequest = z.object({
  content: z.string(),
}).strict();
export type AgentMemoryUpdateRequest = z.infer<typeof zAgentMemoryUpdateRequest>;

export const zSessionsResponse = z.object({
  sessions: z.array(zAgentSessionView),
});
export type SessionsResponse = z.infer<typeof zSessionsResponse>;

export const zSessionCreateRequest = z.object({
  agentId: z.string().optional(),
});
export type SessionCreateRequest = z.infer<typeof zSessionCreateRequest>;

export const zSessionDetailResponse = zAgentSessionView.extend({
  observe: z.unknown().optional(),
});
export type SessionDetailResponse = z.infer<typeof zSessionDetailResponse>;

export const zCredentialItem = z.object({
  key: z.string().min(1),
  category: z.string(),
  provider: z.string(),
  url: z.string(),
  configured: z.boolean(),
  source: z.enum(['env', 'file']).nullable(),
});
export type CredentialItem = z.infer<typeof zCredentialItem>;

export const zCredentialsResponse = z.object({
  credentials: z.array(zCredentialItem),
});
export type CredentialsResponse = z.infer<typeof zCredentialsResponse>;

export const zSafetyAgentLayer = z.object({
  id: z.string().min(1),
  agentLevel: zSafetyLevel.nullable(),
  projectLevel: zSafetyLevel.nullable(),
  projectRoot: z.string().nullable(),
  effective: zSafetyLevel,
});
export type SafetyAgentLayer = z.infer<typeof zSafetyAgentLayer>;

export const zSafetyClassifierSnapshot = z.object({
  enabled: z.boolean(),
  model: z.string().nullable(),
  configuredModel: z.string().nullable(),
  effectiveModel: z.string().nullable().optional(),
  skipStage2: z.boolean(),
});
export type SafetyClassifierSnapshot = z.infer<typeof zSafetyClassifierSnapshot>;

export const zSafetySnapshot = z.object({
  levels: z.array(zSafetyLevel),
  globalLevel: zSafetyLevel.nullable(),
  classifier: zSafetyClassifierSnapshot.optional(),
  agents: z.array(zSafetyAgentLayer),
});
export type SafetySnapshot = z.infer<typeof zSafetySnapshot>;

export const zSafetyGlobalPatchRequest = z.object({
  level: zSafetyLevel.nullable(),
});
export type SafetyGlobalPatchRequest = z.infer<typeof zSafetyGlobalPatchRequest>;

export const zSafetyClassifierPatchRequest = z.object({
  model: z.string().nullable().optional(),
  enabled: z.boolean().optional(),
  skipStage2: z.boolean().optional(),
});
export type SafetyClassifierPatchRequest = z.infer<typeof zSafetyClassifierPatchRequest>;

export const zSafetyProjectPatchRequest = z.object({
  projectRoot: z.string().min(1),
  level: zSafetyLevel.nullable(),
});
export type SafetyProjectPatchRequest = z.infer<typeof zSafetyProjectPatchRequest>;

export const zSafetyAskAnswerRequest = z.object({
  approved: z.boolean(),
  note: z.string().optional(),
}).strict();
export type SafetyAskAnswerRequest = z.infer<typeof zSafetyAskAnswerRequest>;

export const zSkillSourceId = z.enum(['clawhub']);
export type SkillSourceId = z.infer<typeof zSkillSourceId>;

export const zSkillSourceInfo = z.object({
  id: zSkillSourceId,
  displayName: z.string().min(1),
  available: z.boolean(),
});
export type SkillSourceInfo = z.infer<typeof zSkillSourceInfo>;

export const zSkillSourcesResponse = z.object({
  sources: z.array(zSkillSourceInfo),
});
export type SkillSourcesResponse = z.infer<typeof zSkillSourcesResponse>;

export const zSkillsAvailableResponse = z.object({
  items: z.array(zSkillMarketItem),
});
export type SkillsAvailableResponse = z.infer<typeof zSkillsAvailableResponse>;

export const zSkillsInstalledResponse = z.object({
  installed: z.array(zInstalledSkill),
});
export type SkillsInstalledResponse = z.infer<typeof zSkillsInstalledResponse>;

export const zSkillInstallRequest = z.object({
  sourceId: zSkillSourceId,
  slug: z.string().min(1),
}).strict();
export type SkillInstallRequest = z.infer<typeof zSkillInstallRequest>;

export const zSkillInstallResponse = z.object({
  ok: z.literal(true),
  installed: zInstalledSkill,
});
export type SkillInstallResponse = z.infer<typeof zSkillInstallResponse>;

export const zSystemRestartRequest = z.object({
  reason: z.string().optional(),
}).strict();
export type SystemRestartRequest = z.infer<typeof zSystemRestartRequest>;
