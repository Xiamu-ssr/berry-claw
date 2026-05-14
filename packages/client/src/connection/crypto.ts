import * as ed from '@noble/ed25519';
import { sha512 } from '@noble/hashes/sha512';
import { parseEd25519PrivateKeyPem } from './parse';

/**
 * Ed25519 signing shim used by the auth flow.
 *
 * We deliberately use `@noble/ed25519` (plus `@noble/hashes/sha512`) instead
 * of WebCrypto SubtleCrypto because:
 *   1. WebCrypto's Ed25519 support has churned across Chromium/Safari/Firefox
 *      versions (still experimental in some older builds). Pinning to a
 *      tiny (~14KB) deterministic implementation keeps every Electron target
 *      identical.
 *   2. noble ships a pluggable hash interface; once `crypto.subtle` Ed25519
 *      stabilises we can swap behind this module without touching callers.
 *
 * The first call registers sha512 on noble's `etc` hook. Re-running the
 * assignment is harmless (identical function reference), so we don't need a
 * once-guard.
 */
ed.etc.sha512Async = async (...messages: Uint8Array[]) =>
  sha512(ed.etc.concatBytes(...messages));
ed.etc.sha512Sync = (...messages: Uint8Array[]) =>
  sha512(ed.etc.concatBytes(...messages));

/**
 * Sign a base64-encoded nonce with the seed extracted from a PKCS#8 PEM.
 *
 * The server verifies with `crypto.verify(null, Buffer.from(nonce), pubkey,
 * signatureBase64)` — i.e. the *UTF-8 bytes of the nonce string* are signed,
 * not the base64-decoded bytes. We mirror that exactly: TextEncoder → sign →
 * base64.
 */
export async function signChallenge(privateKeyPem: string, nonce: string): Promise<string> {
  const seed = parseEd25519PrivateKeyPem(privateKeyPem);
  if (seed.length !== 32) {
    throw new Error(`Ed25519 seed must be 32 bytes, got ${seed.length}`);
  }
  const message = new TextEncoder().encode(nonce);
  const signature = await ed.signAsync(message, seed);
  return base64Encode(signature);
}

/** Synchronous variant for tests / non-async call sites. */
export function signChallengeSync(privateKeyPem: string, nonce: string): string {
  const seed = parseEd25519PrivateKeyPem(privateKeyPem);
  const message = new TextEncoder().encode(nonce);
  const signature = ed.sign(message, seed);
  return base64Encode(signature);
}

function base64Encode(bytes: Uint8Array): string {
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}
