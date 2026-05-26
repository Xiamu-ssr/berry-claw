import type { Express } from 'express';
import type { AgentManager } from '../engine/agent-manager.js';
import { zTeamStartRequest, type TeamsResponse } from '@berry-agent/claw-contracts';

export function registerTeamRoutes(app: Express, manager: AgentManager): void {
  /**
   * Global list of all currently-loaded teams. Each entry gives enough for
   * a TeamsPage card: leader id/name, project, teammate count, team name.
   */
  app.get('/api/teams', async (_req, res) => {
    await manager.ensureTeamsLoaded();

    const teams: TeamsResponse['teams'] = [];
    for (const { id, entry } of manager.config.listAgents()) {
      const team = manager.getTeam(id);
      if (team) {
        teams.push({ leaderId: id, leaderName: entry.name, state: team.state });
      }
    }
    res.json({ teams });
  });

  /** Start (or fetch) the team led by this agent. Requires agent.project. */
  app.post('/api/agents/:id/team/start', async (req, res) => {
    const parsed = zTeamStartRequest.safeParse(req.body ?? {});
    if (!parsed.success) return res.status(400).json({ error: parsed.error.message });
    try {
      const state = await manager.startTeam(req.params.id, parsed.data.name);
      res.json({ ok: true, team: state });
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  /** Current team snapshot (null if none). */
  app.get('/api/agents/:id/team', async (req, res) => {
    const team = await manager.resolveTeamForAgent(req.params.id);
    res.json({ team: team?.state ?? null });
  });

  /** SDK team message log. */
  app.get('/api/agents/:id/team/messages', async (req, res) => {
    const team = await manager.resolveTeamForAgent(req.params.id);
    if (!team) return res.status(404).json({ error: 'No team for this agent' });
    const messages = await team.readMessages();
    res.json({ messages });
  });

  /** Disband the SDK team and detach teammate agents. */
  app.delete('/api/agents/:id/team', async (req, res) => {
    try {
      const team = await manager.resolveTeamForAgent(req.params.id);
      if (!team) return res.status(400).json({ error: 'No team for this agent' });
      await manager.disbandTeam(req.params.id);
      res.json({ ok: true });
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  /** Worklist snapshot (read-only; mutations go through the agent's `worklist` tool). */
  app.get('/api/agents/:id/team/worklist', async (req, res) => {
    const team = await manager.resolveTeamForAgent(req.params.id);
    if (!team) return res.status(404).json({ error: 'No team for this agent' });
    const tasks = await team.worklist.list();
    res.json({ tasks });
  });
}
