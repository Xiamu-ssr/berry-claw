import { useCallback, useEffect, useMemo, useState } from 'react';
import { createAvatarFromText } from '@berry-agent/avatar';
import {
  ArrowLeft,
  CheckCircle2,
  Circle,
  CircleDot,
  Crown,
  ListChecks,
  Loader2,
  MessageSquare,
  Plus,
  RefreshCw,
  Search,
  Trash2,
  Users,
  X,
  XCircle,
} from 'lucide-react';
import { showToast } from './Toast';
import { API, apiFetch } from '../api/paths';
import { useAgentFacts, useTeamFacts } from '../facts/useFacts';
import {
  EmptyState,
  Field,
  IconButton,
  InlineSpinner,
  Pill,
  PrimaryButton,
  SecondaryButton,
  SectionCard,
  SelectInput,
  TextInput,
  WorkbenchPage,
} from './workbench';
import type { AgentFact, TeamFact } from '@berry-agent/claw-contracts';

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

interface TeamMessage {
  id: string;
  ts: number;
  from: string;
  to: string;
  content: string;
  replyTo?: string;
}

type WorklistStatus = 'unclaimed' | 'claimed' | 'in_progress' | 'done' | 'failed';

interface WorklistTask {
  id: string;
  title: string;
  description?: string;
  status: WorklistStatus;
  assignee?: string;
  createdBy: string;
  createdAt: number;
  updatedAt: number;
  completedAt?: number;
  failureReason?: string;
  tags?: string[];
}

interface AgentSummary {
  id: string;
  entry: { name: string; model: string; project?: string };
}

export default function TeamsPage() {
  const agentFacts = useAgentFacts();
  const teamFacts = useTeamFacts();
  const [selectedLeader, setSelectedLeader] = useState<string | null>(teamFacts[0]?.leaderId ?? null);
  const [query, setQuery] = useState('');
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    if (!teamFacts.length) {
      setSelectedLeader(null);
      return;
    }
    if (!selectedLeader || !teamFacts.some((team) => team.leaderId === selectedLeader)) {
      setSelectedLeader(teamFacts[0]?.leaderId ?? null);
    }
  }, [selectedLeader, teamFacts]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return teamFacts;
    return teamFacts.filter((team) => [team.name, team.leaderId, team.project].join(' ').toLowerCase().includes(q));
  }, [query, teamFacts]);

  const eligibleLeaders = agentFacts.filter((agent) => !!agent.project);
  const selectedTeam = teamFacts.find((team) => team.leaderId === selectedLeader) ?? teamFacts[0];

  return (
    <WorkbenchPage
      eyebrow="Workspace"
      title="团队"
      actions={
        <PrimaryButton onClick={() => setCreating(true)}>
          <Plus size={14} />
          新建团队
        </PrimaryButton>
      }
    >
      <div className="min-h-0 flex-1 overflow-y-auto p-5">
        <TeamStage
          teams={filtered}
          selectedTeam={selectedTeam}
          agents={agentFacts}
          query={query}
          onQueryChange={setQuery}
          onSelect={(team) => setSelectedLeader(team.leaderId)}
        />

        <div className="mt-4 space-y-4">
          {creating && (
            <NewTeamPanel
              agents={eligibleLeaders.map((agent) => ({
                id: agent.id,
                entry: { name: agent.name, model: agent.model, project: agent.project },
              }))}
              onClose={() => setCreating(false)}
              onCreated={(leaderId) => {
                setCreating(false);
                setSelectedLeader(leaderId);
              }}
            />
          )}

          {!selectedLeader ? (
            <EmptyState
              icon={<Users size={24} />}
              title="还没有团队"
              body="先给一个 agent 绑定 project，然后把它启动为 leader。teammate 后续由 leader 通过 SDK 工具生成。"
              action={<PrimaryButton onClick={() => setCreating(true)}><Plus size={14} />新建团队</PrimaryButton>}
            />
          ) : (
            <TeamDetail leaderId={selectedLeader} onBack={() => setSelectedLeader(null)} />
          )}
        </div>
      </div>
    </WorkbenchPage>
  );
}

