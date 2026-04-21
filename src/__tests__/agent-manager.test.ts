import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

let testHome: string;
let previousHome: string | undefined;
const scrubbedEnvKeys = ['TAVILY_API_KEY', 'BRAVE_API_KEY', 'SERPAPI_API_KEY'];
const scrubbedEnvSnapshot: Record<string, string | undefined> = {};

beforeEach(async () => {
  testHome = await mkdtemp(join(tmpdir(), 'berry-claw-agent-manager-'));
  previousHome = process.env.HOME;
  process.env.HOME = testHome;
  for (const k of scrubbedEnvKeys) {
    scrubbedEnvSnapshot[k] = process.env[k];
    delete process.env[k];
  }
  vi.resetModules();
});

afterEach(async () => {
  vi.resetModules();
  if (previousHome === undefined) delete process.env.HOME;
  else process.env.HOME = previousHome;
  for (const k of scrubbedEnvKeys) {
    if (scrubbedEnvSnapshot[k] !== undefined) process.env[k] = scrubbedEnvSnapshot[k];
  }
  await rm(testHome, { recursive: true, force: true });
});

async function createManager(agentTools?: string[]) {
  const { AgentManager } = await import('../engine/agent-manager.js');
  const { RAW_PRESET_ID } = await import('@berry-agent/models');
  const manager = new AgentManager();

  // v2 schema: Layer 1 (provider instance) + Layer 2 (model binding).
  manager.config.setProviderInstance('test-provider', {
    id: 'test-provider',
    presetId: RAW_PRESET_ID,
    type: 'openai',
    baseUrl: 'https://test.example/v1',
    apiKey: 'sk-test',
    knownModels: ['gpt-4o'],
  });
  manager.config.setModel('gpt-4o', {
    id: 'gpt-4o',
    providers: [{ providerId: 'test-provider' }],
  });
  manager.config.setAgent('coder', {
    name: 'Coder',
    model: 'gpt-4o',
    ...(agentTools ? { tools: agentTools } : {}),
  });
  manager.config.update({ defaultAgent: 'coder' });
  manager.initAgent('coder');

  return manager;
}

describe('AgentManager tool wiring', () => {
  it('mounts web_fetch, browser, and a graceful web_search stub by default', async () => {
    const manager = await createManager();

    try {
      const runtime = manager.inspectAgent('coder').runtime;
      expect(runtime).not.toBeNull();

      const toolNames = runtime!.tools.map(tool => tool.name);
      expect(toolNames).toContain('web_fetch');
      expect(toolNames).toContain('web_search');
      expect(toolNames).toContain('browser');

      const webSearch = (manager.getAgent('coder') as any).tools.get('web_search');
      const result = await webSearch.execute({ query: 'berry claw' }, { cwd: manager.config.agentWorkspace('coder') });
      expect(result.isError).toBe(true);
      expect(result.content).toMatch(/not configured/i);
    } finally {
      manager.close();
    }
  });

  it('filters mounted tools when entry.tools is set', async () => {
    const manager = await createManager(['file', 'browser']);

    try {
      const runtime = manager.inspectAgent('coder').runtime;
      expect(runtime).not.toBeNull();

      const toolNames = runtime!.tools.map(tool => tool.name);
      expect(toolNames).toContain('read_file');
      expect(toolNames).toContain('write_file');
      expect(toolNames).toContain('list_files');
      expect(toolNames).toContain('edit_file');
      expect(toolNames).toContain('browser');

      expect(toolNames).not.toContain('shell');
      expect(toolNames).not.toContain('grep');
      expect(toolNames).not.toContain('find_files');
      expect(toolNames).not.toContain('web_fetch');
      expect(toolNames).not.toContain('web_search');
    } finally {
      manager.close();
    }
  });
});
