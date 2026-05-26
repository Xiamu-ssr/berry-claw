import { MessageSquare, RotateCcw } from 'lucide-react';
import type { TodoItem } from '@berry-agent/claw-contracts';
import { cn } from '../../utils/cn';
import { formatSessionTime, shortSessionId } from '../../utils/format';
import type { SessionListItem } from './types';

interface SessionRailContentProps {
  sessions: SessionListItem[];
  todos: TodoItem[];
  activeSessionId?: string;
  newSessionDisabled: boolean;
  onResumeSession: (sessionId: string) => void;
  onNewSession: () => void;
}

export function SessionRailContent({
  sessions,
  todos,
  activeSessionId,
  newSessionDisabled,
  onResumeSession,
  onNewSession,
}: SessionRailContentProps) {
  return (
    <>
      <TodoRail todos={todos} />

      <div className="mb-4 mt-8 flex items-center justify-between gap-2">
        <div className="text-[10px] font-semibold uppercase tracking-widest text-zinc-500">History</div>
        <button
          type="button"
          disabled={newSessionDisabled}
          onClick={onNewSession}
          className="inline-flex items-center gap-1.5 rounded-full border border-white/[0.08] bg-white/[0.02] px-2.5 py-1 text-[10px] font-medium uppercase tracking-wider text-zinc-300 transition-colors hover:bg-white/[0.06] disabled:cursor-not-allowed disabled:opacity-40"
        >
          <RotateCcw size={10} />
          New
        </button>
      </div>
      <div className="space-y-1.5">
        {sessions.length === 0 ? (
          <div className="rounded-xl border border-dashed border-white/[0.08] px-4 py-8 text-center text-[11px] text-zinc-600">
            暂无会话历史
          </div>
        ) : (
          sessions.map((session) => {
            const active = session.id === activeSessionId;
            return (
              <button
                key={session.id}
                onClick={() => onResumeSession(session.id)}
                className={cn(
                  'w-full rounded-xl border px-4 py-3 text-left transition-all',
                  active
                    ? 'border-[var(--theme-primary-hover)] bg-[var(--theme-primary-soft)] shadow-[0_0_15px_var(--theme-primary-soft)]'
                    : 'border-transparent hover:border-white/[0.04] hover:bg-white/[0.02]',
                )}
              >
                <div className="flex items-start gap-3">
                  <div className={cn('mt-0.5', active ? 'text-[var(--theme-primary)]' : 'text-zinc-600')}>
                    <MessageSquare size={14} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className={cn('truncate text-[13px] font-medium', active ? 'text-[var(--theme-primary)]' : 'text-zinc-300')}>
                      {session.title || shortSessionId(session.id)}
                    </div>
                    <div className="mt-1 flex items-center justify-between gap-2 text-[10px] text-zinc-500">
                      <span className="truncate font-mono opacity-60">{shortSessionId(session.id)}</span>
                      <span className="flex shrink-0 items-center gap-1">
                        {session.status === 'interrupted' && <span className="text-amber-300">中断</span>}
                        <span>{formatSessionTime(session.updatedAt)}</span>
                      </span>
                    </div>
                  </div>
                </div>
              </button>
            );
          })
        )}
      </div>
    </>
  );
}

function TodoRail({ todos }: { todos: TodoItem[] }) {
  const openCount = todos.filter((todo) => !todo.done).length;

  return (
    <section className="rounded-2xl border border-white/[0.04] bg-white/[0.01] p-4">
      <div className="mb-4 flex items-center justify-between gap-2">
        <div className="text-[10px] font-semibold uppercase tracking-widest text-zinc-500">To-do</div>
        <span className="rounded-full bg-white/[0.04] px-2 py-0.5 font-mono text-[10px] text-zinc-400">
          {openCount}/{todos.length}
        </span>
      </div>
      {todos.length === 0 ? (
        <div className="rounded-xl border border-dashed border-white/[0.06] px-4 py-8 text-center text-[11px] text-zinc-600">
          没有待办事项
        </div>
      ) : (
        <div className="space-y-1.5">
          {todos.map((todo, index) => (
            <div
              key={`${todo.text}-${index}`}
              className={cn(
                'rounded-xl border px-3 py-2.5 transition-colors',
                todo.done
                  ? 'border-transparent bg-white/[0.01] text-zinc-600'
                  : 'border-white/[0.04] bg-white/[0.02] text-zinc-200',
              )}
            >
              <div className="flex items-start gap-2.5">
                <span
                  className={cn(
                    'mt-[5px] h-1.5 w-1.5 shrink-0 rounded-full',
                    todo.done ? 'bg-zinc-700' : 'bg-[var(--theme-primary)] animate-pulse',
                  )}
                />
                <span className={cn('min-w-0 flex-1 text-[12px] leading-[1.6]', todo.done && 'line-through opacity-60')}>
                  {todo.text}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
