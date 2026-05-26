import type { PromptBlockInfo, ReasoningEffort } from '@berry-agent/claw-contracts';

export interface ToolDef {
  name: string;
  description?: string;
  group?: string;
}

export interface InspectRuntime {
  tools?: ToolDef[];
  promptBlocks?: PromptBlockInfo[];
  systemPrompt?: string[];
}

export type DetailTab = 'context' | 'prompt' | 'memory' | 'skills' | 'mcp' | 'tools' | 'safety';

export interface AgentForm {
  id: string;
  name: string;
  model: string;
  project: string;
  reasoningEffort: '' | ReasoningEffort;
  promptPack: string;
}

export const emptyAgentForm = (): AgentForm => ({
  id: '',
  name: '',
  model: '',
  project: '',
  reasoningEffort: '',
  promptPack: 'berry-default-zh',
});
