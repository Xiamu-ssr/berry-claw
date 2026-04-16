import { useState, useEffect, useCallback } from 'react';
import { Plus, Trash2, Play, Edit, Save, X, FolderOpen } from 'lucide-react';

interface AgentEntry {
  id: string;
  entry: {
    name: string;
    model: string;
    systemPrompt?: string;
    workspace?: string;
    tools?: string[];
  };
}

interface ModelInfo {
  model: string;
  providerName: string;
  type: string;
}

export default function AgentsPage() {
  const [agents, setAgents] = useState<AgentEntry[]>([]);
  const [activeAgent, setActiveAgent] = useState('');
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [editing, setEditing] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ id: '', name: '', model: '', systemPrompt: '' });

  const fetchAgents = useCallback(async () => {
    const res = await fetch('/api/agents');
    const data = await res.json();
    setAgents(data.agents);
    setActiveAgent(data.activeAgent);
  }, []);

  const fetchModels = useCallback(async () => {
    const res = await fetch('/api/models');
    const data = await res.json();
    setModels(data.models);
  }, []);

  useEffect(() => { fetchAgents(); fetchModels(); }, [fetchAgents, fetchModels]);

  const handleCreate = async () => {
    if (!form.id || !form.name || !form.model) return;
    await fetch(`/api/agents/${form.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: form.name, model: form.model, systemPrompt: form.systemPrompt || undefined }),
    });
    setCreating(false);
    setForm({ id: '', name: '', model: '', systemPrompt: '' });
    fetchAgents();
  };

  const handleUpdate = async (id: string) => {
    const agent = agents.find(a => a.id === id);
    if (!agent) return;
    await fetch(`/api/agents/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...agent.entry, name: form.name || agent.entry.name, model: form.model || agent.entry.model, systemPrompt: form.systemPrompt }),
    });
    setEditing(null);
    fetchAgents();
  };

  const handleDelete = async (id: string) => {
    if (!confirm(`Delete agent "${id}"?`)) return;
    await fetch(`/api/agents/${id}`, { method: 'DELETE' });
    fetchAgents();
  };

  const handleActivate = async (id: string) => {
    await fetch(`/api/agents/${id}/activate`, { method: 'POST' });
    setActiveAgent(id);
  };

  const startEdit = (agent: AgentEntry) => {
    setEditing(agent.id);
    setForm({ id: agent.id, name: agent.entry.name, model: agent.entry.model, systemPrompt: agent.entry.systemPrompt || '' });
  };

  return (
    <div className="flex-1 overflow-y-auto p-6 bg-white dark:bg-gray-900">
      <div className="max-w-3xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">🤖 Agents</h1>
          <button
            onClick={() => { setCreating(true); setForm({ id: '', name: '', model: models[0]?.model || '', systemPrompt: '' }); }}
            className="px-4 py-2 bg-berry-600 hover:bg-berry-700 text-white rounded-lg flex items-center gap-2 transition-colors"
          >
            <Plus size={16} /> New Agent
          </button>
        </div>

        {/* Create form */}
        {creating && (
          <div className="bg-gray-50 dark:bg-gray-800 rounded-xl p-5 mb-4 border border-gray-200 dark:border-gray-700">
            <h3 className="font-semibold text-gray-800 dark:text-gray-200 mb-3">Create Agent</h3>
            <div className="grid grid-cols-2 gap-3 mb-3">
              <input
                placeholder="Agent ID (e.g. coder)"
                value={form.id}
                onChange={e => setForm(f => ({ ...f, id: e.target.value.replace(/[^a-z0-9-_]/g, '') }))}
                className="px-3 py-2 border rounded-lg bg-white dark:bg-gray-700 dark:border-gray-600 dark:text-gray-100 text-sm"
              />
              <input
                placeholder="Display Name"
                value={form.name}
                onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                className="px-3 py-2 border rounded-lg bg-white dark:bg-gray-700 dark:border-gray-600 dark:text-gray-100 text-sm"
              />
            </div>
            <select
              value={form.model}
              onChange={e => setForm(f => ({ ...f, model: e.target.value }))}
              className="w-full px-3 py-2 border rounded-lg mb-3 bg-white dark:bg-gray-700 dark:border-gray-600 dark:text-gray-100 text-sm"
            >
              {models.map(m => <option key={m.model} value={m.model}>{m.model} ({m.providerName})</option>)}
            </select>
            <textarea
              placeholder="System prompt (optional, or edit AGENT.md in workspace)"
              value={form.systemPrompt}
              onChange={e => setForm(f => ({ ...f, systemPrompt: e.target.value }))}
              className="w-full px-3 py-2 border rounded-lg mb-3 bg-white dark:bg-gray-700 dark:border-gray-600 dark:text-gray-100 text-sm h-20 resize-y"
            />
            <div className="flex gap-2">
              <button onClick={handleCreate} className="px-4 py-2 bg-berry-600 hover:bg-berry-700 text-white rounded-lg text-sm flex items-center gap-1"><Save size={14} /> Create</button>
              <button onClick={() => setCreating(false)} className="px-4 py-2 bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-lg text-sm flex items-center gap-1"><X size={14} /> Cancel</button>
            </div>
          </div>
        )}

        {/* Agent list */}
        {agents.length === 0 && !creating && (
          <div className="text-center py-16 text-gray-400">
            <p className="text-lg mb-2">No agents yet</p>
            <p className="text-sm">Create your first agent to start chatting</p>
          </div>
        )}

        <div className="space-y-3">
          {agents.map(agent => (
            <div
              key={agent.id}
              className={`rounded-xl p-4 border transition-colors ${
                activeAgent === agent.id
                  ? 'border-berry-400 bg-berry-50 dark:bg-berry-900/20 dark:border-berry-600'
                  : 'border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800'
              }`}
            >
              {editing === agent.id ? (
                /* Edit mode */
                <div>
                  <div className="grid grid-cols-2 gap-3 mb-3">
                    <input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} className="px-3 py-2 border rounded-lg bg-white dark:bg-gray-700 dark:border-gray-600 dark:text-gray-100 text-sm" />
                    <select value={form.model} onChange={e => setForm(f => ({ ...f, model: e.target.value }))} className="px-3 py-2 border rounded-lg bg-white dark:bg-gray-700 dark:border-gray-600 dark:text-gray-100 text-sm">
                      {models.map(m => <option key={m.model} value={m.model}>{m.model}</option>)}
                    </select>
                  </div>
                  <textarea value={form.systemPrompt} onChange={e => setForm(f => ({ ...f, systemPrompt: e.target.value }))} className="w-full px-3 py-2 border rounded-lg mb-3 bg-white dark:bg-gray-700 dark:border-gray-600 dark:text-gray-100 text-sm h-20 resize-y" placeholder="System prompt" />
                  <div className="flex gap-2">
                    <button onClick={() => handleUpdate(agent.id)} className="px-3 py-1.5 bg-berry-600 text-white rounded-lg text-sm flex items-center gap-1"><Save size={14} /> Save</button>
                    <button onClick={() => setEditing(null)} className="px-3 py-1.5 bg-gray-200 dark:bg-gray-700 text-gray-600 dark:text-gray-300 rounded-lg text-sm"><X size={14} /></button>
                  </div>
                </div>
              ) : (
                /* View mode */
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="font-semibold text-gray-900 dark:text-gray-100">{agent.entry.name}</span>
                      <span className="text-xs px-2 py-0.5 bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400 rounded-full font-mono">{agent.id}</span>
                      {activeAgent === agent.id && (
                        <span className="text-xs px-2 py-0.5 bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400 rounded-full">Active</span>
                      )}
                    </div>
                    <div className="text-sm text-gray-500 dark:text-gray-400 mb-1">
                      Model: <span className="font-mono text-xs">{agent.entry.model}</span>
                    </div>
                    {agent.entry.workspace && (
                      <div className="text-xs text-gray-400 flex items-center gap-1">
                        <FolderOpen size={12} /> {agent.entry.workspace}
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-1 ml-4">
                    {activeAgent !== agent.id && (
                      <button onClick={() => handleActivate(agent.id)} title="Activate" className="p-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg text-gray-500 dark:text-gray-400 transition-colors">
                        <Play size={16} />
                      </button>
                    )}
                    <button onClick={() => startEdit(agent)} title="Edit" className="p-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg text-gray-500 dark:text-gray-400 transition-colors">
                      <Edit size={16} />
                    </button>
                    <button onClick={() => handleDelete(agent.id)} title="Delete" className="p-2 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg text-gray-400 hover:text-red-500 transition-colors">
                      <Trash2 size={16} />
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
