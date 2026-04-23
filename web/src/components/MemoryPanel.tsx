/**
 * MemoryPanel — per-agent MEMORY.md editor + shared project knowledge viewer.
 *
 * Shown inside the AgentsPage expanded card. Two read/write sources:
 *
 * 1. Personal memory: `{workspace}/MEMORY.md` — editable textarea.
 *    Owned by this one agent. Auto-flushed before hard compactions.
 *
 * 2. Project knowledge: `AGENTS.md`, `PROJECT.md`, `.berry-discoveries.md`
 *    under the agent's project dir — read-only preview. Shared across
 *    teammates. Writes happen via the agent's save_discovery tool.
 */
import { useEffect, useState } from 'react';
import { Save, Loader2, Brain, BookOpen } from 'lucide-react';
import { API } from '../api/paths';
import { showToast } from './Toast';

interface MemoryPanelProps {
  agentId: string;
  hasProject: boolean;
}

interface KnowledgeFile {
  path: string;
  content: string;
}

export default function MemoryPanel({ agentId, hasProject }: MemoryPanelProps) {
  const [memory, setMemory] = useState('');
  const [originalMemory, setOriginalMemory] = useState('');
  const [memoryPath, setMemoryPath] = useState('');
  const [knowledge, setKnowledge] = useState<KnowledgeFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const [memRes, knowledgeRes] = await Promise.all([
          fetch(API.agentMemory(agentId)).then((r) => r.json()),
          hasProject
            ? fetch(API.agentProjectKnowledge(agentId)).then((r) => r.json())
            : Promise.resolve({ files: [] }),
        ]);
        if (cancelled) return;
        setMemory(memRes.content ?? '');
        setOriginalMemory(memRes.content ?? '');
        setMemoryPath(memRes.path ?? '');
        setKnowledge(knowledgeRes.files ?? []);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [agentId, hasProject]);

  const save = async () => {
    setSaving(true);
    try {
      const res = await fetch(API.agentMemory(agentId), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: memory }),
      });
      if (!res.ok) throw new Error('save failed');
      setOriginalMemory(memory);
      showToast('Memory saved');
    } catch (err) {
      showToast(`Save failed: ${(err as Error).message}`, 'error');
    } finally {
      setSaving(false);
    }
  };

  const dirty = memory !== originalMemory;

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-sm text-gray-500 py-4">
        <Loader2 size={14} className="animate-spin" /> Loading memory…
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Personal memory */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2 text-sm font-semibold text-gray-800 dark:text-gray-200">
            <Brain size={14} className="text-berry-500" /> Personal Memory
          </div>
          <button
            onClick={save}
            disabled={!dirty || saving}
            className={`px-2.5 py-1 text-xs rounded flex items-center gap-1 transition-colors ${
              dirty
                ? 'bg-berry-600 hover:bg-berry-700 text-white'
                : 'bg-gray-100 dark:bg-gray-700 text-gray-400 cursor-not-allowed'
            }`}
          >
            {saving ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />}
            Save
          </button>
        </div>
        <div className="text-[10px] font-mono text-gray-400 mb-1 truncate">{memoryPath}</div>
        <textarea
          value={memory}
          onChange={(e) => setMemory(e.target.value)}
          className="w-full h-48 px-3 py-2 text-xs font-mono bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-md resize-y"
          placeholder="# Long-term notes this agent should remember across sessions…"
          spellCheck={false}
        />
      </div>

      {/* Project knowledge (read-only) */}
      {hasProject && (
        <div>
          <div className="flex items-center gap-2 text-sm font-semibold text-gray-800 dark:text-gray-200 mb-2">
            <BookOpen size={14} className="text-indigo-500" /> Project Knowledge
            <span className="text-xs text-gray-400 font-normal">(shared with teammates)</span>
          </div>
          {knowledge.length === 0 ? (
            <div className="text-xs text-gray-400 italic">
              No AGENTS.md / PROJECT.md / .berry-discoveries.md yet. The agent can call
              <code className="mx-1 px-1 bg-gray-100 dark:bg-gray-700 rounded">save_discovery</code>
              to seed one.
            </div>
          ) : (
            <div className="space-y-2">
              {knowledge.map((f) => (
                <details key={f.path} className="bg-gray-50 dark:bg-gray-800 rounded-md">
                  <summary className="px-3 py-1.5 cursor-pointer text-xs font-mono text-indigo-700 dark:text-indigo-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-md">
                    {f.path}
                    <span className="text-gray-400 ml-2">({f.content.length} chars)</span>
                  </summary>
                  <pre className="px-3 py-2 text-xs font-mono text-gray-700 dark:text-gray-300 whitespace-pre-wrap break-words overflow-x-auto max-h-64 overflow-y-auto">
                    {f.content}
                  </pre>
                </details>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
