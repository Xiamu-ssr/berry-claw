export interface SessionInfo {
  id: string;
  title?: string;
  startTime?: number;
  endTime?: number | null;
  totalCost?: number;
  status?: string;
  llmCallCount?: number;
  toolCallCount?: number;
  eventCount?: number;
  // From SessionManager
  messages?: ChatMessage[];
  createdAt?: number;
  lastActiveAt?: number;
}

export interface AgentInfo {
  id: string;
  entry: { name: string; model: string; workspace?: string; systemPrompt?: string };
}

export interface ModelInfo {
  model: string;
  providerName: string;
  type: string;
}

export interface InferenceInfo {
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheWriteTokens?: number;
  cacheReadTokens?: number;
  stopReason: string;
  cost?: number;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
  toolCalls?: ToolCallInfo[];
  thinking?: string;
  usage?: { inputTokens: number; outputTokens: number };
  inferences?: InferenceInfo[];
}

export interface ToolCallInfo {
  name: string;
  input: unknown;
  isError?: boolean;
  expanded?: boolean;
}

// WebSocket message types
export type WsOutgoing =
  | { type: 'chat'; prompt: string; sessionId?: string }
  | { type: 'new_session' }
  | { type: 'resume_session'; sessionId: string }
  | { type: 'interject'; text: string };

export type AgentStatus =
  | 'idle'
  | 'thinking'
  | 'tool_executing'
  | 'compacting'
  | 'memory_flushing'
  | 'delegating'
  | 'sleeping'
  | 'error';

export interface TodoItem {
  content: string;
  status: 'pending' | 'in_progress' | 'completed';
  activeForm?: string;
}

export type RetryReason = 'stream_idle_timeout' | 'transient_error';

export type WsIncoming =
  | { type: 'start' }
  | { type: 'text_delta'; text: string }
  | { type: 'thinking_delta'; thinking: string }
  | { type: 'tool_call'; name: string; input: unknown }
  | { type: 'tool_result'; name: string; isError: boolean }
  | {
      type: 'api_response';
      model: string;
      usage: { inputTokens: number; outputTokens: number; cacheWriteTokens?: number; cacheReadTokens?: number };
      stopReason: string;
    }
  | { type: 'api_call'; messages: number; tools: number }
  | { type: 'status_change'; status: AgentStatus; detail?: string }
  | { type: 'todo_updated'; sessionId: string; todos: TodoItem[]; timestamp: number }
  | {
      type: 'retry';
      scope: 'stream' | 'chat';
      attempt: number;
      maxAttempts: number;
      reason: RetryReason;
      errorMessage: string;
      delayMs: number;
    }
  | { type: 'done'; sessionId: string; message: ChatMessage; usage: any; totalUsage: any; toolCalls: number }
  | { type: 'error'; message: string }
  | { type: 'session_cleared' }
  | { type: 'session_resumed'; sessionId: string; messages?: ChatMessage[] }
  | { type: 'interject_acked'; text: string };
