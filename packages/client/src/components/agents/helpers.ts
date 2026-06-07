import { createAvatarFromText } from '@berry-agent/avatar';
import type { AgentFact, SafetyLevel } from '@berry-agent/claw-contracts';

export const GROUP_LABELS: Record<string, string> = {
  file: 'File',
  shell: 'Shell',
  search: 'Search',
  web: 'Web',
  memory: 'Memory',
  team: 'Team',
  agent: 'Agent',
  system: 'System',
  other: 'Other',
};

export const SAFETY_META: Record<
  SafetyLevel,
  { label: string; summary: string; tone: 'neutral' | 'good' | 'warn' | 'bad' | 'info' }
> = {
  trust: { label: 'Trust', summary: '只拦截灾难级命令，不限制写入范围。', tone: 'warn' },
  default: { label: 'Default', summary: '限制写入范围，并拦截高危命令。', tone: 'good' },
  auto: { label: 'Auto', summary: 'Default + LLM classifier 自动审批；无 classifier 时回退人工审批。', tone: 'info' },
};

export function statusTone(status?: string): 'neutral' | 'good' | 'warn' | 'bad' | 'info' {
  if (status === 'idle' || status === 'connected') return 'good';
  if (status === 'error' || status === 'failed') return 'bad';
  if (status === 'thinking' || status === 'tool_executing' || status === 'delegating') return 'info';
  if (status) return 'warn';
  return 'neutral';
}

export function agentAvatar(agent: AgentFact, size: number) {
  return createAvatarFromText(
    [
      agent.id,
      agent.name,
      agent.model,
      agent.provider,
      agent.hands?.map((hand) => hand.kind).join(' ') ?? '',
      agent.skills?.map((skill) => skill.name).join(' ') ?? '',
    ].join(' '),
    { namespace: 'agent', size },
  );
}

export function modelShortName(model?: string): string {
  if (!model) return '-';
  return model.split('/').pop()?.split(':').pop() ?? model;
}

export function lastPathPart(path?: string): string {
  if (!path) return '-';
  const clean = path.replace(/\/+$/, '');
  return clean.split('/').pop() || clean;
}
