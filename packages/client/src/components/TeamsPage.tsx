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
  UserPlus,
  Users,
  XCircle,
} from 'lucide-react';
import { showToast } from './Toast';
import { useAgentFacts } from '../facts/useFacts';
import { factStore } from '../facts/store';
import { listModelCatalog } from '../a8s/agents';
import {
  createTeam,
  deriveTeams,
  disbandTeammate,
  loadTeamMessages,
  loadWorklist,
  spawnTeammate,
  type EmergentTeam,
} from '../a8s/teams';
import { uniqueStrings } from '../utils/format';
import { CreateTeamWizard, type CreateTeamValues } from './teams/CreateTeamWizard';
import { SpawnTeammateModal, type SpawnTeammateValues } from './teams/SpawnTeammateModal';
import {
  EmptyState,
  IconButton,
  InlineSpinner,
  Pill,
  PrimaryButton,
  SecondaryButton,
  SectionCard,
  TextInput,
  WorkbenchPage,
} from './workbench';
import type {
  AgentFact,
  ModelCatalogItem,
  TeamMessage,
  WorklistTask,
  WorklistTaskStatus,
} from '@berry-agent/claw-contracts';

export default function TeamsPage() {
  const agents = useAgentFacts();
  const teams = useMemo(() => deriveTeams(agents), [agents]);

  const [selectedLeader, setSelectedLeader] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState(false);
  const [models, setModels] = useState<ModelCatalogItem[]>([]);

  const takenIds = useMemo(() => agents.map((a) => a.id), [agents]);
  const knownProjects = useMemo(() => uniqueStrings(teams.map((t) => t.project)).sort(), [teams]);

  useEffect(() => {
    listModelCatalog().then(setModels).catch(() => setModels([]));
  }, []);

  // Keep a valid selection as teams come and go.
  useEffect(() => {
    if (!teams.length) { setSelectedLeader(null); return; }
    if (!selectedLeader || !teams.some((t) => t.leaderId === selectedLeader)) {
      setSelectedLeader(teams[0].leaderId);
    }
  }, [teams, selectedLeader]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return teams;
    return teams.filter((t) => [t.name, t.leaderId, t.project].join(' ').toLowerCase().includes(q));
  }, [query, teams]);

  const selectedTeam = teams.find((t) => t.leaderId === selectedLeader);

  const createFromWizard = async (values: CreateTeamValues) => {
    setBusy(true);
    try {
      await createTeam(values);
    } catch (err) {
      showToast(err instanceof Error ? err.message : '组建团队失败', 'error');
      return;
    } finally {
      setBusy(false);
    }
    showToast('团队已组建');
    setCreating(false);
    setSelectedLeader(values.leaderId);
    void factStore.hydrate('agent');
  };

  return (
    <WorkbenchPage
      eyebrow="Workspace"
      title="团队"
      actions={
        <PrimaryButton onClick={() => setCreating(true)}>
          <Plus size={14} />
          组建团队
        </PrimaryButton>
      }
    >
      <div className="min-h-0 flex-1 overflow-y-auto p-5">
        <TeamStage
          teams={filtered}
          selectedTeam={selectedTeam}
          query={query}
          onQueryChange={setQuery}
          onSelect={(team) => setSelectedLeader(team.leaderId)}
        />

        <div className="mt-4">
          {!selectedTeam ? (
            <EmptyState
              icon={<Users size={24} />}
              title="还没有团队"
              body="组建一个团队:起名、选共享项目、给 leader 选模型。之后添加 teammate,或让 leader 在会话里自行 spawn。"
              action={<PrimaryButton onClick={() => setCreating(true)}><Plus size={14} />组建团队</PrimaryButton>}
            />
          ) : (
            <TeamDetail
              key={selectedTeam.leaderId}
              team={selectedTeam}
              catalog={models}
              takenIds={takenIds}
              onBack={() => setSelectedLeader(null)}
            />
          )}
        </div>
      </div>

      <CreateTeamWizard
        open={creating}
        catalog={models}
        takenIds={takenIds}
        knownProjects={knownProjects}
        onCancel={() => setCreating(false)}
        onCreate={createFromWizard}
        busy={busy}
      />
    </WorkbenchPage>
  );
}

