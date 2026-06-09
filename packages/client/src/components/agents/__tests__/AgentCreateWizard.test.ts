import { describe, expect, it } from 'vitest';
import { wizardCanAdvance } from '../AgentCreateWizard';

describe('wizardCanAdvance', () => {
  it('step 0 (identity) requires a non-blank name and a derived id', () => {
    expect(wizardCanAdvance(0, { name: '', derivedId: '', model: '' })).toBe(false);
    expect(wizardCanAdvance(0, { name: '   ', derivedId: 'x', model: '' })).toBe(false);
    expect(wizardCanAdvance(0, { name: 'Coder', derivedId: 'coder', model: '' })).toBe(true);
  });

  it('step 1 (model) requires a model selection', () => {
    expect(wizardCanAdvance(1, { name: 'Coder', derivedId: 'coder', model: '' })).toBe(false);
    expect(wizardCanAdvance(1, { name: 'Coder', derivedId: 'coder', model: 'tier:balanced' })).toBe(true);
  });

  it('step 2 (project/reasoning) is always free — all optional', () => {
    expect(wizardCanAdvance(2, { name: '', derivedId: '', model: '' })).toBe(true);
  });
});
