import type { CredentialStore } from '@berry-agent/core';
import type { ModelPricing, Observer } from '@berry-agent/observe';
import type { AskBridge } from '@berry-agent/safe';
import { createSandboxExecutionEnvironmentProvider } from '@berry-agent/tools-common';
import {
  buildAgentRuntime,
  type BuiltWorkerRuntime,
  type WorkerAgentSpec,
  type WorkerEnvironment,
  type WorkerRuntimeHooks,
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
  getAgentStatus: (agentId: string) => { status: string; detail?: string } | null;
  currentModel: (agentId: string) => { model: string; providerName: string; type: string } | null;
  port: () => number;
  startTime: number;
}

/**
 * Adapts a Claw AgentEntry to the @berry-agent/worker spec/env contract.
 *
 * Responsibility split:
 *  - `env`: per-worker shared infrastructure (constructed once)
 *  - `specFor(id, entry)`: per-agent spec mapping (called by Worker.runAgent)
 *  - `hooksFor(id)`: per-agent runtime hooks (status-change → product facts)
 *  - `create(id, entry)`: convenience for code that needs the runtime directly
 *    (without going through Worker). Always equivalent to
 *    `buildAgentRuntime(specFor(id, entry), env, hooksFor(id))`.
 */
export class AgentRuntimeFactory {
  readonly env: WorkerEnvironment;

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

  specFor(agentId: string, entry: AgentEntry): WorkerAgentSpec {
    const workspace = entry.workspace ?? this.opts.config.agentWorkspace(agentId);
    const home = this.opts.config.agentHomeFor(workspace);
    const appConfig = this.opts.config.get();

    return {
      agentId,
      workspace,
      home,
      projectRoot: entry.project,
      model: entry.model,
      reasoningEffort: entry.reasoningEffort,
      promptPack: entry.promptPack,
      toolDenylist: entry.disabledTools ?? [],
      // 新-1: localWorkspace split into workspaceTools (env-bound) + webTools
      // (env-less). The old single allowedTools filtered the combined set, so
      // pass it to both to preserve behavior. (This whole factory is slated
      // for the C rewrite onto @berry-agent/client.)
      workspaceTools: { allowedTools: entry.tools },
      webTools: { allowedTools: entry.tools },
      hostHandDisplayName: 'Berry Claw system',
      hostTools: createBerryTools({
        agentId,
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
    };
  }

  hooksFor(_agentId: string): WorkerRuntimeHooks {
    return {
      onStatusChange: (id) => this.opts.onStatusChange(id),
    };
  }

  create(agentId: string, entry: AgentEntry): BuiltAgentRuntime {
    return buildAgentRuntime(this.specFor(agentId, entry), this.env, this.hooksFor(agentId));
  }
}
