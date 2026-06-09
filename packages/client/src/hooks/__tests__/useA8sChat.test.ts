// ============================================================
// useA8sChat — buildDoneFrame mapping
// ============================================================
// Regression for the "empty assistant bubble" bug: the SDK returns a
// SendResponse whose `.result` IS the ManagedAgentTurnResult. The rendered
// message is at result.assistantMessage; usage/toolCalls at result.result
// (the inner QueryResult). Reading them off the outer object yielded undefined
// and every assistant turn closed empty. These tests pin the correct mapping.

import { describe, expect, it } from 'vitest';
import { buildDoneFrame } from '../useA8sChat';

function turnResponse() {
  return {
    sessionId: 's-auth',
    result: {
      sessionId: 's-auth',
      userMessage: { id: 'u1', role: 'user', content: 'ping', timestamp: 1 },
      assistantMessage: { id: 'a1', role: 'assistant', content: 'pong', timestamp: 2 },
      view: null,
      result: {
        text: 'pong',
        sessionId: 's-auth',
        usage: { inputTokens: 10, outputTokens: 4 },
        totalUsage: { inputTokens: 100, outputTokens: 40 },
        toolCalls: 3,
        compacted: false,
      },
    },
  };
}

describe('buildDoneFrame', () => {
  it('maps the rendered assistantMessage (not the undefined outer .message)', () => {
    const frame = buildDoneFrame(turnResponse(), { agentId: 'coder', requestId: 'r1' });
    expect(frame.type).toBe('done');
    expect(frame.message.content).toBe('pong');
    expect(frame.message.role).toBe('assistant');
  });

  it('pulls usage/totalUsage/toolCalls from the inner QueryResult', () => {
    const frame = buildDoneFrame(turnResponse(), { agentId: 'coder' });
    expect(frame.usage).toEqual({ inputTokens: 10, outputTokens: 4 });
    expect(frame.totalUsage).toEqual({ inputTokens: 100, outputTokens: 40 });
    expect(frame.toolCalls).toBe(3);
  });

  it('uses the authoritative sessionId from the response', () => {
    const frame = buildDoneFrame(turnResponse(), { agentId: 'coder', fallbackSessionId: 'stale' });
    expect(frame.sessionId).toBe('s-auth');
  });

  it('falls back to the response.result text when assistantMessage is absent', () => {
    const frame = buildDoneFrame(
      { sessionId: 's', result: { result: { text: 'from-text', toolCalls: 0 } } },
      { agentId: 'coder', requestId: 'r9' },
    );
    expect(frame.message.content).toBe('from-text');
    expect(frame.message.id).toBe('a_r9');
    expect(frame.toolCalls).toBe(0);
  });

  it('degrades gracefully on an empty result (no throw, empty bubble + zeros)', () => {
    const frame = buildDoneFrame({ sessionId: 's' }, { agentId: 'coder' });
    expect(frame.message.content).toBe('');
    expect(frame.usage).toBeNull();
    expect(frame.toolCalls).toBe(0);
  });
});
