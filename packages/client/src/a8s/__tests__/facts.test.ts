import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the a8s client factory so loadAgentFacts runs against a fake control
// plane (no network, no auth bridge).
const listAgents = vi.fn();
const agentSnapshot = vi.fn();
vi.mock('../client', () => ({
  a8sClient: async () => ({ listAgents, agentSnapshot }),
}));

import { loadAgentFacts } from '../facts';

beforeEach(() => {
  listAgents.mockReset();
  agentSnapshot.mockReset();
});

describe('loadAgentFacts', () => {
  it('assembles a fact per agent from listAgents + agentSnapshot', async () => {
    listAgents.mockResolvedValue({
      agents: [{ agentId: 'a1', workerId: 'w1' }],
    });
    agentSnapshot.mockResolvedValue({
      model: 'claude-opus-4.8',
      provider: 'anthropic',
      status: 'thinking',
      statusDetail: 'planning',
      hands: [{ id: 'workspace', kind: 'builtin', capabilities: ['read', 'write'] }],
      skills: [{ name: 'deep-research', description: 'fan-out research' }],
      tools: ['read_file', 'write_file'],
    });

    const facts = await loadAgentFacts();
    expect(facts).toHaveLength(1);
    expect(facts[0]).toMatchObject({
      id: 'a1',
      name: 'a1',
      model: 'claude-opus-4.8',
      provider: 'anthropic',
      status: 'thinking',
      statusDetail: 'planning',
      workerId: 'w1',
      instantiated: true,
    });
    expect(facts[0].hands).toHaveLength(1);
    expect(facts[0].skills?.[0].name).toBe('deep-research');
  });

  it('returns a roster-only fact for an unscheduled agent (no snapshot call)', async () => {
    listAgents.mockResolvedValue({
      agents: [{ agentId: 'pending', workerId: null }],
    });

    const facts = await loadAgentFacts();
    expect(agentSnapshot).not.toHaveBeenCalled();
    expect(facts[0]).toMatchObject({
      id: 'pending',
      workerId: null,
      instantiated: false,
      status: 'idle',
      model: '',
    });
  });

  it('narrows an unknown status to idle rather than crashing', async () => {
    listAgents.mockResolvedValue({ agents: [{ agentId: 'a1', workerId: 'w1' }] });
    agentSnapshot.mockResolvedValue({
      model: 'm', provider: 'p', status: 'some_future_status',
      hands: [], skills: [], tools: [],
    });
    const facts = await loadAgentFacts();
    expect(facts[0].status).toBe('idle');
  });

  it('keeps the roster fact when a snapshot fails (eviction race)', async () => {
    listAgents.mockResolvedValue({ agents: [{ agentId: 'a1', workerId: 'w1' }] });
    agentSnapshot.mockRejectedValue(new Error('agent_not_found'));
    const facts = await loadAgentFacts();
    expect(facts[0]).toMatchObject({ id: 'a1', workerId: 'w1', instantiated: true, model: '' });
  });
});
