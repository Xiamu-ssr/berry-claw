/**
 * Chat-page top bar. Replaces the old w-56 left panel that wasted ~70%
 * vertical space to host two controls.
 *
 * Layout (horizontal): [Agent ▼]  [Model ▼]  …spacer…  [↻ Compact]
 *
 * All state reads flow through the FactStore via useFacts hooks — the
 * bar participates in the same single-source-of-truth loop as every
 * other component, so cross-tab switches propagate with zero glue.
 */
import { useState, useEffect, useRef } from 'react';
import { Bot, ChevronDown, Cpu, RefreshCw } from 'lucide-react';
import type { ModelInfo } from '../types';
import { API } from '../api/paths';
import { useAgentFacts, useActiveAgent } from '../facts/useFacts';

interface ChatHeaderProps {
  onCompact: () => void;
  onAgentSwitch?: () => void;
}

export default function ChatHeader({ onCompact, onAgentSwitch }: ChatHeaderProps) {
  const agents = useAgentFacts();
  const activeAgent = useActiveAgent();
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [agentOpen, setAgentOpen] = useState(false);
  const [modelOpen, setModelOpen] = useState(false);
  const agentRef = useRef<HTMLDivElement>(null);
  const modelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetch(API.models).then(r => r.json()).then(d => setModels(d.models ?? []));
  }, []);

  useEffect(() => {
    const h = (e: MouseEvent) => {
      if (agentRef.current && !agentRef.current.contains(e.target as Node)) setAgentOpen(false);
      if (modelRef.current && !modelRef.current.contains(e.target as Node)) setModelOpen(false);
    };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);

  const switchAgent = async (id: string) => {
    await fetch(API.agentActivate(id), { method: 'POST' });
    setAgentOpen(false);
    onAgentSwitch?.();
  };

  const switchModel = async (model: string) => {
    await fetch(API.modelsSwitch, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model }),
    });
    setModelOpen(false);
  };

  const currentModel = activeAgent?.model ?? '';
  const displayModel = currentModel.split('/').pop() || currentModel || 'No model';

  return (
    <div className="flex items-center gap-2 px-4 h-12 border-b border-gray-200 dark:border-gray-700 bg-white/70 dark:bg-gray-900/70 backdrop-blur-sm flex-shrink-0">
      {/* Agent picker */}
      <div ref={agentRef} className="relative">
        <button
          onClick={() => setAgentOpen(!agentOpen)}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-md hover:bg-gray-100 dark:hover:bg-gray-800 text-sm font-medium text-gray-700 dark:text-gray-200 transition-colors"
        >
          <Bot size={15} className="text-berry-500" />
          <span className="max-w-[120px] truncate">{activeAgent?.name ?? 'No Agent'}</span>
          <ChevronDown size={13} className={`text-gray-400 transition-transform ${agentOpen ? 'rotate-180' : ''}`} />
        </button>
        {agentOpen && agents.length > 0 && (
          <div className="absolute z-50 top-full left-0 mt-1 min-w-[220px] bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-600 rounded-lg shadow-lg overflow-hidden">
            {agents.map(a => (
              <button
                key={a.id}
                onClick={() => switchAgent(a.id)}
                className={`w-full text-left px-3 py-2 text-sm hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors ${
                  a.isActive ? 'bg-berry-50 dark:bg-berry-900/30 text-berry-700 dark:text-berry-300' : 'text-gray-700 dark:text-gray-200'
                }`}
              >
                <div className="font-medium">{a.name}</div>
                <div className="text-xs text-gray-400 font-mono">{a.model}</div>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Model picker */}
      <div ref={modelRef} className="relative">
        <button
          onClick={() => setModelOpen(!modelOpen)}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-md hover:bg-gray-100 dark:hover:bg-gray-800 text-xs font-mono text-gray-500 dark:text-gray-400 transition-colors"
        >
          <Cpu size={13} />
          <span className="max-w-[180px] truncate">{displayModel}</span>
          <ChevronDown size={12} className={`transition-transform ${modelOpen ? 'rotate-180' : ''}`} />
        </button>
        {modelOpen && models.length > 0 && (
          <div className="absolute z-50 top-full left-0 mt-1 min-w-[260px] bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-600 rounded-lg shadow-lg overflow-hidden max-h-64 overflow-y-auto">
            {models.map(m => (
              <button
                key={m.model}
                onClick={() => switchModel(m.model)}
                className={`w-full text-left px-3 py-2 text-xs font-mono hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors ${
                  m.model === currentModel ? 'bg-berry-50 dark:bg-berry-900/30 text-berry-700 dark:text-berry-300' : 'text-gray-600 dark:text-gray-300'
                }`}
              >
                {m.model}
                <span className="text-gray-400 ml-1">({m.providerName})</span>
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="flex-1" />

      {/* Compact */}
      <button
        onClick={onCompact}
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm text-amber-700 dark:text-amber-400 hover:bg-amber-50 dark:hover:bg-amber-900/20 transition-colors"
        title="Compact session — collapse old messages into a summary (like /new)"
      >
        <RefreshCw size={14} />
        <span>Compact</span>
      </button>
    </div>
  );
}
