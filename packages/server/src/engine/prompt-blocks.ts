import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { AgentEntry } from './config-manager.js';
import { AgentHome } from '@berry-agent/core';

export type PromptBlockSource =
  | 'project_context'
  | 'env'
  | 'workspace_agent_md'
  | 'skills_index';

export interface PromptBlockInfo {
  id: string;
  source: PromptBlockSource;
  title: string;
  description: string;
  order: number;
  active: boolean;
  scope: 'base' | 'query-time';
  cache: 'stable' | 'dynamic';
  editable: boolean;
  path?: string;
  text: string;
}

export function buildEnvContext(workspace: string, projectRoot?: string): string {
  const lines = [
    `<env>`,
    `  # workspace is the agent's private directory (memory, sessions, personal notes)`,
    `  workspace: ${workspace}`,
  ];
  if (projectRoot) {
    lines.push(`  # project is the codebase root this agent operates on`);
    lines.push(`  project: ${projectRoot}`);
    lines.push(`  cwd: ${projectRoot}`);
  } else {
    lines.push(`  cwd: ${workspace}`);
  }
  lines.push(`</env>`);
  return lines.join('\n');
}

export function buildBaseSystemPrompt(entry: AgentEntry, workspace: string): string[] {
  return [buildEnvContext(workspace, entry.project)];
}

export async function listPromptBlocks(params: {
  agentId: string;
  entry: AgentEntry;
  workspace: string;
  runtimeSkills?: Array<{ name: string; description: string; dir: string }>;
}): Promise<PromptBlockInfo[]> {
  const { entry, workspace, runtimeSkills = [] } = params;
  const blocks: PromptBlockInfo[] = [];
  let order = 0;

  const projectContext = await loadProjectContext(entry.project);
  blocks.push({
    id: 'project_context',
    source: 'project_context',
    title: 'Project context',
    description: projectContext
      ? 'Prepended at query time from the project AGENTS.md file.'
      : 'No AGENTS.md found in project root. Create one to inject project-level context.',
    order: order++,
    active: !!projectContext,
    scope: 'query-time',
    cache: 'stable',
    editable: !!entry.project,
    path: projectContext?.path ?? (entry.project ? `${entry.project}/AGENTS.md` : undefined),
    text: projectContext?.text ?? '',
  });

  blocks.push({
    id: 'env',
    source: 'env',
    title: 'Environment context',
    description: 'Tells the model its workspace / project / cwd bindings.',
    order: order++,
    active: true,
    scope: 'base',
    cache: 'stable',
    editable: false,
    text: buildEnvContext(workspace, entry.project),
  });

  const workspaceAgentPath = new AgentHome(workspace).agentMdPath;
  const workspaceAgentText = await readTextOrEmpty(workspaceAgentPath);
  blocks.push({
    id: 'workspace_agent_md',
    source: 'workspace_agent_md',
    title: 'Workspace AGENTS.md',
    description: workspaceAgentText.trim()
      ? 'Appended at query time from the agent workspace AGENTS.md file.'
      : 'Optional workspace AGENTS.md appended at query time. Save content here to create/activate it.',
    order: order++,
    active: workspaceAgentText.trim().length > 0,
    scope: 'query-time',
    cache: 'stable',
    editable: true,
    path: workspaceAgentPath,
    text: workspaceAgentText,
  });

  blocks.push(buildSkillsIndexBlock(entry, runtimeSkills, order));

  return blocks;
}

function buildSkillsIndexBlock(
  entry: AgentEntry,
  runtimeSkills: Array<{ name: string; description: string; dir: string }>,
  order: number,
): PromptBlockInfo {
  const hasConfiguredSkillDirs = Array.isArray(entry.skillDirs) && entry.skillDirs.length > 0;
  const hasSkills = hasConfiguredSkillDirs || runtimeSkills.length > 0;

  const text = runtimeSkills.length > 0
    ? [
        'Available skills (lazy-load full content on demand):',
        ...runtimeSkills.map((skill) => `- ${skill.name}: ${skill.description}`),
      ].join('\n')
    : hasConfiguredSkillDirs
      ? [
          'Configured skill directories (index generated lazily at query time):',
          ...(entry.skillDirs ?? []).map((dir) => `- ${dir}`),
        ].join('\n')
      : '';

  return {
    id: 'skills_index',
    source: 'skills_index',
    title: 'Skills index',
    description: hasSkills
      ? 'Injected at query time so the model knows what skills are available before loading a full SKILL.md.'
      : 'No skills configured. Add skillDirs to the agent config to enable skill loading.',
    order,
    active: hasSkills,
    scope: 'query-time',
    cache: 'stable',
    editable: false,
    text,
  };
}

async function loadProjectContext(projectRoot?: string): Promise<{ path: string; text: string } | null> {
  if (!projectRoot) return null;
  const path = join(projectRoot, 'AGENTS.md');
  const text = await readTextOrEmpty(path);
  if (text.trim()) return { path, text };
  return null;
}

async function readTextOrEmpty(path: string): Promise<string> {
  try {
    return await readFile(path, 'utf-8');
  } catch {
    return '';
  }
}