function TeamStage({
  teams,
  selectedTeam,
  agents,
  query,
  onQueryChange,
  onSelect,
}: {
  teams: TeamFact[];
  selectedTeam?: TeamFact;
  agents: AgentFact[];
  query: string;
  onQueryChange: (query: string) => void;
  onSelect: (team: TeamFact) => void;
}) {
  const members = selectedTeam
    ? [
        { id: selectedTeam.leaderId, role: 'leader' },
        ...selectedTeam.teammates.map((mate) => ({ id: mate.agentId, role: mate.role })),
      ]
    : [];

  return (
    <section className="relative overflow-hidden rounded-xl border border-emerald-400/15 bg-[#10130f] p-4">
      <div className="absolute inset-0 opacity-[0.14] [background-image:linear-gradient(rgba(52,211,153,.45)_1px,transparent_1px),linear-gradient(90deg,rgba(52,211,153,.45)_1px,transparent_1px)] [background-size:18px_18px]" />
      <div className="relative grid gap-4 xl:grid-cols-[minmax(0,1fr)_300px]">
        <div className="min-w-0">
          <div className="mb-4 flex flex-wrap items-center gap-3">
            <div className="min-w-0 flex-1">
              <div className="text-[10px] uppercase tracking-[0.24em] text-emerald-300/70">team roster</div>
              <h2 className="mt-1 truncate text-lg font-semibold text-zinc-50">{selectedTeam?.name ?? '未选择团队'}</h2>
              <div className="mt-1 truncate font-mono text-[11px] text-zinc-600">{selectedTeam?.project ?? ''}</div>
            </div>
            <div className="relative w-64 max-w-full">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-600" />
              <TextInput
                value={query}
                onChange={(event) => onQueryChange(event.target.value)}
                placeholder="搜索团队"
                className="w-full pl-8"
              />
            </div>
          </div>

          <div className="flex min-h-32 flex-wrap items-end gap-4">
            {members.length === 0 ? (
              <div className="rounded-lg border border-dashed border-white/[0.10] px-4 py-10 text-sm text-zinc-600">
                还没有团队成员
              </div>
            ) : (
              members.map((member) => {
                const agent = agents.find((item) => item.id === member.id);
                return (
                  <div key={`${member.id}:${member.role}`} className="text-center">
                    <TeamPortrait id={member.id} name={agent?.name ?? member.id} active={member.role === 'leader'} />
                    <div className="mt-2 max-w-28 truncate text-xs font-medium text-zinc-100">{agent?.name ?? member.id}</div>
                    <div className="max-w-28 truncate text-[10px] text-zinc-600">{member.role}</div>
                  </div>
                );
              })
            )}
          </div>
        </div>

        <div className="space-y-2">
          {teams.length === 0 ? (
            <div className="rounded-lg border border-dashed border-white/[0.10] px-3 py-8 text-center text-xs text-zinc-600">
              没有匹配的团队
            </div>
          ) : (
            teams.map((team) => (
              <button
                key={team.leaderId}
                onClick={() => onSelect(team)}
                className={`w-full rounded-lg border p-3 text-left transition-colors ${
                  team.leaderId === selectedTeam?.leaderId
                    ? 'border-emerald-400/30 bg-emerald-400/10'
                    : 'border-white/[0.07] bg-black/15 hover:border-white/[0.13] hover:bg-white/[0.05]'
                }`}
              >
                <div className="flex items-center gap-2">
                  <Users size={14} className="text-zinc-500" />
                  <span className="min-w-0 flex-1 truncate text-sm font-medium text-zinc-100">{team.name}</span>
                  <Pill>{team.teammates.length + 1}</Pill>
                </div>
                <div className="mt-1 truncate font-mono text-[11px] text-zinc-600">{team.project}</div>
              </button>
            ))
          )}
        </div>
      </div>
    </section>
  );
}

function TeamPortrait({ id, name, active }: { id: string; name: string; active?: boolean }) {
  const avatar = createAvatarFromText(`${id} ${name}`, { namespace: 'team-member', size: 64 });
  return (
    <div
      className={`image-render-pixelated relative mx-auto flex h-16 w-16 items-center justify-center border p-1 ${
        active ? 'border-amber-300/60 bg-amber-300/10 shadow-[0_0_24px_rgba(251,191,36,0.16)]' : 'border-white/[0.10] bg-black/35'
      }`}
      style={{ clipPath: 'polygon(0 8px, 8px 8px, 8px 0, calc(100% - 8px) 0, calc(100% - 8px) 8px, 100% 8px, 100% calc(100% - 8px), calc(100% - 8px) calc(100% - 8px), calc(100% - 8px) 100%, 8px 100%, 8px calc(100% - 8px), 0 calc(100% - 8px))' }}
    >
      <img src={avatar.dataUri} alt="" className="h-14 w-14 object-contain" draggable={false} />
    </div>
  );
}

