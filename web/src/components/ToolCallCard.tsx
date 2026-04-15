import { useState } from 'react';
import { Terminal, ChevronDown, ChevronRight, CheckCircle, XCircle } from 'lucide-react';
import type { ToolCallInfo } from '../types';

interface ToolCallCardProps {
  tool: ToolCallInfo;
}

export default function ToolCallCard({ tool }: ToolCallCardProps) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="border border-gray-200 dark:border-gray-700 rounded-lg my-2 overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-2 px-3 py-2 bg-gray-50 dark:bg-gray-800 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors text-left"
      >
        <Terminal size={14} className="text-gray-400 flex-shrink-0" />
        <span className="text-sm font-mono text-gray-600 dark:text-gray-300 flex-1 truncate">
          {tool.name}
        </span>
        {tool.isError !== undefined && (
          tool.isError
            ? <XCircle size={14} className="text-red-400 flex-shrink-0" />
            : <CheckCircle size={14} className="text-green-400 flex-shrink-0" />
        )}
        {expanded
          ? <ChevronDown size={14} className="text-gray-400 flex-shrink-0" />
          : <ChevronRight size={14} className="text-gray-400 flex-shrink-0" />}
      </button>
      {expanded && (
        <div className="px-3 py-2 bg-white dark:bg-gray-900 border-t border-gray-100 dark:border-gray-700">
          <pre className="text-xs font-mono text-gray-500 whitespace-pre-wrap break-all max-h-40 overflow-y-auto">
            {typeof tool.input === 'string'
              ? tool.input
              : JSON.stringify(tool.input, null, 2)}
          </pre>
        </div>
      )}
    </div>
  );
}
