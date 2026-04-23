/**
 * Frontend FactStore — in-memory cache of agent/team/session facts,
 * seeded by GET /api/facts and patched incrementally from the fact_changed
 * WS channel.
 *
 * Contract:
 * - Components never fetch individual agents/teams directly. They ask
 *   the store and react to updates.
 * - The store is a singleton because WS is per-app; multiple stores would
 *   fight over the same event stream.
 * - Subscriptions are coarse (per fact kind). Components that only need
 *   one agent still get notified on all agent changes — React's render
 *   bailout covers the perf concern.
 */

import type { AgentFact, TeamFact, SessionFact, FactChange, FactKind } from './types';
import { API } from '../api/paths';

type Listener = () => void;

class FactStore {
  private agents = new Map<string, AgentFact>();
  private teams = new Map<string, TeamFact>();
  private sessions = new Map<string, SessionFact>();

  // Cached snapshot arrays. useSyncExternalStore requires getSnapshot to
  // return a stable reference when nothing changed — otherwise React bails
  // with 'The result of getSnapshot should be cached to avoid an infinite
  // loop'. We rebuild only on apply()/hydrate() mutations.
  private agentsList: AgentFact[] = [];
  private teamsList: TeamFact[] = [];
  private sessionsList: SessionFact[] = [];
  private activeAgentCache: AgentFact | undefined;

  private listenersByKind: Record<FactKind, Set<Listener>> = {
    agent: new Set(),
    team: new Set(),
    session: new Set(),
  };

  /** One-time seed from the snapshot endpoint. Safe to call again (idempotent). */
  async hydrate(kind: FactKind | 'all' = 'all'): Promise<void> {
    const url = kind === 'all' ? '/api/facts' : `/api/facts?kind=${kind}`;
    try {
      const res = await fetch(url);
      if (!res.ok) return;
      const data = (await res.json()) as { changes: FactChange[] };
      for (const change of data.changes) this.applyChange(change);
      this.notifyAllKinds();
    } catch (err) {
      console.warn('[facts] hydrate failed:', err);
    }
  }

  /** Apply a WS fact_changed event. */
  apply(change: FactChange): void {
    this.applyChange(change);
    this.listenersByKind[change.kind].forEach((fn) => fn());
  }

  private applyChange(change: FactChange): void {
    const bucket = this.bucketFor(change.kind);
    if (change.fact === null) bucket.delete(change.id);
    else bucket.set(change.id, change.fact as never);
    this.rebuildCache(change.kind);
  }

  private rebuildCache(kind: FactKind): void {
    if (kind === 'agent') {
      this.agentsList = [...this.agents.values()];
      this.activeAgentCache = this.agentsList.find((a) => a.isActive);
    } else if (kind === 'team') {
      this.teamsList = [...this.teams.values()];
    } else {
      this.sessionsList = [...this.sessions.values()];
    }
  }

  private bucketFor(kind: FactKind): Map<string, AgentFact | TeamFact | SessionFact> {
    switch (kind) {
      case 'agent': return this.agents as never;
      case 'team': return this.teams as never;
      case 'session': return this.sessions as never;
    }
  }

  /** React-style subscribe for useSyncExternalStore. */
  subscribe(kind: FactKind, listener: Listener): () => void {
    this.listenersByKind[kind].add(listener);
    return () => { this.listenersByKind[kind].delete(listener); };
  }

  listAgents(): AgentFact[] { return this.agentsList; }
  listTeams(): TeamFact[] { return this.teamsList; }
  listSessions(): SessionFact[] { return this.sessionsList; }

  getAgent(id: string): AgentFact | undefined { return this.agents.get(id); }
  getTeam(id: string): TeamFact | undefined { return this.teams.get(id); }

  /** Currently-active agent — cached, stable identity until it changes. */
  activeAgent(): AgentFact | undefined { return this.activeAgentCache; }

  private notifyAllKinds(): void {
    this.listenersByKind.agent.forEach((fn) => fn());
    this.listenersByKind.team.forEach((fn) => fn());
    this.listenersByKind.session.forEach((fn) => fn());
  }
}

export const factStore = new FactStore();

// Re-export the paths import so consumers don't need to reach into api/.
// (Trivial but keeps the public store surface self-contained.)
export { API };
