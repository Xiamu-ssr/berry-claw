import { useState, useMemo } from 'react';
import {
  Terminal, ChevronDown, ChevronRight, CheckCircle, XCircle, Loader2, ArrowRight, ArrowLeft, CircleDot,
} from 'lucide-react';
import type { ToolCallInfo } from '@berry-claw/contracts';

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
  const [expanded, setExpanded] = useState(false);

  const inputText = useMemo(() => formatPayload(tool.input), [tool.input]);
  const hasResult = tool.result !== undefined && tool.result !== null;
  const outputText = useMemo(() => (hasResult ? formatPayload(tool.result) : ''), [tool.result, hasResult]);
  const hasVisibleOutput = hasResult && outputText.length > 0;
  const pending = !settled && !hasResult && tool.isError === undefined;
  const missingResult = settled && !hasResult && tool.isError === undefined;

  return (
    <div
      className={`border rounded-lg my-2 overflow-hidden ${
        tool.isError
          ? 'border-red-300 dark:border-red-900/50'
          : 'border-gray-200 dark:border-gray-700'
      }`}
    >
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-2 px-3 py-2 bg-gray-50 dark:bg-gray-800 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors text-left"
      >
        <Terminal size={14} className="text-gray-400 flex-shrink-0" />
        <span className="text-sm font-mono text-gray-600 dark:text-gray-300 flex-1 truncate">
          {tool.name}
        </span>
        {pending ? (
          <Loader2 size={14} className="text-gray-400 flex-shrink-0 animate-spin" />
        ) : tool.isError ? (
          <XCircle size={14} className="text-red-400 flex-shrink-0" />
        ) : missingResult ? (
          <CircleDot size={14} className="text-zinc-500 flex-shrink-0" />
        ) : (
          <CheckCircle size={14} className="text-green-500 flex-shrink-0" />
        )}
        {expanded
          ? <ChevronDown size={14} className="text-gray-400 flex-shrink-0" />
          : <ChevronRight size={14} className="text-gray-400 flex-shrink-0" />}
      </button>

      {expanded && (
        <div className="bg-white dark:bg-gray-900 border-t border-gray-100 dark:border-gray-700">
          <PayloadSection
            label="Input"
            icon={<ArrowRight size={12} className="text-blue-500" />}
            content={inputText}
            empty={!inputText}
            defaultOpen
          />
          <PayloadSection
            label="Output"
            icon={<ArrowLeft size={12} className="text-amber-500" />}
            content={outputText}
            empty={!hasVisibleOutput}
            emptyHint={pending ? 'Tool is running…' : hasResult ? 'Empty result' : 'Result not captured'}
            tone={tool.isError ? 'error' : 'normal'}
            defaultOpen={hasResult}
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
    <div className="border-b last:border-b-0 border-gray-100 dark:border-gray-800">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-2 px-3 py-1.5 text-left hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors"
      >
        {icon}
        <span className="text-[11px] font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400 flex-1">
          {label}
        </span>
        {open
          ? <ChevronDown size={12} className="text-gray-400" />
          : <ChevronRight size={12} className="text-gray-400" />}
      </button>
      {open && (
        empty ? (
          <div className="px-3 pb-2 pt-1 text-xs italic text-gray-400 dark:text-gray-600">
            {emptyHint ?? '—'}
          </div>
        ) : (
          <pre
            className={`px-3 pb-2 pt-1 text-xs font-mono whitespace-pre-wrap break-all max-h-60 overflow-y-auto ${
              tone === 'error'
                ? 'text-red-600 dark:text-red-400'
                : 'text-gray-600 dark:text-gray-300'
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
