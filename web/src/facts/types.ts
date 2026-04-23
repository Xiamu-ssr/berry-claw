/**
 * Fact shapes — frontend mirror of src/facts/types.ts.
 *
 * Keeping a copy here (instead of importing across the tsconfig boundary)
 * avoids bundling node-only imports into the browser build. The shapes
 * are small and rarely change; drift would be caught by the shared
 * integration tests in server vitest.
 */

import type { AgentStatus } from '../types';

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
}

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
  | { kind: 'session'; id: string; fact: SessionFact | null };

export type FactKind = 'agent' | 'team' | 'session';
