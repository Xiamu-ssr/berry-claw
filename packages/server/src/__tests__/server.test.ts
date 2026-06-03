/**
 * Server API unit tests — test REST endpoints without real LLM calls
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PROJECT_CONTEXT_FILE } from '@berry-agent/core';
import {
  zAgentsResponse,
  zConfigResponse,
  zConfigStatusResponse,
  zCredentialsResponse,
  zModelsResponse,
  zPromptBlockUpdateResponse,
  zPromptPacksResponse,
  zProviderPresetsResponse,
  zSafetySnapshot,
  zSessionDetailResponse,
  zSessionsResponse,
  zAgentTeamResponse,
  zTeamsResponse,
  zTeamMessagesResponse,
  zTeamWorklistResponse,
  zSkillSourcesResponse,
  zSkillsInstalledResponse,
} from '@berry-agent/claw-contracts';
import { startServer } from '../server.js';
import { CONFIG_SCHEMA_VERSION } from '../engine/config-manager.js';
import type { AgentManager } from '../engine/agent-manager.js';
import type { Server } from 'node:http';

let server: Server;
let manager: AgentManager;
let testAppDir: string;
const PORT = 43210;  // Use unusual port to avoid conflicts
const BASE = `http://localhost:${PORT}`;

beforeAll(async () => {
  testAppDir = await mkdtemp(join(tmpdir(), 'berry-claw-server-'));
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
      allowAnonymous: true,
    },
  }, null, 2));
  // startServer is async — forgetting the `await` here used to leave
  // `result.server` undefined and every request in this file would
  // ECONNREFUSED. Keep a tiny settle margin for the WS upgrade handlers
  // to finish wiring.
  const result = await startServer(PORT, { appDir: testAppDir });
  server = result.server;
  manager = result.manager;
  await new Promise(resolve => setTimeout(resolve, 50));
});

afterAll(async () => {
  await manager.close();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await rm(testAppDir, { recursive: true, force: true });
});

describe('Config API (v2 schema: provider instances + models + tiers)', () => {
  it('GET /api/config/status returns status shape', async () => {
    const res = await fetch(`${BASE}/api/config/status`);
    expect(res.ok).toBe(true);
    const data = zConfigStatusResponse.parse(await res.json());
    expect(data).toHaveProperty('configured');
    expect(data).toHaveProperty('firstModel');
    expect(data).toHaveProperty('tiers');
  });

  it('GET /api/config/presets returns built-in provider catalog', async () => {
    const res = await fetch(`${BASE}/api/config/presets`);
    const data = zProviderPresetsResponse.parse(await res.json());
    const ids = data.presets.map((p) => p.id);
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
    const data = zConfigResponse.parse(await res.json());
    expect(data.schemaVersion).toBe(CONFIG_SCHEMA_VERSION);
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
        contextWindow: 512000,
        providers: [{ providerId: 'test-provider' }],
      }),
    });
    expect(res.ok).toBe(true);
    const config = await fetch(`${BASE}/api/config`).then(r => r.json());
    expect(config.models['gpt-4o'].contextWindow).toBe(512000);
  });

  it('GET /api/models exposes Layer-2 bindings to the chat switcher', async () => {
    const res = await fetch(`${BASE}/api/models`);
    const data = zModelsResponse.parse(await res.json());
    expect(data.models.some((m) => m.model === 'gpt-4o')).toBe(true);
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
  it('GET /api/prompt-packs follows the shared REST contract', async () => {
    const res = await fetch(`${BASE}/api/prompt-packs`);
    expect(res.ok).toBe(true);
    const data = zPromptPacksResponse.parse(await res.json());
    expect(Array.isArray(data.promptPacks)).toBe(true);
  });

  it('GET /api/credentials follows the shared REST contract', async () => {
    const res = await fetch(`${BASE}/api/credentials`);
    expect(res.ok).toBe(true);
    const data = zCredentialsResponse.parse(await res.json());
    expect(Array.isArray(data.credentials)).toBe(true);
  });

  it('GET /api/agents lists agents', async () => {
    const res = await fetch(`${BASE}/api/agents`);
    const data = zAgentsResponse.parse(await res.json());
    expect(data).toHaveProperty('agents');
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
    const agents = zAgentsResponse.parse(await fetch(`${BASE}/api/agents`).then(r => r.json()));
    const found = agents.agents.find((a) => a.id === 'test-coder');
    expect(found).toBeDefined();
    expect(found.entry.name).toBe('Test Coder');
  });

  // Agent selection is frontend-owned now — there is no backend "activate"
  // endpoint. (Removed with the active-agent cleanup in the thin-BFF rewrite.)

  it('GET /api/agents/:id/inspect returns agent info', async () => {
    const res = await fetch(`${BASE}/api/agents/test-coder/inspect`);
    const data = await res.json();
    expect(data.id).toBe('test-coder');
    expect(data.entry.name).toBe('Test Coder');
    // Runtime may or may not be initialized
    expect(data).toHaveProperty('runtime');
    expect(JSON.stringify(data.runtime)).not.toContain('sk-test-key');
    if (data.runtime?.provider) {
      expect(data.runtime.provider.apiKey).toBeUndefined();
      expect(data.runtime.provider.apiKeyConfigured).toBe(true);
    }
  });

  it('GET/PUT /api/agents/:id/memory and project knowledge use SDK-owned paths', async () => {
    const projectDir = await mkdtemp(join(tmpdir(), 'berry-claw-knowledge-'));
    try {
      await writeFile(join(projectDir, PROJECT_CONTEXT_FILE), '# Shared context\n');
      const create = await fetch(`${BASE}/api/agents/memory-test`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'Memory Test',
          model: 'gpt-4o',
          project: projectDir,
        }),
      });
      expect(create.ok).toBe(true);

      const saved = await fetch(`${BASE}/api/agents/memory-test/memory`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: 'remember this\n' }),
      }).then(r => r.json());
      expect(saved.ok).toBe(true);
      expect(saved.path).toMatch(/MEMORY\.md$/);

      const memory = await fetch(`${BASE}/api/agents/memory-test/memory`).then(r => r.json());
      expect(memory.content).toBe('remember this\n');
      expect(memory.path).toBe(saved.path);

      const knowledge = await fetch(`${BASE}/api/agents/memory-test/project/knowledge`).then(r => r.json());
      expect(knowledge.project).toBe(projectDir);
      expect(knowledge.files).toEqual([{ path: PROJECT_CONTEXT_FILE, content: '# Shared context\n' }]);
    } finally {
      await rm(projectDir, { recursive: true, force: true });
    }
  });

  it('PUT /api/agents/:id/prompt-blocks edits through SDK Agent APIs', async () => {
    const projectDir = await mkdtemp(join(tmpdir(), 'berry-claw-prompt-blocks-'));
    try {
      const create = await fetch(`${BASE}/api/agents/prompt-block-test`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'Prompt Block Test',
          model: 'gpt-4o',
          project: projectDir,
        }),
      });
      expect(create.ok).toBe(true);

      const workspaceBlocks = zPromptBlockUpdateResponse.parse(await fetch(`${BASE}/api/agents/prompt-block-test/prompt-blocks/workspace_agent_md`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: '# Workspace rules\n' }),
      }).then(r => r.json()));
      expect(workspaceBlocks.ok).toBe(true);
      expect(workspaceBlocks.promptBlocks).toEqual(expect.arrayContaining([
        expect.objectContaining({
          id: 'workspace_agent_md',
          text: '# Workspace rules\n',
          active: true,
        }),
      ]));

      const projectBlocks = zPromptBlockUpdateResponse.parse(await fetch(`${BASE}/api/agents/prompt-block-test/prompt-blocks/project_context`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: '# Project rules\n' }),
      }).then(r => r.json()));
      expect(projectBlocks.ok).toBe(true);
      expect(projectBlocks.promptBlocks).toEqual(expect.arrayContaining([
        expect.objectContaining({
          id: 'project_context',
          text: '# Project rules\n',
          active: true,
        }),
      ]));
    } finally {
      await fetch(`${BASE}/api/agents/prompt-block-test`, { method: 'DELETE' }).catch(() => {});
      await rm(projectDir, { recursive: true, force: true });
    }
  });

  it('GET /api/agents/:id/files browses project files read-only and blocks traversal', async () => {
    const projectDir = await mkdtemp(join(tmpdir(), 'berry-claw-project-'));
    try {
      await mkdir(join(projectDir, 'src'));
      await writeFile(join(projectDir, 'src', 'index.ts'), 'export const value = 1;\n');

      const create = await fetch(`${BASE}/api/agents/browser-test`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'Browser Test',
          model: 'gpt-4o',
          project: projectDir,
        }),
      });
      expect(create.ok).toBe(true);

      const list = await fetch(`${BASE}/api/agents/browser-test/files?path=src`).then(r => r.json());
      expect(list.root.kind).toBe('project');
      expect(list.entries).toEqual([
        expect.objectContaining({ name: 'index.ts', path: 'src/index.ts', type: 'file' }),
      ]);

      const content = await fetch(`${BASE}/api/agents/browser-test/files/content?path=src%2Findex.ts`).then(r => r.json());
      expect(content.content).toBe('export const value = 1;\n');

      const escaped = await fetch(`${BASE}/api/agents/browser-test/files?path=..`);
      expect(escaped.status).toBe(400);
    } finally {
      await rm(projectDir, { recursive: true, force: true });
    }
  });

  it('DELETE /api/agents/:id removes agent', async () => {
    const res = await fetch(`${BASE}/api/agents/test-coder`, { method: 'DELETE' });
    expect(res.ok).toBe(true);

    const agents = zAgentsResponse.parse(await fetch(`${BASE}/api/agents`).then(r => r.json()));
    expect(agents.agents.find((a) => a.id === 'test-coder')).toBeUndefined();
  });
});

describe('Skill Market API', () => {
  it('returns shared contract shapes for sources and installed skills', async () => {
    const sources = zSkillSourcesResponse.parse(await fetch(`${BASE}/api/skills/sources`).then(r => r.json()));
    expect(sources.sources.some((source) => source.id === 'clawhub')).toBe(true);

    const installed = zSkillsInstalledResponse.parse(await fetch(`${BASE}/api/skills/installed`).then(r => r.json()));
    expect(Array.isArray(installed.installed)).toBe(true);
  });
});

describe('Safety API', () => {
  it('exposes and updates the auto approval classifier config', async () => {
    await fetch(`${BASE}/api/config/tiers/fast`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ modelId: 'gpt-4o' }),
    });

    const initial = zSafetySnapshot.parse(await fetch(`${BASE}/api/safety`).then(r => r.json()));
    expect(initial.classifier.enabled).toBe(true);
    expect(initial.classifier.model).toBe('tier:fast');
    expect(initial.classifier.configuredModel).toBeNull();

    const patched = await fetch(`${BASE}/api/safety/classifier`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'gpt-4o', enabled: false, skipStage2: true }),
    });
    expect(patched.ok).toBe(true);
    const patchedData = await patched.json();
    expect(patchedData.classifier).toMatchObject({
      model: 'gpt-4o',
      enabled: false,
      skipStage2: true,
    });

    const snapshot = zSafetySnapshot.parse(await fetch(`${BASE}/api/safety`).then(r => r.json()));
    expect(snapshot.classifier).toMatchObject({
      model: 'gpt-4o',
      enabled: false,
      skipStage2: true,
    });
  });
});

describe('Session API', () => {
  it('GET /api/sessions returns empty initially', async () => {
    // agentId is required now (no active-agent fallback).
    await fetch(`${BASE}/api/agents/sess-list-agent`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Sess List', model: 'gpt-4o' }),
    });
    const res = await fetch(`${BASE}/api/sessions?agentId=sess-list-agent`);
    const data = zSessionsResponse.parse(await res.json());
    expect(data).toHaveProperty('sessions');
  });

  it('POST /api/sessions creates a SDK session via REST', async () => {
    await fetch(`${BASE}/api/agents/session-rest-agent`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Session REST Agent', model: 'gpt-4o' }),
    });

    const created = await fetch(`${BASE}/api/sessions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agentId: 'session-rest-agent' }),
    });
    expect(created.status).toBe(201);
    const view = zSessionDetailResponse.parse(await created.json());
    expect(view.id).toMatch(/^ses_/);
    expect(view.agentId).toBe('session-rest-agent');
    expect(view.messages).toEqual([]);

    const listed = zSessionsResponse.parse(await fetch(`${BASE}/api/sessions?agentId=session-rest-agent`).then(r => r.json()));
    expect(listed.sessions.map((s) => s.id)).toContain(view.id);

    const detail = zSessionDetailResponse.parse(
      await fetch(`${BASE}/api/sessions/${view.id}?agentId=session-rest-agent`).then(r => r.json()),
    );
    expect(detail.id).toBe(view.id);
  });

  it('GET /api/facts?kind=session includes SDK session facts', async () => {
    await fetch(`${BASE}/api/agents/session-facts-agent`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Session Facts Agent', model: 'gpt-4o' }),
    });
    const view = await manager.createSession('session-facts-agent');

    const res = await fetch(`${BASE}/api/facts?kind=session`);
    expect(res.ok).toBe(true);
    const data = await res.json();
    expect(data.changes).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'session',
        id: view.id,
        fact: expect.objectContaining({
          id: view.id,
          agentId: 'session-facts-agent',
          status: 'idle',
          messageCount: 0,
        }),
      }),
    ]));
  });
});

describe('Team API', () => {
  it('GET /api/agents/:id/team returns null when no team exists', async () => {
    const res = await fetch(`${BASE}/api/agents/nonexistent/team`);
    expect(res.ok).toBe(true);
    const data = zAgentTeamResponse.parse(await res.json());
    expect(data.team).toBeNull();
  });

  it('POST /api/agents/:id/team/start 400s for agent without project', async () => {
    // Create an agent without a project binding
    await fetch(`${BASE}/api/agents/no-project-leader`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'No Project', model: 'some-model' }),
    });
    const res = await fetch(`${BASE}/api/agents/no-project-leader/team/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toMatch(/no project/i);
  });

  it('GET /api/facts?kind=team includes cold-boot rehydrated teams', async () => {
    const project = await mkdtemp(join(tmpdir(), 'berry-claw-team-facts-'));
    try {
      await fetch(`${BASE}/api/agents/team-facts-leader`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'Team Facts Leader',
          model: 'gpt-4o',
          project,
        }),
      });
      const started = await fetch(`${BASE}/api/agents/team-facts-leader/team/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: '事实源团队' }),
      });
      expect(started.ok).toBe(true);

      const facts = await fetch(`${BASE}/api/facts?kind=team`).then(r => r.json());
      const teams = zTeamsResponse.parse(await fetch(`${BASE}/api/teams`).then(r => r.json()));
      const team = zAgentTeamResponse.parse(await fetch(`${BASE}/api/agents/team-facts-leader/team`).then(r => r.json()));
      const messages = zTeamMessagesResponse.parse(await fetch(`${BASE}/api/agents/team-facts-leader/team/messages`).then(r => r.json()));
      const worklist = zTeamWorklistResponse.parse(await fetch(`${BASE}/api/agents/team-facts-leader/team/worklist`).then(r => r.json()));

      expect(teams.teams.some((team) => team.leaderId === 'team-facts-leader')).toBe(true);
      expect(team.team?.leaderId).toBe('team-facts-leader');
      expect(messages.messages).toEqual([]);
      expect(worklist.tasks).toEqual([]);
      expect(facts.changes.some((c: any) => c.kind === 'team' && c.id === 'team-facts-leader')).toBe(true);
    } finally {
      await fetch(`${BASE}/api/agents/team-facts-leader/team`, { method: 'DELETE' }).catch(() => {});
      await fetch(`${BASE}/api/agents/team-facts-leader`, { method: 'DELETE' }).catch(() => {});
      await rm(project, { recursive: true, force: true });
    }
  });

  it('GET /api/agents/:id/team/messages 404s when no team exists', async () => {
    const res = await fetch(`${BASE}/api/agents/nonexistent/team/messages`);
    expect(res.status).toBe(404);
  });

  it('GET /api/agents/:id/team/worklist 404s when no team exists', async () => {
    const res = await fetch(`${BASE}/api/agents/nonexistent/team/worklist`);
    expect(res.status).toBe(404);
  });

  it('DELETE /api/agents/:id/team 400s when no team exists', async () => {
    const res = await fetch(`${BASE}/api/agents/nonexistent/team`, { method: 'DELETE' });
    expect(res.status).toBe(400);
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
