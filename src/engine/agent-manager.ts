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
  Session,
  ContentBlock,
  ToolUseContent,
  ToolResultContent,
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
import { createFileMemoryProvider } from '@berry-agent/memory-file';
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

/**
 * Build the *full* tool registration list for an agent, honoring only the
 * static `entry.tools` whitelist (tool groups / explicit names). The
 * `disabledTools` soft-toggle is NOT applied here — it is applied via the
 * SDK's instance-level `setAllowedTools()` so tools can be re-enabled at
 * runtime without destroying the Agent instance.
 */
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

  if (entry.tools === undefined) return tools;
  const allowedToolNames = new Set(
    entry.tools.flatMap((name) => TOOL_GROUPS[name] ?? [name]),
  );
  return tools.filter((tool) => allowedToolNames.has(tool.definition.name));
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
    // Persisted defaultAgent may be empty; fall back to the first configured
    // agent so the app still boots into a usable state after restart.
    this.activeAgentId = this.config.defaultAgent || this.config.listAgents()[0]?.id || '';
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

    // Memory provider: FTS5-backed search over MEMORY.md + memory/*.md
    const memoryProvider = createFileMemoryProvider({ workspaceDir: workspace });
    // sync() builds the FTS index; fire-and-forget is fine — it uses sync IO internally
    // and finishes near-instantly. The first search call will hit a warm index.
    memoryProvider.sync().catch(() => {/* best-effort */});

    const agent = new Agent({
      provider: providerConfig,
      systemPrompt,
      tools,
      cwd: workspace,
      workspace,
      memory: memoryProvider,
      skillDirs: entry.skillDirs,
      sessionStore: new FileSessionStore(sessionsDir),
      toolGuard: compositeGuard(
        directoryScope(workspace),
        denyList(['rm -rf /', 'rm -rf ~', 'DROP TABLE', 'DROP DATABASE']),
      ),
      middleware: [this.observer.middleware],
      onEvent: this.observer.onEvent,
    });

    // Apply initial disabledTools via SDK allow-list (soft toggle)
    const initialDisabled = new Set(entry.disabledTools ?? []);
    if (initialDisabled.size > 0) {
      const all = agent.getTools().map(t => t.name);
      agent.setAllowedTools(all.filter(n => !initialDisabled.has(n)));
    }

    this.agents.set(id, { id, agent, entry });
    return agent;
  }

  /**
   * Hot-reload an agent's configuration. Instead of dropping the cached
   * instance (which would destroy in-memory session state), we mutate the
   * running Agent via SDK hot-reload API so the next turn picks up changes.
   *
   * Supports: systemPrompt, model, allowedTools (via disabledTools in entry).
   */
  reloadAgent(agentId: string): void {
    const cached = this.agents.get(agentId);
    const entry = this.config.getAgent(agentId);
    if (!entry) {
      this.agents.delete(agentId);
      return;
    }
    if (!cached) return; // not yet initialized; next getAgent() will read fresh

    // 1. System prompt
    cached.agent.setSystemPrompt(entry.systemPrompt ?? '');

    // 2. Model (if changed and provider keyed by model name)
    try {
      if (entry.model && entry.model !== cached.agent.currentProvider.model) {
        const providerConfig = this.config.toProviderConfig(entry.model);
        if (providerConfig) cached.agent.switchProvider(providerConfig);
      }
    } catch (err) {
      console.warn(`[reload] model switch failed for ${agentId}:`, err);
    }

    // 3. Allowed tools = (all registered) − disabledTools
    const disabled = new Set(entry.disabledTools ?? []);
    if (disabled.size === 0) {
      cached.agent.setAllowedTools(null);
    } else {
      const all = cached.agent.getTools().map(t => t.name);
      cached.agent.setAllowedTools(all.filter(n => !disabled.has(n)));
    }

    // 4. Refresh stored entry snapshot so subsequent reads see latest config
    cached.entry = entry;
  }

  /** Switch active agent */
  switchAgent(agentId: string): void {
    const entry = this.config.getAgent(agentId);
    if (!entry) throw new Error(`Agent "${agentId}" not found`);
    this.activeAgentId = agentId;
    // Persist selection so restart doesn't drop the active agent/session list.
    this.config.update({ defaultAgent: agentId });
  }

  /** Switch model for current agent */
  switchModel(model: string): void {
    const providerConfig = this.config.toProviderConfig(model);
    if (!providerConfig) throw new Error(`Model "${model}" not found`);
    this.getAgent().switchProvider(providerConfig);
  }

  /**
   * Load a persisted SDK session from disk and hydrate berry-claw's richer UI
   * session state cache. This makes sessions survive server restarts instead of
   * living only in SessionManager's in-memory map.
   */
  async loadSessionState(sessionId: string, agentId?: string): Promise<import('./session-manager.js').SessionState | null> {
    const cached = this.sessions.getState(sessionId);
    if (cached && cached.messages.length > 0) return cached;

    const targetId = agentId ?? this.activeAgentId;
    if (!targetId || !this.config.getAgent(targetId)) return cached;

    const agent = this.getAgent(targetId);
    const session = await agent.getSession(sessionId);
    if (!session) return cached;

    const state = hydrateSessionState(session);
    this.sessions.upsertState(state);
    return state;
  }

  /** List all persisted sessions for the active/current agent, hydrated for UI. */
  async listSessionStates(agentId?: string): Promise<import('./session-manager.js').SessionState[]> {
    // Without a configured agent there is no workspace to enumerate; this
    // endpoint must stay safe so the UI can render an empty state.
    const targetId = agentId ?? this.activeAgentId;
    if (!targetId || !this.config.getAgent(targetId)) {
      return this.sessions.listSessions();
    }

    const agent = this.getAgent(targetId);
    const ids = await agent.listSessions();
    for (const id of ids) {
      await this.loadSessionState(id, targetId);
    }
    return this.sessions.listSessions();
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

  /** Status snapshot for an agent, or null if the instance isn't created yet. */
  getAgentStatus(agentId: string): { status: string; detail?: string } | null {
    const inst = this.agents.get(agentId);
    if (!inst) return null;
    return { status: inst.agent.status, detail: inst.agent.statusDetail };
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

function hydrateSessionState(session: Session): import('./session-manager.js').SessionState {
  return {
    id: session.id,
    title: deriveSessionTitle(session),
    messages: hydrateChatMessages(session.messages),
    createdAt: session.createdAt,
    lastActiveAt: session.lastAccessedAt,
  };
}

function deriveSessionTitle(session: Session): string | undefined {
  const firstUser = session.messages.find(m => m.role === 'user' && typeof m.content === 'string');
  if (!firstUser || typeof firstUser.content !== 'string') return undefined;
  return firstUser.content.length > 30 ? `${firstUser.content.slice(0, 30)}...` : firstUser.content;
}

function hydrateChatMessages(messages: Session['messages']): ChatMessage[] {
  const out: ChatMessage[] = [];

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i]!;

    if (msg.role === 'user') {
      // Real user prompt
      if (typeof msg.content === 'string') {
        out.push({
          id: `msg_${msg.createdAt}_${i}`,
          role: 'user',
          content: msg.content,
          timestamp: msg.createdAt ?? Date.now(),
        });
        continue;
      }

      // Synthetic tool_result carrier message — UI doesn't show it as a user turn.
      const blocks = Array.isArray(msg.content) ? msg.content : [];
      const hasUserText = blocks.some(b => b.type === 'text');
      if (!hasUserText) continue;

      const text = blocks
        .filter((b): b is Extract<ContentBlock, { type: 'text' }> => b.type === 'text')
        .map(b => b.text)
        .join('\n');
      if (text) {
        out.push({
          id: `msg_${msg.createdAt}_${i}`,
          role: 'user',
          content: text,
          timestamp: msg.createdAt ?? Date.now(),
        });
      }
      continue;
    }

    // Assistant message: collect visible text + tool calls
    const blocks = typeof msg.content === 'string' ? [] : msg.content;
    const text = typeof msg.content === 'string'
      ? msg.content
      : blocks.filter((b): b is Extract<ContentBlock, { type: 'text' }> => b.type === 'text').map(b => b.text).join('\n');

    const toolCalls = typeof msg.content === 'string'
      ? undefined
      : hydrateToolCalls(blocks, messages[i + 1]);

    out.push({
      id: `msg_${msg.createdAt}_${i}`,
      role: 'assistant',
      content: text,
      timestamp: msg.createdAt ?? Date.now(),
      toolCalls: toolCalls && toolCalls.length > 0 ? toolCalls : undefined,
    });
  }

  return out;
}

function hydrateToolCalls(blocks: ContentBlock[], nextMessage?: Session['messages'][number]): ChatMessage['toolCalls'] {
  const toolUses = blocks.filter((b): b is ToolUseContent => b.type === 'tool_use');
  if (toolUses.length === 0) return undefined;

  const resultById = new Map<string, ToolResultContent>();
  if (nextMessage?.role === 'user' && Array.isArray(nextMessage.content)) {
    for (const block of nextMessage.content) {
      if (block.type === 'tool_result') {
        resultById.set(block.toolUseId, block);
      }
    }
  }

  return toolUses.map((toolUse) => ({
    name: toolUse.name,
    input: toolUse.input,
    isError: resultById.get(toolUse.id)?.isError,
  }));
}
