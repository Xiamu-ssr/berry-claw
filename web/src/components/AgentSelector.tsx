import { useState, useEffect, useRef } from 'react';
import { Bot, ChevronDown, Cpu } from 'lucide-react';
import type { AgentInfo, ModelInfo } from '../types';
import { API } from '../api/paths';

interface AgentSelectorProps {
  onAgentSwitch?: () => void;
}

export default function AgentSelector({ onAgentSwitch }: AgentSelectorProps) {
  const [agents, setAgents] = useState<AgentInfo[]>([]);
  const [activeAgentId, setActiveAgentId] = useState('');
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [currentModel, setCurrentModel] = useState('');
  const [agentOpen, setAgentOpen] = useState(false);
  const [modelOpen, setModelOpen] = useState(false);
  const agentRef = useRef<HTMLDivElement>(null);
  const modelRef = useRef<HTMLDivElement>(null);

  useEffect(() => { refresh(); }, []);

  // Refresh when server broadcasts a config mutation (another tab or
  // tool call changed agent settings).
  useEffect(() => {
    const handler = () => { refresh(); };
    window.addEventListener('berry:config-changed', handler);
    return () => window.removeEventListener('berry:config-changed', handler);
  }, []);

  // Close dropdowns on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (agentRef.current && !agentRef.current.contains(e.target as Node)) setAgentOpen(false);
      if (modelRef.current && !modelRef.current.contains(e.target as Node)) setModelOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const refresh = async () => {
    const [agentsRes, modelsRes] = await Promise.all([
      fetch(API.agents).then(r => r.json()),
      fetch(API.models).then(r => r.json()),
    ]);
    setAgents(agentsRes.agents?.map((x: { id: string; entry: AgentInfo['entry'] }) => ({ id: x.id, entry: x.entry })) ?? []);
    setActiveAgentId(agentsRes.activeAgent ?? '');
    setModels(modelsRes.models ?? []);
    setCurrentModel(modelsRes.current?.model ?? '');
  };

  const switchAgent = async (id: string) => {
    await fetch(API.agentActivate(id), { method: 'POST' });
    setActiveAgentId(id);
    setAgentOpen(false);
    onAgentSwitch?.();
    refresh();
  };

  const switchModel = async (model: string) => {
    await fetch(API.modelsSwitch, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model }),
    });
    setCurrentModel(model);
    setModelOpen(false);
  };

  const activeAgent = agents.find(a => a.id === activeAgentId);
  const displayModel = currentModel.split('/').pop() || currentModel;

  return (
    <div className="px-3 py-3 border-b border-gray-200 dark:border-gray-700">
      {/* Agent selector */}
      <div ref={agentRef} className="relative mb-2">
        <button
          onClick={() => setAgentOpen(!agentOpen)}
          className="w-full flex items-center gap-2 px-3 py-2 rounded-lg bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-600 hover:border-berry-300 transition-colors text-left"
        >
          <Bot size={16} className="text-berry-500 flex-shrink-0" />
          <span className="text-sm font-medium text-gray-700 dark:text-gray-200 truncate flex-1">
            {activeAgent?.entry.name ?? 'No Agent'}
          </span>
          <ChevronDown size={14} className={`text-gray-400 transition-transform ${agentOpen ? 'rotate-180' : ''}`} />
        </button>
        {agentOpen && agents.length > 0 && (
          <div className="absolute z-50 top-full left-0 right-0 mt-1 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-600 rounded-lg shadow-lg overflow-hidden">
            {agents.map(a => (
              <button
                key={a.id}
                onClick={() => switchAgent(a.id)}
                className={`w-full text-left px-3 py-2 text-sm hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors ${
                  a.id === activeAgentId ? 'bg-berry-50 dark:bg-berry-900/30 text-berry-700 dark:text-berry-300' : 'text-gray-700 dark:text-gray-200'
                }`}
              >
                <div className="font-medium">{a.entry.name}</div>
                <div className="text-xs text-gray-400 font-mono">{a.entry.model}</div>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Model quick-switch */}
      <div ref={modelRef} className="relative">
        <button
          onClick={() => setModelOpen(!modelOpen)}
          className="w-full flex items-center gap-2 px-3 py-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors text-left"
        >
          <Cpu size={14} className="text-gray-400 flex-shrink-0" />
          <span className="text-xs font-mono text-gray-500 dark:text-gray-400 truncate flex-1">
            {displayModel || 'No model'}
          </span>
          <ChevronDown size={12} className={`text-gray-400 transition-transform ${modelOpen ? 'rotate-180' : ''}`} />
        </button>
        {modelOpen && models.length > 0 && (
          <div className="absolute z-50 top-full left-0 right-0 mt-1 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-600 rounded-lg shadow-lg overflow-hidden max-h-48 overflow-y-auto">
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
    </div>
  );
}
