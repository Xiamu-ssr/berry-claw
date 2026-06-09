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
import type { AgentFact, TeamFact, SystemFact } from '@berry-agent/claw-contracts';

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
 * Singleton SystemFact — currently surfaces shared MCP servers.
 * Returns undefined until the first hydrate/WS emission lands.
 */
export function useSystemFact(): SystemFact | undefined {
  return useSyncExternalStore(
    (fn) => factStore.subscribe('system', fn),
    () => factStore.getSystem(),
  );
}

/**
 * Hydrate the store on app mount, then keep it live by polling.
 *
 * Direct-connect has no fact_changed WS channel (the console BFF that pushed
 * those is gone). a8s is request/response, so roster + per-agent status
 * liveness comes from re-hydrating on an interval: listAgents + agentSnapshot
 * is cheap and the store replaces the agent bucket wholesale, so adds, removes
 * and status flips all converge within one tick. Live token deltas still ride
 * the per-turn SSE stream (useA8sChat) — this poll only covers the roster the
 * chat stream can't see.
 *
 * `intervalMs` of 0 disables polling (one-shot hydrate). The tab being hidden
 * pauses the poll so a backgrounded console doesn't hammer a8s.
 */
export function useFactHydration(enabled = true, intervalMs = 5000): void {
  useEffect(() => {
    if (!enabled) return;
    let stopped = false;
    const tick = () => { if (!stopped) void factStore.hydrate('all'); };
    tick();
    if (intervalMs <= 0) return () => { stopped = true; };
    let timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') tick();
    }, intervalMs);
    // Refresh immediately when the tab regains focus (poll may have been idle).
    const onVisible = () => { if (document.visibilityState === 'visible') tick(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      stopped = true;
      window.clearInterval(timer);
      timer = 0;
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [enabled, intervalMs]);
}
