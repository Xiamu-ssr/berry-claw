/**
 * Per-agent chat runtime — pure state + reducer.
 *
 * Why a reducer instead of a bundle of useState/useRef:
 * - berry-claw is multi-agent. A single global "isLoading / streamingText / steps"
 *   pile of state cannot represent two agents that are both running at once;
 *   the previous design even leaked one agent's loading flag onto another agent's
 *   tab when the user switched, which is what triggered this redesign.
 * - All streaming state for an agent lives inside one immutable AgentRuntime
 *   record keyed by agentId. The hook that owns these records replays
 *   {@link applyEvent} for every WS frame and lets React subscribe to the
 *   _current_ agent's slice via a structural selector.
 * - This module has zero React imports. It is exhaustively unit-testable.
 */

import type {
  ChatMessage,
  ChatStep,
  ChatTimelineEvent,
  InferenceInfo,
  TodoItem,
  ToolCallInfo,
  WsIncoming,
} from '@berry-agent/claw-contracts';

import {
  buildFinalTimeline,
  mergeFinalToolResults,
  type StreamingTimelineItem,
} from './display';

/**
 * Frames produced by the chat WS that are scoped to a specific agent. Every
 * one of them carries `agentId`; we accept the full WsIncoming union for
 * convenience and dispatch internally.
 */
export type ChatStreamFrame = WsIncoming;

/** Live state for one agent's chat tab. Treated as immutable by callers. */
export interface AgentRuntime {
  readonly agentId: string;
  /** Authoritative chat history persisted by the server. */
  readonly messages: ChatMessage[];
  /** Active session for this agent (undefined until first turn lands). */
  readonly activeSessionId?: string;
  /** True iff the agent currently owns an in-flight chat turn. */
  readonly isStreaming: boolean;
  /** True while we have asked the server for a new session and are waiting. */
  readonly creatingSession: boolean;
  /** Streaming buffers for the in-flight turn; cleared on done/error. */
  readonly streaming: StreamingState;
  /** Latest token usage / context window snapshot for this agent. */
  readonly context: ContextState;
  /** Todos by sessionId for this agent. */
  readonly todosBySession: Record<string, TodoItem[]>;
}

/** Streaming buffers — only meaningful while {@link AgentRuntime.isStreaming}. */
export interface StreamingState {
  readonly steps: ChatStep[];
  readonly currentStep: ChatStep | null;
  readonly events: ChatTimelineEvent[];
  readonly timeline: StreamingTimelineItem[];
  readonly inferences: InferenceInfo[];
}

export interface ContextState {
  readonly tokensUsed: number;
  readonly window: number | null;
}

const EMPTY_STREAMING: StreamingState = {
  steps: [],
  currentStep: null,
  events: [],
  timeline: [],
  inferences: [],
};

const EMPTY_CONTEXT: ContextState = {
  tokensUsed: 0,
  window: null,
};

/** Build a fresh runtime for an agent that has never been seen. */
export function createAgentRuntime(agentId: string): AgentRuntime {
  return {
    agentId,
    messages: [],
    activeSessionId: undefined,
    isStreaming: false,
    creatingSession: false,
    streaming: EMPTY_STREAMING,
    context: EMPTY_CONTEXT,
    todosBySession: {},
  };
}

/**
 * Side-effects that the reducer cannot perform itself but must be triggered
 * by the host (toasts, follow-up REST refreshes, pending safety asks, fact
 * store updates). Applying a frame returns a {next, effects} pair so React
 * code stays reducer-pure.
 */
export interface RuntimeEffect {
  readonly type:
    | 'toast'
    | 'refresh-sessions'
    | 'refresh-context'
    | 'refresh-context-on-focus'
    | 'fact-changed'
    | 'safety-ask'
    | 'safety-ask-resolved'
    | 'interject-acked'
    | 'agent-paused'
    | 'error';
  readonly payload?: unknown;
}

export interface ApplyResult {
  readonly next: AgentRuntime;
  readonly effects: RuntimeEffect[];
}

/**
 * Run a single WS frame through the reducer. The runtime returned is the new
 * state for `runtime.agentId`; {@link RuntimeEffect}s are side effects the
 * caller is expected to perform (toasts, REST refresh, etc).
 *
 * Frames whose `agentId` does not match this runtime are returned unchanged
 * with no effects — the dispatcher upstream is expected to route, but we
 * defend in depth.
 */
