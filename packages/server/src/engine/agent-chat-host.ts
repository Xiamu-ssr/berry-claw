import {
  createPendingUserChatMessage,
  type AgentChatMessage,
  type AgentEvent,
  type ContentBlock,
  type QueryResult,
} from '@berry-agent/core';
import { calculateCost, type ModelPricing } from '@berry-agent/observe';
import type { A8sClient } from '@berry-agent/client';

export interface AgentChatHostOptions {
  client: A8sClient;
  pricingOverrides: () => Record<string, ModelPricing>;
}

export interface AgentChatOptions {
  agentId: string;
  sessionId?: string;
  requestId?: string;
  onEvent?: (event: AgentEvent) => void;
  onUserMessagePersisted?: (message: AgentChatMessage, sessionId: string) => void;
}

export interface AgentChatResult {
  sessionId: string;
  userMessage: AgentChatMessage;
  result: QueryResult;
  assistantMessage: AgentChatMessage;
}

/**
 * Chat host — thin BFF over a8s. The turn runs on the worker; we stream it
 * via the a8s client's SSE `sendToAgent`, relaying live AgentEvents to the
 * caller's onEvent (with cost annotation) and resolving from the terminal
 * `done` frame.
 *
 * `onUserMessagePersisted` can't cross the wire (the streaming send has no
 * such hook), so the BFF synthesizes the pending user bubble locally — it
 * has the prompt, and the sessionId arrives on the first stream event
 * (query_start). The durable user message itself is persisted by the SDK
 * on the worker; this is only the transient UI echo, matching prior behavior.
 */
export class AgentChatHost {
  constructor(private readonly options: AgentChatHostOptions) {}

  async send(prompt: string | ContentBlock[], options: AgentChatOptions): Promise<AgentChatResult> {
    const userMessage = createPendingUserChatMessage(prompt, { requestId: options.requestId });
    let userEchoed = false;

    const response = await this.options.client.sendToAgent(
      options.agentId,
      {
        prompt: prompt as Parameters<A8sClient['sendToAgent']>[1]['prompt'],
        sessionId: options.sessionId,
        requestId: options.requestId,
      },
      (raw: Record<string, unknown>) => {
        const event = raw as unknown as AgentEvent;
        // First event carries the resolved sessionId — emit the user echo once.
        if (!userEchoed) {
          const sid = (raw as { sessionId?: string }).sessionId;
          if (typeof sid === 'string') {
            userEchoed = true;
            options.onUserMessagePersisted?.(userMessage, sid);
          }
        }
        options.onEvent?.(this.withCost(event));
      },
    );

    const result = response.result as unknown as {
      result: QueryResult;
      assistantMessage: AgentChatMessage;
    };
    return {
      sessionId: response.sessionId,
      userMessage,
      result: result.result,
      assistantMessage: result.assistantMessage,
    };
  }

  private withCost(event: AgentEvent): AgentEvent {
    if (event.type !== 'api_response') return event;
    const cost = calculateCost(
      event.model,
      event.usage.inputTokens,
      event.usage.outputTokens,
      event.usage.cacheReadTokens ?? 0,
      event.usage.cacheWriteTokens ?? 0,
      this.options.pricingOverrides(),
    );
    return { ...event, cost: cost.totalCost } as AgentEvent;
  }
}
