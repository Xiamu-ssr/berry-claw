import { useMemo, useState } from 'react';
import {
  InvalidPemError,
  addInstance,
  duplicateApiBase,
  duplicateFingerprint,
  ensureToken,
  fetchServerIdentity,
  normaliseEndpoint,
  parseEd25519PrivateKeyPem,
  setActive,
  wsBaseFromApiBase,
  type Instance,
} from '../connection';
import { DEFAULT_DEV_API_BASE } from '../connection/constants';

/**
 * Full-screen "add your first (or next) connection" form.
 *
 * Two real inputs:
 *   1. **Server endpoint** — e.g. `http://localhost:3210`. We accept sloppy
 *      input (missing scheme, trailing slash) and normalise.
 *   2. **Private key PEM** — pasted from `berry-claw key show`.
 *
 * On submit:
 *   a. Parse PEM (cheap, sync). Any format error surfaces before we hit the
 *      network.
 *   b. Probe `/api/auth/instance` (public, unauth) to pin down fingerprint +
 *      server instance id. Doubles as a reachability check.
 *   c. Run one real challenge/verify round-trip. If the server rejects the
 *      key we show the error and **nothing** lands in localStorage — no
 *      half-configured zombies.
 *   d. Persist + activate. The Gate re-renders into the main app.
 *
 * `VITE_API_BASE` can override the development default. The user-entered
 * endpoint always wins.
 *
 * Doubles as the "Add instance" modal body; `onCancel` signals that case.
 */
