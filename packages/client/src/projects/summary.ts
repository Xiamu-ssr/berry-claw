import { useMemo } from 'react';
import type {
  AgentFact,
  ProjectSharedPathsFact,
  TeamFact,
} from '@berry-agent/claw-contracts';
import { lastPathPart } from '../utils/format';

export interface ProjectSummary {
  key: string;
  name: string;
  path: string;
  paths?: ProjectSharedPathsFact;
  agents: AgentFact[];
  teams: TeamFact[];
}

const UNBOUND = '__unbound__';

/**
 * Projects are a team-scoped concept now: an a8s-derived AgentFact no longer
 * carries a `project` (berry-claw stores no agent config). So we group by the
 * team's project and attach agents through team membership; any agent not on a
 * team lands in the "unbound" bucket.
 *
 * Pure (no React) so it can be unit-tested directly; `useProjectSummaries`
 * just memoizes it.
 */
export function buildProjectSummaries(agents: AgentFact[], teams: TeamFact[]): ProjectSummary[] {
  const map = new Map<string, ProjectSummary>();
  const claimed = new Set<string>();
  const agentById = new Map(agents.map((agent) => [agent.id, agent]));

  const claim = (id: string): AgentFact | undefined => {
    const agent = agentById.get(id);
    if (!agent || claimed.has(agent.id)) return undefined;
    claimed.add(agent.id);
    return agent;
  };

  for (const team of teams) {
    const path = team.project || UNBOUND;
    const teamAgents: AgentFact[] = [];
    for (const mate of team.teammates) {
      const agent = claim(mate.agentId);
      if (agent) teamAgents.push(agent);
    }
    const leader = claim(team.leaderId);
    if (leader) teamAgents.push(leader);

    const existing = map.get(path);
    if (existing) {
      existing.teams.push(team);
      existing.agents.push(...teamAgents);
      existing.paths ??= team.projectPaths;
    } else {
      map.set(path, {
        key: path,
        name: path === UNBOUND ? '未绑定项目' : lastPathPart(path),
        path: path === UNBOUND ? 'agent workspace only' : path,
        paths: team.projectPaths,
        agents: teamAgents,
        teams: [team],
      });
    }
  }

  const orphans = agents.filter((agent) => !claimed.has(agent.id));
  if (orphans.length) {
    const existing = map.get(UNBOUND);
    if (existing) {
      existing.agents.push(...orphans);
    } else {
      map.set(UNBOUND, {
        key: UNBOUND,
        name: '未绑定项目',
        path: 'agent workspace only',
        agents: orphans,
        teams: [],
      });
    }
  }

  return [...map.values()].sort((a, b) => {
    if (a.key === UNBOUND) return 1;
    if (b.key === UNBOUND) return -1;
    return a.name.localeCompare(b.name);
  });
}

export function useProjectSummaries(agents: AgentFact[], teams: TeamFact[]): ProjectSummary[] {
  return useMemo(() => buildProjectSummaries(agents, teams), [agents, teams]);
}
