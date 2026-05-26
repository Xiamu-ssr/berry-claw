import type { ManagedAgentRuntime } from '@berry-agent/core';
import type { PromptBlockInfo } from '@berry-agent/claw-contracts';
import type { ConfigManager } from './config-manager.js';
import { listPromptBlocks } from './prompt-blocks.js';

export interface AgentContextHostOptions {
  config: ConfigManager;
  getActiveAgentId: () => string;
  getRuntime: (agentId: string) => ManagedAgentRuntime;
}

export class AgentContextHost {
  constructor(private readonly options: AgentContextHostOptions) {}

  async readMemory(agentId?: string): Promise<{ path: string; content: string }> {
    const targetId = this.requireAgentId(agentId);
    return this.options.getRuntime(targetId).readMemory();
  }

  async writeMemory(agentId: string | undefined, content: string): Promise<{ path: string; bytes: number }> {
    const targetId = this.requireAgentId(agentId);
    return this.options.getRuntime(targetId).writeMemory(content);
  }

  async readProjectKnowledge(agentId?: string): Promise<{ project: string | null; files: Array<{ path: string; content: string }> }> {
    const targetId = this.requireAgentId(agentId);
    return this.options.getRuntime(targetId).readProjectKnowledge();
  }

  async describePromptBlocks(agentId?: string): Promise<PromptBlockInfo[]> {
    const targetId = this.requireAgentId(agentId);
    const entry = this.options.config.getAgent(targetId);
    if (!entry) throw new Error(`Agent "${targetId}" not found`);
    const runtime = this.options.getRuntime(targetId);
    const snapshot = runtime.snapshot();
    const workspace = entry.workspace ?? this.options.config.agentWorkspace(targetId);
    return listPromptBlocks({
      agentId: targetId,
      entry,
      workspace,
      workspaceInstructions: await runtime.readInstructions(),
      projectKnowledge: await runtime.readProjectKnowledge(),
      runtimeSkills: snapshot.skills ?? [],
    });
  }

  async writePromptBlock(agentId: string, blockId: string, content: string): Promise<PromptBlockInfo[]> {
    const entry = this.options.config.getAgent(agentId);
    if (!entry) throw new Error(`Agent "${agentId}" not found`);
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

  private requireAgentId(agentId?: string): string {
    const targetId = agentId ?? this.options.getActiveAgentId();
    if (!targetId || !this.options.config.getAgent(targetId)) {
      throw new Error('agent not found');
    }
    return targetId;
  }
}
