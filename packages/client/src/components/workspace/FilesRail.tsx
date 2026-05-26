import { useCallback, useEffect, useState } from 'react';
import { File as FileIcon, Folder, Loader2 } from 'lucide-react';
import { API, apiFetch } from '../../api/paths';

interface AgentFileEntry {
  name: string;
  path: string;
  type: 'file' | 'directory';
  size?: number;
  mtimeMs?: number;
}

export function FilesRail({ agentId }: { agentId?: string }) {
  const [path, setPath] = useState('');
  const [entries, setEntries] = useState<AgentFileEntry[]>([]);
  const [selected, setSelected] = useState<{ path: string; content: string; truncated?: boolean } | null>(null);
  const [rootLabel, setRootLabel] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (nextPath: string) => {
    if (!agentId) return;
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch(API.agentFiles(agentId, nextPath));
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      setPath(data.path ?? '');
      setRootLabel(`${data.root?.kind ?? 'root'}: ${data.root?.root ?? ''}`);
      setEntries(Array.isArray(data.entries) ? data.entries : []);
      setSelected(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [agentId]);

  useEffect(() => {
    void load('');
  }, [agentId, load]);

  const openEntry = async (entry: AgentFileEntry) => {
    if (!agentId) return;
    if (entry.type === 'directory') {
      await load(entry.path);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch(API.agentFileContent(agentId, entry.path));
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      setSelected({ path: data.path, content: data.content, truncated: data.truncated });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  if (!agentId) {
    return <div className="rounded-xl border border-dashed border-white/[0.08] px-4 py-8 text-center text-xs text-zinc-600">未选择 agent</div>;
  }

  return (
    <div className="space-y-3">
      <div className="min-w-0">
        <div className="truncate text-[10px] uppercase tracking-widest text-zinc-600" title={rootLabel}>{rootLabel || 'Files'}</div>
        <div className="mt-1 flex items-center gap-2">
          <button
            type="button"
            disabled={!path}
            onClick={() => void load(path.split('/').slice(0, -1).join('/'))}
            className="rounded-md border border-white/[0.08] px-2 py-1 text-xs text-zinc-400 disabled:opacity-40"
          >
            Up
          </button>
          <div className="min-w-0 flex-1 truncate font-mono text-xs text-zinc-500">{path || '.'}</div>
          {loading && <Loader2 size={13} className="animate-spin text-zinc-500" />}
        </div>
      </div>
      {error && <div className="rounded-lg border border-red-400/20 bg-red-400/10 px-3 py-2 text-xs text-red-200">{error}</div>}
      <div className="space-y-1">
        {entries.map((entry) => (
          <button
            key={entry.path}
            type="button"
            onClick={() => void openEntry(entry)}
            className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-xs text-zinc-300 hover:bg-white/[0.04]"
          >
            {entry.type === 'directory' ? <Folder size={14} className="text-sky-300" /> : <FileIcon size={14} className="text-zinc-500" />}
            <span className="min-w-0 flex-1 truncate">{entry.name}</span>
            {entry.type === 'file' && <span className="shrink-0 font-mono text-[10px] text-zinc-600">{formatBytes(entry.size ?? 0)}</span>}
          </button>
        ))}
      </div>
      {selected && (
        <div className="rounded-xl border border-white/[0.08] bg-black/20">
          <div className="border-b border-white/[0.06] px-3 py-2 font-mono text-[11px] text-zinc-400">
            {selected.path}{selected.truncated ? ' · truncated' : ''}
          </div>
          <pre className="max-h-80 overflow-auto whitespace-pre-wrap break-words p-3 text-[11px] leading-5 text-zinc-300">{selected.content}</pre>
        </div>
      )}
    </div>
  );
}

function formatBytes(value: number): string {
  if (value < 1024) return `${value}B`;
  if (value < 1024 * 1024) return `${Math.round(value / 1024)}KB`;
  return `${(value / 1024 / 1024).toFixed(1)}MB`;
}
