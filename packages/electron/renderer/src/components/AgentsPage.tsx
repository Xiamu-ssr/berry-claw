import { useCallback, useEffect, useMemo, useState } from 'react';
import { createAvatarFromText } from '@berry-agent/avatar';
import {
  Boxes,
  Bot,
  Brain,
  Check,
  FileText,
  Loader2,
  MemoryStick,
  Plus,
  Puzzle,
  RefreshCw,
  Save,
  Search,
  Settings2,
  ShieldCheck,
  Sparkles,
  Trash2,
  Wrench,
  X,
} from 'lucide-react';
import MemoryPanel from './MemoryPanel';
import { showToast } from './Toast';
import { API, apiFetch } from '../api/paths';
import { useAgentFacts, useSystemFact } from '../facts/useFacts';
import type { AgentFact, InstalledSkill, MCPServerFact, ReasoningEffort, SafetyLevel } from '@berry-claw/contracts';
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
  SplitWorkbench,
  StatTile,
  StatusDot,
  TextArea,
  TextInput,
  WorkbenchPage,
} from './workbench';

interface ToolDef {
  name: string;
  description?: string;
  group?: string;
}

interface PromptBlockInfo {
  id: string;
  source: 'project_context' | 'env' | 'custom' | 'workspace_agent_md' | 'skills_index';
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
  tools?: ToolDef[];
  promptBlocks?: PromptBlockInfo[];
  systemPrompt?: string[];
}

interface ModelInfo {
  model: string;
  providerName: string;
  type: string;
}

interface PromptPackInfo {
  id: string;
  name: string;
  description?: string;
  version: string;
  builtin: boolean;
  path?: string;
}

interface SafetyAgentLayer {
  id: string;
  agentLevel: SafetyLevel | null;
  projectLevel: SafetyLevel | null;
  projectRoot: string | null;
  effective: SafetyLevel;
}

interface SafetySnapshot {
  levels: SafetyLevel[];
  globalLevel: SafetyLevel | null;
  agents: SafetyAgentLayer[];
}

type DetailTab = 'context' | 'prompt' | 'memory' | 'skills' | 'mcp' | 'tools' | 'safety';

interface AgentForm {
  id: string;
  name: string;
  model: string;
  project: string;
  reasoningEffort: '' | ReasoningEffort;
  promptPack: string;
}

const emptyForm = (): AgentForm => ({
  id: '',
  name: '',
  model: '',
  project: '',
  reasoningEffort: '',
  promptPack: 'berry-default-zh',
});

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

const SAFETY_LEVELS: SafetyLevel[] = ['trust', 'default', 'auto'];
const SAFETY_META: Record<SafetyLevel, { label: string; summary: string; tone: 'neutral' | 'good' | 'warn' | 'bad' | 'info' }> = {
  trust: { label: 'Trust', summary: '只拦截灾难级命令，不限制写入范围。', tone: 'warn' },
  default: { label: 'Default', summary: '限制写入范围，并拦截高危命令。', tone: 'good' },
  auto: { label: 'Auto', summary: 'Default + 高风险工具调用前询问。', tone: 'info' },
};

