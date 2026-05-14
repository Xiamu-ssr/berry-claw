/**
 * In-memory session-token cache, keyed by instance id.
 *
 * Tokens are deliberately *not* persisted — they are short-lived (minutes) and
 * can always be re-derived by replaying the Ed25519 challenge/verify dance.
 * Keeping them RAM-only avoids an extra class of "stale token in localStorage
 * survives key rotation" bugs.
 *
 * A `BroadcastChannel` mirrors updates across tabs so two client windows
 * pointed at the same instance don't each pay for a challenge round-trip. We
 * fall back silently when the API is missing (older Safari, some test envs) —
 * callers just refetch on their own.
 */
export interface CachedToken {
  token: string;
  expiresAt: number; // epoch ms (server-provided)
}

const cache = new Map<string, CachedToken>();

type ChannelMessage =
  | { type: 'set'; instanceId: string; entry: CachedToken }
  | { type: 'clear'; instanceId: string }
  | { type: 'clearAll' };

let channel: BroadcastChannel | null = null;
try {
  if (typeof BroadcastChannel !== 'undefined') {
    channel = new BroadcastChannel('berry-claw-auth');
    channel.onmessage = (ev: MessageEvent<ChannelMessage>) => applyRemote(ev.data);
  }
} catch {
  /* Private-mode Safari etc. — degrade to single-tab. */
}

function applyRemote(msg: ChannelMessage): void {
  if (msg.type === 'set') {
    cache.set(msg.instanceId, msg.entry);
  } else if (msg.type === 'clear') {
    cache.delete(msg.instanceId);
  } else if (msg.type === 'clearAll') {
    cache.clear();
  }
}

function broadcast(msg: ChannelMessage): void {
  try {
    channel?.postMessage(msg);
  } catch {
    /* closed channel, ignore */
  }
}

/**
 * Return the cached token if it's valid for at least the next `skewMs`
 * milliseconds. Default skew of 120 s means we proactively refresh when less
 * than two minutes remain — enough head-room for an in-flight REST call to
 * complete before the server rejects it.
 */
export function getToken(instanceId: string, skewMs = 120_000): CachedToken | null {
  const entry = cache.get(instanceId);
  if (!entry) return null;
  if (Date.now() + skewMs >= entry.expiresAt) {
    cache.delete(instanceId);
    return null;
  }
  return entry;
}

export function setToken(instanceId: string, entry: CachedToken): void {
  cache.set(instanceId, entry);
  broadcast({ type: 'set', instanceId, entry });
}

export function clearToken(instanceId: string): void {
  cache.delete(instanceId);
  broadcast({ type: 'clear', instanceId });
}

export function clearAllTokens(): void {
  cache.clear();
  broadcast({ type: 'clearAll' });
}

/** Test hook — reset without broadcasting. */
export function __resetTokenCacheForTests(): void {
  cache.clear();
}
