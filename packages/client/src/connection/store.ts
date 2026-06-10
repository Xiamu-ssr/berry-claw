import { useSyncExternalStore } from 'react';
import { zInstanceList, type Instance } from './types';
import { CONNECTION_STORAGE_KEYS } from './constants';

/**
 * Connection store — persists the known `Instance[]` in localStorage and
 * exposes a `useSyncExternalStore`-friendly subscription model so both the
 * Gate and the Settings tab see updates instantly without prop drilling.
 *
 * Design notes:
 *  - All public mutators (`addInstance`, `updateInstance`, …) write to
 *    localStorage first, then bump an in-memory snapshot counter so React
 *    knows to re-render. Reads always go through the cached snapshot to keep
 *    `useSyncExternalStore` referentially stable.
 *  - Deletion of the active instance auto-rotates to the next one (or clears
 *    active), so the caller never ends up in a "has instances but none
 *    active" limbo.
 *  - We swallow storage errors (QuotaExceeded / private mode) into a module-
 *    level `storageError` that UI layers can surface — CRUD calls still
 *    succeed against the in-memory snapshot so the user can keep working for
 *    one session.
 */

interface Snapshot {
  instances: Instance[];
  activeId: string | null;
}

type Listener = () => void;

let snapshot: Snapshot = loadFromStorage();
let storageError: string | null = null;
const listeners = new Set<Listener>();

function loadFromStorage(): Snapshot {
  if (typeof localStorage === 'undefined') {
    return { instances: [], activeId: null };
  }
  try {
    const rawInstances = localStorage.getItem(CONNECTION_STORAGE_KEYS.instances);
    const rawActive = localStorage.getItem(CONNECTION_STORAGE_KEYS.activeId);
    const parsed = rawInstances ? JSON.parse(rawInstances) : [];
    const instances = zInstanceList.safeParse(parsed);
    if (!instances.success || instances.data.length === 0) {
      return { instances: [], activeId: null };
    }

    const activeId = instances.data.some((i) => i.id === rawActive)
      ? rawActive
      : instances.data[0]?.id ?? null;
    if (activeId !== rawActive) {
      persistStorageOnly({ instances: instances.data, activeId });
    }

    return {
      instances: instances.data,
      activeId,
    };
  } catch (err) {
    console.warn('[connection/store] failed to load from localStorage:', err);
    return { instances: [], activeId: null };
  }
}

function persistStorageOnly(next: Snapshot): void {
  localStorage.setItem(CONNECTION_STORAGE_KEYS.instances, JSON.stringify(next.instances));
  if (next.activeId) {
    localStorage.setItem(CONNECTION_STORAGE_KEYS.activeId, next.activeId);
  } else {
    localStorage.removeItem(CONNECTION_STORAGE_KEYS.activeId);
  }
}

function persist(next: Snapshot): void {
  snapshot = next;
  try {
    persistStorageOnly(next);
    storageError = null;
  } catch (err) {
    storageError = err instanceof Error ? err.message : String(err);
    console.error('[connection/store] localStorage write failed:', err);
  }
  emit();
}

function emit(): void {
  for (const l of listeners) l();
}

function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getSnapshot(): Snapshot {
  return snapshot;
}

// ---------- Public API ----------

export function getInstances(): Instance[] {
  return snapshot.instances;
}

export function getActiveId(): string | null {
  return snapshot.activeId;
}

export function getActiveInstance(): Instance | null {
  const id = snapshot.activeId;
  if (!id) return null;
  return snapshot.instances.find((i) => i.id === id) ?? null;
}

export function getInstanceById(id: string): Instance | null {
  return snapshot.instances.find((i) => i.id === id) ?? null;
}

export function getStorageError(): string | null {
  return storageError;
}

export function addInstance(instance: Instance): void {
  // Dedupe by apiBase (same a8s endpoint = assume same target). Callers can
  // show a confirm dialog *before* this point if they want to warn.
  const filtered = snapshot.instances.filter((i) => i.apiBase !== instance.apiBase);
  const nextInstances = [...filtered, instance];
  persist({
    instances: nextInstances,
    // First instance added → auto-activate. Otherwise preserve whatever was
    // active, unless that active id was purged by the apiBase dedupe above, in
    // which case activate the fresh record.
    activeId:
      snapshot.activeId && nextInstances.some((i) => i.id === snapshot.activeId)
        ? snapshot.activeId
        : instance.id,
  });
}

export function updateInstance(id: string, patch: Partial<Instance>): void {
  const instances = snapshot.instances.map((i) => (i.id === id ? { ...i, ...patch } : i));
  persist({ ...snapshot, instances });
}

export function removeInstance(id: string): void {
  const instances = snapshot.instances.filter((i) => i.id !== id);
  let activeId = snapshot.activeId;
  if (activeId === id) {
    activeId = instances[0]?.id ?? null;
  }
  persist({ instances, activeId });
}

export function setActive(id: string | null): void {
  if (id && !snapshot.instances.some((i) => i.id === id)) {
    console.warn(`[connection/store] setActive ignored: unknown id ${id}`);
    return;
  }
  persist({ ...snapshot, activeId: id });
}

export function duplicateApiBase(apiBase: string): Instance | null {
  return snapshot.instances.find((i) => i.apiBase === apiBase) ?? null;
}

// ---------- React hooks ----------

export function useInstances(): Instance[] {
  return useSyncExternalStore(
    subscribe,
    () => getSnapshot().instances,
    () => getSnapshot().instances,
  );
}

export function useActiveInstance(): Instance | null {
  return useSyncExternalStore(
    subscribe,
    () => {
      const s = getSnapshot();
      const id = s.activeId;
      return id ? s.instances.find((i) => i.id === id) ?? null : null;
    },
    () => null,
  );
}

export function useActiveInstanceId(): string | null {
  return useSyncExternalStore(
    subscribe,
    () => getSnapshot().activeId,
    () => null,
  );
}

// ---------- Testing hooks (not re-exported via index.ts) ----------

/** Reset the in-memory + localStorage snapshot. Intended for unit tests only. */
export function __resetStoreForTests(): void {
  snapshot = { instances: [], activeId: null };
  try {
    localStorage.removeItem(CONNECTION_STORAGE_KEYS.instances);
    localStorage.removeItem(CONNECTION_STORAGE_KEYS.activeId);
  } catch {
    /* ignore */
  }
  storageError = null;
  emit();
}

export function __reloadStoreForTests(): void {
  snapshot = loadFromStorage();
  storageError = null;
  emit();
}
