import { describe, it, expect } from 'vitest';
import { a8sEventToWsIncoming, type StreamContext } from '../chatStream';

function ctx(over: Partial<StreamContext> = {}): StreamContext {
  return { agentId: 'a1', now: () => 1000, ...over };
}

describe('a8sEventToWsIncoming', () => {
  it('captures sessionId from query_start and emits a start frame', () => {
    const c = ctx();
    const frame = a8sEventToWsIncoming({ type: 'query_start', sessionId: 's1' }, c);
    expect(c.sessionId).toBe('s1');
    expect(frame).toEqual({ type: 'start', agentId: 'a1', sessionId: 's1' });
  });

  it('stamps agentId + sessionId onto a text_delta', () => {
    const frame = a8sEventToWsIncoming({ type: 'text_delta', text: 'hi' }, ctx({ sessionId: 's1' }));
    expect(frame).toEqual({ type: 'text_delta', agentId: 'a1', sessionId: 's1', text: 'hi' });
  });

  it('maps a tool_call with input + toolUseId', () => {
    const frame = a8sEventToWsIncoming(
      { type: 'tool_call', name: 'read_file', input: { path: '/x' }, toolUseId: 't1' },
      ctx({ sessionId: 's1' }),
    );
    expect(frame).toMatchObject({
      type: 'tool_call', agentId: 'a1', sessionId: 's1', name: 'read_file',
      input: { path: '/x' }, toolUseId: 't1',
    });
  });

  it('maps a tool_result and normalizes output to string|undefined', () => {
    expect(a8sEventToWsIncoming({ type: 'tool_result', name: 'read_file', isError: false }, ctx())).toMatchObject({
      type: 'tool_result', name: 'read_file', isError: false, output: undefined,
    });
    expect(a8sEventToWsIncoming({ type: 'tool_result', name: 'x', output: 42 }, ctx())).toMatchObject({
      output: '42',
    });
  });

  it('maps api_response usage with cache fields preserved', () => {
    const frame = a8sEventToWsIncoming(
      { type: 'api_response', model: 'opus', stopReason: 'end_turn', usage: { inputTokens: 10, outputTokens: 5, cacheReadTokens: 3 } },
      ctx({ sessionId: 's1' }),
    );
    expect(frame).toMatchObject({
      type: 'api_response', model: 'opus', stopReason: 'end_turn',
      usage: { inputTokens: 10, outputTokens: 5, cacheReadTokens: 3 },
    });
  });

  it('falls back to ctx.now() for a todo_updated without timestamp', () => {
    const frame = a8sEventToWsIncoming({ type: 'todo_updated', todos: [] }, ctx({ sessionId: 's1' }));
    expect(frame).toMatchObject({ type: 'todo_updated', sessionId: 's1', todos: [], timestamp: 1000 });
  });

  it('drops status_change and SDK-internal events', () => {
    expect(a8sEventToWsIncoming({ type: 'status_change', status: 'idle' }, ctx())).toBeNull();
    expect(a8sEventToWsIncoming({ type: 'query_end' }, ctx())).toBeNull();
    expect(a8sEventToWsIncoming({ type: 'memory_flush' }, ctx())).toBeNull();
  });
});
