import { z } from 'zod';
import { zAskQuestion } from './safety.js';
import { zAgentStatus } from './facts.js';
import type { FactChange } from './facts.js';

export const zInferenceInfo = z.object({
  model: z.string(),
  inputTokens: z.number(),
  outputTokens: z.number(),
  cacheWriteTokens: z.number().optional(),
  cacheReadTokens: z.number().optional(),
  stopReason: z.string(),
  cost: z.number().optional(),
});
export type InferenceInfo = z.infer<typeof zInferenceInfo>;

export const zToolCallInfo = z.object({
  name: z.string(),
  input: z.unknown(),
  isError: z.boolean().optional(),
  result: z.unknown().optional(),
  toolUseId: z.string().optional(),
  expanded: z.boolean().optional(),
});
export type ToolCallInfo = z.infer<typeof zToolCallInfo>;

export const zChatTimelineEvent = z.object({
  id: z.string(),
  kind: z.enum([
    'query',
    'api_call',
    'api_response',
    'compaction',
    'status',
    'memory',
    'guard',
    'delegate',
    'model',
    'system',
  ]),
  title: z.string(),
  detail: z.string().optional(),
  timestamp: z.number(),
  tone: z.enum(['neutral', 'good', 'warn', 'bad', 'info']).optional(),
  collapsed: z.boolean().optional(),
});
export type ChatTimelineEvent = z.infer<typeof zChatTimelineEvent>;

export const zContentBlock = z.discriminatedUnion('type', [
  z.object({ type: z.literal('text'), text: z.string() }),
  z.object({ type: z.literal('image'), data: z.string(), mediaType: z.string() }),
]);
export type ContentBlock = z.infer<typeof zContentBlock>;

export const zChatStep = z.object({
  id: z.string(),
  thinking: z.string().optional(),
  text: z.string().optional(),
  toolCalls: z.array(zToolCallInfo),
  inference: zInferenceInfo.optional(),
  status: z.enum(['streaming', 'completed']),
});
export type ChatStep = z.infer<typeof zChatStep>;

export const zChatTimelineItem = z.discriminatedUnion('type', [
  z.object({ type: z.literal('event'), event: zChatTimelineEvent }),
  z.object({ type: z.literal('step'), step: zChatStep }),
]);
export type ChatTimelineItem = z.infer<typeof zChatTimelineItem>;

export const zChatMessage = z.object({
  id: z.string(),
  role: z.enum(['user', 'assistant']),
  content: z.string(),
  timestamp: z.number(),
  status: z.enum(['pending', 'streaming', 'completed', 'queued', 'failed']).optional(),
  delivery: z.enum(['turn', 'interject']).optional(),
  requestId: z.string().optional(),
  toolCalls: z.array(zToolCallInfo).optional(),
  thinking: z.string().optional(),
  usage: z.object({ inputTokens: z.number(), outputTokens: z.number() }).optional(),
  inferences: z.array(zInferenceInfo).optional(),
  steps: z.array(zChatStep).optional(),
  events: z.array(zChatTimelineEvent).optional(),
  timeline: z.array(zChatTimelineItem).optional(),
  blocks: z.array(zContentBlock).optional(),
});
export type ChatMessage = z.infer<typeof zChatMessage>;

export const zTodoItem = z.object({
  text: z.string(),
  done: z.boolean().optional(),
});
export type TodoItem = z.infer<typeof zTodoItem>;

export const zSessionInfo = z.object({
  id: z.string(),
  title: z.string().optional(),
  startTime: z.number().optional(),
  endTime: z.number().nullable().optional(),
  totalCost: z.number().optional(),
  status: z.string().optional(),
  llmCallCount: z.number().optional(),
  toolCallCount: z.number().optional(),
  eventCount: z.number().optional(),
  messages: z.array(zChatMessage).optional(),
  createdAt: z.number().optional(),
  lastActiveAt: z.number().optional(),
});
export type SessionInfo = z.infer<typeof zSessionInfo>;

export const zAgentInfo = z.object({
  id: z.string(),
  entry: z.object({
    name: z.string(),
    model: z.string(),
    workspace: z.string().optional(),
  }),
});
export type AgentInfo = z.infer<typeof zAgentInfo>;

export const zModelInfo = z.object({
  model: z.string(),
  providerName: z.string(),
  type: z.string(),
});
export type ModelInfo = z.infer<typeof zModelInfo>;

export type RetryReason = 'stream_idle_timeout' | 'transient_error';

export type WsOutgoing =
  | { type: 'chat'; prompt: string | ContentBlock[]; sessionId?: string; requestId?: string; agentId?: string }
  | { type: 'new_session'; agentId?: string }
  | { type: 'switch_agent'; agentId: string }
  | { type: 'resume_session'; sessionId: string; agentId?: string }
  | { type: 'switch_model'; model: string }
  | { type: 'interject'; text: string };

export type WsIncoming =
  | { type: 'start' }
  | { type: 'user_message_persisted'; sessionId: string; message: ChatMessage }
  | { type: 'text_delta'; text: string }
  | { type: 'thinking_delta'; thinking: string }
  | { type: 'tool_call'; name: string; input: unknown; toolUseId?: string }
  | { type: 'tool_result'; name: string; isError: boolean; toolUseId?: string; output?: unknown }
  | { type: 'timeline_event'; event: ChatTimelineEvent }
  | {
      type: 'api_response';
      model: string;
      usage: { inputTokens: number; outputTokens: number; cacheWriteTokens?: number; cacheReadTokens?: number };
      stopReason: string;
      cost?: number;
      contextTokens?: number;
    }
  | { type: 'api_call'; messages: number; tools: number }
  | { type: 'status_change'; status: z.infer<typeof zAgentStatus>; detail?: string }
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
  | { type: 'done'; sessionId: string; message: ChatMessage; usage: unknown; totalUsage: unknown; toolCalls: number }
  | { type: 'error'; message: string; requestId?: string; sessionId?: string }
  | { type: 'session_cleared' }
  | { type: 'session_created'; sessionId: string; messages?: ChatMessage[] }
  | { type: 'session_resumed'; sessionId: string; messages?: ChatMessage[] }
  | { type: 'session_compacted'; sessionId: string; tokensFreed: number; layersApplied: string[] }
  | {
      type: 'compaction';
      sessionId?: string;
      tokensFreed: number;
      layersApplied: string[];
      contextBefore: number;
      contextAfter: number;
      contextWindow: number;
      thresholdPct: number;
      triggerReason: 'soft_threshold' | 'threshold' | 'overflow_retry';
    }
  | ({ type: 'fact_changed' } & FactChange)
  | {
      type: 'interject_acked';
      text: string;
      status?: 'queued';
      delivery?: 'interject';
      behavior?: 'same_turn';
    }
  | { type: 'agent_switched'; agentId: string }
  | { type: 'model_switched'; model: string }
  | { type: 'safety_ask'; id: string; question: z.infer<typeof zAskQuestion> }
  | { type: 'safety_ask_resolved'; id: string; approved: boolean; note?: string };