export function ConnectSetupScreen({
  onCancel,
  title = 'berry-claw · connect',
}: {
  onCancel?: () => void;
  title?: string;
}) {
  const defaultEndpoint = useMemo(() => {
    const api = (import.meta.env.VITE_API_BASE as string | undefined)?.trim();
    return api || DEFAULT_DEV_API_BASE;
  }, []);

  const [name, setName] = useState('');
  const [endpoint, setEndpoint] = useState(defaultEndpoint);
  const [pem, setPem] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const handleSubmit = async (ev: React.FormEvent) => {
    ev.preventDefault();
    setError(null);

    // --- Endpoint normalise (cheap, sync).
    let apiBase: string;
    try {
      apiBase = normaliseEndpoint(endpoint);
    } catch (e) {
      setError(`Invalid endpoint: ${e instanceof Error ? e.message : String(e)}`);
      return;
    }

    // --- PEM parse (cheap, sync).
    try {
      parseEd25519PrivateKeyPem(pem);
    } catch (e) {
      setError(
        e instanceof InvalidPemError
          ? e.message
          : `Invalid private key: ${e instanceof Error ? e.message : String(e)}`,
      );
      return;
    }

    // Warn up-front if the same endpoint already exists — the store would
    // overwrite it silently otherwise.
    const dup = duplicateApiBase(apiBase);
    if (dup) {
      const ok = window.confirm(
        `An instance "${dup.name}" already points at ${apiBase}. Replace it?`,
      );
      if (!ok) return;
    }

    setBusy(true);

    // --- Probe server identity (public endpoint; also proves reachability).
    let identity: Awaited<ReturnType<typeof fetchServerIdentity>>;
    try {
      identity = await fetchServerIdentity(apiBase);
    } catch (e) {
      setBusy(false);
      setError(
        `Could not reach ${apiBase}: ${e instanceof Error ? e.message : String(e)}`,
      );
      return;
    }

    // A second, stricter dedupe: if we already have this server's fingerprint
    // under a *different* apiBase (e.g. user switched from IP to hostname),
    // prefer to overwrite that record too.
    const fpDup = duplicateFingerprint(identity.fingerprint);
    if (fpDup && fpDup.id !== dup?.id) {
      const ok = window.confirm(
        `This server is already known as "${fpDup.name}" (${fpDup.apiBase}). Replace it?`,
      );
      if (!ok) {
        setBusy(false);
        return;
      }
    }

    const derivedName =
      name.trim() ||
      identity.hostname ||
      new URL(apiBase).hostname ||
      'berry-claw';

    const candidate: Instance = {
      id: dup?.id ?? fpDup?.id ?? createClientId(),
      name: derivedName,
      apiBase,
      wsBase: wsBaseFromApiBase(apiBase),
      serverInstanceId: identity.instanceId,
      fingerprint: identity.fingerprint,
      privateKeyPem: pem.trim(),
      addedAt: Date.now(),
    };

    // --- Preflight challenge/verify. If this fails we do NOT persist.
    try {
      await ensureToken(candidate);
    } catch (e) {
      setBusy(false);
      setError(
        `Server rejected the key: ${e instanceof Error ? e.message : String(e)}`,
      );
      return;
    }

    // All clear — persist and activate. The Gate will re-render and hand us
    // off to the real app.
    addInstance(candidate);
    setActive(candidate.id);
    setBusy(false);
  };

  return (
    <div className="fixed inset-0 flex items-center justify-center bg-gray-950 text-gray-100 p-6 overflow-auto">
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-xl rounded-lg border border-gray-800 bg-gray-900 shadow-xl p-6 space-y-4"
      >
        <div>
          <h1 className="text-lg font-semibold">{title}</h1>
          <p className="text-xs text-gray-400 mt-1">
            Point at a berry-claw server and paste the private key from{' '}
            <code className="font-mono bg-gray-800 px-1 py-0.5 rounded">berry-claw key show</code>.
          </p>
        </div>

        <label className="block">
          <span className="block text-xs text-gray-400 mb-1">Name (optional)</span>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. laptop-dev"
            disabled={busy}
            className="w-full px-3 py-2 text-sm rounded bg-gray-800 border border-gray-700 focus:border-gray-500 focus:outline-none text-gray-100"
          />
        </label>

        <label className="block">
          <span className="block text-xs text-gray-400 mb-1">Server endpoint</span>
          <input
            type="text"
            value={endpoint}
            onChange={(e) => setEndpoint(e.target.value)}
            placeholder={DEFAULT_DEV_API_BASE}
            disabled={busy}
            className="w-full px-3 py-2 text-sm font-mono rounded bg-gray-800 border border-gray-700 focus:border-gray-500 focus:outline-none text-gray-100"
          />
        </label>

        <label className="block">
          <span className="block text-xs text-gray-400 mb-1">Private key (PEM)</span>
          <textarea
            value={pem}
            onChange={(e) => setPem(e.target.value)}
            placeholder={'-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----'}
            disabled={busy}
            rows={6}
            className="w-full px-3 py-2 text-xs font-mono rounded bg-gray-800 border border-gray-700 focus:border-gray-500 focus:outline-none text-gray-100"
          />
          <span className="block text-[11px] text-gray-500 mt-1">
            Stored locally in plain text until Electron safeStorage lands — treat this machine as
            trusted.
          </span>
        </label>

        {error && (
          <div className="text-xs text-red-400 bg-red-950/40 border border-red-900/60 rounded px-3 py-2 whitespace-pre-wrap">
            {error}
          </div>
        )}

        <div className="flex justify-end gap-2 pt-2">
          {onCancel && (
            <button
              type="button"
              onClick={onCancel}
              disabled={busy}
              className="px-4 py-2 text-sm rounded bg-gray-800 hover:bg-gray-700 text-gray-200 disabled:opacity-50"
            >
              Cancel
            </button>
          )}
          <button
            type="submit"
            disabled={busy || !endpoint.trim() || !pem.trim()}
            className="px-4 py-2 text-sm rounded bg-emerald-600 hover:bg-emerald-500 text-white disabled:opacity-50"
          >
            {busy ? 'Verifying…' : 'Connect'}
          </button>
        </div>
      </form>
    </div>
  );
}

function createClientId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0'));
  return `${hex.slice(0, 4).join('')}-${hex.slice(4, 6).join('')}-${hex.slice(6, 8).join('')}-${hex.slice(8, 10).join('')}-${hex.slice(10, 16).join('')}`;
}
