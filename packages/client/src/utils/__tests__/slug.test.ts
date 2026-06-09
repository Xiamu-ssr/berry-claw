import { describe, expect, it } from 'vitest';
import { deriveAgentId, ensureUniqueId } from '../slug';

describe('deriveAgentId', () => {
  it('slugifies a plain name to the agent-id charset', () => {
    expect(deriveAgentId('My Coder Agent')).toBe('my-coder-agent');
  });

  it('drops out-of-charset characters and collapses dashes', () => {
    expect(deriveAgentId('Front-End  Bot!! 2')).toBe('front-end-bot-2');
  });

  it('trims edge dashes', () => {
    expect(deriveAgentId('  -hello-  ')).toBe('hello');
  });

  it('falls back to a random id for CJK-only names (never blank)', () => {
    const id = deriveAgentId('工程师');
    expect(id).toMatch(/^agent-[a-z0-9]{6}$/);
  });
});

describe('ensureUniqueId', () => {
  it('returns the candidate untouched when free', () => {
    expect(ensureUniqueId('coder', ['planner', 'tester'])).toBe('coder');
  });

  it('appends a readable numeric suffix on collision', () => {
    expect(ensureUniqueId('coder', ['coder'])).toBe('coder-2');
    expect(ensureUniqueId('coder', ['coder', 'coder-2', 'coder-3'])).toBe('coder-4');
  });

  it('accepts a Set', () => {
    expect(ensureUniqueId('a', new Set(['a', 'a-2']))).toBe('a-3');
  });
});
