/**
 * Agent Manager — 多 Agent 实例管理
 */
import { Agent, FileSessionStore } from '@berry-agent/core';
import type { ProviderConfig, AgentEvent, QueryResult, ToolDefinition } from '@berry-agent/core';
import { compositeGuard, directoryScope, denyList } from '@berry-agent/safe';
import { createObserver, type Observer } from '@berry-agent/observe';
import { createAllTools } from '@berry-agent/tools-common';
import { SYSTEM_PROMPT } from '../agent/prompt.js';
import { ConfigManager, type AgentEntry } from './config-manager.js';
import { SessionManager, type ChatMessage } from './session-manager.js';
import { join } from 'node:path';
import { mkdirSync, existsSync } from 'node:fs';

interface AgentInstance {
  id: string;
  agent: Agent;
  entry: AgentEntry;
}

export class AgentManager {
  readonly config: ConfigManager;
  readonly sessions: SessionManager;
  readonly observer: Observer;
  private agents = new Map<string, AgentInstance>();
  private activeAgentId: string;

  constructor() {
    this.config = new ConfigManager();
    this.sessions = new SessionManager();
    this.observer = createObserver({ dbPath: join(this.config.appDir, 'observe.db') });
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

    const workspace = entry.workspace ?? this.config.workspace;
    if (!existsSync(workspace)) mkdirSync(workspace, { recursive: true });

    const sessionsDir = join(this.config.appDir, 'sessions', id);
    if (!existsSync(sessionsDir)) mkdirSync(sessionsDir, { recursive: true });

    // Build system prompt
    const systemPrompt = entry.systemPrompt
      ? [entry.systemPrompt]
      : SYSTEM_PROMPT;

    // Build tools based on config
    const tools = createAllTools(workspace);

    const agent = new Agent({
      provider: providerConfig,
      systemPrompt,
      tools,
      cwd: workspace,
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
