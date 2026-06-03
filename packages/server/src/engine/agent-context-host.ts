import type { ManagedAgentRuntime } from '@berry-agent/core';
import type { PromptBlockInfo } from '@berry-agent/claw-contracts';
import type { ConfigManager } from './config-manager.js';
import { listPromptBlocks } from './prompt-blocks.js';

export interface AgentContextHostOptions {
  config: ConfigManager;
  getRuntime: (agentId: string) => ManagedAgentRuntime;
}

export class AgentContextHost {
  constructor(private readonly options: AgentContextHostOptions) {}

  async readMemory(agentId: string): Promise<{ path: string; content: string }> {
    this.requireAgent(agentId);
    return this.options.getRuntime(agentId).readMemory();
  }

  async writeMemory(agentId: string, content: string): Promise<{ path: string; bytes: number }> {
    this.requireAgent(agentId);
    return this.options.getRuntime(agentId).writeMemory(content);
  }

  async readProjectKnowledge(agentId: string): Promise<{ project: string | null; files: Array<{ path: string; content: string }> }> {
    this.requireAgent(agentId);
    return this.options.getRuntime(agentId).readProjectKnowledge();
  }

  async describePromptBlocks(agentId: string): Promise<PromptBlockInfo[]> {
    const entry = this.requireAgent(agentId);
    const runtime = this.options.getRuntime(agentId);
    const snapshot = runtime.snapshot();
    const workspace = entry.workspace ?? this.options.config.agentWorkspace(agentId);
    return listPromptBlocks({
      agentId,
      entry,
      workspace,
      workspaceInstructions: await runtime.readInstructions(),
      projectKnowledge: await runtime.readProjectKnowledge(),
      runtimeSkills: snapshot.skills ?? [],
    });
  }

  async writePromptBlock(agentId: string, blockId: string, content: string): Promise<PromptBlockInfo[]> {
    const entry = this.requireAgent(agentId);
    const runtime = this.options.getRuntime(agentId);

    switch (blockId) {
      case 'workspace_agent_md':
        await runtime.writeInstructions(content);
        break;
      case 'project_context':
        if (!entry.project) {
          throw new Error('Agent has no project, cannot edit project knowledge');
        }
        await runtime.writeProjectKnowledge(content);
        break;
      default:
        throw new Error(`Prompt block "${blockId}" is read-only or unknown`);
    }

    return this.describePromptBlocks(agentId);
  }

  private requireAgent(agentId: string) {
    const entry = this.options.config.getAgent(agentId);
    if (!entry) throw new Error(`Agent "${agentId}" not found`);
    return entry;
  }
}
