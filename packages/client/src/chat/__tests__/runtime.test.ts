import { describe, expect, it } from 'vitest';

import {
  applyEvent,
  createAgentRuntime,
  selectStreamingTimeline,
} from '../runtime';

const startFrame = (agentId: string) => ({ type: 'start' as const, agentId });
const textDelta = (agentId: string, text: string) => ({ type: 'text_delta' as const, agentId, text });
const doneFrame = (agentId: string, sessionId: string) => ({
  type: 'done' as const,
  agentId,
  sessionId,
  message: {
    id: 'asst-1',
    role: 'assistant' as const,
    content: 'final answer',
    timestamp: 0,
  },
  usage: undefined,
  totalUsage: undefined,
  toolCalls: 0,
});

describe('chat runtime reducer', () => {
  it('flips isStreaming on start and clears it on done', () => {
    const initial = createAgentRuntime('orange');
    const afterStart = applyEvent(initial, startFrame('orange')).next;
    expect(afterStart.isStreaming).toBe(true);

    const streaming = applyEvent(afterStart, textDelta('orange', 'hello')).next;
    expect(streaming.isStreaming).toBe(true);
    expect(selectStreamingTimeline(streaming).steps[0]?.text).toBe('hello');

    const done = applyEvent(streaming, doneFrame('orange', 'sess-1')).next;
    expect(done.isStreaming).toBe(false);
    expect(done.activeSessionId).toBe('sess-1');
    expect(done.streaming.steps).toHaveLength(0);
    expect(done.messages.at(-1)?.role).toBe('assistant');
  });

  it('ignores frames addressed to a different agent', () => {
    const orange = applyEvent(createAgentRuntime('orange'), startFrame('orange')).next;
    expect(orange.isStreaming).toBe(true);

    // A done frame for a *different* agent must not flip orange off.
    const result = applyEvent(orange, doneFrame('blueberry', 'sess-x'));
    expect(result.next).toBe(orange); // identity preserved
    expect(result.next.isStreaming).toBe(true);
  });

  it('agent A streaming does not bleed into agent B', () => {
    // Two independent runtimes — exactly what useAgentRuntimes maintains.
    let a = createAgentRuntime('orange');
    let b = createAgentRuntime('blueberry');

    a = applyEvent(a, startFrame('orange')).next;
    a = applyEvent(a, textDelta('orange', 'A')).next;

    expect(b.isStreaming).toBe(false);
    expect(selectStreamingTimeline(b).steps).toHaveLength(0);

    // 'b' frames are completely independent.
    b = applyEvent(b, startFrame('blueberry')).next;
    b = applyEvent(b, textDelta('blueberry', 'BB')).next;

    expect(a.isStreaming).toBe(true);
    expect(selectStreamingTimeline(a).steps[0]?.text).toBe('A');

    expect(b.isStreaming).toBe(true);
    expect(selectStreamingTimeline(b).steps[0]?.text).toBe('BB');

    // Finishing only A leaves B running.
    a = applyEvent(a, doneFrame('orange', 'sess-A')).next;
    expect(a.isStreaming).toBe(false);
    expect(b.isStreaming).toBe(true);
  });

  it('routes errors to the owning agent and closes its turn', () => {
    let rt = applyEvent(createAgentRuntime('orange'), startFrame('orange')).next;
    rt = applyEvent(rt, textDelta('orange', 'hi')).next;

    const result = applyEvent(rt, {
      type: 'error',
      agentId: 'orange',
      message: 'provider exploded',
      sessionId: 'sess-bad',
    } as any);

    expect(result.next.isStreaming).toBe(false);
    expect(result.next.streaming.steps).toHaveLength(0);
    expect(result.next.activeSessionId).toBe('sess-bad');
    expect(result.next.messages.at(-1)?.content).toContain('provider exploded');

    // Must surface a toast via the effect channel, not via mutating state.
    const toast = result.effects.find((e) => e.type === 'toast');
    expect(toast).toBeDefined();
  });
});
