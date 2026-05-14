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
