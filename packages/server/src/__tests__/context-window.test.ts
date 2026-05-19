import { describe, expect, it } from 'vitest';
import type { ModelsRegistry } from '@berry-agent/models';

import { inferContextWindow } from '../engine/context-window.js';

describe('inferContextWindow', () => {
  it('uses model and provider signals instead of always defaulting to 200K', () => {
    const registry: ModelsRegistry = {
      providers: {
        openai: {
          id: 'openai',
          presetId: 'openai',
          type: 'openai',
          baseUrl: 'https://api.openai.com/v1',
          apiKey: 'sk-test',
          knownModels: [],
        },
        anthropic: {
          id: 'anthropic',
          presetId: 'anthropic',
          type: 'anthropic',
          baseUrl: 'https://api.anthropic.com',
          apiKey: 'sk-test',
          knownModels: [],
        },
      },
      models: {
        strong: {
          id: 'strong',
          providers: [{ providerId: 'openai', remoteModelId: 'gpt-5.5' }],
        },
        claude: {
          id: 'claude',
          providers: [{ providerId: 'anthropic', remoteModelId: 'claude-sonnet-4-20250514' }],
        },
      },
      tiers: {
        strong: 'strong',
        balanced: 'claude',
      },
    };

    expect(inferContextWindow('tier:strong', registry)).toBe(100_000);
    expect(inferContextWindow('model:claude', registry)).toBe(200_000);
    expect(inferContextWindow('kimi-k2', registry)).toBe(128_000);
    expect(inferContextWindow('unknown-model', registry)).toBe(200_000);
  });
});
