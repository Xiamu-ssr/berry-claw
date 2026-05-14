/**
 * Lightweight probe for `GET /api/auth/instance` — a public endpoint that
 * returns the server's own identity (instanceId, fingerprint, public key).
 *
 * Used by the setup screen to fill in `serverInstanceId` + `fingerprint` on a
 * freshly-added instance without making the user copy them by hand. The
 * endpoint is whitelisted from auth on the server (see server.ts:117), so
 * this can run *before* the challenge/verify round-trip.
 */

export interface ServerIdentity {
  instanceId: string;
  hostname: string;
  fingerprint: string;
  publicKey: string;
}

export async function fetchServerIdentity(apiBase: string): Promise<ServerIdentity> {
  const res = await fetch(`${apiBase}/api/auth/instance`);
  if (!res.ok) {
    throw new Error(`Server returned ${res.status} ${res.statusText}`);
  }
  const body = (await res.json()) as {
    instanceId?: string;
    hostname?: string;
    keyFingerprint?: string;
    publicKey?: string;
  };
  if (!body.instanceId || !body.keyFingerprint) {
    throw new Error('Server identity response missing required fields');
  }
  return {
    instanceId: body.instanceId,
    hostname: body.hostname ?? '',
    fingerprint: body.keyFingerprint,
    publicKey: body.publicKey ?? '',
  };
}
