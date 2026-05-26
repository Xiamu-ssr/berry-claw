import { useState, useMemo, useEffect } from 'react';
import {
  Terminal, ChevronDown, ChevronRight, CheckCircle, XCircle, Loader2, ArrowRight, ArrowLeft, CircleDot,
} from 'lucide-react';
import type { ToolCallInfo } from '@berry-agent/claw-contracts';

interface ToolCallCardProps {
  tool: ToolCallInfo;
  settled?: boolean;
}

/**
 * Collapsible tool-use card. Header shows the tool name + status. Expanding
 * reveals two independently-collapsible sections — Input (request args) and
 * Output (tool result). Both are pretty-printed: object-shaped values get
 * JSON indentation, strings render as-is with line wrapping. No modal pops;
 * everything stays inline so the user can diff input/output at a glance.
 *
 * `tool.result` may be absent while the tool is still executing. In that
 * case we render an explicit pending output section instead of a blank card.
 */
export default function ToolCallCard({ tool, settled = false }: ToolCallCardProps) {
  const [expanded, setExpanded] = useState(!settled);

  useEffect(() => {
    setExpanded(!settled);
  }, [settled]);

  const inputText = useMemo(() => formatPayload(tool.input), [tool.input]);
  const hasResult = tool.result !== undefined && tool.result !== null;
  const outputText = useMemo(() => (hasResult ? formatPayload(tool.result) : ''), [tool.result, hasResult]);
  const hasVisibleOutput = hasResult && outputText.length > 0;
  const pending = !settled && !hasResult && tool.isError === undefined;
  const missingResult = settled && !hasResult && tool.isError === undefined;

  return (
    <div
      className={`border rounded-xl my-2 overflow-hidden transition-all ${
        tool.isError
          ? 'border-red-500/20 bg-red-500/5'
          : 'border-white/[0.04] bg-white/[0.015]'
      }`}
    >
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-3 px-3 py-2 hover:bg-white/[0.03] transition-colors text-left"
      >
        <div className={`flex items-center justify-center w-5 h-5 rounded-md ${
           pending ? 'bg-amber-400/10 text-amber-400' :
           tool.isError ? 'bg-red-400/10 text-red-400' :
           missingResult ? 'bg-zinc-500/10 text-zinc-400' :
           'bg-teal-400/10 text-teal-400'
        }`}>
          <Terminal size={10} />
        </div>
        <span className="text-[12px] font-mono text-zinc-300 flex-1 truncate">
          {tool.name}
        </span>
        {pending ? (
          <Loader2 size={12} className="text-amber-400 flex-shrink-0 animate-spin" />
        ) : tool.isError ? (
          <XCircle size={12} className="text-red-400 flex-shrink-0" />
        ) : missingResult ? (
          <CircleDot size={12} className="text-zinc-500 flex-shrink-0" />
        ) : (
          <CheckCircle size={12} className="text-teal-400 flex-shrink-0" />
        )}
        <ChevronRight size={12} className={`text-zinc-500 flex-shrink-0 transition-transform ${expanded ? 'rotate-90' : ''}`} />
      </button>

      {expanded && (
        <div className="bg-black/20 border-t border-white/[0.04]">
          <PayloadSection
            label="Input"
            icon={<ArrowRight size={10} className="text-amber-400" />}
            content={inputText}
            empty={!inputText}
            defaultOpen
          />
          <PayloadSection
            label="Output"
            icon={<ArrowLeft size={10} className="text-teal-400" />}
            content={outputText}
            empty={!hasVisibleOutput}
            emptyHint={pending ? 'Executing...' : hasResult ? 'Empty result' : 'Result not captured'}
            tone={tool.isError ? 'error' : 'normal'}
            defaultOpen={hasResult || pending}
          />
        </div>
      )}
    </div>
  );
}

/**
 * One labeled, collapsible chunk of payload (Input or Output). Lives inside
 * the ToolCallCard expanded region. Keeps its own open/close state so users
 * can hide the Input while keeping the Output on-screen (or vice versa).
 */
function PayloadSection({
  label,
  icon,
  content,
  empty,
  emptyHint,
  tone = 'normal',
  defaultOpen = false,
}: {
  label: string;
  icon: React.ReactNode;
  content: string;
  empty: boolean;
  emptyHint?: string;
  tone?: 'normal' | 'error';
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div className="border-b last:border-b-0 border-white/[0.04]">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-white/[0.02] transition-colors"
      >
        {icon}
        <span className="text-[10px] font-semibold uppercase tracking-widest text-zinc-500 flex-1">
          {label}
        </span>
        <ChevronRight size={12} className={`text-zinc-600 transition-transform ${open ? 'rotate-90' : ''}`} />
      </button>
      {open && (
        empty ? (
          <div className="px-3 pb-2 pt-1 text-[11px] italic text-zinc-600">
            {emptyHint ?? '—'}
          </div>
        ) : (
          <pre
            className={`px-3 pb-3 pt-1 text-[11px] font-mono whitespace-pre-wrap break-all max-h-60 overflow-y-auto hide-scrollbar ${
              tone === 'error'
                ? 'text-red-400'
                : 'text-zinc-300'
            }`}
          >
            {content}
          </pre>
        )
      )}
    </div>
  );
}

/**
 * Stringify a payload for display. Strings pass through untouched so long
 * tool outputs (file contents, logs) keep their original line breaks and
 * don't get JSON-escaped into a single mess. Objects/arrays get 2-space
 * indentation. `undefined` / `null` collapse to empty so we can detect
 * "no payload".
 */
function formatPayload(value: unknown): string {
  if (value === undefined || value === null) return '';
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}
