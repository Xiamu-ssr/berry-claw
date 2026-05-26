import { useState } from 'react';
import { ExternalLink, Pencil, Plus, RefreshCw, Server, Trash2, X } from 'lucide-react';
import { RAW_PRESET_ID } from '@berry-agent/claw-contracts/model-config';
import type {
  ConfigProviderInstance as ProviderInstance,
  ConfigProviderPreset as ProviderPreset,
  ConfigResponse as ConfigPayload,
} from '@berry-agent/claw-contracts';
import { API, apiFetch } from '../../api/paths';
import { showToast } from '../Toast';
import { FormField, PresetCombobox } from './SettingsForm';

interface ProviderForm {
  id: string;
  presetId: string;
  apiKey: string;
  baseUrl: string;
  type: 'anthropic' | 'openai';
  knownModelsCsv: string;
  label: string;
}

const emptyProviderForm = (): ProviderForm => ({
  id: '',
  presetId: '',
  apiKey: '',
  baseUrl: '',
  type: 'openai',
  knownModelsCsv: '',
  label: '',
});

export default function ProvidersTab({ config, presets, onChange }: {
  config: ConfigPayload;
  presets: ProviderPreset[];
  onChange: () => void;
}) {
  const [form, setForm] = useState<ProviderForm>(emptyProviderForm());
  const [editing, setEditing] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [modelsByProvider, setModelsByProvider] = useState<Record<string, string[]>>({});
  const [loadingModels, setLoadingModels] = useState<string | null>(null);

  const instances = Object.values(config.providerInstances);
  const selectedPreset = presets.find(preset => preset.id === form.presetId);
  const isRaw = form.presetId === RAW_PRESET_ID;

  const startEdit = (instance: ProviderInstance) => {
    setEditing(instance.id);
    setShowForm(true);
    setForm({
      id: instance.id,
      presetId: instance.presetId,
      apiKey: '',
      baseUrl: instance.baseUrl ?? '',
      type: instance.type ?? 'openai',
      knownModelsCsv: (instance.knownModels ?? []).join(', '),
      label: instance.label ?? '',
    });
  };

  const cancelEdit = () => {
    setEditing(null);
    setShowForm(false);
    setForm(emptyProviderForm());
  };

  const save = async () => {
    if (!form.id || !form.presetId) {
      showToast('Id and provider preset are required', 'error');
      return;
    }
    const isNew = !instances.some(instance => instance.id === form.id);
    if (isNew && !form.apiKey) {
      showToast('API key required for new provider instances', 'error');
      return;
    }

    const body: Record<string, unknown> = {
      presetId: form.presetId,
      label: form.label || undefined,
    };
    if (form.apiKey) body.apiKey = form.apiKey;
    if (isRaw) {
      body.baseUrl = form.baseUrl || undefined;
      body.type = form.type;
      body.knownModels = form.knownModelsCsv.split(',').map(item => item.trim()).filter(Boolean);
    }

    const res = await apiFetch(API.providerInstance(form.id), {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'save failed' }));
      showToast(err.error ?? 'Save failed', 'error');
      return;
    }
    showToast(editing ? 'Provider updated' : 'Provider saved');
    cancelEdit();
    onChange();
  };

  const remove = async (id: string) => {
    if (!confirm(`Remove provider "${id}"?`)) return;
    await apiFetch(API.providerInstance(id), { method: 'DELETE' });
    showToast('Provider removed');
    onChange();
  };

  const fetchRemoteModels = async (id: string) => {
    setLoadingModels(id);
    try {
      const res = await apiFetch(API.providerInstanceModels(id));
      const data = await res.json();
      if (!res.ok) {
        showToast(data.error ?? 'Failed to list models', 'error');
        return;
      }
      setModelsByProvider(prev => ({ ...prev, [id]: data.models ?? [] }));
      showToast(`${(data.models ?? []).length} models discovered`);
    } finally {
      setLoadingModels(null);
    }
  };

  return (
    <section className="rounded-xl border border-white/[0.08] bg-[#20242a]/75 p-5">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h2 className="flex items-center gap-2 text-lg font-semibold text-zinc-100">
            <Server size={20} className="text-[var(--theme-primary)]" /> Provider Instances
          </h2>
          <p className="mt-1 text-sm text-zinc-500">
            Layer 1: one per provider preset and apiKey. This is the only place apiKeys live.
          </p>
        </div>
        {!showForm && (
          <button
            onClick={() => {
              setShowForm(true);
              setEditing(null);
              setForm(emptyProviderForm());
            }}
            className="flex items-center gap-1.5 rounded-xl bg-[var(--theme-primary)] px-4 py-2 text-sm text-[#0a0a0a] transition-colors hover:opacity-90"
          >
            <Plus size={16} /> Add Provider
          </button>
        )}
      </div>

      {instances.length === 0 && !showForm && (
        <p className="py-8 text-center text-sm italic text-gray-400">
          No provider instances yet. Click "Add Provider" to get started.
        </p>
      )}

      {instances.length > 0 && (
        <div className="mb-4 space-y-3">
          {instances.map(instance => {
            const preset = presets.find(item => item.id === instance.presetId);
            const remote = modelsByProvider[instance.id];
            return (
              <div key={instance.id} className="rounded-lg border border-white/[0.08] p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="mb-1.5 flex flex-wrap items-center gap-2">
                      <span className="font-mono font-medium text-gray-800 dark:text-gray-200">{instance.id}</span>
                      <span className="rounded-full bg-gray-100 bg-white/[0.06] px-2 py-0.5 text-xs text-zinc-400">
                        {preset?.name ?? instance.presetId}
                      </span>
                      {instance.label && <span className="text-xs text-gray-400">- {instance.label}</span>}
                    </div>
                    <p className="mb-1 font-mono text-xs text-zinc-600">{instance.apiKey}</p>
                    {(instance.baseUrl ?? preset?.baseUrl) && (
                      <p className="truncate font-mono text-xs text-zinc-600">
                        {instance.baseUrl ?? preset?.baseUrl}
                      </p>
                    )}
                    {instance.knownModels && instance.knownModels.length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-1">
                        {instance.knownModels.map(model => (
                          <span key={model} className="rounded bg-gray-100 bg-white/[0.06] px-2 py-0.5 font-mono text-xs text-zinc-400">
                            {model}
                          </span>
                        ))}
                      </div>
                    )}
                    {remote && (
                      <div className="mt-3 rounded border border-white/[0.08] bg-gray-50 p-2 dark:bg-gray-900/40">
                        <p className="mb-1 text-xs text-gray-500">Live models ({remote.length}):</p>
                        <div className="flex flex-wrap gap-1">
                          {remote.slice(0, 40).map(model => (
                            <span key={model} className="rounded bg-blue-50 px-2 py-0.5 font-mono text-xs text-blue-700 dark:bg-blue-900/30 dark:text-blue-300">
                              {model}
                            </span>
                          ))}
                          {remote.length > 40 && <span className="text-xs text-gray-400">+{remote.length - 40} more</span>}
                        </div>
                      </div>
                    )}
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <button
                      onClick={() => fetchRemoteModels(instance.id)}
                      disabled={loadingModels === instance.id}
                      className="text-gray-400 hover:text-blue-500 disabled:opacity-40 dark:hover:text-blue-400"
                      title="Fetch live models"
                    >
                      <RefreshCw size={15} className={loadingModels === instance.id ? 'animate-spin' : ''} />
                    </button>
                    <button onClick={() => startEdit(instance)} className="text-gray-400 hover:text-blue-500">
                      <Pencil size={15} />
                    </button>
                    <button onClick={() => remove(instance.id)} className="text-gray-400 hover:text-red-500">
                      <Trash2 size={15} />
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {showForm && (
        <div className="border-t border-gray-100 pt-4 dark:border-gray-700">
          <div className="mb-3 flex items-center justify-between">
            <p className="text-sm font-medium text-zinc-400">
              {editing ? `Edit: ${editing}` : 'Add Provider Instance'}
            </p>
            <button onClick={cancelEdit} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300">
              <X size={16} />
            </button>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <FormField label="Instance ID">
              {editing ? (
                <div className="settings-input flex items-center font-mono text-zinc-500 !bg-gray-50 dark:!bg-gray-800/60">
                  {form.id}
                </div>
              ) : (
                <input
                  className="settings-input w-full"
                  placeholder="e.g. anthropic-main"
                  value={form.id}
                  onChange={event => setForm({ ...form, id: event.target.value })}
                  autoFocus
                />
              )}
            </FormField>

            <FormField label="Provider preset">
              <PresetCombobox
                value={form.presetId}
                onChange={presetId => setForm({ ...form, presetId })}
                presets={presets}
              />
            </FormField>

            <FormField label="API key" className="sm:col-span-2">
              <input
                className="settings-input w-full"
                type="password"
                placeholder={editing ? 'Leave blank to keep existing key' : 'Paste your API key'}
                value={form.apiKey}
                onChange={event => setForm({ ...form, apiKey: event.target.value })}
              />
            </FormField>

            {isRaw && (
              <>
                <FormField label="Base URL" hint="e.g. https://api.my-proxy.internal/v1" className="sm:col-span-2">
                  <input
                    className="settings-input w-full"
                    placeholder="https://..."
                    value={form.baseUrl}
                    onChange={event => setForm({ ...form, baseUrl: event.target.value })}
                  />
                </FormField>
                <FormField label="Protocol">
                  <select
                    className="settings-input w-full"
                    value={form.type}
                    onChange={event => setForm({ ...form, type: event.target.value as 'anthropic' | 'openai' })}
                  >
                    <option value="openai">OpenAI Protocol</option>
                    <option value="anthropic">Anthropic Protocol</option>
                  </select>
                </FormField>
                <FormField label="Known models" hint="comma-separated">
                  <input
                    className="settings-input w-full"
                    placeholder="gpt-4o, gpt-4o-mini"
                    value={form.knownModelsCsv}
                    onChange={event => setForm({ ...form, knownModelsCsv: event.target.value })}
                  />
                </FormField>
              </>
            )}

            <FormField label="Label" hint="optional, e.g. 'team-shared'" className="sm:col-span-2">
              <input
                className="settings-input w-full"
                placeholder="Human-friendly label"
                value={form.label}
                onChange={event => setForm({ ...form, label: event.target.value })}
              />
            </FormField>
          </div>
          <div className="mt-3 flex gap-2">
            <button
              onClick={save}
              className="rounded-xl bg-[var(--theme-primary)] px-4 py-2 text-sm text-[#0a0a0a] transition-colors hover:opacity-90"
            >
              {editing ? 'Update' : 'Add'}
            </button>
            <button onClick={cancelEdit} className="rounded-xl px-4 py-2 text-sm text-zinc-400 transition-colors hover:bg-white/[0.07]">
              Cancel
            </button>
          </div>
          {selectedPreset?.apiKeyDocsUrl && (
            <p className="mt-3 text-xs text-zinc-500">
              <a
                href={selectedPreset.apiKeyDocsUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 text-[var(--theme-primary)] hover:underline"
              >
                Get {selectedPreset.name} API key <ExternalLink size={11} />
              </a>
            </p>
          )}
        </div>
      )}
    </section>
  );
}
