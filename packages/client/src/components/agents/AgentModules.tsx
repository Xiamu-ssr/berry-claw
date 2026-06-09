import { useEffect, useMemo, useState } from 'react';
import {
  Boxes,
  Brain,
  FileText,
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
} from '@berry-agent/claw-contracts';
import MemoryPanel from '../MemoryPanel';
import { showToast } from '../Toast';
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
import { GROUP_LABELS } from './helpers';
import McpServerRow from '../mcp/McpServerRow';
import type { DetailTab, InspectRuntime, ToolDef } from './types';

export function AgentModulePanel({
  module,
  agent,
  runtime,
  loadingRuntime,
  systemSkills,
  sharedMcp,
  onReload,
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
        <MemoryPanel agentId={agent.id} hasProject={false} />
      </SectionCard>
    );
  }

  if (module === 'skills') {
    return (
      <SectionCard title="Skill 装备槽" icon={<Sparkles size={15} />}>
        <MountedSkills agent={agent} installed={systemSkills} />
      </SectionCard>
    );
  }

  if (module === 'mcp') {
    return <AgentMcpModule sharedMcp={sharedMcp} />;
  }

  if (module === 'tools') {
    return <ToolPolicy runtime={runtime} loading={loadingRuntime} onReload={onReload} />;
  }

  if (module === 'safety') {
    return (
      <SectionCard title="安全策略" icon={<ShieldCheck size={15} />}>
        <EmptyState
          icon={<ShieldCheck size={24} />}
          title="安全策略归 a8s"
          body="安全等级是 agent 在 a8s 上的 spec 的一部分（按 agent / project / global 继承）。控制台只读展示，配置请在 a8s 上修改。"
        />
      </SectionCard>
    );
  }

  return (
    <SectionCard title="Context 装备槽" icon={<Brain size={15} />}>
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_260px]">
        <div className="space-y-3 text-sm">
          <CompactPath label="provider" value={agent.provider} />
          <CompactPath label="worker" value={agent.workerId ?? 'unscheduled'} />
          <CompactPath label="hands" value={agent.hands?.map((hand) => hand.kind).join(', ') || '—'} />
          <CompactPath label="skills" value={agent.skills?.map((skill) => skill.name).join(', ') || '—'} />
        </div>
        <div className="rounded-lg border border-white/[0.07] bg-black/10 p-3">
          <div className="text-xs text-zinc-500">模型</div>
          <div className="mt-1 break-all font-mono text-sm text-zinc-200">{agent.model}</div>
          <div className="mt-3 text-xs text-zinc-500">运行时</div>
          <div className="mt-1 text-sm text-zinc-200">{agent.instantiated ? 'ready' : 'cold'}</div>
          <div className="mt-3 text-xs text-zinc-500">状态</div>
          <div className="mt-1 text-sm text-zinc-200">{agent.status}</div>
        </div>
      </div>
    </SectionCard>
  );
}

function AgentMcpModule({ sharedMcp }: { sharedMcp: MCPServerFact[] }) {
  return (
    <SectionCard title="MCP 装备槽" icon={<Boxes size={15} />}>
      {sharedMcp.length === 0 ? (
        <div className="rounded-lg bg-black/10 px-3 py-8 text-center text-xs text-zinc-600">
          没有可用 MCP。MCP 属于 Hand host，由 a8s 装配到 agent，这里只读展示 global 状态。
        </div>
      ) : (
        <McpServerGroup title="Global shared" servers={sharedMcp} empty="没有 global MCP" />
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

function MountedSkills({
  agent,
  installed,
}: {
  agent: AgentFact;
  installed: InstalledSkill[];
}) {
  const mounted = new Set((agent.skills ?? []).map((skill) => skill.name));
  if (installed.length === 0 && mounted.size === 0) {
    return <div className="rounded-lg bg-black/10 px-3 py-6 text-center text-xs text-zinc-600">全局 Skill 池为空，去 Skill 页安装。</div>;
  }
  const rows = installed.length > 0
    ? installed.map((skill) => ({ name: skill.name, description: skill.description }))
    : (agent.skills ?? []).map((skill) => ({ name: skill.name, description: skill.description }));
  return (
    <div className="grid gap-2 md:grid-cols-2">
      {rows.map((skill) => {
        const on = mounted.has(skill.name);
        return (
          <div
            key={skill.name}
            className={`rounded-lg border p-3 text-left ${
              on
                ? 'border-sky-300/25 bg-sky-300/10'
                : 'border-white/[0.07] bg-black/10'
            }`}
          >
            <div className="flex items-center gap-2">
              <StatusDot ok={on} />
              <span className="min-w-0 flex-1 truncate text-sm font-medium text-zinc-100">{skill.name}</span>
              <Pill tone={on ? 'good' : 'neutral'}>{on ? 'mounted' : 'available'}</Pill>
            </div>
            {skill.description && <p className="mt-2 line-clamp-2 text-xs text-zinc-500">{skill.description}</p>}
          </div>
        );
      })}
    </div>
  );
}

function ToolPolicy({
  runtime,
  loading,
  onReload,
}: {
  runtime: InspectRuntime | null;
  loading: boolean;
  onReload: () => void;
}) {
  if (loading) {
    return (
      <SectionCard title="工具" subtitle="agent runtime 暴露的工具列表。" icon={<Wrench size={15} />}>
        <InlineSpinner label="读取工具列表" />
      </SectionCard>
    );
  }
  const tools = runtime?.tools ?? [];
  if (tools.length === 0) {
    return (
      <SectionCard
        title="工具"
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

  const groupedTools = tools.reduce((map, tool) => {
    const group = tool.group || 'other';
    map.set(group, [...(map.get(group) ?? []), tool]);
    return map;
  }, new Map<string, ToolDef[]>());

  return (
    <SectionCard
      title="工具"
      subtitle="由 SDK 和 Hand / MCP 提供；工具开关归 a8s 的 Hand 装配，这里只读展示。"
      icon={<Wrench size={15} />}
      action={<SecondaryButton onClick={onReload}><RefreshCw size={13} />刷新</SecondaryButton>}
    >
      <div className="space-y-4">
        {[...groupedTools.entries()].map(([group, items]) => (
          <div key={group}>
            <div className="mb-2 text-xs font-medium text-zinc-500">{GROUP_LABELS[group] ?? group}</div>
            <div className="grid gap-2 md:grid-cols-2">
              {items.map((tool) => (
                <div
                  key={tool.name}
                  title={tool.description ?? tool.name}
                  className="flex min-w-0 items-center gap-2 rounded-lg border border-teal-300/20 bg-teal-300/[0.06] px-3 py-2 text-left"
                >
                  <StatusDot ok />
                  <span className="min-w-0 flex-1 truncate font-mono text-xs text-zinc-200">{tool.name}</span>
                </div>
              ))}
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
  const dirty = draft !== block.text;

  useEffect(() => {
    setDraft(block.text);
  }, [block.text]);

  const save = async () => {
    // Prompt-block editing was a console-backend write path. a8s exposes the
    // system prompt read-only via the snapshot (no per-block PUT), so editing
    // is degraded to read-only until the control plane offers a write route.
    showToast('Prompt 编辑暂未接入控制台（只读）', 'error');
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
            <PrimaryButton onClick={save} disabled={!dirty}>
              <Save size={14} />
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
