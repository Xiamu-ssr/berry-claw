import { describe, expect, it } from 'vitest';
import { computePickerView, type PickerOption } from '../Picker';

const OPTS: PickerOption[] = [
  { value: 'sonnet', label: 'Claude Sonnet', description: 'anthropic', group: 'tier' },
  { value: 'opus', label: 'Claude Opus', description: 'anthropic', group: 'model' },
  { value: 'gpt', label: 'GPT-5', description: 'openai', group: 'model', disabled: true },
  { value: 'haiku', label: 'Claude Haiku', keywords: 'fast cheap', group: 'tier' },
];

describe('computePickerView', () => {
  it('filters by label / value / description / keywords (case-insensitive)', () => {
    expect(computePickerView(OPTS, 'opus').selectable.map((o) => o.value)).toEqual(['opus']);
    expect(computePickerView(OPTS, 'anthropic').selectable.map((o) => o.value).sort()).toEqual(['opus', 'sonnet']);
    expect(computePickerView(OPTS, 'CHEAP').selectable.map((o) => o.value)).toEqual(['haiku']);
  });

  it('excludes disabled options from the selectable list but still renders them', () => {
    const view = computePickerView(OPTS, '');
    expect(view.selectable.map((o) => o.value)).not.toContain('gpt');
    const gptRow = view.rows.find((r) => r.kind === 'option' && r.option.value === 'gpt');
    expect(gptRow).toBeDefined();
    expect(gptRow && gptRow.kind === 'option' && gptRow.selIndex).toBe(-1);
  });

  it('honors groupOrder for header sequence', () => {
    const view = computePickerView(OPTS, '', ['tier', 'model']);
    const headers = view.rows.filter((r) => r.kind === 'header').map((r) => (r.kind === 'header' ? r.group : ''));
    expect(headers).toEqual(['tier', 'model']);
  });

  it('assigns contiguous selIndex matching selectable order (keyboard nav contract)', () => {
    const view = computePickerView(OPTS, '', ['tier', 'model']);
    const selRows = view.rows.filter((r) => r.kind === 'option' && r.selIndex >= 0);
    selRows.forEach((r, i) => {
      if (r.kind === 'option') expect(r.selIndex).toBe(i);
    });
    expect(view.selectable.length).toBe(3);
  });

  it('returns empty selectable when nothing matches', () => {
    expect(computePickerView(OPTS, 'zzz').selectable).toEqual([]);
  });
});
