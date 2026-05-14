import { z } from 'zod';

export const zSafetyLevel = z.enum(['trust', 'default', 'auto']);
export type SafetyLevel = z.infer<typeof zSafetyLevel>;

export const zAskQuestion = z.object({
  toolName: z.string(),
  input: z.record(z.unknown()),
  session: z.object({
    id: z.string(),
    cwd: z.string(),
    model: z.string(),
  }),
  reason: z.string().optional(),
});
export type AskQuestion = z.infer<typeof zAskQuestion>;

export const zAskAnswer = z.object({
  approved: z.boolean(),
  note: z.string().optional(),
});
export type AskAnswer = z.infer<typeof zAskAnswer>;
