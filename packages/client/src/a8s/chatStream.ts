/**
 * a8s AgentEvent → claw WsIncoming translation.
 *
 * The a8s control plane streams a turn as raw SDK `AgentEvent`s (no agentId /
 * sessionId — the caller knows which agent it asked). berry-claw's runtime
 * reducer consumes `WsIncoming` frames that carry both. So when we drive a turn
 * via A8sClient.sendToAgent(onEvent), we stamp agentId + sessionId onto each
 * event and shape it into the WsIncoming the reducer already understands.
 *
 * Both vocabularies descend from the same SDK AgentEvent union, so the mapping
 * is mostly a passthrough + tagging; the differences are: claw splits the turn
 * lifecycle into explicit start/done frames (a8s carries those in the SSE
 * envelope, not as events), and a few a8s-only events have no claw frame and
 * are dropped.
 */
import type { WsIncoming, TodoItem } from '@berry-agent/claw-contracts';

export interface StreamContext {
  agentId: string;
  /** Mutable: unknown until the first event/SendResponse carries it. */
  sessionId?: string;
  /** Monotonic clock injected by the caller (Date.now); keeps this pure-ish
   *  and testable. */
  now: () => number;
}

/**
 * Translate one raw a8s AgentEvent into a claw WsIncoming frame, or null if it
 * has no claw equivalent (those are SDK-internal lifecycle markers the UI
 * doesn't render). Mutates ctx.sessionId when an event reveals it.
 */
export function a8sEventToWsIncoming(
  raw: Record<string, unknown>,
  ctx: StreamContext,
): WsIncoming | null {
  const type = raw.type as string;
  const sid = ctx.sessionId;
  switch (type) {
    case 'query_start': {
      // query_start carries the authoritative sessionId for the turn.
      if (typeof raw.sessionId === 'string') ctx.sessionId = raw.sessionId;
      return { type: 'start', agentId: ctx.agentId, sessionId: ctx.sessionId };
    }
    case 'text_delta':
      return { type: 'text_delta', agentId: ctx.agentId, sessionId: sid, text: String(raw.text ?? '') };
    case 'thinking_delta':
      return { type: 'thinking_delta', agentId: ctx.agentId, sessionId: sid, thinking: String(raw.thinking ?? '') };
    case 'tool_call':
      return {
        type: 'tool_call',
        agentId: ctx.agentId,
        sessionId: sid,
        name: String(raw.name ?? ''),
        input: (raw.input as Record<string, unknown>) ?? {},
        toolUseId: raw.toolUseId as string | undefined,
      };
    case 'tool_result':
      return {
        type: 'tool_result',
        agentId: ctx.agentId,
        sessionId: sid,
        name: String(raw.name ?? ''),
        isError: Boolean(raw.isError),
        toolUseId: raw.toolUseId as string | undefined,
        output: raw.output === undefined ? undefined : String(raw.output),
      };
    case 'api_response': {
      const usage = (raw.usage as Record<string, number>) ?? {};
      return {
        type: 'api_response',
        agentId: ctx.agentId,
        sessionId: sid,
        model: String(raw.model ?? ''),
        usage: {
          inputTokens: usage.inputTokens ?? 0,
          outputTokens: usage.outputTokens ?? 0,
          cacheWriteTokens: usage.cacheWriteTokens,
          cacheReadTokens: usage.cacheReadTokens,
        },
        stopReason: String(raw.stopReason ?? ''),
      };
    }
    case 'todo_updated':
      return {
        type: 'todo_updated',
        agentId: ctx.agentId,
        sessionId: String(raw.sessionId ?? sid ?? ''),
        todos: ((raw.todos as TodoItem[]) ?? []),
        timestamp: Number(raw.timestamp ?? ctx.now()),
      };
    case 'compaction':
      return {
        type: 'compaction',
        agentId: ctx.agentId,
        sessionId: sid,
        tokensFreed: Number(raw.tokensFreed ?? 0),
        layersApplied: (raw.layersApplied as string[]) ?? [],
        contextBefore: Number(raw.contextBefore ?? 0),
        contextAfter: Number(raw.contextAfter ?? 0),
        contextWindow: Number(raw.contextWindow ?? 0),
        thresholdPct: Number(raw.thresholdPct ?? 0),
        triggerReason: (raw.triggerReason as 'soft_threshold' | 'threshold' | 'overflow_retry') ?? 'threshold',
      };
    case 'retry':
      return {
        type: 'retry',
        agentId: ctx.agentId,
        sessionId: sid,
        scope: (raw.scope as 'stream' | 'chat') ?? 'stream',
        attempt: Number(raw.attempt ?? 0),
        maxAttempts: Number(raw.maxAttempts ?? 0),
        reason: (raw.reason as 'stream_idle_timeout' | 'transient_error') ?? 'transient_error',
        errorMessage: String(raw.errorMessage ?? ''),
        delayMs: Number(raw.delayMs ?? 0),
      };
    case 'status_change':
      // The runtime derives status from the frame flow; a8s status_change has
      // no dedicated claw frame. Drop.
      return null;
    default:
      // api_call / query_end / guard_decision / memory_flush / delegate_* /
      // crash_recovered: SDK-internal, no claw frame. Drop silently.
      return null;
  }
}
