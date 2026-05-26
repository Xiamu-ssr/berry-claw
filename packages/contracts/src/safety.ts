import { z } from 'zod';
import { SAFETY_LEVELS as SDK_SAFETY_LEVELS, type SafetyLevel as SdkSafetyLevel } from '@berry-agent/safe/levels';

export const SAFETY_LEVELS = SDK_SAFETY_LEVELS;
export const zSafetyLevel = z.enum(SAFETY_LEVELS);
export type SafetyLevel = SdkSafetyLevel;

export const zAskQuestion = z.object({
  toolName: z.string(),
  input: z.record(z.unknown()),
  agentId: z.string().optional(),
  session: z.object({
    id: z.string(),
    cwd: z.string(),
    model: z.string(),
    turnId: z.string().optional(),
  }),
  callIndex: z.number(),
  reason: z.string().optional(),
});
export type AskQuestion = z.infer<typeof zAskQuestion>;

export const zAskAnswer = z.object({
  approved: z.boolean(),
  note: z.string().optional(),
});
export type AskAnswer = z.infer<typeof zAskAnswer>;
