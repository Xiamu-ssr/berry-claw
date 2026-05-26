import { describe, expect, it } from 'vitest';
import { zAgentEntry, zContentBlock, zWsOutgoing } from '@berry-agent/claw-contracts';
import { RAW_PRESET_ID } from '@berry-agent/claw-contracts/model-config';
import { RAW_PRESET_ID as SDK_RAW_PRESET_ID } from '@berry-agent/models';

describe('contracts content blocks', () => {
  it('keeps product model constants aligned with SDK models', () => {
    expect(RAW_PRESET_ID).toBe(SDK_RAW_PRESET_ID);
  });

  it('accepts human browser annotation blocks', () => {
    const parsed = zContentBlock.parse({
      type: 'annotation',
      body: 'The title wraps awkwardly at this breakpoint.',
      source: {
        url: 'https://example.test/dashboard',
        title: 'Dashboard',
      },
      rect: { x: 12, y: 24, width: 200, height: 80 },
      viewport: { width: 1280, height: 720 },
      image: {
        data: 'iVBORw0KGgo=',
        mediaType: 'image/png',
        width: 200,
        height: 80,
      },
    });

    expect(parsed.type).toBe('annotation');
    expect(parsed.source.url).toBe('https://example.test/dashboard');
    expect(parsed.image.mediaType).toBe('image/png');
  });

  it('keeps provider/tool blocks out of chat prompt contracts', () => {
    expect(() => zContentBlock.parse({
      type: 'tool_use',
      id: 'toolu_1',
      name: 'shell',
      input: {},
    })).toThrow();
  });

  it('keeps agent registry rows strict and product-owned', () => {
    const parsed = zAgentEntry.parse({
      name: 'Coder',
      model: 'tier:balanced',
      project: '/tmp/project',
      reasoningEffort: 'medium',
      enabledSkills: ['reviewer'],
    });

    expect(parsed.model).toBe('tier:balanced');
    expect(() => zAgentEntry.parse({
      name: 'Coder',
      model: 'tier:balanced',
      lifecycleState: 'running',
    })).toThrow();
  });

  it('validates websocket commands at the contracts boundary', () => {
    expect(zWsOutgoing.parse({
      type: 'chat',
      prompt: [{ type: 'text', text: 'hello' }],
      agentId: 'coder',
    }).type).toBe('chat');

    expect(() => zWsOutgoing.parse({
      type: 'chat',
      prompt: 'hello',
      legacySession: 'old-field',
    })).toThrow();
  });
});
