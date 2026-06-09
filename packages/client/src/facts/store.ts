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

import type { AgentFact, TeamFact, SessionFact, SystemFact, FactChange, FactKind } from '@berry-agent/claw-contracts';
import { loadAgentFacts } from '../a8s/facts';

type Listener = () => void;

class FactStore {
  private agents = new Map<string, AgentFact>();
  private teams = new Map<string, TeamFact>();
  private sessions = new Map<string, SessionFact>();
  /** Singleton — only ever one SystemFact keyed by {@link SYSTEM_FACT_ID}. */
  private system: SystemFact | undefined;

  // Cached snapshot arrays. useSyncExternalStore requires getSnapshot to
  // return a stable reference when nothing changed — otherwise React bails
  // with 'The result of getSnapshot should be cached to avoid an infinite
  // loop'. We rebuild only on apply()/hydrate() mutations.
  private agentsList: AgentFact[] = [];
  /** JSON signature of the last hydrated agent roster; lets the poll skip
   *  no-op ticks instead of re-rendering the tree every few seconds. */
  private agentsSignature = '';
  private teamsList: TeamFact[] = [];
  private sessionsList: SessionFact[] = [];
  /** Which agent the UI is currently viewing. Frontend-owned (the backend
   *  is a thin BFF and no longer tracks a single "active" agent). Persisted
   *  so a reload keeps the user where they were; defaults to the first agent. */
  private selectedAgentId: string | undefined = readPersistedSelection();
  private activeAgentCache: AgentFact | undefined;

  private listenersByKind: Record<FactKind, Set<Listener>> = {
    agent: new Set(),
    team: new Set(),
    session: new Set(),
    system: new Set(),
  };

  /**
   * Seed the store from a8s. Agents are assembled directly from the control
   * plane (listAgents + agentSnapshot) via @berry-agent/client — the console
   * no longer carries a /api/facts endpoint. Teams/sessions/system are layered
   * in as their direct-connect paths land; until then they stay empty rather
   * than calling a torn-down BFF route.
   */
  async hydrate(kind: FactKind | 'all' = 'all'): Promise<void> {
    if (kind === 'all' || kind === 'agent') {
      try {
        const facts = await loadAgentFacts();
        // Skip the churn when the roster is byte-identical to what we hold —
        // the poll runs every few seconds and most ticks are no-ops, so we
        // must not hand useSyncExternalStore a fresh array each time (it would
        // re-render the whole tree). Only rebuild + notify on a real change.
        const next = JSON.stringify(facts);
        if (next === this.agentsSignature) return;
        this.agentsSignature = next;
        // Replace the agent bucket wholesale (roster is authoritative).
        this.agents.clear();
        for (const fact of facts) this.agents.set(fact.id, fact);
        this.rebuildCache('agent');
        this.listenersByKind.agent.forEach((fn) => fn());
      } catch (err) {
        console.warn('[facts] agent hydrate failed:', err);
      }
    }
  }

  /** Apply a WS fact_changed event. */
  apply(change: FactChange): void {
    this.applyChange(change);
    this.listenersByKind[change.kind].forEach((fn) => fn());
  }

  private applyChange(change: FactChange): void {
    // SystemFact is a singleton, not a bucketed collection — shortcut here.
    if (change.kind === 'system') {
      this.system = change.fact ?? undefined;
      return;
    }
    const bucket = this.bucketFor(change.kind);
    if (change.fact === null) bucket.delete(change.id);
    else bucket.set(change.id, change.fact as never);
    this.rebuildCache(change.kind);
  }

  private rebuildCache(kind: Exclude<FactKind, 'system'>): void {
    if (kind === 'agent') {
      this.agentsList = [...this.agents.values()];
      this.activeAgentCache = this.resolveActiveAgent();
    } else if (kind === 'team') {
      this.teamsList = [...this.teams.values()];
    } else {
      this.sessionsList = [...this.sessions.values()];
    }
  }

  private bucketFor(
    kind: Exclude<FactKind, 'system'>,
  ): Map<string, AgentFact | TeamFact | SessionFact> {
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
  /** Read the singleton SystemFact; undefined until the first hydrate/emit. */
  getSystem(): SystemFact | undefined { return this.system; }

  /** Currently-active agent — cached, stable identity until it changes. */
  activeAgent(): AgentFact | undefined { return this.activeAgentCache; }

  /** Frontend-owned selection. The UI calls this when the user picks an
   *  agent; the backend is no longer involved in "which agent is current". */
  setSelectedAgent(agentId: string): void {
    if (this.selectedAgentId === agentId) return;
    this.selectedAgentId = agentId;
    persistSelection(agentId);
    this.activeAgentCache = this.resolveActiveAgent();
    this.listenersByKind.agent.forEach((fn) => fn());
  }

  getSelectedAgentId(): string | undefined { return this.selectedAgentId; }

  /** Resolve the viewed agent: the explicit selection if it still exists,
   *  else the first agent (stable default so the UI always has a target). */
  private resolveActiveAgent(): AgentFact | undefined {
    if (this.selectedAgentId) {
      const sel = this.agents.get(this.selectedAgentId);
      if (sel) return sel;
    }
    return this.agentsList[0];
  }

  private notifyAllKinds(): void {
    this.listenersByKind.agent.forEach((fn) => fn());
    this.listenersByKind.team.forEach((fn) => fn());
    this.listenersByKind.session.forEach((fn) => fn());
    this.listenersByKind.system.forEach((fn) => fn());
  }
}

export const factStore = new FactStore();

const SELECTION_KEY = 'berry-claw.selectedAgentId';

function readPersistedSelection(): string | undefined {
  try {
    return localStorage.getItem(SELECTION_KEY) ?? undefined;
  } catch {
    return undefined;
  }
}

function persistSelection(agentId: string): void {
  try {
    localStorage.setItem(SELECTION_KEY, agentId);
  } catch {
    /* localStorage unavailable (private mode, SSR) — selection stays in-memory */
  }
}
