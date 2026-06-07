import { describe, expect, it } from 'vitest';
import type { AgentFact, TeamFact } from '@berry-agent/claw-contracts';
import { buildProjectSummaries } from '../summary';

const agent = (id: string, over: Partial<AgentFact> = {}): AgentFact => ({
  id,
  name: id,
  model: 'gpt',
  provider: 'openai',
  status: 'idle',
  workerId: null,
  instantiated: false,
  ...over,
});

const team = (id: string, over: Partial<TeamFact> = {}): TeamFact =>
  ({
    id,
    name: id,
    project: '',
    projectPaths: { roots: [] } as unknown as TeamFact['projectPaths'],
    leaderId: '',
    teammates: [],
    worklist: [],
    messageCount: 0,
    ...over,
  }) as TeamFact;

describe('buildProjectSummaries', () => {
  it('groups team agents under the team project and dedupes the leader', () => {
    const agents = [agent('lead'), agent('a1'), agent('a2')];
    const teams = [
      team('t1', {
        name: 'Alpha',
        project: '/work/alpha',
        leaderId: 'lead',
        teammates: [
          { agentId: 'a1', role: 'member' },
          { agentId: 'a2', role: 'member' },
          { agentId: 'lead', role: 'lead' }, // leader also listed as teammate
        ],
      }),
    ];

    const out = buildProjectSummaries(agents, teams);
    expect(out).toHaveLength(1);
    expect(out[0].name).toBe('alpha');
    expect(out[0].path).toBe('/work/alpha');
    // leader counted once despite appearing in teammates + leaderId
    expect(out[0].agents.map((a) => a.id).sort()).toEqual(['a1', 'a2', 'lead']);
    expect(out[0].teams).toHaveLength(1);
  });

  it('puts agents with no team in the unbound bucket', () => {
    const agents = [agent('solo1'), agent('solo2')];
    const out = buildProjectSummaries(agents, []);
    expect(out).toHaveLength(1);
    expect(out[0].key).toBe('__unbound__');
    expect(out[0].name).toBe('未绑定项目');
    expect(out[0].agents.map((a) => a.id)).toEqual(['solo1', 'solo2']);
  });

  it('sorts projects by name and keeps the unbound bucket last', () => {
    const agents = [agent('z'), agent('y'), agent('orphan')];
    const teams = [
      team('tz', { name: 'Zeta', project: '/p/zeta', leaderId: 'z', teammates: [] }),
      team('ty', { name: 'Yard', project: '/p/yard', leaderId: 'y', teammates: [] }),
    ];

    const out = buildProjectSummaries(agents, teams);
    expect(out.map((s) => s.name)).toEqual(['yard', 'zeta', '未绑定项目']);
    const unbound = out.find((s) => s.key === '__unbound__')!;
    expect(unbound.agents.map((a) => a.id)).toEqual(['orphan']);
  });

  it('does not double-claim an agent that belongs to two teams', () => {
    const agents = [agent('shared')];
    const teams = [
      team('t1', { name: 'One', project: '/p/one', leaderId: 'shared', teammates: [] }),
      team('t2', { name: 'Two', project: '/p/two', leaderId: 'shared', teammates: [] }),
    ];
    const out = buildProjectSummaries(agents, teams);
    const all = out.flatMap((s) => s.agents.map((a) => a.id));
    expect(all).toEqual(['shared']); // claimed exactly once
  });
});
