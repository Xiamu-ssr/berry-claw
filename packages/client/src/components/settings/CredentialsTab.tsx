import { useCallback, useEffect, useState } from 'react';
import { Check, ExternalLink, Key, Trash2 } from 'lucide-react';
import type { CredentialItem } from '@berry-agent/claw-contracts';
import { API, apiFetch } from '../../api/paths';
import { showToast } from '../Toast';

export default function CredentialsTab() {
  const [items, setItems] = useState<CredentialItem[]>([]);
  const [values, setValues] = useState<Record<string, string>>({});

  const refresh = useCallback(async () => {
    const res = await apiFetch(API.credentials);
    const data = await res.json();
    setItems(data.credentials ?? []);
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const save = async (key: string) => {
    const value = (values[key] ?? '').trim();
    if (!value) return;
    const res = await apiFetch(API.credential(key), {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ value }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'save failed' }));
      showToast(err.error ?? 'Save failed', 'error');
      return;
    }
    showToast('Credential saved');
    setValues(prev => ({ ...prev, [key]: '' }));
    refresh();
  };

  const remove = async (key: string) => {
    if (!confirm(`Remove credential "${key}"?`)) return;
    await apiFetch(API.credential(key), { method: 'DELETE' });
    showToast('Credential removed');
    refresh();
  };

  return (
    <section className="rounded-xl border border-white/[0.08] bg-[#20242a]/75 p-5">
      <div className="mb-5">
        <h2 className="text-lg font-semibold text-zinc-100 flex items-center gap-2">
          <Key size={20} /> Tool Credentials
        </h2>
        <p className="text-sm text-zinc-500 mt-1">
          Shared secrets for built-in tools (web_search, etc). Separate from provider apiKeys.
        </p>
      </div>
      {items.length === 0 && <p className="text-sm text-gray-400 italic">No known credentials.</p>}
      <div className="space-y-3">
        {items.map(item => {
          const draft = (values[item.key] ?? '').trim();
          const dirty = draft.length > 0;
          const displayValue = values[item.key] ?? (item.configured ? configuredCredentialLabel(item.source) : '');
          return (
            <div key={item.key} className="rounded-lg border border-white/[0.08] p-4">
              <div className="flex items-center justify-between gap-3 mb-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-mono font-medium text-gray-800 dark:text-gray-200">{item.key}</span>
                    <span className="text-xs px-2 py-0.5 rounded-full bg-gray-100 bg-white/[0.06] text-zinc-400">{item.provider}</span>
                    {item.configured ? (
                      <span className="text-xs px-2 py-0.5 rounded-full bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-300 flex items-center gap-1">
                        <Check size={11} /> {item.source === 'env' ? 'env' : 'saved'}
                      </span>
                    ) : (
                      <span className="text-xs px-2 py-0.5 rounded-full bg-gray-100 bg-white/[0.06]/50 text-zinc-600">
                        not set
                      </span>
                    )}
                  </div>
                  {item.url && (
                    <a
                      href={item.url}
                      target="_blank"
                      rel="noreferrer"
                      className="text-xs text-[var(--theme-primary)] hover:underline inline-flex items-center gap-1 mt-1.5 px-2 py-0.5 rounded bg-[var(--theme-primary-soft)]"
                    >
                      Get key <ExternalLink size={11} />
                    </a>
                  )}
                </div>
                {item.configured && item.source !== 'env' && (
                  <button
                    onClick={() => remove(item.key)}
                    title="Remove credential"
                    className="p-1.5 rounded-md text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
                  >
                    <Trash2 size={14} />
                  </button>
                )}
              </div>
              <div className="flex gap-2">
                <input
                  className="settings-input flex-1"
                  type={dirty ? 'password' : 'text'}
                  placeholder={item.configured ? 'Replace value…' : 'Enter value…'}
                  value={displayValue}
                  onFocus={() => {
                    if (item.configured && values[item.key] === undefined) {
                      setValues(prev => ({ ...prev, [item.key]: '' }));
                    }
                  }}
                  onBlur={() => {
                    if (item.configured && (values[item.key] ?? '') === '') {
                      setValues(prev => {
                        const next = { ...prev };
                        delete next[item.key];
                        return next;
                      });
                    }
                  }}
                  onChange={event => setValues(prev => ({ ...prev, [item.key]: event.target.value }))}
                />
                <button
                  onClick={() => save(item.key)}
                  disabled={!dirty}
                  className={`text-sm rounded-xl px-4 py-2 transition-colors ${
                    dirty
                      ? 'bg-[var(--theme-primary)] hover:opacity-90 text-[#0a0a0a]'
                      : 'bg-white/[0.04] text-zinc-600 cursor-not-allowed'
                  }`}
                >
                  Save
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function configuredCredentialLabel(source: CredentialItem['source']): string {
  return source === 'env' ? 'configured by env' : 'configured';
}
