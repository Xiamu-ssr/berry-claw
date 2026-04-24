/**
 * SettingsPage — v2 schema (provider instances + models + tiers + agents).
 *
 * Tabs (top-level):
 *   1. Providers  — Layer 1: instances keyed by user-chosen id, one apiKey each
 *   2. Models     — Layer 2: model bindings aggregating providers (failover order)
 *   3. Tiers      — Layer 3: strong / balanced / fast shortcuts
 *   4. Credentials (tool secrets — unchanged)
 *
 * Notes:
 *  - Agents are managed on their own page (AgentsPage). This page focuses
 *    purely on the 3-layer model binding surface.
 *  - apiKeys are shown masked (`sk-xxx…abc`). Leaving the field blank on
 *    update keeps the existing key (server semantics).
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import {
  Plus, Trash2, Check, Server, Pencil, X, Key, ExternalLink,
  Layers, Zap, RefreshCw, ChevronDown, ChevronUp,
} from 'lucide-react';
import { showToast } from './Toast';
import { API } from '../api/paths';

// ============================================================
// Types (mirror server payload shapes)
// ============================================================

interface ProviderInstance {
  id: string;
  presetId: string;
  apiKey: string;
  baseUrl?: string;
  type?: 'anthropic' | 'openai';
  knownModels?: string[];
  label?: string;
}

interface ModelBindingProviderRef {
  providerId: string;
  remoteModelId?: string;
}

interface ModelBinding {
  id: string;
  label?: string;
  providers: ModelBindingProviderRef[];
}

type TierId = 'strong' | 'balanced' | 'fast';
type Tiers = Partial<Record<TierId, string>>;

interface ProviderPreset {
  id: string;
  name: string;
  baseUrl?: string;
  type: 'anthropic' | 'openai';
  apiKeyDocsUrl?: string;
  listModelsPath?: string;
  knownModels?: string[];
}

interface ConfigPayload {
  schemaVersion: 2;
  providerInstances: Record<string, ProviderInstance>;
  models: Record<string, ModelBinding>;
  tiers: Tiers;
  agents: Record<string, unknown>;
  defaultAgent: string;
}

interface CredentialItem {
  key: string;
  category: string;
  provider: string;
  url: string;
  configured: boolean;
  source: 'env' | 'file' | null;
}

// ============================================================
// Top-level component
// ============================================================

type TabId = 'providers' | 'models' | 'tiers' | 'credentials';

export default function SettingsPage() {
  const [tab, setTab] = useState<TabId>('providers');
  const [config, setConfig] = useState<ConfigPayload | null>(null);
  const [presets, setPresets] = useState<ProviderPreset[]>([]);
  const refresh = useCallback(async () => {
    const [cfg, presetRes] = await Promise.all([
      fetch(API.config).then(r => r.json()),
      fetch(API.configPresets).then(r => r.json()),
    ]);
    setConfig(cfg);
    setPresets(presetRes.presets ?? []);
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  return (
    <div className="flex-1 overflow-y-auto p-4 sm:p-8 bg-gray-50 dark:bg-gray-900">
      <h1 className="text-2xl font-bold text-gray-800 dark:text-gray-100 mb-6">Settings</h1>

      {/* Tab bar */}
      <div className="flex gap-1 mb-4 border-b border-gray-200 dark:border-gray-700 overflow-x-auto">
        <TabButton active={tab === 'providers'} onClick={() => setTab('providers')} icon={<Server size={16} />} label="Providers" />
        <TabButton active={tab === 'models'} onClick={() => setTab('models')} icon={<Layers size={16} />} label="Models" />
        <TabButton active={tab === 'tiers'} onClick={() => setTab('tiers')} icon={<Zap size={16} />} label="Tiers" />
        <TabButton active={tab === 'credentials'} onClick={() => setTab('credentials')} icon={<Key size={16} />} label="Tool Credentials" />
      </div>

      {tab === 'providers' && config && (
        <ProvidersTab config={config} presets={presets} onChange={refresh} />
      )}
      {tab === 'models' && config && (
        <ModelsTab config={config} onChange={refresh} />
      )}
      {tab === 'tiers' && config && (
        <TiersTab config={config} onChange={refresh} />
      )}
      {tab === 'credentials' && <CredentialsTab />}
    </div>
  );
}

