import { randomBytes } from 'node:crypto';
import { nanoid } from 'nanoid';
import type { AuthChallenge, SessionToken } from '@berry-agent/claw-contracts';
import { loadIdentity, verifyNonceSignature, type KeyStore } from './keystore.js';

export interface AuthStoreOptions {
  challengeTtlMs: number;
  sessionTtlMs: number;
}

interface ChallengeRecord {
  nonce: string;
  expiresAt: number;
}

interface TokenRecord {
  issuedAt: number;
  expiresAt: number;
}

export class AuthStore {
  private challenges = new Map<string, ChallengeRecord>();
  private tokens = new Map<string, TokenRecord>();

  constructor(
    private readonly keys: KeyStore,
    private readonly opts: AuthStoreOptions,
  ) {}

  issueChallenge(): AuthChallenge {
    this.gc();
    const identity = loadIdentity(this.keys);
    const nonce = randomBytes(32).toString('base64');
    const expiresAt = Date.now() + this.opts.challengeTtlMs;
    this.challenges.set(nonce, { nonce, expiresAt });
    return { nonce, serverId: identity.instanceId, expiresAt };
  }

  verify(nonce: string, signature: string): SessionToken {
    this.gc();
    const challenge = this.challenges.get(nonce);
    if (!challenge) throw new Error('unknown or already-used nonce');
    this.challenges.delete(nonce);
    if (Date.now() > challenge.expiresAt) throw new Error('challenge expired');

    const identity = loadIdentity(this.keys);
    if (!verifyNonceSignature(identity.publicKey, nonce, signature)) {
      throw new Error('signature verification failed');
    }

    const issuedAt = Date.now();
    const token = nanoid(32);
    const expiresAt = issuedAt + this.opts.sessionTtlMs;
    this.tokens.set(token, { issuedAt, expiresAt });
    return { token, issuedAt, expiresAt };
  }

  isTokenValid(token: string | null | undefined): boolean {
    if (!token) return false;
    this.gc();
    const record = this.tokens.get(token);
    return !!record && Date.now() <= record.expiresAt;
  }

  clearTokens(): void {
    this.tokens.clear();
  }

  private gc(): void {
    const now = Date.now();
    for (const [nonce, challenge] of this.challenges) {
      if (now > challenge.expiresAt) this.challenges.delete(nonce);
    }
    for (const [token, record] of this.tokens) {
      if (now > record.expiresAt) this.tokens.delete(token);
    }
  }
}
