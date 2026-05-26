import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Boxes,
  Brain,
  FileText,
  Loader2,
  MemoryStick,
  RefreshCw,
  Save,
  ShieldCheck,
  Sparkles,
  Wrench,
} from 'lucide-react';
import type {
  AgentFact,
  InstalledSkill,
  MCPServerFact,
  PromptBlockInfo,
  SafetyLevel,
  SafetySnapshot,
} from '@berry-agent/claw-contracts';
import { SAFETY_LEVELS } from '@berry-agent/claw-contracts/safety';
import { API, apiFetch } from '../../api/paths';
import MemoryPanel from '../MemoryPanel';
import { showToast } from '../Toast';
import McpServerRow from '../mcp/McpServerRow';
import {
  EmptyState,
  InlineSpinner,
  Pill,
  PrimaryButton,
  SecondaryButton,
  SectionCard,
  StatusDot,
  TextArea,
} from '../workbench';
import { GROUP_LABELS, SAFETY_META, lastPathPart } from './helpers';
import type { DetailTab, InspectRuntime, ToolDef } from './types';

export function AgentModulePanel({
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
          <CompactPath label="prompt" value={agent.home.agentMdPath} />
          <CompactPath label="memory" value={agent.home.memoryPath} />
        </div>
        <div className="rounded-lg border border-white/[0.07] bg-black/10 p-3">
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
        <div className="rounded-lg bg-black/10 px-3 py-8 text-center text-xs text-zinc-600">
          没有可用 MCP。全局、项目和 agent 层级都还没有连接。
        </div>
      ) : (
        <div className="space-y-4">
          <McpServerGroup title="Global shared" servers={sharedMcp} empty="没有 global MCP" />
          <McpServerGroup title="Agent / project" servers={agentServers} empty="这个 agent 没有私有 MCP" />
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
        <Pill tone={connected > 0 ? 'good' : 'neutral'}>
          {connected}/{servers.length}
        </Pill>
      </div>
      {servers.length === 0 ? (
        <div className="rounded-lg border border-dashed border-white/[0.08] bg-black/10 px-3 py-5 text-center text-xs text-zinc-600">
          {empty}
        </div>
      ) : (
        <div className="grid gap-2 md:grid-cols-2">
          {servers.map((server) => (
            <McpServerRow key={`${title}-${server.name}`} server={server} />
          ))}
        </div>
      )}
    </div>
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
        <Pill tone={SAFETY_META[effective].tone}>{effective}</Pill>
      </div>
      <SafetyLayerControl
        title="Agent"
        value={agent.safetyLevel ?? null}
        inheritLabel="继承 project / global"
        saving={saving === 'agent'}
        onChange={setAgentLevel}
      />
      <div className="rounded-lg border border-white/[0.07] bg-black/10 p-3 text-xs leading-5 text-zinc-500">
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
    <div className="rounded-lg border border-white/[0.07] bg-black/10 p-3">
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
                  ? 'border-sky-300/30 bg-sky-300/10'
                  : 'border-white/[0.07] bg-white/[0.025] hover:border-sky-200/16 hover:bg-sky-200/[0.055]'
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
    return <div className="rounded-lg bg-black/10 px-3 py-6 text-center text-xs text-zinc-600">全局 Skill 池为空，去 Skill 页安装。</div>;
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
                ? 'border-sky-300/25 bg-sky-300/10'
                : 'border-white/[0.07] bg-black/10 hover:border-sky-200/16 hover:bg-sky-200/[0.05]'
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
        <div className="rounded-lg bg-black/10 px-3 py-6 text-center text-xs text-zinc-600">
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
                        ? 'border-white/[0.07] bg-black/10 opacity-60'
                        : 'border-teal-300/20 bg-teal-300/[0.06] hover:bg-teal-300/10'
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
        body="runtime 初始化后会显示 env、workspace instructions、project knowledge 和 skill index。"
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
        <pre className="max-h-72 overflow-auto whitespace-pre-wrap rounded-lg border border-white/[0.07] bg-black/10 p-3 font-mono text-xs text-zinc-400">
          {block.text || '(empty)'}
        </pre>
      )}
    </SectionCard>
  );
}
