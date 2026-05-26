import { describe, expect, it, vi } from 'vitest';
import {
  createToolRegistrationHand,
  type Hand,
  type ManagedAgentRuntime,
} from '@berry-agent/core';
import type { MCPManager } from '@berry-agent/mcp';
import { AgentMcpHost } from '../engine/agent-mcp-host.js';
import type { AgentEntry, ConfigManager } from '../engine/config-manager.js';

function hand(id: string, toolName: string): Hand {
  return createToolRegistrationHand({
    id,
    kind: 'mcp',
    tools: [{
      definition: {
        name: toolName,
        description: toolName,
        inputSchema: { type: 'object' },
      },
      execute: async () => ({ content: 'ok' }),
    }],
  });
}

function fakeRuntime() {
  const mounted = new Map<string, Hand>();
  const removed: string[] = [];
  const setToolDenylist = vi.fn();
  const runtime = {
    hasHand: (id: string) => mounted.has(id),
    addHand: (next: Hand) => { mounted.set(next.id, next); },
    removeHand: (id: string) => {
      removed.push(id);
      return mounted.delete(id);
    },
    setToolDenylist,
  } as unknown as ManagedAgentRuntime;
  return { runtime, mounted, removed, setToolDenylist };
}

describe('AgentMcpHost', () => {
  it('syncs live runtime MCP hands from the SDK MCP manager fact source', async () => {
    let currentHands: Hand[] = [];
    const mcpManager = {
      getHandsForAgent: vi.fn(() => currentHands),
      releaseAgent: vi.fn(async () => {}),
      shutdown: vi.fn(async () => {}),
    } as unknown as MCPManager;
    const { runtime, mounted, removed, setToolDenylist } = fakeRuntime();
    const entry = {
      name: 'Coder',
      model: 'gpt-4o',
      disabledTools: ['docs_search'],
    } as AgentEntry;
    const emitAgentFact = vi.fn();

    const host = new AgentMcpHost({
      config: {} as ConfigManager,
      mcpManager,
      getInstance: (agentId) => agentId === 'coder' ? { runtime, entry } : undefined,
      liveAgentIds: () => ['coder'],
      emitAgentFact,
    });

    const first = hand('mcp:docs', 'docs_search');
    currentHands = [first];
    await host.syncAgent('coder');

    expect([...mounted.keys()]).toEqual(['mcp:docs']);
    expect(mounted.get('mcp:docs')).toBe(first);
    expect(setToolDenylist).toHaveBeenLastCalledWith(['docs_search']);

    const restarted = hand('mcp:docs', 'docs_read');
    currentHands = [restarted];
    await host.syncAgent('coder');

    expect(removed).toEqual(['mcp:docs']);
    expect(mounted.get('mcp:docs')).toBe(restarted);

    currentHands = [];
    await host.syncAgent('coder');

    expect(removed).toEqual(['mcp:docs', 'mcp:docs']);
    expect([...mounted.keys()]).toEqual([]);
    expect(emitAgentFact).toHaveBeenCalledTimes(3);
  });
});
