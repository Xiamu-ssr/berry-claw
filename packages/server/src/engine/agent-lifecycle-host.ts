export interface AgentLifecycleHostOptions {
  liveAgentIds: () => string[];
  dropAgent: (agentId: string) => Promise<void>;
  emitAgentFact: (agentId: string) => void;
  emitSystemFact: () => void;
}

export interface RestartResult {
  mode: 'runtime_reload' | 'process_exit';
  message: string;
}

export class AgentLifecycleHost {
  private restartScheduled = false;

  constructor(private readonly options: AgentLifecycleHostOptions) {}

  async requestRestart(reason?: string): Promise<RestartResult> {
    if (this.restartScheduled) {
      return {
        mode: 'runtime_reload',
        message: 'Restart/reload is already in progress.',
      };
    }
    this.restartScheduled = true;
    const msg = reason ? `Restart requested: ${reason}` : 'Restart requested';
    if (process.env.BERRY_CLAW_ALLOW_SELF_EXIT === '1') {
      console.log(`[system] ${msg}. Exiting in 500ms; external supervisor must restart the process.`);
      setTimeout(() => process.exit(0), 500);
      return {
        mode: 'process_exit',
        message: 'Process restart scheduled. The process will exit in 500ms; an external supervisor must restart it.',
      };
    }

    console.log(`[system] ${msg}. Running safe runtime reload; process will stay alive.`);
    await this.reloadRuntime();
    this.restartScheduled = false;
    return {
      mode: 'runtime_reload',
      message: 'Runtime reload completed. The server process stayed alive; live agents will be recreated on demand.',
    };
  }

  async reloadRuntime(): Promise<void> {
    const liveIds = this.options.liveAgentIds();
    for (const id of liveIds) {
      await this.options.dropAgent(id);
      this.options.emitAgentFact(id);
    }
    // Agents are now lazy — each is re-created on its next request. There is
    // no "active" agent to eagerly re-warm (the frontend tracks which agent
    // it's viewing and will drive a fresh request).
    this.options.emitSystemFact();
  }
}
