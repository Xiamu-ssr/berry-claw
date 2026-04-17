import { useState, useEffect, useCallback } from 'react';
import { Plus, Trash2, Play, Edit, Save, X, FolderOpen, ChevronDown, ChevronRight, Wrench, BookOpen, FileText, Loader2 } from 'lucide-react';
import { showToast } from './Toast';

interface AgentEntry {
  id: string;
  entry: {
    name: string;
    model: string;
    systemPrompt?: string;
    workspace?: string;
    tools?: string[];
    disabledTools?: string[];
    skillDirs?: string[];
    disabledSkills?: string[];
  };
}

interface ToolDef {
  name: string;
  description: string;
}

interface SkillMeta {
  name: string;
  description: string;
  dir: string;
}

interface InspectRuntime {
  tools: ToolDef[];
  skills: SkillMeta[];
  systemPrompt: string[];
  status?: string;
  statusDetail?: string;
  cwd?: string;
  workspace?: string;
  memory?: { available: boolean };
  compaction?: { threshold: number; contextWindow: number };
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
  const [expanded, setExpanded] = useState<string | null>(null);
  const [inspectData, setInspectData] = useState<Record<string, InspectRuntime | null>>({});
  const [inspectLoading, setInspectLoading] = useState<string | null>(null);
  const [form, setForm] = useState({ id: '', name: '', model: '', systemPrompt: '' });

  const loadInspect = useCallback(async (id: string) => {
    setInspectLoading(id);
    try {
      const res = await fetch(`/api/agents/${id}/inspect`);
      const data = await res.json();
      setInspectData(prev => ({ ...prev, [id]: data.runtime }));
    } finally {
      setInspectLoading(null);
    }
  }, []);

  const toggleExpand = useCallback((id: string) => {
    if (expanded === id) {
      setExpanded(null);
    } else {
      setExpanded(id);
      if (!inspectData[id]) void loadInspect(id);
    }
  }, [expanded, inspectData, loadInspect]);

