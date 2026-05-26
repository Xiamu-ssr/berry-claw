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
import { projectSharedPaths } from '@berry-agent/core';
import type { AgentChatMessage, AgentSessionView } from '@berry-agent/core';
import type { AgentManager } from '../engine/agent-manager.js';
import type { AgentFact, TeamFact, SessionFact, SystemFact, MCPServerFact } from '@berry-agent/claw-contracts';
import { SYSTEM_FACT_ID } from '@berry-agent/claw-contracts';
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
  const provider = instance?.runtime.currentProvider;
  const workspace = entry.workspace ?? manager.config.agentWorkspace(agentId);
  const home = manager.config.agentHomeFor(workspace).toSnapshot();
  const projectPaths = entry.project ? projectSharedPaths(entry.project) : undefined;

  // Per-agent MCP snapshot. We read the full MCPManager status and pluck
  // the slot for this agent — keeping the deriver the only place that
  // reshapes MCPManager.getStatus() into fact form. Undefined (not empty
  // array) when the agent has no registered per-agent servers yet.
  const mcpStatus = manager.mcpManager.getStatus();
  const perAgent = mcpStatus.perAgent[agentId];
  const mcp: MCPServerFact[] | undefined = perAgent && perAgent.length > 0
    ? perAgent.map((s) => ({
        name: s.name,
        connected: s.connected,
        toolCount: s.toolCount,
        status: s.status,
        lastError: s.lastError,
        lastStartedAt: s.lastStartedAt,
      }))
    : undefined;

  return {
    id: agentId,
    name: entry.name,
    model: entry.model,
    provider: provider?.type ?? 'unknown',
    workspace,
    home,
    project: entry.project,
    projectPaths,
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
    promptPack: entry.promptPack,
    safetyLevel: entry.safetyLevel,
    effectiveSafetyLevel: manager.resolveSafetyFor(agentId),
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
      status: s.status,
      lastError: s.lastError,
      lastStartedAt: s.lastStartedAt,
    })),
    installedSkills,
  };
}

/**
 * Build a TeamFact from a live Team instance. We accept the message count
 * as an optional override so callers can pass a cached count instead of
 * reading the SDK team message store on every emission.
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
    projectPaths: projectSharedPaths(state.project),
    leaderId: state.leaderId,
    teammates: state.teammates.map((t) => ({
      agentId: t.id,
      role: t.role,
    })),
    worklist,
    messageCount,
  };
}

/** Build a SessionFact from the SDK-owned session view. */
export function deriveSessionFact(view: AgentSessionView): SessionFact {
  const usage = sumMessageTokens(view.messages);
  const compactionCount = view.messages.reduce((count, message) => {
    const markers = message.timeline?.filter((item) =>
      item.type === 'event' && item.event.kind === 'compaction',
    ).length ?? 0;
    return count + markers;
  }, 0);

  return {
    id: view.id,
    agentId: view.agentId ?? '',
    title: view.title,
    status: view.status,
    messageCount: view.messages.length,
    turnCount: view.messages.filter((message) => message.role === 'user').length,
    tokensUsed: usage.inputTokens + usage.outputTokens,
    compactionCount,
    lastActivityAt: view.lastActiveAt,
    crashRecovered: view.status === 'interrupted' ? true : undefined,
  };
}

function sumMessageTokens(messages: AgentChatMessage[]): { inputTokens: number; outputTokens: number } {
  let inputTokens = 0;
  let outputTokens = 0;
  for (const message of messages) {
    if (message.usage) {
      inputTokens += message.usage.inputTokens;
      outputTokens += message.usage.outputTokens;
    }
    for (const inference of message.inferences ?? []) {
      inputTokens += inference.inputTokens;
      outputTokens += inference.outputTokens;
    }
  }
  return { inputTokens, outputTokens };
}
