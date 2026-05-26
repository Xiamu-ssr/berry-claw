import { useMemo } from 'react';
import { Search } from 'lucide-react';
import type { AgentFact } from '@berry-agent/claw-contracts';
import { Pill, StatusDot, TextInput } from '../workbench';
import { PixelPortrait } from './AgentPortrait';
import { agentAvatar, lastPathPart, modelShortName } from './helpers';

export function AgentListPane({
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
      className={`w-full rounded-xl border p-3 text-left transition-colors ${
        selected
          ? 'border-sky-200/24 bg-sky-200/[0.075]'
          : 'border-white/[0.07] bg-white/[0.025] hover:border-sky-200/16 hover:bg-sky-200/[0.055]'
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
