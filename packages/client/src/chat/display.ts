import type {
  ChatMessage,
  ChatStep,
  ChatTimelineEvent,
  ChatTimelineItem,
  InferenceInfo,
  ToolCallInfo,
} from '@berry-agent/claw-contracts';

export type StreamingTimelineItem =
  | { type: 'event'; event: ChatTimelineEvent }
  | { type: 'step'; stepId: string };

export interface DisplayMessage {
  message: ChatMessage;
  startedAt?: number;
}

export function mergeFinalToolResults(steps: ChatStep[], finalTools?: ToolCallInfo[]): ChatStep[] {
  if (!finalTools?.length) return steps;

  const byId = new Map(finalTools.filter((tool) => tool.toolUseId).map((tool) => [tool.toolUseId, tool]));
  const byName = new Map<string, ToolCallInfo[]>();
  for (const tool of finalTools) {
    const bucket = byName.get(tool.name) ?? [];
    bucket.push(tool);
    byName.set(tool.name, bucket);
  }

  return steps.map((step) => ({
    ...step,
    toolCalls: step.toolCalls.map((tool) => {
      const hydrated = (tool.toolUseId ? byId.get(tool.toolUseId) : undefined)
        ?? byName.get(tool.name)?.find((candidate) => candidate.result !== undefined || candidate.isError !== undefined);
      return hydrated ? { ...tool, ...hydrated } : tool;
    }),
  }));
}

export function buildDisplayMessages(messages: ChatMessage[]): DisplayMessage[] {
  const out: DisplayMessage[] = [];
  let assistantGroup: ChatMessage[] = [];
  let lastUserTimestamp: number | undefined;

  const flushAssistantGroup = () => {
    if (assistantGroup.length === 0) return;
    out.push({
      message: combineAssistantMessages(assistantGroup),
      startedAt: lastUserTimestamp,
    });
    assistantGroup = [];
  };

  for (const message of messages) {
    if (message.role === 'user') {
      flushAssistantGroup();
      out.push({ message });
      lastUserTimestamp = message.timestamp;
    } else {
      assistantGroup.push(message);
    }
  }
  flushAssistantGroup();
  return out;
}

function combineAssistantMessages(group: ChatMessage[]): ChatMessage {
  if (group.length === 1) {
    const only = group[0]!;
    if (only.timeline?.length || only.steps?.length || only.events?.length) return only;
    const fallbackTimeline = assistantMessageActivityItems(only, false);
    return fallbackTimeline.length > 0 ? { ...only, timeline: fallbackTimeline } : only;
  }
  const last = group[group.length - 1]!;
  const timeline: ChatTimelineItem[] = [];
  const steps: ChatStep[] = [];
  const events: ChatTimelineEvent[] = [];
  const toolCalls: ToolCallInfo[] = [];
  const inferences: InferenceInfo[] = [];
  const thinking: string[] = [];

  for (const message of group) {
    const includeMessageTextInTimeline = message.id !== last.id;
    timeline.push(...assistantMessageActivityItems(message, includeMessageTextInTimeline));

    if (message.steps?.length) steps.push(...message.steps);
    if (message.events?.length) events.push(...message.events);
    if (message.toolCalls?.length) toolCalls.push(...message.toolCalls);
    if (message.inferences?.length) inferences.push(...message.inferences);
    if (message.thinking) thinking.push(message.thinking);
  }

  return {
    ...last,
    id: `assistant-group-${group[0]!.id}-${last.id}`,
    timestamp: last.timestamp,
    content: last.content,
    timeline: timeline.length > 0 ? timeline : undefined,
    steps: steps.length > 0 ? steps : undefined,
    events: events.length > 0 ? events : undefined,
    toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
    inferences: inferences.length > 0 ? inferences : last.inferences,
    thinking: thinking.length > 0 ? thinking.join('\n\n') : last.thinking,
  };
}

function assistantMessageActivityItems(message: ChatMessage, includeText: boolean): ChatTimelineItem[] {
  if (message.timeline?.length) {
    return includeText
      ? message.timeline
      : message.timeline.map((item) =>
        item.type === 'step'
          ? { type: 'step' as const, step: { ...item.step, text: undefined } }
          : item,
      );
  }

  if (message.steps?.length) {
    return message.steps.map((step) => ({
      type: 'step' as const,
      step: includeText ? step : { ...step, text: undefined },
    }));
  }

  const items: ChatTimelineItem[] = [];
  if (message.events?.length) {
    items.push(...message.events.map((event) => ({ type: 'event' as const, event })));
  }

  const text = includeText && message.content && message.content !== '(image)' ? message.content : undefined;
  if (message.thinking || message.toolCalls?.length || text) {
    items.push({
      type: 'step',
      step: {
        id: `message-step-${message.id}`,
        thinking: message.thinking,
        text,
        toolCalls: message.toolCalls ?? [],
        status: 'completed',
      },
    });
  }

  return items;
}

export function buildFinalTimeline(order: StreamingTimelineItem[], steps: ChatStep[]): ChatTimelineItem[] {
  if (order.length === 0) return steps.map((step) => ({ type: 'step', step }));

  const stepById = new Map(steps.map((step) => [step.id, step]));
  const emittedSteps = new Set<string>();
  const out: ChatTimelineItem[] = [];

  for (const item of order) {
    if (item.type === 'event') {
      out.push({ type: 'event', event: item.event });
      continue;
    }
    const step = stepById.get(item.stepId);
    if (!step || emittedSteps.has(step.id)) continue;
    out.push({ type: 'step', step });
    emittedSteps.add(step.id);
  }

  for (const step of steps) {
    if (!emittedSteps.has(step.id)) out.push({ type: 'step', step });
  }

  return out;
}
