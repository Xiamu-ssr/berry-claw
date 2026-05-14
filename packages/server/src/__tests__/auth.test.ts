import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Server } from 'node:http';
import { WebSocket } from 'ws';
import { startServer } from '../server.js';
import { CONFIG_SCHEMA_VERSION } from '../engine/config-manager.js';
import { createKeyStore, signNonce, verifyIdentity } from '../auth/keystore.js';

let server: Server;
let testAppDir: string;
const PORT = 43211;
const BASE = `http://localhost:${PORT}`;

beforeAll(async () => {
  testAppDir = await mkdtemp(join(tmpdir(), 'berry-claw-auth-'));
  await writeFile(join(testAppDir, 'config.json'), JSON.stringify({
    schemaVersion: CONFIG_SCHEMA_VERSION,
    providerInstances: {},
    models: {},
    tiers: {},
    agents: {},
    defaultAgent: '',
    auth: {
      sessionTtlMs: 86_400_000,
      challengeTtlMs: 300_000,
      allowAnonymous: false,
    },
  }, null, 2));
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

  it('rejects protected API requests without a token', async () => {
    const res = await fetch(`${BASE}/api/agents`);
    expect(res.status).toBe(401);
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

    const authed = await fetch(`${BASE}/api/agents`, {
      headers: { Authorization: `Bearer ${body.sessionToken}` },
    });
    expect(authed.ok).toBe(true);

    const reused = await fetch(`${BASE}/api/auth/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nonce: challenge.nonce, signature }),
    });
    expect(reused.status).toBe(401);
  });

  it('rejects websocket connections without a token', async () => {
    const code = await new Promise<number>((resolve) => {
      const ws = new WebSocket(`ws://localhost:${PORT}/ws`);
      ws.on('close', (closeCode) => resolve(closeCode));
    });
    expect(code).toBe(4001);
  });
});
