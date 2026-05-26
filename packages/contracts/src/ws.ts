import { z } from 'zod';
import { zUserContentBlock } from '@berry-agent/core/schema';
import type { UserContentBlock } from '@berry-agent/core/schema';
import {
  zAgentChatInference,
  zAgentChatMessage,
  zAgentChatStep,
  zAgentChatTimelineEvent,
  zAgentChatTimelineItem,
  zAgentSessionView,
  zChatToolCall,
} from '@berry-agent/core/chat-schema';
import type {
  AgentChatInference,
  AgentChatMessage,
  AgentChatStep,
  AgentChatTimelineEvent,
  AgentChatTimelineItem,
  AgentSessionView,
  ChatToolCall,
} from '@berry-agent/core/chat-schema';
import { zAskQuestion } from './safety.js';
import type { FactChange } from './facts.js';

export const zInferenceInfo = zAgentChatInference;
export type InferenceInfo = AgentChatInference;

export const zToolCallInfo = zChatToolCall;
export type ToolCallInfo = ChatToolCall;

export const zChatTimelineEvent = zAgentChatTimelineEvent;
export type ChatTimelineEvent = AgentChatTimelineEvent;

export type ContentBlock = UserContentBlock;
export const zContentBlock: z.ZodType<ContentBlock> = zUserContentBlock;

export const zChatStep = zAgentChatStep;
export type ChatStep = AgentChatStep;

export const zChatTimelineItem = zAgentChatTimelineItem;
export type ChatTimelineItem = AgentChatTimelineItem;

export const zChatMessage = zAgentChatMessage;
export type ChatMessage = AgentChatMessage;

export const zTodoItem = z.object({
  text: z.string(),
  done: z.boolean().optional(),
});
export type TodoItem = z.infer<typeof zTodoItem>;

export const zSessionInfo = zAgentSessionView;
export type SessionInfo = AgentSessionView;

export type RetryReason = 'stream_idle_timeout' | 'transient_error';

export const zWsOutgoing = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('chat'),
    prompt: z.union([z.string(), z.array(zContentBlock)]),
    sessionId: z.string().optional(),
    requestId: z.string().optional(),
    agentId: z.string().optional(),
  }).strict(),
  z.object({
    type: z.literal('pause_agent'),
    agentId: z.string().optional(),
    sessionId: z.string().optional(),
    reason: z.string().optional(),
  }).strict(),
  z.object({
    type: z.literal('interject'),
    text: z.string(),
  }).strict(),
]);

export type WsOutgoing = z.infer<typeof zWsOutgoing>;

// Stream events that originate from a single agent's turn. The server tags
// every such event with the owning `agentId` (and `sessionId` once known) so
// the client can route updates to a per-agent runtime store. UI never has to
// guess which agent a delta belongs to.
export type WsIncoming =
  | { type: 'start'; agentId: string; sessionId?: string; requestId?: string }
  | { type: 'user_message_persisted'; agentId: string; sessionId: string; message: ChatMessage }
  | { type: 'text_delta'; agentId: string; sessionId?: string; text: string }
  | { type: 'thinking_delta'; agentId: string; sessionId?: string; thinking: string }
  | { type: 'tool_call'; agentId: string; sessionId?: string; name: string; input: Record<string, unknown>; toolUseId?: string }
  | { type: 'tool_result'; agentId: string; sessionId?: string; name: string; isError: boolean; toolUseId?: string; output?: string }
  | { type: 'timeline_event'; agentId: string; sessionId?: string; event: ChatTimelineEvent }
  | {
      type: 'api_response';
      agentId: string;
      sessionId?: string;
      model: string;
      usage: { inputTokens: number; outputTokens: number; cacheWriteTokens?: number; cacheReadTokens?: number };
      stopReason: string;
      cost?: number;
      contextTokens?: number;
    }
  | { type: 'todo_updated'; agentId: string; sessionId: string; todos: TodoItem[]; timestamp: number }
  | {
      type: 'retry';
      agentId: string;
      sessionId?: string;
      scope: 'stream' | 'chat';
      attempt: number;
      maxAttempts: number;
      reason: RetryReason;
      errorMessage: string;
      delayMs: number;
    }
  | { type: 'done'; agentId: string; sessionId: string; message: ChatMessage; usage: unknown; totalUsage: unknown; toolCalls: number; requestId?: string }
  | { type: 'error'; agentId: string; message: string; requestId?: string; sessionId?: string }
  | {
      type: 'compaction';
      agentId: string;
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
      agentId: string;
      sessionId?: string;
      text: string;
      status?: 'queued';
      delivery?: 'interject';
      behavior?: 'same_turn';
    }
  | { type: 'agent_paused'; agentId: string; sessionId?: string; paused: boolean; reason?: string }
  | { type: 'safety_ask'; id: string; question: z.infer<typeof zAskQuestion> }
  | { type: 'safety_ask_resolved'; id: string; approved: boolean; note?: string };
