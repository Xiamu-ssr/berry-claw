import { z } from 'zod';

/**
 * A berry-claw client-side instance record.
 *
 * The client shell persists these locally to remember which a8s control planes
 * the user has connected to. berry-claw talks to a8s DIRECTLY: an instance is
 * just an a8s endpoint plus the bearer token an operator handed the user
 * (a `bp_…` product root token, or a `bs_…` subject-scoped token). There is no
 * console/BFF in the middle and no challenge/verify handshake — the browser
 * sends the token straight to a8s.
 *
 * At the browser-only stage this lives in `localStorage`; native
 * mobile/desktop shells should route the token through platform secure storage
 * with the same shape.
 */
export const zInstance = z.object({
  /** Locally unique id (crypto.randomUUID). */
  id: z.string().min(1),
  /** Human-friendly label shown in the picker. */
  name: z.string().min(1).max(64),
  /** Absolute a8s REST base, e.g. http://host:28789 (no trailing slash). */
  apiBase: z.string().url(),
  /** Absolute a8s WS base, e.g. ws://host:28789 (no trailing slash). */
  wsBase: z.string().url(),
  /**
   * The a8s bearer token the user pasted — a `bp_…` product root token or a
   * `bs_…` subject-scoped token. a8s resolves it to an owner scope; berry-claw
   * never inspects it beyond sending it as `Authorization: Bearer <token>`.
   */
  token: z.string().min(1),
  /** Creation timestamp (ms since epoch). */
  addedAt: z.number().int().nonnegative(),
  /**
   * Last failed-auth timestamp, if any. The picker uses this to surface a
   * "token rejected — paste a fresh one" hint without blocking unrelated
   * instances.
   */
  lastAuthError: z
    .object({
      at: z.number().int().nonnegative(),
      message: z.string(),
    })
    .optional(),
});
export type Instance = z.infer<typeof zInstance>;

export const zInstanceList = z.array(zInstance);
export type InstanceList = z.infer<typeof zInstanceList>;
