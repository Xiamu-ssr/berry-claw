import { z } from 'zod';
import { zAgentFact, zSystemFact, zTeamFact, zFactChange } from './facts.js';

export const zFactsResponse = z.object({
  changes: z.array(zFactChange),
});
export type FactsResponse = z.infer<typeof zFactsResponse>;

export const zAgentsResponse = z.object({
  agents: z.array(z.object({ id: z.string(), entry: z.unknown() })),
  activeAgent: z.string(),
});
export type AgentsResponse = z.infer<typeof zAgentsResponse>;

export const zFactSnapshot = z.object({
  agents: z.array(zAgentFact).optional(),
  teams: z.array(zTeamFact).optional(),
  system: zSystemFact.optional(),
});
export type FactSnapshot = z.infer<typeof zFactSnapshot>;