export default function AgentsPage() {
  const agents = useAgentFacts();
  const system = useSystemFact();
  const activeAgent = agents.find((agent) => agent.isActive);
  const [selectedId, setSelectedId] = useState<string | undefined>(activeAgent?.id ?? agents[0]?.id);
  const selected = agents.find((agent) => agent.id === selectedId) ?? activeAgent ?? agents[0];

  const [query, setQuery] = useState('');
  const [detailTab, setDetailTab] = useState<DetailTab>('context');
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [promptPacks, setPromptPacks] = useState<PromptPackInfo[]>([]);
  const [runtime, setRuntime] = useState<InspectRuntime | null>(null);
  const [loadingRuntime, setLoadingRuntime] = useState(false);
  const [editorMode, setEditorMode] = useState<'create' | 'edit' | null>(null);
  const [form, setForm] = useState<AgentForm>(emptyForm);

  useEffect(() => {
    if (!agents.length) {
      setSelectedId(undefined);
      return;
    }
    if (!selectedId || !agents.some((agent) => agent.id === selectedId)) {
      setSelectedId(activeAgent?.id ?? agents[0]?.id);
    }
  }, [activeAgent?.id, agents, selectedId]);

  const refetchModels = useCallback(async () => {
    const res = await apiFetch(API.models);
    const data = await res.json();
    setModels(Array.isArray(data.models) ? data.models : []);
  }, []);

  const refetchPromptPacks = useCallback(async () => {
    const res = await apiFetch(API.promptPacks);
    const data = await res.json();
    setPromptPacks(Array.isArray(data.promptPacks) ? data.promptPacks : []);
  }, []);

  const loadInspect = useCallback(async (agentId: string) => {
    setLoadingRuntime(true);
    try {
      const res = await apiFetch(API.agentInspect(agentId));
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      setRuntime((data.runtime ?? null) as InspectRuntime | null);
    } catch (err) {
      setRuntime(null);
      showToast(err instanceof Error ? err.message : 'Failed to inspect agent', 'error');
    } finally {
      setLoadingRuntime(false);
    }
  }, []);

  useEffect(() => {
    void refetchModels();
    void refetchPromptPacks();
  }, [refetchModels, refetchPromptPacks]);

  useEffect(() => {
    if (!selected?.id) {
      setRuntime(null);
      return;
    }
    void loadInspect(selected.id);
  }, [loadInspect, selected?.id]);

  const filteredAgents = useMemo(() => {
    const q = query.trim().toLowerCase();
    return agents.filter((agent) => {
      const haystack = [
        agent.id,
        agent.name,
        agent.model,
        agent.provider,
        agent.workspace,
        agent.project ?? '',
      ].join(' ').toLowerCase();
      return !q || haystack.includes(q);
    });
  }, [agents, query]);

  const startCreate = () => {
    void refetchModels();
    void refetchPromptPacks();
    setEditorMode('create');
    setDetailTab('context');
    setForm({
      ...emptyForm(),
      model: models[0]?.model ?? 'tier:balanced',
      reasoningEffort: 'medium',
      promptPack: promptPacks[0]?.id ?? 'berry-default-zh',
    });
  };

  const startEdit = (agent: AgentFact) => {
    void refetchModels();
    void refetchPromptPacks();
    setEditorMode('edit');
    setDetailTab('context');
    setForm({
      id: agent.id,
      name: agent.name,
      model: agent.model,
      project: agent.project ?? '',
      reasoningEffort: agent.reasoningEffort ?? '',
      promptPack: agent.promptPack ?? 'berry-default-zh',
    });
  };

  const closeEditor = () => {
    setEditorMode(null);
    setForm(emptyForm());
  };

  const saveAgent = async () => {
    const id = form.id.trim();
    const name = form.name.trim();
    const model = form.model.trim();
    if (!id || !name || !model) {
      showToast('Agent id, name, and model are required', 'error');
      return;
    }
    const previous = editorMode === 'edit' ? selected : undefined;
    const body = {
      ...(previous
        ? {
            workspace: previous.workspace,
            tools: previous.tools,
            disabledTools: previous.disabledTools,
            skillDirs: previous.skillDirs,
            disabledSkills: previous.disabledSkills,
            enabledSkills: previous.enabledSkills,
            promptPack: previous.promptPack,
            safetyLevel: previous.safetyLevel,
          }
        : {}),
      name,
      model,
      project: form.project.trim() || undefined,
      reasoningEffort: form.reasoningEffort || undefined,
      promptPack: form.promptPack || undefined,
    };
    const res = await apiFetch(API.agent(id), {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      showToast(data.error ?? `Save failed (${res.status})`, 'error');
      return;
    }
    showToast(editorMode === 'create' ? 'Agent created' : 'Agent updated');
    setSelectedId(id);
    closeEditor();
    window.dispatchEvent(new CustomEvent('berry:select-agent', { detail: id }));
  };

  const activateAgent = async (agentId: string) => {
    const res = await apiFetch(API.agentActivate(agentId), { method: 'POST' });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      showToast(data.error ?? 'Activate failed', 'error');
      return;
    }
    setSelectedId(agentId);
    window.dispatchEvent(new CustomEvent('berry:select-agent', { detail: agentId }));
    showToast('Active agent switched');
  };

  const deleteAgent = async (agent: AgentFact) => {
    if (!window.confirm(`Delete agent "${agent.name}"? Its workspace is moved to trash, not destroyed.`)) return;
    const res = await apiFetch(API.agent(agent.id), { method: 'DELETE' });
    if (!res.ok) {
      showToast(`Delete failed (${res.status})`, 'error');
      return;
    }
    showToast('Agent removed from registry');
  };

  const patchAgent = async (agent: AgentFact, patch: Record<string, unknown>, success: string) => {
    const res = await apiFetch(API.agent(agent.id), {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      showToast(data.error ?? `Update failed (${res.status})`, 'error');
      return false;
    }
    showToast(success);
    void loadInspect(agent.id);
    return true;
  };

  return (
      <WorkbenchPage
        eyebrow="Workspace"
        title="智能体"
      actions={
        <>
          <SecondaryButton onClick={() => selected?.id && loadInspect(selected.id)}>
            <RefreshCw size={13} />
            刷新
          </SecondaryButton>
          <PrimaryButton onClick={startCreate}>
            <Plus size={14} />
            新建
          </PrimaryButton>
        </>
      }
    >
      <SplitWorkbench
        left={
          <AgentListPane
            agents={filteredAgents}
            selectedId={selected?.id}
            activeId={activeAgent?.id}
            query={query}
            onQueryChange={setQuery}
            onSelect={(id) => {
              setSelectedId(id);
              setDetailTab('context');
              setEditorMode(null);
            }}
          />
        }
      >
        <div className="space-y-4 p-5">
          {editorMode && (
            <AgentEditor
              mode={editorMode}
              form={form}
              models={models}
              promptPacks={promptPacks}
              onChange={setForm}
              onSave={saveAgent}
              onClose={closeEditor}
            />
          )}

          {!selected ? (
            <EmptyState
              icon={<Bot size={24} />}
              title="还没有智能体"
              body="创建一个 agent 后，它会拥有自己的 workspace、MEMORY.md、AGENTS.md、skills 和 session 文件。"
              action={<PrimaryButton onClick={startCreate}><Plus size={14} />新建智能体</PrimaryButton>}
            />
          ) : (
            <>
              <AgentHero
                agent={selected}
                active={selected.id === activeAgent?.id}
                loading={loadingRuntime}
                runtime={runtime}
                systemSkills={system?.installedSkills ?? []}
                sharedMcp={system?.mcpShared ?? []}
                activeModule={detailTab}
                onModuleChange={setDetailTab}
                onActivate={() => activateAgent(selected.id)}
                onEdit={() => startEdit(selected)}
                onDelete={() => deleteAgent(selected)}
              />

              <AgentModulePanel
                module={detailTab}
                agent={selected}
                runtime={runtime}
                loadingRuntime={loadingRuntime}
                systemSkills={system?.installedSkills ?? []}
                sharedMcp={system?.mcpShared ?? []}
                onReload={() => loadInspect(selected.id)}
                onPatch={(patch, success) => patchAgent(selected, patch, success)}
              />
            </>
          )}
        </div>
      </SplitWorkbench>
    </WorkbenchPage>
  );
}

function AgentListPane({
  agents,
  selectedId,
  activeId,
  query,
  onQueryChange,
  onSelect,
}: {
  agents: AgentFact[];
  selectedId?: string;
  activeId?: string;
  query: string;
  onQueryChange: (query: string) => void;
  onSelect: (id: string) => void;
}) {
  return (
    <div className="p-3">
      <div className="relative">
        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-600" />
        <TextInput
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          placeholder="搜索 agent"
          className="w-full pl-8"
        />
      </div>

      <div className="mt-3 space-y-2">
        {agents.length === 0 ? (
          <div className="rounded-lg border border-dashed border-white/[0.10] px-3 py-8 text-center text-xs text-zinc-600">
            没有匹配的智能体
          </div>
        ) : (
          agents.map((agent) => (
            <AgentListItem
              key={agent.id}
              agent={agent}
              selected={selectedId === agent.id}
              active={agent.id === activeId}
              onSelect={() => onSelect(agent.id)}
            />
          ))
        )}
      </div>
    </div>
  );
}

function AgentListItem({
  agent,
  selected,
  active,
  onSelect,
}: {
  agent: AgentFact;
  selected: boolean;
  active: boolean;
  onSelect: () => void;
}) {
  const avatar = useMemo(() => agentAvatar(agent, 48), [agent]);

  return (
            <button
      onClick={onSelect}
              className={`w-full rounded-lg border p-3 text-left transition-colors ${
        selected
                  ? 'border-emerald-400/30 bg-emerald-400/10'
                  : 'border-white/[0.07] bg-white/[0.025] hover:border-white/[0.13] hover:bg-white/[0.05]'
              }`}
            >
      <div className="flex items-center gap-3">
        <PixelPortrait src={avatar.dataUri} alt="" size="sm" active={active} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <StatusDot status={agent.status} />
            <div className="min-w-0 flex-1 truncate text-sm font-medium text-zinc-100">{agent.name}</div>
            {active && <Pill tone="good">active</Pill>}
          </div>
          <div className="mt-1 flex items-center gap-2">
            <span className="truncate font-mono text-[11px] text-zinc-500">{modelShortName(agent.model)}</span>
            <span className="text-zinc-700">/</span>
            <span className="truncate text-[11px] text-zinc-600">{agent.id}</span>
          </div>
          <div className="mt-1 truncate text-[11px] text-zinc-600" title={agent.project ?? agent.workspace}>
            {agent.project ? lastPathPart(agent.project) : 'workspace only'}
              </div>
        </div>
      </div>
    </button>
  );
}

function AgentHero({
  agent,
  active,
  loading,
  runtime,
  systemSkills,
  sharedMcp,
  activeModule,
  onModuleChange,
  onActivate,
  onEdit,
  onDelete,
}: {
  agent: AgentFact;
  active: boolean;
  loading: boolean;
  runtime: InspectRuntime | null;
  systemSkills: InstalledSkill[];
  sharedMcp: MCPServerFact[];
  activeModule: DetailTab;
  onModuleChange: (module: DetailTab) => void;
  onActivate: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const avatar = useMemo(() => agentAvatar(agent, 112), [agent]);
  const enabledSkillCount = agent.enabledSkills?.length ?? 0;
  const mcpServers = [...sharedMcp, ...(agent.mcp ?? [])];
  const mcpCount = mcpServers.filter((server) => server.connected).length;
  const toolCount = runtime?.tools?.length ?? agent.tools?.length ?? 0;

  return (
    <section className="relative overflow-hidden rounded-xl border border-emerald-400/15 bg-[#10130f]">
      <div className="absolute inset-0 opacity-[0.16] [background-image:linear-gradient(rgba(52,211,153,.45)_1px,transparent_1px),linear-gradient(90deg,rgba(52,211,153,.45)_1px,transparent_1px)] [background-size:16px_16px]" />
      <div className="relative grid gap-5 p-5 lg:grid-cols-[132px_minmax(0,1fr)_260px]">
        <div className="flex items-start justify-center lg:justify-start">
          <PixelPortrait src={avatar.dataUri} alt={`${agent.name} avatar`} size="lg" active={active} />
        </div>
        <div className="min-w-0">
          <div className="text-[10px] uppercase tracking-[0.24em] text-emerald-300/70">agent identity</div>
          <div className="flex flex-wrap items-center gap-2">
            <StatusDot status={agent.status} />
            <h2 className="truncate text-2xl font-semibold text-zinc-50">{agent.name}</h2>
            <Pill>{agent.id}</Pill>
            {active && <Pill tone="good">active</Pill>}
            <Pill tone={statusTone(agent.status)}>{agent.status}</Pill>
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-zinc-500">
            <span className="font-mono">{agent.model}</span>
            <span>{agent.project ? lastPathPart(agent.project) : '未绑定项目'}</span>
            <span>{agent.effectiveSafetyLevel}</span>
            <span>{loading ? 'inspecting...' : agent.instantiated ? 'runtime ready' : 'cold'}</span>
          </div>
          <div className="mt-2 truncate font-mono text-[11px] text-zinc-600">{agent.workspace}</div>
          <div className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
            <AbilitySlot
              icon={<Brain size={16} />}
              label="Context"
              value={agent.project ? 'Project' : 'Solo'}
              detail={agent.project ? lastPathPart(agent.project) : 'workspace only'}
              active={activeModule === 'context'}
              onClick={() => onModuleChange('context')}
            />
            <AbilitySlot
              icon={<FileText size={16} />}
              label="Prompt"
              value={`${runtime?.promptBlocks?.length ?? runtime?.systemPrompt?.length ?? 0} blocks`}
              detail={agent.promptPack ?? 'berry-default-zh'}
              active={activeModule === 'prompt'}
              onClick={() => onModuleChange('prompt')}
            />
            <AbilitySlot
              icon={<MemoryStick size={16} />}
              label="Memory"
              value="Memory"
              detail="agent / project"
              active={activeModule === 'memory'}
              onClick={() => onModuleChange('memory')}
            />
            <AbilitySlot
              icon={<Sparkles size={16} />}
              label="Skills"
              value={`${enabledSkillCount}/${systemSkills.length}`}
              detail="enabled/global"
              active={activeModule === 'skills'}
              onClick={() => onModuleChange('skills')}
            />
            <AbilitySlot
              icon={<Boxes size={16} />}
              label="MCP"
              value={`${mcpCount}/${mcpServers.length}`}
              detail="global + agent"
              active={activeModule === 'mcp'}
              onClick={() => onModuleChange('mcp')}
            />
            <AbilitySlot
              icon={<Puzzle size={16} />}
              label="Tools"
              value={toolCount || '-'}
              detail="visible"
              active={activeModule === 'tools'}
              onClick={() => onModuleChange('tools')}
            />
            <AbilitySlot
              icon={<ShieldCheck size={16} />}
              label="Safety"
              value={agent.effectiveSafetyLevel}
              detail="policy"
              active={activeModule === 'safety'}
              onClick={() => onModuleChange('safety')}
            />
          </div>
        </div>
        <div className="flex flex-col gap-2 rounded-lg border border-white/[0.07] bg-black/25 p-3">
          <div className="text-xs font-medium text-zinc-300">主体操作</div>
          <div className="grid gap-2">
          {!active && (
            <PrimaryButton onClick={onActivate}>
              <Check size={14} />
              激活
            </PrimaryButton>
          )}
          <SecondaryButton onClick={onEdit}>
            <Settings2 size={14} />
            编辑
          </SecondaryButton>
          <IconButton title="Delete agent" tone="bad" onClick={onDelete}>
            <Trash2 size={15} />
          </IconButton>
          </div>
        </div>
      </div>
    </section>
  );
}

function AgentModulePanel({
  module,
  agent,
  runtime,
  loadingRuntime,
  systemSkills,
  sharedMcp,
  onReload,
  onPatch,
}: {
  module: DetailTab;
  agent: AgentFact;
  runtime: InspectRuntime | null;
  loadingRuntime: boolean;
  systemSkills: InstalledSkill[];
  sharedMcp: MCPServerFact[];
  onReload: () => void;
  onPatch: (patch: Record<string, unknown>, success: string) => Promise<boolean>;
}) {
  if (module === 'prompt') {
    return <PromptTab agentId={agent.id} runtime={runtime} loading={loadingRuntime} onReload={onReload} />;
  }

  if (module === 'memory') {
    return (
      <SectionCard title="记忆和项目知识" icon={<MemoryStick size={15} />}>
        <MemoryPanel agentId={agent.id} hasProject={!!agent.project} />
      </SectionCard>
    );
  }

  if (module === 'skills') {
    return (
      <SectionCard title="Skill 装备槽" icon={<Sparkles size={15} />}>
        <MarketSkills agent={agent} installed={systemSkills} onPatch={onPatch} />
      </SectionCard>
    );
  }

  if (module === 'mcp') {
    return <AgentMcpModule agent={agent} sharedMcp={sharedMcp} />;
  }

  if (module === 'tools') {
    return (
      <ToolPolicy
        agent={agent}
        runtime={runtime}
        loading={loadingRuntime}
        onReload={onReload}
        onPatch={onPatch}
      />
    );
  }

  if (module === 'safety') {
    return (
      <SectionCard title="安全策略" icon={<ShieldCheck size={15} />}>
        <SafetySelector agent={agent} onPatch={onPatch} />
      </SectionCard>
    );
  }

  return (
    <SectionCard title="Context 装备槽" icon={<Brain size={15} />}>
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_260px]">
        <div className="space-y-3 text-sm">
          <CompactPath label="workspace" value={agent.workspace} />
          <CompactPath label="project" value={agent.project ?? '未绑定项目'} />
          <CompactPath label="prompt" value={`${agent.workspace}/AGENTS.md`} />
          <CompactPath label="memory" value={`${agent.workspace}/MEMORY.md`} />
        </div>
        <div className="rounded-lg border border-white/[0.07] bg-black/15 p-3">
          <div className="text-xs text-zinc-500">模型</div>
          <div className="mt-1 break-all font-mono text-sm text-zinc-200">{agent.model}</div>
          <div className="mt-3 text-xs text-zinc-500">推理强度</div>
          <div className="mt-1 text-sm text-zinc-200">{agent.reasoningEffort ?? 'default'}</div>
          <div className="mt-3 text-xs text-zinc-500">提示词套件</div>
          <div className="mt-1 break-all font-mono text-sm text-zinc-200">{agent.promptPack ?? 'berry-default-zh'}</div>
        </div>
      </div>
    </SectionCard>
  );
}

function AgentMcpModule({ agent, sharedMcp }: { agent: AgentFact; sharedMcp: MCPServerFact[] }) {
  const agentServers = agent.mcp ?? [];
  const hasServers = sharedMcp.length > 0 || agentServers.length > 0;
  return (
    <SectionCard title="MCP 装备槽" icon={<Boxes size={15} />}>
      {!hasServers ? (
        <div className="rounded-lg bg-black/20 px-3 py-8 text-center text-xs text-zinc-600">
          没有可用 MCP。全局、项目和 agent 层级都还没有连接。
        </div>
      ) : (
        <div className="space-y-4">
          <McpServerGroup
            title="Global shared"
            servers={sharedMcp}
            empty="没有 global MCP"
          />
          <McpServerGroup
            title="Agent / project"
            servers={agentServers}
            empty="这个 agent 没有私有 MCP"
          />
        </div>
      )}
    </SectionCard>
  );
}

function McpServerGroup({
  title,
  servers,
  empty,
}: {
  title: string;
  servers: MCPServerFact[];
  empty: string;
}) {
  const connected = servers.filter((server) => server.connected).length;

  return (
    <div>
      <div className="mb-2 flex items-center justify-between gap-3">
        <div className="text-xs font-medium text-zinc-300">{title}</div>
        <Pill tone={connected > 0 ? 'good' : 'neutral'}>{connected}/{servers.length}</Pill>
      </div>
      {servers.length === 0 ? (
        <div className="rounded-lg border border-dashed border-white/[0.08] bg-black/15 px-3 py-5 text-center text-xs text-zinc-600">
          {empty}
        </div>
      ) : (
        <div className="grid gap-2 md:grid-cols-2">
          {servers.map((server) => (
            <McpServerCard key={`${title}-${server.name}`} server={server} />
          ))}
        </div>
      )}
    </div>
  );
}

function McpServerCard({ server }: { server: MCPServerFact }) {
  return (
    <div className="rounded-lg border border-white/[0.07] bg-black/15 p-3">
      <div className="flex items-center gap-2">
        <StatusDot ok={server.connected} />
        <span className="min-w-0 flex-1 truncate text-sm font-medium text-zinc-100">{server.name}</span>
        <Pill tone={server.connected ? 'good' : 'neutral'}>{server.status ?? (server.connected ? 'connected' : 'disabled')}</Pill>
      </div>
      <div className="mt-2 text-[11px] text-zinc-600">{server.toolCount ?? 0} tools</div>
      {server.lastError && <div className="mt-2 line-clamp-3 text-xs text-red-300">{server.lastError}</div>}
    </div>
  );
}

function AgentEditor({
  mode,
  form,
  models,
  promptPacks,
  onChange,
  onSave,
  onClose,
}: {
  mode: 'create' | 'edit';
  form: AgentForm;
  models: ModelInfo[];
  promptPacks: PromptPackInfo[];
  onChange: (next: AgentForm) => void;
  onSave: () => void;
  onClose: () => void;
}) {
  return (
    <SectionCard
      title={mode === 'create' ? '新建智能体' : '编辑智能体'}
      subtitle="Agent 身份由 workspace 目录和配置共同决定；项目绑定只决定它当前操作哪个代码根。"
      icon={<Bot size={15} />}
      action={<IconButton title="Close editor" onClick={onClose}><X size={14} /></IconButton>}
    >
      <div className="grid gap-3 lg:grid-cols-2">
        <Field label="Agent ID" hint={mode === 'edit' ? '不可修改' : '文件身份 key'}>
          <TextInput
            value={form.id}
            disabled={mode === 'edit'}
            onChange={(event) => onChange({ ...form, id: event.target.value.replace(/[^a-z0-9-_]/g, '') })}
            placeholder="coder"
            className="w-full font-mono"
          />
        </Field>
        <Field label="显示名">
          <TextInput
            value={form.name}
            onChange={(event) => onChange({ ...form, name: event.target.value })}
            placeholder="工程师"
            className="w-full"
          />
        </Field>
        <Field label="模型引用" hint="tier / model / raw / 裸 id">
          <SelectInput
            value={form.model}
            onChange={(event) => onChange({ ...form, model: event.target.value })}
            className="w-full"
          >
            {models.length === 0 && <option value={form.model}>{form.model || 'tier:balanced'}</option>}
            {models.map((model) => (
              <option key={model.model} value={model.model}>
                {model.model} ({model.providerName})
              </option>
            ))}
            {!models.some((model) => model.model === form.model) && form.model && (
              <option value={form.model}>{form.model}</option>
            )}
          </SelectInput>
        </Field>
        <Field label="推理强度">
          <SelectInput
            value={form.reasoningEffort}
            onChange={(event) => onChange({ ...form, reasoningEffort: event.target.value as AgentForm['reasoningEffort'] })}
            className="w-full"
          >
            <option value="">继承 / 默认</option>
            <option value="none">none</option>
            <option value="low">low</option>
            <option value="medium">medium</option>
            <option value="high">high</option>
            <option value="max">max</option>
            <option value="xhigh">xhigh</option>
          </SelectInput>
        </Field>
        <Field label="提示词套件" hint="SDK PromptPack">
          <SelectInput
            value={form.promptPack}
            onChange={(event) => onChange({ ...form, promptPack: event.target.value })}
            className="w-full"
          >
            {promptPacks.length === 0 && <option value={form.promptPack}>{form.promptPack || 'berry-default-zh'}</option>}
            {promptPacks.map((pack) => (
              <option key={pack.id} value={pack.id}>
                {pack.name} ({pack.id})
              </option>
            ))}
            {!promptPacks.some((pack) => pack.id === form.promptPack) && form.promptPack && (
              <option value={form.promptPack}>{form.promptPack}</option>
            )}
          </SelectInput>
        </Field>
        <Field label="项目根目录" hint="可为空">
          <TextInput
            value={form.project}
            onChange={(event) => onChange({ ...form, project: event.target.value })}
            placeholder="/Users/lanxuan/agent-workspace/berry-agent"
            className="w-full font-mono"
          />
        </Field>
      </div>
      <div className="mt-4 flex justify-end gap-2">
        <SecondaryButton onClick={onClose}>取消</SecondaryButton>
        <PrimaryButton onClick={onSave}>
          <Save size={14} />
          保存
        </PrimaryButton>
      </div>
    </SectionCard>
  );
}

function DetailTabs({ active, onChange }: { active: DetailTab; onChange: (tab: DetailTab) => void }) {
  const tabs: Array<{ id: DetailTab; label: string; icon: React.ReactNode }> = [
    { id: 'context', label: 'Context', icon: <Brain size={14} /> },
    { id: 'prompt', label: 'Prompt', icon: <FileText size={14} /> },
    { id: 'memory', label: '记忆', icon: <Brain size={14} /> },
    { id: 'skills', label: 'Skill', icon: <Sparkles size={14} /> },
    { id: 'mcp', label: 'MCP', icon: <Boxes size={14} /> },
    { id: 'tools', label: 'Tool', icon: <Puzzle size={14} /> },
    { id: 'safety', label: '安全', icon: <ShieldCheck size={14} /> },
  ];
  return (
    <div className="flex gap-1 rounded-xl border border-white/[0.07] bg-black/15 p-1">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          onClick={() => onChange(tab.id)}
          className={`inline-flex h-8 items-center gap-1.5 rounded-lg px-3 text-xs transition-colors ${
            active === tab.id
              ? 'bg-white/[0.08] text-zinc-50'
              : 'text-zinc-500 hover:bg-white/[0.05] hover:text-zinc-200'
          }`}
        >
          {tab.icon}
          {tab.label}
        </button>
      ))}
    </div>
  );
}

