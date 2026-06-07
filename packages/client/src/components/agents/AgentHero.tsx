import { useMemo, type ReactNode } from 'react';
import {
  Boxes,
  Brain,
  Check,
  FileText,
  MemoryStick,
  Puzzle,
  Settings2,
  ShieldCheck,
  Sparkles,
  Trash2,
} from 'lucide-react';
import type { AgentFact, InstalledSkill, MCPServerFact } from '@berry-agent/claw-contracts';
import { IconButton, Pill, PrimaryButton, SecondaryButton, StatusDot } from '../workbench';
import { PixelPortrait } from './AgentPortrait';
import { agentAvatar, statusTone } from './helpers';
import type { DetailTab, InspectRuntime } from './types';

export function AgentHero({
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
  const skillCount = agent.skills?.length ?? 0;
  const handCount = agent.hands?.length ?? 0;
  const mcpServers = sharedMcp;
  const mcpCount = mcpServers.filter((server) => server.connected).length;
  const toolCount = runtime?.tools?.length ?? 0;

  return (
    <section className="relative overflow-hidden rounded-2xl border border-white/[0.08] bg-[#20242a]/75">
      <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/25 to-transparent" />
      <div className="relative grid gap-5 p-5 2xl:grid-cols-[132px_minmax(0,1fr)_260px]">
        <div className="flex items-start justify-center 2xl:justify-start">
          <PixelPortrait src={avatar.dataUri} alt={`${agent.name} avatar`} size="lg" active={active} />
        </div>
        <div className="min-w-0">
          <div className="text-[10px] uppercase tracking-[0.24em] text-zinc-500">agent identity</div>
          <div className="flex flex-wrap items-center gap-2">
            <StatusDot status={agent.status} />
            <h2 className="truncate text-2xl font-semibold text-zinc-50">{agent.name}</h2>
            <Pill>{agent.id}</Pill>
            {active && <Pill tone="good">active</Pill>}
            <Pill tone={statusTone(agent.status)}>{agent.status}</Pill>
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-zinc-500">
            <span className="font-mono">{agent.model}</span>
            <span>{agent.provider}</span>
            <span>{handCount ? `${handCount} hands` : 'no hands'}</span>
            <span>{loading ? 'inspecting...' : agent.instantiated ? 'runtime ready' : 'cold'}</span>
          </div>
          <div className="mt-2 truncate font-mono text-[11px] text-zinc-600">
            {agent.workerId ? `worker ${agent.workerId}` : 'unscheduled'}
          </div>
          <div className="mt-4 grid gap-2 sm:grid-cols-2 2xl:grid-cols-3">
            <AbilitySlot
              icon={<Brain size={16} />}
              label="Context"
              value={agent.provider}
              detail={agent.model}
              active={activeModule === 'context'}
              onClick={() => onModuleChange('context')}
            />
            <AbilitySlot
              icon={<FileText size={16} />}
              label="Prompt"
              value={`${runtime?.promptBlocks?.length ?? runtime?.systemPrompt?.length ?? 0} blocks`}
              detail="system prompt"
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
              value={`${skillCount}/${systemSkills.length}`}
              detail="mounted/global"
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
              value="—"
              detail="policy"
              active={activeModule === 'safety'}
              onClick={() => onModuleChange('safety')}
            />
          </div>
        </div>
        <div className="flex flex-col gap-2 rounded-xl border border-white/[0.07] bg-black/10 p-3">
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

function AbilitySlot({
  icon,
  label,
  value,
  detail,
  active,
  onClick,
}: {
  icon: ReactNode;
  label: string;
  value: ReactNode;
  detail: string;
  active?: boolean;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!onClick}
      className={`relative overflow-hidden rounded-xl border p-3 text-left transition-colors ${
        active
          ? 'border-sky-200/24 bg-sky-200/[0.075]'
          : 'border-white/[0.08] bg-black/10 hover:border-sky-200/16 hover:bg-sky-200/[0.05]'
      }`}
    >
      <div className="absolute right-2 top-2 text-white/[0.04]">{icon}</div>
      <div className="flex items-center gap-2 text-[10px] uppercase tracking-wide text-zinc-600">
        <span className={active ? 'text-zinc-200' : 'text-zinc-500'}>{icon}</span>
        {label}
      </div>
      <div className="mt-3 truncate text-sm font-medium text-zinc-100">{value}</div>
      <div className="mt-1 line-clamp-2 text-xs text-zinc-600">{detail}</div>
    </button>
  );
}
