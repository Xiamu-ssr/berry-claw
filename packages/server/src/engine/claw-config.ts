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
import {
  EMPTY_CONFIG,
  normalizeConfig,
  type AppConfig,
} from './config-schema.js';
export {
  CONFIG_SCHEMA_VERSION,
  type AppConfig,
  type ConfigSchemaVersion,
} from './config-schema.js';

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

  // ----- local product directories (not agent state) -----
  /** Global skill pool for skills installed from a market (`~/.berry-claw/skills/`). */
  globalSkillsDir(): string { return this.home.globalSkillsDir(); }
  /** Built-in skill pool shipped in the package (`<pkg>/skills/builtin/`). */
  builtinSkillsDir(): string { return this.home.builtinSkillsDir(); }
  /** Product-managed SDK PromptPack directory (`~/.berry-claw/prompt-packs`). */
  promptPacksDir(): string { return this.home.promptPacksDir(); }
}
