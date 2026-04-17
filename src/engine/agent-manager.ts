/**
 * Agent Manager — 多 Agent 实例管理
 */
import {
  Agent,
  DefaultCredentialStore,
  FileSessionStore,
  defaultCredentialFilePath,
} from '@berry-agent/core';
import {
  TOOL_BROWSER,
  TOOL_EDIT_FILE,
  TOOL_FIND_FILES,
  TOOL_GREP,
  TOOL_LIST_FILES,
  TOOL_READ_FILE,
  TOOL_SHELL,
  TOOL_WEB_FETCH,
  TOOL_WEB_SEARCH,
  TOOL_WRITE_FILE,
} from '@berry-agent/core';
import type {
  CredentialStore,
  AgentEvent,
  QueryResult,
  ToolRegistration,
} from '@berry-agent/core';
import { compositeGuard, directoryScope, denyList } from '@berry-agent/safe';
import { createObserver, type Observer, type ModelPricing } from '@berry-agent/observe';
import {
  createAllTools,
  createBrowserTool,
  createWebFetchTool,
  createWebSearchTool,
  WEB_SEARCH_CREDENTIAL_KEYS,
  type WebSearchProviderName,
} from '@berry-agent/tools-common';
import { SYSTEM_PROMPT } from '../agent/prompt.js';
import { ConfigManager, type AgentEntry } from './config-manager.js';
import { SessionManager, type ChatMessage } from './session-manager.js';
import { join } from 'node:path';
import { mkdirSync, existsSync } from 'node:fs';

const TOOL_GROUPS: Record<string, readonly string[]> = {
  file: [TOOL_READ_FILE, TOOL_WRITE_FILE, TOOL_LIST_FILES, TOOL_EDIT_FILE],
  shell: [TOOL_SHELL],
  search: [TOOL_GREP, TOOL_FIND_FILES],
  web_fetch: [TOOL_WEB_FETCH],
  web_search: [TOOL_WEB_SEARCH],
  browser: [TOOL_BROWSER],
};

/**
 * Pick a web_search provider based on which credential key is present.
 * Order of preference: Tavily → Brave → SerpAPI.
 */
function pickWebSearchProvider(credentials: CredentialStore): WebSearchProviderName | null {
  const order: WebSearchProviderName[] = ['tavily', 'brave', 'serpapi'];
  for (const provider of order) {
    const key = WEB_SEARCH_CREDENTIAL_KEYS[provider];
    if (credentials.get(key)) return provider;
  }
  return null;
}

function buildWebSearchTool(credentials: CredentialStore): ToolRegistration {
  const provider = pickWebSearchProvider(credentials) ?? 'tavily';
  // When no provider is configured the SDK returns a stub tool automatically.
  return createWebSearchTool({ provider, credentials });
}

function buildTools(
  workspace: string,
  entry: AgentEntry,
  credentials: CredentialStore,
): ToolRegistration[] {
  const tools = [
    ...createAllTools(workspace),
    createWebFetchTool(),
    buildWebSearchTool(credentials),
    createBrowserTool(),
  ];

  const afterWhitelist = (() => {
    if (entry.tools === undefined) return tools;
    const allowedToolNames = new Set(
      entry.tools.flatMap((name) => TOOL_GROUPS[name] ?? [name]),
    );
    return tools.filter((tool) => allowedToolNames.has(tool.definition.name));
  })();

  const disabled = new Set(entry.disabledTools ?? []);
  if (disabled.size === 0) return afterWhitelist;
  return afterWhitelist.filter((tool) => !disabled.has(tool.definition.name));
}

interface AgentInstance {
  id: string;
  agent: Agent;
  entry: AgentEntry;
}

export class AgentManager {
  readonly config: ConfigManager;
  readonly sessions: SessionManager;
  readonly observer: Observer;
  readonly credentials: CredentialStore;
  private agents = new Map<string, AgentInstance>();
  private activeAgentId: string;

  constructor() {
    this.config = new ConfigManager();
    this.sessions = new SessionManager();
    this.credentials = new DefaultCredentialStore({
      filePath: defaultCredentialFilePath(),
    });
    // Model name aliases: zenmux proxies use "provider/model" naming, map to standard pricing
    const sonnet4: ModelPricing = { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 };
    const haiku4: ModelPricing = { input: 0.8, output: 4, cacheRead: 0.08, cacheWrite: 1 };
    const opus4: ModelPricing = { input: 15, output: 75, cacheRead: 1.5, cacheWrite: 18.75 };
    const pricingOverrides: Record<string, ModelPricing> = {
      'anthropic/claude-sonnet-4-20250514': sonnet4,
      'anthropic/claude-sonnet-4.6': sonnet4,
      'anthropic/claude-haiku-4-20250414': haiku4,
      'anthropic/claude-haiku-4.5': haiku4,
      'anthropic/claude-opus-4-20250514': opus4,
      'anthropic/claude-opus-4.6': opus4,
    };
    this.observer = createObserver({ dbPath: join(this.config.appDir, 'observe.db'), pricingOverrides });
    this.activeAgentId = this.config.defaultAgent;
  }

