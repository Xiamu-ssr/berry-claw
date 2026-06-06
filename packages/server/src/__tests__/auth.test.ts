import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Server } from 'node:http';
import { startServer } from '../server.js';
import { createKeyStore, signNonce, verifyIdentity } from '../auth/keystore.js';

// berry-claw is now an operating console: the only backend it carries is
// browser auth (challenge/verify against the instance keypair) + static SPA
// serving. Agents/sessions/skills live on a8s and the front-end reaches a8s
// directly. So these tests cover just that surface — there is deliberately
// no protected agent API or websocket here.

let server: Server;
let testAppDir: string;
const PORT = 43211;
const BASE = `http://localhost:${PORT}`;

beforeAll(async () => {
  testAppDir = await mkdtemp(join(tmpdir(), 'berry-claw-auth-'));
  // ClawConfig seeds a default config.json on first boot; no need to pre-write.
  const result = await startServer(PORT, { appDir: testAppDir });
  server = result.server;
  await new Promise(resolve => setTimeout(resolve, 50));
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await rm(testAppDir, { recursive: true, force: true });
});

describe('auth', () => {
  it('generates a verifiable instance keypair on boot', () => {
    const result = verifyIdentity(createKeyStore(testAppDir));
    expect(result.ok).toBe(true);
    expect(result.identity?.keyFingerprint).toMatch(/^SHA256:/);
  });

  it('exposes the instance identity', async () => {
    const res = await fetch(`${BASE}/api/auth/instance`);
    expect(res.ok).toBe(true);
    const identity = await res.json();
    expect(identity.instanceId).toBeTruthy();
    expect(identity.publicKey).toBeTruthy();
  });

  it('completes challenge verification and rejects nonce reuse', async () => {
    const challenge = await fetch(`${BASE}/api/auth/challenge`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    }).then(r => r.json());

    const signature = signNonce(createKeyStore(testAppDir), challenge.nonce);
    const verified = await fetch(`${BASE}/api/auth/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nonce: challenge.nonce, signature }),
    });
    expect(verified.ok).toBe(true);
    const body = await verified.json();
    expect(body.sessionToken).toBeTruthy();

    const reused = await fetch(`${BASE}/api/auth/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nonce: challenge.nonce, signature }),
    });
    expect(reused.status).toBe(401);
  });

  it('rejects verification with a bad signature', async () => {
    const challenge = await fetch(`${BASE}/api/auth/challenge`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    }).then(r => r.json());

    const bad = await fetch(`${BASE}/api/auth/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nonce: challenge.nonce, signature: 'not-a-real-signature' }),
    });
    expect(bad.status).toBe(401);
  });
});
