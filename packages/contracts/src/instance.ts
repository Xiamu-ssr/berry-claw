import { z } from 'zod';

/**
 * A berry-claw client-side instance record.
 *
 * The renderer (and Electron shell, later) persists these locally to remember
 * which backends the user has connected to. The CLI may eventually import this
 * type to emit ready-to-paste JSON alongside `key show`, so keep it stable.
 *
 * Private key material is stored in `privateKeyPem` (PEM, Ed25519). At the
 * renderer-only stage this lives in `localStorage`; once the Electron main
 * process lands, we route it through `safeStorage` with the same shape.
 */
export const zInstance = z.object({
  /** Locally unique id (crypto.randomUUID). */
  id: z.string().min(1),
  /** Human-friendly label shown in the picker. */
  name: z.string().min(1).max(64),
  /** Absolute REST base, e.g. http://localhost:3210 (no trailing slash). */
  apiBase: z.string().url(),
  /** Absolute WS base, e.g. ws://localhost:3210 (no trailing slash). */
  wsBase: z.string().url(),
  /**
   * Server's own instance id (ULID) — discovered from the first successful
   * `/api/auth/challenge` response, cached here for drift detection. Optional
   * so freshly-parsed records that haven't been verified yet still validate.
   */
  serverInstanceId: z.string().optional(),
  /**
   * SSH-style server fingerprint (SHA256:xxxx). Fetched from the server on
   * first connect via `GET /api/auth/instance`. Optional at the type level
   * because it may be briefly absent between "user typed an endpoint" and
   * "probe succeeded".
   */
  fingerprint: z.string().min(1).optional(),
  /** Ed25519 private key, PEM-encoded (the body from `berry-claw key show`). */
  privateKeyPem: z.string().min(1),
  /** Creation timestamp (ms since epoch). */
  addedAt: z.number().int().nonnegative(),
  /**
   * Last failed-auth timestamp, if any. The picker uses this to surface a
   * "re-add key" hint without blocking unrelated instances.
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
