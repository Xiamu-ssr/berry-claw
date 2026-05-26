import { useState } from 'react';
import { Loader2 } from 'lucide-react';
import type { MCPServerFact } from '@berry-agent/claw-contracts';
import { cn } from '../../utils/cn';
import { showToast } from '../Toast';

function resolveStatus(s: Pick<MCPServerFact, 'status' | 'connected'>): MCPServerFact['status'] {
  return s.status ?? (s.connected ? 'connected' : 'disabled');
}

const STATUS_STYLES: Record<MCPServerFact['status'], { pill: string; label: string }> = {
  connecting: {
    pill: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300',
    label: 'connecting',
  },
  connected: {
    pill: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300',
    label: 'connected',
  },
  failed: {
    pill: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300',
    label: 'failed',
  },
  disabled: {
    pill: 'bg-gray-100 text-gray-500 bg-white/[0.06] dark:text-gray-400',
    label: 'disabled',
  },
};

interface McpServerRowProps {
  server: MCPServerFact;
  onToggle?: (enabled: boolean) => Promise<void>;
}

export default function McpServerRow({ server, onToggle }: McpServerRowProps) {
  const [busy, setBusy] = useState(false);
  const status = resolveStatus(server);
  const styles = STATUS_STYLES[status];
  const [expanded, setExpanded] = useState(false);
  const effectiveOn = status !== 'disabled';

  async function handleToggle() {
    if (!onToggle || busy || status === 'connecting') return;
    const next = !effectiveOn;
    setBusy(true);
    try {
      await onToggle(next);
    } catch (err) {
      showToast(err instanceof Error ? err.message : String(err), 'error');
    } finally {
      setBusy(false);
    }
  }

  const disabled = busy || status === 'connecting' || !onToggle;

  return (
    <div className="rounded-2xl border border-white/[0.04] bg-[#1a1c20]/50 shadow-sm backdrop-blur-md p-4 transition-all hover:bg-white/[0.03]">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0 flex-1">
          <span
            className={cn(
              'w-2 h-2 rounded-full shrink-0',
              status === 'connected' ? 'bg-teal-400 shadow-[0_0_8px_rgba(45,212,191,0.5)]' :
              status === 'failed' ? 'bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.5)]' :
              status === 'connecting' ? 'bg-amber-400 animate-pulse shadow-[0_0_8px_rgba(251,191,36,0.5)]' :
              'bg-zinc-600',
            )}
            title={status}
          />
          <span className="font-mono text-[13px] font-medium text-zinc-200 truncate">
            {server.name}
          </span>
          <span
            className={`text-xs px-2 py-0.5 rounded-full whitespace-nowrap ${styles.pill}`}
            title={status === 'failed' ? server.lastError : undefined}
          >
            {styles.label}
          </span>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          <span className="text-xs text-zinc-500 whitespace-nowrap">
            {server.toolCount} tool{server.toolCount !== 1 ? 's' : ''}
          </span>
          {onToggle && (
            <button
              type="button"
              role="switch"
              aria-checked={effectiveOn}
              onClick={handleToggle}
              disabled={disabled}
              title={effectiveOn ? 'Disable this MCP server' : 'Enable this MCP server'}
              className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
                effectiveOn ? 'bg-teal-300' : 'bg-gray-300 dark:bg-gray-600'
              }`}
            >
              <span
                className={`inline-flex h-4 w-4 items-center justify-center rounded-full bg-white shadow transform transition-transform ${
                  effectiveOn ? 'translate-x-[18px]' : 'translate-x-0.5'
                }`}
              >
                {(busy || status === 'connecting') && (
                  <Loader2 size={10} className="animate-spin text-gray-500" />
                )}
              </span>
            </button>
          )}
        </div>
      </div>
      {status === 'failed' && server.lastError && (
        <button
          type="button"
          onClick={() => setExpanded(e => !e)}
          className={`mt-2 text-xs font-mono text-red-600 dark:text-red-400 text-left w-full ${
            expanded ? 'whitespace-pre-wrap break-words' : 'truncate'
          }`}
          title="Click to expand"
        >
          {server.lastError}
        </button>
      )}
    </div>
  );
}
