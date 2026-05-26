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

export function useProjectSummaries(agents: AgentFact[], teams: TeamFact[]): ProjectSummary[] {
  return useMemo(() => {
    const map = new Map<string, ProjectSummary>();

    for (const agent of agents) {
      const path = agent.project || '__unbound__';
      const existing = map.get(path);
      if (existing) {
        existing.agents.push(agent);
        existing.paths ??= agent.projectPaths;
      } else {
        map.set(path, {
          key: path,
          name: path === '__unbound__' ? '未绑定项目' : lastPathPart(path),
          path: path === '__unbound__' ? 'agent workspace only' : path,
          paths: agent.projectPaths,
          agents: [agent],
          teams: [],
        });
      }
    }

    for (const team of teams) {
      const path = team.project || '__unbound__';
      const existing = map.get(path);
      if (existing) {
        existing.teams.push(team);
        existing.paths ??= team.projectPaths;
      } else {
        map.set(path, {
          key: path,
          name: lastPathPart(path),
          path,
          paths: team.projectPaths,
          agents: [],
          teams: [team],
        });
      }
    }

    return [...map.values()].sort((a, b) => {
      if (a.key === '__unbound__') return 1;
      if (b.key === '__unbound__') return -1;
      return a.name.localeCompare(b.name);
    });
  }, [agents, teams]);
}
