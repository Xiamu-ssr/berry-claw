import { useState, useEffect } from 'react';
import { Plus, Trash2, Check, Server, Bot, FolderOpen, Moon, Sun, Pencil, X } from 'lucide-react';
import { showToast } from './Toast';

// ===== Types =====

interface ProviderForm {
  name: string;
  type: 'anthropic' | 'openai';
  baseUrl: string;
  apiKey: string;
  models: string;  // comma-separated
}

interface ProviderInfo {
  name: string;
  type: 'anthropic' | 'openai';
  baseUrl?: string;
  apiKeyMasked: string;
  models: string[];
}

interface AgentForm {
  id: string;
  name: string;
  model: string;
  workspace: string;
  systemPrompt: string;
  idManual: boolean;
}

interface ConfigStatus {
  configured: boolean;
  defaultModel: string;
  workspace: string;
  models: Array<{ model: string; providerName: string; type: string }>;
}

interface AgentInfo {
  id: string;
  entry: { name: string; model: string; workspace?: string; systemPrompt?: string };
}

// ===== Helpers =====

const slugify = (s: string) =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

const emptyProviderForm = (): ProviderForm => ({ name: '', type: 'openai', baseUrl: '', apiKey: '', models: '' });
const emptyAgentForm = (): AgentForm => ({ id: '', name: '', model: '', workspace: '', systemPrompt: '', idManual: false });

// ===== Component =====

