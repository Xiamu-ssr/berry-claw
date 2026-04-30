import { useState, useEffect, useCallback, useMemo } from 'react';
import { Plus, Trash2, Edit, Save, X, FolderOpen, ChevronDown, ChevronRight, Wrench, BookOpen, FileText, Loader2, Network, List, BarChart3, DollarSign, MessageSquare, Terminal, Zap, Plug, Sparkles } from 'lucide-react';
import AgentsGraph from './AgentsGraph';
import MemoryPanel from './MemoryPanel';
import { McpServerRow } from './SettingsPage';
import { showToast } from './Toast';
import { API } from '../api/paths';
import { useAgentFacts, useSystemFact } from '../facts/useFacts';
import type { AgentFact, InstalledSkill, MCPServerFact } from '../facts/types';

interface AgentEntry {
  id: string;
  entry: {
    name: string;
    model: string;
    systemPrompt?: string;
    workspace?: string;
    /** Optional path to the project root the agent works in. */
    project?: string;
    tools?: string[];
    disabledTools?: string[];
    skillDirs?: string[];
    disabledSkills?: string[];
    /** Market-installed skill whitelist (names). */
    enabledSkills?: string[];
    /** Present when this agent is a teammate — set by spawn_teammate. */
    team?: { leaderId: string; role: string };
  };
}

interface ToolDef {
  name: string;
  description: string;
  group?: string;
}

const GROUP_LABELS: Record<string, string> = {
  file: 'File',
  shell: 'Shell',
  search: 'Search',
  web: 'Web',
  memory: 'Memory',
  team: 'Team',
  agent: 'Agent',
  system: 'System',
  other: 'Other',
};

interface SkillMeta {
  name: string;
  description: string;
  dir: string;
}

interface PromptBlockInfo {
  id: string;
  source: 'project_context' | 'env' | 'builtin' | 'custom' | 'workspace_agent_md' | 'skills_index';
  title: string;
  description: string;
  order: number;
  active: boolean;
  scope: 'base' | 'query-time';
  cache: 'stable' | 'dynamic';
  editable: boolean;
  path?: string;
  text: string;
}

