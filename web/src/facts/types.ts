/**
 * Fact shapes — frontend mirror of src/facts/types.ts.
 *
 * Keeping a copy here (instead of importing across the tsconfig boundary)
 * avoids bundling node-only imports into the browser build. The shapes
 * are small and rarely change; drift would be caught by the shared
 * integration tests in server vitest.
 */

import type { AgentStatus } from '../types';

export interface MCPServerFact {
  name: string;
  connected: boolean;
  toolCount: number;
}

export interface AgentFact {
  id: string;
  name: string;
  model: string;
  provider: string;
  workspace: string;
  project?: string;
  systemPrompt?: string;
  status: AgentStatus | 'idle';
  statusDetail?: string;
  isActive: boolean;
  instantiated: boolean;
  tools?: string[];
  disabledTools?: string[];
  skillDirs?: string[];
  disabledSkills?: string[];
  /** Whitelisted names of market-installed skills visible to this agent. */
  enabledSkills?: string[];
  reasoningEffort?: 'none' | 'low' | 'medium' | 'high' | 'max';
  /** Per-agent (non-shared) MCP servers. Shared servers live on {@link SystemFact}. */
  mcp?: MCPServerFact[];
}

/** One globally-installed skill under `~/.berry-claw/skills/`. */
export interface InstalledSkill {
  name: string;
  description?: string;
  source?: 'clawhub' | 'manual';
  slug?: string;
  installedAt?: string;
}

/** One market listing available for install (pre-install snapshot). */
export interface SkillMarketItem {
  slug: string;
  name: string;
  description?: string;
  tags?: string[];
  source: 'clawhub';
  /** Currently-active installs reported by ClawHub (popularity proxy). */
  installs?: number;
  /** Lifetime downloads reported by ClawHub. */
  downloads?: number;
  /** Star count reported by ClawHub. */
  stars?: number;
  /** Latest version tag (e.g. `1.0.0`). */
  version?: string;
  /** Last-updated epoch millis. */
  updatedAt?: number;
}

export interface SystemFact {
  id: string;
  mcpShared: MCPServerFact[];
  installedSkills?: InstalledSkill[];
}

export const SYSTEM_FACT_ID = '__system__' as const;

export interface TeamFact {
  id: string;
  name: string;
  project: string;
  leaderId: string;
  teammates: Array<{ agentId: string; role: string }>;
  worklist: Array<{
    id: string;
    title: string;
    description?: string;
    status: 'unclaimed' | 'claimed' | 'in_progress' | 'done' | 'failed';
    assignee?: string;
    createdBy: string;
    createdAt: number;
    updatedAt: number;
    completedAt?: number;
    failureReason?: string;
    tags?: string[];
  }>;
  messageCount: number;
}

export interface SessionFact {
  id: string;
  agentId: string;
  messageCount: number;
  turnCount: number;
  tokensUsed: number;
  compactionCount: number;
  lastActivityAt?: number;
  crashRecovered?: boolean;
}

export type FactChange =
  | { kind: 'agent'; id: string; fact: AgentFact | null }
  | { kind: 'team'; id: string; fact: TeamFact | null }
  | { kind: 'session'; id: string; fact: SessionFact | null }
  | { kind: 'system'; id: string; fact: SystemFact | null };

export type FactKind = 'agent' | 'team' | 'session' | 'system';
