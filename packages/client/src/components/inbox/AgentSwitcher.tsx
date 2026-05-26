import { useState } from 'react';
import { ChevronDown } from 'lucide-react';
import type { AgentFact } from '@berry-agent/claw-contracts';
import { lastPathPart, modelShortName } from '../../utils/format';
import StatusDot from '../StatusDot';

interface AgentSwitcherProps {
  agents: AgentFact[];
  selectedAgent?: AgentFact;
  onSwitchAgent: (agentId: string) => void;
}

export default function AgentSwitcher({
  agents,
  selectedAgent,
  onSwitchAgent,
}: AgentSwitcherProps) {
  const [open, setOpen] = useState(false);

  return (
    <div className="relative min-w-0 flex-1">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="flex min-w-0 max-w-full items-center gap-2 rounded-lg border border-transparent px-2 py-1.5 text-left transition-colors hover:border-sky-200/16 hover:bg-white/[0.04]"
      >
        <StatusDot status={selectedAgent?.status} />
        <span className="min-w-0 flex-1">
          <span className="flex min-w-0 items-center gap-2">
            <span className="truncate text-sm font-semibold text-zinc-100">
              {selectedAgent?.name ?? '未选择智能体'}
            </span>
            <span className="hidden truncate text-[11px] text-zinc-500 sm:block">
              {modelShortName(selectedAgent?.model)}
            </span>
          </span>
          <span className="mt-0.5 block truncate text-[11px] text-zinc-600">
            {selectedAgent?.project || selectedAgent?.workspace || '未绑定工作区'}
          </span>
        </span>
        <ChevronDown size={14} className={`shrink-0 text-zinc-600 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="absolute left-0 top-12 z-30 w-[min(420px,calc(100vw-96px))] rounded-xl border border-white/[0.10] bg-[#1a1d21] p-2 shadow-2xl">
          <div className="mb-2 px-2 text-[10px] uppercase tracking-wide text-zinc-600">Agent</div>
          <div className="max-h-80 space-y-1 overflow-y-auto pr-1">
            {agents.length === 0 ? (
              <div className="rounded-lg border border-dashed border-white/[0.10] px-3 py-6 text-center text-xs text-zinc-600">
                没有可用 agent
              </div>
            ) : (
              agents.map((agent) => {
                const active = agent.id === selectedAgent?.id;
                return (
                  <button
                    key={agent.id}
                    type="button"
                    onClick={() => {
                      onSwitchAgent(agent.id);
                      setOpen(false);
                    }}
                    className={`flex w-full items-center gap-3 rounded-lg border px-3 py-2 text-left transition-colors ${
                      active
                        ? 'border-sky-200/24 bg-sky-200/[0.075]'
                        : 'border-transparent hover:border-sky-200/16 hover:bg-sky-200/[0.055]'
                    }`}
                  >
                    <StatusDot status={agent.status} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-zinc-100">{agent.name}</span>
                      <span className="mt-0.5 block truncate text-[11px] text-zinc-600">
                        {modelShortName(agent.model)} / {agent.project ? lastPathPart(agent.project) : 'workspace only'}
                      </span>
                    </span>
                    {agent.isActive && (
                      <span className="rounded-md bg-sky-300/10 px-1.5 py-0.5 text-[10px] text-sky-200">
                        active
                      </span>
                    )}
                  </button>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}