  /** Get or create an agent instance by ID */
  getAgent(agentId?: string): Agent {
    const id = agentId ?? this.activeAgentId;
    const existing = this.agents.get(id);
    if (existing) return existing.agent;
    return this.initAgent(id);
  }

  /** Initialize an agent from config */
  initAgent(agentId?: string): Agent {
    const id = agentId ?? this.activeAgentId;
    const entry = this.config.getAgent(id);
    if (!entry) throw new Error(`Agent "${id}" not found in config`);

    const providerConfig = this.config.toProviderConfig(entry.model);
    if (!providerConfig) {
      throw new Error(`No provider found for model "${entry.model}". Configure providers first.`);
    }

    const workspace = entry.workspace ?? this.config.agentWorkspace(id);
    if (!existsSync(workspace)) mkdirSync(workspace, { recursive: true });

    const sessionsDir = join(this.config.appDir, 'sessions', id);
    if (!existsSync(sessionsDir)) mkdirSync(sessionsDir, { recursive: true });

    // Build system prompt
    const systemPrompt = entry.systemPrompt
      ? [entry.systemPrompt]
      : SYSTEM_PROMPT;

    // Build tools based on config
    const tools = buildTools(workspace, entry, this.credentials);

    // Note: setting `workspace` triggers FileAgentMemory auto-init at
    // {workspace}/MEMORY.md inside Agent constructor — no manual wiring needed.
    const agent = new Agent({
      provider: providerConfig,
      systemPrompt,
      tools,
      cwd: workspace,
      workspace,
      skillDirs: entry.skillDirs,
      sessionStore: new FileSessionStore(sessionsDir),
      toolGuard: compositeGuard(
        directoryScope(workspace),
        denyList(['rm -rf /', 'rm -rf ~', 'DROP TABLE', 'DROP DATABASE']),
      ),
      middleware: [this.observer.middleware],
      onEvent: this.observer.onEvent,
    });

    this.agents.set(id, { id, agent, entry });
    return agent;
  }

  /** Drop cached Agent instance so next query re-reads config. */
  reloadAgent(agentId: string): void {
    this.agents.delete(agentId);
  }

  /** Switch active agent */
  switchAgent(agentId: string): void {
    const entry = this.config.getAgent(agentId);
    if (!entry) throw new Error(`Agent "${agentId}" not found`);
    this.activeAgentId = agentId;
  }

  /** Switch model for current agent */
  switchModel(model: string): void {
    const providerConfig = this.config.toProviderConfig(model);
    if (!providerConfig) throw new Error(`Model "${model}" not found`);
    this.getAgent().switchProvider(providerConfig);
  }

  /** Chat with active agent */
  async chat(
    prompt: string,
    options?: { sessionId?: string; agentId?: string; onEvent?: (event: AgentEvent) => void },
  ): Promise<{ result: QueryResult; assistantMessage: ChatMessage }> {
    const agent = this.getAgent(options?.agentId);
    const sessionId = options?.sessionId ?? this.sessions.currentSessionId;

    const toolCalls: ChatMessage['toolCalls'] = [];
    let streamText = '';

    const result = await agent.query(prompt, {
      resume: sessionId,
      stream: true,
      onEvent: (event) => {
        options?.onEvent?.(event);
        if (event.type === 'text_delta') streamText += event.text;
        else if (event.type === 'tool_call') toolCalls.push({ name: event.name, input: event.input });
        else if (event.type === 'tool_result') {
          const last = [...toolCalls].reverse().find(t => t.name === event.name);
          if (last) last.isError = event.isError;
        }
      },
    });

    this.sessions.addUserMessage(result.sessionId, prompt);
    const assistantMessage = this.sessions.addAssistantMessage(
      result.sessionId,
      result.text,
      toolCalls.length > 0 ? toolCalls : undefined,
      { inputTokens: result.usage.inputTokens, outputTokens: result.usage.outputTokens },
    );

    return { result, assistantMessage };
  }

  /** Introspect an agent */
  inspectAgent(agentId?: string): {
    id: string;
    entry: AgentEntry;
    runtime: ReturnType<Agent['inspect']> | null;
  } {
    const id = agentId ?? this.activeAgentId;
    const entry = this.config.getAgent(id);
    if (!entry) throw new Error(`Agent "${id}" not found`);
    const instance = this.agents.get(id);
    return {
      id,
      entry,
      runtime: instance ? instance.agent.inspect() : null,
    };
  }

  /** Current model info */
  currentModel(): { model: string; providerName: string; type: string } | null {
    const instance = this.agents.get(this.activeAgentId);
    if (!instance) return null;
    const config = instance.agent.currentProvider;
    const resolved = this.config.resolveModel(config.model);
    if (!resolved) return { model: config.model, providerName: 'unknown', type: config.type };
    return { model: config.model, providerName: resolved.providerName, type: resolved.provider.type };
  }

  get activeAgent(): string { return this.activeAgentId; }

  close(): void { this.observer.close(); }
}
