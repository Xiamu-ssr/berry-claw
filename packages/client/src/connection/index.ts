/**
 * Public surface of the connection module. Components should import from this
 * barrel, not from the individual files, so internals (like the test hooks
 * or the BroadcastChannel plumbing) stay sealed off.
 */

export type { Instance, InstanceList } from './types';

export {
  // Read / subscribe
  getInstances,
  getActiveId,
  getActiveInstance,
  getInstanceById,
  getStorageError,
  duplicateApiBase,
  // Mutate
  addInstance,
  updateInstance,
  removeInstance,
  setActive,
  // React hooks
  useInstances,
  useActiveInstance,
  useActiveInstanceId,
} from './store';

export { normaliseEndpoint, wsBaseFromApiBase } from './parse';
