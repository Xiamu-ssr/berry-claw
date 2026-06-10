import { describe, expect, it } from 'vitest';
import { deriveTeams } from '../teams';
import type { AgentFact } from '@berry-agent/claw-contracts';

function agent(id: string, labels?: Record<string, string>): AgentFact {
  return {
    id,
    name: labels?.name ?? id,
    model: 'tier:strong',
    provider: 'anthropic',
    status: 'idle',
    workerId: 'w-1',
    instantiated: true,
    labels,
  };
}

describe('deriveTeams', () => {
  it('groups team agents by project around their leader', () => {
    const teams = deriveTeams([
      agent('lead', { team: 'true', role: 'leader', leader: 'lead', project: '/code/acme', name: 'Acme' }),
      agent('reviewer-1', { team: 'true', role: 'reviewer', leader: 'lead', project: '/code/acme' }),
      agent('coder-1', { team: 'true', role: 'coder', leader: 'lead', project: '/code/acme' }),
    ]);
    expect(teams).toHaveLength(1);
    expect(teams[0].leaderId).toBe('lead');
    expect(teams[0].name).toBe('Acme');
    expect(teams[0].project).toBe('/code/acme');
    expect(teams[0].teammates.map((m) => m.id).sort()).toEqual(['coder-1', 'reviewer-1']);
  });

  it('treats an agent whose leader label points at itself as the leader', () => {
    const teams = deriveTeams([
      agent('boss', { team: 'true', leader: 'boss', project: '/p' }),
      agent('mate', { team: 'true', role: 'helper', leader: 'boss', project: '/p' }),
    ]);
    expect(teams).toHaveLength(1);
    expect(teams[0].leaderId).toBe('boss');
    expect(teams[0].teammates.map((m) => m.id)).toEqual(['mate']);
  });

  it('skips a project that has team members but no leader', () => {
    const teams = deriveTeams([
      agent('orphan', { team: 'true', role: 'reviewer', leader: 'gone', project: '/p' }),
    ]);
    expect(teams).toHaveLength(0);
  });

  it('ignores non-team agents and team agents without a project', () => {
    const teams = deriveTeams([
      agent('solo'),
      agent('floating', { team: 'true', role: 'leader', leader: 'floating' }),
      agent('lead', { team: 'true', role: 'leader', leader: 'lead', project: '/p' }),
    ]);
    expect(teams).toHaveLength(1);
    expect(teams[0].leaderId).toBe('lead');
    expect(teams[0].teammates).toHaveLength(0);
  });

  it('separates two projects into two teams', () => {
    const teams = deriveTeams([
      agent('a-lead', { team: 'true', role: 'leader', leader: 'a-lead', project: '/a', name: 'A' }),
      agent('a-mate', { team: 'true', role: 'm', leader: 'a-lead', project: '/a' }),
      agent('b-lead', { team: 'true', role: 'leader', leader: 'b-lead', project: '/b', name: 'B' }),
    ]);
    expect(teams).toHaveLength(2);
    // sorted by name: A then B
    expect(teams.map((t) => t.name)).toEqual(['A', 'B']);
    expect(teams[0].teammates).toHaveLength(1);
    expect(teams[1].teammates).toHaveLength(0);
  });
});
