/**
 * a8s usage / audit reads for the Audit page.
 *
 * Thin wrappers over @berry-agent/client. The operator rollup powers the
 * overview; the per-agent drilldown (sessions → turns → inferences → detail)
 * powers the drawer. All read-only; a8s reads workers' observe.db. The shapes
 * returned are the cluster-protocol types straight through — no reshaping, so
 * the Audit page binds to the canonical schema.
 */
import type {
  OperatorUsageResponse,
  AgentUsageResponse,
  UsageSession,
  UsageTurn,
  UsageInference,
  UsageInferenceDetail,
} from '@berry-agent/client';
import { a8sClient } from './client';

export type {
  OperatorUsageResponse,
  AgentUsageResponse,
  UsageSession,
  UsageTurn,
  UsageInference,
  UsageInferenceDetail,
};

/** Cluster-wide usage rollup for the overview. */
export async function fetchOperatorUsage(): Promise<OperatorUsageResponse> {
  const client = await a8sClient();
  return client.operatorUsage();
}

/** One agent's usage summary (model breakdown, daily trend, top tools). */
export async function fetchAgentUsage(agentId: string): Promise<AgentUsageResponse> {
  const client = await a8sClient();
  return client.agentUsage(agentId);
}

/** Drilldown L1 — an agent's sessions. */
export async function fetchUsageSessions(agentId: string): Promise<UsageSession[]> {
  const client = await a8sClient();
  return (await client.agentUsageSessions(agentId)).sessions;
}

/** Drilldown L2 — turns in a session. */
export async function fetchUsageTurns(agentId: string, sessionId: string): Promise<UsageTurn[]> {
  const client = await a8sClient();
  return (await client.agentUsageTurns(agentId, sessionId)).turns;
}

/** Drilldown L3 — inferences in a turn. */
export async function fetchUsageInferences(agentId: string, turnId: string): Promise<UsageInference[]> {
  const client = await a8sClient();
  return (await client.agentUsageInferences(agentId, turnId)).inferences;
}

/** Drilldown L4 — one inference's full detail (or null when absent). */
export async function fetchUsageInferenceDetail(agentId: string, inferenceId: string): Promise<UsageInferenceDetail | null> {
  const client = await a8sClient();
  const res = await client.agentUsageInferenceDetail(agentId, inferenceId);
  return res.present ? res.inference : null;
}