  const toggleTool = useCallback(async (agent: AgentEntry, toolName: string) => {
    const disabled = new Set(agent.entry.disabledTools ?? []);
    if (disabled.has(toolName)) disabled.delete(toolName);
    else disabled.add(toolName);
    const res = await fetch(`/api/agents/${agent.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ disabledTools: [...disabled] }),
    });
    if (!res.ok) {
      showToast('Failed to toggle tool', 'error');
      return;
    }
    showToast(`${disabled.has(toolName) ? 'Disabled' : 'Enabled'} ${toolName}`);
    await fetchAgentsAndRefresh(agent.id);
  }, []);

  const toggleSkill = useCallback(async (agent: AgentEntry, skillName: string) => {
    const disabled = new Set(agent.entry.disabledSkills ?? []);
    if (disabled.has(skillName)) disabled.delete(skillName);
    else disabled.add(skillName);
    const res = await fetch(`/api/agents/${agent.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ disabledSkills: [...disabled] }),
    });
    if (!res.ok) {
      showToast('Failed to toggle skill', 'error');
      return;
    }
    showToast(`${disabled.has(skillName) ? 'Disabled' : 'Enabled'} ${skillName}`);
    await fetchAgentsAndRefresh(agent.id);
  }, []);

  const fetchAgentsAndRefresh = async (id?: string) => {
    await fetchAgents();
    if (id) await loadInspect(id);
  };

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
                    <button onClick={() => toggleExpand(agent.id)} title={expanded === agent.id ? 'Collapse' : 'Inspect'} className="p-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg text-gray-500 dark:text-gray-400 transition-colors">
                      {expanded === agent.id ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                    </button>
                    <button onClick={() => startEdit(agent)} title="Edit" className="p-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg text-gray-500 dark:text-gray-400 transition-colors">
                      <Edit size={16} />
                    </button>
                    <button onClick={() => handleDelete(agent.id)} title="Delete" className="p-2 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg text-gray-400 hover:text-red-500 transition-colors">
                      <Trash2 size={16} />
                    </button>
                  </div>
                </div>
              )}

              {/* Inspect panel */}
              {expanded === agent.id && editing !== agent.id && (
                <InspectPanel
                  agent={agent}
                  runtime={inspectData[agent.id] ?? null}
                  loading={inspectLoading === agent.id}
                  onToggleTool={(name) => toggleTool(agent, name)}
                  onToggleSkill={(name) => toggleSkill(agent, name)}
                />
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ============================================================
// InspectPanel — tools / skills / system prompt for a single agent
// ============================================================
function InspectPanel({
  agent,
  runtime,
  loading,
  onToggleTool,
  onToggleSkill,
}: {
  agent: AgentEntry;
  runtime: InspectRuntime | null;
  loading: boolean;
  onToggleTool: (name: string) => void;
  onToggleSkill: (name: string) => void;
}) {
  const [promptOpen, setPromptOpen] = useState(false);

  if (loading) {
    return (
      <div className="mt-4 pt-4 border-t border-gray-200 dark:border-gray-700 flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400">
        <Loader2 size={14} className="animate-spin" /> Loading agent runtime...
      </div>
    );
  }

  if (!runtime) {
    return (
      <div className="mt-4 pt-4 border-t border-gray-200 dark:border-gray-700 text-sm text-gray-400">
        No runtime data (agent may not be initialized yet).
      </div>
    );
  }

  const disabledTools = new Set(agent.entry.disabledTools ?? []);
  const disabledSkills = new Set(agent.entry.disabledSkills ?? []);
  const enabledToolCount = runtime.tools.filter(t => !disabledTools.has(t.name)).length;
  const enabledSkillCount = runtime.skills.filter(s => !disabledSkills.has(s.name)).length;

  return (
    <div className="mt-4 pt-4 border-t border-gray-200 dark:border-gray-700 space-y-5">
      {/* Runtime meta */}
      <div className="grid grid-cols-2 gap-3 text-xs">
        {runtime.workspace && (
          <div>
            <div className="text-gray-400 mb-0.5">Workspace</div>
            <div className="font-mono text-gray-600 dark:text-gray-300 truncate">{runtime.workspace}</div>
          </div>
        )}
        {runtime.compaction && (
          <div>
            <div className="text-gray-400 mb-0.5">Context window</div>
            <div className="font-mono text-gray-600 dark:text-gray-300">
              threshold {runtime.compaction.threshold.toLocaleString()} / {runtime.compaction.contextWindow.toLocaleString()}
            </div>
          </div>
        )}
        {runtime.memory && (
          <div>
            <div className="text-gray-400 mb-0.5">Memory</div>
            <div className="font-mono text-gray-600 dark:text-gray-300">
              {runtime.memory.available ? '✓ MEMORY.md mounted' : '✗ not mounted'}
            </div>
          </div>
        )}
      </div>

      {/* Tools */}
      <section>
        <h4 className="text-sm font-semibold text-gray-700 dark:text-gray-300 flex items-center gap-2 mb-2">
          <Wrench size={14} /> Tools <span className="text-xs text-gray-400 font-normal">({enabledToolCount}/{runtime.tools.length} enabled)</span>
        </h4>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {runtime.tools.map(tool => {
            const disabled = disabledTools.has(tool.name);
            return (
              <button
                key={tool.name}
                onClick={() => onToggleTool(tool.name)}
                className={`text-left rounded-lg p-2.5 border transition-colors ${
                  disabled
                    ? 'border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/40 opacity-60'
                    : 'border-green-200 dark:border-green-800 bg-green-50/40 dark:bg-green-900/10 hover:bg-green-50 dark:hover:bg-green-900/20'
                }`}
              >
                <div className="flex items-center gap-2 mb-0.5">
                  <span className={`w-1.5 h-1.5 rounded-full ${disabled ? 'bg-gray-400' : 'bg-green-500'}`} />
                  <span className="font-mono text-xs text-gray-700 dark:text-gray-300">{tool.name}</span>
                </div>
                <div className="text-xs text-gray-500 dark:text-gray-400 line-clamp-2">{tool.description}</div>
              </button>
            );
          })}
        </div>
      </section>

      {/* Skills */}
      {runtime.skills.length > 0 && (
        <section>
          <h4 className="text-sm font-semibold text-gray-700 dark:text-gray-300 flex items-center gap-2 mb-2">
            <BookOpen size={14} /> Skills <span className="text-xs text-gray-400 font-normal">({enabledSkillCount}/{runtime.skills.length} enabled)</span>
          </h4>
          <div className="space-y-2">
            {runtime.skills.map(skill => {
              const disabled = disabledSkills.has(skill.name);
              return (
                <button
                  key={skill.name}
                  onClick={() => onToggleSkill(skill.name)}
                  className={`w-full text-left rounded-lg p-3 border transition-colors ${
                    disabled
                      ? 'border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/40 opacity-60'
                      : 'border-blue-200 dark:border-blue-800 bg-blue-50/40 dark:bg-blue-900/10 hover:bg-blue-50 dark:hover:bg-blue-900/20'
                  }`}
                >
                  <div className="flex items-center gap-2 mb-0.5">
                    <span className={`w-1.5 h-1.5 rounded-full ${disabled ? 'bg-gray-400' : 'bg-blue-500'}`} />
                    <span className="font-medium text-sm text-gray-700 dark:text-gray-300">{skill.name}</span>
                  </div>
                  <div className="text-xs text-gray-500 dark:text-gray-400">{skill.description}</div>
                  <div className="text-xs text-gray-400 font-mono mt-1 truncate">{skill.dir}</div>
                </button>
              );
            })}
          </div>
        </section>
      )}

      {/* System prompt (collapsed by default) */}
      <section>
        <button
          onClick={() => setPromptOpen(v => !v)}
          className="text-sm font-semibold text-gray-700 dark:text-gray-300 flex items-center gap-2 mb-2 hover:text-gray-900 dark:hover:text-gray-100 transition-colors"
        >
          {promptOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          <FileText size={14} /> System Prompt
          <span className="text-xs text-gray-400 font-normal">({runtime.systemPrompt.length} blocks)</span>
        </button>
        {promptOpen && (
          <div className="space-y-2">
            {runtime.systemPrompt.map((block, i) => (
              <pre
                key={i}
                className="text-xs whitespace-pre-wrap bg-gray-50 dark:bg-gray-900 rounded-lg p-3 border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400 max-h-64 overflow-y-auto"
              >
                {block}
              </pre>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
