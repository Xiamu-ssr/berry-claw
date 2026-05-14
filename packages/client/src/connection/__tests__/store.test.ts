import { beforeEach, describe, expect, it } from 'vitest';
import {
  addInstance,
  duplicateFingerprint,
  getActiveInstance,
  getInstanceById,
  getInstances,
  removeInstance,
  setActive,
  updateInstance,
  __reloadStoreForTests,
  __resetStoreForTests,
} from '../store';
import { CONNECTION_STORAGE_KEYS, DEFAULT_DEV_API_BASE } from '../constants';
import type { Instance } from '../types';

function makeInstance(overrides: Partial<Instance> = {}): Instance {
  return {
    id: overrides.id ?? crypto.randomUUID(),
    name: overrides.name ?? 'test',
    apiBase: overrides.apiBase ?? DEFAULT_DEV_API_BASE,
    wsBase: overrides.wsBase ?? 'ws://localhost:3210',
    fingerprint: overrides.fingerprint ?? 'SHA256:aaa',
    privateKeyPem: overrides.privateKeyPem ?? '-----BEGIN PRIVATE KEY-----\nX\n-----END PRIVATE KEY-----',
    addedAt: overrides.addedAt ?? Date.now(),
    ...overrides,
  };
}

describe('connection/store', () => {
  beforeEach(() => {
    __resetStoreForTests();
  });

  it('adds the first instance and auto-activates it', () => {
    const a = makeInstance({ name: 'a', fingerprint: 'SHA256:a' });
    addInstance(a);
    expect(getInstances()).toHaveLength(1);
    expect(getActiveInstance()?.id).toBe(a.id);
  });

  it('adds a second instance without switching active', () => {
    const a = makeInstance({ name: 'a', fingerprint: 'SHA256:a' });
    const b = makeInstance({ name: 'b', fingerprint: 'SHA256:b' });
    addInstance(a);
    addInstance(b);
    expect(getInstances()).toHaveLength(2);
    expect(getActiveInstance()?.id).toBe(a.id);
  });

  it('switches active via setActive', () => {
    const a = makeInstance({ fingerprint: 'SHA256:a' });
    const b = makeInstance({ fingerprint: 'SHA256:b' });
    addInstance(a);
    addInstance(b);
    setActive(b.id);
    expect(getActiveInstance()?.id).toBe(b.id);
  });

  it('ignores setActive for unknown id', () => {
    const a = makeInstance({ fingerprint: 'SHA256:a' });
    addInstance(a);
    setActive('ghost');
    expect(getActiveInstance()?.id).toBe(a.id);
  });

  it('rotates active when the active instance is removed', () => {
    const a = makeInstance({ fingerprint: 'SHA256:a' });
    const b = makeInstance({ fingerprint: 'SHA256:b' });
    addInstance(a);
    addInstance(b);
    setActive(b.id);
    removeInstance(b.id);
    expect(getActiveInstance()?.id).toBe(a.id);
  });

  it('clears active when the last instance is removed', () => {
    const a = makeInstance({ fingerprint: 'SHA256:a' });
    addInstance(a);
    removeInstance(a.id);
    expect(getInstances()).toHaveLength(0);
    expect(getActiveInstance()).toBeNull();
  });

  it('dedupes by fingerprint on add', () => {
    const a = makeInstance({ name: 'old', fingerprint: 'SHA256:same' });
    const b = makeInstance({ name: 'new', fingerprint: 'SHA256:same' });
    addInstance(a);
    addInstance(b);
    expect(getInstances()).toHaveLength(1);
    expect(getInstanceById(b.id)?.name).toBe('new');
    // Old record with same fingerprint is gone.
    expect(getInstanceById(a.id)).toBeNull();
    expect(duplicateFingerprint('SHA256:same')?.id).toBe(b.id);
  });

  it('updates in place without changing identity', () => {
    const a = makeInstance({ name: 'a', fingerprint: 'SHA256:a' });
    addInstance(a);
    updateInstance(a.id, { name: 'renamed' });
    expect(getInstanceById(a.id)?.name).toBe('renamed');
  });

  it('persists across reloads via localStorage', () => {
    const a = makeInstance({ name: 'persist', fingerprint: 'SHA256:p' });
    addInstance(a);

    const raw = localStorage.getItem(CONNECTION_STORAGE_KEYS.instances);
    expect(raw).toBeTruthy();
    const parsed = JSON.parse(raw!);
    expect(Array.isArray(parsed) && parsed[0].fingerprint).toBe('SHA256:p');
    expect(localStorage.getItem(CONNECTION_STORAGE_KEYS.activeId)).toBe(a.id);
  });

  it('repairs missing or stale active id from persisted instances', () => {
    const a = makeInstance({ id: 'a', name: 'a', fingerprint: 'SHA256:a' });
    localStorage.setItem(CONNECTION_STORAGE_KEYS.instances, JSON.stringify([a]));
    localStorage.setItem(CONNECTION_STORAGE_KEYS.activeId, 'ghost');

    __reloadStoreForTests();

    expect(getActiveInstance()?.id).toBe('a');
    expect(localStorage.getItem(CONNECTION_STORAGE_KEYS.activeId)).toBe('a');
  });
});