/**
 * Form field wrapper — consistent label + optional hint + child control.
 * Using a wrapper instead of raw inputs makes it obvious to users which input
 * is what, especially in the provider form where context matters.
 */
function FormField({ label, hint, className, children }: {
  label: string;
  hint?: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={className}>
      <div className="flex items-baseline justify-between mb-1">
        <label className="text-xs font-medium text-gray-600 dark:text-gray-300">{label}</label>
        {hint && <span className="text-xs text-gray-400 dark:text-gray-500">{hint}</span>}
      </div>
      {children}
    </div>
  );
}

/**
 * Custom combobox for provider presets.
 * Native <select> can't show multi-line / styled options, so we render our own
 * list. Each row shows:  Name | Protocol pill | baseUrl (mono).
 * The "Custom (raw)" option lives at the bottom with a distinct look.
 */
function PresetCombobox({ value, onChange, presets }: {
  value: string;
  onChange: (presetId: string) => void;
  presets: ProviderPreset[];
}) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Close on outside click.
  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [open]);

  const selected = presets.find(p => p.id === value);
  const isRawSelected = value === RAW_PRESET_ID;

  const ProtocolPill = ({ type }: { type: 'anthropic' | 'openai' }) => (
    <span
      className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium shrink-0 ${
        type === 'anthropic'
          ? 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300'
          : 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300'
      }`}
    >
      {type === 'anthropic' ? 'Anthropic' : 'OpenAI'}
    </span>
  );

  return (
    <div ref={containerRef} className="relative">
      {/* Trigger */}
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="settings-input w-full flex items-center justify-between gap-2 text-left cursor-pointer"
      >
        {selected ? (
          <span className="flex items-center gap-2 min-w-0 flex-1">
            <span className="font-medium text-gray-800 dark:text-gray-100 truncate">{selected.name}</span>
            <ProtocolPill type={selected.type} />
            {selected.baseUrl && (
              <span className="text-xs font-mono text-gray-400 dark:text-gray-500 truncate hidden sm:inline">
                {selected.baseUrl}
              </span>
            )}
          </span>
        ) : isRawSelected ? (
          <span className="text-gray-700 dark:text-gray-200">Custom (raw endpoint)</span>
        ) : (
          <span className="text-gray-400 dark:text-gray-500">Select a provider preset…</span>
        )}
        <ChevronDown size={14} className={`text-gray-400 shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {/* Dropdown */}
      {open && (
        <div className="absolute z-20 mt-1 left-0 right-0 max-h-80 overflow-auto rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 shadow-lg py-1">
          {presets.map(p => {
            const isActive = p.id === value;
            return (
              <button
                key={p.id}
                type="button"
                onClick={() => { onChange(p.id); setOpen(false); }}
                className={`w-full text-left px-3 py-2 flex items-center gap-2 transition-colors ${
                  isActive
                    ? 'bg-berry-50 dark:bg-berry-900/20'
                    : 'hover:bg-gray-50 dark:hover:bg-gray-700/50'
                }`}
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-gray-800 dark:text-gray-100 truncate">{p.name}</span>
                    <ProtocolPill type={p.type} />
                  </div>
                  {p.baseUrl && (
                    <div className="text-xs font-mono text-gray-500 dark:text-gray-400 truncate mt-0.5">
                      {p.baseUrl}
                    </div>
                  )}
                </div>
                {isActive && <Check size={14} className="text-berry-600 dark:text-berry-400 shrink-0" />}
              </button>
            );
          })}
          {/* Divider + raw escape hatch */}
          <div className="border-t border-gray-100 dark:border-gray-700 my-1" />
          <button
            type="button"
            onClick={() => { onChange(RAW_PRESET_ID); setOpen(false); }}
            className={`w-full text-left px-3 py-2 flex items-center gap-2 transition-colors ${
              isRawSelected
                ? 'bg-berry-50 dark:bg-berry-900/20'
                : 'hover:bg-gray-50 dark:hover:bg-gray-700/50'
            }`}
          >
            <div className="flex-1">
              <div className="text-sm font-medium text-gray-800 dark:text-gray-100">Custom (raw endpoint)</div>
              <div className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                Manually specify baseUrl, protocol, and known models
              </div>
            </div>
            {isRawSelected && <Check size={14} className="text-berry-600 dark:text-berry-400 shrink-0" />}
          </button>
        </div>
      )}
    </div>
  );
}

