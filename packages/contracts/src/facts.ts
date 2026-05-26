import { z } from 'zod';
import { zSafetyLevel } from './safety.js';
import { zAgentHomeSnapshot, zProjectSharedPaths } from '@berry-agent/core/schema';
import { zWorklistTask } from '@berry-agent/team';
import type {
  AgentHomeSnapshot,
  ProjectSharedPaths,
} from '@berry-agent/core';
import type { WorklistTask } from '@berry-agent/team';

export type AgentHomeFact = AgentHomeSnapshot;
export type ProjectSharedPathsFact = ProjectSharedPaths;

export const zReasoningEffort = z.enum(['none', 'low', 'medium', 'high', 'max', 'xhigh']);
export type ReasoningEffort = z.infer<typeof zReasoningEffort>;

export const zAgentStatus = z.enum([
  'idle',
  'thinking',
  'tool_executing',
  'compacting',
  'memory_flushing',
  'delegating',
  'sleeping',
  'tool_use',
  'paused',
  'error',
]);
export type AgentStatus = z.infer<typeof zAgentStatus>;

export const zMCPServerStatus = z.enum(['connecting', 'connected', 'failed', 'disabled']);
export type MCPServerStatus = z.infer<typeof zMCPServerStatus>;

export const zMCPServerFact = z.object({
  name: z.string(),
  connected: z.boolean(),
  toolCount: z.number(),
  status: zMCPServerStatus,
  lastError: z.string().optional(),
  lastStartedAt: z.string().optional(),
});
export type MCPServerFact = z.infer<typeof zMCPServerFact>;

export const zInstalledSkill = z.object({
  name: z.string(),
  description: z.string().optional(),
  source: z.enum(['clawhub', 'manual']).optional(),
  slug: z.string().optional(),
  installedAt: z.string().optional(),
});
export type InstalledSkill = z.infer<typeof zInstalledSkill>;

export const zSkillMarketItem = z.object({
  slug: z.string(),
  name: z.string(),
  description: z.string().optional(),
  tags: z.array(z.string()).optional(),
  source: z.enum(['clawhub']),
  installs: z.number().optional(),
  downloads: z.number().optional(),
  stars: z.number().optional(),
  version: z.string().optional(),
  updatedAt: z.number().optional(),
  installed: z.boolean().optional(),
});
export type SkillMarketItem = z.infer<typeof zSkillMarketItem>;

export const zAgentHomeFact = zAgentHomeSnapshot;

export const zProjectSharedPathsFact = zProjectSharedPaths;

export const zAgentFact = z.object({
  id: z.string(),
  name: z.string(),
  model: z.string(),
  provider: z.string(),
  workspace: z.string(),
  home: zAgentHomeFact,
  project: z.string().optional(),
  projectPaths: zProjectSharedPathsFact.optional(),
  status: zAgentStatus,
  statusDetail: z.string().optional(),
  isActive: z.boolean(),
  instantiated: z.boolean(),
  tools: z.array(z.string()).optional(),
  disabledTools: z.array(z.string()).optional(),
  skillDirs: z.array(z.string()).optional(),
  disabledSkills: z.array(z.string()).optional(),
  enabledSkills: z.array(z.string()).optional(),
  reasoningEffort: zReasoningEffort.optional(),
  promptPack: z.string().optional(),
  safetyLevel: zSafetyLevel.optional(),
  effectiveSafetyLevel: zSafetyLevel,
  mcp: z.array(zMCPServerFact).optional(),
});
export type AgentFact = z.infer<typeof zAgentFact>;

export const zTeamFact = z.object({
  id: z.string(),
  name: z.string(),
  project: z.string(),
  projectPaths: zProjectSharedPathsFact,
  leaderId: z.string(),
  teammates: z.array(z.object({ agentId: z.string(), role: z.string() })),
  worklist: z.array(zWorklistTask),
  messageCount: z.number(),
});
export interface TeamFact {
  id: string;
  name: string;
  project: string;
  projectPaths: ProjectSharedPathsFact;
  leaderId: string;
  teammates: Array<{ agentId: string; role: string }>;
  worklist: WorklistTask[];
  messageCount: number;
}

export const SYSTEM_FACT_ID = '__system__' as const;

export const zSystemFact = z.object({
  id: z.literal(SYSTEM_FACT_ID),
  mcpShared: z.array(zMCPServerFact),
  installedSkills: z.array(zInstalledSkill).optional(),
});
export type SystemFact = z.infer<typeof zSystemFact>;

export const zSessionStatus = z.enum(['idle', 'running', 'interrupted']);
export type SessionStatus = z.infer<typeof zSessionStatus>;

export const zSessionFact = z.object({
  id: z.string(),
  agentId: z.string(),
  title: z.string().optional(),
  status: zSessionStatus,
  messageCount: z.number(),
  turnCount: z.number(),
  tokensUsed: z.number(),
  compactionCount: z.number(),
  lastActivityAt: z.number().optional(),
  crashRecovered: z.boolean().optional(),
});
export type SessionFact = z.infer<typeof zSessionFact>;

export const FACT_KINDS = ['agent', 'team', 'session', 'system'] as const;
export const zFactKind = z.enum(FACT_KINDS);
export type FactKind = z.infer<typeof zFactKind>;

export const zFactChange = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('agent'), id: z.string(), fact: zAgentFact.nullable() }),
  z.object({ kind: z.literal('team'), id: z.string(), fact: zTeamFact.nullable() }),
  z.object({ kind: z.literal('session'), id: z.string(), fact: zSessionFact.nullable() }),
  z.object({ kind: z.literal('system'), id: z.string(), fact: zSystemFact.nullable() }),
]);
export type FactChange =
  | { kind: 'agent'; id: string; fact: AgentFact | null }
  | { kind: 'team'; id: string; fact: TeamFact | null }
  | { kind: 'session'; id: string; fact: SessionFact | null }
  | { kind: 'system'; id: string; fact: SystemFact | null };
