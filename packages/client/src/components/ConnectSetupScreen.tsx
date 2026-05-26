import { useMemo, useState } from 'react';
import { KeyRound, Loader2, PlugZap, Server } from 'lucide-react';
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
    <div className="fixed inset-0 flex items-center justify-center overflow-auto bg-[#17191c] p-4 text-zinc-100 sm:p-6">
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-2xl overflow-hidden rounded-2xl border border-white/[0.08] bg-[#20242a]/90 shadow-[0_24px_80px_rgba(0,0,0,0.28)]"
      >
        <div className="border-b border-white/[0.07] bg-[#1d2126]/85 px-5 py-4">
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl border border-sky-300/25 bg-sky-300/10 text-sky-200">
              <PlugZap size={19} />
            </div>
            <div className="min-w-0">
              <h1 className="text-base font-semibold text-zinc-50">{title}</h1>
              <p className="mt-1 text-sm leading-5 text-zinc-500">
                Point at a berry-claw server and paste the private key from{' '}
                <code className="rounded-md border border-white/[0.08] bg-black/10 px-1.5 py-0.5 font-mono text-[12px] text-zinc-300">
                  berry-claw key show
                </code>
                .
              </p>
            </div>
          </div>
        </div>

        <div className="space-y-4 px-5 py-5">
          <label className="block">
            <span className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-zinc-500">
              <Server size={13} />
              Name (optional)
            </span>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. laptop-dev"
              disabled={busy}
              className="h-10 w-full rounded-lg border border-white/[0.08] bg-[#24282e]/75 px-3 text-sm text-zinc-100 outline-none placeholder:text-zinc-600 transition-colors focus:border-sky-300/45 focus:bg-[#262c33] disabled:opacity-50"
            />
          </label>

          <label className="block">
            <span className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-zinc-500">
              <PlugZap size={13} />
              Server endpoint
            </span>
            <input
              type="text"
              value={endpoint}
              onChange={(e) => setEndpoint(e.target.value)}
              placeholder={DEFAULT_DEV_API_BASE}
              disabled={busy}
              className="h-10 w-full rounded-lg border border-white/[0.08] bg-[#24282e]/75 px-3 font-mono text-sm text-zinc-100 outline-none placeholder:text-zinc-600 transition-colors focus:border-sky-300/45 focus:bg-[#262c33] disabled:opacity-50"
            />
          </label>

          <label className="block">
            <span className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-zinc-500">
              <KeyRound size={13} />
              Private key (PEM)
            </span>
            <textarea
              value={pem}
              onChange={(e) => setPem(e.target.value)}
              placeholder={'-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----'}
              disabled={busy}
              rows={7}
              className="w-full rounded-lg border border-white/[0.08] bg-[#24282e]/75 px-3 py-2 font-mono text-xs leading-5 text-zinc-100 outline-none placeholder:text-zinc-600 transition-colors focus:border-sky-300/45 focus:bg-[#262c33] disabled:opacity-50"
            />
            <span className="mt-1.5 block text-[11px] leading-4 text-zinc-600">
              Stored locally in plain text until Electron safeStorage lands. Treat this
              machine as trusted.
            </span>
          </label>

          {error && (
            <div className="whitespace-pre-wrap rounded-lg border border-rose-300/25 bg-rose-300/10 px-3 py-2 text-xs text-rose-200">
              {error}
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2 border-t border-white/[0.07] bg-black/10 px-5 py-3">
          {onCancel && (
            <button
              type="button"
              onClick={onCancel}
              disabled={busy}
              className="h-9 rounded-lg border border-white/[0.08] bg-white/[0.045] px-4 text-sm text-zinc-300 transition-colors hover:border-sky-200/18 hover:bg-sky-200/[0.07] hover:text-sky-100 disabled:opacity-50"
            >
              Cancel
            </button>
          )}
          <button
            type="submit"
            disabled={busy || !endpoint.trim() || !pem.trim()}
            className="inline-flex h-9 items-center gap-2 rounded-lg bg-sky-200 px-4 text-sm font-medium text-slate-950 shadow-[0_8px_24px_rgba(125,211,252,0.16)] transition-colors hover:bg-sky-100 disabled:opacity-40"
          >
            {busy && <Loader2 size={14} className="animate-spin" />}
            {busy ? 'Verifying' : 'Connect'}
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
