/**
 * Fact derivers — pure functions that turn SDK + config state into Facts.
 *
 * All derivation logic lives here. AgentManager and server routes stay
 * dumb: they mutate state, then call emit*() which calls the matching
 * deriver to build a fresh snapshot.
 *
 * Every deriver returns `null` when the entity doesn't exist — that
 * signal is used by the WS layer to tell the UI "this id was deleted".
 */

import type { Team } from '@berry-agent/team';
import type { AgentManager } from '../engine/agent-manager.js';
import type { AgentFact, TeamFact, SessionFact, SystemFact, MCPServerFact } from './types.js';
import { SYSTEM_FACT_ID } from './types.js';
import { listInstalledSkillsSync } from '../engine/skill-market.js';

/**
 * Build an AgentFact by combining:
 *   - persisted config (entry)
 *   - live Agent instance runtime state (if instantiated)
 *   - AgentManager active-agent bookkeeping
 */
export function deriveAgentFact(
  manager: AgentManager,
  agentId: string,
): AgentFact | null {
  const entry = manager.config.getAgent(agentId);
  if (!entry) return null;

  const instance = manager.getInstance(agentId);
  const status = manager.getAgentStatus(agentId);
  const provider = instance?.agent.currentProvider;

  // Per-agent MCP snapshot. We read the full MCPManager status and pluck
  // the slot for this agent — keeping the deriver the only place that
  // reshapes MCPManager.getStatus() into fact form. Undefined (not empty
  // array) when the agent has no registered per-agent servers yet.
  const mcpStatus = manager.mcpManager.getStatus();
  const perAgent = mcpStatus.perAgent[agentId];
  const mcp: MCPServerFact[] | undefined = perAgent && perAgent.length > 0
    ? perAgent.map((s) => ({ name: s.name, connected: s.connected, toolCount: s.toolCount }))
    : undefined;

  return {
    id: agentId,
    name: entry.name,
    model: entry.model,
    provider: provider?.type ?? 'unknown',
    workspace: entry.workspace ?? '',
    project: entry.project,
    systemPrompt: entry.systemPrompt,
    status: (status?.status as AgentFact['status']) ?? 'idle',
    statusDetail: status?.detail,
    isActive: manager.activeAgent === agentId,
    instantiated: !!instance,
    tools: entry.tools,
    disabledTools: entry.disabledTools,
    skillDirs: entry.skillDirs,
    disabledSkills: entry.disabledSkills,
    enabledSkills: entry.enabledSkills,
    reasoningEffort: entry.reasoningEffort,
    mcp,
  };
}

/**
 * Build the singleton {@link SystemFact}. Today this covers shared MCP
 * servers; more global infra state can accrete here without forcing a
 * new channel.
 */
export function deriveSystemFact(manager: AgentManager): SystemFact {
  const status = manager.mcpManager.getStatus();
  const installedSkills = listInstalledSkillsSync(manager.config.globalSkillsDir());
  return {
    id: SYSTEM_FACT_ID,
    mcpShared: status.shared.map((s) => ({
      name: s.name,
      connected: s.connected,
      toolCount: s.toolCount,
    })),
    installedSkills,
  };
}

/**
 * Build a TeamFact from a live Team instance. We accept the message count
 * as an optional override so callers can pass a cached count (reading the
 * full messages.jsonl every emission would be wasteful).
 */
export async function deriveTeamFact(
  team: Team,
  opts: { messageCount?: number } = {},
): Promise<TeamFact> {
  const state = team.state;
  const worklist = await team.worklist.list();
  const messageCount = opts.messageCount ?? (await team.readMessages()).length;

  return {
    id: state.leaderId,
    name: state.name,
    project: state.project,
    leaderId: state.leaderId,
    teammates: state.teammates.map((t) => ({
      agentId: t.id,
      role: t.role,
    })),
    worklist,
    messageCount,
  };
}

/**
 * Build a SessionFact from an Agent + session metadata. Very lightweight:
 * everything needed is already on the session object.
 */
export function deriveSessionFact(
  sessionId: string,
  agentId: string,
  session: {
    messages: unknown[];
    metadata?: {
      turnCount?: number;
      tokensUsed?: number;
      compactionCount?: number;
      lastActivityAt?: number;
    };
    crashRecovered?: boolean;
  },
): SessionFact {
  return {
    id: sessionId,
    agentId,
    messageCount: session.messages.length,
    turnCount: session.metadata?.turnCount ?? 0,
    tokensUsed: session.metadata?.tokensUsed ?? 0,
    compactionCount: session.metadata?.compactionCount ?? 0,
    lastActivityAt: session.metadata?.lastActivityAt,
    crashRecovered: session.crashRecovered,
  };
}
