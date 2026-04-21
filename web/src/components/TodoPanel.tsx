import { useState, useMemo } from 'react';
import type { TodoItem } from '../types';

interface TodoPanelProps {
  todos: TodoItem[];
}

/**
 * TodoPanel — collapsible strip that shows the agent's current todo list.
 *
 * Hidden entirely when the list is empty. When there is at least one item it
 * shows a compact one-line summary (current in-progress item + counts), and
 * expands to a full checklist on click. Progress is a simple bar based on
 * completed / total.
 */
export default function TodoPanel({ todos }: TodoPanelProps) {
  const [expanded, setExpanded] = useState(true);

  const { completed, inProgress, pending, total, current } = useMemo(() => {
    const completedList = todos.filter(t => t.status === 'completed');
    const inProgressList = todos.filter(t => t.status === 'in_progress');
    const pendingList = todos.filter(t => t.status === 'pending');
    return {
      completed: completedList.length,
      inProgress: inProgressList.length,
      pending: pendingList.length,
      total: todos.length,
      current: inProgressList[0] ?? pendingList[0],
    };
  }, [todos]);

  if (total === 0) return null;

  const pct = total > 0 ? Math.round((completed / total) * 100) : 0;

  return (
    <div className="border-b border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-900/50">
      {/* Header bar */}
      <button
        type="button"
        onClick={() => setExpanded(e => !e)}
        className="w-full px-4 py-2 flex items-center gap-3 text-left hover:bg-gray-100 dark:hover:bg-gray-900/70 transition-colors"
      >
        <span className="text-base">📋</span>

        <div className="flex-1 min-w-0">
          <div className="text-sm text-gray-700 dark:text-gray-300 truncate">
            {current ? (
              <>
                <span className="font-medium">
                  {current.status === 'in_progress' ? (current.activeForm ?? current.content) : current.content}
                </span>
                <span className="text-gray-400 dark:text-gray-500 ml-2">
                  · {completed}/{total} done
                </span>
              </>
            ) : (
              <span className="text-gray-500 dark:text-gray-400">
                All {total} todos completed ✨
              </span>
            )}
          </div>

          {/* Progress bar */}
          <div className="mt-1 h-1 w-full bg-gray-200 dark:bg-gray-800 rounded-full overflow-hidden">
            <div
              className="h-full bg-blue-500 transition-all duration-300"
              style={{ width: `${pct}%` }}
            />
          </div>
        </div>

        <div className="text-xs text-gray-400 dark:text-gray-500 flex-shrink-0 flex items-center gap-2">
          <span>{pct}%</span>
          <span>{expanded ? '▾' : '▸'}</span>
        </div>
      </button>

      {/* Expanded list */}
      {expanded && (
        <ul className="px-4 pb-3 space-y-1">
          {todos.map((todo, i) => (
            <li
              key={i}
              className="flex items-start gap-2 text-sm"
            >
              <StatusIcon status={todo.status} />
              <span className={classForStatus(todo.status)}>
                {todo.status === 'in_progress' && todo.activeForm ? todo.activeForm : todo.content}
              </span>
            </li>
          ))}
          {pending === 0 && inProgress === 0 && total > 0 && (
            <li className="text-xs text-green-600 dark:text-green-400 pt-1">
              ✓ all tasks complete
            </li>
          )}
        </ul>
      )}
    </div>
  );
}

function StatusIcon({ status }: { status: TodoItem['status'] }) {
  if (status === 'completed') {
    return <span className="text-green-600 dark:text-green-400 flex-shrink-0 mt-0.5">☑</span>;
  }
  if (status === 'in_progress') {
    return <span className="text-blue-500 flex-shrink-0 mt-0.5 animate-pulse">◐</span>;
  }
  return <span className="text-gray-400 dark:text-gray-600 flex-shrink-0 mt-0.5">☐</span>;
}

function classForStatus(status: TodoItem['status']): string {
  switch (status) {
    case 'completed':
      return 'text-gray-400 dark:text-gray-500 line-through';
    case 'in_progress':
      return 'text-gray-900 dark:text-gray-100 font-medium';
    default:
      return 'text-gray-600 dark:text-gray-400';
  }
}
