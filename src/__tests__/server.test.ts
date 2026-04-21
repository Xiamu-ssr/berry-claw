/**
 * Server API unit tests — test REST endpoints without real LLM calls
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startServer } from '../server.js';
import type { Server } from 'node:http';

let server: Server;
const PORT = 43210;  // Use unusual port to avoid conflicts
const BASE = `http://localhost:${PORT}`;

beforeAll(async () => {
  const result = startServer(PORT);
  server = result.server;
  // Wait for server to be ready
  await new Promise(resolve => setTimeout(resolve, 500));
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe('Config API (v2 schema: provider instances + models + tiers)', () => {
  it('GET /api/config/status returns status shape', async () => {
    const res = await fetch(`${BASE}/api/config/status`);
    expect(res.ok).toBe(true);
    const data = await res.json();
    expect(data).toHaveProperty('configured');
    expect(data).toHaveProperty('firstModel');
    expect(data).toHaveProperty('tiers');
  });

  it('GET /api/config/presets returns built-in provider catalog', async () => {
    const res = await fetch(`${BASE}/api/config/presets`);
    const data = await res.json();
    const ids = data.presets.map((p: any) => p.id);
    expect(ids).toContain('anthropic');
    expect(ids).toContain('openai');
    expect(ids).toContain('glm');
  });

  it('PUT /api/config/provider-instances/:id creates a provider instance', async () => {
    const res = await fetch(`${BASE}/api/config/provider-instances/test-provider`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        presetId: '__raw__',
        type: 'openai',
        baseUrl: 'https://test.com/v1',
        apiKey: 'sk-test-key',
        knownModels: ['gpt-4o', 'gpt-4o-mini'],
      }),
    });
    expect(res.ok).toBe(true);
    const data = await res.json();
    expect(data.ok).toBe(true);
  });

  it('GET /api/config returns config with masked keys', async () => {
    const res = await fetch(`${BASE}/api/config`);
    const data = await res.json();
    expect(data.schemaVersion).toBe(2);
    const inst = data.providerInstances['test-provider'];
    expect(inst).toBeDefined();
    expect(inst.apiKey).not.toBe('sk-test-key');
    expect(inst.apiKey).toMatch(/^sk-tes.*••.*key$/);
  });

  it('PUT /api/config/models/:id binds a model to providers', async () => {
    const res = await fetch(`${BASE}/api/config/models/gpt-4o`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        providers: [{ providerId: 'test-provider' }],
      }),
    });
    expect(res.ok).toBe(true);
  });

  it('GET /api/models exposes Layer-2 bindings to the chat switcher', async () => {
    const res = await fetch(`${BASE}/api/models`);
    const data = await res.json();
    expect(data.models.some((m: any) => m.model === 'gpt-4o')).toBe(true);
  });

  it('PUT /api/config/tiers/:tier assigns a model to a tier', async () => {
    const res = await fetch(`${BASE}/api/config/tiers/balanced`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ modelId: 'gpt-4o' }),
    });
    expect(res.ok).toBe(true);
    const status = await fetch(`${BASE}/api/config/status`).then(r => r.json());
    expect(status.tiers.balanced).toBe('gpt-4o');
  });

  it('PUT /api/config/provider-instances rejects missing presetId', async () => {
    const res = await fetch(`${BASE}/api/config/provider-instances/bad`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ apiKey: 'sk-x' }),
    });
    expect(res.status).toBe(400);
  });
});

describe('Agent API', () => {
  it('GET /api/agents lists agents', async () => {
    const res = await fetch(`${BASE}/api/agents`);
    const data = await res.json();
    expect(data).toHaveProperty('agents');
    expect(data).toHaveProperty('activeAgent');
  });

  it('PUT /api/agents/:id creates an agent', async () => {
    const res = await fetch(`${BASE}/api/agents/test-coder`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Test Coder',
        model: 'gpt-4o',
        tools: ['file', 'shell'],
      }),
    });
    expect(res.ok).toBe(true);

    // Verify
    const agents = await fetch(`${BASE}/api/agents`).then(r => r.json());
    const found = agents.agents.find((a: any) => a.id === 'test-coder');
    expect(found).toBeDefined();
    expect(found.entry.name).toBe('Test Coder');
  });

  it('POST /api/agents/:id/activate switches agent', async () => {
    const res = await fetch(`${BASE}/api/agents/test-coder/activate`, { method: 'POST' });
    const data = await res.json();
    expect(data.ok).toBe(true);
    expect(data.activeAgent).toBe('test-coder');
  });

  it('GET /api/agents/:id/inspect returns agent info', async () => {
    const res = await fetch(`${BASE}/api/agents/test-coder/inspect`);
    const data = await res.json();
    expect(data.id).toBe('test-coder');
    expect(data.entry.name).toBe('Test Coder');
    // Runtime may or may not be initialized
    expect(data).toHaveProperty('runtime');
  });

  it('DELETE /api/agents/:id removes agent', async () => {
    const res = await fetch(`${BASE}/api/agents/test-coder`, { method: 'DELETE' });
    expect(res.ok).toBe(true);

    const agents = await fetch(`${BASE}/api/agents`).then(r => r.json());
    expect(agents.agents.find((a: any) => a.id === 'test-coder')).toBeUndefined();
  });
});

describe('Session API', () => {
  it('GET /api/sessions returns empty initially', async () => {
    const res = await fetch(`${BASE}/api/sessions`);
    const data = await res.json();
    expect(data).toHaveProperty('sessions');
  });
});

describe('Observe API', () => {
  it('GET /api/observe/cost returns cost data', async () => {
    const res = await fetch(`${BASE}/api/observe/cost`);
    expect(res.ok).toBe(true);
    const data = await res.json();
    expect(data).toHaveProperty('totalCost');
  });

  it('GET /api/observe/cache returns cache data', async () => {
    const res = await fetch(`${BASE}/api/observe/cache`);
    expect(res.ok).toBe(true);
    const data = await res.json();
    expect(data).toHaveProperty('cacheHitRate');
  });

  it('GET /api/observe/tools returns tool stats', async () => {
    const res = await fetch(`${BASE}/api/observe/tools`);
    expect(res.ok).toBe(true);
  });
});
