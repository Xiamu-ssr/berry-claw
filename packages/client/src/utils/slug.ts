import { genId } from './format';

/**
 * Derive a stable agent id from a human display name. Agent ids are the file
 * identity key — lowercase, `[a-z0-9-_]` only (the same charset AgentEditor
 * enforced when the user typed the id by hand). We slugify the name so users
 * never have to type the id at all; CJK / emoji names that slug to empty fall
 * back to a short random id so the field is never blank.
 */
export function deriveAgentId(name: string): string {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-_\s]/g, '') // drop anything not in the charset (incl. CJK)
    .replace(/\s+/g, '-') // spaces → dashes
    .replace(/-+/g, '-') // collapse runs
    .replace(/^-|-$/g, ''); // trim edge dashes
  if (slug) return slug;
  return `agent-${genId(6).toLowerCase()}`;
}

/**
 * Ensure a candidate id is unique against a set of taken ids by appending
 * `-2`, `-3`, … This lets the wizard auto-derive without ever colliding, while
 * keeping the suffix human-readable (not a random hash).
 */
export function ensureUniqueId(candidate: string, taken: Iterable<string>): string {
  const set = taken instanceof Set ? taken : new Set(taken);
  if (!set.has(candidate)) return candidate;
  for (let n = 2; n < 1000; n++) {
    const next = `${candidate}-${n}`;
    if (!set.has(next)) return next;
  }
  return `${candidate}-${genId(4).toLowerCase()}`;
}
