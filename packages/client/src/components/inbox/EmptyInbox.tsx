import { Inbox } from 'lucide-react';
import type { AgentFact } from '@berry-agent/claw-contracts';
import { modelShortName } from '../../utils/format';
import StatusDot from '../StatusDot';

export default function EmptyInbox({ agent }: { agent?: AgentFact }) {
  return (
    <div className="flex h-full min-h-[480px] items-center justify-center">
      <div className="w-full max-w-2xl text-center">
        <div className="relative mx-auto mb-8 flex h-20 w-20 items-center justify-center">
          <div className="absolute inset-0 rounded-3xl bg-gradient-to-tr from-[var(--theme-primary)]/20 to-[var(--theme-primary)]/5 blur-xl" />
          <div className="relative flex h-full w-full items-center justify-center rounded-3xl border border-white/[0.08] bg-[#1a1c20] text-[var(--theme-primary)] shadow-[0_18px_60px_rgba(0,0,0,0.5),0_0_0_1px_rgba(255,255,255,0.05)_inset]">
            <Inbox size={28} />
          </div>
        </div>
        <h2 className="text-xl font-semibold tracking-normal text-zinc-100">{agent?.name ?? 'Ready to start'}</h2>
        <div className="mx-auto mt-4 flex max-w-lg flex-wrap justify-center gap-2 text-[11px] font-medium uppercase tracking-wide text-zinc-500">
          <span className="rounded-full border border-white/[0.04] bg-white/[0.02] px-3 py-1.5">
            {agent?.model ? modelShortName(agent.model) : 'No model'}
          </span>
          <span className="rounded-full border border-white/[0.04] bg-white/[0.02] px-3 py-1.5">
            {agent?.provider ?? 'No provider'}
          </span>
          <span className="flex items-center gap-1.5 rounded-full border border-white/[0.04] bg-white/[0.02] px-3 py-1.5">
            <StatusDot status={agent?.status} /> {agent?.status ?? 'idle'}
          </span>
        </div>
      </div>
    </div>
  );
}
