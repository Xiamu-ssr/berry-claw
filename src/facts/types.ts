/**
 * Fact types — authoritative, read-only snapshots of agent/team/session state.
 *
 * Design contract:
 * - Facts are pure data (no methods, no live handles). Safe to JSON-serialize.
 * - Every mutation that would change any field here must flow through a
 *   FactBus emission — otherwise the UI falls out of sync.
 * - Fields are additive-friendly: adding a new field never breaks old UIs.
 *
 * Ownership note:
 * - These facts live in berry-claw (product layer) because they compose
 *   data from multiple SDK packages (config + core.Agent + team). Putting
 *   the compositions in any single SDK package would either duplicate
 *   code or break SDK generality (SDK doesn't know about ConfigManager).
 */

import type { AgentStatus } from '@berry-agent/core';
import type { WorklistTask } from '@berry-agent/team';

/** Every piece of persistent + runtime state a UI needs to render an agent. */
export interface AgentFact {
  /** Stable agent id (matches config.agents[id]). */
  id: string;
  /** Display name. */
  name: string;
  /** Current model spec (`model:x`, `tier:y`, or raw provider model id). */
  model: string;
  /** Provider type string (anthropic/openai/...) as reported by live provider. */
  provider: string;
  /** Resolved workspace directory for this agent. */
  workspace: string;
  /** Optional project root the agent is bound to. */
  project?: string;
  /** Custom system prompt override (raw string as stored in config). */
  systemPrompt?: string;
  /** Fine-grained runtime status. 'idle' also covers "not yet instantiated". */
  status: AgentStatus | 'idle';
  /** Human-readable detail accompanying the status. */
  statusDetail?: string;
  /** Whether this agent is the currently active one in AgentManager. */
  isActive: boolean;
  /** Whether the Agent instance has been constructed (vs config-only). */
  instantiated: boolean;
  /** Tool ids currently enabled for this agent. */
  tools?: string[];
  /** Tool ids explicitly disabled in the agent config. */
  disabledTools?: string[];
  /** Skill directories configured for this agent. */
  skillDirs?: string[];
  /** Skill names explicitly disabled. */
  disabledSkills?: string[];
}

/** A team's runtime + persisted shape, keyed by leader agent id. */
export interface TeamFact {
  /** Team id = leader agent id (1:1 relationship). */
  id: string;
  /** Display name of the team. */
  name: string;
  /** Absolute project root the team operates in. */
  project: string;
  /** Leader agent id (== id). Kept explicit for UI convenience. */
  leaderId: string;
  /** Teammate records with role labels. */
  teammates: Array<{ agentId: string; role: string }>;
  /** Full worklist for the team. Small enough to ship wholesale. */
  worklist: WorklistTask[];
  /** Recent cross-agent messages count (for list view badges). */
  messageCount: number;
}

/** Per-session aggregate metrics (not the messages themselves — those stream separately). */
export interface SessionFact {
  id: string;
  agentId: string;
  messageCount: number;
  turnCount: number;
  tokensUsed: number;
  compactionCount: number;
  /** Wall-clock of the most recent activity. */
  lastActivityAt?: number;
  /** True when this session was just reloaded from an incomplete crash. */
  crashRecovered?: boolean;
}

/** Discriminated union emitted on the fact_changed channel. */
export type FactChange =
  | { kind: 'agent'; id: string; fact: AgentFact | null }
  | { kind: 'team'; id: string; fact: TeamFact | null }
  | { kind: 'session'; id: string; fact: SessionFact | null };

/** Allowed fact kinds, single source for iteration / validation. */
export const FACT_KINDS = ['agent', 'team', 'session'] as const;
export type FactKind = (typeof FACT_KINDS)[number];