export function applyEvent(runtime: AgentRuntime, frame: ChatStreamFrame): ApplyResult {
  const effects: RuntimeEffect[] = [];
  const tagged = (frame as { agentId?: string }).agentId;
  if (tagged && tagged !== runtime.agentId) {
    return { next: runtime, effects };
  }

  switch (frame.type) {
    case 'start':
      return {
        next: {
          ...runtime,
          isStreaming: true,
          streaming: EMPTY_STREAMING,
        },
        effects,
      };

    case 'user_message_persisted':
      return {
        next: {
          ...runtime,
          activeSessionId: frame.sessionId,
          messages: upsertUserMessage(runtime.messages, frame.message),
        },
        effects,
      };

    case 'text_delta': {
      const step = ensureStep(runtime.streaming.currentStep);
      const next = updateStep(runtime, {
        ...step,
        text: (step.text ?? '') + frame.text,
      });
      return { next, effects };
    }

    case 'thinking_delta': {
      const step = ensureStep(runtime.streaming.currentStep);
      const next = updateStep(runtime, {
        ...step,
        thinking: (step.thinking ?? '') + frame.thinking,
      });
      return { next, effects };
    }

    case 'tool_call': {
      const step = ensureStep(runtime.streaming.currentStep);
      const tool: ToolCallInfo = {
        name: frame.name,
        input: frame.input,
        toolUseId: frame.toolUseId,
      };
      const next = updateStep(runtime, {
        ...step,
        toolCalls: [...step.toolCalls, tool],
      });
      return { next, effects };
    }

    case 'tool_result': {
      const matches = (t: ToolCallInfo): boolean =>
        (frame.toolUseId !== undefined && t.toolUseId === frame.toolUseId) ||
        (frame.toolUseId === undefined && t.name === frame.name && t.isError === undefined);
      const fill = (t: ToolCallInfo): ToolCallInfo =>
        matches(t) ? { ...t, isError: frame.isError, result: frame.output } : t;

      const completedSteps = runtime.streaming.steps.map((step) => ({
        ...step,
        toolCalls: step.toolCalls.map(fill),
      }));
      const currentStep = runtime.streaming.currentStep
        ? {
            ...runtime.streaming.currentStep,
            toolCalls: runtime.streaming.currentStep.toolCalls.map(fill),
          }
        : null;
      return {
        next: {
          ...runtime,
          streaming: {
            ...runtime.streaming,
            steps: completedSteps,
            currentStep,
          },
        },
        effects,
      };
    }

    case 'api_response': {
      const inference: InferenceInfo = {
        model: frame.model,
        inputTokens: frame.usage.inputTokens,
        outputTokens: frame.usage.outputTokens,
        cacheReadTokens: frame.usage.cacheReadTokens,
        cacheWriteTokens: frame.usage.cacheWriteTokens,
        stopReason: frame.stopReason,
        cost: frame.cost,
      };
      const inferences = [...runtime.streaming.inferences, inference];
      const current = runtime.streaming.currentStep;
      const completedSteps = current
        ? [...runtime.streaming.steps, { ...current, inference, status: 'completed' as const }]
        : runtime.streaming.steps;
      const tokensUsed = typeof frame.contextTokens === 'number' && frame.contextTokens > 0
        ? frame.contextTokens
        : runtime.context.tokensUsed;

      return {
        next: {
          ...runtime,
          streaming: {
            ...runtime.streaming,
            steps: completedSteps,
            currentStep: null,
            inferences,
          },
          context: { ...runtime.context, tokensUsed },
        },
        effects,
      };
    }

    case 'timeline_event': {
      const events = [...runtime.streaming.events, frame.event];
      const timeline = [...runtime.streaming.timeline, { type: 'event' as const, event: frame.event }];
      return {
        next: {
          ...runtime,
          streaming: { ...runtime.streaming, events, timeline },
        },
        effects,
      };
    }

    case 'todo_updated':
      return {
        next: {
          ...runtime,
          todosBySession: {
            ...runtime.todosBySession,
            [frame.sessionId]: frame.todos,
          },
        },
        effects,
      };

    case 'retry':
      effects.push({ type: 'toast', payload: { kind: 'retry', frame } });
      return { next: runtime, effects };

    case 'done': {
      const collected = runtime.streaming.currentStep
        ? [
            ...runtime.streaming.steps,
            { ...runtime.streaming.currentStep, status: 'completed' as const },
          ]
        : runtime.streaming.steps;
      const hydratedSteps = mergeFinalToolResults(collected, frame.message.toolCalls);
      const collectedEvents = runtime.streaming.events;
      const timeline = buildFinalTimeline(runtime.streaming.timeline, hydratedSteps);
      const assistantMsg: ChatMessage = timeline.length > 0
        ? { ...frame.message, steps: hydratedSteps, events: collectedEvents, timeline }
        : collected.length > 0
          ? { ...frame.message, steps: hydratedSteps, events: collectedEvents }
          : { ...frame.message, events: collectedEvents };

      const messages = appendAssistantAndCloseRequest(runtime.messages, assistantMsg);
      effects.push({ type: 'refresh-sessions', payload: { sessionId: frame.sessionId } });
      effects.push({ type: 'refresh-context', payload: { sessionId: frame.sessionId } });

      return {
        next: {
          ...runtime,
          messages,
          activeSessionId: frame.sessionId,
          isStreaming: false,
          creatingSession: false,
          streaming: EMPTY_STREAMING,
        },
        effects,
      };
    }

    case 'compaction': {
      effects.push({
        type: 'toast',
        payload: { kind: 'compaction', frame },
      });
      return {
        next: {
          ...runtime,
          context: {
            tokensUsed: frame.contextAfter,
            window: frame.contextWindow,
          },
        },
        effects,
      };
    }

    case 'agent_paused':
      effects.push({ type: 'agent-paused', payload: frame });
      effects.push({ type: 'refresh-sessions', payload: { sessionId: frame.sessionId } });
      if (frame.sessionId) {
        effects.push({ type: 'refresh-context', payload: { sessionId: frame.sessionId } });
      }
      return {
        next: {
          ...runtime,
          isStreaming: false,
          creatingSession: false,
          streaming: EMPTY_STREAMING,
        },
        effects,
      };

    case 'error':
      effects.push({ type: 'toast', payload: { kind: 'error', frame } });
      return {
        next: {
          ...runtime,
          isStreaming: false,
          creatingSession: false,
          streaming: EMPTY_STREAMING,
          activeSessionId: frame.sessionId ?? runtime.activeSessionId,
          messages: appendErrorMessage(runtime.messages, frame.message, frame.requestId),
        },
        effects,
      };

    case 'interject_acked':
      effects.push({ type: 'interject-acked', payload: frame });
      return {
        next: {
          ...runtime,
          messages: [
            ...runtime.messages,
            {
              id: localId(),
              role: 'user',
              content: `interject (${frame.behavior ?? 'same_turn'}): ${frame.text}`,
              timestamp: Date.now(),
              status: frame.status ?? 'queued',
              delivery: frame.delivery ?? 'interject',
            },
          ],
        },
        effects,
      };

    case 'fact_changed':
      effects.push({ type: 'fact-changed', payload: frame });
      return { next: runtime, effects };

    case 'safety_ask':
      effects.push({ type: 'safety-ask', payload: frame });
      return { next: runtime, effects };

    case 'safety_ask_resolved':
      effects.push({ type: 'safety-ask-resolved', payload: frame });
      return { next: runtime, effects };

  }

  return { next: runtime, effects };
}

