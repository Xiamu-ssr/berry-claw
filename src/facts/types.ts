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
  /**
   * Skill names explicitly disabled.
   * @deprecated Prefer `enabledSkills` for market skills; this remains a
   * raw blacklist still passed through to the SDK for backward compat.
   */
  disabledSkills?: string[];
  /**
   * Market-skill whitelist — names of globally-installed skills this agent
   * is allowed to see. Names not in this list are filtered out (even if
   * present under `~/.berry-claw/skills/`). Undefined / empty = no market
   * skills visible for this agent.
   */
  enabledSkills?: string[];
  /** Unified reasoning effort level (provider-mapped). */
  reasoningEffort?: 'none' | 'low' | 'medium' | 'high' | 'max';
  /**
   * Per-agent MCP servers (non-shared). Shared servers live on
   * {@link SystemFact} — this list only holds servers that are owned by
   * this specific agent. Undefined when the agent hasn't been instantiated
   * yet (per-agent servers are only started after {@link startAgentServers}).
   */
  mcp?: Array<MCPServerFact>;
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

/**
 * Singleton system-wide fact — global infrastructure state that isn't
 * attached to any one agent. Today this just carries shared MCP server
 * status; keep the shape open so more cross-cutting info (e.g. provider
 * health, global quotas) can join later without a second channel.
 *
 * Emitted under a fixed id ({@link SYSTEM_FACT_ID}) so the WS/snapshot
 * protocol stays symmetric with agent/team/session.
 */
export interface SystemFact {
  /** Fixed discriminator — always {@link SYSTEM_FACT_ID}. */
  id: string;
  /** Shared (global) MCP servers — one snapshot per server name. */
  mcpShared: Array<MCPServerFact>;
  /**
   * Skills installed into the global skill pool
   * (`~/.berry-claw/skills/*`). One entry per skill. Updated when the
   * user installs/uninstalls via the Skill Market.
   */
  installedSkills?: Array<InstalledSkill>;
}

/** One globally-installed skill (the "source of truth" for the Skill Market). */
export interface InstalledSkill {
  /** Skill name from SKILL.md frontmatter — also the directory name. */
  name: string;
  /** Short description from frontmatter (for UI cards). */
  description?: string;
  /** Which source the skill was installed from. */
  source?: 'clawhub' | 'manual';
  /** Source-specific slug/identifier (clawhub slug). */
  slug?: string;
  /** ISO timestamp of install. */
  installedAt?: string;
}

/** Per-MCP-server runtime snapshot. */
export interface MCPServerFact {
  /** Upstream server name (no tool-prefix). */
  name: string;
  /** True once the client has completed its MCP handshake. */
  connected: boolean;
  /** Tool count discovered from this server. */
  toolCount: number;
}

/** Fixed id of the singleton {@link SystemFact}. */
export const SYSTEM_FACT_ID = '__system__' as const;

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
  | { kind: 'session'; id: string; fact: SessionFact | null }
  | { kind: 'system'; id: string; fact: SystemFact | null };

/** Allowed fact kinds, single source for iteration / validation. */
export const FACT_KINDS = ['agent', 'team', 'session', 'system'] as const;
export type FactKind = (typeof FACT_KINDS)[number];
