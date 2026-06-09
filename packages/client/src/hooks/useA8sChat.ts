/**
 * useA8sChat — the chat transport, now backed by a8s instead of a console
 * WebSocket. Drop-in for the old useWebSocket: same `{ send, connected }`
 * surface, same WsIncoming frames delivered to `onMessage`, so the runtime
 * reducer and App wiring are untouched.
 *
 * A `chat` send drives `A8sClient.sendToAgent(onEvent)` — an SSE turn. Each raw
 * a8s AgentEvent is stamped with agentId/sessionId and shaped into a
 * WsIncoming frame (see chatStream.ts). The turn's final SendResponse becomes
 * a synthetic `done` frame so the reducer closes the turn exactly as before.
 *
 * `connected` reflects "we have a usable a8s connection" rather than a live
 * socket: the data plane is request/response SSE, not a persistent channel.
 * pause/interject map to their A8sClient calls.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { WsIncoming, WsOutgoing, ChatMessage } from '@berry-agent/claw-contracts';
import { useActiveInstance } from '../connection/store';
import { a8sClient } from '../a8s/client';
import { a8sEventToWsIncoming, type StreamContext } from '../a8s/chatStream';

export function useA8sChat(onMessage: (msg: WsIncoming) => void) {
  const instance = useActiveInstance();
  const [connected, setConnected] = useState(false);
  const onMessageRef = useRef(onMessage);
  onMessageRef.current = onMessage;

  // Probe the a8s connection once per instance so the UI can show connected
  // state and surface a bad token early (instead of only on first send).
  useEffect(() => {
    if (!instance) {
      setConnected(false);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        await a8sClient();
        if (!cancelled) setConnected(true);
      } catch (err) {
        if (!cancelled) setConnected(false);
        console.error('[a8s] connection probe failed:', err);
      }
    })();
    return () => { cancelled = true; };
  }, [instance?.id]);

  const emit = useCallback((frame: WsIncoming) => onMessageRef.current(frame), []);

  const runChat = useCallback(async (msg: Extract<WsOutgoing, { type: 'chat' }>) => {
    const agentId = msg.agentId;
    if (!agentId) return;
    const ctx: StreamContext = { agentId, sessionId: msg.sessionId, now: () => Date.now() };
    try {
      const client = await a8sClient();
      const response = await client.agent(agentId).send(
        {
          // claw ContentBlock[] is a structural superset of the wire's opaque
          // JSON-block shape; the SDK validates the real block schema.
          prompt: msg.prompt as string | Record<string, unknown>[],
          sessionId: msg.sessionId,
          requestId: msg.requestId,
        },
        (raw) => {
          const frame = a8sEventToWsIncoming(raw, ctx);
          if (frame) emit(frame);
        },
      );
      const done = buildDoneFrame(response, { agentId, fallbackSessionId: ctx.sessionId, requestId: msg.requestId });
      ctx.sessionId = done.sessionId;
      emit(done);
    } catch (err) {
      emit({
        type: 'error',
        agentId,
        sessionId: ctx.sessionId,
        message: err instanceof Error ? err.message : String(err),
        requestId: msg.requestId,
      });
    }
  }, [emit]);

  const send = useCallback((msg: WsOutgoing) => {
    switch (msg.type) {
      case 'chat':
        void runChat(msg);
        return;
      case 'pause_agent':
        if (msg.agentId) {
          void a8sClient()
            .then((c) => c.pauseAgent(msg.agentId!, msg.reason))
            .then(() => emit({ type: 'agent_paused', agentId: msg.agentId!, sessionId: msg.sessionId, paused: true, reason: msg.reason }))
            .catch((err) => console.error('[a8s] pause failed:', err));
        }
        return;
      case 'interject':
        if (msg.agentId) {
          void a8sClient()
            .then((c) => c.interjectAgent(msg.agentId!, msg.text))
            .then(() => emit({ type: 'interject_acked', agentId: msg.agentId!, text: msg.text, status: 'queued', delivery: 'interject', behavior: 'same_turn' }))
            .catch((err) => console.error('[a8s] interject failed:', err));
        }
        return;
    }
  }, [runChat, emit]);

  return { send, connected };
}

/**
 * Shape a turn's final SendResponse into the synthetic `done` frame the reducer
 * expects. Exported + pure so it can be unit-tested without a live SSE turn.
 *
 * `response.result` IS the opaque ManagedAgentTurnResult
 * (`{ sessionId, userMessage, result: QueryResult, assistantMessage, view }`).
 * The rendered assistant bubble lives at `.assistantMessage`; usage /
 * totalUsage / toolCalls (a count, not an array) live on the inner QueryResult
 * at `.result`. Reading `.message`/`.usage` off the OUTER object — as we used
 * to — always yielded undefined, so every assistant turn closed with an empty
 * bubble and zero usage.
 */
export function buildDoneFrame(
  response: { sessionId?: string; result?: unknown },
  opts: { agentId: string; fallbackSessionId?: string; requestId?: string },
): Extract<WsIncoming, { type: 'done' }> {
  const sessionId = response.sessionId ?? opts.fallbackSessionId ?? '';
  const turn = (response.result ?? {}) as Record<string, unknown>;
  const query = (turn.result ?? {}) as Record<string, unknown>;
  const message = (turn.assistantMessage as ChatMessage) ?? buildFallbackMessage(query, opts.requestId);
  return {
    type: 'done',
    agentId: opts.agentId,
    sessionId,
    message,
    usage: query.usage ?? null,
    totalUsage: query.totalUsage ?? null,
    toolCalls: Number(query.toolCalls ?? 0),
    requestId: opts.requestId,
  };
}

/** When a turn result has no rendered message, synthesize a minimal one so the
 *  optimistic user bubble still resolves and the assistant turn closes. */
function buildFallbackMessage(result: Record<string, unknown>, requestId?: string): ChatMessage {
  const text = typeof result.text === 'string' ? result.text : '';
  return {
    id: `a_${requestId ?? 'turn'}`,
    role: 'assistant',
    content: text,
    timestamp: Date.now(),
  } as ChatMessage;
}