function TabButton({ active, onClick, icon, label }: {
  active: boolean; onClick: () => void; icon: React.ReactNode; label: string;
}) {
  return (
    <button
      onClick={onClick}
      className={`px-4 py-2 flex items-center gap-2 text-sm font-medium border-b-2 -mb-px transition-colors whitespace-nowrap ${
        active
          ? 'border-berry-500 text-berry-600 dark:text-berry-300'
          : 'border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'
      }`}
    >
      {icon}{label}
    </button>
  );
}

// ============================================================
// Providers tab (Layer 1 — provider instances)
// ============================================================

interface ProviderForm {
  id: string;
  presetId: string;
  apiKey: string;
  baseUrl: string;        // only used for raw preset (or override)
  type: 'anthropic' | 'openai';  // only used for raw
  knownModelsCsv: string; // only used for raw
  label: string;
}

const RAW_PRESET_ID = '__raw__';

const emptyProviderForm = (): ProviderForm => ({
  id: '', presetId: '', apiKey: '', baseUrl: '', type: 'openai', knownModelsCsv: '', label: '',
});

function ProvidersTab({ config, presets, onChange }: {
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
  const selectedPreset = presets.find(p => p.id === form.presetId);
  const isRaw = form.presetId === RAW_PRESET_ID;

  const startEdit = (inst: ProviderInstance) => {
    setEditing(inst.id);
    setShowForm(true);
    setForm({
      id: inst.id,
      presetId: inst.presetId,
      apiKey: '',
      baseUrl: inst.baseUrl ?? '',
      type: inst.type ?? 'openai',
      knownModelsCsv: (inst.knownModels ?? []).join(', '),
      label: inst.label ?? '',
    });
  };

  const cancelEdit = () => {
    setEditing(null);
    setShowForm(false);
    setForm(emptyProviderForm());
  };

  const save = async () => {
    if (!form.id || !form.presetId) {
      showToast('Id and provider preset are required', 'error'); return;
    }
    const isNew = !instances.some(i => i.id === form.id);
    if (isNew && !form.apiKey) {
      showToast('API key required for new provider instances', 'error'); return;
    }
    const body: Record<string, unknown> = { presetId: form.presetId, label: form.label || undefined };
    if (form.apiKey) body.apiKey = form.apiKey;
    if (isRaw) {
      // Raw: user-supplied everything.
      body.baseUrl = form.baseUrl || undefined;
      body.type = form.type;
      body.knownModels = form.knownModelsCsv.split(',').map(s => s.trim()).filter(Boolean);
    }
    // Preset-based instance: we inherit baseUrl/type/knownModels from the
    // preset on the server side. Don't send overrides from the form.
    const res = await fetch(API.providerInstance(form.id), {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'save failed' }));
      showToast(err.error ?? 'Save failed', 'error'); return;
    }
    showToast(editing ? 'Provider updated' : 'Provider saved');
    cancelEdit();
    onChange();
  };

  const remove = async (id: string) => {
    if (!confirm(`Remove provider "${id}"?`)) return;
    await fetch(API.providerInstance(id), { method: 'DELETE' });
    showToast('Provider removed');
    onChange();
  };

  const fetchRemoteModels = async (id: string) => {
    setLoadingModels(id);
    try {
      const res = await fetch(API.providerInstanceModels(id));
      const data = await res.json();
      if (!res.ok) { showToast(data.error ?? 'Failed to list models', 'error'); return; }
      setModelsByProvider(prev => ({ ...prev, [id]: data.models ?? [] }));
      showToast(`${(data.models ?? []).length} models discovered`);
    } finally {
      setLoadingModels(null);
    }
  };

  return (
    <section className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-6">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-lg font-semibold text-gray-800 dark:text-gray-100 flex items-center gap-2">
            <Server size={20} /> Provider Instances
          </h2>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            Layer 1 — one per (preset + apiKey). This is the only place apiKeys live.
          </p>
        </div>
        {!showForm && (
          <button
            onClick={() => { setShowForm(true); setEditing(null); setForm(emptyProviderForm()); }}
            className="bg-berry-500 hover:bg-berry-600 text-white text-sm rounded-lg px-3 py-2 flex items-center gap-1.5"
          >
            <Plus size={16} /> Add Provider
          </button>
        )}
      </div>

      {instances.length === 0 && !showForm && (
        <p className="text-sm text-gray-400 italic py-8 text-center">
          No provider instances yet. Click “Add Provider” to get started.
        </p>
      )}

      {instances.length > 0 && (
        <div className="space-y-3 mb-4">
          {instances.map(inst => {
            const preset = presets.find(p => p.id === inst.presetId);
            const remote = modelsByProvider[inst.id];
            return (
              <div key={inst.id} className="rounded-lg border border-gray-200 dark:border-gray-700 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                      <span className="font-mono font-medium text-gray-800 dark:text-gray-200">{inst.id}</span>
                      <span className="text-xs px-2 py-0.5 rounded-full bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300">
                        {preset?.name ?? inst.presetId}
                      </span>
                      {inst.label && <span className="text-xs text-gray-400">— {inst.label}</span>}
                    </div>
                    <p className="text-xs font-mono text-gray-400 dark:text-gray-500 mb-1">{inst.apiKey}</p>
                    {(inst.baseUrl ?? preset?.baseUrl) && (
                      <p className="text-xs font-mono text-gray-400 dark:text-gray-500 truncate">
                        {inst.baseUrl ?? preset?.baseUrl}
                      </p>
                    )}
                    {inst.knownModels && inst.knownModels.length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-2">
                        {inst.knownModels.map(m => (
                          <span key={m} className="text-xs bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 px-2 py-0.5 rounded font-mono">{m}</span>
                        ))}
                      </div>
                    )}
                    {remote && (
                      <div className="mt-3 p-2 rounded bg-gray-50 dark:bg-gray-900/40 border border-gray-200 dark:border-gray-700">
                        <p className="text-xs text-gray-500 mb-1">Live models ({remote.length}):</p>
                        <div className="flex flex-wrap gap-1">
                          {remote.slice(0, 40).map(m => (
                            <span key={m} className="text-xs bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 px-2 py-0.5 rounded font-mono">{m}</span>
                          ))}
                          {remote.length > 40 && <span className="text-xs text-gray-400">+{remote.length - 40} more</span>}
                        </div>
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      onClick={() => fetchRemoteModels(inst.id)}
                      disabled={loadingModels === inst.id}
                      className="text-gray-400 hover:text-blue-500 dark:hover:text-blue-400 disabled:opacity-40"
                      title="Fetch live models"
                    >
                      <RefreshCw size={15} className={loadingModels === inst.id ? 'animate-spin' : ''} />
                    </button>
                    <button onClick={() => startEdit(inst)} className="text-gray-400 hover:text-blue-500">
                      <Pencil size={15} />
                    </button>
                    <button onClick={() => remove(inst.id)} className="text-gray-400 hover:text-red-500">
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
        <div className="border-t border-gray-100 dark:border-gray-700 pt-4">
          <div className="flex items-center justify-between mb-3">
            <p className="text-sm font-medium text-gray-600 dark:text-gray-300">
              {editing ? `Edit: ${editing}` : 'Add Provider Instance'}
            </p>
            <button onClick={cancelEdit} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300">
              <X size={16} />
            </button>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {/* Instance id: read-only when editing (id is the primary key) */}
            <FormField label="Instance ID">
              {editing ? (
                <div className="settings-input !bg-gray-50 dark:!bg-gray-800/60 text-gray-500 dark:text-gray-400 flex items-center font-mono">
                  {form.id}
                </div>
              ) : (
                <input
                  className="settings-input w-full"
                  placeholder="e.g. anthropic-main"
                  value={form.id}
                  onChange={e => setForm({ ...form, id: e.target.value })}
                  autoFocus
                />
              )}
            </FormField>

            {/* Preset selector — custom combobox with name + protocol pill + baseUrl */}
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
                onChange={e => setForm({ ...form, apiKey: e.target.value })}
              />
            </FormField>

            {/*
              Base URL is only required for the raw preset.
              Preset-based instances just inherit the preset's baseUrl silently —
              no reason to burden the form with an empty input.
            */}
            {isRaw && (
              <>
                <FormField label="Base URL" hint="e.g. https://api.my-proxy.internal/v1" className="sm:col-span-2">
                  <input
                    className="settings-input w-full"
                    placeholder="https://…"
                    value={form.baseUrl}
                    onChange={e => setForm({ ...form, baseUrl: e.target.value })}
                  />
                </FormField>
                <FormField label="Protocol">
                  <select
                    className="settings-input w-full"
                    value={form.type}
                    onChange={e => setForm({ ...form, type: e.target.value as 'anthropic' | 'openai' })}
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
                    onChange={e => setForm({ ...form, knownModelsCsv: e.target.value })}
                  />
                </FormField>
              </>
            )}

            <FormField label="Label" hint="optional, e.g. 'team-shared'" className="sm:col-span-2">
              <input
                className="settings-input w-full"
                placeholder="Human-friendly label"
                value={form.label}
                onChange={e => setForm({ ...form, label: e.target.value })}
              />
            </FormField>
          </div>
          <div className="flex gap-2 mt-3">
            <button
              onClick={save}
              className="bg-berry-500 hover:bg-berry-600 text-white text-sm rounded-lg px-4 py-2"
            >
              {editing ? 'Update' : 'Add'}
            </button>
            <button onClick={cancelEdit} className="text-sm rounded-lg px-4 py-2 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700">
              Cancel
            </button>
          </div>
          {selectedPreset?.apiKeyDocsUrl && (
            <p className="text-xs text-gray-500 mt-2">
              <a href={selectedPreset.apiKeyDocsUrl} target="_blank" rel="noreferrer" className="text-berry-500 hover:underline inline-flex items-center gap-1">
                Get {selectedPreset.name} API key <ExternalLink size={11} />
              </a>
            </p>
          )}
        </div>
      )}
    </section>
  );
}

// ============================================================
// Models tab (Layer 2 — model bindings)
// ============================================================

function ModelsTab({ config, onChange }: { config: ConfigPayload; onChange: () => void }) {
  const [newId, setNewId] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);

  const models = Object.values(config.models);
  const providerIds = Object.keys(config.providerInstances);

  const createModel = async () => {
    const id = newId.trim();
    if (!id) { showToast('Model id required', 'error'); return; }
    if (providerIds.length === 0) { showToast('Add a provider instance first', 'error'); return; }
    const res = await fetch(API.configModel(id), {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ providers: [{ providerId: providerIds[0] }] }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'save failed' }));
      showToast(err.error ?? 'Save failed', 'error'); return;
    }
    showToast('Model binding created');
    setNewId('');
    setExpanded(id);
    onChange();
  };

  const updateProviders = async (id: string, providers: ModelBindingProviderRef[]) => {
    const res = await fetch(API.configModel(id), {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ providers }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'save failed' }));
      showToast(err.error ?? 'Save failed', 'error'); return;
    }
    onChange();
  };

  const remove = async (id: string) => {
    if (!confirm(`Remove model binding "${id}"?`)) return;
    await fetch(API.configModel(id), { method: 'DELETE' });
    showToast('Model removed');
    onChange();
  };

  return (
    <section className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-6">
      <div className="mb-5">
        <h2 className="text-lg font-semibold text-gray-800 dark:text-gray-100 flex items-center gap-2">
          <Layers size={20} /> Model Bindings
        </h2>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
          Layer 2 — expose a model id to agents. Each binding lists providers in failover order.
        </p>
      </div>

      <div className="flex gap-2 mb-4">
        <input
          className="settings-input flex-1"
          placeholder="Model id (e.g. claude-opus-4.7, gpt-4o, glm-4.6)"
          value={newId}
          onChange={e => setNewId(e.target.value)}
        />
        <button
          onClick={createModel}
          className="bg-berry-500 hover:bg-berry-600 text-white text-sm rounded-lg px-3 py-2 flex items-center gap-1.5 whitespace-nowrap"
        >
          <Plus size={16} /> Add Model
        </button>
      </div>

      {models.length === 0 && (
        <p className="text-sm text-gray-400 italic py-8 text-center">
          No model bindings yet.
        </p>
      )}

      <div className="space-y-2">
        {models.map(m => {
          const open = expanded === m.id;
          return (
            <div key={m.id} className="rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden">
              {/*
                Row = div (not button) because it hosts an inner <button>.
                Keyboard accessibility preserved via role/tabIndex/onKeyDown.
              */}
              <div
                role="button"
                tabIndex={0}
                onClick={() => setExpanded(open ? null : m.id)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    setExpanded(open ? null : m.id);
                  }
                }}
                className="w-full px-4 py-3 flex items-center justify-between gap-2 cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-700/40 transition-colors focus:outline-none focus:bg-gray-50 dark:focus:bg-gray-700/40"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <span className="font-mono font-medium text-gray-800 dark:text-gray-200 truncate">{m.id}</span>
                  <span className="text-xs px-2 py-0.5 rounded-full bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400 whitespace-nowrap">
                    {m.providers.length} provider{m.providers.length !== 1 ? 's' : ''}
                  </span>
                </div>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); remove(m.id); }}
                    title="Delete binding"
                    className="p-1.5 rounded-md text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
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
                  binding={m}
                  providerIds={providerIds}
                  onSave={(providers) => updateProviders(m.id, providers)}
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
  onSave: (providers: ModelBindingProviderRef[]) => void | Promise<void>;
}) {
  const [refs, setRefs] = useState<ModelBindingProviderRef[]>(binding.providers);
  const [picking, setPicking] = useState<string>('');

  useEffect(() => { setRefs(binding.providers); }, [binding]);

  const unused = providerIds.filter(p => !refs.some(r => r.providerId === p));

  const add = () => {
    if (!picking) return;
    setRefs([...refs, { providerId: picking }]);
    setPicking('');
  };
  const removeAt = (i: number) => setRefs(refs.filter((_, idx) => idx !== i));
  const move = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= refs.length) return;
    const next = [...refs];
    [next[i], next[j]] = [next[j]!, next[i]!];
    setRefs(next);
  };
  const setRemoteId = (i: number, v: string) => {
    const next = [...refs];
    next[i] = { ...next[i]!, remoteModelId: v.trim() || undefined };
    setRefs(next);
  };

  const dirty = JSON.stringify(refs) !== JSON.stringify(binding.providers);

  return (
    <div className="border-t border-gray-100 dark:border-gray-700 p-4 bg-gray-50 dark:bg-gray-900/30">
      <p className="text-xs text-gray-500 mb-2">
        Order = failover priority. Set <code>remoteModelId</code> when a provider uses a different id for this model.
      </p>
      <div className="space-y-2">
        {refs.map((r, i) => (
          <div key={i} className="flex items-center gap-2">
            <span className="text-xs font-mono text-gray-400 w-6 text-right">{i + 1}.</span>
            <span className="text-sm font-mono bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-600 rounded px-2 py-1 min-w-[160px]">
              {r.providerId}
            </span>
            <input
              className="settings-input flex-1 text-xs font-mono"
              placeholder="(optional) remoteModelId override"
              value={r.remoteModelId ?? ''}
              onChange={e => setRemoteId(i, e.target.value)}
            />
            <button onClick={() => move(i, -1)} disabled={i === 0} className="text-gray-400 hover:text-gray-700 disabled:opacity-30"><ChevronUp size={14} /></button>
            <button onClick={() => move(i, 1)} disabled={i === refs.length - 1} className="text-gray-400 hover:text-gray-700 disabled:opacity-30"><ChevronDown size={14} /></button>
            <button onClick={() => removeAt(i)} className="text-gray-400 hover:text-red-500"><Trash2 size={14} /></button>
          </div>
        ))}
      </div>
      {unused.length > 0 && (
        <div className="flex items-center gap-2 mt-3">
          <select className="settings-input flex-1" value={picking} onChange={e => setPicking(e.target.value)}>
            <option value="">-- Add provider --</option>
            {unused.map(id => <option key={id} value={id}>{id}</option>)}
          </select>
          <button onClick={add} disabled={!picking} className="text-sm rounded-lg px-3 py-2 bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-200 hover:bg-gray-300 dark:hover:bg-gray-600 disabled:opacity-40 flex items-center gap-1">
            <Plus size={14} /> Add
          </button>
        </div>
      )}
      <div className="flex justify-end gap-2 mt-3">
        <button
          onClick={() => setRefs(binding.providers)}
          disabled={!dirty}
          className="text-sm rounded-lg px-3 py-2 text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-700 disabled:opacity-40"
        >
          Reset
        </button>
        <button
          onClick={() => onSave(refs)}
          disabled={!dirty || refs.length === 0}
          className="text-sm rounded-lg px-3 py-2 bg-berry-500 hover:bg-berry-600 text-white disabled:opacity-40"
        >
          Save
        </button>
      </div>
    </div>
  );
}

