import { z } from 'zod';

export const zAuthChallengeRequest = z.object({
  clientPubkeyFingerprint: z.string().optional(),
});
export type AuthChallengeRequest = z.infer<typeof zAuthChallengeRequest>;

export const zAuthChallenge = z.object({
  nonce: z.string(),
  serverId: z.string(),
  expiresAt: z.number(),
});
export type AuthChallenge = z.infer<typeof zAuthChallenge>;

export const zAuthVerifyRequest = z.object({
  nonce: z.string(),
  signature: z.string(),
});
export type AuthVerifyRequest = z.infer<typeof zAuthVerifyRequest>;

export const zSessionToken = z.object({
  token: z.string(),
  issuedAt: z.number(),
  expiresAt: z.number(),
});
export type SessionToken = z.infer<typeof zSessionToken>;

export const zAuthVerifyResponse = z.object({
  sessionToken: z.string(),
  expiresAt: z.number(),
});
export type AuthVerifyResponse = z.infer<typeof zAuthVerifyResponse>;

export const zInstanceIdentity = z.object({
  instanceId: z.string(),
  hostname: z.string(),
  createdAt: z.number(),
  publicKey: z.string(),
  keyFingerprint: z.string(),
});
export type InstanceIdentity = z.infer<typeof zInstanceIdentity>;

/**
 * The a8s connection the console hands to an authenticated browser so the UI
 * can talk to the control plane directly via @berry-agent/client.
 *
 * The console (BFF) holds the product token server-side and only releases it
 * to a verified session — the browser never sees the admin token, and the
 * token never sits in a config file the user edits. `url` is the a8s base
 * (e.g. https://a8s.example.com); `token` is a product-scoped `bp_…` token (or
 * an admin token in single-tenant/dev setups).
 */
export const zA8sConnectionInfo = z.object({
  url: z.string().url(),
  token: z.string().min(1),
});
export type A8sConnectionInfo = z.infer<typeof zA8sConnectionInfo>;
