/**
 * Session Manager — session CRUD + 消息历史
 * 后端持有所有 session 状态，前端只是展示层
 */
import type { Agent, Session, AgentEvent, QueryResult } from '@berry-agent/core';

export interface InferenceInfo {
  /** Model id used for this inference round */
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheWriteTokens?: number;
  cacheReadTokens?: number;
  stopReason: string;
  /** Estimated cost in USD */
  cost?: number;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
  toolCalls?: Array<{ name: string; input: unknown; isError?: boolean }>;
  /** Per-inference rounds within this assistant turn */
  inferences?: InferenceInfo[];
  /** Total usage for the entire turn (sum of inferences) */
  usage?: { inputTokens: number; outputTokens: number };
  thinking?: string;
}

export interface SessionState {
  id: string;
  title?: string;
  messages: ChatMessage[];
  createdAt: number;
  lastActiveAt: number;
}

/**
 * Manages chat sessions. Wraps Agent's session store with
 * a richer message history that includes tool calls and usage info.
 */
export class SessionManager {
  /** In-memory session states (message history lives here) */
  private sessions = new Map<string, SessionState>();
  private activeSessionId?: string;

  get currentSessionId(): string | undefined {
    return this.activeSessionId;
  }

  /** Create a new session (returns ID, actual Agent session created on first query) */
  newSession(): string {
    this.activeSessionId = undefined;
    return '';  // Agent will create the session on first query
  }

  /** Switch to an existing session */
  switchSession(sessionId: string): SessionState | null {
    const state = this.sessions.get(sessionId);
    if (state) {
      this.activeSessionId = sessionId;
      return state;
    }
    // Session exists in agent store but not in our message history
    this.activeSessionId = sessionId;
    return this.getOrCreateState(sessionId);
  }

  /** Record a user message */
  addUserMessage(sessionId: string, prompt: string): ChatMessage {
    const state = this.getOrCreateState(sessionId);
    const msg: ChatMessage = {
      id: `msg_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      role: 'user',
      content: prompt,
      timestamp: Date.now(),
    };
    state.messages.push(msg);
    state.lastActiveAt = Date.now();
    // Auto-generate title from first user message
    if (!state.title) {
      state.title = prompt.length > 30 ? prompt.slice(0, 30) + '...' : prompt;
    }
    return msg;
  }

  /** Record an assistant message (after query completes) */
  addAssistantMessage(
    sessionId: string,
    content: string,
    toolCalls?: ChatMessage['toolCalls'],
    usage?: ChatMessage['usage'],
    thinking?: string,
    inferences?: InferenceInfo[],
  ): ChatMessage {
    const state = this.getOrCreateState(sessionId);
    const msg: ChatMessage = {
      id: `msg_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      role: 'assistant',
      content,
      timestamp: Date.now(),
      toolCalls,
      usage,
      thinking: thinking || undefined,
      inferences: inferences && inferences.length > 0 ? inferences : undefined,
    };
    state.messages.push(msg);
    state.lastActiveAt = Date.now();
    this.activeSessionId = sessionId;
    return msg;
  }

  /** Get a cached session state */
  getState(sessionId: string): SessionState | null {
    return this.sessions.get(sessionId) ?? null;
  }

  /** Upsert a hydrated/persisted session state */
  upsertState(state: SessionState): SessionState {
    this.sessions.set(state.id, state);
    return state;
  }

  /** Get message history for a session */
  getMessages(sessionId: string): ChatMessage[] {
    return this.sessions.get(sessionId)?.messages ?? [];
  }

  /** List all sessions (sorted by last active) */
  listSessions(): SessionState[] {
    return [...this.sessions.values()].sort((a, b) => b.lastActiveAt - a.lastActiveAt);
  }

  /** Delete a session */
  deleteSession(sessionId: string): boolean {
    if (this.activeSessionId === sessionId) {
      this.activeSessionId = undefined;
    }
    return this.sessions.delete(sessionId);
  }

  private getOrCreateState(sessionId: string): SessionState {
    let state = this.sessions.get(sessionId);
    if (!state) {
      state = {
        id: sessionId,
        messages: [],
        createdAt: Date.now(),
        lastActiveAt: Date.now(),
      };
      this.sessions.set(sessionId, state);
    }
    return state;
  }
}
