export interface SessionInfo {
  id: string;
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

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
  toolCalls?: ToolCallInfo[];
  usage?: { inputTokens: number; outputTokens: number };
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
  | { type: 'resume_session'; sessionId: string };

export type WsIncoming =
  | { type: 'start' }
  | { type: 'text_delta'; text: string }
  | { type: 'thinking_delta'; thinking: string }
  | { type: 'tool_call'; name: string; input: unknown }
  | { type: 'tool_result'; name: string; isError: boolean }
  | { type: 'api_call'; messages: number; tools: number }
  | { type: 'done'; sessionId: string; usage: any; totalUsage: any; toolCalls: number }
  | { type: 'error'; message: string }
  | { type: 'session_cleared' }
  | { type: 'session_resumed'; sessionId: string; messages?: ChatMessage[] };
