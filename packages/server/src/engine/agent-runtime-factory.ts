import type { CredentialStore } from '@berry-agent/core';
import type { ModelPricing, Observer } from '@berry-agent/observe';
import type { AskBridge } from '@berry-agent/safe';
import { createSandboxExecutionEnvironmentProvider } from '@berry-agent/tools-common';
import {
  buildAgentRuntime,
  type BuiltWorkerRuntime,
  type WorkerEnvironment,
} from '@berry-agent/worker';
import type { ConfigManager, AgentEntry } from './config-manager.js';
import { createBerryTools } from './berry-tools.js';

/**
 * Backwards-compat alias. The runtime build result now lives in
 * @berry-agent/worker; this re-export keeps existing imports stable.
 */
export type BuiltAgentRuntime = BuiltWorkerRuntime;

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
 * Adapts a Claw AgentEntry to the @berry-agent/worker runtime builder.
 *
 * Claw still chooses product roots, host introspection tools, ConfigManager
 * cascades, and UI-facing config values. The pure assembly of
 * provider/sandbox/safety/observe/skills happens in @berry-agent/worker,
 * which itself delegates to @berry-agent/runtime's createManagedRuntime.
 *
 * Reason for the indirection: a worker daemon will eventually own the runtime
 * for multiple products. AgentRuntimeFactory is the Claw-specific shape
 * mapper; buildAgentRuntime is the product-agnostic worker primitive.
 */
export class AgentRuntimeFactory {
  private readonly env: WorkerEnvironment;

  constructor(private readonly opts: AgentRuntimeFactoryOptions) {
    this.env = {
      registry: this.opts.config.toModelsRegistry(),
      credentials: this.opts.credentials,
      observer: this.opts.observer,
      pricingOverrides: this.opts.pricingOverrides,
      askBridge: this.opts.askBridge,
      promptPacksDir: this.opts.config.promptPacksDir(),
      defaultExecutionEnvironmentProvider: createSandboxExecutionEnvironmentProvider({
        logger: console,
      }),
      logger: console,
    };
  }

  create(agentId: string, entry: AgentEntry): BuiltAgentRuntime {
    const workspace = entry.workspace ?? this.opts.config.agentWorkspace(agentId);
    const home = this.opts.config.agentHomeFor(workspace);
    const appConfig = this.opts.config.get();

    return buildAgentRuntime(
      {
        agentId,
        workspace,
        home,
        projectRoot: entry.project,
        model: entry.model,
        reasoningEffort: entry.reasoningEffort,
        promptPack: entry.promptPack,
        toolDenylist: entry.disabledTools ?? [],
        localWorkspace: { allowedTools: entry.tools },
        hostHandDisplayName: 'Berry Claw system',
        hostTools: createBerryTools({
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
        },
        ensureDefaultMcpConfig: true,
      },
      this.env,
      {
        onStatusChange: (id) => this.opts.onStatusChange(id),
      },
    );
  }
}
