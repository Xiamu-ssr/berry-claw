/**
 * TeamsPage — top-level UI for team mode (v1).
 *
 * UX goals (per lanxuan 2026-04-22):
 *   - Creating a team should be 3 fields and one button. Never more.
 *   - After creating, drop the user straight into the team view.
 *   - Team view = three columns: members / chat with leader / inter-agent log.
 *
 * Data flow:
 *   - GET  /api/teams                          list
 *   - POST /api/agents/:id/team/start          create / reopen
 *   - GET  /api/agents/:id/team                snapshot
 *   - GET  /api/agents/:id/team/messages       inter-agent log
 *   - Human chat with leader uses the same chat API as the main tab; we
 *     reuse the existing ChatArea + useWebSocket by flipping activeAgent
 *     to the leader. For v1 the Teams tab embeds ChatArea via the same
 *     hook; no new WS event types are introduced.
 */
import { useState, useEffect, useCallback } from 'react';
import { Users, Plus, Crown, FolderOpen, RefreshCw, ArrowLeft, MessageSquare } from 'lucide-react';
import { showToast } from './Toast';

interface TeammateRecord {
  id: string;
  role: string;
  systemPrompt: string;
  model?: string;
  createdAt: number;
}

interface TeamState {
  name: string;
  project: string;
  leaderId: string;
  teammates: TeammateRecord[];
  createdAt: number;
}

interface TeamListItem {
  leaderId: string;
  leaderName: string;
  state: TeamState;
}

interface AgentSummary {
  id: string;
  entry: { name: string; model: string; project?: string };
}

interface TeamMessage {
  id: string;
  ts: number;
  from: string;
  to: string;
  content: string;
  replyTo?: string;
}

