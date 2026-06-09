import { describe, expect, it } from 'vitest';
import { money, compact, shortModel, sharePct, when } from '../usageFormat';

describe('money', () => {
  it('uses 4dp below a dollar, 2dp at/above', () => {
    expect(money(0.1234)).toBe('$0.1234');
    expect(money(0.99999)).toBe('$1.0000');
    expect(money(12.3456)).toBe('$12.35');
    expect(money(0)).toBe('$0.0000');
  });
});

describe('compact', () => {
  it('abbreviates millions and thousands', () => {
    expect(compact(1_500_000)).toBe('1.50M');
    expect(compact(2_400)).toBe('2.4k');
    expect(compact(999)).toBe('999');
  });
});

describe('shortModel', () => {
  it('strips provider prefix and trailing date stamp', () => {
    expect(shortModel('anthropic/claude-opus-4-20250101')).toBe('claude-opus-4');
    expect(shortModel('gpt-5')).toBe('gpt-5');
    expect(shortModel('zenmux/kimi-k2')).toBe('kimi-k2');
  });
});

describe('sharePct', () => {
  it('computes share, guarding divide-by-zero', () => {
    expect(sharePct(25, 100)).toBe(25);
    expect(sharePct(1, 0)).toBe(0);
  });
});

describe('when', () => {
  it('renders an em-dash for null/0', () => {
    expect(when(null)).toBe('—');
    expect(when(0)).toBe('—');
  });
  it('renders a compact UTC stamp', () => {
    // 2025-03-04T05:06:07Z
    expect(when(Date.UTC(2025, 2, 4, 5, 6, 7))).toBe('3/04 05:06:07');
  });
});
