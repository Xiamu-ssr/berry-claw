import { useEffect, useState } from 'react';
import { ChevronDown, ChevronUp, Layers, Plus, Trash2 } from 'lucide-react';
import type {
  ConfigModelBinding as ModelBinding,
  ConfigModelProviderRef as ModelBindingProviderRef,
  ConfigResponse as ConfigPayload,
} from '@berry-agent/claw-contracts';
import { API, apiFetch } from '../../api/paths';
import { cn } from '../../utils/cn';
import { showToast } from '../Toast';
import { emitModelCatalogChanged } from './modelCatalogEvents';

export default function ModelsTab({ config, onChange }: {
  config: ConfigPayload;
  onChange: () => void;
}) {
  const [newId, setNewId] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);

  const models = Object.values(config.models);
  const providerIds = Object.keys(config.providerInstances);

  const createModel = async () => {
    const id = newId.trim();
    if (!id) {
      showToast('Model id required', 'error');
      return;
    }
    if (providerIds.length === 0) {
      showToast('Add a provider instance first', 'error');
      return;
    }
    const res = await apiFetch(API.configModel(id), {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ providers: [{ providerId: providerIds[0] }] }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'save failed' }));
      showToast(err.error ?? 'Save failed', 'error');
      return;
    }
    showToast('Model binding created');
    setNewId('');
    setExpanded(id);
    emitModelCatalogChanged();
    onChange();
  };

  const updateModel = async (
    binding: ModelBinding,
    patch: { providers: ModelBindingProviderRef[]; contextWindow?: number },
  ) => {
    const res = await apiFetch(API.configModel(binding.id), {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        label: binding.label,
        providers: patch.providers,
        contextWindow: patch.contextWindow,
      }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'save failed' }));
      showToast(err.error ?? 'Save failed', 'error');
      return;
    }
    emitModelCatalogChanged();
    onChange();
  };

  const remove = async (id: string) => {
    if (!confirm(`Remove model binding "${id}"?`)) return;
    await apiFetch(API.configModel(id), { method: 'DELETE' });
    showToast('Model removed');
    emitModelCatalogChanged();
    onChange();
  };

  return (
    <section className="rounded-xl border border-white/[0.08] bg-[#20242a]/75 p-5">
      <div className="mb-5">
        <h2 className="flex items-center gap-2 text-lg font-semibold text-zinc-100">
          <Layers size={20} /> Model Bindings
        </h2>
        <p className="mt-1 text-sm text-zinc-500">
          Layer 2: expose a model id to agents. Each binding lists providers in failover order.
        </p>
      </div>

      <div className="mb-4 flex gap-2">
        <input
          className="settings-input flex-1"
          placeholder="Model id (e.g. claude-opus-4.7, gpt-4o, glm-4.6)"
          value={newId}
          onChange={event => setNewId(event.target.value)}
        />
        <button
          onClick={createModel}
          className="flex items-center gap-1.5 whitespace-nowrap rounded-lg bg-teal-300 px-3 py-2 text-sm text-slate-950 hover:bg-teal-200"
        >
          <Plus size={16} /> Add Model
        </button>
      </div>

      {models.length === 0 && (
        <p className="py-8 text-center text-sm italic text-gray-400">
          No model bindings yet.
        </p>
      )}

      <div className="space-y-2">
        {models.map(model => {
          const open = expanded === model.id;
          return (
            <div key={model.id} className="overflow-hidden rounded-lg border border-white/[0.08]">
              <div
                role="button"
                tabIndex={0}
                onClick={() => setExpanded(open ? null : model.id)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    setExpanded(open ? null : model.id);
                  }
                }}
                className="flex w-full cursor-pointer items-center justify-between gap-2 px-4 py-3 transition-colors hover:bg-white/[0.05] focus:bg-gray-50 focus:outline-none dark:focus:bg-gray-700/40"
              >
                <div className="flex min-w-0 items-center gap-3">
                  <span className="truncate font-mono font-medium text-gray-800 dark:text-gray-200">{model.id}</span>
                  <span className="whitespace-nowrap rounded-full bg-gray-100 bg-white/[0.06] px-2 py-0.5 text-xs text-zinc-500">
                    {model.providers.length} provider{model.providers.length !== 1 ? 's' : ''}
                  </span>
                  {model.contextWindow ? (
                    <span className="whitespace-nowrap rounded-full bg-white/[0.06] px-2 py-0.5 text-xs text-zinc-500">
                      {formatTokenWindow(model.contextWindow)} ctx
                    </span>
                  ) : null}
                </div>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation();
                      remove(model.id);
                    }}
                    title="Delete binding"
                    className="rounded-md p-1.5 text-gray-400 transition-colors hover:bg-red-50 hover:text-red-500 dark:hover:bg-red-900/20"
                  >
                    <Trash2 size={14} />
                  </button>
                  <span className="p-1.5 text-gray-400">
                    {open ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                  </span>
                </div>
              </div>
              {open && (
                <ModelProviderEditor
                  binding={model}
                  providerIds={providerIds}
                  onSave={(patch) => updateModel(model, patch)}
                />
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}

function ModelProviderEditor({ binding, providerIds, onSave }: {
  binding: ModelBinding;
  providerIds: string[];
  onSave: (patch: { providers: ModelBindingProviderRef[]; contextWindow?: number }) => void | Promise<void>;
}) {
  const [refs, setRefs] = useState<ModelBindingProviderRef[]>(binding.providers);
  const [contextWindowInput, setContextWindowInput] = useState(binding.contextWindow ? String(binding.contextWindow) : '');
  const [picking, setPicking] = useState('');

  useEffect(() => {
    setRefs(binding.providers);
    setContextWindowInput(binding.contextWindow ? String(binding.contextWindow) : '');
  }, [binding]);

  const unused = providerIds.filter(providerId => !refs.some(ref => ref.providerId === providerId));

  const add = () => {
    if (!picking) return;
    setRefs([...refs, { providerId: picking }]);
    setPicking('');
  };
  const removeAt = (index: number) => setRefs(refs.filter((_, current) => current !== index));
  const move = (index: number, dir: -1 | 1) => {
    const nextIndex = index + dir;
    if (nextIndex < 0 || nextIndex >= refs.length) return;
    const next = [...refs];
    [next[index], next[nextIndex]] = [next[nextIndex]!, next[index]!];
    setRefs(next);
  };
  const setRemoteId = (index: number, value: string) => {
    const next = [...refs];
    next[index] = { ...next[index]!, remoteModelId: value.trim() || undefined };
    setRefs(next);
  };

  const parsedContextWindow = parseOptionalPositiveInt(contextWindowInput);
  const canSaveContextWindow = contextWindowInput.trim() === '' ||
    (parsedContextWindow !== undefined && parsedContextWindow >= 4_000);
  const dirty = JSON.stringify(refs) !== JSON.stringify(binding.providers) ||
    (parsedContextWindow ?? undefined) !== binding.contextWindow;

  return (
    <div className="border-t border-gray-100 bg-black/10 p-4 dark:border-gray-700">
      <p className="mb-2 text-xs text-gray-500">
        Order = failover priority. Set <code>remoteModelId</code> when a provider uses a different id for this model.
      </p>
      <div className="mb-3 grid gap-2 md:grid-cols-[220px_minmax(0,1fr)]">
        <label className="block">
          <span className="mb-1 block text-xs text-zinc-500">Max context tokens</span>
          <input
            className="settings-input w-full font-mono text-xs"
            placeholder="e.g. 128000"
            value={contextWindowInput}
            onChange={(event) => setContextWindowInput(event.target.value)}
          />
        </label>
        <p className="self-end pb-2 text-xs text-zinc-500">
          Empty uses the product fallback. This value drives the chat context bar and compaction threshold.
        </p>
      </div>
      <div className="space-y-2">
        {refs.map((ref, index) => (
          <div key={index} className="flex items-center gap-2">
            <span className="w-6 text-right font-mono text-xs text-gray-400">{index + 1}.</span>
            <span className="min-w-[160px] rounded border border-gray-200 bg-[#20242a]/75 px-2 py-1 text-sm font-mono dark:border-gray-600">
              {ref.providerId}
            </span>
            <input
              className="settings-input flex-1 font-mono text-xs"
              placeholder="(optional) remoteModelId override"
              value={ref.remoteModelId ?? ''}
              onChange={event => setRemoteId(index, event.target.value)}
            />
            <button onClick={() => move(index, -1)} disabled={index === 0} className="text-gray-400 hover:text-gray-700 disabled:opacity-30"><ChevronUp size={14} /></button>
            <button onClick={() => move(index, 1)} disabled={index === refs.length - 1} className="text-gray-400 hover:text-gray-700 disabled:opacity-30"><ChevronDown size={14} /></button>
            <button onClick={() => removeAt(index)} className="text-gray-400 hover:text-red-500"><Trash2 size={14} /></button>
          </div>
        ))}
      </div>
      {unused.length > 0 && (
        <div className="mt-3 flex items-center gap-2">
          <select className="settings-input flex-1" value={picking} onChange={event => setPicking(event.target.value)}>
            <option value="">-- Add provider --</option>
            {unused.map(id => <option key={id} value={id}>{id}</option>)}
          </select>
          <button onClick={add} disabled={!picking} className="flex items-center gap-1 rounded-lg bg-gray-200 bg-white/[0.06] px-3 py-2 text-sm text-zinc-300 hover:bg-gray-300 disabled:opacity-40 dark:hover:bg-gray-600">
            <Plus size={14} /> Add
          </button>
        </div>
      )}
      <div className="mt-3 flex gap-2">
        <button
          onClick={() => {
            setRefs(binding.providers);
            setContextWindowInput(binding.contextWindow ? String(binding.contextWindow) : '');
          }}
          disabled={!dirty}
          className="rounded-xl px-4 py-2 text-sm text-zinc-400 transition-colors hover:bg-white/[0.07] disabled:opacity-40"
        >
          Reset
        </button>
        <button
          onClick={() => onSave({ providers: refs, contextWindow: parsedContextWindow })}
          disabled={!dirty || refs.length === 0 || !canSaveContextWindow}
          className={cn(
            'rounded-xl px-4 py-2 text-sm transition-colors',
            !dirty || refs.length === 0 || !canSaveContextWindow
              ? 'cursor-not-allowed bg-white/[0.04] text-zinc-600'
              : 'bg-[var(--theme-primary)] text-[#0a0a0a] hover:opacity-90',
          )}
        >
          Save
        </button>
      </div>
    </div>
  );
}

function parseOptionalPositiveInt(value: string): number | undefined {
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  const parsed = Number(trimmed.replace(/,/g, ''));
  if (!Number.isFinite(parsed) || parsed <= 0) return undefined;
  return Math.floor(parsed);
}

function formatTokenWindow(value: number): string {
  if (value >= 1_000_000) return `${Number((value / 1_000_000).toFixed(1))}M`;
  if (value >= 1_000) return `${Math.round(value / 1_000)}K`;
  return String(value);
}