function OverviewTab({
  agent,
  runtime,
  loadingRuntime,
  systemSkills,
  onReload,
  onPatch,
}: {
  agent: AgentFact;
  runtime: InspectRuntime | null;
  loadingRuntime: boolean;
  systemSkills: InstalledSkill[];
  onReload: () => void;
  onPatch: (patch: Record<string, unknown>, success: string) => Promise<boolean>;
}) {
  const skillCount = agent.enabledSkills?.length ?? 0;
  const connectedMcp = agent.mcp?.filter((server) => server.connected).length ?? 0;
  const disabledToolCount = agent.disabledTools?.length ?? 0;

  return (
    <div className="space-y-4">
      <SectionCard title="角色主体" subtitle="Context、Skill、MCP、Tool 都是这个主体的能力面。" icon={<ShieldCheck size={15} />}>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <AbilitySlot
            icon={<Brain size={16} />}
            label="Context"
            value={agent.project ? 'Project-bound' : 'Solo workspace'}
            detail={agent.project ? lastPathPart(agent.project) : 'Only private agent files'}
          />
          <AbilitySlot
            icon={<Sparkles size={16} />}
            label="Skills"
            value={`${skillCount} enabled`}
            detail={`${systemSkills.length} global skills available`}
          />
          <AbilitySlot
            icon={<Boxes size={16} />}
            label="MCP"
            value={`${connectedMcp} connected`}
            detail={agent.mcp?.length ? `${agent.mcp.length} per-agent servers` : 'No per-agent servers'}
          />
          <AbilitySlot
            icon={<Puzzle size={16} />}
            label="Tools"
            value={disabledToolCount ? `${disabledToolCount} disabled` : 'Default kit'}
            detail={runtime?.tools?.length ? `${runtime.tools.length} runtime tools` : 'Inspect runtime for tool list'}
          />
        </div>
      </SectionCard>

      <SectionCard title="身份和安全" icon={<ShieldCheck size={15} />}>
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_260px]">
          <div className="space-y-3 text-sm">
            <CompactPath label="workspace" value={agent.workspace} />
            <CompactPath label="project" value={agent.project ?? '未绑定项目'} />
            <CompactPath label="prompt" value={`${agent.workspace}/AGENTS.md`} />
            <CompactPath label="memory" value={`${agent.workspace}/MEMORY.md`} />
          </div>
          <SafetySelector agent={agent} onPatch={onPatch} />
        </div>
      </SectionCard>

      <SectionCard title="Skill 可见性" subtitle="全局池安装，单个 agent 选择启用。" icon={<Sparkles size={15} />}>
        <MarketSkills agent={agent} installed={systemSkills} onPatch={onPatch} />
      </SectionCard>

      <ToolPolicy
        agent={agent}
        runtime={runtime}
        loading={loadingRuntime}
        onReload={onReload}
        onPatch={onPatch}
      />
    </div>
  );
}