// ============================================================
// Tiers tab (Layer 3)
// ============================================================

const TIER_META: Record<TierId, { label: string; desc: string; color: string; border: string; ring: string }> = {
  strong: {
    label: 'Strong',
    desc: 'Deep reasoning, architecture, hard debugging.',
    color: 'text-purple-600 dark:text-purple-300',
    border: 'border-l-4 border-l-purple-500',
    ring: 'ring-purple-500',
  },
  balanced: {
    label: 'Balanced',
    desc: 'Default working model — the one agents pick when unspecified.',
    color: 'text-berry-600 dark:text-berry-300',
    border: 'border-l-4 border-l-berry-500',
    ring: 'ring-berry-500',
  },
  fast: {
    label: 'Fast',
    desc: 'Short latency tasks: classification, compaction, title gen.',
    color: 'text-green-600 dark:text-green-300',
    border: 'border-l-4 border-l-green-500',
    ring: 'ring-green-500',
  },
};

function TiersTab({ config, onChange }: { config: ConfigPayload; onChange: () => void }) {
  const modelIds = Object.keys(config.models);

  const setTier = async (tier: TierId, modelId: string | null) => {
    await fetch(API.configTier(tier), {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ modelId }),
    });
    showToast(`Tier "${tier}" updated`);
    onChange();
  };

  return (
    <section className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-6">
      <div className="mb-5">
        <h2 className="text-lg font-semibold text-gray-800 dark:text-gray-100 flex items-center gap-2">
          <Zap size={20} /> Tiers
        </h2>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
          Layer 3 — agents can reference <code>tier:strong</code> / <code>tier:balanced</code> / <code>tier:fast</code>
          instead of hard-coding a model id.
        </p>
      </div>

      {modelIds.length === 0 ? (
        <p className="text-sm text-gray-400 italic py-8 text-center">
          Add at least one model binding first.
        </p>
      ) : (
        <div className="space-y-4">
          {(Object.keys(TIER_META) as TierId[]).map(tier => {
            const meta = TIER_META[tier];
            const current = config.tiers[tier] ?? '';
            return (
              <div
                key={tier}
                className={`rounded-lg border border-gray-200 dark:border-gray-700 ${meta.border} p-4 bg-white dark:bg-gray-800`}
              >
                <div className="flex items-center gap-2 mb-1">
                  <Zap size={14} className={meta.color} />
                  <span className={`font-semibold ${meta.color}`}>{meta.label}</span>
                  <span className="text-xs font-mono text-gray-400 dark:text-gray-500">tier:{tier}</span>
                  {!current && (
                    <span className="ml-auto text-xs px-2 py-0.5 rounded-full bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300">
                      unset
                    </span>
                  )}
                </div>
                <p className="text-xs text-gray-500 dark:text-gray-400 mb-3">{meta.desc}</p>
                <div className="relative">
                  <select
                    className={`settings-input w-full appearance-none pr-9 cursor-pointer focus:${meta.ring}`}
                    value={current}
                    onChange={e => setTier(tier, e.target.value || null)}
                  >
                    <option value="">-- not set --</option>
                    {modelIds.map(id => <option key={id} value={id}>{id}</option>)}
                  </select>
                  <ChevronDown
                    size={16}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none"
                  />
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

// ============================================================
// Credentials tab (tool secrets — unchanged from previous UI)
// ============================================================

function CredentialsTab() {
  const [items, setItems] = useState<CredentialItem[]>([]);
  const [values, setValues] = useState<Record<string, string>>({});

  const refresh = useCallback(async () => {
    const res = await fetch(API.credentials);
    const data = await res.json();
    setItems(data.credentials ?? []);
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const save = async (key: string) => {
    const value = (values[key] ?? '').trim();
    if (!value) return;
    const res = await fetch(API.credential(key), {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ value }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'save failed' }));
      showToast(err.error ?? 'Save failed', 'error'); return;
    }
    showToast('Credential saved');
    setValues(prev => ({ ...prev, [key]: '' }));
    refresh();
  };

  const remove = async (key: string) => {
    if (!confirm(`Remove credential "${key}"?`)) return;
    await fetch(API.credential(key), { method: 'DELETE' });
    showToast('Credential removed');
    refresh();
  };

  return (
    <section className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-6">
      <div className="mb-5">
        <h2 className="text-lg font-semibold text-gray-800 dark:text-gray-100 flex items-center gap-2">
          <Key size={20} /> Tool Credentials
        </h2>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
          Shared secrets for built-in tools (web_search, etc). Separate from provider apiKeys.
        </p>
      </div>
      {items.length === 0 && <p className="text-sm text-gray-400 italic">No known credentials.</p>}
      <div className="space-y-3">
        {items.map(item => {
          const draft = (values[item.key] ?? '').trim();
          const dirty = draft.length > 0;
          return (
            <div key={item.key} className="rounded-lg border border-gray-200 dark:border-gray-700 p-4">
              {/* Header row — fixed layout so cards line up regardless of badges */}
              <div className="flex items-center justify-between gap-3 mb-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-mono font-medium text-gray-800 dark:text-gray-200">{item.key}</span>
                    <span className="text-xs px-2 py-0.5 rounded-full bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300">{item.provider}</span>
                    {item.configured ? (
                      <span className="text-xs px-2 py-0.5 rounded-full bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-300 flex items-center gap-1">
                        <Check size={11} /> {item.source === 'env' ? 'env' : 'saved'}
                      </span>
                    ) : (
                      <span className="text-xs px-2 py-0.5 rounded-full bg-gray-100 dark:bg-gray-700/50 text-gray-400 dark:text-gray-500">
                        not set
                      </span>
                    )}
                  </div>
                  {item.url && (
                    <a
                      href={item.url}
                      target="_blank"
                      rel="noreferrer"
                      className="text-xs text-berry-600 dark:text-berry-300 hover:text-berry-700 dark:hover:text-berry-200 inline-flex items-center gap-1 mt-1.5 px-2 py-0.5 rounded bg-berry-50 dark:bg-berry-900/30"
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
                  type="password"
                  placeholder={item.configured ? 'Replace value…' : 'Enter value…'}
                  value={values[item.key] ?? ''}
                  onChange={e => setValues(prev => ({ ...prev, [item.key]: e.target.value }))}
                />
                <button
                  onClick={() => save(item.key)}
                  disabled={!dirty}
                  className={`text-sm rounded-lg px-4 py-2 transition-colors ${
                    dirty
                      ? 'bg-berry-500 hover:bg-berry-600 text-white'
                      : 'bg-gray-100 dark:bg-gray-700 text-gray-400 dark:text-gray-500 cursor-not-allowed'
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
