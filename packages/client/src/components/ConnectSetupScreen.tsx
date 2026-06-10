import { useMemo, useState } from 'react';
import { AlertCircle, CheckCircle2, KeyRound, Loader2, PlugZap, Server } from 'lucide-react';
import {
  addInstance,
  duplicateApiBase,
  normaliseEndpoint,
  setActive,
  wsBaseFromApiBase,
  type Instance,
} from '../connection';
import { DEFAULT_DEV_API_BASE } from '../connection/constants';

/**
 * Full-screen "add your first (or next) connection" form.
 *
 * berry-claw connects to a8s DIRECTLY — no console/BFF, no key handshake. So
 * there are two real inputs:
 *   1. **a8s endpoint** — e.g. `http://host:28789`. We accept sloppy input
 *      (missing scheme, trailing slash) and normalise.
 *   2. **Access token** — the `bp_…` / `bs_…` bearer an operator handed you.
 *
 * On submit:
 *   a. Normalise the endpoint (cheap, sync).
 *   b. Make one real authed call to a8s (`GET /v1/agents`) with the token. This
 *      proves reachability AND that the token is valid in one shot. A 401 means
 *      a bad/expired token; a network error means a bad endpoint.
 *   c. Persist + activate only on success — no half-configured zombies.
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
  const [token, setToken] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Inline, pre-submit validation for the endpoint (cheap, sync). Empty input
  // is neutral (no nag before the user has typed anything).
  const endpointHint = useMemo<Hint>(() => {
    if (!endpoint.trim()) return { kind: 'idle' };
    try {
      return { kind: 'ok', text: `→ ${normaliseEndpoint(endpoint)}` };
    } catch (e) {
      return { kind: 'warn', text: e instanceof Error ? e.message : String(e) };
    }
  }, [endpoint]);

  const tokenHint = useMemo<Hint>(() => {
    const t = token.trim();
    if (!t) return { kind: 'idle' };
    if (t.startsWith('bp_')) return { kind: 'ok', text: 'Product token (sees all of a product\'s agents)' };
    if (t.startsWith('bs_')) return { kind: 'ok', text: 'Subject token (sees one user\'s agents)' };
    return { kind: 'warn', text: 'Expected a bp_… or bs_… token from the operator' };
  }, [token]);

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

    const tok = token.trim();
    if (!tok) {
      setError('Paste the access token the operator gave you.');
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

    // One real authed call to a8s: proves reachability + token validity. We
    // hit /v1/agents (product-scoped) rather than /v1/health (open) so a bad
    // token is caught now, not on the first real request.
    setBusy(true);
    try {
      const res = await fetch(`${apiBase}/v1/agents`, {
        headers: { authorization: `Bearer ${tok}` },
      });
      if (res.status === 401 || res.status === 403) {
        setBusy(false);
        setError('a8s rejected the token (401). Paste a fresh bp_… / bs_… token.');
        return;
      }
      if (!res.ok) {
        setBusy(false);
        setError(`a8s returned ${res.status} ${res.statusText}. Check the endpoint.`);
        return;
      }
    } catch (e) {
      setBusy(false);
      setError(`Could not reach ${apiBase}: ${e instanceof Error ? e.message : String(e)}`);
      return;
    }

    const candidate: Instance = {
      id: dup?.id ?? createClientId(),
      name: name.trim() || new URL(apiBase).hostname || 'a8s',
      apiBase,
      wsBase: wsBaseFromApiBase(apiBase),
      token: tok,
      addedAt: Date.now(),
    };

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
                Point at a 雪山引擎 (a8s) endpoint and paste the access token an
                operator gave you.
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
              placeholder="e.g. my-workspace"
              disabled={busy}
              className="h-10 w-full rounded-lg border border-white/[0.08] bg-[#24282e]/75 px-3 text-sm text-zinc-100 outline-none placeholder:text-zinc-600 transition-colors focus:border-sky-300/45 focus:bg-[#262c33] disabled:opacity-50"
            />
          </label>

          <label className="block">
            <span className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-zinc-500">
              <PlugZap size={13} />
              a8s endpoint
            </span>
            <input
              type="text"
              value={endpoint}
              onChange={(e) => setEndpoint(e.target.value)}
              placeholder={DEFAULT_DEV_API_BASE}
              disabled={busy}
              className="h-10 w-full rounded-lg border border-white/[0.08] bg-[#24282e]/75 px-3 font-mono text-sm text-zinc-100 outline-none placeholder:text-zinc-600 transition-colors focus:border-sky-300/45 focus:bg-[#262c33] disabled:opacity-50"
            />
            <HintLine hint={endpointHint} />
          </label>

          <label className="block">
            <span className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-zinc-500">
              <KeyRound size={13} />
              Access token
            </span>
            <input
              type="password"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder="bp_… or bs_…"
              disabled={busy}
              autoComplete="off"
              spellCheck={false}
              className="h-10 w-full rounded-lg border border-white/[0.08] bg-[#24282e]/75 px-3 font-mono text-sm text-zinc-100 outline-none placeholder:text-zinc-600 transition-colors focus:border-sky-300/45 focus:bg-[#262c33] disabled:opacity-50"
            />
            <HintLine hint={tokenHint} />
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
            disabled={busy || !endpoint.trim() || !token.trim()}
            className="inline-flex h-9 items-center gap-2 rounded-lg bg-sky-200 px-4 text-sm font-medium text-slate-950 shadow-[0_8px_24px_rgba(125,211,252,0.16)] transition-colors hover:bg-sky-100 disabled:opacity-40"
          >
            {busy && <Loader2 size={14} className="animate-spin" />}
            {busy ? 'Connecting' : 'Connect'}
          </button>
        </div>
      </form>
    </div>
  );
}

type Hint =
  | { kind: 'idle' }
  | { kind: 'ok'; text: string }
  | { kind: 'warn'; text: string };

/** Inline validation line under a field. Renders nothing while idle. */
function HintLine({ hint }: { hint: Hint }) {
  if (hint.kind === 'idle') return null;
  const ok = hint.kind === 'ok';
  return (
    <span
      className={
        'mt-1.5 flex items-start gap-1.5 text-[11px] leading-4 ' +
        (ok ? 'text-emerald-300/90' : 'text-amber-300/90')
      }
    >
      {ok ? (
        <CheckCircle2 size={12} className="mt-px flex-shrink-0" />
      ) : (
        <AlertCircle size={12} className="mt-px flex-shrink-0" />
      )}
      <span className="break-words">{hint.text}</span>
    </span>
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
