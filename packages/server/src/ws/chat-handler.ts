import type { WebSocket } from 'ws';
import { timelineEventFromAgentEvent, type AgentEvent, type ContentBlock } from '@berry-agent/core';
import type { AgentManager } from '../engine/agent-manager.js';

function contextTokensForApiResponse(event: Extract<AgentEvent, { type: 'api_response' }>): number {
  // Per SDK TokenUsage contract: `inputTokens` is the total input tokens billed
  // for this call, with cached portions already included. Re-adding cache here
  // would double-count and inflate the displayed CTX.
  return event.usage.inputTokens;
}

export async function handleChat(
  ws: WebSocket,
  manager: AgentManager,
  prompt: string | ContentBlock[],
  sessionId?: string,
  requestId?: string,
  agentId?: string,
) {
  const targetAgentId = agentId ?? manager.activeAgent;
  if (!targetAgentId || !manager.config.getAgent(targetAgentId)) {
    ws.send(JSON.stringify({
      type: 'error',
      agentId: targetAgentId ?? 'unknown',
      message: 'No agent configured. Create an agent first.',
    }));
    return;
  }

  let resolvedSessionId = sessionId;
  const send = (frame: Record<string, unknown>): void => {
    ws.send(JSON.stringify({
      ...frame,
      agentId: targetAgentId,
      sessionId: resolvedSessionId ?? sessionId,
    }));
  };

  send({ type: 'start', requestId });

  try {
    const { result, assistantMessage } = await manager.chat(prompt, {
      sessionId,
      requestId,
      agentId: targetAgentId,
      onUserMessagePersisted: (message, createdSessionId) => {
        resolvedSessionId = createdSessionId;
        send({ type: 'user_message_persisted', message });
      },
      onEvent: (event: AgentEvent) => {
        const timeline = timelineEventFromAgentEvent(event);
        if (timeline && event.type !== 'api_response') {
          send({ type: 'timeline_event', event: timeline });
        }
        switch (event.type) {
          case 'text_delta':
            send({ type: 'text_delta', text: event.text });
            break;
          case 'thinking_delta':
            send({ type: 'thinking_delta', thinking: event.thinking });
            break;
          case 'tool_call':
            send({
              type: 'tool_call',
              name: event.name,
              input: event.input,
              toolUseId: event.toolUseId,
            });
            break;
          case 'tool_result':
            send({
              type: 'tool_result',
              name: event.name,
              isError: event.isError,
              toolUseId: event.toolUseId,
              output: event.output,
            });
            break;
          case 'compaction':
            send({
              type: 'compaction',
              tokensFreed: event.tokensFreed,
              layersApplied: event.layersApplied,
              contextBefore: event.contextBefore,
              contextAfter: event.contextAfter,
              contextWindow: event.contextWindow,
              thresholdPct: event.thresholdPct,
              triggerReason: event.triggerReason,
            });
            break;
          case 'todo_updated':
            send({
              type: 'todo_updated',
              sessionId: event.sessionId,
              todos: event.todos,
              timestamp: event.timestamp,
            });
            break;
          case 'retry':
            send({
              type: 'retry',
              scope: event.scope,
              attempt: event.attempt,
              maxAttempts: event.maxAttempts,
              reason: event.reason,
              errorMessage: event.errorMessage,
              delayMs: event.delayMs,
            });
            break;
          case 'api_response':
            send({
              type: 'api_response',
              model: event.model,
              usage: event.usage,
              stopReason: event.stopReason,
              cost: (event as any).cost,
              contextTokens: contextTokensForApiResponse(event),
            });
            if (timeline) send({ type: 'timeline_event', event: timeline });
            break;
        }
      },
    });

    resolvedSessionId = result.sessionId;
    send({
      type: 'done',
      requestId,
      message: assistantMessage,
      usage: result.usage,
      totalUsage: result.totalUsage,
      toolCalls: result.toolCalls,
    });
  } catch (err: any) {
    send({ type: 'error', requestId, message: err.message });
  }
}
