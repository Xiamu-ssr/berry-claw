/**
 * a8sConnection — fetch + cache the control-plane connection for an instance.
 *
 * berry-claw is a thin console: the browser talks to a8s directly, but it
 * doesn't hold the a8s token — the console (BFF) does, and only releases it to
 * a session that passed Ed25519 challenge/verify. So the flow is:
 *
 *   ensureToken(instance)            → claw session token (existing auth flow)
 *   GET /api/auth/a8s (with token)   → { url, token } for the control plane
 *
 * We cache the {url, token} per instance in RAM (like tokenCache — never
 * persisted) and re-fetch on demand. The a8s token is longer-lived than the
 * claw session token, but we tie its lifecycle to the instance so switching
 * instances or clearing auth drops it too.
 */
import type { Instance } from './types';
import { ensureToken, refreshToken, AuthFlowError } from './authFlow';
import type { A8sConnectionInfo } from '@berry-agent/claw-contracts/auth';

const cache = new Map<string, A8sConnectionInfo>();
const inFlight = new Map<string, Promise<A8sConnectionInfo>>();

/**
 * Resolve the a8s connection for an instance, fetching it through the console's
 * auth bridge if not cached. Dedupes concurrent callers per instance.
 */
export async function getA8sConnection(instance: Instance): Promise<A8sConnectionInfo> {
  const cached = cache.get(instance.id);
  if (cached) return cached;

  const existing = inFlight.get(instance.id);
  if (existing) return existing;

  const promise = fetchA8sConnection(instance).finally(() => {
    inFlight.delete(instance.id);
  });
  inFlight.set(instance.id, promise);
  return promise;
}

/** Drop the cached a8s connection for an instance (e.g. on auth reset). */
export function clearA8sConnection(instanceId: string): void {
  cache.delete(instanceId);
}

async function fetchA8sConnection(instance: Instance): Promise<A8sConnectionInfo> {
  const token = await ensureToken(instance);
  let res = await rawFetch(instance, token);
  if (res.status === 401) {
    // Session token rotated out under us — replay challenge/verify once.
    const fresh = await refreshToken(instance);
    res = await rawFetch(instance, fresh);
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new AuthFlowError(
      `Could not get a8s connection from console (${res.status})${text ? `: ${text}` : ''}`,
      res.status,
    );
  }
  const body = (await res.json()) as A8sConnectionInfo;
  if (!body.url || !body.token) {
    throw new AuthFlowError('Console returned a malformed a8s connection');
  }
  cache.set(instance.id, body);
  return body;
}

function rawFetch(instance: Instance, token: string): Promise<Response> {
  return fetch(`${instance.apiBase}/api/auth/a8s`, {
    headers: { Authorization: `Bearer ${token}` },
  });
}

/** Test hook — reset both caches. */
export function __resetA8sConnectionForTests(): void {
  cache.clear();
  inFlight.clear();
}
