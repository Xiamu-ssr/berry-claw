/**
 * a8s → AgentFact assembly.
 *
 * berry-claw holds no agent config; the product view of an agent is derived
 * entirely from a8s: `listAgents()` gives the roster (id, workerId, owner) and
 * `agentSnapshot()` fills in model/provider/status/hands/skills. We fan out a
 * snapshot per agent and assemble the AgentFact[] the FactStore seeds from.
 *
 * Status is a free string on the wire (`AgentSnapshotResponse.status`); we
 * narrow it to the claw AgentStatus enum, falling back to 'idle' for anything
 * unrecognised so a new SDK status never crashes the console.
 */
import type { AgentFact, AgentStatus } from '@berry-agent/claw-contracts';
import { zAgentStatus } from '@berry-agent/claw-contracts';
import { a8sClient } from './client';

function narrowStatus(raw: string): AgentStatus {
  const parsed = zAgentStatus.safeParse(raw);
  return parsed.success ? parsed.data : 'idle';
}

/** Assemble the full AgentFact[] from a8s for the active instance. */
export async function loadAgentFacts(): Promise<AgentFact[]> {
  const client = await a8sClient();
  const { agents } = await client.listAgents();

  const facts = await Promise.all(
    agents.map(async (loc): Promise<AgentFact> => {
      const base: AgentFact = {
        id: loc.agentId,
        name: loc.labels?.name ?? loc.agentId,
        model: '',
        provider: '',
        status: 'idle',
        workerId: loc.workerId,
        instantiated: loc.workerId !== null,
        labels: loc.labels,
      };
      // An unscheduled agent (no worker) has no live runtime to snapshot;
      // return the roster-only fact rather than failing the whole load.
      if (loc.workerId === null) return base;
      try {
        const snap = await client.agentSnapshot(loc.agentId);
        return {
          ...base,
          model: snap.model,
          provider: snap.provider,
          status: narrowStatus(snap.status),
          statusDetail: snap.statusDetail,
          hands: snap.hands,
          skills: snap.skills,
        };
      } catch {
        // Snapshot can race a just-evicted agent; keep the roster fact.
        return base;
      }
    }),
  );
  return facts;
}
