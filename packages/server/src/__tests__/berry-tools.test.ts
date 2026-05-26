import { describe, expect, it } from 'vitest';

import { createBerryTools } from '../engine/berry-tools.js';

describe('berry host tools', () => {
  const tools = createBerryTools({
    getActiveAgentId: () => 'agent_1',
    getAgentStatus: () => ({ status: 'idle' }),
    currentModel: () => ({ model: 'gpt-4o', providerName: 'openai', type: 'openai' }),
    listAgents: () => [{ id: 'agent_1', entry: { name: 'Agent', model: 'gpt-4o' } }],
    getTiers: () => ({ fast: 'gpt-4o-mini', strong: 'gpt-4o' }),
    listProviderInstances: () => [{
      id: 'provider_1',
      entry: {
        presetId: 'openai',
        type: 'openai',
        label: 'OpenAI',
        baseUrl: 'https://api.openai.com/v1',
        apiKey: 'sk-test-secret',
      },
    }],
    listModels: () => [{ id: 'gpt-4o', entry: { providers: [{ providerId: 'provider_1' }] } }],
    getAgent: () => ({ name: 'Agent', model: 'gpt-4o' }),
    port: 3210,
    startTime: Date.now(),
  });

  it('exposes only read-only host introspection tools', () => {
    expect(tools.map((tool) => tool.definition.name)).toEqual([
      'berry_status',
      'berry_config_get',
    ]);
  });

  it('masks provider keys when reading config', async () => {
    const configGet = tools.find((tool) => tool.definition.name === 'berry_config_get')!;
    const result = await configGet.execute({ scope: 'provider', key: 'provider_1' }, { cwd: '/' });
    expect(result.isError).toBeUndefined();
    expect(result.content).toContain('sk-tes********ret');
    expect(result.content).not.toContain('sk-test-secret');
  });
});