function AbilitySlot({
  icon,
  label,
  value,
  detail,
  active,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  value: React.ReactNode;
  detail: string;
  active?: boolean;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!onClick}
      className={`relative overflow-hidden rounded-lg border p-3 text-left transition-colors ${
        active
          ? 'border-emerald-400/35 bg-emerald-400/12 shadow-[0_0_18px_rgba(52,211,153,0.10)]'
          : 'border-white/[0.08] bg-black/20 hover:border-white/[0.14] hover:bg-white/[0.045]'
      }`}
    >
      <div className="absolute right-2 top-2 text-emerald-300/10">{icon}</div>
      <div className="flex items-center gap-2 text-[10px] uppercase tracking-wide text-zinc-600">
        <span className="text-emerald-300/70">{icon}</span>
        {label}
      </div>
      <div className="mt-3 truncate text-sm font-medium text-zinc-100">{value}</div>
      <div className="mt-1 line-clamp-2 text-xs text-zinc-600">{detail}</div>
    </button>
  );
}

function CompactPath({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid gap-2 sm:grid-cols-[92px_minmax(0,1fr)]">
      <div className="text-xs text-zinc-600">{label}</div>
      <div className="truncate font-mono text-xs text-zinc-300" title={value}>{value}</div>
    </div>
  );
}

