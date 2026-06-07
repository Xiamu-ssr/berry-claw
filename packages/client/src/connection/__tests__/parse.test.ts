import { describe, expect, it } from 'vitest';
import {
  InvalidPemError,
  normaliseEndpoint,
  parseEd25519PrivateKeyPem,
  wsBaseFromApiBase,
} from '../parse';

// A valid, deterministic PKCS#8 Ed25519 key generated once with
// `openssl genpkey -algorithm ed25519` and kept here as the canonical fixture.
const VALID_PEM = `-----BEGIN PRIVATE KEY-----
MC4CAQAwBQYDK2VwBCIEINTuctv5E1hK1bbY8fdp+K06/nwoy/HU++CXqI9EdVhC
-----END PRIVATE KEY-----`;

// Mismatched algorithm — RSA PKCS#8 wrapper (truncated body); should fail at OID check.
const RSA_PEM = `-----BEGIN PRIVATE KEY-----
MIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQC7VJTUt9Us8cKj
-----END PRIVATE KEY-----`;

describe('normaliseEndpoint', () => {
  it('adds http:// when scheme is missing', () => {
    expect(normaliseEndpoint('localhost:3210')).toBe('http://localhost:3210');
  });

  it('keeps http/https as given', () => {
    expect(normaliseEndpoint('http://host:3210')).toBe('http://host:3210');
    expect(normaliseEndpoint('https://host.example.com')).toBe('https://host.example.com');
  });

  it('trims trailing slashes and drops path/query', () => {
    expect(normaliseEndpoint('http://host:3210/')).toBe('http://host:3210');
    expect(normaliseEndpoint('http://host:3210/api?x=1')).toBe('http://host:3210');
  });

  it('throws on empty input', () => {
    expect(() => normaliseEndpoint('')).toThrow();
  });

  it('rejects input with spaces instead of silently encoding it', () => {
    // Regression: "not a url" used to be coerced into "http://not%20a%20url"
    // and accepted, turning the inline hint green on an unresolvable host.
    expect(() => normaliseEndpoint('not a url')).toThrow(/space/i);
    expect(() => normaliseEndpoint('http://has space:3210')).toThrow(/space/i);
  });
});

describe('wsBaseFromApiBase', () => {
  it('maps http → ws', () => {
    expect(wsBaseFromApiBase('http://localhost:3210')).toBe('ws://localhost:3210');
  });

  it('maps https → wss', () => {
    expect(wsBaseFromApiBase('https://host.example.com')).toBe('wss://host.example.com');
  });
});

describe('parseEd25519PrivateKeyPem', () => {
  it('extracts the 32-byte seed from a valid Ed25519 PKCS#8 PEM', () => {
    const seed = parseEd25519PrivateKeyPem(VALID_PEM);
    expect(seed).toBeInstanceOf(Uint8Array);
    expect(seed.length).toBe(32);
  });

  it('tolerates leading/trailing whitespace around the PEM block', () => {
    const seed = parseEd25519PrivateKeyPem(`\n\n  ${VALID_PEM}  \n`);
    expect(seed.length).toBe(32);
  });

  it('rejects empty input', () => {
    expect(() => parseEd25519PrivateKeyPem('')).toThrow(InvalidPemError);
  });

  it('rejects non-PKCS#8 header (OPENSSH / encrypted)', () => {
    expect(() =>
      parseEd25519PrivateKeyPem(
        '-----BEGIN OPENSSH PRIVATE KEY-----\nAAAA\n-----END OPENSSH PRIVATE KEY-----',
      ),
    ).toThrow(/PKCS#8/);
  });

  it('rejects RSA keys (OID mismatch)', () => {
    expect(() => parseEd25519PrivateKeyPem(RSA_PEM)).toThrow(/Ed25519/);
  });
});
