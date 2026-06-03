import type { PromptBlockInfo } from '@berry-agent/claw-contracts';
import type { A8sClient } from '@berry-agent/client';
import type { ConfigManager } from './config-manager.js';
import { listPromptBlocks } from './prompt-blocks.js';

export interface AgentContextHostOptions {
  config: ConfigManager;
  client: A8sClient;
}

/**
 * Context host — thin BFF over a8s. Agent "home" docs (memory / instructions
 * / project-knowledge) live on the worker; this host reads/writes them via
 * the a8s home endpoints.
 */
export class AgentContextHost {
  constructor(private readonly options: AgentContextHostOptions) {}

  async readMemory(agentId: string): Promise<{ path: string; content: string }> {
    this.requireAgent(agentId);
    const r = await this.options.client.readAgentHome(agentId, 'memory');
    return { path: r.path ?? '', content: r.content };
  }

  async writeMemory(agentId: string, content: string): Promise<{ path: string; bytes: number }> {
    this.requireAgent(agentId);
    const r = await this.options.client.writeAgentHome(agentId, 'memory', content);
    return { path: r.path, bytes: r.bytes };
  }

  async readProjectKnowledge(agentId: string): Promise<{ project: string | null; files: Array<{ path: string; content: string }> }> {
    this.requireAgent(agentId);
    const r = await this.options.client.readAgentHome(agentId, 'project-knowledge');
    return { project: r.project ?? null, files: r.files ?? [] };
  }

  async describePromptBlocks(agentId: string): Promise<PromptBlockInfo[]> {
    const entry = this.requireAgent(agentId);
    const workspace = entry.workspace ?? this.options.config.agentWorkspace(agentId);
    const [instructions, projectKnowledge] = await Promise.all([
      this.options.client.readAgentHome(agentId, 'instructions'),
      this.options.client.readAgentHome(agentId, 'project-knowledge'),
    ]);
    return listPromptBlocks({
      agentId,
      entry,
      workspace,
      workspaceInstructions: { path: instructions.path ?? '', content: instructions.content },
      projectKnowledge: { project: projectKnowledge.project ?? null, files: projectKnowledge.files ?? [] },
      // Runtime skills come from the live snapshot, which isn't exposed over
      // a8s yet (D-sessions++ TODO). The block list degrades gracefully to an
      // empty skill section until that endpoint lands.
      runtimeSkills: [],
    });
  }

  async writePromptBlock(agentId: string, blockId: string, content: string): Promise<PromptBlockInfo[]> {
    const entry = this.requireAgent(agentId);
    switch (blockId) {
      case 'workspace_agent_md':
        await this.options.client.writeAgentHome(agentId, 'instructions', content);
        break;
      case 'project_context':
        if (!entry.project) {
          throw new Error('Agent has no project, cannot edit project knowledge');
        }
        await this.options.client.writeAgentHome(agentId, 'project-knowledge', content);
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
