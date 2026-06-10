import { describe, expect, it } from 'vitest';
import { teamWizardCanAdvance } from '../CreateTeamWizard';

describe('teamWizardCanAdvance', () => {
  it('step 0 needs a name + a derived leader id', () => {
    expect(teamWizardCanAdvance(0, { name: '', leaderId: '', model: '' })).toBe(false);
    expect(teamWizardCanAdvance(0, { name: 'Squad', leaderId: '', model: '' })).toBe(false);
    expect(teamWizardCanAdvance(0, { name: 'Squad', leaderId: 'squad', model: '' })).toBe(true);
  });

  it('step 1 requires a project (unlike an agent, a team must be project-scoped)', () => {
    expect(teamWizardCanAdvance(1, { name: 'S', leaderId: 's', model: '' })).toBe(false);
    expect(teamWizardCanAdvance(1, { name: 'S', leaderId: 's', project: '  ', model: '' })).toBe(false);
    expect(teamWizardCanAdvance(1, { name: 'S', leaderId: 's', project: '/code/x', model: '' })).toBe(true);
  });

  it('step 2 requires a leader model', () => {
    expect(teamWizardCanAdvance(2, { name: 'S', leaderId: 's', project: '/p', model: '' })).toBe(false);
    expect(teamWizardCanAdvance(2, { name: 'S', leaderId: 's', project: '/p', model: 'tier:strong' })).toBe(true);
  });
});
