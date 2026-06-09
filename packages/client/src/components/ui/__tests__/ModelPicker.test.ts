import { describe, expect, it } from 'vitest';
import type { ModelCatalogItem } from '@berry-agent/claw-contracts';
import { catalogToOptions } from '../ModelPicker';
import { modelFamily } from '../../../utils/format';

describe('modelFamily', () => {
  it('classifies Claude family as anthropic', () => {
    expect(modelFamily('claude-opus-4.8')).toBe('anthropic');
    expect(modelFamily('anthropic/claude-sonnet-4.6')).toBe('anthropic');
    expect(modelFamily('opus-4.8')).toBe('anthropic');
    expect(modelFamily('haiku-4.5')).toBe('anthropic');
  });

  it('classifies everything else as openai', () => {
    expect(modelFamily('gpt-5')).toBe('openai');
    expect(modelFamily('kimi-k2')).toBe('openai');
  });

  it('returns undefined for tier aliases and empty', () => {
    expect(modelFamily('tier:balanced')).toBeUndefined();
    expect(modelFamily(undefined)).toBeUndefined();
  });
});

const CATALOG: ModelCatalogItem[] = [
  { model: 'tier:balanced', providerName: 'tier', type: 'tier', family: 'anthropic' },
  { model: 'claude-opus-4.8', providerName: 'zenmux', type: 'model', family: 'anthropic', contextWindow: 1_000_000 },
  { model: 'gpt-5', providerName: 'zenmux', type: 'model', family: 'openai', contextWindow: 400_000 },
];

describe('catalogToOptions', () => {
  it('groups tiers and models, with ctx-window in the description', () => {
    const opts = catalogToOptions(CATALOG);
    expect(opts.find((o) => o.value === 'tier:balanced')?.group).toBe('档位 (tier)');
    const opus = opts.find((o) => o.value === 'claude-opus-4.8');
    expect(opus?.group).toBe('具体模型');
    expect(opus?.description).toContain('1000k ctx');
    expect(opus?.description).toContain('zenmux');
  });

  it('greys out cross-family models when locked', () => {
    const opts = catalogToOptions(CATALOG, 'anthropic');
    expect(opts.find((o) => o.value === 'claude-opus-4.8')?.disabled).toBe(false);
    expect(opts.find((o) => o.value === 'gpt-5')?.disabled).toBe(true);
    // tier alias shares the locked family → stays enabled.
    expect(opts.find((o) => o.value === 'tier:balanced')?.disabled).toBe(false);
  });

  it('does not disable anything when unlocked', () => {
    const opts = catalogToOptions(CATALOG);
    expect(opts.every((o) => !o.disabled)).toBe(true);
  });
});
