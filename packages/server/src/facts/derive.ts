/**
 * Fact derivers — turn a8s client responses into product Facts.
 *
 * berry-claw is a thin BFF: a8s owns agents/sessions, so facts are derived
 * from what the client reports (listAgents + agentSnapshot + session views),
 * not from any local engine state. Each deriver returns the fact shape the
 * frontend FactStore merges by id.
 */

import type {
  A8sClient,
  AgentSnapshotResponse,
} from '@berry-agent/client';
import type { AgentFact, AgentStatus, SessionFact } from '@berry-agent/claw-contracts';

/** Map an a8s snapshot status string onto the product AgentStatus enum. */
function asAgentStatus(status: string | undefined): AgentStatus {
  const known: AgentStatus[] = [
    'idle', 'thinking', 'tool_executing', 'compacting', 'memory_flushing',
    'delegating', 'sleeping', 'tool_use', 'paused', 'error',
  ];
  return (known as string[]).includes(status ?? '') ? (status as AgentStatus) : 'idle';
}

/**
 * Derive an AgentFact for one agent. `name` comes from a8s's opaque product
 * `entry` (display metadata); the rest comes from the live snapshot when the
 * agent is mounted. When the agent is registered but not yet mounted on a
 * worker, the snapshot call fails — we return a minimal fact (not-instantiated).
 */
export async function deriveAgentFact(
  client: A8sClient,
  agentId: string,
  opts: { name?: string; workerId?: string | null } = {},
): Promise<AgentFact> {
  let snap: AgentSnapshotResponse | undefined;
  try {
    snap = await client.agentSnapshot(agentId);
  } catch {
    snap = undefined; // not mounted / not reachable → minimal fact
  }
  return {
    id: agentId,
    name: opts.name ?? agentId,
    model: snap?.model ?? '',
    provider: snap?.provider ?? 'unknown',
    status: asAgentStatus(snap?.status),
    statusDetail: snap?.statusDetail,
    workerId: opts.workerId ?? null,
    instantiated: !!snap,
    hands: snap?.hands,
    skills: snap?.skills,
  };
}

/** The product-relevant slice of a session view (wire shape from a8s). */
export interface SessionViewLike {
  id: string;
  title?: string;
  agentId?: string;
  status: string;
  lastActiveAt?: number;
  messages: Array<Record<string, unknown>>;
}

const SESSION_STATUSES = ['idle', 'running', 'interrupted'] as const;
type SessionStatus = (typeof SESSION_STATUSES)[number];
function asSessionStatus(s: string): SessionStatus {
  return (SESSION_STATUSES as readonly string[]).includes(s) ? (s as SessionStatus) : 'idle';
}

/**
 * Derive a SessionFact from an a8s session view. `messages` is opaque on the
 * wire but is the SDK's rendered timeline; we read the few fields we summarize
 * (role for turn count, usage for tokens, compaction markers) defensively.
 */
export function deriveSessionFact(view: SessionViewLike): SessionFact {
  let inputTokens = 0;
  let outputTokens = 0;
  let turnCount = 0;
  let compactionCount = 0;
  for (const m of view.messages) {
    if (m.role === 'user') turnCount++;
    const usage = m.usage as { inputTokens?: number; outputTokens?: number } | undefined;
    if (usage) {
      inputTokens += usage.inputTokens ?? 0;
      outputTokens += usage.outputTokens ?? 0;
    }
    const timeline = m.timeline as Array<{ type?: string; event?: { kind?: string } }> | undefined;
    compactionCount += timeline?.filter((t) => t.type === 'event' && t.event?.kind === 'compaction').length ?? 0;
  }
  const status = asSessionStatus(view.status);
  return {
    id: view.id,
    agentId: view.agentId ?? '',
    title: view.title,
    status,
    messageCount: view.messages.length,
    turnCount,
    tokensUsed: inputTokens + outputTokens,
    compactionCount,
    lastActivityAt: view.lastActiveAt,
    crashRecovered: status === 'interrupted' ? true : undefined,
  };
}
