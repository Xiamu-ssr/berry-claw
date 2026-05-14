import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthFlowError, ensureToken, refreshToken, __resetAuthFlowForTests } from '../authFlow';
import { __resetTokenCacheForTests, getToken, setToken } from '../tokenCache';
import type { Instance } from '../types';

// We mock crypto.signChallenge to avoid pulling in a real PKCS#8 fixture —
// the auth flow's job is to orchestrate HTTP + caching, not to re-test signing.
vi.mock('../crypto', () => ({
  signChallenge: vi.fn(async (_pem: string, nonce: string) => `sig-of-${nonce}`),
  signChallengeSync: vi.fn(() => ''),
}));

function makeInstance(id = 'i1'): Instance {
  return {
    id,
    name: 'test',
    apiBase: 'http://localhost:3210',
    wsBase: 'ws://localhost:3210',
    fingerprint: 'SHA256:abc',
    privateKeyPem: '-----BEGIN PRIVATE KEY-----\nX\n-----END PRIVATE KEY-----',
    addedAt: 0,
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('connection/authFlow', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    __resetTokenCacheForTests();
    __resetAuthFlowForTests();
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('runs challenge → verify on a cold cache', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ nonce: 'N1', expiresAt: Date.now() + 60_000 }))
      .mockResolvedValueOnce(
        jsonResponse({ sessionToken: 'T1', expiresAt: Date.now() + 600_000 }),
      );

    const token = await ensureToken(makeInstance());
    expect(token).toBe('T1');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0]![0]).toContain('/api/auth/challenge');
    expect(fetchMock.mock.calls[1]![0]).toContain('/api/auth/verify');

    // Verify payload carried the signed nonce.
    const verifyInit = fetchMock.mock.calls[1]![1] as RequestInit;
    expect(JSON.parse(verifyInit.body as string)).toEqual({ nonce: 'N1', signature: 'sig-of-N1' });
  });

  it('returns cached token without hitting the network', async () => {
    setToken('i1', { token: 'CACHED', expiresAt: Date.now() + 10 * 60_000 });
    const token = await ensureToken(makeInstance());
    expect(token).toBe('CACHED');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('treats a near-expiry token as stale (skew window)', async () => {
    // 30 seconds left, default skew is 120 s → should refresh.
    setToken('i1', { token: 'STALE', expiresAt: Date.now() + 30_000 });
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ nonce: 'N2', expiresAt: Date.now() + 60_000 }))
      .mockResolvedValueOnce(
        jsonResponse({ sessionToken: 'FRESH', expiresAt: Date.now() + 600_000 }),
      );
    const token = await ensureToken(makeInstance());
    expect(token).toBe('FRESH');
  });

  it('dedupes concurrent ensureToken calls into a single round-trip', async () => {
    let resolveChallenge!: (v: Response) => void;
    const challengePromise = new Promise<Response>((r) => (resolveChallenge = r));
    fetchMock.mockReturnValueOnce(challengePromise).mockResolvedValueOnce(
      jsonResponse({ sessionToken: 'ONE', expiresAt: Date.now() + 600_000 }),
    );

    const a = ensureToken(makeInstance());
    const b = ensureToken(makeInstance());
    const c = ensureToken(makeInstance());

    resolveChallenge(jsonResponse({ nonce: 'N', expiresAt: Date.now() + 60_000 }));

    const [ta, tb, tc] = await Promise.all([a, b, c]);
    expect(ta).toBe('ONE');
    expect(tb).toBe('ONE');
    expect(tc).toBe('ONE');
    // Only one challenge + one verify — not three of each.
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('surfaces a 403 challenge failure as AuthFlowError with status', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response('forbidden', { status: 403, statusText: 'Forbidden' }),
    );
    await expect(ensureToken(makeInstance())).rejects.toMatchObject({
      name: 'AuthFlowError',
      status: 403,
    });
  });

  it('refreshToken drops the cached entry and re-runs the flow', async () => {
    setToken('i1', { token: 'OLD', expiresAt: Date.now() + 10 * 60_000 });
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ nonce: 'N3', expiresAt: Date.now() + 60_000 }))
      .mockResolvedValueOnce(
        jsonResponse({ sessionToken: 'NEW', expiresAt: Date.now() + 600_000 }),
      );

    const token = await refreshToken(makeInstance());
    expect(token).toBe('NEW');
    expect(getToken('i1')?.token).toBe('NEW');
  });

  it('wraps network errors in AuthFlowError', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('failed to fetch'));
    await expect(ensureToken(makeInstance())).rejects.toBeInstanceOf(AuthFlowError);
  });

  it('fails when verify returns no token', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ nonce: 'N4', expiresAt: Date.now() + 60_000 }))
      .mockResolvedValueOnce(jsonResponse({ sessionToken: '', expiresAt: 0 }));
    await expect(ensureToken(makeInstance())).rejects.toThrow(/malformed/);
  });
});
