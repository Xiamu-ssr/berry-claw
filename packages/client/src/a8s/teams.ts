/**
 * Emergent-team data layer over a8s.
 *
 * There is no top-level team entity. A "team" is just the set of agents that
 * share a `labels.project`, with one labelled `role:leader`. So everything here
 * is derived from the agent roster (carrying labels straight from a8s
 * listAgents) plus the two project-scoped resources a8s owns — the worklist and
 * the message log. Creating a team is creating its leader agent; adding a member
 * is creating a teammate agent with the team labels; the leader's own
 * collaboration tools (worker-injected) drive the live worklist/messages once it
 * is chatting. The console just reads that shared state and seeds the roster.
 */
import type { AgentFact, WorklistTask, TeamMessage } from '@berry-agent/claw-contracts';
import { a8sClient } from './client';

export interface EmergentTeam {
  /** The leader agent id — also the team's stable key. */
  leaderId: string;
  /** Display name (leader's label name, falling back to its id). */
  name: string;
  /** Shared project root that scopes the worklist + messages. */
  project: string;
  /** The leader fact (always present — a team without a leader isn't a team). */
  leader: AgentFact;
  /** Non-leader members sharing the project. */
  teammates: AgentFact[];
}

const isTeamAgent = (a: AgentFact): boolean => a.labels?.team === 'true';
const isLeader = (a: AgentFact): boolean =>
  a.labels?.role === 'leader' || (!!a.labels?.leader && a.labels.leader === a.id);

/**
 * Group the agent roster into emergent teams. A team forms around a project
 * that has a leader; members are the other team agents on that project. Agents
 * with `team:true` but no project, or a project with no leader, are skipped —
 * they can't form a coherent team view.
 */
export function deriveTeams(agents: AgentFact[]): EmergentTeam[] {
  const byProject = new Map<string, AgentFact[]>();
  for (const a of agents) {
    const project = a.labels?.project;
    if (!isTeamAgent(a) || !project) continue;
    const bucket = byProject.get(project);
    if (bucket) bucket.push(a);
    else byProject.set(project, [a]);
  }
  const teams: EmergentTeam[] = [];
  for (const [project, members] of byProject) {
    const leader = members.find(isLeader);
    if (!leader) continue;
    teams.push({
      leaderId: leader.id,
      name: leader.labels?.name ?? leader.name ?? leader.id,
      project,
      leader,
      teammates: members.filter((m) => m.id !== leader.id),
    });
  }
  return teams.sort((a, b) => a.name.localeCompare(b.name));
}

export interface CreateTeamInput {
  /** Leader agent id (derived from the team name in the UI). */
  leaderId: string;
  /** Team / leader display name. */
  name: string;
  /** Shared project root. */
  project: string;
  /** Leader's model (tier or concrete id). */
  model: string;
}

/**
 * Create a team by creating its leader agent — labelled so the worker injects
 * the leader collaboration toolset (spawn_teammate / worklist_add / …). The
 * leader's `labels.leader` points at itself, which the worker treats as "this
 * agent is the leader".
 */
export async function createTeam(input: CreateTeamInput): Promise<void> {
  const client = await a8sClient();
  await client.createAgent({
    spec: {
      agentId: input.leaderId,
      workspace: input.leaderId,
      projectRoot: input.project,
      model: input.model,
      labels: {
        owner: 'berry-claw',
        name: input.name,
        team: 'true',
        role: 'leader',
        leader: input.leaderId,
        project: input.project,
      },
    },
    entry: { role: 'leader' },
  });
}

export interface SpawnTeammateInput {
  teammateId: string;
  /** Short role, e.g. "reviewer". Also the teammate's display name seed. */
  role: string;
  leaderId: string;
  project: string;
  model: string;
}

/**
 * Spawn a teammate into an existing team — labelled so the worker injects the
 * teammate toolset (message_leader / claim_task / …). The console can seed a
 * teammate directly; the leader can also spawn more in-chat via its tool.
 */
export async function spawnTeammate(input: SpawnTeammateInput): Promise<void> {
  const client = await a8sClient();
  await client.createAgent({
    spec: {
      agentId: input.teammateId,
      workspace: input.teammateId,
      projectRoot: input.project,
      model: input.model,
      labels: {
        owner: 'berry-claw',
        name: input.role,
        team: 'true',
        role: input.role,
        leader: input.leaderId,
        project: input.project,
      },
    },
    entry: { role: input.role, leaderId: input.leaderId },
  });
}

/** Remove a teammate (delete its cluster agent). */
export async function disbandTeammate(teammateId: string): Promise<void> {
  const client = await a8sClient();
  await client.deleteAgent(teammateId);
}

/** Read a team's shared worklist (project-scoped). */
export async function loadWorklist(project: string): Promise<WorklistTask[]> {
  const client = await a8sClient();
  const { tasks } = await client.listWorklist(project);
  return tasks as WorklistTask[];
}

/** Read a team's shared message log (project-scoped). */
export async function loadTeamMessages(project: string): Promise<TeamMessage[]> {
  const client = await a8sClient();
  const { messages } = await client.listTeamMessages(project);
  return messages as TeamMessage[];
}