/** Snapshot the streaming side of a runtime for memoised UI selectors. */
export function selectStreamingTimeline(runtime: AgentRuntime): {
  steps: ChatStep[];
  events: ChatTimelineEvent[];
  timeline: StreamingTimelineItem[];
  inferences: InferenceInfo[];
} {
  const { streaming } = runtime;
  const allSteps = streaming.currentStep
    ? [...streaming.steps, streaming.currentStep]
    : streaming.steps;
  return {
    steps: allSteps,
    events: streaming.events,
    timeline: streaming.timeline,
    inferences: streaming.inferences,
  };
}

// ===== internals =====

function ensureStep(current: ChatStep | null): ChatStep {
  if (current) return current;
  return {
    id: `step-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    toolCalls: [],
    status: 'streaming',
  };
}

function updateStep(runtime: AgentRuntime, step: ChatStep): AgentRuntime {
  const wasNew = runtime.streaming.currentStep == null;
  const timeline = wasNew
    ? [...runtime.streaming.timeline, { type: 'step' as const, stepId: step.id }]
    : runtime.streaming.timeline;
  return {
    ...runtime,
    streaming: {
      ...runtime.streaming,
      currentStep: step,
      timeline,
    },
  };
}

function upsertUserMessage(messages: ChatMessage[], message: ChatMessage): ChatMessage[] {
  if (!message.requestId) return [...messages, message];
  const idx = messages.findIndex((m) => m.role === 'user' && m.requestId === message.requestId);
  if (idx < 0) return [...messages, message];
  const next = [...messages];
  next[idx] = { ...next[idx], ...message };
  return next;
}

function appendAssistantAndCloseRequest(
  messages: ChatMessage[],
  assistant: ChatMessage,
): ChatMessage[] {
  if (!assistant.requestId) return [...messages, assistant];
  return [
    ...messages.map((m) =>
      m.role === 'user' && m.requestId === assistant.requestId
        ? { ...m, status: 'completed' as const }
        : m,
    ),
    assistant,
  ];
}

function appendErrorMessage(
  messages: ChatMessage[],
  errorMessage: string,
  requestId?: string,
): ChatMessage[] {
  const closed = requestId
    ? messages.map((m) =>
        m.role === 'user' && m.requestId === requestId
          ? { ...m, status: 'failed' as const }
          : m,
      )
    : messages;
  return [
    ...closed,
    {
      id: localId(),
      role: 'assistant',
      content: `Error: ${errorMessage}`,
      timestamp: Date.now(),
      status: 'failed',
      delivery: 'turn',
    },
  ];
}

function localId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}
