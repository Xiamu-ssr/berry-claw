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
  tools?: string[];           // tool groups or tool names (hard whitelist; if omitted, all tools mounted)
  disabledTools?: string[];   // individual tool names to subtract from the mounted set (soft toggle)
  skillDirs?: string[];
  disabledSkills?: string[];  // skill names to hide from load_skill registry
}

export interface AppConfig {
  providers: Record<string, ProviderEntry>;
  agents: Record<string, AgentEntry>;
  defaultModel: string;
  defaultAgent: string;
}

const APP_DIR = join(homedir(), '.berry-claw');
const CONFIG_PATH = join(APP_DIR, 'config.json');

const DEFAULT_CONFIG: AppConfig = {
  providers: {},
  agents: {},
  defaultModel: '',
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
      // Drop legacy 'workspace' field if present
      const parsed = JSON.parse(raw);
      delete parsed.workspace;
      this.config = { ...DEFAULT_CONFIG, ...parsed };
    } else {
      this.config = { ...DEFAULT_CONFIG };
      this.save();
    }

    // Ensure agents directory exists
    const agentsDir = join(APP_DIR, 'agents');
    if (!existsSync(agentsDir)) mkdirSync(agentsDir, { recursive: true });
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

  /** Create or update an agent. Auto-creates workspace at ~/.berry-claw/agents/{id}/ */
  setAgent(id: string, entry: AgentEntry): void {
    // Auto-assign workspace if not set
    if (!entry.workspace) {
      entry.workspace = join(this.appDir, 'agents', id);
    }
    this.config.agents[id] = entry;
    // Ensure workspace directory exists
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

  /** Get workspace for a specific agent (defaults to ~/.berry-claw/agents/{id}/) */
  agentWorkspace(agentId?: string): string {
    const id = agentId ?? this.config.defaultAgent;
    const agent = this.config.agents[id];
    return agent?.workspace ?? join(this.appDir, 'agents', id);
  }
  get defaultModel(): string { return this.config.defaultModel; }
  get defaultAgent(): string { return this.config.defaultAgent; }
  get isConfigured(): boolean {
    return Object.keys(this.config.providers).length > 0 && !!this.config.defaultModel;
  }
}