interface InspectRuntime {
  tools: ToolDef[];
  skills: SkillMeta[];
  systemPrompt: string[];
  promptBlocks?: PromptBlockInfo[];
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

/**
 * Adapter: turn an AgentFact (from FactStore) into the AgentEntry shape
 * this component was originally written against. Keeping the shim limited
 * to a single function makes later migration (to read facts directly)
 * trivial.
 */
function factToEntry(fact: AgentFact): AgentEntry {
  return {
    id: fact.id,
    entry: {
      name: fact.name,
      model: fact.model,
      systemPrompt: fact.systemPrompt,
      workspace: fact.workspace,
      project: fact.project,
      tools: fact.tools,
      disabledTools: fact.disabledTools,
      skillDirs: fact.skillDirs,
      disabledSkills: fact.disabledSkills,
      enabledSkills: fact.enabledSkills,
    },
  };
}

interface ObserveAgentStats {
  agentId: string;
  sessionCount: number;
  totalCost: number;
  llmCallCount: number;
  toolCallCount: number;
  avgCostPerSession: number;
}

export default function AgentsPage() {
  const agentFacts = useAgentFacts();
  const agents = useMemo(() => agentFacts.map(factToEntry), [agentFacts]);
  const activeAgent = agentFacts.find((a) => a.isActive)?.id ?? '';
  const statuses = useMemo(() => {
    const out: Record<string, { status: string; detail?: string }> = {};
    for (const f of agentFacts) out[f.id] = { status: f.status, detail: f.statusDetail };
    return out;
  }, [agentFacts]);

  const [models, setModels] = useState<ModelInfo[]>([]);
  const [editing, setEditing] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<'graph' | 'list'>('graph');
  const [inspectData, setInspectData] = useState<Record<string, InspectRuntime | null>>({});
  const [inspectLoading, setInspectLoading] = useState<string | null>(null);
  const [form, setForm] = useState({ id: '', name: '', model: '', systemPrompt: '', project: '' });

  /* ---- per-agent observe stats ---- */
  const [observeStats, setObserveStats] = useState<ObserveAgentStats[]>([]);

  const loadObserveStats = useCallback(async () => {
    try {
      const res = await fetch(`${API.observe}/agents`);
      if (!res.ok) return;
      const data = await res.json();
      setObserveStats(Array.isArray(data) ? data : []);
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    loadObserveStats();
    const id = setInterval(loadObserveStats, 30_000);
    return () => clearInterval(id);
  }, [loadObserveStats]);

  const loadInspect = useCallback(async (id: string) => {
    setInspectLoading(id);
    try {
      const res = await fetch(API.agentInspect(id));
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
    const res = await fetch(API.agent(agent.id), {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ disabledTools: [...disabled] }),
    });
    if (!res.ok) {
      showToast('Failed to toggle tool', 'error');
      return;
    }
    showToast(`${disabled.has(toolName) ? 'Disabled' : 'Enabled'} ${toolName}`);
    if (agent.id) await loadInspect(agent.id);
  }, [loadInspect]);

  const toggleSkill = useCallback(async (agent: AgentEntry, skillName: string) => {
    const disabled = new Set(agent.entry.disabledSkills ?? []);
    if (disabled.has(skillName)) disabled.delete(skillName);
    else disabled.add(skillName);
    const res = await fetch(API.agent(agent.id), {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ disabledSkills: [...disabled] }),
    });
    if (!res.ok) {
      showToast('Failed to toggle skill', 'error');
      return;
    }
    showToast(`${disabled.has(skillName) ? 'Disabled' : 'Enabled'} ${skillName}`);
    // No manual refresh — server PATCH emits an AgentFact via the bus.
    if (agent.id) await loadInspect(agent.id);
  }, [loadInspect]);

  // Models list is config-layer data, not per-agent runtime. We re-fetch on
  // mount and every time the user opens the Create/Edit form — Settings
  // mutations on the registry (provider order, labels, add/remove) only
  // land in this component via a fresh GET /api/models. Without this,
  // reordering providers in Settings leaves the "(providerName)" suffix
  // here stale until the tab is reloaded.
  const refetchModels = useCallback(() => {
    fetch(API.models).then(r => r.json()).then(d => setModels(d.models ?? []));
  }, []);
  useEffect(() => {
    refetchModels();
  }, [refetchModels]);

  const handleCreate = async () => {
    if (!form.id || !form.name || !form.model) return;
    await fetch(API.agent(form.id), {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: form.name,
        model: form.model,
        systemPrompt: form.systemPrompt || undefined,
        project: form.project.trim() || undefined,
      }),
    });
    setCreating(false);
    setForm({ id: '', name: '', model: '', systemPrompt: '', project: '' });
  };

  const handleUpdate = async (id: string) => {
    const agent = agents.find(a => a.id === id);
    if (!agent) return;
    await fetch(API.agent(id), {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...agent.entry,
        name: form.name || agent.entry.name,
        model: form.model || agent.entry.model,
        systemPrompt: form.systemPrompt,
        project: form.project.trim() || undefined,
      }),
    });
    setEditing(null);
  };

  const handleDelete = async (id: string) => {
    if (!confirm(`Delete agent "${id}"?`)) return;
    await fetch(API.agent(id), { method: 'DELETE' });
  };

  const startEdit = (agent: AgentEntry) => {
    refetchModels();
    setEditing(agent.id);
    setForm({
      id: agent.id,
      name: agent.entry.name,
      model: agent.entry.model,
      systemPrompt: agent.entry.systemPrompt || '',
      project: agent.entry.project || '',
    });
  };

  // Graph mode hijacks the entire canvas; the list / editor UI below
  // stays reachable by flipping the toggle. Clicking a graph node flips
  // back to list with `expanded` preset so the user lands on the card.
  if (viewMode === 'graph' && !creating && !editing) {
    return (
      <div className="flex-1 flex flex-col bg-white dark:bg-gray-900">
        <div className="flex items-center justify-between px-6 py-3 border-b border-gray-200 dark:border-gray-700">
          <h1 className="text-xl font-bold text-gray-900 dark:text-gray-100">🤖 Agents</h1>
          <div className="flex items-center gap-2">
            <div className="flex rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden">
              <button
                onClick={() => setViewMode('graph')}
                className={`px-2.5 py-1.5 text-xs flex items-center gap-1 ${viewMode === 'graph' ? 'bg-berry-600 text-white' : 'text-gray-500 hover:bg-gray-50 dark:hover:bg-gray-800'}`}
              ><Network size={13} />Graph</button>
              <button
                onClick={() => setViewMode('list')}
                className={`px-2.5 py-1.5 text-xs flex items-center gap-1 text-gray-500 hover:bg-gray-50 dark:hover:bg-gray-800`}
              ><List size={13} />List</button>
            </div>
            <button
              onClick={() => { refetchModels(); setCreating(true); setViewMode('list'); setForm({ id: '', name: '', model: models[0]?.model || '', systemPrompt: '', project: '' }); }}
              className="px-3 py-1.5 bg-berry-600 hover:bg-berry-700 text-white rounded-lg flex items-center gap-1.5 text-sm"
            >
              <Plus size={14} /> New Agent
            </button>
          </div>
        </div>
        <div className="flex-1">
          <AgentsGraph onSelect={(id) => { setExpanded(id); setViewMode('list'); if (!inspectData[id]) void loadInspect(id); }} />
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto p-6 bg-white dark:bg-gray-900">
      <div className="max-w-3xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">🤖 Agents</h1>
          <div className="flex items-center gap-2">
            <div className="flex rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden">
              <button
                onClick={() => setViewMode('graph')}
                className="px-2.5 py-1.5 text-xs flex items-center gap-1 text-gray-500 hover:bg-gray-50 dark:hover:bg-gray-800"
              ><Network size={13} />Graph</button>
              <button
                onClick={() => setViewMode('list')}
                className="px-2.5 py-1.5 text-xs flex items-center gap-1 bg-berry-600 text-white"
              ><List size={13} />List</button>
            </div>
            <button
              onClick={() => { refetchModels(); setCreating(true); setForm({ id: '', name: '', model: models[0]?.model || '', systemPrompt: '', project: '' }); }}
              className="px-4 py-2 bg-berry-600 hover:bg-berry-700 text-white rounded-lg flex items-center gap-2 transition-colors"
            >
              <Plus size={16} /> New Agent
            </button>
          </div>
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
            <div className="mb-3">
              <input
                placeholder="Project root (optional, absolute path). Enables project-scoped cwd + AGENTS.md injection."
                value={form.project}
                onChange={e => setForm(f => ({ ...f, project: e.target.value }))}
                className="w-full px-3 py-2 border rounded-lg bg-white dark:bg-gray-700 dark:border-gray-600 dark:text-gray-100 text-sm font-mono"
              />
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                Leave empty for a general-purpose agent. When set, the agent works inside the project, reads its AGENTS.md, and shares <code>.berry/</code> data with teammates.
              </p>
            </div>
            <div className="flex gap-2">
              <button onClick={handleCreate} className="px-4 py-2 bg-berry-600 hover:bg-berry-700 text-white rounded-lg text-sm flex items-center gap-1"><Save size={14} /> Create</button>
              <button onClick={() => setCreating(false)} className="px-4 py-2 bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-lg text-sm flex items-center gap-1"><X size={14} /> Cancel</button>
            </div>
          </div>
        )}

        {/* Agent list */}
        {agents.length === 0 && !creating && (
          <div className="text-center py-16 rounded-xl border-2 border-dashed border-gray-200 dark:border-gray-700">
            <p className="text-lg font-medium text-gray-700 dark:text-gray-200 mb-1">No agents yet</p>
            <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">Create your first agent to start chatting</p>
            <button
              onClick={() => { refetchModels(); setCreating(true); }}
              className="inline-flex items-center gap-1.5 bg-berry-500 hover:bg-berry-600 text-white text-sm rounded-lg px-4 py-2"
            >
              <Plus size={16} /> Create Agent
            </button>
          </div>
        )}

        <div className="space-y-3">
          {agents.map(agent => (
            <div
              key={agent.id}
              className={`rounded-xl p-4 border transition-all ${
                activeAgent === agent.id
                  ? 'border-berry-400 bg-berry-50 dark:bg-berry-900/20 dark:border-berry-600 shadow-sm'
                  : 'border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 hover:border-gray-300 dark:hover:border-gray-600 hover:shadow-sm'
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
                  <input
                    value={form.project}
                    onChange={e => setForm(f => ({ ...f, project: e.target.value }))}
                    placeholder="Project root (optional, absolute path)"
                    className="w-full px-3 py-2 border rounded-lg mb-3 bg-white dark:bg-gray-700 dark:border-gray-600 dark:text-gray-100 text-sm font-mono"
                  />
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
                      <StatusPill info={statuses[agent.id]} />
                      {agent.entry.team && (
                        <span
                          className="text-[10px] px-2 py-0.5 bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 rounded-full font-medium"
                          title={`Teammate in team led by ${agent.entry.team.leaderId}`}
                        >
                          teammate of {agent.entry.team.leaderId}
                        </span>
                      )}
                    </div>
                    <div className="text-sm text-gray-500 dark:text-gray-400 mb-1">
                      Model: <span className="font-mono text-xs">{agent.entry.model}</span>
                    </div>
                    {agent.entry.project && (
                      <div className="text-xs text-berry-600 dark:text-berry-400 flex items-center gap-1 font-mono" title="Project root (shared workspace)">
                        <FolderOpen size={12} className="shrink-0" /> {agent.entry.project}
                        <span className="text-[10px] px-1 py-0.5 bg-berry-100 dark:bg-berry-900/30 rounded ml-1">project</span>
                      </div>
                    )}
                    {agent.entry.workspace && (
                      <div className="text-xs text-gray-500 dark:text-gray-400 flex items-center gap-1 font-mono" title="Agent's private workspace (memory, notes, identity)">
                        <FolderOpen size={12} className="shrink-0" /> {agent.entry.workspace}
                      </div>
                    )}
                    {/* Per-agent observe stats */}
                    <AgentStatsRow agentId={agent.id} stats={observeStats} />
                  </div>
                  <div className="flex items-center gap-1 ml-4">
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
                <>
                  <InspectPanel
                    agent={agent}
                    runtime={inspectData[agent.id] ?? null}
                    loading={inspectLoading === agent.id}
                    onToggleTool={(name) => toggleTool(agent, name)}
                    onToggleSkill={(name) => toggleSkill(agent, name)}
                    onReload={() => loadInspect(agent.id)}
                  />
                  <div className="mt-4 pt-4 border-t border-gray-200 dark:border-gray-700">
                    <MemoryPanel agentId={agent.id} hasProject={!!agent.entry.project} />
                  </div>
                  <MCPPanel mcp={agentFacts.find((f) => f.id === agent.id)?.mcp} />
                  <SkillsPanel agentId={agent.id} enabled={agent.entry.enabledSkills ?? []} />
                </>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ============================================================
// MCPPanel — per-agent MCP servers (reads AgentFact.mcp directly).
// Shared/global MCP servers live on Settings → MCP tab.
// ============================================================
function MCPPanel({ mcp }: { mcp?: MCPServerFact[] }) {
  if (!mcp || mcp.length === 0) return null;
  return (
    <div className="mt-4 pt-4 border-t border-gray-200 dark:border-gray-700">
      <h4 className="text-sm font-semibold text-gray-700 dark:text-gray-300 flex items-center gap-2 mb-2">
        <Plug size={14} /> MCP Servers
        <span className="text-xs text-gray-400 font-normal">(per-agent)</span>
      </h4>
      <div className="space-y-2">
        {mcp.map((s) => (
          <McpServerRow key={s.name} server={s} />
        ))}
      </div>
    </div>
  );
}

// ============================================================
// SkillsPanel — per-agent whitelist over globally-installed skills.
//
// The Skill Market pool lives at ~/.berry-claw/skills/ and is reflected
// on SystemFact.installedSkills. This panel lets the user toggle which of
// those skills are visible to a given agent — toggling sends a PATCH to
// /api/agents/:id with the merged enabledSkills array; the server emits
// an AgentFact update and the checkbox re-renders from the bus.
// ============================================================
function SkillsPanel({ agentId, enabled }: { agentId: string; enabled: string[] }) {
  const system = useSystemFact();
  const installed: InstalledSkill[] = system?.installedSkills ?? [];
  const enabledSet = new Set(enabled);
  const [pendingName, setPendingName] = useState<string | null>(null);

  const toggle = async (name: string, on: boolean) => {
    setPendingName(name);
    const next = new Set(enabled);
    if (on) next.add(name);
    else next.delete(name);
    try {
      const res = await fetch(API.agent(agentId), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabledSkills: [...next] }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      showToast(`${on ? 'Enabled' : 'Disabled'} ${name}`);
    } catch (err: any) {
      showToast(`Toggle failed: ${err.message}`, 'error');
    } finally {
      setPendingName(null);
    }
  };

  return (
    <div className="mt-4 pt-4 border-t border-gray-200 dark:border-gray-700">
      <h4 className="text-sm font-semibold text-gray-700 dark:text-gray-300 flex items-center gap-2 mb-2">
        <Sparkles size={14} /> Market Skills
        <span className="text-xs text-gray-400 font-normal">
          (installed in global pool)
        </span>
      </h4>
      {installed.length === 0 ? (
        <div className="text-xs italic text-gray-500 dark:text-gray-400">
          No skills installed globally yet. Visit the <b>Skill Market</b> tab to install some.
        </div>
      ) : (
        <div className="space-y-1">
          {installed.map((s) => {
            const on = enabledSet.has(s.name);
            const busy = pendingName === s.name;
            return (
              <label
                key={s.name}
                className="flex items-start gap-2 p-2 rounded hover:bg-gray-50 dark:hover:bg-gray-800/50 cursor-pointer"
              >
                <input
                  type="checkbox"
                  checked={on}
                  disabled={busy}
                  onChange={(e) => toggle(s.name, e.target.checked)}
                  className="mt-0.5 accent-berry-500"
                />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-gray-800 dark:text-gray-200 truncate">
                      {s.name}
                    </span>
                    {s.source && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400">
                        {s.source}
                      </span>
                    )}
                    {busy && <Loader2 size={12} className="animate-spin text-gray-400" />}
                  </div>
                  {s.description && (
                    <div className="text-xs text-gray-500 dark:text-gray-400 mt-0.5 line-clamp-2">
                      {s.description}
                    </div>
                  )}
                </div>
              </label>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ============================================================
// AgentStatsRow — per-agent observe stats (sessions, cost, calls)
// ============================================================
function AgentStatsRow({ agentId, stats }: { agentId: string; stats: ObserveAgentStats[] }) {
  const s = stats.find((x) => x.agentId === agentId);
  if (!s || s.sessionCount === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-3 mt-2 text-[11px]">
      <div className="flex items-center gap-1 text-gray-500 dark:text-gray-400" title="Sessions">
        <MessageSquare size={11} />
        <span>{s.sessionCount}</span>
      </div>
      <div className="flex items-center gap-1 text-gray-500 dark:text-gray-400" title="API Calls">
        <Zap size={11} />
        <span>{s.llmCallCount}</span>
      </div>
      <div className="flex items-center gap-1 text-gray-500 dark:text-gray-400" title="Tool Calls">
        <Terminal size={11} />
        <span>{s.toolCallCount}</span>
      </div>
      <div className="flex items-center gap-1 text-gray-500 dark:text-gray-400" title="Total Cost">
        <DollarSign size={11} />
        <span>${s.totalCost.toFixed(4)}</span>
      </div>
      {s.avgCostPerSession > 0 && (
        <div className="flex items-center gap-1 text-gray-500 dark:text-gray-400" title="Avg Cost / Session">
          <BarChart3 size={11} />
          <span>${s.avgCostPerSession.toFixed(4)}/ses</span>
        </div>
      )}
    </div>
  );
}

// ============================================================
// StatusPill — tiny runtime status badge per agent card
// ============================================================
function StatusPill({ info }: { info?: { status: string; detail?: string } }) {
  if (!info) return null;
  const s = info.status;
  const map: Record<string, { emoji: string; label: string; cls: string }> = {
    idle:             { emoji: '●', label: 'idle',      cls: 'bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400' },
    thinking:         { emoji: '💡', label: 'thinking',  cls: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300' },
    tool_executing:   { emoji: '🔨', label: 'tool',      cls: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300' },
    compacting:       { emoji: '📚', label: 'compact',   cls: 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300' },
    memory_flushing:  { emoji: '🧠', label: 'memory',    cls: 'bg-pink-100 text-pink-700 dark:bg-pink-900/30 dark:text-pink-300' },
    delegating:       { emoji: '👥', label: 'delegate',  cls: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300' },
    sleeping:         { emoji: '💤', label: 'sleeping',  cls: 'bg-cyan-100 text-cyan-700 dark:bg-cyan-900/30 dark:text-cyan-300' },
    error:            { emoji: '❌', label: 'error',     cls: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300' },
  };
  const c = map[s] ?? { emoji: '○', label: s, cls: 'bg-gray-100 text-gray-500' };
  return (
    <span
      className={`text-xs px-2 py-0.5 rounded-full flex items-center gap-1 ${c.cls}`}
      title={info.detail ? `${c.label} — ${info.detail}` : c.label}
    >
      <span>{c.emoji}</span>
      <span>{c.label}</span>
    </span>
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
  onReload,
}: {
  agent: AgentEntry;
  runtime: InspectRuntime | null;
  loading: boolean;
  onToggleTool: (name: string) => void;
  onToggleSkill: (name: string) => void;
  onReload: () => void;
}) {
  const [promptOpen, setPromptOpen] = useState(false);
  const [savingBlockId, setSavingBlockId] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});

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
  const promptBlocks = runtime.promptBlocks ?? runtime.systemPrompt.map((text, i) => ({
    id: `legacy:${i}`,
    source: 'builtin' as const,
    title: `System prompt block ${i + 1}`,
    description: 'Legacy inspect fallback.',
    order: i,
    active: true,
    scope: 'base' as const,
    cache: 'stable' as const,
    editable: false,
    path: undefined,
    text,
  }));
  const activePromptCount = promptBlocks.filter((block) => block.active).length;

  const handleSavePromptBlock = async (block: PromptBlockInfo) => {
    setSavingBlockId(block.id);
    try {
      const res = await fetch(API.agentPromptBlock(agent.id, block.id), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: drafts[block.id] ?? block.text }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Failed to save prompt block');
      }
      showToast(`Saved ${block.title}`);
      await onReload();
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to save prompt block', 'error');
    } finally {
      setSavingBlockId(null);
    }
  };

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
        <div className="space-y-3">
          {Array.from(
            runtime.tools.reduce((map, tool) => {
              const group = tool.group || 'other';
              if (!map.has(group)) map.set(group, []);
              map.get(group)!.push(tool);
              return map;
            }, new Map<string, ToolDef[]>()).entries()
          ).map(([group, tools]) => (
            <div key={group}>
              <div className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-1.5">{GROUP_LABELS[group] || group}</div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {tools.map(tool => {
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
            </div>
          ))}
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

      {/* System Prompt blocks (collapsed by default) */}
      <section>
        <button
          onClick={() => setPromptOpen(v => !v)}
          className="text-sm font-semibold text-gray-700 dark:text-gray-300 flex items-center gap-2 mb-2 hover:text-gray-900 dark:hover:text-gray-100 transition-colors"
        >
          {promptOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          <FileText size={14} /> System Prompt
          <span className="text-xs text-gray-400 font-normal">({activePromptCount}/{promptBlocks.length} active)</span>
        </button>
        {promptOpen && (
          <div className="space-y-3">
            {promptBlocks
              .slice()
              .sort((a, b) => a.order - b.order)
              .map((block) => {
                const draft = drafts[block.id] ?? block.text;
                return (
                  <div
                    key={block.id}
                    className={`rounded-lg border p-3 ${
                      block.active
                        ? 'border-gray-200 dark:border-gray-700 bg-gray-50/70 dark:bg-gray-900/40'
                        : 'border-dashed border-gray-200 dark:border-gray-700 bg-gray-50/40 dark:bg-gray-900/20 opacity-75'
                    }`}
                  >
                    <div className="flex flex-wrap items-center gap-2 mb-2">
                      <div className="font-medium text-sm text-gray-800 dark:text-gray-200">{block.title}</div>
                      <span className={`text-[10px] px-2 py-0.5 rounded-full ${block.active ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300' : 'bg-gray-200 dark:bg-gray-800 text-gray-500 dark:text-gray-400'}`}>
                        {block.active ? 'active' : 'inactive'}
                      </span>
                      <span className="text-[10px] px-2 py-0.5 rounded-full bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300">{block.scope}</span>
                      <span className="text-[10px] px-2 py-0.5 rounded-full bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300">cache:{block.cache}</span>
                      {block.editable && (
                        <span className="text-[10px] px-2 py-0.5 rounded-full bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300">editable</span>
                      )}
                    </div>
                    <div className="text-xs text-gray-500 dark:text-gray-400 mb-2">{block.description}</div>
                    {block.path && (
                      <div className="text-[11px] font-mono text-gray-400 mb-2 break-all">{block.path}</div>
                    )}
                    {block.editable ? (
                      <>
                        <textarea
                          value={draft}
                          onChange={(e) => setDrafts((prev) => ({ ...prev, [block.id]: e.target.value }))}
                          className="w-full px-3 py-2 border rounded-lg bg-white dark:bg-gray-800 dark:border-gray-600 dark:text-gray-100 text-xs font-mono h-32 resize-y"
                        />
                        <div className="mt-2 flex justify-end">
                          <button
                            onClick={() => handleSavePromptBlock(block)}
                            disabled={savingBlockId === block.id}
                            className="px-3 py-1.5 bg-berry-600 hover:bg-berry-700 disabled:opacity-60 text-white rounded-lg text-xs flex items-center gap-1"
                          >
                            {savingBlockId === block.id ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />}
                            Save source
                          </button>
                        </div>
                      </>
                    ) : (
                      <pre className="text-xs whitespace-pre-wrap bg-white dark:bg-gray-900 rounded-lg p-3 border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400 max-h-64 overflow-y-auto">
                        {block.text || '(empty)'}
                      </pre>
                    )}
                  </div>
                );
              })}
          </div>
        )}
      </section>
    </div>
  );
}
