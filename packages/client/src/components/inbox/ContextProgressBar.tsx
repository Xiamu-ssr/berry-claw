import { cn } from '../../utils/cn';

interface ContextProgressBarProps {
  used: number;
  contextWindow: number | null;
}

export default function ContextProgressBar({ used, contextWindow }: ContextProgressBarProps) {
  const hasWindow = typeof contextWindow === 'number' && contextWindow > 0;
  const pct = hasWindow ? Math.min(100, Math.max(0, (used / contextWindow) * 100)) : 0;
  const isHigh = pct > 85;
  const isMedium = pct > 65;

  return (
    <div className="flex min-w-[200px] flex-col items-center justify-center gap-1">
      <div className="relative h-1.5 w-full overflow-hidden rounded-full border border-white/[0.05] bg-white/[0.04] shadow-inner">
        <div
          className={cn(
            'absolute left-0 top-0 h-full rounded-full transition-all duration-700 ease-out',
            isHigh ? 'bg-red-500 shadow-[0_0_10px_rgba(239,68,68,0.5)]'
              : isMedium ? 'bg-amber-400 shadow-[0_0_10px_rgba(251,191,36,0.5)]'
              : 'bg-[var(--theme-primary)] shadow-[0_0_10px_var(--theme-primary-glow)]',
          )}
          style={{ width: `${pct}%`, opacity: used > 0 ? 1 : 0 }}
        />
        <div className="pointer-events-none absolute inset-0 flex h-full w-full justify-between opacity-20">
          <div className="ml-[25%] h-full w-px bg-white" />
          <div className="ml-[25%] h-full w-px bg-white" />
          <div className="ml-[25%] h-full w-px bg-white" />
        </div>
      </div>
      <div className="mt-0.5 font-mono text-[9px] font-semibold uppercase tracking-widest text-zinc-500">
        {hasWindow
          ? `CTX: ${Math.round(pct)}% · ${used.toLocaleString()} / ${contextWindow.toLocaleString()}`
          : `CTX: ${used.toLocaleString()} / ∞`}
      </div>
    </div>
  );
}
