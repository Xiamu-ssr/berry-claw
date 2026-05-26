import type { ManagedAgentRuntime } from '@berry-agent/core';
import type { TierId } from '@berry-agent/models';
import { createEnvironmentSystemPrompt } from '@berry-agent/runtime';
import type { AgentEntry, ConfigManager } from './config-manager.js';

export interface ReloadableAgentInstance {
  runtime: ManagedAgentRuntime;
  entry: AgentEntry;
}

export interface AgentReloadHostOptions {
  config: ConfigManager;
  getInstance: (agentId: string) => ReloadableAgentInstance | undefined;
  dropAgent: (agentId: string) => Promise<void>;
  getRuntime: (agentId: string) => ManagedAgentRuntime;
  emitAgentFact: (agentId: string) => void;
}

export class AgentReloadHost {
  constructor(private readonly options: AgentReloadHostOptions) {}

  async rebuildLiveAgents(predicate?: (id: string, entry: AgentEntry) => boolean): Promise<void> {
    for (const { id, entry } of this.options.config.listAgents()) {
      if (predicate && !predicate(id, entry)) continue;
      if (!this.options.getInstance(id)) continue;
      await this.options.dropAgent(id);
      this.options.getRuntime(id);
      this.options.emitAgentFact(id);
    }
  }

  rebuildLiveAgentsForModel(modelId: string): Promise<void> {
    return this.rebuildLiveAgents((_id, entry) => this.agentModelSpecTargetsModel(entry.model, modelId));
  }

  rebuildLiveAgentsForTier(tier: TierId): Promise<void> {
    return this.rebuildLiveAgents((_id, entry) => entry.model === `tier:${tier}`);
  }

  async reloadAgent(agentId: string): Promise<void> {
    const cached = this.options.getInstance(agentId);
    const entry = this.options.config.getAgent(agentId);
    if (!entry) {
      await this.options.dropAgent(agentId);
      this.options.emitAgentFact(agentId);
      return;
    }
    if (!cached) {
      this.options.emitAgentFact(agentId);
      return;
    }

    if (
      (entry.project ?? null) !== (cached.entry.project ?? null) ||
      (entry.promptPack ?? null) !== (cached.entry.promptPack ?? null)
    ) {
      await this.options.dropAgent(agentId);
      this.options.emitAgentFact(agentId);
      return;
    }

    const workspace = cached.entry.workspace ?? this.options.config.agentWorkspace(agentId);
    cached.runtime.setSystemPrompt(createEnvironmentSystemPrompt(workspace, entry.project));

    if (entry.model && entry.model !== cached.entry.model) {
      await this.options.dropAgent(agentId);
      this.options.emitAgentFact(agentId);
      return;
    }

    if ((entry.safetyLevel ?? null) !== (cached.entry.safetyLevel ?? null)) {
      await this.options.dropAgent(agentId);
      this.options.emitAgentFact(agentId);
      return;
    }

    if (entry.reasoningEffort !== cached.entry.reasoningEffort) {
      cached.runtime.setReasoningEffort(entry.reasoningEffort as 'none' | 'low' | 'medium' | 'high' | 'max' | 'xhigh');
    }

    cached.runtime.setToolDenylist(entry.disabledTools ?? []);
    cached.entry = entry;
    this.options.emitAgentFact(agentId);
  }

  async switchModel(agentId: string, model: string): Promise<void> {
    const entry = this.options.config.getAgent(agentId);
    if (entry) {
      entry.model = model;
      this.options.config.setAgent(agentId, entry);
      await this.options.dropAgent(agentId);
      this.options.getRuntime(agentId);
    }
    this.options.emitAgentFact(agentId);
  }

  private agentModelSpecTargetsModel(modelSpec: string, modelId: string): boolean {
    if (modelSpec === modelId || modelSpec === `model:${modelId}`) return true;
    if (modelSpec.startsWith('tier:')) {
      const tier = modelSpec.slice('tier:'.length) as TierId;
      return this.options.config.getTiers()[tier] === modelId;
    }
    return false;
  }
}
