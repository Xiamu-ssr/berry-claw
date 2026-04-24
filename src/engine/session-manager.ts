/**
 * Session Manager — session CRUD + 消息历史
 * 后端持有所有 session 状态，前端只是展示层
 */
// (previously imported Agent/Session/AgentEvent/QueryResult — none used;
//  session state is passed in as plain structural objects.)

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

export type ChatMessageStatus = 'pending' | 'streaming' | 'completed' | 'queued' | 'failed';
export type ChatMessageDelivery = 'turn' | 'interject';

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
  /** Message lifecycle in the product shell, independent of SDK event-log durability. */
  status?: ChatMessageStatus;
  /** Whether this is a normal turn message or a same-turn interject side-channel. */
  delivery?: ChatMessageDelivery;
  /** Client-generated id used to reconcile optimistic UI bubbles with durable server state. */
  requestId?: string;
  toolCalls?: Array<{ name: string; input: unknown; isError?: boolean; result?: string }>;
  /** Per-inference rounds within this assistant turn */
  inferences?: InferenceInfo[];
  /** Total usage for the entire turn (sum of inferences) */
  usage?: { inputTokens: number; outputTokens: number };
  thinking?: string;
  /** Multimodal blocks (text + image) for user messages that carry attachments */
  blocks?: Array<{ type: 'text'; text: string } | { type: 'image'; data: string; mediaType: string }>;
}

export interface SessionState {
  id: string;
  title?: string;
  messages: ChatMessage[];
  createdAt: number;
  lastActiveAt: number;
  /** The agent this session belongs to (for multi-agent UIs). */
  agentId?: string;
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

  /** Create a new session. If sessionId is provided, records it as active immediately. */
  newSession(sessionId?: string): SessionState {
    if (sessionId) {
      const state = this.getOrCreateState(sessionId);
      this.activeSessionId = sessionId;
      return state;
    }
    this.activeSessionId = undefined;
    return this.getOrCreateState('');
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

  /**
   * Record a user message. Accepts either a plain string (text-only) or
   * a ContentBlock[] (multimodal turn). For multimodal turns we flatten
   * into a text preview here — the full content survives on the SDK's
   * event log, so UI rehydration still sees images.
   */
  addUserMessage(
    sessionId: string,
    prompt: string | import('@berry-agent/core').ContentBlock[],
    options?: {
      status?: ChatMessageStatus;
      delivery?: ChatMessageDelivery;
      requestId?: string;
    },
  ): ChatMessage {
    const state = this.getOrCreateState(sessionId);
    const isBlocks = typeof prompt !== 'string';
    const textPreview = isBlocks
      ? prompt.map((b) => b.type === 'text' ? b.text : `[${b.type}]`).join(' ').trim()
      : prompt;
    const blocks = isBlocks
      ? prompt.filter((b): b is { type: 'text'; text: string } | { type: 'image'; data: string; mediaType: string } =>
          b.type === 'text' || b.type === 'image',
        )
      : undefined;
    const msg: ChatMessage = {
      id: `msg_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      role: 'user',
      content: textPreview || '(media)',
      timestamp: Date.now(),
      status: options?.status ?? 'completed',
      delivery: options?.delivery ?? 'turn',
      requestId: options?.requestId,
      blocks,
    };
    state.messages.push(msg);
    state.lastActiveAt = Date.now();
    // Auto-generate title from the first user text. Skip media-only turns.
    if (!state.title && textPreview) {
      state.title = textPreview.length > 30 ? textPreview.slice(0, 30) + '...' : textPreview;
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
    options?: {
      status?: ChatMessageStatus;
      delivery?: ChatMessageDelivery;
      requestId?: string;
    },
  ): ChatMessage {
    const state = this.getOrCreateState(sessionId);
    const msg: ChatMessage = {
      id: `msg_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      role: 'assistant',
      content,
      timestamp: Date.now(),
      status: options?.status ?? 'completed',
      delivery: options?.delivery ?? 'turn',
      requestId: options?.requestId,
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

  /** Patch a message in-place (used for pending → completed / failed transitions). */
  updateMessage(sessionId: string, messageId: string, patch: Partial<ChatMessage>): ChatMessage | null {
    const state = this.sessions.get(sessionId);
    if (!state) return null;
    const idx = state.messages.findIndex((msg) => msg.id === messageId);
    if (idx < 0) return null;
    state.messages[idx] = { ...state.messages[idx], ...patch };
    state.lastActiveAt = Date.now();
    return state.messages[idx] ?? null;
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
