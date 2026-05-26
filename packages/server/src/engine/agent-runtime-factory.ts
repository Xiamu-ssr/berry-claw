import type { CredentialStore, ManagedAgentRuntime } from '@berry-agent/core';
import type { ModelPricing, Observer } from '@berry-agent/observe';
import type { AskBridge } from '@berry-agent/safe';
import { createManagedRuntime } from '@berry-agent/runtime';
import { createSandboxExecutionEnvironmentProvider } from '@berry-agent/tools-common';
import { mkdirSync, existsSync } from 'node:fs';
import type { ConfigManager, AgentEntry } from './config-manager.js';
import { createBerryTools } from './berry-tools.js';

export interface BuiltAgentRuntime {
  runtime: ManagedAgentRuntime;
  workspace: string;
  projectRoot?: string;
}

export interface AgentRuntimeFactoryOptions {
  config: ConfigManager;
  credentials: CredentialStore;
  observer: Observer;
  pricingOverrides: Record<string, ModelPricing>;
  askBridge: () => AskBridge | undefined;
  onStatusChange: (agentId: string) => void;
  getActiveAgentId: () => string;
  getAgentStatus: (agentId: string) => { status: string; detail?: string } | null;
  currentModel: () => { model: string; providerName: string; type: string } | null;
  port: () => number;
  startTime: number;
}

/**
 * Adapts a product AgentEntry to the SDK managed-runtime builder.
 *
 * Claw still chooses product roots, host introspection tools, and UI-facing
 * config values. Provider resolution, compaction window, execution environment,
 * local workspace hand, file memory, safety guard, observe collector, and skill
 * loadout are assembled by @berry-agent/runtime so product code does not become
 * a second harness.
 */
export class AgentRuntimeFactory {
  constructor(private readonly opts: AgentRuntimeFactoryOptions) {}

  create(agentId: string, entry: AgentEntry): BuiltAgentRuntime {
    const workspace = entry.workspace ?? this.opts.config.agentWorkspace(agentId);
    const home = this.opts.config.agentHomeFor(workspace);
    const projectRoot = entry.project;
    const appConfig = this.opts.config.get();

    if (projectRoot && !existsSync(projectRoot)) {
      mkdirSync(projectRoot, { recursive: true });
    }

    const { runtime } = createManagedRuntime({
      agentId,
      workspace,
      projectRoot,
      home,
      registry: this.opts.config.toModelsRegistry(),
      credentials: this.opts.credentials,
      model: entry.model,
      reasoningEffort: entry.reasoningEffort,
      promptPack: entry.promptPack,
      promptPackDir: this.opts.config.promptPacksDir(),
      toolDenylist: entry.disabledTools ?? [],
      executionEnvironmentProvider: createSandboxExecutionEnvironmentProvider({ logger: console }),
      localWorkspace: {
        allowedTools: entry.tools,
      },
      hostHand: {
        id: 'berry-claw-system',
        kind: 'system',
        displayName: 'Berry Claw system',
        tools: createBerryTools({
          getActiveAgentId: this.opts.getActiveAgentId,
          getAgentStatus: this.opts.getAgentStatus,
          currentModel: this.opts.currentModel,
          listAgents: () => this.opts.config.listAgents(),
          getTiers: () => this.opts.config.getTiers(),
          listProviderInstances: () => this.opts.config.listProviderInstances(),
          listModels: () => this.opts.config.listModels(),
          getAgent: (id) => this.opts.config.getAgent(id),
          port: this.opts.port(),
          startTime: this.opts.startTime,
        }),
      },
      mcp: {
        ensureDefaultConfig: true,
      },
      skills: {
        extraDirs: entry.skillDirs,
        globalDir: this.opts.config.globalSkillsDir(),
        builtinDir: this.opts.config.builtinSkillsDir(),
        enabled: entry.enabledSkills,
        disabled: entry.disabledSkills,
      },
      safety: {
        agentLevel: entry.safetyLevel,
        globalLevel: appConfig.safetyLevel,
        classifier: appConfig.safetyClassifier,
        askBridge: this.opts.askBridge(),
      },
      observe: {
        observer: this.opts.observer,
        pricingOverrides: this.opts.pricingOverrides,
      },
      onProviderRotate: (from, to, err) => {
        console.warn(`[agent:${agentId}] provider failover: ${from.providerId} → ${to.providerId}`, err);
      },
      onStatusChange: () => this.opts.onStatusChange(agentId),
    });

    return {
      runtime,
      workspace,
      projectRoot,
    };
  }
}
