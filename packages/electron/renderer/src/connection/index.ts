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
  duplicateFingerprint,
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

export {
  parseEd25519PrivateKeyPem,
  normaliseEndpoint,
  wsBaseFromApiBase,
  InvalidPemError,
} from './parse';

export { fetchServerIdentity, type ServerIdentity } from './identity';

export { signChallenge, signChallengeSync } from './crypto';

export { ensureToken, refreshToken, AuthFlowError } from './authFlow';

export { getToken, clearToken, clearAllTokens, type CachedToken } from './tokenCache';