export default function TeamsPage() {
  const [teams, setTeams] = useState<TeamListItem[]>([]);
  const [agents, setAgents] = useState<AgentSummary[]>([]);
  const [selectedLeader, setSelectedLeader] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const fetchTeams = useCallback(async () => {
    const res = await fetch('/api/teams');
    const data = await res.json();
    setTeams(data.teams || []);
  }, []);

  const fetchAgents = useCallback(async () => {
    const res = await fetch('/api/agents');
    const data = await res.json();
    setAgents(data.agents || []);
  }, []);

  useEffect(() => {
    fetchTeams();
    fetchAgents();
  }, [fetchTeams, fetchAgents]);

  // Detail view
  if (selectedLeader) {
    return (
      <TeamDetailView
        leaderId={selectedLeader}
        onBack={() => {
          setSelectedLeader(null);
          fetchTeams();
        }}
      />
    );
  }

  // List view
  return (
    <div className="flex-1 overflow-y-auto p-6 bg-white dark:bg-gray-900">
      <div className="max-w-4xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100 flex items-center gap-2">
              <Users size={24} /> Teams
            </h1>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
              A team is a leader agent + teammates sharing a project workspace.
            </p>
          </div>
          <button
            onClick={() => setCreating(true)}
            className="px-4 py-2 bg-berry-600 hover:bg-berry-700 text-white rounded-lg flex items-center gap-2 transition-colors"
          >
            <Plus size={16} /> New Team
          </button>
        </div>

        {creating && (
          <NewTeamModal
            agents={agents}
            onClose={() => setCreating(false)}
            onCreated={(leaderId) => {
              setCreating(false);
              fetchTeams();
              setSelectedLeader(leaderId);
            }}
          />
        )}

        {teams.length === 0 && !creating && (
          <div className="text-center py-16 rounded-xl border-2 border-dashed border-gray-200 dark:border-gray-700">
            <Users size={32} className="mx-auto text-gray-400 dark:text-gray-500 mb-3" />
            <p className="text-lg font-medium text-gray-700 dark:text-gray-200 mb-1">No teams yet</p>
            <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
              Start a team to orchestrate multiple agents on one project.
            </p>
            <button
              onClick={() => setCreating(true)}
              className="inline-flex items-center gap-1.5 bg-berry-500 hover:bg-berry-600 text-white text-sm rounded-lg px-4 py-2"
            >
              <Plus size={16} /> Create Team
            </button>
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {teams.map((t) => (
            <button
              key={t.leaderId}
              onClick={() => setSelectedLeader(t.leaderId)}
              className="text-left rounded-xl p-4 border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 hover:border-berry-400 hover:shadow-sm transition-all"
            >
              <div className="flex items-center gap-2 mb-2">
                <Users size={16} className="text-berry-600 dark:text-berry-400" />
                <span className="font-semibold text-gray-900 dark:text-gray-100 truncate">{t.state.name}</span>
              </div>
              <div className="text-sm text-gray-600 dark:text-gray-300 flex items-center gap-1 mb-1">
                <Crown size={12} className="shrink-0 text-amber-500" />
                <span className="truncate">{t.leaderName}</span>
                <span className="text-xs text-gray-400 font-mono">({t.leaderId})</span>
              </div>
              <div className="text-xs text-gray-500 dark:text-gray-400 flex items-center gap-1 font-mono truncate mb-2">
                <FolderOpen size={12} className="shrink-0" />
                {t.state.project}
              </div>
              <div className="text-xs text-gray-500 dark:text-gray-400">
                {t.state.teammates.length} teammate{t.state.teammates.length === 1 ? '' : 's'}
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

/**
 * 3-field create form. The leader dropdown only shows agents that have a
 * project bound — a team without a shared workspace is meaningless in v1,
 * and creating one from scratch here would require even more fields. When
 * the user has no project-bound agents yet, we point them at the Agents
 * tab instead of silently failing.
 */
function NewTeamModal({
  agents,
  onClose,
  onCreated,
}: {
  agents: AgentSummary[];
  onClose: () => void;
  onCreated: (leaderId: string) => void;
}) {
  const eligible = agents.filter((a) => !!a.entry.project);
  const [form, setForm] = useState({
    name: '',
    leaderId: eligible[0]?.id ?? '',
  });
  const [busy, setBusy] = useState(false);

  const leader = agents.find((a) => a.id === form.leaderId);

  const handleCreate = async () => {
    if (!form.leaderId) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/agents/${form.leaderId}/team/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: form.name.trim() || 'team' }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to start team');
      showToast({ variant: 'info', title: 'Team started', message: `${form.name.trim() || 'team'} is live` });
      onCreated(form.leaderId);
    } catch (err: any) {
      showToast({ variant: 'error', title: 'Failed to start team', message: err.message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="bg-white dark:bg-gray-800 rounded-xl p-6 w-full max-w-md border border-gray-200 dark:border-gray-700 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4">New Team</h2>

        <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
          Team name
        </label>
        <input
          placeholder="e.g. Frontend Squad"
          value={form.name}
          onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
          className="w-full px-3 py-2 border rounded-lg mb-4 bg-white dark:bg-gray-700 dark:border-gray-600 dark:text-gray-100 text-sm"
        />

        <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
          Leader (must be bound to a project)
        </label>
        {eligible.length === 0 ? (
          <div className="border border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-900/20 rounded-lg p-3 text-sm text-amber-900 dark:text-amber-200 mb-4">
            No agents are bound to a project yet. Open the <strong>Agents</strong> tab, edit an agent,
            and set its <strong>Project root</strong> field first.
          </div>
        ) : (
          <select
            value={form.leaderId}
            onChange={(e) => setForm((f) => ({ ...f, leaderId: e.target.value }))}
            className="w-full px-3 py-2 border rounded-lg mb-4 bg-white dark:bg-gray-700 dark:border-gray-600 dark:text-gray-100 text-sm"
          >
            {eligible.map((a) => (
              <option key={a.id} value={a.id}>
                {a.entry.name} ({a.id}) — {a.entry.project}
              </option>
            ))}
          </select>
        )}

        {leader?.entry.project && (
          <div className="text-xs text-gray-500 dark:text-gray-400 mb-4 flex items-start gap-1">
            <FolderOpen size={12} className="shrink-0 mt-0.5" />
            <span>
              Project: <span className="font-mono">{leader.entry.project}</span>
              <br />
              Team data will live in <span className="font-mono">.berry/</span> under this root.
            </span>
          </div>
        )}

        <div className="flex gap-2 justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm rounded-lg text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700"
          >
            Cancel
          </button>
          <button
            onClick={handleCreate}
            disabled={!form.leaderId || busy}
            className="px-4 py-2 text-sm bg-berry-600 hover:bg-berry-700 text-white rounded-lg disabled:opacity-50"
          >
            {busy ? 'Starting…' : 'Start Team'}
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * Detail view: members column + inter-agent message log column.
 * Human ↔ leader chat stays in the main Chat tab (this tab is for
 * orchestrating the team, not for typing to the leader). A quick
 * "Chat with leader" button activates the leader and jumps back to Chat.
 */
function TeamDetailView({ leaderId, onBack }: { leaderId: string; onBack: () => void }) {
  const [team, setTeam] = useState<TeamState | null>(null);
  const [messages, setMessages] = useState<TeamMessage[]>([]);
  const [leaderName, setLeaderName] = useState<string>('');
  const [loading, setLoading] = useState(true);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      const [teamRes, msgsRes, agentsRes] = await Promise.all([
        fetch(`/api/agents/${leaderId}/team`),
        fetch(`/api/agents/${leaderId}/team/messages`),
        fetch('/api/agents'),
      ]);
      const teamData = await teamRes.json();
      const msgsData = msgsRes.ok ? await msgsRes.json() : { messages: [] };
      const agentsData = await agentsRes.json();
      setTeam(teamData.team);
      setMessages(msgsData.messages || []);
      const leader = (agentsData.agents || []).find((a: AgentSummary) => a.id === leaderId);
      setLeaderName(leader?.entry.name ?? leaderId);
    } finally {
      setLoading(false);
    }
  }, [leaderId]);

  useEffect(() => {
    fetchAll();
    // Poll for new messages while team detail is open.
    const iv = setInterval(fetchAll, 5000);
    return () => clearInterval(iv);
  }, [fetchAll]);

  const handleChatWithLeader = async () => {
    await fetch(`/api/agents/${leaderId}/activate`, { method: 'POST' });
    // The Chat tab activates automatically on next render; simplest is to
    // tell the user where to go and let them click. Slightly smoother:
    // dispatch a custom event that App.tsx listens for.
    window.dispatchEvent(new CustomEvent('berry:switch-tab', { detail: 'chat' }));
  };

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center text-gray-500 dark:text-gray-400">
        Loading team…
      </div>
    );
  }

  if (!team) {
    return (
      <div className="flex-1 p-6">
        <button onClick={onBack} className="text-sm text-gray-600 dark:text-gray-400 hover:underline flex items-center gap-1 mb-4">
          <ArrowLeft size={14} /> Back to Teams
        </button>
        <p className="text-gray-500 dark:text-gray-400">Team not found (it may have been disbanded).</p>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto bg-white dark:bg-gray-900">
      <div className="max-w-5xl mx-auto p-6">
        <button onClick={onBack} className="text-sm text-gray-600 dark:text-gray-400 hover:underline flex items-center gap-1 mb-4">
          <ArrowLeft size={14} /> Back to Teams
        </button>

        {/* Header */}
        <div className="flex items-start justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100 flex items-center gap-2">
              <Users size={24} /> {team.name}
            </h1>
            <div className="text-sm text-gray-500 dark:text-gray-400 font-mono mt-1 flex items-center gap-1">
              <FolderOpen size={12} /> {team.project}
            </div>
          </div>
          <div className="flex gap-2">
            <button
              onClick={fetchAll}
              title="Refresh"
              className="p-2 rounded-lg border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700"
            >
              <RefreshCw size={14} />
            </button>
            <button
              onClick={handleChatWithLeader}
              className="px-3 py-2 text-sm bg-berry-600 hover:bg-berry-700 text-white rounded-lg flex items-center gap-1.5"
            >
              <MessageSquare size={14} /> Chat with leader
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-[280px_1fr] gap-4">
          {/* Members column */}
          <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 p-4">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400 mb-3">
              Members
            </h3>
            <div className="rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700 p-3 mb-3">
              <div className="flex items-center gap-1.5 text-sm font-semibold text-amber-900 dark:text-amber-200">
                <Crown size={14} /> {leaderName}
              </div>
              <div className="text-xs text-amber-700 dark:text-amber-300 font-mono mt-0.5">{team.leaderId}</div>
              <div className="text-[10px] uppercase tracking-wider text-amber-600 dark:text-amber-400 mt-1">Leader</div>
            </div>
            {team.teammates.length === 0 ? (
              <p className="text-xs text-gray-500 dark:text-gray-400 italic">
                No teammates yet. Tell the leader to <span className="font-mono">spawn_teammate</span> from chat.
              </p>
            ) : (
              <div className="space-y-2">
                {team.teammates.map((tm) => (
                  <div key={tm.id} className="rounded-lg bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 p-2.5">
                    <div className="text-sm font-semibold text-gray-800 dark:text-gray-200">{tm.role}</div>
                    <div className="text-xs text-gray-500 dark:text-gray-400 font-mono">{tm.id}</div>
                    {tm.model && <div className="text-[10px] text-gray-400 dark:text-gray-500 mt-0.5">{tm.model}</div>}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Message log column */}
          <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 p-4 max-h-[calc(100vh-220px)] overflow-y-auto">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400 mb-3">
              Inter-agent messages · {messages.length}
            </h3>
            {messages.length === 0 ? (
              <p className="text-xs text-gray-500 dark:text-gray-400 italic">
                No inter-agent messages yet. This log records leader ↔ teammate traffic. Your chat with the
                leader lives in the main Chat tab.
              </p>
            ) : (
              <div className="space-y-2">
                {messages.map((m) => (
                  <div
                    key={m.id}
                    className={`rounded-lg p-2.5 text-sm ${
                      m.from === '@leader'
                        ? 'bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700'
                        : 'bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700'
                    }`}
                  >
                    <div className="flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400 mb-1">
                      <span className={m.from === '@leader' ? 'font-semibold text-amber-700 dark:text-amber-300' : 'font-semibold text-gray-700 dark:text-gray-300'}>
                        {m.from}
                      </span>
                      <span>→</span>
                      <span>{m.to}</span>
                      <span className="ml-auto">{new Date(m.ts).toLocaleTimeString()}</span>
                    </div>
                    <div className="text-gray-800 dark:text-gray-200 whitespace-pre-wrap break-words">{m.content}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