function NewTeamPanel({
  agents,
  onClose,
  onCreated,
}: {
  agents: AgentSummary[];
  onClose: () => void;
  onCreated: (leaderId: string) => void;
}) {
  const [name, setName] = useState('');
  const [leaderId, setLeaderId] = useState(agents[0]?.id ?? '');
  const [busy, setBusy] = useState(false);
  const leader = agents.find((agent) => agent.id === leaderId);

  const create = async () => {
    if (!leaderId) return;
    setBusy(true);
    try {
      const res = await apiFetch(API.agentTeamStart(leaderId), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim() || `${leader?.entry.name ?? leaderId} team` }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to start team');
      showToast({ title: 'Team started', message: name.trim() || 'team' });
      onCreated(leaderId);
    } catch (err) {
      showToast({ variant: 'error', title: 'Failed to start team', message: err instanceof Error ? err.message : String(err) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <SectionCard
      title="新建团队"
      subtitle="只需要名字和 leader。共享 project、worklist、team 文件会由后端创建。"
      icon={<Users size={15} />}
      action={<IconButton title="Close" onClick={onClose}><X size={14} /></IconButton>}
    >
      {agents.length === 0 ? (
        <div className="rounded-lg border border-amber-400/20 bg-amber-400/10 px-3 py-3 text-sm text-amber-200">
          当前没有绑定 project 的 agent。先到智能体页设置项目根目录。
        </div>
      ) : (
        <>
          <div className="grid gap-3 md:grid-cols-2">
            <Field label="团队名称">
              <TextInput value={name} onChange={(event) => setName(event.target.value)} placeholder="Frontend squad" className="w-full" />
            </Field>
            <Field label="Leader">
              <SelectInput value={leaderId} onChange={(event) => setLeaderId(event.target.value)} className="w-full">
                {agents.map((agent) => (
                  <option key={agent.id} value={agent.id}>
                    {agent.entry.name} ({agent.id})
                  </option>
                ))}
              </SelectInput>
            </Field>
          </div>
          {leader?.entry.project && (
            <div className="mt-3 rounded-lg border border-white/[0.07] bg-black/15 px-3 py-2 font-mono text-xs text-zinc-500">
              {leader.entry.project}
            </div>
          )}
          <div className="mt-4 flex justify-end gap-2">
            <SecondaryButton onClick={onClose}>取消</SecondaryButton>
            <PrimaryButton onClick={create} disabled={!leaderId || busy}>
              {busy ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
              启动团队
            </PrimaryButton>
          </div>
        </>
      )}
    </SectionCard>
  );
}

function TeamDetail({ leaderId, onBack }: { leaderId: string; onBack: () => void }) {
  const agentFacts = useAgentFacts();
  const [team, setTeam] = useState<TeamState | null>(null);
  const [messages, setMessages] = useState<TeamMessage[]>([]);
  const [tasks, setTasks] = useState<WorklistTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [disbanding, setDisbanding] = useState(false);

  const leader = agentFacts.find((agent) => agent.id === leaderId);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      const [teamRes, msgsRes, worklistRes] = await Promise.all([
        apiFetch(API.agentTeam(leaderId)),
        apiFetch(API.agentTeamMessages(leaderId)),
        apiFetch(API.agentTeamWorklist(leaderId)),
      ]);
      const teamData = await teamRes.json();
      const msgsData = msgsRes.ok ? await msgsRes.json() : { messages: [] };
      const wlData = worklistRes.ok ? await worklistRes.json() : { tasks: [] };
      setTeam(teamData.team);
      setMessages(msgsData.messages || []);
      setTasks(wlData.tasks || []);
    } finally {
      setLoading(false);
    }
  }, [leaderId]);

  useEffect(() => {
    void fetchAll();
    let iv: ReturnType<typeof setInterval> | null = setInterval(fetchAll, 15_000);
    const onVisible = () => {
      if (document.visibilityState === 'visible') {
        void fetchAll();
        if (!iv) iv = setInterval(fetchAll, 15_000);
      } else if (iv) {
        clearInterval(iv);
        iv = null;
      }
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      if (iv) clearInterval(iv);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [fetchAll]);

  const disband = async () => {
    if (!team) return;
    if (!window.confirm(`Disband team "${team.name}"? Team files under project .berry will be removed.`)) return;
    setDisbanding(true);
    try {
      const res = await apiFetch(API.agentTeam(leaderId), { method: 'DELETE' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      showToast({ title: 'Team disbanded', message: team.name });
      onBack();
    } catch (err) {
      showToast({ variant: 'error', title: 'Failed to disband', message: err instanceof Error ? err.message : String(err) });
    } finally {
      setDisbanding(false);
    }
  };

  const chatWithLeader = async () => {
    await apiFetch(API.agentActivate(leaderId), { method: 'POST' });
    window.dispatchEvent(new CustomEvent('berry:select-agent', { detail: leaderId }));
    window.dispatchEvent(new CustomEvent('berry:switch-tab', { detail: 'inbox' }));
  };

  if (loading) {
    return (
      <SectionCard>
        <InlineSpinner label="读取团队状态" />
      </SectionCard>
    );
  }

  if (!team) {
    return (
      <EmptyState
        icon={<Users size={24} />}
        title="团队不存在"
        body="它可能已经被解散，或 leader agent 不再存在。"
        action={<SecondaryButton onClick={onBack}><ArrowLeft size={13} />返回</SecondaryButton>}
      />
    );
  }

  return (
    <div className="space-y-4">
      <SectionCard>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <button onClick={onBack} className="mb-3 inline-flex items-center gap-1 text-xs text-zinc-500 hover:text-zinc-200">
              <ArrowLeft size={13} />
              返回团队列表
            </button>
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="truncate text-lg font-semibold text-zinc-50">{team.name}</h2>
              <Pill tone="good">leader {leaderId}</Pill>
              <Pill>{team.teammates.length} teammates</Pill>
            </div>
            <div className="mt-1 truncate font-mono text-xs text-zinc-500">{team.project}</div>
          </div>
          <div className="flex items-center gap-2">
            <SecondaryButton onClick={fetchAll}>
              <RefreshCw size={13} />
              刷新
            </SecondaryButton>
            <PrimaryButton onClick={chatWithLeader}>
              <MessageSquare size={14} />
              找 leader
            </PrimaryButton>
            <IconButton title="Disband team" tone="bad" onClick={disband} disabled={disbanding}>
              {disbanding ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={15} />}
            </IconButton>
          </div>
        </div>
      </SectionCard>

      <div className="grid gap-4 xl:grid-cols-[280px_minmax(0,1fr)_minmax(0,1fr)]">
        <MembersPanel team={team} leaderName={leader?.name ?? leaderId} />
        <WorklistPanel tasks={tasks} />
        <MessageLog messages={messages} />
      </div>
    </div>
  );
}

function MembersPanel({ team, leaderName }: { team: TeamState; leaderName: string }) {
  return (
    <SectionCard title="成员" icon={<Users size={15} />}>
      <div className="rounded-lg border border-amber-400/20 bg-amber-400/10 p-3">
        <div className="flex items-center gap-2 text-sm font-medium text-amber-200">
          <Crown size={14} />
          {leaderName}
        </div>
        <div className="mt-1 font-mono text-xs text-amber-300/70">{team.leaderId}</div>
        <div className="mt-1 text-[10px] uppercase tracking-wide text-amber-400/70">Leader</div>
      </div>
      <div className="mt-3 space-y-2">
        {team.teammates.length === 0 ? (
          <div className="rounded-lg bg-black/20 px-3 py-6 text-center text-xs text-zinc-600">
            还没有 teammate。让 leader 在聊天里调用 spawn_teammate。
          </div>
        ) : (
          team.teammates.map((mate) => (
            <div key={mate.id} className="rounded-lg border border-white/[0.07] bg-black/15 p-3">
              <div className="text-sm font-medium text-zinc-100">{mate.role}</div>
              <div className="mt-1 font-mono text-xs text-zinc-500">{mate.id}</div>
              {mate.model && <div className="mt-1 text-xs text-zinc-600">{mate.model}</div>}
            </div>
          ))
        )}
      </div>
    </SectionCard>
  );
}

function WorklistPanel({ tasks }: { tasks: WorklistTask[] }) {
  const order: WorklistStatus[] = ['unclaimed', 'claimed', 'in_progress', 'done', 'failed'];
  const grouped = order.reduce<Record<WorklistStatus, WorklistTask[]>>(
    (acc, status) => ({ ...acc, [status]: tasks.filter((task) => task.status === status) }),
    { unclaimed: [], claimed: [], in_progress: [], done: [], failed: [] },
  );

  return (
    <SectionCard title={`Worklist · ${tasks.length}`} icon={<ListChecks size={15} />}>
      {tasks.length === 0 ? (
        <div className="rounded-lg bg-black/20 px-3 py-6 text-center text-xs text-zinc-600">
          暂无任务。Worklist 应由 agent 工具维护，UI 只做观测。
        </div>
      ) : (
        <div className="max-h-[calc(100vh-260px)] space-y-4 overflow-y-auto pr-1">
          {order.map((status) =>
            grouped[status].length === 0 ? null : (
              <div key={status}>
                <div className="mb-2 flex items-center gap-1.5 text-[10px] uppercase tracking-wide text-zinc-600">
                  <StatusIcon status={status} />
                  {status.replace('_', ' ')} · {grouped[status].length}
                </div>
                <div className="space-y-2">
                  {grouped[status].map((task) => (
                    <div key={task.id} className="rounded-lg border border-white/[0.07] bg-black/15 p-3">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0 break-words text-sm font-medium text-zinc-100">{task.title}</div>
                        <Pill tone={statusTone(status)}>{task.id}</Pill>
                      </div>
                      {task.description && <p className="mt-2 whitespace-pre-wrap text-xs text-zinc-500">{task.description}</p>}
                      <div className="mt-2 flex flex-wrap gap-2 text-[11px] text-zinc-600">
                        <span>{task.assignee ? `@${task.assignee}` : 'unassigned'}</span>
                        <span>by {task.createdBy}</span>
                      </div>
                      {task.failureReason && <div className="mt-2 text-xs text-red-300">{task.failureReason}</div>}
                    </div>
                  ))}
                </div>
              </div>
            ),
          )}
        </div>
      )}
    </SectionCard>
  );
}

function MessageLog({ messages }: { messages: TeamMessage[] }) {
  return (
    <SectionCard title={`Agent 消息 · ${messages.length}`} icon={<MessageSquare size={15} />}>
      {messages.length === 0 ? (
        <div className="rounded-lg bg-black/20 px-3 py-6 text-center text-xs text-zinc-600">
          还没有 leader 和 teammate 的内部消息。
        </div>
      ) : (
        <div className="max-h-[calc(100vh-260px)] space-y-2 overflow-y-auto pr-1">
          {messages.map((message) => (
            <div
              key={message.id}
              className={`rounded-lg border p-3 ${
                message.from === '@leader'
                  ? 'border-amber-400/20 bg-amber-400/10'
                  : 'border-white/[0.07] bg-black/15'
              }`}
            >
              <div className="mb-2 flex items-center gap-2 text-xs text-zinc-500">
                <span className={message.from === '@leader' ? 'font-medium text-amber-300' : 'font-medium text-zinc-300'}>{message.from}</span>
                <span>→</span>
                <span>{message.to}</span>
                <span className="ml-auto">{new Date(message.ts).toLocaleTimeString()}</span>
              </div>
              <div className="whitespace-pre-wrap break-words text-sm text-zinc-200">{message.content}</div>
            </div>
          ))}
        </div>
      )}
    </SectionCard>
  );
}

function StatusIcon({ status }: { status: WorklistStatus }) {
  switch (status) {
    case 'unclaimed': return <Circle size={10} />;
    case 'claimed': return <CircleDot size={10} />;
    case 'in_progress': return <Loader2 size={10} className="animate-spin" />;
    case 'done': return <CheckCircle2 size={10} />;
    case 'failed': return <XCircle size={10} />;
  }
}

function statusTone(status: WorklistStatus): 'neutral' | 'good' | 'warn' | 'bad' | 'info' {
  if (status === 'done') return 'good';
  if (status === 'failed') return 'bad';
  if (status === 'in_progress') return 'info';
  if (status === 'claimed') return 'warn';
  return 'neutral';
}
