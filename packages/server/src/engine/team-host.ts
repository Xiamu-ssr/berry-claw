import type { ManagedAgentRuntime } from '@berry-agent/core';
import {
  Team,
  readTeamLeaderId,
  type SpawnTeammateSpec,
  type TeamAgentRuntime,
  type TeamState,
} from '@berry-agent/team';
import type { ConfigManager, AgentEntry } from './config-manager.js';
import type { FactBus } from '../facts/bus.js';
import { deriveTeamFact } from '../facts/derive.js';

export interface TeamHostDeps {
  config: ConfigManager;
  factBus: FactBus;
  getRuntime(agentId: string): ManagedAgentRuntime;
  getLiveRuntime(agentId: string): ManagedAgentRuntime | undefined;
  dropAgent(agentId: string): Promise<void>;
}

/**
 * Product adapter for SDK Team.
 *
 * SDK team owns persisted team/worklist/message artifacts. Berry Claw only
 * maps teammates to product AgentEntry rows and mirrors team changes onto the
 * FactBus for UI transport.
 */
export class TeamHost {
  private readonly teams = new Map<string, Team>();
  private readonly pendingRehydrates = new Map<string, Promise<void>>();

  constructor(private readonly deps: TeamHostDeps) {}

  /** Fire-and-forget rehydrate after a leader runtime is initialized. */
  rehydrateOnAgentInit(agentId: string, runtime: ManagedAgentRuntime, project: string): void {
    const pending = this.rehydrateTeam(agentId, runtime, project).catch((err) => {
      console.warn(`[agent:${agentId}] team rehydrate failed:`, err);
    });
    this.pendingRehydrates.set(agentId, pending);
  }

  /** Wait for a pending cold-boot team rehydrate to complete. */
  async waitForRehydrate(agentId: string): Promise<void> {
    const pending = this.pendingRehydrates.get(agentId);
    if (pending) await pending;
  }

  getTeam(agentId: string): Team | undefined {
    return this.teams.get(agentId);
  }

  /** Explicitly start or fetch the SDK team led by an agent runtime. */
  async startTeam(agentId: string, teamName?: string): Promise<TeamState> {
    const entry = this.deps.config.getAgent(agentId);
    if (!entry) throw new Error(`Agent "${agentId}" not found`);
    if (!entry.project) {
      throw new Error(`Agent "${agentId}" has no project. Bind the agent to a project before starting a team.`);
    }

    const runtime = this.deps.getRuntime(agentId);
    let team = this.teams.get(agentId);
    if (!team) {
      team = await Team.open({
        leaderId: agentId,
        project: entry.project,
        name: teamName,
        ...this.teamHooks(agentId),
      });
      this.teams.set(agentId, team);
      this.mountLeaderTools(runtime, team);
    }
    await this.emitTeamFact(agentId);
    return team.state;
  }

  /** Disband through SDK Team and emit deletion fact. */
  async disbandTeam(agentId: string): Promise<void> {
    const team = this.teams.get(agentId);
    if (!team) throw new Error(`No team for agent "${agentId}".`);
    await team.disband();
    this.teams.delete(agentId);
    this.deps.factBus.emitTeam(agentId, null);
  }

  async emitTeamFact(leaderId: string, messageCount?: number): Promise<void> {
    const team = this.teams.get(leaderId);
    if (!team) {
      this.deps.factBus.emitTeam(leaderId, null);
      return;
    }
    const fact = await deriveTeamFact(team, { messageCount });
    this.deps.factBus.emitTeam(leaderId, fact);
  }

  private async rehydrateTeam(agentId: string, runtime: ManagedAgentRuntime, project: string): Promise<void> {
    if (this.teams.has(agentId)) return;
    const leaderId = await readTeamLeaderId(project);
    if (!leaderId || leaderId !== agentId) return;

    const team = await Team.open({
      leaderId: agentId,
      project,
      ...this.teamHooks(agentId),
    });
    this.mountLeaderTools(runtime, team);
    const revived = team.rehydrateAll();
    if (revived.length > 0) {
      console.log(`[team:${agentId}] rehydrated ${revived.length} teammate(s): ${revived.join(', ')}`);
    }
    this.teams.set(agentId, team);
  }

  private mountLeaderTools(runtime: ManagedAgentRuntime, team: Team): void {
    const hand = team.leaderHand();
    if (!runtime.hasHand(hand.id)) {
      runtime.addHand(hand);
    }
  }

  private teamHooks(leaderId: string) {
    return {
      runtimeFactory: async (spec: SpawnTeammateSpec) => this.createTeammateRuntime(spec),
      onDisband: async (teammateId: string) => {
        await this.deps.dropAgent(teammateId);
        try { this.deps.config.removeAgent(teammateId); } catch { /* already gone */ }
        this.deps.factBus.emitAgent(teammateId, null);
        this.emitTeamFact(leaderId).catch(() => {});
      },
      runtimeLookup: (teammateId: string): TeamAgentRuntime | undefined => {
        if (!this.deps.config.getAgent(teammateId)) return undefined;
        const live = this.deps.getLiveRuntime(teammateId);
        if (live) return live;
        try { return this.deps.getRuntime(teammateId); } catch { return undefined; }
      },
      availableTiers: (): string[] => Object.keys(this.deps.config.getTiers()),
    };
  }

  private async createTeammateRuntime(spec: SpawnTeammateSpec): Promise<ManagedAgentRuntime> {
    if (this.deps.config.getAgent(spec.id)) {
      throw new Error(`Agent id "${spec.id}" already exists in the registry. Pick a different teammate id.`);
    }

    const entry: AgentEntry = {
      name: spec.role,
      model: this.resolveTeammateModel(spec),
      project: spec.project,
      team: { leaderId: spec.leaderId, role: spec.role },
    };
    this.deps.config.setAgent(spec.id, entry);

    const runtime = this.deps.getRuntime(spec.id);
    await runtime.writeInstructions(spec.systemPrompt);
    return runtime;
  }

  private resolveTeammateModel(spec: SpawnTeammateSpec): string {
    if (spec.tier) return `tier:${spec.tier}`;
    if (spec.model) return spec.model;
    const leaderEntry = this.deps.config.getAgent(spec.leaderId);
    return leaderEntry?.model ?? Object.values(this.deps.config.getTiers())[0] ?? 'claude-opus-4.7';
  }
}
