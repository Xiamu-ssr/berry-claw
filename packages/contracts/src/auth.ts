import { z } from 'zod';

/**
 * The a8s connection an instance resolves to: the control-plane base URL plus
 * the bearer token the user pasted. berry-claw talks to a8s directly, so this
 * is just `{ url, token }` read straight off the stored Instance — there is no
 * console handshake, no challenge/verify, no session token.
 *
 * `url` is the a8s base (e.g. https://a8s.example.com); `token` is a `bp_…`
 * product token or a `bs_…` subject-scoped token.
 */
export const zA8sConnectionInfo = z.object({
  url: z.string().url(),
  token: z.string().min(1),
});
export type A8sConnectionInfo = z.infer<typeof zA8sConnectionInfo>;
