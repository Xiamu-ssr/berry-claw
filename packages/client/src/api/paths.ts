/**
 * Berry-Claw — API path registry.
 *
 * Single source of truth for every `/api/*` endpoint the frontend talks to.
 * Keeping paths here lets us rename routes without grepping across 30+ files
 * and makes the server surface one grep away.
 *
 * Convention:
 * - Static paths are relative string constants (e.g. `/api/config`).
 * - Parameterized paths are functions that take the ids and return the path.
 * - WebSocket / SSE endpoints live beside their REST siblings.
 *
 * Paths here are **relative** — `apiFetch` prepends the active instance's
 * `apiBase` at call time. This keeps the registry a pure constant and lets
 * the user switch instances without rebuilding anything.
 */
import { getActiveInstance } from '../connection/store';
import { ensureToken, refreshToken, AuthFlowError } from '../connection/authFlow';

class NoActiveInstanceError extends Error {
  constructor() {
    super('No active berry-claw instance. Add one in Settings → Connections.');
    this.name = 'NoActiveInstanceError';
  }
}

function headersToObject(init: HeadersInit | undefined): Record<string, string> {
  if (!init) return {};
  if (init instanceof Headers) {
    const out: Record<string, string> = {};
    init.forEach((v, k) => (out[k] = v));
    return out;
  }
  if (Array.isArray(init)) {
    return Object.fromEntries(init);
  }
  return { ...(init as Record<string, string>) };
}

/**
 * `apiFetch` is the universal authenticated fetch wrapper. Every REST call
 * from the client goes through it so:
 *
 *   - Dynamic apiBase — picks up whichever instance the user has active
 *     without re-building the bundle or touching a global.
 *   - Single place to attach the `Authorization: Bearer <token>` header.
 *   - 401 path: the server might have rotated keys / TTL'd the session token
 *     out from under us. We drop the cached token, re-run challenge/verify
 *     once, and retry the request. Only once — a second 401 means the key
 *     itself is wrong, which the UI should surface.
 *
 * Callers may pass either a relative path (preferred, from the `API` registry)
 * or a fully-qualified URL (rare, used when something else supplies the URL
 * already — we then assume auth was already handled externally or is
 * unnecessary, and we still try to attach a token if we can recognise the
 * origin).
 */
export async function apiFetch(
  input: RequestInfo | URL,
  init: RequestInit = {},
): Promise<Response> {
  const instance = getActiveInstance();
  if (!instance) throw new NoActiveInstanceError();

  const pathOrUrl = typeof input === 'string' ? input : input.toString();
  const isRelative = pathOrUrl.startsWith('/');
  const url = isRelative ? `${instance.apiBase}${pathOrUrl}` : pathOrUrl;

  const baseHeaders = headersToObject(init.headers);

  async function doFetch(token: string): Promise<Response> {
    return fetch(url, {
      ...init,
      headers: { ...baseHeaders, Authorization: `Bearer ${token}` },
    });
  }

  let token: string;
  try {
    token = await ensureToken(instance);
  } catch (err) {
    // Surface auth errors verbatim — the caller / UI decides how to render.
    throw err instanceof AuthFlowError
      ? err
      : new AuthFlowError(err instanceof Error ? err.message : String(err));
  }

  let res = await doFetch(token);
  if (res.status === 401) {
    // Session invalidated server-side (e.g. restart, key reset). One retry
    // with a fresh challenge; if that also 401s we bubble up the response
    // so callers can route it to the auth-error surface.
    try {
      token = await refreshToken(instance);
    } catch {
      return res;
    }
    res = await doFetch(token);
  }
  return res;
}

// ----- Config / credentials / providers -----

