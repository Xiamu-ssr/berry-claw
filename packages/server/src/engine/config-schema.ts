// ============================================================
// berry-claw — BFF-local config (thin)
// ============================================================
// berry-claw is a thin BFF over a8s. It owns NO agent/model state: agents,
// providers, models, and tiers all live in a8s (agents via the control
// plane; the LLM catalog via a8s's models-template, read/written through
// @berry-agent/client). The only things genuinely local to this process are:
//   - how it authenticates browser sessions (auth)
//   - how it reaches a8s (a8s url + admin token, held server-side)
//
// Everything the old monolithic berry-claw stored here (providerInstances /
// models / tiers / agents / safety) moved to a8s when agents moved there.

export const CONFIG_SCHEMA_VERSION = 3 as const;
export type ConfigSchemaVersion = typeof CONFIG_SCHEMA_VERSION;

export interface AppConfig {
  schemaVersion: ConfigSchemaVersion;
  auth: {
    sessionTtlMs: number;
    challengeTtlMs: number;
    allowAnonymous: boolean;
  };
  /**
   * a8s control-plane connection. The BFF reaches a8s only through
   * @berry-agent/client over HTTP+token. `token` is the admin/bootstrap
   * secret the BFF holds server-side and never sends to the browser.
   * Falls back to env BERRY_A8S_URL / BERRY_A8S_ADMIN_TOKEN when absent.
   */
  a8s?: {
    url: string;
    token?: string;
  };
}

const DEFAULT_SESSION_TTL_MS = 86_400_000;
const DEFAULT_CHALLENGE_TTL_MS = 300_000;

export const EMPTY_CONFIG: AppConfig = {
  schemaVersion: CONFIG_SCHEMA_VERSION,
  auth: {
    sessionTtlMs: DEFAULT_SESSION_TTL_MS,
    challengeTtlMs: DEFAULT_CHALLENGE_TTL_MS,
    allowAnonymous: false,
  },
};

/**
 * Type-normalize a parsed config blob. We don't migrate from older schemas:
 * if the file shape is wrong, throw so the user can fix or wipe the file.
 * (v2 → v3 dropped all agent/model state; a stale v2 file is rejected.)
 */
export function normalizeConfig(raw: Partial<AppConfig>): AppConfig {
  if (raw.schemaVersion !== CONFIG_SCHEMA_VERSION) {
    throw new Error(
      `Unsupported config schemaVersion: ${raw.schemaVersion}. `
      + `Expected ${CONFIG_SCHEMA_VERSION}. Delete ~/.berry-claw/config.json to reset `
      + `(agents/models/providers now live in a8s, not this file).`,
    );
  }
  return {
    schemaVersion: CONFIG_SCHEMA_VERSION,
    auth: {
      sessionTtlMs: raw.auth?.sessionTtlMs ?? EMPTY_CONFIG.auth.sessionTtlMs,
      challengeTtlMs: raw.auth?.challengeTtlMs ?? EMPTY_CONFIG.auth.challengeTtlMs,
      allowAnonymous: raw.auth?.allowAnonymous ?? EMPTY_CONFIG.auth.allowAnonymous,
    },
    ...(raw.a8s?.url ? { a8s: { url: raw.a8s.url, token: raw.a8s.token } } : {}),
  };
}