export default function SettingsPage() {
  const [status, setStatus] = useState<ConfigStatus | null>(null);
  const [providers, setProviders] = useState<ProviderInfo[]>([]);
  const [agents, setAgents] = useState<AgentInfo[]>([]);
  const [activeAgent, setActiveAgent] = useState('');
  const [darkMode, setDarkMode] = useState(() =>
    document.documentElement.classList.contains('dark'),
  );

  // Provider form state
  const [providerForm, setProviderForm] = useState<ProviderForm>(emptyProviderForm());
  const [editingProvider, setEditingProvider] = useState<string | null>(null);

  // Agent form state
  const [agentForm, setAgentForm] = useState<AgentForm>(emptyAgentForm());
  const [editingAgent, setEditingAgent] = useState<string | null>(null);
  const [showAgentForm, setShowAgentForm] = useState(false);

  useEffect(() => { refresh(); }, []);

  const refresh = async () => {
    const [s, a, cfg] = await Promise.all([
      fetch('/api/config/status').then(r => r.json()),
      fetch('/api/agents').then(r => r.json()),
      fetch('/api/config').then(r => r.json()),
    ]);
    setStatus(s);
    setAgents(a.agents?.map((x: { id: string; entry: AgentInfo['entry'] }) => ({ id: x.id, entry: x.entry })) ?? []);
    setActiveAgent(a.activeAgent ?? '');
    const providerList: ProviderInfo[] = Object.entries(cfg.providers ?? {}).map(
      ([name, v]) => {
        const entry = v as { type: 'anthropic' | 'openai'; baseUrl?: string; apiKey: string; models: string[] };
        return { name, type: entry.type, baseUrl: entry.baseUrl, apiKeyMasked: entry.apiKey, models: entry.models ?? [] };
      },
    );
    setProviders(providerList);
  };

  const toggleDarkMode = () => {
    const next = !darkMode;
    setDarkMode(next);
    document.documentElement.classList.toggle('dark', next);
    localStorage.setItem('berry-claw-dark', next ? '1' : '0');
  };

  // ===== Provider Actions =====

  const startEditProvider = (p: ProviderInfo) => {
    setEditingProvider(p.name);
    setProviderForm({ name: p.name, type: p.type, baseUrl: p.baseUrl ?? '', apiKey: '', models: p.models.join(', ') });
  };

  const cancelProviderEdit = () => {
    setEditingProvider(null);
    setProviderForm(emptyProviderForm());
  };

  const saveProvider = async () => {
    if (!providerForm.name || !providerForm.models) {
      showToast('Fill in name and models', 'error'); return;
    }
    const isNew = !providers.find(p => p.name === providerForm.name);
    if (isNew && !providerForm.apiKey) {
      showToast('API key required for new providers', 'error'); return;
    }
    const models = providerForm.models.split(',').map(m => m.trim()).filter(Boolean);
    const body: Record<string, unknown> = { type: providerForm.type, baseUrl: providerForm.baseUrl || undefined, models };
    if (providerForm.apiKey) body.apiKey = providerForm.apiKey;

    const res = await fetch(`/api/config/providers/${providerForm.name}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const err = await res.json();
      showToast(err.error ?? 'Save failed', 'error'); return;
    }
    showToast(editingProvider ? 'Provider updated' : 'Provider saved');
    setEditingProvider(null);
    setProviderForm(emptyProviderForm());
    refresh();
  };

  const deleteProvider = async (name: string) => {
    await fetch(`/api/config/providers/${name}`, { method: 'DELETE' });
    showToast('Provider removed');
    refresh();
  };

  // ===== Agent Actions =====

  const startAddAgent = () => {
    setEditingAgent(null);
    setAgentForm(emptyAgentForm());
    setShowAgentForm(true);
  };

  const startEditAgent = (a: AgentInfo) => {
    setEditingAgent(a.id);
    setAgentForm({ id: a.id, name: a.entry.name, model: a.entry.model, workspace: a.entry.workspace ?? '', systemPrompt: a.entry.systemPrompt ?? '', idManual: true });
    setShowAgentForm(true);
  };

  const cancelAgentEdit = () => {
    setEditingAgent(null);
    setAgentForm(emptyAgentForm());
    setShowAgentForm(false);
  };

  const saveAgent = async () => {
    if (!agentForm.id || !agentForm.name || !agentForm.model) {
      showToast('Fill in name and model', 'error'); return;
    }
    await fetch(`/api/agents/${agentForm.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: agentForm.name,
        model: agentForm.model,
        workspace: agentForm.workspace || undefined,
        systemPrompt: agentForm.systemPrompt || undefined,
      }),
    });
    showToast(editingAgent ? 'Agent updated' : 'Agent saved');
    cancelAgentEdit();
    refresh();
  };

  const deleteAgent = async (id: string) => {
    await fetch(`/api/agents/${id}`, { method: 'DELETE' });
    showToast('Agent removed');
    refresh();
  };

  const activateAgent = async (id: string) => {
    await fetch(`/api/agents/${id}/activate`, { method: 'POST' });
    showToast(`Switched to ${id}`);
    refresh();
  };

  const setDefaultModel = async (model: string) => {
    await fetch('/api/config/model', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model }),
    });
    showToast(`Default model: ${model}`);
    refresh();
  };

  const handleAgentNameChange = (name: string) => {
    setAgentForm(prev => ({ ...prev, name, id: prev.idManual ? prev.id : slugify(name) }));
  };

  return (
    <div className="flex-1 overflow-y-auto p-4 sm:p-8 bg-gray-50 dark:bg-gray-900">
      <h1 className="text-2xl font-bold text-gray-800 dark:text-gray-100 mb-6">Settings</h1>

      {/* ===== Dark Mode Toggle ===== */}
      <section className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-6 mb-6">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold text-gray-800 dark:text-gray-100 flex items-center gap-2">
              {darkMode ? <Moon size={20} /> : <Sun size={20} />} Appearance
            </h2>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">Toggle dark mode</p>
          </div>
          <button
            onClick={toggleDarkMode}
            className={`relative w-12 h-6 rounded-full transition-colors ${darkMode ? 'bg-berry-600' : 'bg-gray-300'}`}
          >
            <div className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${darkMode ? 'translate-x-6' : 'translate-x-0.5'}`} />
          </button>
        </div>
      </section>

      {/* ===== Providers Section ===== */}
      <section className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-6 mb-6">
        <h2 className="text-lg font-semibold text-gray-800 dark:text-gray-100 mb-4 flex items-center gap-2">
          <Server size={20} /> Providers
        </h2>

        {/* Provider cards */}
        {providers.length > 0 && (
          <div className="space-y-3 mb-5">
            {providers.map((p) => (
              <div key={p.name} className="rounded-lg border border-gray-200 dark:border-gray-700 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1.5">
                      <span className="font-medium text-gray-800 dark:text-gray-200">{p.name}</span>
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                        p.type === 'anthropic'
                          ? 'bg-orange-100 dark:bg-orange-900/40 text-orange-700 dark:text-orange-300'
                          : 'bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300'
                      }`}>{p.type}</span>
                    </div>
                    {p.baseUrl && (
                      <p className="text-xs text-gray-400 dark:text-gray-500 font-mono truncate mb-1">
                        {p.baseUrl}
                      </p>
                    )}
                    <p className="text-xs text-gray-400 dark:text-gray-500 font-mono mb-2">{p.apiKeyMasked}</p>
                    <div className="flex flex-wrap gap-1.5">
                      {p.models.map(m => (
                        <span key={m} className="text-xs bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 px-2 py-0.5 rounded font-mono">{m}</span>
                      ))}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      onClick={() => startEditProvider(p)}
                      className="text-gray-400 hover:text-blue-500 dark:hover:text-blue-400 transition-colors"
                      title="Edit provider"
                    >
                      <Pencil size={15} />
                    </button>
                    <button
                      onClick={() => deleteProvider(p.name)}
                      className="text-gray-400 hover:text-red-500 transition-colors"
                      title="Delete provider"
                    >
                      <Trash2 size={15} />
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Default model selector */}
        {status && status.models.length > 0 && (
          <div className="mb-5">
            <p className="text-sm text-gray-500 dark:text-gray-400 mb-2">Default model:</p>
            <div className="flex flex-wrap gap-2">
              {status.models.map((m) => (
                <button
                  key={m.model}
                  onClick={() => setDefaultModel(m.model)}
                  className={`px-3 py-1.5 rounded-lg text-sm font-mono flex items-center gap-1.5 transition-colors ${
                    m.model === status.defaultModel
                      ? 'bg-berry-100 dark:bg-berry-900 text-berry-700 dark:text-berry-300 border border-berry-300 dark:border-berry-700'
                      : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600 border border-transparent'
                  }`}
                >
                  {m.model === status.defaultModel && <Check size={14} />}
                  {m.model}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Add / Edit provider form */}
        <div className="border-t border-gray-100 dark:border-gray-700 pt-4">
          <div className="flex items-center justify-between mb-3">
            <p className="text-sm font-medium text-gray-600 dark:text-gray-300">
              {editingProvider ? `Edit: ${editingProvider}` : 'Add Provider'}
            </p>
            {editingProvider && (
              <button onClick={cancelProviderEdit} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300">
                <X size={16} />
              </button>
            )}
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <input
              className="settings-input"
              placeholder="Provider name (e.g. my-proxy)"
              value={providerForm.name}
              onChange={e => setProviderForm({ ...providerForm, name: e.target.value })}
              disabled={!!editingProvider}
            />
            <select
              className="settings-input"
              value={providerForm.type}
              onChange={e => setProviderForm({ ...providerForm, type: e.target.value as 'anthropic' | 'openai' })}
            >
              <option value="openai">OpenAI Protocol</option>
              <option value="anthropic">Anthropic Protocol</option>
            </select>
            <input
              className="settings-input"
              placeholder="Base URL (optional)"
              value={providerForm.baseUrl}
              onChange={e => setProviderForm({ ...providerForm, baseUrl: e.target.value })}
            />
            <input
              className="settings-input"
              type="password"
              placeholder={editingProvider ? 'API Key (leave blank to keep current)' : 'API Key'}
              value={providerForm.apiKey}
              onChange={e => setProviderForm({ ...providerForm, apiKey: e.target.value })}
            />
            <input
              className="settings-input sm:col-span-2"
              placeholder="Models (comma-separated, e.g. gpt-4o, gpt-4o-mini)"
              value={providerForm.models}
              onChange={e => setProviderForm({ ...providerForm, models: e.target.value })}
            />
          </div>
          <div className="flex gap-2 mt-3">
            <button onClick={saveProvider} className="px-4 py-2 bg-berry-600 hover:bg-berry-700 text-white rounded-lg text-sm font-medium flex items-center gap-2">
              {editingProvider ? <Check size={16} /> : <Plus size={16} />}
              {editingProvider ? 'Save Changes' : 'Add Provider'}
            </button>
            {editingProvider && (
              <button onClick={cancelProviderEdit} className="px-4 py-2 bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600 rounded-lg text-sm font-medium">
                Cancel
              </button>
            )}
          </div>
        </div>
      </section>

      {/* ===== Agents Section ===== */}
      <section className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-6 mb-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-gray-800 dark:text-gray-100 flex items-center gap-2">
            <Bot size={20} /> Agents
          </h2>
          {!showAgentForm && (
            <button onClick={startAddAgent} className="px-3 py-1.5 bg-berry-600 hover:bg-berry-700 text-white rounded-lg text-sm font-medium flex items-center gap-1.5">
              <Plus size={14} /> Add Agent
            </button>
          )}
        </div>

        {/* Agent list */}
        {agents.length > 0 && (
          <div className="space-y-2 mb-4">
            {agents.map((a) => (
              <div key={a.id} className={`flex items-center justify-between px-4 py-3 rounded-lg border ${
                a.id === activeAgent
                  ? 'border-berry-300 dark:border-berry-700 bg-berry-50 dark:bg-berry-900/30'
                  : 'border-gray-200 dark:border-gray-700'
              }`}>
                <div>
                  <span className="font-medium text-gray-800 dark:text-gray-200">{a.entry.name}</span>
                  <span className="text-xs text-gray-400 ml-2 font-mono">{a.entry.model}</span>
                  {a.entry.workspace && <span className="text-xs text-gray-400 ml-2">{a.entry.workspace}</span>}
                </div>
                <div className="flex items-center gap-2">
                  {a.id !== activeAgent && (
                    <button onClick={() => activateAgent(a.id)} className="text-xs px-3 py-1 bg-berry-100 dark:bg-berry-900 text-berry-700 dark:text-berry-300 rounded-lg hover:bg-berry-200 dark:hover:bg-berry-800">
                      Activate
                    </button>
                  )}
                  {a.id === activeAgent && (
                    <span className="text-xs px-3 py-1 bg-green-100 dark:bg-green-900 text-green-700 dark:text-green-300 rounded-lg">Active</span>
                  )}
                  <button
                    onClick={() => startEditAgent(a)}
                    className="text-gray-400 hover:text-blue-500 dark:hover:text-blue-400 transition-colors"
                    title="Edit agent"
                  >
                    <Pencil size={15} />
                  </button>
                  <button onClick={() => deleteAgent(a.id)} className="text-gray-400 hover:text-red-500 transition-colors">
                    <Trash2 size={15} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Add / Edit agent form */}
        {showAgentForm && (
          <div className="border-t border-gray-100 dark:border-gray-700 pt-4">
            <div className="flex items-center justify-between mb-3">
              <p className="text-sm font-medium text-gray-600 dark:text-gray-300">
                {editingAgent ? `Edit: ${editingAgent}` : 'New Agent'}
              </p>
              <button onClick={cancelAgentEdit} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300">
                <X size={16} />
              </button>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <input
                className="settings-input"
                placeholder="Display name"
                value={agentForm.name}
                onChange={e => handleAgentNameChange(e.target.value)}
              />
              <div className="relative">
                <input
                  className="settings-input w-full pr-14"
                  placeholder="Agent ID (auto-generated)"
                  value={agentForm.id}
                  readOnly={!!editingAgent}
                  onChange={e => {
                    if (!editingAgent) setAgentForm(prev => ({ ...prev, id: e.target.value, idManual: true }));
                  }}
                />
                {!editingAgent && (
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-gray-400 pointer-events-none">
                    {agentForm.idManual ? 'custom' : 'auto'}
                  </span>
                )}
              </div>
              {status && status.models.length > 0 ? (
                <select
                  className="settings-input sm:col-span-2"
                  value={agentForm.model}
                  onChange={e => setAgentForm({ ...agentForm, model: e.target.value })}
                >
                  <option value="">Select model…</option>
                  {status.models.map(m => (
                    <option key={m.model} value={m.model}>{m.model} ({m.providerName})</option>
                  ))}
                </select>
              ) : (
                <input
                  className="settings-input sm:col-span-2"
                  placeholder="Model (e.g. gpt-4o) — add a provider first"
                  value={agentForm.model}
                  onChange={e => setAgentForm({ ...agentForm, model: e.target.value })}
                />
              )}
              <input
                className="settings-input sm:col-span-2"
                placeholder={`Workspace (default: ${status?.workspace ?? '~'})`}
                value={agentForm.workspace}
                onChange={e => setAgentForm({ ...agentForm, workspace: e.target.value })}
              />
              <textarea
                className="settings-input sm:col-span-2 min-h-[80px]"
                placeholder="System prompt (optional — uses default if empty)"
                value={agentForm.systemPrompt}
                onChange={e => setAgentForm({ ...agentForm, systemPrompt: e.target.value })}
              />
            </div>
            <div className="flex gap-2 mt-3">
              <button onClick={saveAgent} className="px-4 py-2 bg-berry-600 hover:bg-berry-700 text-white rounded-lg text-sm font-medium flex items-center gap-2">
                {editingAgent ? <Check size={16} /> : <Plus size={16} />}
                {editingAgent ? 'Save Changes' : 'Add Agent'}
              </button>
              <button onClick={cancelAgentEdit} className="px-4 py-2 bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600 rounded-lg text-sm font-medium">
                Cancel
              </button>
            </div>
          </div>
        )}
      </section>

      {/* ===== Workspace Section ===== */}
      <section className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-6">
        <h2 className="text-lg font-semibold text-gray-800 dark:text-gray-100 mb-4 flex items-center gap-2">
          <FolderOpen size={20} /> Workspace
        </h2>
        <p className="text-sm text-gray-500 dark:text-gray-400">
          Current workspace:{' '}
          <code className="bg-gray-100 dark:bg-gray-700 px-2 py-0.5 rounded text-gray-700 dark:text-gray-300">
            {status?.workspace ?? '—'}
          </code>
        </p>
      </section>

      {/* Shared input styles */}
      <style>{`
        .settings-input {
          border: 1px solid #d1d5db;
          border-radius: 8px;
          padding: 8px 12px;
          font-size: 14px;
          outline: none;
          transition: border-color 0.2s;
          background: white;
          color: #1f2937;
          width: 100%;
        }
        .dark .settings-input {
          background: #1f2937;
          border-color: #4b5563;
          color: #e5e7eb;
        }
        .settings-input:focus {
          border-color: #6366f1;
          box-shadow: 0 0 0 2px rgba(99, 102, 241, 0.1);
        }
        .settings-input:disabled {
          opacity: 0.6;
          cursor: not-allowed;
        }
      `}</style>
    </div>
  );
}
