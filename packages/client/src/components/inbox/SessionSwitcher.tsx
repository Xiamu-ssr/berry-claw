import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, MessageSquare, RotateCcw, Search } from 'lucide-react';
import { formatSessionTime, shortSessionId } from '../../utils/format';
import type { SessionListItem } from '../workspace/types';

interface SessionSwitcherProps {
  sessions: SessionListItem[];
  activeSession?: SessionListItem;
  activeSessionId?: string;
  newSessionDisabled: boolean;
  onResumeSession: (sessionId: string) => void;
  onNewSession: () => void;
}

export default function SessionSwitcher({
  sessions,
  activeSession,
  activeSessionId,
  newSessionDisabled,
  onResumeSession,
  onNewSession,
}: SessionSwitcherProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (boxRef.current && !boxRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    if (open) document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [open]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return sessions;
    return sessions.filter((session) =>
      [session.title ?? '', session.id].join(' ').toLowerCase().includes(q),
    );
  }, [query, sessions]);

  return (
    <div ref={boxRef} className="relative">
      <div className="flex items-center gap-2">
        <button
          onClick={() => setOpen((value) => !value)}
          className="hidden h-8 max-w-[280px] items-center gap-2 rounded-md border border-white/[0.08] bg-white/[0.04] px-2.5 text-left text-xs text-zinc-300 transition-colors hover:bg-white/[0.08] md:inline-flex"
          title={activeSessionId ?? 'No session'}
        >
          <MessageSquare size={13} className="text-zinc-500" />
          <span className="min-w-0 truncate">
            {activeSession?.title || shortSessionId(activeSessionId) || '没有 session'}
          </span>
          {typeof activeSession?.messageCount === 'number' && (
            <span className="rounded bg-black/10 px-1.5 py-0.5 text-[10px] text-zinc-500">
              {activeSession.messageCount}
            </span>
          )}
          <ChevronDown size={13} className={`text-zinc-600 transition-transform ${open ? 'rotate-180' : ''}`} />
        </button>
        <button
          disabled={newSessionDisabled}
          onClick={() => {
            if (newSessionDisabled) return;
            onNewSession();
            setOpen(false);
          }}
          className="inline-flex h-8 items-center gap-1.5 rounded-md border border-white/[0.08] bg-white/[0.04] px-2.5 text-xs text-zinc-300 transition-colors hover:bg-white/[0.08] disabled:cursor-not-allowed disabled:opacity-45 disabled:hover:bg-white/[0.04]"
        >
          <RotateCcw size={13} />
          新会话
        </button>
      </div>

      {open && (
        <div className="absolute right-0 top-10 z-50 w-[360px] overflow-hidden rounded-xl border border-white/[0.10] bg-[#20242a] shadow-2xl max-md:hidden">
          <div className="border-b border-white/[0.07] p-2">
            <div className="relative">
              <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-zinc-600" />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="搜索 session"
                className="h-8 w-full rounded-lg border border-white/[0.08] bg-black/10 pl-8 pr-3 text-xs text-zinc-200 outline-none placeholder:text-zinc-600 focus:border-sky-300/45"
              />
            </div>
          </div>
          <div className="max-h-[420px] overflow-y-auto p-2">
            {filtered.length === 0 ? (
              <div className="rounded-lg border border-dashed border-white/[0.10] px-3 py-8 text-center text-xs text-zinc-600">
                没有匹配的 session
              </div>
            ) : (
              filtered.map((session) => {
                const active = session.id === activeSessionId;
                return (
                  <button
                    key={session.id}
                    onClick={() => {
                      onResumeSession(session.id);
                      setOpen(false);
                    }}
                    className={`w-full rounded-lg border px-3 py-2 text-left transition-colors ${
                      active
                        ? 'border-sky-300/30 bg-sky-300/10'
                        : 'border-transparent hover:border-sky-200/16 hover:bg-white/[0.04]'
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <span className="min-w-0 flex-1 truncate text-sm text-zinc-100">
                        {session.title || shortSessionId(session.id)}
                      </span>
                      {typeof session.messageCount === 'number' && (
                        <span className="rounded-md bg-black/10 px-1.5 py-0.5 text-[10px] text-zinc-500">
                          {session.messageCount}
                        </span>
                      )}
                    </div>
                    <div className="mt-1 flex items-center justify-between gap-3 text-[11px] text-zinc-600">
                      <span className="truncate font-mono">{shortSessionId(session.id)}</span>
                      <span className="flex flex-shrink-0 items-center gap-1">
                        {session.status === 'interrupted' && <span className="text-amber-300">中断</span>}
                        <span>{formatSessionTime(session.updatedAt)}</span>
                      </span>
                    </div>
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