export const API = {
  // Config root
  config: '/api/config',
  configStatus: '/api/config/status',
  configPresets: '/api/config/presets',

  // Provider instances
  providerInstances: '/api/config/provider-instances',
  providerInstance: (id: string) => `/api/config/provider-instances/${encodeURIComponent(id)}`,
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
  credential: (key: string) => `/api/credentials/${encodeURIComponent(key)}`,

  // Active-agent model switching (chat header widget)
  models: '/api/models',
  modelsSwitch: '/api/models/switch',
  promptPacks: '/api/prompt-packs',

  // Agents
  agents: '/api/agents',
  agentStatuses: '/api/agents/statuses',
  agent: (id: string) => `/api/agents/${encodeURIComponent(id)}`,
  agentActivate: (id: string) => `/api/agents/${encodeURIComponent(id)}/activate`,
  agentInspect: (id: string) => `/api/agents/${encodeURIComponent(id)}/inspect`,
  agentContextSize: (id: string, sessionId?: string) =>
    `/api/agents/${encodeURIComponent(id)}/context-size` +
    (sessionId ? `?sessionId=${encodeURIComponent(sessionId)}` : ''),
  agentPromptBlock: (id: string, blockId: string) =>
    `/api/agents/${encodeURIComponent(id)}/prompt-blocks/${encodeURIComponent(blockId)}`,
  agentMemory: (id: string) => `/api/agents/${encodeURIComponent(id)}/memory`,
  agentProjectKnowledge: (id: string) => `/api/agents/${encodeURIComponent(id)}/project/knowledge`,

  // Teams (keyed by leader agent id)
  agentTeam: (leaderId: string) => `/api/agents/${encodeURIComponent(leaderId)}/team`,
  agentTeamStart: (leaderId: string) => `/api/agents/${encodeURIComponent(leaderId)}/team/start`,
  agentTeamMessages: (leaderId: string) =>
    `/api/agents/${encodeURIComponent(leaderId)}/team/messages`,
  agentTeamWorklist: (leaderId: string) =>
    `/api/agents/${encodeURIComponent(leaderId)}/team/worklist`,

  // Sessions
  sessions: '/api/sessions',
  sessionTodos: (id: string, agentId?: string) =>
    `/api/sessions/${encodeURIComponent(id)}/todos` +
    (agentId ? `?agentId=${encodeURIComponent(agentId)}` : ''),

  // Observe (namespace; observe UI has its own path registry)
  observe: '/api/observe',

  // Teams listing (currently unused but reserved)
  teams: '/api/teams',

  // Skill Market — global skill pool + external sources (ClawHub / GitHub).
  skillsSources: '/api/skills/sources',
  skillsAvailable: (source: string, q?: string) =>
    `/api/skills/available?source=${encodeURIComponent(source)}` +
    (q ? `&q=${encodeURIComponent(q)}` : ''),
  skillsInstalled: '/api/skills/installed',
  skillsInstall: '/api/skills/install',
  skillsRemove: (name: string) => `/api/skills/${encodeURIComponent(name)}`,

  // MCP enable/disable — single-server toggle for both shared (global) and
  // per-agent MCP entries. Body: { enabled: boolean }. Enable = reconnect
  // against the current `.mcp.json` cascade; disable = disconnect and mark
  // runtime `disabled` (file stays the persistent source of truth). Success
  // refreshes SystemFact (shared) or AgentFact.mcp (per-agent) over the fact
  // WS, so no extra GET is needed.
  mcpSharedEnabled: (name: string) => `/api/mcp/shared/${encodeURIComponent(name)}/enabled`,
  agentMcpEnabled: (agentId: string, name: string) =>
    `/api/mcp/agent/${encodeURIComponent(agentId)}/${encodeURIComponent(name)}/enabled`,

  // Safety — three-tier mode (trust / default / auto) with cascade
  // agent > project > global. Per-agent uses PATCH /api/agents/:id
  // with { safetyLevel }; the endpoints below cover the other two layers
  // plus a single snapshot GET that the Agents tab dropdown needs.
  safety: '/api/safety',
  safetyGlobal: '/api/safety/global',
  safetyProject: '/api/safety/project',
  safetyAsk: '/api/safety/ask',
  safetyAskResolve: (id: string) => `/api/safety/ask/${encodeURIComponent(id)}`,
} as const;
