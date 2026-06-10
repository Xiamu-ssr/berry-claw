import { beforeEach, describe, expect, it } from 'vitest';
import {
  addInstance,
  duplicateApiBase,
  getActiveInstance,
  getInstanceById,
  getInstances,
  removeInstance,
  setActive,
  updateInstance,
  __reloadStoreForTests,
  __resetStoreForTests,
} from '../store';
import { CONNECTION_STORAGE_KEYS } from '../constants';
import type { Instance } from '../types';

let seq = 0;
function makeInstance(overrides: Partial<Instance> = {}): Instance {
  // Distinct apiBase per instance by default so the apiBase-dedupe doesn't
  // collapse unrelated fixtures; callers override apiBase to test dedupe.
  const apiBase = overrides.apiBase ?? `http://localhost:${3210 + seq++}`;
  return {
    id: overrides.id ?? crypto.randomUUID(),
    name: overrides.name ?? 'test',
    apiBase,
    wsBase: overrides.wsBase ?? apiBase.replace(/^http/, 'ws'),
    token: overrides.token ?? 'bp_testtoken',
    addedAt: overrides.addedAt ?? 1,
    ...overrides,
  };
}

describe('connection/store', () => {
  beforeEach(() => {
    __resetStoreForTests();
  });

  it('adds the first instance and auto-activates it', () => {
    const a = makeInstance({ name: 'a' });
    addInstance(a);
    expect(getInstances()).toHaveLength(1);
    expect(getActiveInstance()?.id).toBe(a.id);
  });

  it('adds a second instance without switching active', () => {
    const a = makeInstance({ name: 'a' });
    const b = makeInstance({ name: 'b' });
    addInstance(a);
    addInstance(b);
    expect(getInstances()).toHaveLength(2);
    expect(getActiveInstance()?.id).toBe(a.id);
  });

  it('switches active via setActive', () => {
    const a = makeInstance();
    const b = makeInstance();
    addInstance(a);
    addInstance(b);
    setActive(b.id);
    expect(getActiveInstance()?.id).toBe(b.id);
  });

  it('ignores setActive for unknown id', () => {
    const a = makeInstance();
    addInstance(a);
    setActive('ghost');
    expect(getActiveInstance()?.id).toBe(a.id);
  });

  it('rotates active when the active instance is removed', () => {
    const a = makeInstance();
    const b = makeInstance();
    addInstance(a);
    addInstance(b);
    setActive(b.id);
    removeInstance(b.id);
    expect(getActiveInstance()?.id).toBe(a.id);
  });

  it('clears active when the last instance is removed', () => {
    const a = makeInstance();
    addInstance(a);
    removeInstance(a.id);
    expect(getInstances()).toHaveLength(0);
    expect(getActiveInstance()).toBeNull();
  });

  it('dedupes by apiBase on add (same endpoint replaces the old record)', () => {
    const a = makeInstance({ name: 'old', apiBase: 'http://same:3210' });
    const b = makeInstance({ name: 'new', apiBase: 'http://same:3210' });
    addInstance(a);
    addInstance(b);
    expect(getInstances()).toHaveLength(1);
    expect(getInstanceById(b.id)?.name).toBe('new');
    // Old record with same apiBase is gone.
    expect(getInstanceById(a.id)).toBeNull();
    expect(duplicateApiBase('http://same:3210')?.id).toBe(b.id);
  });

  it('updates in place without changing identity', () => {
    const a = makeInstance({ name: 'a' });
    addInstance(a);
    updateInstance(a.id, { name: 'renamed' });
    expect(getInstanceById(a.id)?.name).toBe('renamed');
  });

  it('persists across reloads via localStorage', () => {
    const a = makeInstance({ name: 'persist', apiBase: 'http://persist:3210', token: 'bp_persist' });
    addInstance(a);

    const raw = localStorage.getItem(CONNECTION_STORAGE_KEYS.instances);
    expect(raw).toBeTruthy();
    const parsed = JSON.parse(raw!);
    expect(Array.isArray(parsed) && parsed[0].token).toBe('bp_persist');
    expect(localStorage.getItem(CONNECTION_STORAGE_KEYS.activeId)).toBe(a.id);
  });

  it('repairs missing or stale active id from persisted instances', () => {
    const a = makeInstance({ id: 'a', name: 'a', apiBase: 'http://repair:3210' });
    localStorage.setItem(CONNECTION_STORAGE_KEYS.instances, JSON.stringify([a]));
    localStorage.setItem(CONNECTION_STORAGE_KEYS.activeId, 'ghost');

    __reloadStoreForTests();

    expect(getActiveInstance()?.id).toBe('a');
    expect(localStorage.getItem(CONNECTION_STORAGE_KEYS.activeId)).toBe('a');
  });
});
