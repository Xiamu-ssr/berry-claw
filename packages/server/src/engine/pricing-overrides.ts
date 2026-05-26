import type { ModelPricing } from '@berry-agent/observe';

export function createDefaultPricingOverrides(): Record<string, ModelPricing> {
  const sonnet4: ModelPricing = { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 };
  const haiku4: ModelPricing = { input: 0.8, output: 4, cacheRead: 0.08, cacheWrite: 1 };
  const opus4: ModelPricing = { input: 15, output: 75, cacheRead: 1.5, cacheWrite: 18.75 };
  return {
    'anthropic/claude-sonnet-4-20250514': sonnet4,
    'anthropic/claude-sonnet-4.6': sonnet4,
    'anthropic/claude-haiku-4-20250414': haiku4,
    'anthropic/claude-haiku-4.5': haiku4,
    'anthropic/claude-opus-4-20250514': opus4,
    'anthropic/claude-opus-4.6': opus4,
  };
}
