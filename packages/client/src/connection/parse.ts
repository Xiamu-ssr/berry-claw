/**
 * Endpoint helpers for the connection setup screen. (The Ed25519 PEM parser
 * that used to live here is gone — berry-claw connects to a8s with a pasted
 * bearer token now, not a signing key.)
 */

/**
 * Normalise whatever the user typed into a clean REST base URL.
 *
 *   "localhost:3210"            → "http://localhost:3210"
 *   "http://host:3210/"         → "http://host:3210"
 *   "https://host.example.com"  → "https://host.example.com"
 *
 * Throws if the input isn't a parseable URL.
 */
export function normaliseEndpoint(raw: string): string {
  const trimmed = raw.trim().replace(/\/+$/, '');
  if (!trimmed) throw new Error('Endpoint is empty');
  // Reject obviously-malformed input *before* `new URL` papers over it: a
  // host with a space ("not a url") would otherwise be percent-encoded into a
  // bogus hostname ("not%20a%20url") and silently accepted, so the inline
  // hint goes green on garbage the server can never resolve.
  if (/\s/.test(trimmed)) throw new Error('Endpoint must not contain spaces');
  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`;
  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    throw new Error('Endpoint is not a valid URL');
  }
  if (!url.hostname) throw new Error('Endpoint has no hostname');
  // A hostname that still carries a percent-escape (or stray escapes leaked in
  // from the raw input) is not a real host — URL() only produces those when
  // the input had illegal host characters. Reject rather than normalise junk.
  if (url.hostname.includes('%')) throw new Error('Endpoint has an invalid hostname');
  // Drop path/query/hash — we only want scheme + host (+ port).
  return `${url.protocol}//${url.host}`;
}

/** Derive ws/wss base from the normalised REST base. */
export function wsBaseFromApiBase(apiBase: string): string {
  return apiBase.replace(/^http/, 'ws');
}