function TeamStage({
  teams,
  selectedTeam,
  query,
  onQueryChange,
  onSelect,
}: {
  teams: EmergentTeam[];
  selectedTeam?: EmergentTeam;
  query: string;
  onQueryChange: (query: string) => void;
  onSelect: (team: EmergentTeam) => void;
}) {
  const members = selectedTeam
    ? [
        { id: selectedTeam.leaderId, name: selectedTeam.name, role: 'leader' },
        ...selectedTeam.teammates.map((m) => ({ id: m.id, name: m.name, role: m.labels?.role ?? 'member' })),
      ]
    : [];

  return (
    <section className="relative overflow-hidden rounded-2xl border border-white/[0.08] bg-[#20242a]/75 p-4">
      <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-zinc-300/25 to-transparent" />
      <div className="relative grid gap-4 xl:grid-cols-[minmax(0,1fr)_300px]">
        <div className="min-w-0">
          <div className="mb-4 flex flex-wrap items-center gap-3">
            <div className="min-w-0 flex-1">
              <div className="text-[10px] uppercase tracking-[0.24em] text-zinc-500">team roster</div>
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
              members.map((member) => (
                <div key={`${member.id}:${member.role}`} className="text-center">
                  <TeamPortrait id={member.id} name={member.name} active={member.role === 'leader'} />
                  <div className="mt-2 max-w-28 truncate text-xs font-medium text-zinc-100">{member.name}</div>
                  <div className="max-w-28 truncate text-[10px] text-zinc-600">{member.role}</div>
                </div>
              ))
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
                    ? 'border-sky-200/24 bg-sky-200/[0.075]'
                    : 'border-white/[0.07] bg-black/10 hover:border-sky-200/16 hover:bg-sky-200/[0.055]'
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
        active ? 'border-amber-300/50 bg-amber-300/10 shadow-[0_16px_45px_rgba(0,0,0,0.22)]' : 'border-white/[0.10] bg-black/10'
      }`}
      style={{ clipPath: 'polygon(0 8px, 8px 8px, 8px 0, calc(100% - 8px) 0, calc(100% - 8px) 8px, 100% 8px, 100% calc(100% - 8px), calc(100% - 8px) calc(100% - 8px), calc(100% - 8px) 100%, 8px 100%, 8px calc(100% - 8px), 0 calc(100% - 8px))' }}
    >
      <img src={avatar.dataUri} alt="" className="h-14 w-14 object-contain" draggable={false} />
    </div>
  );
}

function TeamDetail({
  team,
  catalog,
  takenIds,
  onBack,
}: {
  team: EmergentTeam;
  catalog: ModelCatalogItem[];
  takenIds: string[];
  onBack: () => void;
}) {
  const [messages, setMessages] = useState<TeamMessage[]>([]);
  const [tasks, setTasks] = useState<WorklistTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [spawning, setSpawning] = useState(false);
  const [spawnOpen, setSpawnOpen] = useState(false);

  const fetchShared = useCallback(async () => {
    setLoading(true);
    try {
      const [worklist, log] = await Promise.all([
        loadWorklist(team.project),
        loadTeamMessages(team.project),
      ]);
      setTasks(worklist);
      setMessages(log);
    } catch (err) {
      showToast(err instanceof Error ? err.message : '读取团队状态失败', 'error');
    } finally {
      setLoading(false);
    }
  }, [team.project]);

  useEffect(() => { void fetchShared(); }, [fetchShared]);

  const onSpawn = async (values: SpawnTeammateValues) => {
    setSpawning(true);
    try {
      await spawnTeammate({
        teammateId: values.teammateId,
        role: values.role,
        leaderId: team.leaderId,
        project: team.project,
        model: values.model,
      });
    } catch (err) {
      showToast(err instanceof Error ? err.message : '添加 teammate 失败', 'error');
      return;
    } finally {
      setSpawning(false);
    }
    showToast(`已添加 ${values.role}`);
    setSpawnOpen(false);
    void factStore.hydrate('agent');
  };

  const onDisband = async (teammate: AgentFact) => {
    if (!window.confirm(`从团队移除 "${teammate.name}"?其 SDK 数据保留在磁盘。`)) return;
    try {
      await disbandTeammate(teammate.id);
    } catch (err) {
      showToast(err instanceof Error ? err.message : '移除失败', 'error');
      return;
    }
    showToast('已移除 teammate');
    void factStore.hydrate('agent');
  };

  const chatWithLeader = () => {
    factStore.setSelectedAgent(team.leaderId);
    window.dispatchEvent(new CustomEvent('berry:select-agent', { detail: team.leaderId }));
    window.dispatchEvent(new CustomEvent('berry:switch-tab', { detail: 'inbox' }));
  };

  return (
    <div className="space-y-4">
      <SectionCard className="bg-white/[0.025]">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <button onClick={onBack} className="mb-3 inline-flex items-center gap-1 text-xs text-zinc-500 hover:text-zinc-200">
              <ArrowLeft size={13} />
              返回团队列表
            </button>
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="truncate text-lg font-semibold text-zinc-50">{team.name}</h2>
              <Pill tone="good">leader {team.leaderId}</Pill>
              <Pill>{team.teammates.length} teammates</Pill>
            </div>
            <div className="mt-1 truncate font-mono text-xs text-zinc-500">{team.project}</div>
          </div>
          <div className="flex items-center gap-2">
            <SecondaryButton onClick={fetchShared}>
              <RefreshCw size={13} />
              刷新
            </SecondaryButton>
            <SecondaryButton onClick={() => setSpawnOpen(true)}>
              <UserPlus size={14} />
              添加 teammate
            </SecondaryButton>
            <PrimaryButton onClick={chatWithLeader}>
              <MessageSquare size={14} />
              找 leader
            </PrimaryButton>
          </div>
        </div>
      </SectionCard>

      <div className="grid gap-4 xl:grid-cols-[280px_minmax(0,1fr)_minmax(0,1fr)]">
        <MembersPanel team={team} onDisband={onDisband} />
        {loading ? (
          <SectionCard><InlineSpinner label="读取 worklist" /></SectionCard>
        ) : (
          <WorklistPanel tasks={tasks} />
        )}
        {loading ? (
          <SectionCard><InlineSpinner label="读取消息" /></SectionCard>
        ) : (
          <MessageLog messages={messages} leaderId={team.leaderId} />
        )}
      </div>

      <SpawnTeammateModal
        open={spawnOpen}
        catalog={catalog}
        takenIds={takenIds}
        onCancel={() => setSpawnOpen(false)}
        onSpawn={onSpawn}
        busy={spawning}
      />
    </div>
  );
}

function MembersPanel({ team, onDisband }: { team: EmergentTeam; onDisband: (teammate: AgentFact) => void }) {
  return (
    <SectionCard title="成员" icon={<Users size={15} />}>
      <div className="rounded-lg border border-amber-400/20 bg-amber-400/10 p-3">
        <div className="flex items-center gap-2 text-sm font-medium text-amber-200">
          <Crown size={14} />
          {team.name}
        </div>
        <div className="mt-1 font-mono text-xs text-amber-300/70">{team.leaderId}</div>
        <div className="mt-1 text-[10px] uppercase tracking-wide text-amber-400/70">Leader · {team.leader.model || '—'}</div>
      </div>
      <div className="mt-3 space-y-2">
        {team.teammates.length === 0 ? (
          <div className="rounded-lg bg-black/10 px-3 py-6 text-center text-xs text-zinc-600">
            还没有 teammate。点上方「添加 teammate」,或让 leader 在聊天里调用 spawn_teammate。
          </div>
        ) : (
          team.teammates.map((mate) => (
            <div key={mate.id} className="rounded-lg border border-white/[0.07] bg-black/10 p-3">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium text-zinc-100">{mate.labels?.role ?? mate.name}</div>
                  <div className="mt-1 truncate font-mono text-xs text-zinc-500">{mate.id}</div>
                  {mate.model && <div className="mt-1 text-xs text-zinc-600">{mate.model}</div>}
                </div>
                <IconButton title="移除" tone="bad" onClick={() => onDisband(mate)}>
                  <Trash2 size={14} />
                </IconButton>
              </div>
            </div>
          ))
        )}
      </div>
    </SectionCard>
  );
}

function WorklistPanel({ tasks }: { tasks: WorklistTask[] }) {
  const order: WorklistTaskStatus[] = ['unclaimed', 'claimed', 'in_progress', 'done', 'failed'];
  const grouped = order.reduce<Record<WorklistTaskStatus, WorklistTask[]>>(
    (acc, status) => ({ ...acc, [status]: tasks.filter((task) => task.status === status) }),
    { unclaimed: [], claimed: [], in_progress: [], done: [], failed: [] },
  );

  return (
    <SectionCard title={`Worklist · ${tasks.length}`} icon={<ListChecks size={15} />}>
      {tasks.length === 0 ? (
        <div className="rounded-lg bg-black/10 px-3 py-6 text-center text-xs text-zinc-600">
          暂无任务。Worklist 由 leader / teammate 的协作工具维护,这里实时观测。
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
                    <div key={task.id} className="rounded-lg border border-white/[0.07] bg-black/10 p-3">
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

function MessageLog({ messages, leaderId }: { messages: TeamMessage[]; leaderId: string }) {
  const isLeader = (who: string) => who === leaderId || who === '@leader';
  return (
    <SectionCard title={`Agent 消息 · ${messages.length}`} icon={<MessageSquare size={15} />}>
      {messages.length === 0 ? (
        <div className="rounded-lg bg-black/10 px-3 py-6 text-center text-xs text-zinc-600">
          还没有 leader 和 teammate 的内部消息。
        </div>
      ) : (
        <div className="max-h-[calc(100vh-260px)] space-y-2 overflow-y-auto pr-1">
          {messages.map((message) => (
            <div
              key={message.id}
              className={`rounded-lg border p-3 ${
                isLeader(message.from)
                  ? 'border-amber-400/20 bg-amber-400/10'
                  : 'border-white/[0.07] bg-black/10'
              }`}
            >
              <div className="mb-2 flex items-center gap-2 text-xs text-zinc-500">
                <span className={isLeader(message.from) ? 'font-medium text-amber-300' : 'font-medium text-zinc-300'}>{message.from}</span>
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

function StatusIcon({ status }: { status: WorklistTaskStatus }) {
  switch (status) {
    case 'unclaimed': return <Circle size={10} />;
    case 'claimed': return <CircleDot size={10} />;
    case 'in_progress': return <Loader2 size={10} className="animate-spin" />;
    case 'done': return <CheckCircle2 size={10} />;
    case 'failed': return <XCircle size={10} />;
  }
}

function statusTone(status: WorklistTaskStatus): 'neutral' | 'good' | 'warn' | 'bad' | 'info' {
  if (status === 'done') return 'good';
  if (status === 'failed') return 'bad';
  if (status === 'in_progress') return 'info';
  if (status === 'claimed') return 'warn';
  return 'neutral';
}