function SafetySelector({
  agent,
  onPatch,
}: {
  agent: AgentFact;
  onPatch: (patch: Record<string, unknown>, success: string) => Promise<boolean>;
}) {
  const [snapshot, setSnapshot] = useState<SafetySnapshot | null>(null);
  const [saving, setSaving] = useState<string | null>(null);

  const loadSnapshot = useCallback(async () => {
    const res = await apiFetch(API.safety);
    if (!res.ok) return;
    setSnapshot((await res.json()) as SafetySnapshot);
  }, []);

  useEffect(() => {
    void loadSnapshot();
  }, [agent.id, loadSnapshot]);

  const layer = snapshot?.agents.find((item) => item.id === agent.id);
  const effective = layer?.effective ?? agent.effectiveSafetyLevel;

  const setAgentLevel = async (level: SafetyLevel | null) => {
    setSaving('agent');
    try {
      const ok = await onPatch(
        { safetyLevel: level },
        level ? `Agent safety set to ${level}` : 'Agent safety override cleared',
      );
      if (ok) await loadSnapshot();
    } finally {
      setSaving(null);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <span className="text-xs text-zinc-500">生效值</span>
        <Pill tone={SAFETY_META[effective].tone}>
          {effective}
        </Pill>
      </div>
      <SafetyLayerControl
        title="Agent"
        value={agent.safetyLevel ?? null}
        inheritLabel="继承 project / global"
        saving={saving === 'agent'}
        onChange={setAgentLevel}
      />
      <div className="rounded-lg border border-white/[0.07] bg-black/15 p-3 text-xs leading-5 text-zinc-500">
        Project 级安全策略在“项目”栏目配置；Global 级安全策略在“设置”栏目配置。当前继承链：
        <span className="ml-1 font-mono text-zinc-300">
          agent {agent.safetyLevel ?? 'inherit'} / project {layer?.projectLevel ?? 'inherit'} / global {snapshot?.globalLevel ?? 'default'}
        </span>
      </div>
    </div>
  );
}

function SafetyLayerControl({
  title,
  value,
  inheritLabel,
  disabled,
  saving,
  onChange,
}: {
  title: string;
  value: SafetyLevel | null;
  inheritLabel: string;
  disabled?: boolean;
  saving?: boolean;
  onChange: (value: SafetyLevel | null) => void;
}) {
  const options: Array<SafetyLevel | null> = [null, ...SAFETY_LEVELS];

  return (
    <div className="rounded-lg border border-white/[0.07] bg-black/15 p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="text-xs font-medium text-zinc-300">{title}</div>
        {saving && <Loader2 size={13} className="animate-spin text-zinc-500" />}
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        {options.map((option) => {
          const active = value === option;
          const meta = option ? SAFETY_META[option] : null;
          return (
            <button
              key={option ?? 'inherit'}
              type="button"
              disabled={disabled || saving}
              onClick={() => onChange(option)}
              className={`rounded-lg border p-2 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-45 ${
                active
                  ? 'border-emerald-400/35 bg-emerald-400/10'
                  : 'border-white/[0.07] bg-white/[0.025] hover:border-white/[0.13] hover:bg-white/[0.05]'
              }`}
            >
              <div className="text-xs font-medium text-zinc-100">{meta?.label ?? '继承'}</div>
              <div className="mt-1 text-[11px] leading-4 text-zinc-600">{meta?.summary ?? inheritLabel}</div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function MarketSkills({
  agent,
  installed,
  onPatch,
}: {
  agent: AgentFact;
  installed: InstalledSkill[];
  onPatch: (patch: Record<string, unknown>, success: string) => Promise<boolean>;
}) {
  const enabled = new Set(agent.enabledSkills ?? []);
  if (installed.length === 0) {
    return <div className="rounded-lg bg-black/20 px-3 py-6 text-center text-xs text-zinc-600">全局 Skill 池为空，去 Skill 页安装。</div>;
  }
  return (
    <div className="grid gap-2 md:grid-cols-2">
      {installed.map((skill) => {
        const on = enabled.has(skill.name);
        const next = new Set(enabled);
        if (on) next.delete(skill.name);
        else next.add(skill.name);
        return (
          <button
            key={skill.name}
            onClick={() => onPatch({ enabledSkills: [...next] }, `${on ? 'Disabled' : 'Enabled'} ${skill.name}`)}
            className={`rounded-lg border p-3 text-left transition-colors ${
              on
                ? 'border-emerald-400/25 bg-emerald-400/10'
                : 'border-white/[0.07] bg-black/15 hover:border-white/[0.13] hover:bg-white/[0.045]'
            }`}
          >
            <div className="flex items-center gap-2">
              <StatusDot ok={on} />
              <span className="min-w-0 flex-1 truncate text-sm font-medium text-zinc-100">{skill.name}</span>
              <Pill tone={on ? 'good' : 'neutral'}>{on ? 'enabled' : 'hidden'}</Pill>
            </div>
            {skill.description && <p className="mt-2 line-clamp-2 text-xs text-zinc-500">{skill.description}</p>}
          </button>
        );
      })}
    </div>
  );
}

function ToolPolicy({
  agent,
  runtime,
  loading,
  onReload,
  onPatch,
}: {
  agent: AgentFact;
  runtime: InspectRuntime | null;
  loading: boolean;
  onReload: () => void;
  onPatch: (patch: Record<string, unknown>, success: string) => Promise<boolean>;
}) {
  if (loading) {
    return (
      <SectionCard title="工具开关" subtitle="写入 agent 的 tool denylist。" icon={<Wrench size={15} />}>
        <InlineSpinner label="读取工具列表" />
      </SectionCard>
    );
  }
  const tools = runtime?.tools ?? [];
  if (tools.length === 0) {
    return (
      <SectionCard
        title="工具开关"
        subtitle="激活 agent 后会显示当前 SDK 注册的工具。"
        icon={<Wrench size={15} />}
        action={<SecondaryButton onClick={onReload}><RefreshCw size={13} />刷新</SecondaryButton>}
      >
        <div className="rounded-lg bg-black/20 px-3 py-6 text-center text-xs text-zinc-600">
          还没有可显示的工具列表
        </div>
      </SectionCard>
    );
  }

  const disabledTools = new Set(agent.disabledTools ?? []);
  const groupedTools = tools.reduce((map, tool) => {
    const group = tool.group || 'other';
    map.set(group, [...(map.get(group) ?? []), tool]);
    return map;
  }, new Map<string, ToolDef[]>());

  return (
    <SectionCard
      title="工具开关"
      subtitle="只记录 denylist；工具本身由 SDK 和 MCP 提供。"
      icon={<Wrench size={15} />}
      action={<SecondaryButton onClick={onReload}><RefreshCw size={13} />刷新</SecondaryButton>}
    >
      <div className="space-y-4">
        {[...groupedTools.entries()].map(([group, items]) => (
          <div key={group}>
            <div className="mb-2 text-xs font-medium text-zinc-500">{GROUP_LABELS[group] ?? group}</div>
            <div className="grid gap-2 md:grid-cols-2">
              {items.map((tool) => {
                const off = disabledTools.has(tool.name);
                const next = new Set(agent.disabledTools ?? []);
                if (off) next.delete(tool.name);
                else next.add(tool.name);
                return (
                  <button
                    key={tool.name}
                    title={tool.description ?? tool.name}
                    onClick={() => onPatch({ disabledTools: [...next] }, `${off ? 'Enabled' : 'Disabled'} ${tool.name}`)}
                    className={`flex min-w-0 items-center gap-2 rounded-lg border px-3 py-2 text-left transition-colors ${
                      off
                        ? 'border-white/[0.07] bg-black/15 opacity-60'
                        : 'border-emerald-400/20 bg-emerald-400/[0.06] hover:bg-emerald-400/10'
                    }`}
                  >
                    <StatusDot ok={!off} />
                    <span className="min-w-0 flex-1 truncate font-mono text-xs text-zinc-200">{tool.name}</span>
                    {off && <Pill>off</Pill>}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </SectionCard>
  );
}

function PromptTab({
  agentId,
  runtime,
  loading,
  onReload,
}: {
  agentId: string;
  runtime: InspectRuntime | null;
  loading: boolean;
  onReload: () => void;
}) {
  const blocks = useMemo(() => {
    const promptBlocks = runtime?.promptBlocks;
    if (promptBlocks && promptBlocks.length > 0) return promptBlocks.slice().sort((a, b) => a.order - b.order);
    return (runtime?.systemPrompt ?? []).map((text, index) => ({
      id: `system:${index}`,
      source: 'custom' as const,
      title: `System prompt block ${index + 1}`,
      description: 'Inspect snapshot fallback.',
      order: index,
      active: true,
      scope: 'base' as const,
      cache: 'stable' as const,
      editable: false,
      text,
    }));
  }, [runtime?.promptBlocks, runtime?.systemPrompt]);

  if (loading) {
    return (
      <SectionCard>
        <InlineSpinner label="读取 prompt blocks" />
      </SectionCard>
    );
  }
  if (blocks.length === 0) {
    return (
      <EmptyState
        icon={<FileText size={24} />}
        title="没有 prompt block"
        body="runtime 初始化后会显示 env、agent prompt、project AGENTS.md 和 skill index。"
        action={<SecondaryButton onClick={onReload}><RefreshCw size={13} />刷新</SecondaryButton>}
      />
    );
  }
  return (
    <div className="space-y-3">
      {blocks.map((block) => (
        <PromptBlockCard key={block.id} agentId={agentId} block={block} onReload={onReload} />
      ))}
    </div>
  );
}

function PromptBlockCard({
  agentId,
  block,
  onReload,
}: {
  agentId: string;
  block: PromptBlockInfo;
  onReload: () => void;
}) {
  const [draft, setDraft] = useState(block.text);
  const [saving, setSaving] = useState(false);
  const dirty = draft !== block.text;

  useEffect(() => {
    setDraft(block.text);
  }, [block.text]);

  const save = async () => {
    setSaving(true);
    try {
      const res = await apiFetch(API.agentPromptBlock(agentId, block.id), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: draft }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      showToast(`Saved ${block.title}`);
      onReload();
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Prompt save failed', 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <SectionCard
      title={block.title}
      subtitle={block.description}
      icon={<FileText size={15} />}
      action={
        <div className="flex items-center gap-1.5">
          <Pill tone={block.active ? 'good' : 'neutral'}>{block.active ? 'active' : 'inactive'}</Pill>
          <Pill>{block.scope}</Pill>
          <Pill>{block.cache}</Pill>
        </div>
      }
    >
      {block.path && <div className="mb-2 break-all font-mono text-[11px] text-zinc-600">{block.path}</div>}
      {block.editable ? (
        <>
          <TextArea
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            className="h-48 w-full resize-y font-mono text-xs"
            spellCheck={false}
          />
          <div className="mt-3 flex justify-end">
            <PrimaryButton onClick={save} disabled={!dirty || saving}>
              {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
              保存源文件
            </PrimaryButton>
          </div>
        </>
      ) : (
        <pre className="max-h-72 overflow-auto whitespace-pre-wrap rounded-lg border border-white/[0.07] bg-black/20 p-3 font-mono text-xs text-zinc-400">
          {block.text || '(empty)'}
        </pre>
      )}
    </SectionCard>
  );
}

function statusTone(status?: string): 'neutral' | 'good' | 'warn' | 'bad' | 'info' {
  if (status === 'idle' || status === 'connected') return 'good';
  if (status === 'error' || status === 'failed') return 'bad';
  if (status === 'thinking' || status === 'tool_executing' || status === 'delegating') return 'info';
  if (status) return 'warn';
  return 'neutral';
}

function PixelPortrait({
  src,
  alt,
  size,
  active,
}: {
  src: string;
  alt: string;
  size: 'sm' | 'lg';
  active?: boolean;
}) {
  const frame = size === 'lg' ? 'h-28 w-28 p-2' : 'h-12 w-12 p-1';
  const image = size === 'lg' ? 'h-24 w-24' : 'h-10 w-10';

  return (
    <div
      className={`${frame} image-render-pixelated relative flex flex-shrink-0 items-center justify-center border ${
        active ? 'border-emerald-300/60 bg-emerald-300/10 shadow-[0_0_24px_rgba(52,211,153,0.16)]' : 'border-white/[0.10] bg-black/35'
      }`}
      style={{ clipPath: 'polygon(0 8px, 8px 8px, 8px 0, calc(100% - 8px) 0, calc(100% - 8px) 8px, 100% 8px, 100% calc(100% - 8px), calc(100% - 8px) calc(100% - 8px), calc(100% - 8px) 100%, 8px 100%, 8px calc(100% - 8px), 0 calc(100% - 8px))' }}
    >
      <img src={src} alt={alt} className={`${image} block object-contain`} draggable={false} />
    </div>
  );
}

function agentAvatar(agent: AgentFact, size: number) {
  return createAvatarFromText(
    [
      agent.id,
      agent.name,
      agent.model,
      agent.project ? `project ${lastPathPart(agent.project)}` : 'solo workspace',
      agent.enabledSkills?.join(' ') ?? '',
      agent.effectiveSafetyLevel,
    ].join(' '),
    { namespace: 'agent', size },
  );
}

function modelShortName(model?: string): string {
  if (!model) return '-';
  return model.split('/').pop()?.split(':').pop() ?? model;
}

function lastPathPart(path?: string): string {
  if (!path) return '-';
  const clean = path.replace(/\/+$/, '');
  return clean.split('/').pop() || clean;
}
