/**
 * ClawConfig — ~/.berry-claw/config.json
 *
 * berry-claw is a thin BFF over a8s. It stores NO agent/model/provider state
 * — those live in a8s (agents in the control plane; the LLM catalog in a8s's
 * models-template, reached via @berry-agent/client). This file holds only
 * what is genuinely local to the BFF process:
 *   - auth: how it authenticates browser sessions
 *   - a8s: how it reaches the control plane (url + admin token, server-side)
 *
 * It also vends a few local product directories (skill market pool, prompt
 * packs) that are product concerns, not agent state.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { ClawHome } from './claw-home.js';
// ---- config schema (auth + a8s connection only; agents/models live on a8s) ----

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
   * @berry-agent/client over HTTP+token. `token` is the product token the
   * console holds server-side. Falls back to env BERRY_A8S_URL /
   * BERRY_A8S_ADMIN_TOKEN when absent.
   */
  a8s?: { url: string; token?: string };
}

const DEFAULT_SESSION_TTL_MS = 86_400_000;
const DEFAULT_CHALLENGE_TTL_MS = 300_000;

const EMPTY_CONFIG: AppConfig = {
  schemaVersion: CONFIG_SCHEMA_VERSION,
  auth: {
    sessionTtlMs: DEFAULT_SESSION_TTL_MS,
    challengeTtlMs: DEFAULT_CHALLENGE_TTL_MS,
    allowAnonymous: false,
  },
};

/** Type-normalize a parsed config blob. v2 (agent/model state) is rejected. */
function normalizeConfig(raw: Partial<AppConfig>): AppConfig {
  if (raw.schemaVersion !== CONFIG_SCHEMA_VERSION) {
    throw new Error(
      `Unsupported config schemaVersion: ${raw.schemaVersion}. Expected ${CONFIG_SCHEMA_VERSION}. `
      + `Delete ~/.berry-claw/config.json to reset (agents/models now live on a8s).`,
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

const DEFAULT_APP_DIR = process.env.BERRY_CLAW_HOME ?? join(homedir(), '.berry-claw');

export interface ClawConfigOptions {
  appDir?: string;
}

export class ClawConfig {
  private config: AppConfig;
  private readonly home: ClawHome;
  readonly appDir: string;
  readonly configPath: string;

  constructor(options: ClawConfigOptions = {}) {
    this.home = new ClawHome(options.appDir ?? DEFAULT_APP_DIR);
    this.appDir = this.home.appDir;
    this.configPath = this.home.configPath;
    this.home.ensureRoot();

    if (existsSync(this.configPath)) {
      const raw = readFileSync(this.configPath, 'utf-8');
      this.config = normalizeConfig(JSON.parse(raw) as Partial<AppConfig>);
    } else {
      this.config = { ...EMPTY_CONFIG };
      this.save();
    }
  }

  get(): AppConfig { return structuredClone(this.config); }

  save(): void {
    writeFileSync(this.configPath, JSON.stringify(this.config, null, 2), 'utf-8');
  }

  update(patch: Partial<AppConfig>): void {
    Object.assign(this.config, patch);
    this.save();
  }

  // ----- auth -----
  get auth(): AppConfig['auth'] { return { ...this.config.auth }; }

  // ----- a8s connection (url + token; falls back to env) -----
  get a8s(): { url: string; token?: string } {
    return {
      url: this.config.a8s?.url ?? process.env.BERRY_A8S_URL ?? 'http://localhost:8080',
      token: this.config.a8s?.token ?? process.env.BERRY_A8S_ADMIN_TOKEN,
    };
  }
}
