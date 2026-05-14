/**
 * `ensureToken(instance)` is the single entry point every authenticated
 * request routes through. It:
 *
 *   1. Returns a still-valid cached token if one exists.
 *   2. Otherwise runs POST /api/auth/challenge → sign → POST /api/auth/verify,
 *      caches the result, and hands it back.
 *   3. Dedupes concurrent callers: if two components ask at once we only do
 *      one network round-trip.
 *
 * The flow is deliberately stateless above the `tokenCache` layer — there's no
 * "auth state machine", just a promise that resolves with a token or rejects
 * with a structured error the UI can surface.
 */
import type { Instance } from './types';
import { signChallenge } from './crypto';
import { clearToken, getToken, setToken, type CachedToken } from './tokenCache';

export class AuthFlowError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
  ) {
    super(message);
    this.name = 'AuthFlowError';
  }
}

interface ChallengeResponse {
  nonce: string;
  serverId?: string;
  expiresAt: number;
}

interface VerifyResponse {
  sessionToken: string;
  expiresAt: number;
}

// Per-instance mutex so N parallel `ensureToken` calls collapse to 1 network
// round-trip. Keyed by instance id; the promise is removed once settled.
const inFlight = new Map<string, Promise<CachedToken>>();

export async function ensureToken(instance: Instance): Promise<string> {
  const cached = getToken(instance.id);
  if (cached) return cached.token;

  const existing = inFlight.get(instance.id);
  if (existing) return (await existing).token;

  const promise = runChallenge(instance).finally(() => {
    inFlight.delete(instance.id);
  });
  inFlight.set(instance.id, promise);
  const entry = await promise;
  return entry.token;
}

/**
 * Force a fresh challenge even if the cache is warm. Called from the 401
 * retry path in `apiFetch` — the cached token might technically be inside its
 * TTL but the server already considers it invalid (e.g. after `key reset`).
 */
export async function refreshToken(instance: Instance): Promise<string> {
  clearToken(instance.id);
  return ensureToken(instance);
}

async function runChallenge(instance: Instance): Promise<CachedToken> {
  const challenge = await postJson<ChallengeResponse>(
    `${instance.apiBase}/api/auth/challenge`,
    {},
  );
  if (!challenge.nonce) {
    throw new AuthFlowError('Server returned an empty challenge');
  }

  const signature = await signChallenge(instance.privateKeyPem, challenge.nonce);

  const verified = await postJson<VerifyResponse>(`${instance.apiBase}/api/auth/verify`, {
    nonce: challenge.nonce,
    signature,
  });
  if (!verified.sessionToken || !verified.expiresAt) {
    throw new AuthFlowError('Server returned a malformed verify response');
  }

  const entry: CachedToken = { token: verified.sessionToken, expiresAt: verified.expiresAt };
  setToken(instance.id, entry);
  return entry;
}

async function postJson<T>(url: string, body: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch (err) {
    throw new AuthFlowError(
      `Network error talking to ${url}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new AuthFlowError(
      `Auth request failed (${res.status} ${res.statusText})${text ? `: ${text}` : ''}`,
      res.status,
    );
  }
  try {
    return (await res.json()) as T;
  } catch (err) {
    throw new AuthFlowError(
      `Auth response was not valid JSON: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

/** Test hook — clear the in-flight map without affecting the token cache. */
export function __resetAuthFlowForTests(): void {
  inFlight.clear();
}
