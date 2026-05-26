import type { AgentStatus } from '@berry-agent/claw-contracts';

export default function StatusDot({ ok, status }: { ok?: boolean; status?: AgentStatus }) {
  const className =
    ok === true || status === 'idle' ? 'bg-teal-300' :
    ok === false || status === 'error' ? 'bg-red-400' :
    status === 'sleeping' ? 'bg-zinc-500' :
    status ? 'bg-sky-400 animate-pulse' :
    'bg-zinc-600';

  return <span className={`h-2 w-2 flex-shrink-0 rounded-full ${className}`} />;
}
