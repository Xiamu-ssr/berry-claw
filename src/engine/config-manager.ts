/**
 * Config Manager — ~/.berry-claw/config.json
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import type { ProviderConfig } from '@berry-agent/core';

// ===== Types =====

export interface ProviderEntry {
  type: 'anthropic' | 'openai';
  baseUrl?: string;
  apiKey: string;
  models: string[];
}

export interface AgentEntry {
  name: string;
  systemPrompt?: string;
  model: string;
  workspace?: string;
  tools?: string[];        // tool group names: "file", "shell", "search"
  skillDirs?: string[];
}

export interface AppConfig {
  providers: Record<string, ProviderEntry>;
  agents: Record<string, AgentEntry>;
  defaultModel: string;
  defaultAgent: string;
  workspace: string;       // global default workspace
}

const APP_DIR = join(homedir(), '.berry-claw');
const CONFIG_PATH = join(APP_DIR, 'config.json');

const DEFAULT_CONFIG: AppConfig = {
  providers: {},
  agents: {
    default: {
      name: 'Berry Claw',
      model: '',
      tools: ['file', 'shell', 'search'],
    },
  },
  defaultModel: '',
  defaultAgent: 'default',
  workspace: join(APP_DIR, 'workspace'),
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
      this.config = { ...DEFAULT_CONFIG, ...JSON.parse(raw) };
    } else {
      this.config = { ...DEFAULT_CONFIG };
      this.save();
    }

    if (!existsSync(this.config.workspace)) {
      mkdirSync(this.config.workspace, { recursive: true });
    }
  }

  get(): AppConfig { return { ...this.config }; }

  save(): void {
    writeFileSync(CONFIG_PATH, JSON.stringify(this.config, null, 2), 'utf-8');
  }

  update(patch: Partial<AppConfig>): void {
    Object.assign(this.config, patch);
    this.save();
  }

  // ===== Providers =====

  setProvider(name: string, entry: ProviderEntry): void {
    this.config.providers[name] = entry;
    if (!this.config.defaultModel && entry.models.length > 0) {
      this.config.defaultModel = entry.models[0]!;
      // Also update default agent's model if empty
      const defaultAgent = this.config.agents[this.config.defaultAgent];
      if (defaultAgent && !defaultAgent.model) {
        defaultAgent.model = entry.models[0]!;
      }
    }
    this.save();
  }

  removeProvider(name: string): void {
    delete this.config.providers[name];
    this.save();
  }

  resolveModel(model: string): { providerName: string; provider: ProviderEntry; model: string } | null {
    for (const [name, entry] of Object.entries(this.config.providers)) {
      if (entry.models.includes(model)) {
        return { providerName: name, provider: entry, model };
      }
    }
    return null;
  }

  listModels(): Array<{ model: string; providerName: string; type: string }> {
    const result: Array<{ model: string; providerName: string; type: string }> = [];
    for (const [name, entry] of Object.entries(this.config.providers)) {
      for (const model of entry.models) {
        result.push({ model, providerName: name, type: entry.type });
      }
    }
    return result;
  }

  toProviderConfig(model?: string): ProviderConfig | null {
    const targetModel = model ?? this.config.defaultModel;
    if (!targetModel) return null;
    const resolved = this.resolveModel(targetModel);
    if (!resolved) return null;
    return {
      type: resolved.provider.type,
      apiKey: resolved.provider.apiKey,
      baseUrl: resolved.provider.baseUrl,
      model: resolved.model,
    };
  }

  // ===== Agents =====

  setAgent(id: string, entry: AgentEntry): void {
    this.config.agents[id] = entry;
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

  get workspace(): string { return this.config.workspace; }
  get defaultModel(): string { return this.config.defaultModel; }
  get defaultAgent(): string { return this.config.defaultAgent; }
  get isConfigured(): boolean {
    return Object.keys(this.config.providers).length > 0 && !!this.config.defaultModel;
  }
}
