import { describe, expect, it } from 'vitest';
import { normaliseEndpoint, wsBaseFromApiBase } from '../parse';

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
