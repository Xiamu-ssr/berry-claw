/**
 * Berry-Claw — API path registry.
 *
 * Single source of truth for every `/api/*` endpoint the frontend talks to.
 * Keeping paths here lets us rename routes without grepping across 30+ files
 * and makes the server surface one grep away.
 *
 * Convention:
 * - Static paths are string constants.
 * - Parameterized paths are functions that take the ids and return the URL.
 * - WebSocket / SSE endpoints live beside their REST siblings.
 */

// ----- Config / credentials / providers -----

export const API = {
  // Config root
  config: '/api/config',
  configStatus: '/api/config/status',
  configPresets: '/api/config/presets',

  // Provider instances
  providerInstances: '/api/config/provider-instances',
  providerInstance: (id: string) =>
    `/api/config/provider-instances/${encodeURIComponent(id)}`,
  providerInstanceModels: (id: string) =>
    `/api/config/provider-instances/${encodeURIComponent(id)}/models`,

  // Models (registered)
  configModels: '/api/config/models',
  configModel: (id: string) => `/api/config/models/${encodeURIComponent(id)}`,

  // Tiers
  configTiers: '/api/config/tiers',
  configTier: (tier: string) => `/api/config/tiers/${encodeURIComponent(tier)}`,

  // Credentials
  credentials: '/api/credentials',
  credential: (key: string) =>
    `/api/credentials/${encodeURIComponent(key)}`,

  // Active-agent model switching (chat header widget)
  models: '/api/models',
  modelsSwitch: '/api/models/switch',

  // Agents
  agents: '/api/agents',
  agentStatuses: '/api/agents/statuses',
  agent: (id: string) => `/api/agents/${encodeURIComponent(id)}`,
  agentActivate: (id: string) =>
    `/api/agents/${encodeURIComponent(id)}/activate`,
  agentInspect: (id: string) =>
    `/api/agents/${encodeURIComponent(id)}/inspect`,
  agentContextSize: (id: string) =>
    `/api/agents/${encodeURIComponent(id)}/context-size`,
  agentPromptBlock: (id: string, blockId: string) =>
    `/api/agents/${encodeURIComponent(id)}/prompt-blocks/${encodeURIComponent(blockId)}`,
  agentMemory: (id: string) =>
    `/api/agents/${encodeURIComponent(id)}/memory`,
  agentProjectKnowledge: (id: string) =>
    `/api/agents/${encodeURIComponent(id)}/project/knowledge`,

  // Teams (keyed by leader agent id)
  agentTeam: (leaderId: string) =>
    `/api/agents/${encodeURIComponent(leaderId)}/team`,
  agentTeamStart: (leaderId: string) =>
    `/api/agents/${encodeURIComponent(leaderId)}/team/start`,
  agentTeamMessages: (leaderId: string) =>
    `/api/agents/${encodeURIComponent(leaderId)}/team/messages`,
  agentTeamWorklist: (leaderId: string) =>
    `/api/agents/${encodeURIComponent(leaderId)}/team/worklist`,

  // Sessions
  sessions: '/api/sessions',

  // Observe (namespace; observe UI has its own path registry)
  observe: '/api/observe',

  // Teams listing (currently unused but reserved)
  teams: '/api/teams',
} as const;
