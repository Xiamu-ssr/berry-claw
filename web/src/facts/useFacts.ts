/**
 * React hooks over the FactStore.
 *
 * Usage:
 *   const agents = useAgentFacts();
 *   const active = useActiveAgent();
 *   const team   = useTeamFact(leaderId);
 *
 * These hooks are the ONLY path components should use to read agent /
 * team / session state. Do not add parallel fetches for the same data.
 */

import { useEffect, useSyncExternalStore } from 'react';
import { factStore } from './store';
import type { AgentFact, TeamFact } from './types';

export function useAgentFacts(): AgentFact[] {
  return useSyncExternalStore(
    (fn) => factStore.subscribe('agent', fn),
    () => factStore.listAgents(),
  );
}

export function useActiveAgent(): AgentFact | undefined {
  return useSyncExternalStore(
    (fn) => factStore.subscribe('agent', fn),
    () => factStore.activeAgent(),
  );
}

export function useAgentFact(id: string | undefined): AgentFact | undefined {
  return useSyncExternalStore(
    (fn) => factStore.subscribe('agent', fn),
    () => (id ? factStore.getAgent(id) : undefined),
  );
}

export function useTeamFacts(): TeamFact[] {
  return useSyncExternalStore(
    (fn) => factStore.subscribe('team', fn),
    () => factStore.listTeams(),
  );
}

export function useTeamFact(leaderId: string | undefined): TeamFact | undefined {
  return useSyncExternalStore(
    (fn) => factStore.subscribe('team', fn),
    () => (leaderId ? factStore.getTeam(leaderId) : undefined),
  );
}

/**
 * Hydrate the store once on app mount. Call from <App/> near the top.
 * Safe to call multiple times; subsequent calls re-fetch the snapshot
 * and overwrite local state (useful after network reconnect).
 */
export function useFactHydration(enabled = true): void {
  useEffect(() => {
    if (!enabled) return;
    factStore.hydrate('all');
  }, [enabled]);
}
