import type { AgentEntry } from './config-manager.js';
import { projectSharedPaths } from '@berry-agent/core';
import { buildEnvironmentContext } from '@berry-agent/runtime';
import type { PromptBlockInfo } from '@berry-agent/claw-contracts';

export async function listPromptBlocks(params: {
  agentId: string;
  entry: AgentEntry;
  workspace: string;
  workspaceInstructions: { path: string; content: string };
  projectKnowledge: { project: string | null; files: Array<{ path: string; content: string }> };
  runtimeSkills?: Array<{ name: string; description: string; dir: string }>;
}): Promise<PromptBlockInfo[]> {
  const { entry, workspace, workspaceInstructions, projectKnowledge, runtimeSkills = [] } = params;
  const blocks: PromptBlockInfo[] = [];
  let order = 0;

  const projectContextText = projectKnowledge.files[0]?.content ?? '';
  blocks.push({
    id: 'project_context',
    source: 'project_context',
    title: 'Project knowledge',
    description: projectContextText.trim()
      ? 'Prepended at query time from SDK project knowledge.'
      : 'No project knowledge yet. Save content here to inject shared project context.',
    order: order++,
    active: projectContextText.trim().length > 0,
    scope: 'query-time',
    cache: 'stable',
    editable: !!entry.project,
    path: entry.project ? projectSharedPaths(entry.project).contextPath : undefined,
    text: projectContextText,
  });

  blocks.push({
    id: 'env',
    source: 'env',
    title: 'Environment context',
    description: 'Tells the model its workspace / project / cwd bindings.',
    order: order++,
    active: true,
    scope: 'base',
    cache: 'dynamic',
    editable: false,
    text: buildEnvironmentContext(workspace, entry.project),
  });

  blocks.push({
    id: 'workspace_agent_md',
    source: 'workspace_agent_md',
    title: 'Workspace instructions',
    description: workspaceInstructions.content.trim()
      ? 'Appended at query time from SDK workspace instructions.'
      : 'Optional workspace instructions appended at query time. Save content here to activate them.',
    order: order++,
    active: workspaceInstructions.content.trim().length > 0,
    scope: 'query-time',
    cache: 'stable',
    editable: true,
    path: workspaceInstructions.path,
    text: workspaceInstructions.content,
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
