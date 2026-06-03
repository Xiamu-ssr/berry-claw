import type {
  AgentChatMessage,
  AgentEvent,
  AgentSessionView,
  ContentBlock,
  ManagedAgentRuntime,
  QueryResult,
} from '@berry-agent/core';
import { calculateCost, type ModelPricing } from '@berry-agent/observe';

export interface AgentChatHostOptions {
  getRuntime: (agentId: string) => ManagedAgentRuntime;
  pricingOverrides: () => Record<string, ModelPricing>;
  emitSessionFact: (view: AgentSessionView) => void;
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

export class AgentChatHost {
  constructor(private readonly options: AgentChatHostOptions) {}

  async send(prompt: string | ContentBlock[], options: AgentChatOptions): Promise<AgentChatResult> {
    const turn = await this.options.getRuntime(options.agentId).send(prompt, {
      sessionId: options.sessionId,
      requestId: options.requestId,
      onEvent: (event: AgentEvent) => {
        options.onEvent?.(this.withCost(event));
      },
      onUserMessagePersisted: options.onUserMessagePersisted,
    });

    if (turn.view) this.options.emitSessionFact(turn.view);
    return {
      sessionId: turn.sessionId,
      userMessage: turn.userMessage,
      result: turn.result,
      assistantMessage: turn.assistantMessage,
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
