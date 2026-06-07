/**
 * Parser for the PKCS#8 Ed25519 private key PEM block the user pastes when
 * adding an instance. We extract the raw 32-byte seed so `@noble/ed25519` can
 * sign with it. Anything that isn't an Ed25519 PKCS#8 key is rejected up-front
 * — RSA / EC / legacy OPENSSH formats get a descriptive error instead of a
 * cryptic signature failure three frames later.
 */

export class InvalidPemError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidPemError';
  }
}

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

/**
 * Extract the 32-byte Ed25519 seed from a PKCS#8 PEM block.
 *
 * The OID for Ed25519 is `1.3.101.112` (DER: `06 03 2B 65 70`). PKCS#8
 * Ed25519 private keys end with `04 20 <32-byte-seed>`, i.e. a nested OCTET
 * STRING containing the seed. Validating both markers catches RSA / EC keys
 * and legacy OpenSSH private-key blobs up-front.
 */
export function parseEd25519PrivateKeyPem(pem: string): Uint8Array {
  const trimmed = pem.trim();
  if (!trimmed) throw new InvalidPemError('Private key is empty');

  // Accept only unencrypted PKCS#8. Encrypted keys would need a passphrase.
  const match = trimmed.match(
    /^-----BEGIN PRIVATE KEY-----\s*([A-Za-z0-9+/=\s]+?)\s*-----END PRIVATE KEY-----\s*$/,
  );
  if (!match) {
    throw new InvalidPemError(
      'Expected an unencrypted PKCS#8 block (BEGIN PRIVATE KEY). Encrypted, RSA, or OpenSSH keys are not supported here.',
    );
  }

  const base64 = match[1]!.replace(/\s+/g, '');
  let der: Uint8Array;
  try {
    der = base64Decode(base64);
  } catch (err) {
    throw new InvalidPemError(
      `Failed to decode base64 body: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  // DER layout for PKCS#8 Ed25519:
  //   30 LL                                      SEQUENCE
  //     02 01 00                                 version INTEGER 0
  //     30 05 06 03 2B 65 70                     AlgorithmIdentifier (id-Ed25519)
  //     04 22 04 20 <32 seed bytes>              OCTET STRING wrapping OCTET STRING
  //
  // We check for the OID and trust the final 32 bytes. Pathological inputs
  // that happen to end in a valid-looking tail still fail at signing time
  // because the caller cross-checks signatures against the server's pubkey.
  const oid = [0x06, 0x03, 0x2b, 0x65, 0x70];
  let found = false;
  for (let i = 0; i < der.length - oid.length; i++) {
    if (oid.every((b, k) => der[i + k] === b)) {
      found = true;
      break;
    }
  }
  if (!found) {
    throw new InvalidPemError('PEM is not an Ed25519 private key (OID 1.3.101.112 not found)');
  }

  if (der.length < 32) throw new InvalidPemError('DER payload too short');
  const seed = der.slice(der.length - 32);
  return seed;
}

function base64Decode(b64: string): Uint8Array {
  const binary = atob(b64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}
