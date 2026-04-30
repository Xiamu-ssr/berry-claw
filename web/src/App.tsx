import { useState, useCallback, useEffect, useRef } from 'react';
import {
  Send, Loader2, Paperclip, X, ChevronDown, ChevronRight,
  MessageSquare, BarChart3, Settings, Bot, Users, Brain,
  Terminal, CheckCircle, Copy, Check, Menu, Zap, Sparkles,
} from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useWebSocket } from './hooks/useWebSocket';
import ToastContainer, { useToast } from './components/Toast';
import type {
  AgentStatus, ChatMessage, ToolCallInfo, TodoItem,
  WsIncoming, ContentBlock, InferenceInfo,
} from './types';
import { API } from './api/paths';
import { factStore } from './facts/store';
import { useFactHydration, useAgentFacts } from './facts/useFacts';
import type { AgentFact } from './facts/types';
import SettingsPage from './components/SettingsPage';
import AgentsPage from './components/AgentsPage';
import TeamsPage from './components/TeamsPage';
import SkillMarketPage from './components/SkillMarketPage';
import ObserveDashboard from './components/ObserveDashboard';
import CodeBlock from './components/CodeBlock';

/* ================================================================
   App
   ================================================================ */

export default function App() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [streamingText, setStreamingText] = useState('');
  const [thinkingText, setThinkingText] = useState('');
  const [pendingTools, setPendingTools] = useState<ToolCallInfo[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [activeSessionId, setActiveSessionId] = useState<string>();
  const [agentStatus, setAgentStatus] = useState<AgentStatus>('idle');
  const [agentStatusDetail, setAgentStatusDetail] = useState<string | undefined>(undefined);
  const [todos, setTodos] = useState<TodoItem[]>([]);
  const [rightPanelOpen, setRightPanelOpen] = useState(true);
  const [activeTab, setActiveTab] = useState<'chat' | 'observe' | 'agents' | 'team' | 'skills' | 'settings'>('chat');

  /* ---- streaming inference state ---- */
  const [streamingInferences, setStreamingInferences] = useState<InferenceInfo[]>([]);

  /* ---- context window tracking ---- */
  const [contextTokensUsed, setContextTokensUsed] = useState(0);
  const [contextWindow, setContextWindow] = useState(200_000);

  /* ---- responsive layout ---- */
  const [mobileLeftOpen, setMobileLeftOpen] = useState(false);

  const agentFacts = useAgentFacts();
  const selectedAgent = agentFacts.find((a) => a.isActive);
  const [selectedAgentId, setSelectedAgentId] = useState<string | undefined>(selectedAgent?.id);
  const selectedAgentIdRef = useRef<string | undefined>(undefined);
  selectedAgentIdRef.current = selectedAgentId;

  const toast = useToast();
  const toastRef = useRef(toast);
  toastRef.current = toast;

  const pendingToolsRef = useRef<ToolCallInfo[]>([]);
  const thinkingTextRef = useRef('');

  /* ---- agent selection ---- */
  useEffect(() => {
    if (selectedAgent && !selectedAgentId) {
      setSelectedAgentId(selectedAgent.id);
    }
  }, [selectedAgent, selectedAgentId]);

  /* ---- session list state ---- */
  const [sessions, setSessions] = useState<Array<{ id: string; title?: string; updatedAt?: number }>>([]);

  const fetchAgentSessions = useCallback(async (agentId?: string) => {
    if (!agentId) return;
    try {
      const res = await fetch(`${API.sessions}?agentId=${encodeURIComponent(agentId)}`);
      const data = await res.json();
      const list = data.sessions || [];
      setSessions(list.map((s: any) => ({ id: s.id, title: s.title, updatedAt: s.lastActiveAt ?? s.createdAt })));
      if (list.length === 0) {
        setActiveSessionId(undefined);
        setMessages([]);
        return;
      }
      const session = list[0];
      setActiveSessionId(session.id);
      setMessages(Array.isArray(session.messages) ? session.messages : []);
    } catch {
      // ignore
    }
  }, []);

  const fetchAgentContextSize = useCallback(async (agentId?: string) => {
    if (!agentId) return;
    try {
      const res = await fetch(API.agentContextSize(agentId));
      if (!res.ok) return;
      const data = await res.json();
      if (typeof data.current === 'number' && typeof data.window === 'number') {
        setContextTokensUsed(data.current);
        setContextWindow(data.window);
      }
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    fetchAgentSessions(selectedAgentId);
  }, [selectedAgentId, fetchAgentSessions]);

  /* ---- WebSocket handler ---- */
  const handleWsMessage = useCallback((msg: WsIncoming) => {
    switch (msg.type) {
      case 'start':
        setIsLoading(true);
        setStreamingText('');
        setThinkingText('');
        setPendingTools([]);
        setStreamingInferences([]);
        pendingToolsRef.current = [];
        thinkingTextRef.current = '';
        break;

      case 'user_message_persisted':
        setMessages((prev) => {
          const idx = msg.message.requestId
            ? prev.findIndex((m) => m.role === 'user' && m.requestId === msg.message.requestId)
            : -1;
          if (idx >= 0) {
            const next = [...prev];
            next[idx] = { ...next[idx], ...msg.message };
            return next;
          }
          return [...prev, msg.message];
        });
        setActiveSessionId(msg.sessionId);
        break;

      case 'text_delta':
        setStreamingText((prev) => prev + msg.text);
        break;

      case 'thinking_delta':
        thinkingTextRef.current += msg.thinking;
        setThinkingText(thinkingTextRef.current);
        break;

      case 'tool_call': {
        const newTool: ToolCallInfo = { name: msg.name, input: msg.input };
        pendingToolsRef.current = [...pendingToolsRef.current, newTool];
        setPendingTools([...pendingToolsRef.current]);
        break;
      }

      case 'tool_result': {
        const updated = pendingToolsRef.current.map((t) => {
          if (t.name === msg.name && t.isError === undefined) {
            return { ...t, isError: msg.isError };
          }
          return t;
        });
        pendingToolsRef.current = updated;
        setPendingTools([...updated]);
        break;
      }

      case 'status_change':
        setAgentStatus(msg.status);
        setAgentStatusDetail(msg.detail);
        break;

      case 'todo_updated':
        setTodos(msg.todos);
        break;

      case 'retry': {
        const reasonLabel = msg.reason === 'stream_idle_timeout' ? '模型首次响应超时' : '临时网络错误';
        const delaySeconds = Math.max(1, Math.round(msg.delayMs / 1000));
        toastRef.current.show({
          id: 'provider-retry',
          variant: 'warn',
          title: `${reasonLabel}，${delaySeconds}s 后重试 (${msg.attempt}/${msg.maxAttempts})`,
          message: msg.errorMessage || '准备重试…',
          durationMs: Math.max(4000, msg.delayMs + 2000),
        });
        break;
      }

      case 'done': {
        const assistantMsg: ChatMessage = msg.message ?? {
          id: genId(),
          role: 'assistant',
          content: streamingTextRef.current,
          timestamp: Date.now(),
          status: 'completed',
          delivery: 'turn',
          toolCalls: pendingToolsRef.current.length > 0 ? pendingToolsRef.current : undefined,
          thinking: thinkingTextRef.current || undefined,
          usage: msg.usage,
        };
        setMessages((prev) => {
          const next = prev.map((m) =>
            assistantMsg.requestId && m.role === 'user' && m.requestId === assistantMsg.requestId
              ? { ...m, status: 'completed' as const }
              : m,
          );
          return [...next, assistantMsg];
        });
        setStreamingText('');
        setThinkingText('');
        setPendingTools([]);
        setStreamingInferences([]);
        setIsLoading(false);
        setActiveSessionId(msg.sessionId);
        pendingToolsRef.current = [];
        thinkingTextRef.current = '';
        fetchAgentSessions(selectedAgentIdRef.current);
        fetchAgentContextSize(selectedAgentIdRef.current);
        break;
      }

      case 'api_response': {
        setStreamingInferences((prev) => [
          ...prev,
          {
            model: msg.model,
            inputTokens: msg.usage.inputTokens,
            outputTokens: msg.usage.outputTokens,
            cacheReadTokens: msg.usage.cacheReadTokens,
            cacheWriteTokens: msg.usage.cacheWriteTokens,
            stopReason: msg.stopReason,
            cost: msg.cost,
          },
        ]);
        // Update context bar with real full-input token count from API
        const fullInput = msg.usage.inputTokens + (msg.usage.cacheReadTokens ?? 0) + (msg.usage.cacheWriteTokens ?? 0);
        if (fullInput > 0) setContextTokensUsed(fullInput);
        break;
      }

      case 'compaction': {
        setContextWindow(msg.contextWindow);
        setContextTokensUsed(msg.contextAfter);
        const isHard = msg.triggerReason === 'threshold' || msg.triggerReason === 'overflow_retry';
        const label = isHard ? 'Context compressed' : 'Context optimized';
        toastRef.current.show({
          variant: 'info',
          title: label,
          message: `Freed ${msg.tokensFreed?.toLocaleString() ?? 0} tokens · ${msg.contextAfter?.toLocaleString() ?? 0}/${msg.contextWindow?.toLocaleString() ?? 0} used`,
          durationMs: 4000,
        });
        break;
      }

      case 'error':
        toastRef.current.show({
          variant: 'error',
          title: '推理失败',
          message: msg.message,
          durationMs: 8000,
        });
        setMessages((prev) => {
          const next = prev.map((m) =>
            msg.requestId && m.role === 'user' && m.requestId === msg.requestId
              ? { ...m, status: 'failed' as const }
              : m,
          );
          return [
            ...next,
            {
              id: genId(),
              role: 'assistant',
              content: `Error: ${msg.message}`,
              timestamp: Date.now(),
              status: 'failed',
              delivery: 'turn',
            },
          ];
        });
        if (msg.sessionId) setActiveSessionId(msg.sessionId);
        setStreamingText('');
        setThinkingText('');
        setPendingTools([]);
        setIsLoading(false);
        pendingToolsRef.current = [];
        thinkingTextRef.current = '';
        break;

      case 'session_cleared':
        setMessages([]);
        setActiveSessionId(undefined);
        break;

      case 'session_created':
        setActiveSessionId(msg.sessionId);
        setMessages(msg.messages ?? []);
        fetchAgentContextSize(selectedAgentIdRef.current);
        fetchAgentSessions(selectedAgentIdRef.current);
        break;

      case 'session_resumed':
        setActiveSessionId(msg.sessionId);
        setMessages(msg.messages ?? []);
        fetchAgentContextSize(selectedAgentIdRef.current);
        break;

      case 'session_compacted':
        toastRef.current.show({
          variant: 'info',
          title: 'Session compacted',
          message: `Freed ${msg.tokensFreed ?? 0} tokens.`,
          durationMs: 4000,
        });
        setMessages([]);
        fetchAgentSessions(selectedAgentIdRef.current);
        break;

      case 'agent_switched':
        fetchAgentContextSize(selectedAgentIdRef.current);
        break;

      case 'fact_changed': {
        factStore.apply(msg);
        if (msg.kind === 'agent' && msg.fact?.isActive) {
          void fetchAgentSessions(selectedAgentIdRef.current);
        }
        break;
      }

      case 'interject_acked':
        setMessages((prev) => [
          ...prev,
          {
            id: genId(),
            role: 'user',
            content: `⌁ interject (${msg.behavior ?? 'same_turn'}): ${msg.text}`,
            timestamp: Date.now(),
            status: msg.status ?? 'queued',
            delivery: msg.delivery ?? 'interject',
          },
        ]);
        break;
    }
  }, [fetchAgentSessions, fetchAgentContextSize]);

  const streamingTextRef = useRef('');
  useEffect(() => {
    streamingTextRef.current = streamingText;
  }, [streamingText]);

  const { send, connected } = useWebSocket(handleWsMessage);

  const handleSwitchAgent = useCallback(
    (agentId: string) => {
      if (agentId === selectedAgentId) return;
      setSelectedAgentId(agentId);
      setMessages([]);
      setActiveSessionId(undefined);
      setStreamingText('');
      setThinkingText('');
      setPendingTools([]);
      setStreamingInferences([]);
      pendingToolsRef.current = [];
      thinkingTextRef.current = '';
      send({ type: 'switch_agent', agentId });
      fetchAgentContextSize(agentId);
    },
    [selectedAgentId, send, fetchAgentContextSize],
  );

  const handleSend = useCallback(
    (prompt: string | ContentBlock[]) => {
      const isBlocks = typeof prompt !== 'string';
      const textPreview = isBlocks
        ? prompt.map((b) => b.type === 'text' ? b.text : `[${b.type}]`).join(' ').trim() || '(media)'
        : prompt;
      const blocks = isBlocks
        ? prompt.filter((b): b is { type: 'text'; text: string } | { type: 'image'; data: string; mediaType: string } =>
            b.type === 'text' || b.type === 'image',
          )
        : undefined;
      const requestId = `req_${genId()}`;
      setMessages((prev) => [
        ...prev,
        {
          id: genId(),
          role: 'user',
          content: textPreview,
          timestamp: Date.now(),
          status: 'pending',
          delivery: 'turn',
          requestId,
          blocks,
        },
      ]);
      send({ type: 'chat', prompt, sessionId: activeSessionId, requestId, agentId: selectedAgentIdRef.current });
    },
    [send, activeSessionId],
  );

  const handleInterject = useCallback(
    (text: string) => {
      if (!text.trim()) return;
      send({ type: 'interject', text });
    },
    [send],
  );

  const handleReasoningEffortChange = useCallback(
    async (effort: 'none' | 'low' | 'medium' | 'high' | 'max') => {
      const agentId = selectedAgentIdRef.current;
      if (!agentId) return;
      try {
        const res = await fetch(API.agent(agentId), {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ reasoningEffort: effort }),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
      } catch (err) {
        console.error('[reasoning] failed to update:', err);
      }
    },
    [],
  );

  const handleCompact = useCallback(() => {
    setContextTokensUsed(0);
    setContextWindow(200_000);
    send({ type: 'new_session', agentId: selectedAgentIdRef.current });
  }, [send]);

  const handleResumeSession = useCallback((sessionId: string) => {
    setContextTokensUsed(0);
    setContextWindow(200_000);
    send({ type: 'resume_session', sessionId, agentId: selectedAgentIdRef.current });
  }, [send]);

  useFactHydration();

  return (
    <div className="flex h-screen bg-[#0d0d0d] text-gray-200 overflow-hidden">
      <ToastContainer />

      {/* Left icon rail */}
      <div className="w-12 bg-[#111] border-r border-[#1f1f1f] flex flex-col items-center py-3 gap-1 flex-shrink-0">
        <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-berry-500 to-purple-600 flex items-center justify-center text-white font-bold text-xs mb-2">
          B
        </div>
        <NavIcon icon={<MessageSquare size={18} />} active={activeTab === 'chat'} onClick={() => setActiveTab('chat')} />
        <NavIcon icon={<Bot size={18} />} active={activeTab === 'agents'} onClick={() => setActiveTab('agents')} />
        <NavIcon icon={<Users size={18} />} active={activeTab === 'team'} onClick={() => setActiveTab('team')} />
        <NavIcon icon={<BarChart3 size={18} />} active={activeTab === 'observe'} onClick={() => setActiveTab('observe')} />
        <NavIcon icon={<Sparkles size={18} />} active={activeTab === 'skills'} onClick={() => setActiveTab('skills')} />
        <div className="flex-1" />
        <NavIcon icon={<Settings size={18} />} active={activeTab === 'settings'} onClick={() => setActiveTab('settings')} />
      </div>

      {/* Agent list + sessions panel */}
      {activeTab === 'chat' && (
        <>
          {/* Mobile overlay backdrop */}
          {mobileLeftOpen && (
            <div
              className="fixed inset-0 bg-black/50 z-20 md:hidden"
              onClick={() => setMobileLeftOpen(false)}
            />
          )}
          <div
            className={`bg-[#111] border-r border-[#1f1f1f] flex flex-col flex-shrink-0 z-30
              fixed inset-y-0 left-12 w-56 transform transition-transform duration-200 md:static md:translate-x-0
              ${mobileLeftOpen ? 'translate-x-0 pointer-events-auto' : '-translate-x-full pointer-events-none md:pointer-events-auto md:translate-x-0'}`}
            style={{ top: 0, bottom: 0 }}
          >
            {/* Agents section */}
            <div className="px-3 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider flex items-center gap-2">
              <Bot size={14} />
              Agents
            </div>
            <div className="px-2 space-y-1">
              {agentFacts.map((agent) => (
                <AgentListItem
                  key={agent.id}
                  agent={agent}
                  active={agent.id === selectedAgentId}
                  onClick={() => { handleSwitchAgent(agent.id); setMobileLeftOpen(false); }}
                />
              ))}
            </div>

            {/* Sessions section */}
            <div className="mt-2 border-t border-[#1f1f1f] flex-1 flex flex-col min-h-0">
              <div className="px-3 py-2 text-xs font-semibold text-gray-500 uppercase tracking-wider flex items-center gap-2">
                <MessageSquare size={14} />
                Sessions
              </div>
              <div className="flex-1 overflow-y-auto px-2 space-y-1">
                {sessions.length === 0 ? (
                  <div className="text-[10px] text-gray-600 px-2 py-1">No sessions</div>
                ) : (
                  sessions.map((session) => (
                    <button
                      key={session.id}
                      onClick={() => { handleResumeSession(session.id); setMobileLeftOpen(false); }}
                      className={`w-full text-left px-2 py-2 rounded-md transition-colors text-xs ${
                        session.id === activeSessionId
                          ? 'bg-[#1e1e2e] text-gray-200 border border-[#333]'
                          : 'text-gray-500 hover:bg-[#1a1a1a] hover:text-gray-300'
                      }`}
                      title={session.id}
                    >
                      <div className="truncate font-medium">
                        {session.title || session.id.slice(0, 12)}
                      </div>
                      <div className="text-[10px] text-gray-600 mt-0.5">
                        {session.updatedAt ? new Date(session.updatedAt).toLocaleString() : ''}
                      </div>
                    </button>
                  ))
                )}
              </div>
            </div>

            <div className="px-3 py-2 text-[10px] text-gray-600 border-t border-[#1f1f1f]">
              {agentFacts.length} agent{agentFacts.length !== 1 ? 's' : ''}
            </div>
          </div>
        </>
      )}

      {/* Main content */}
      <div className="flex-1 flex flex-col min-w-0">
        {!connected && (
          <div className="bg-amber-900/20 border-b border-amber-900/40 px-4 py-2 text-sm text-amber-400">
            Disconnected from server. Reconnecting...
          </div>
        )}

        {activeTab === 'chat' && (
          <ChatTab
            messages={messages}
            streamingText={streamingText}
            thinkingText={thinkingText}
            pendingTools={pendingTools}
            isLoading={isLoading}
            activeSessionId={activeSessionId}
            selectedAgent={selectedAgent}
            onSend={handleSend}
            onInterject={handleInterject}
            onCompact={handleCompact}
            streamingInferences={streamingInferences}
            contextTokensUsed={contextTokensUsed}
            contextWindow={contextWindow}
            onToggleLeftPanel={() => setMobileLeftOpen((o) => !o)}
            onReasoningEffortChange={handleReasoningEffortChange}
          />
        )}

        {activeTab === 'observe' && <ObserveDashboard />}
        {activeTab === 'agents' && <AgentsPage />}
        {activeTab === 'team' && <TeamsPage />}
        {activeTab === 'skills' && <SkillMarketPage />}
        {activeTab === 'settings' && <SettingsPage />}
      </div>

      {/* Right panel - Tasks (hidden on < lg) */}
      {activeTab === 'chat' && rightPanelOpen && (
        <div className="hidden lg:flex w-72 bg-[#111] border-l border-[#1f1f1f] flex-col flex-shrink-0">
          <div className="h-10 border-b border-[#1f1f1f] flex items-center px-3 justify-between">
            <span className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Tasks</span>
            <button onClick={() => setRightPanelOpen(false)} className="text-gray-500 hover:text-gray-300">
              <X size={14} />
            </button>
          </div>
          <div className="flex-1 overflow-y-auto p-3">
            {todos.length === 0 ? (
              <div className="text-center text-gray-600 text-sm mt-8">
                <div className="mb-2">No tasks yet</div>
                <div className="text-xs">The agent will create tasks as needed</div>
              </div>
            ) : (
              <div className="space-y-2">
                {todos.map((todo, i) => (
                  <div key={i} className="bg-[#1a1a1a] rounded-lg px-3 py-2 border border-[#2a2a2a]">
                    <div className="flex items-start gap-2">
                      {todo.status === 'completed' ? (
                        <CheckCircle size={14} className="text-green-400 mt-0.5 flex-shrink-0" />
                      ) : todo.status === 'in_progress' ? (
                        <Loader2 size={14} className="text-blue-400 mt-0.5 flex-shrink-0 animate-spin" />
                      ) : (
                        <div className="w-3.5 h-3.5 rounded border border-gray-600 mt-0.5 flex-shrink-0" />
                      )}
                      <span className={`text-sm ${todo.status === 'completed' ? 'text-gray-500 line-through' : 'text-gray-300'}`}>
                        {todo.content}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/* ================================================================
   ChatTab
   ================================================================ */

function ChatTab({
  messages,
  streamingText,
  thinkingText,
  pendingTools,
  isLoading,
  activeSessionId,
  selectedAgent,
  onSend,
  onInterject,
  onCompact,
  streamingInferences,
  contextTokensUsed,
  contextWindow,
  onToggleLeftPanel,
  onReasoningEffortChange,
}: {
  messages: ChatMessage[];
  streamingText: string;
  thinkingText: string;
  pendingTools: ToolCallInfo[];
  isLoading: boolean;
  activeSessionId?: string;
  selectedAgent?: AgentFact;
  onSend: (prompt: string | ContentBlock[]) => void;
  onInterject?: (text: string) => void;
  onCompact: () => void;
  streamingInferences: InferenceInfo[];
  contextTokensUsed: number;
  contextWindow: number;
  onToggleLeftPanel?: () => void;
  onReasoningEffortChange?: (effort: 'none' | 'low' | 'medium' | 'high' | 'max') => void;
}) {
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const [stickToBottom, setStickToBottom] = useState(true);

  const handleScroll = () => {
    const el = scrollContainerRef.current;
    if (!el) return;
    const threshold = 80;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight <= threshold;
    setStickToBottom(atBottom);
  };

  useEffect(() => {
    if (stickToBottom) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, streamingText, thinkingText, pendingTools, stickToBottom]);

  const hasStreamingContent = streamingText || thinkingText || pendingTools.length > 0;

  return (
    <>
      {/* Chat header */}
      <div className="h-12 border-b border-[#1f1f1f] flex items-center px-4 justify-between bg-[#0d0d0d] flex-shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          {onToggleLeftPanel && (
            <button
              onClick={onToggleLeftPanel}
              className="md:hidden relative z-40 w-8 h-8 rounded-lg flex items-center justify-center text-gray-400 hover:bg-[#1a1a1a] transition-colors"
            >
              <Menu size={18} />
            </button>
          )}
          <span className="text-lg">🤖</span>
          <span className="text-sm font-medium text-gray-200 truncate">
            {selectedAgent?.name ?? 'No Agent'}
          </span>
          <span className="text-xs text-gray-500 font-mono hidden sm:inline">
            {selectedAgent?.model?.split('/').pop()}
          </span>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          {activeSessionId && (
            <span className="text-[10px] text-gray-600 font-mono hidden md:inline">
              {activeSessionId.slice(0, 16)}…
            </span>
          )}
          <button
            onClick={onCompact}
            className="text-xs px-3 py-1.5 rounded-md bg-[#1a1a1a] text-gray-400 hover:text-gray-200 hover:bg-[#222] transition-colors border border-[#2a2a2a]"
          >
            Clear Chat
          </button>
        </div>
      </div>

      {/* Context progress bar */}
      <ContextProgressBar used={contextTokensUsed} window={contextWindow} />

      {/* Messages area */}
      <div
        ref={scrollContainerRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto px-4 py-4 relative"
      >
        {!stickToBottom && (messages.length > 0 || hasStreamingContent) && (
          <button
            onClick={() => {
              setStickToBottom(true);
              messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
            }}
            className="sticky bottom-2 left-1/2 -translate-x-1/2 z-10 px-3 py-1.5 rounded-full bg-[#1a1a1a]/90 text-gray-300 text-xs shadow-lg hover:bg-[#222] transition-colors border border-[#2a2a2a] flex items-center gap-1"
            style={{ float: 'none', margin: '0 auto', display: 'block' }}
          >
            ↓ Jump to latest
          </button>
        )}

        {messages.length === 0 && !hasStreamingContent && !isLoading ? (
          <EmptyState agent={selectedAgent} onSuggestion={onSend} />
        ) : (
          <div className="max-w-3xl mx-auto space-y-4">
            {messages.map((msg) => (
              <MessageRow key={msg.id} message={msg} />
            ))}

            {/* Streaming block */}
            {(isLoading || hasStreamingContent) && (
              <div className="flex justify-start">
                <div className="max-w-[80%]">
                  <div className="text-[10px] text-gray-600 mb-1 flex items-center gap-2">
                    <span>AI</span>
                    <span>{new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                  </div>

                  {/* Thinking */}
                  {thinkingText && <StreamingThinkingBlock text={thinkingText} />}

                  {/* Tool calls */}
                  {pendingTools.length > 0 && (
                    <div className="mb-2">
                      {pendingTools.map((tool, i) => (
                        <StreamingToolCard key={i} tool={tool} />
                      ))}
                    </div>
                  )}

                  {/* Streaming text */}
                  {streamingText ? (
                    <div className="bg-[#1a1a1a] border border-[#2a2a2a] rounded-2xl px-4 py-3">
                      <div className="text-sm text-gray-200 prose prose-sm max-w-none prose-pre:p-0 prose-pre:m-0 prose-pre:bg-transparent">
                        <ReactMarkdown
                          remarkPlugins={[remarkGfm]}
                          components={{
                            code({ className, children, ...props }) {
                              const match = /language-(\w+)/.exec(className || '');
                              const code = String(children).replace(/\n$/, '');
                              if (!match && !code.includes('\n')) {
                                return (
                                  <code className="bg-[#2a2a2a] text-berry-300 px-1.5 py-0.5 rounded text-xs font-mono" {...props}>
                                    {children}
                                  </code>
                                );
                              }
                              return <CodeBlock language={match?.[1] || ''} code={code} />;
                            },
                          }}
                        >
                          {streamingText}
                        </ReactMarkdown>
                        <span className="animate-pulse">▌</span>
                      </div>
                    </div>
                  ) : isLoading && pendingTools.length === 0 && !thinkingText ? (
                    <div className="bg-[#1a1a1a] border border-[#2a2a2a] rounded-2xl px-4 py-3">
                      <Loader2 size={16} className="animate-spin text-berry-500" />
                    </div>
                  ) : null}

                  {/* Real-time inference details */}
                  {streamingInferences.length > 0 && (
                    <InferenceDetails inferences={streamingInferences} />
                  )}
                </div>
              </div>
            )}

            <div ref={messagesEndRef} />
          </div>
        )}
      </div>

      {/* Input area */}
      <ChatInput
        onSend={onSend}
        onInterject={onInterject}
        isLoading={isLoading}
        agentName={selectedAgent?.name}
        contextWindow={contextWindow}
        reasoningEffort={selectedAgent?.reasoningEffort}
        onReasoningEffortChange={onReasoningEffortChange}
      />
    </>
  );
}

/* ================================================================
   Sub-components
   ================================================================ */

function NavIcon({ icon, active, onClick }: { icon: React.ReactNode; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`w-9 h-9 rounded-lg flex items-center justify-center transition-colors ${
        active ? 'bg-[#1e1e2e] text-white' : 'text-gray-500 hover:text-gray-300 hover:bg-[#1a1a1a]'
      }`}
    >
      {icon}
    </button>
  );
}

function AgentListItem({ agent, active, onClick }: { agent: AgentFact; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`w-full text-left px-3 py-2.5 rounded-lg transition-colors ${
        active ? 'bg-[#1e1e2e] border border-[#333]' : 'hover:bg-[#1a1a1a]'
      }`}
    >
      <div className="flex items-center gap-2">
        <div className={`w-2 h-2 rounded-full ${agent.status === 'idle' ? 'bg-green-500' : 'bg-blue-400 animate-pulse'}`} />
        <span className={`text-sm font-medium ${active ? 'text-white' : 'text-gray-400'}`}>{agent.name}</span>
      </div>
      <div className="text-[10px] text-gray-600 mt-0.5 ml-4">{agent.model?.split('/').pop()}</div>
    </button>
  );
}

function EmptyState({ agent, onSuggestion }: { agent?: AgentFact; onSuggestion: (s: string) => void }) {
  const suggestions = [
    'Summarize this project',
    'Find TODOs in the codebase',
    'Refactor a small feature',
    'Explain a concept',
  ];
  return (
    <div className="flex flex-col items-center justify-center h-full text-center">
      <div className="w-16 h-16 rounded-2xl bg-[#1a1a1a] border border-[#2a2a2a] flex items-center justify-center text-3xl mb-4">
        🤖
      </div>
      <h2 className="text-xl font-semibold text-gray-200 mb-1">{agent?.name ?? 'Agent'}</h2>
      <p className="text-sm text-gray-500 mb-6 max-w-sm">
        {agent?.systemPrompt ? agent.systemPrompt.slice(0, 100) + '...' : 'Your AI assistant. Ask anything.'}
      </p>
      <div className="flex flex-wrap justify-center gap-2 max-w-lg">
        {suggestions.map((s) => (
          <button
            key={s}
            onClick={() => onSuggestion(s)}
            className="px-4 py-2 rounded-full bg-[#1a1a1a] border border-[#2a2a2a] text-sm text-gray-400 hover:text-gray-200 hover:border-[#444] transition-colors"
          >
            {s}
          </button>
        ))}
      </div>
    </div>
  );
}

function MessageRow({ message }: { message: ChatMessage }) {
  const isUser = message.role === 'user';
  const isInterject = message.delivery === 'interject';

  if (isUser) {
    return (
      <div className="flex justify-end">
        <div className="max-w-[75%]">
          <div
            className={`rounded-2xl px-4 py-3 text-sm ${
              isInterject
                ? 'bg-amber-900/30 text-amber-200 border border-amber-900/50'
                : message.status === 'failed'
                  ? 'bg-red-900/40 text-red-200'
                  : 'bg-[#2563eb] text-white'
            }`}
          >
            <div className="space-y-2">
              {message.blocks && message.blocks.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {message.blocks.map((block, idx) => {
                    if (block.type === 'image') {
                      return (
                        <img
                          key={idx}
                          src={`data:${block.mediaType};base64,${block.data}`}
                          alt="attachment"
                          className="max-w-[200px] max-h-[200px] rounded-lg object-cover"
                        />
                      );
                    }
                    return null;
                  })}
                </div>
              )}
              {message.content !== '(image)' && (
                <p className="whitespace-pre-wrap">{message.content}</p>
              )}
            </div>
          </div>
          <div className="text-[10px] text-gray-600 mt-1 text-right">
            {message.status === 'pending' && 'sending'}
            {message.status === 'failed' && 'failed'}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex justify-start">
      <div className="max-w-[80%]">
        <div className="text-[10px] text-gray-600 mb-1 flex items-center gap-2">
          <span>AI</span>
          <span>{new Date(message.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
        </div>

        {/* Thinking */}
        {message.thinking && <CompletedThinkingBlock text={message.thinking} />}

        {/* Tool calls */}
        {message.toolCalls?.map((tool, i) => (
          <CompletedToolCard key={i} tool={tool} />
        ))}

        {message.content && (
          <div className="bg-[#1a1a1a] border border-[#2a2a2a] rounded-2xl px-4 py-3">
            <div className="text-sm text-gray-200 prose prose-sm max-w-none prose-pre:p-0 prose-pre:m-0 prose-pre:bg-transparent">
              <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                components={{
                  code({ className, children, ...props }) {
                    const match = /language-(\w+)/.exec(className || '');
                    const code = String(children).replace(/\n$/, '');
                    if (!match && !code.includes('\n')) {
                      return (
                        <code className="bg-[#2a2a2a] text-berry-300 px-1.5 py-0.5 rounded text-xs font-mono" {...props}>
                          {children}
                        </code>
                      );
                    }
                    return <CodeBlock language={match?.[1] || ''} code={code} />;
                  },
                }}
              >
                {message.content}
              </ReactMarkdown>
            </div>
          </div>
        )}

        {message.usage && (
          <div className="text-[10px] text-gray-600 mt-1">
            {message.usage.inputTokens}↓ {message.usage.outputTokens}↑
          </div>
        )}

        {message.inferences && message.inferences.length > 0 && (
          <InferenceDetails inferences={message.inferences} totalUsage={message.usage} />
        )}
      </div>
    </div>
  );
}

/* ---------- Thinking blocks ---------- */

function CompletedThinkingBlock({ text }: { text: string }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div className="mb-2 border border-[#2a2a2a] rounded-lg overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-2 px-3 py-1.5 bg-[#141414] hover:bg-[#1a1a1a] transition-colors text-left"
      >
        <Brain size={14} className="text-purple-400 flex-shrink-0" />
        <span className="text-xs text-purple-400 font-medium flex-1">Thought process</span>
        {expanded ? <ChevronDown size={14} className="text-gray-500 flex-shrink-0" /> : <ChevronRight size={14} className="text-gray-500 flex-shrink-0" />}
      </button>
      {expanded && (
        <div className="px-3 py-2 bg-[#0d0d0d] border-t border-[#1f1f1f] max-h-48 overflow-y-auto">
          <p className="text-xs text-gray-500 italic whitespace-pre-wrap">{text}</p>
        </div>
      )}
    </div>
  );
}

function StreamingThinkingBlock({ text }: { text: string }) {
  return (
    <div className="mb-2 border border-[#2a2a2a] rounded-lg overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-1.5 bg-[#141414]">
        <Brain size={14} className="text-purple-400 flex-shrink-0" />
        <span className="text-xs text-purple-400 font-medium flex-1">Thinking…</span>
        <Loader2 size={14} className="text-purple-400 animate-spin flex-shrink-0" />
      </div>
      <div className="px-3 py-2 bg-[#0d0d0d] border-t border-[#1f1f1f] max-h-48 overflow-y-auto">
        <p className="text-xs text-gray-500 italic whitespace-pre-wrap">{text}</p>
      </div>
    </div>
  );
}

/* ---------- Tool cards ---------- */

function CompletedToolCard({ tool }: { tool: ToolCallInfo }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div className="border border-[#2a2a2a] rounded-lg my-2 overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-2 px-3 py-2 bg-[#141414] hover:bg-[#1a1a1a] transition-colors text-left"
      >
        <Terminal size={14} className="text-gray-500 flex-shrink-0" />
        <span className="text-sm font-mono text-gray-300 flex-1 truncate">{tool.name}</span>
        {tool.isError !== undefined && (
          tool.isError
            ? <X size={14} className="text-red-400 flex-shrink-0" />
            : <CheckCircle size={14} className="text-green-400 flex-shrink-0" />
        )}
        {expanded ? <ChevronDown size={14} className="text-gray-500 flex-shrink-0" /> : <ChevronRight size={14} className="text-gray-500 flex-shrink-0" />}
      </button>
      {expanded && (
        <div className="px-3 py-2 bg-[#0d0d0d] border-t border-[#1f1f1f] space-y-2">
          <div>
            <div className="text-[10px] text-gray-600 uppercase tracking-wider mb-1">Input</div>
            <pre className="text-xs font-mono text-gray-500 whitespace-pre-wrap break-all max-h-40 overflow-y-auto">
              {typeof tool.input === 'string' ? tool.input : JSON.stringify(tool.input, null, 2)}
            </pre>
          </div>
          {tool.result !== undefined && (
            <div>
              <div className="text-[10px] text-gray-600 uppercase tracking-wider mb-1">Output</div>
              <pre className={`text-xs font-mono whitespace-pre-wrap break-all max-h-40 overflow-y-auto ${tool.isError ? 'text-red-400' : 'text-gray-400'}`}>
                {tool.result}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function StreamingToolCard({ tool }: { tool: ToolCallInfo }) {
  const [expanded, setExpanded] = useState(false);
  const isDone = tool.isError !== undefined;
  return (
    <div className="border border-[#2a2a2a] rounded-lg my-1.5 overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-2 px-3 py-2 bg-[#141414] hover:bg-[#1a1a1a] transition-colors text-left"
      >
        <Terminal size={14} className="text-gray-500 flex-shrink-0" />
        <span className="text-sm font-mono text-gray-300 flex-1 truncate">{tool.name}</span>
        {isDone ? (
          tool.isError
            ? <X size={14} className="text-red-400 flex-shrink-0" />
            : <CheckCircle size={14} className="text-green-400 flex-shrink-0" />
        ) : (
          <Loader2 size={14} className="animate-spin text-berry-500 flex-shrink-0" />
        )}
        {expanded ? <ChevronDown size={14} className="text-gray-500 flex-shrink-0" /> : <ChevronRight size={14} className="text-gray-500 flex-shrink-0" />}
      </button>
      {expanded && (
        <div className="px-3 py-2 bg-[#0d0d0d] border-t border-[#1f1f1f] space-y-2">
          <div>
            <div className="text-[10px] text-gray-600 uppercase tracking-wider mb-1">Input</div>
            <pre className="text-xs font-mono text-gray-500 whitespace-pre-wrap break-all max-h-40 overflow-y-auto">
              {typeof tool.input === 'string' ? tool.input : JSON.stringify(tool.input, null, 2)}
            </pre>
          </div>
          {tool.result !== undefined && (
            <div>
              <div className="text-[10px] text-gray-600 uppercase tracking-wider mb-1">Output</div>
              <pre className={`text-xs font-mono whitespace-pre-wrap break-all max-h-40 overflow-y-auto ${tool.isError ? 'text-red-400' : 'text-gray-400'}`}>
                {tool.result}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ---------- Inference details ---------- */

function InferenceDetails({ inferences, totalUsage }: { inferences: InferenceInfo[]; totalUsage?: { inputTokens: number; outputTokens: number } }) {
  const [expanded, setExpanded] = useState(false);
  const totalCost = inferences.reduce((sum, inf) => sum + (inf.cost ?? 0), 0);
  return (
    <div className="mt-1 ml-1">
      <button
        onClick={() => setExpanded(!expanded)}
        className="text-xs text-gray-600 hover:text-gray-400 flex items-center gap-1 transition-colors"
      >
        <span>{inferences.length} inference{inferences.length > 1 ? 's' : ''}</span>
        {totalCost > 0 && <span>· ${totalCost.toFixed(4)}</span>}
        {expanded ? <ChevronDown size={12} className="flex-shrink-0" /> : <ChevronRight size={12} className="flex-shrink-0" />}
      </button>
      {expanded && (
        <div className="mt-1 space-y-1">
          {inferences.map((inf, i) => (
            <div key={i} className="text-xs text-gray-500 font-mono">
              <span className="text-gray-400">{inf.model}</span>
              {' · '}
              {inf.inputTokens}↓ {inf.outputTokens}↑
              {inf.cacheReadTokens ? ` · cache ${inf.cacheReadTokens}R` : ''}
              {inf.cacheWriteTokens ? ` · cache ${inf.cacheWriteTokens}W` : ''}
              {inf.cost != null && ` · $${inf.cost.toFixed(5)}`}
            </div>
          ))}
          {totalUsage && (
            <div className="text-xs text-gray-400 font-medium border-t border-[#2a2a2a] pt-1 mt-1">
              Turn total: {totalUsage.inputTokens}↓ {totalUsage.outputTokens}↑
              {totalCost > 0 && ` · $${totalCost.toFixed(4)}`}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ---------- Context progress bar ---------- */

function ContextProgressBar({ used, window }: { used: number; window: number }) {
  const pct = Math.min(100, Math.max(0, (used / window) * 100));
  let color = 'bg-green-500';
  if (pct > 85) color = 'bg-red-500';
  else if (pct > 65) color = 'bg-amber-500';
  else if (pct > 40) color = 'bg-blue-500';

  return (
    <div className="h-7 bg-[#0d0d0d] border-b border-[#1f1f1f] flex items-center px-4 gap-3 flex-shrink-0">
      <div className="flex-1 h-1.5 bg-[#1a1a1a] rounded-full overflow-hidden">
        <div
          className={`h-full ${color} transition-all duration-500`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <div className="text-[10px] text-gray-500 font-mono whitespace-nowrap">
        {pct.toFixed(1)}% · {used.toLocaleString()}/{window.toLocaleString()}
      </div>
    </div>
  );
}

/* ---------- ChatInput with attachments ---------- */

interface ImageAttachment {
  id: string;
  name: string;
  mediaType: string;
  dataUrl: string;
  data: string;
  sizeBytes: number;
}

const MAX_IMAGE_BYTES = 4 * 1024 * 1024;
const ACCEPTED_IMAGE_MIME = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];

function ChatInput({
  onSend,
  onInterject,
  isLoading,
  agentName,
  contextWindow,
  reasoningEffort,
  onReasoningEffortChange,
}: {
  onSend: (s: string | ContentBlock[]) => void;
  onInterject?: (text: string) => void;
  isLoading: boolean;
  agentName?: string;
  contextWindow: number;
  reasoningEffort?: 'none' | 'low' | 'medium' | 'high' | 'max';
  onReasoningEffortChange?: (effort: 'none' | 'low' | 'medium' | 'high' | 'max') => void;
}) {
  const [input, setInput] = useState('');
  const [attachments, setAttachments] = useState<ImageAttachment[]>([]);
  const [reasonOpen, setReasonOpen] = useState(false);
  const reasonRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (reasonRef.current && !reasonRef.current.contains(e.target as Node)) {
        setReasonOpen(false);
      }
    }
    if (reasonOpen) document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [reasonOpen]);

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 200) + 'px';
  }, [input]);

  const ingestFile = useCallback(async (file: File): Promise<ImageAttachment | null> => {
    if (!ACCEPTED_IMAGE_MIME.includes(file.type)) {
      console.warn(`[chat] unsupported image type: ${file.type}`);
      return null;
    }
    if (file.size > MAX_IMAGE_BYTES) {
      console.warn(`[chat] image too large: ${file.size} > ${MAX_IMAGE_BYTES}`);
      return null;
    }
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(reader.error);
      reader.onload = () => resolve(String(reader.result));
      reader.readAsDataURL(file);
    });
    const comma = dataUrl.indexOf(',');
    const data = comma >= 0 ? dataUrl.slice(comma + 1) : '';
    return {
      id: `att_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      name: file.name || 'pasted-image',
      mediaType: file.type,
      dataUrl,
      data,
      sizeBytes: file.size,
    };
  }, []);

  const addFiles = useCallback(async (files: FileList | File[]) => {
    const incoming: ImageAttachment[] = [];
    for (const f of Array.from(files)) {
      const att = await ingestFile(f);
      if (att) incoming.push(att);
    }
    if (incoming.length > 0) setAttachments((prev) => [...prev, ...incoming]);
  }, [ingestFile]);

  const removeAttachment = (id: string) => {
    setAttachments((prev) => prev.filter((a) => a.id !== id));
  };

  const handleSubmit = () => {
    const text = input.trim();
    if ((!text && attachments.length === 0) || isLoading) return;
    if (attachments.length === 0) {
      onSend(text);
    } else {
      const blocks: ContentBlock[] = [];
      for (const a of attachments) {
        blocks.push({ type: 'image', data: a.data, mediaType: a.mediaType });
      }
      if (text) blocks.push({ type: 'text', text });
      onSend(blocks);
    }
    setInput('');
    setAttachments([]);
    if (textareaRef.current) textareaRef.current.style.height = 'auto';
  };

  const handlePaste = useCallback(async (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const files: File[] = [];
    for (const item of Array.from(e.clipboardData.items)) {
      if (item.kind === 'file' && item.type.startsWith('image/')) {
        const f = item.getAsFile();
        if (f) files.push(f);
      }
    }
    if (files.length === 0) return;
    e.preventDefault();
    await addFiles(files);
  }, [addFiles]);

  const handleDrop = useCallback(async (e: React.DragEvent<HTMLElement>) => {
    if (e.dataTransfer.files.length === 0) return;
    e.preventDefault();
    await addFiles(e.dataTransfer.files);
  }, [addFiles]);

  return (
    <div className="border-t border-[#1f1f1f] px-4 py-3 bg-[#0d0d0d] flex-shrink-0">
      <div className="max-w-3xl mx-auto">
        {/* Attachments preview */}
        {attachments.length > 0 && (
          <div className="mb-2 flex flex-wrap gap-2">
            {attachments.map((a) => (
              <div key={a.id} className="relative group">
                <img
                  src={a.dataUrl}
                  alt={a.name}
                  className="h-16 w-16 object-cover rounded-md border border-[#2a2a2a]"
                />
                <button
                  onClick={() => removeAttachment(a.id)}
                  className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-[#1a1a1a] border border-[#2a2a2a] text-gray-400 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                  title="Remove"
                >
                  <X size={11} />
                </button>
                <div className="absolute bottom-0 left-0 right-0 text-[9px] text-gray-400 bg-[#0d0d0d]/80 px-1 truncate rounded-b-md">
                  {Math.round(a.sizeBytes / 1024)}KB
                </div>
              </div>
            ))}
          </div>
        )}

        <div className="relative bg-[#1a1a1a] border border-[#2a2a2a] rounded-2xl px-4 py-3">
          <textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              // Ctrl/Cmd+Enter = send. Bare Enter = newline (textarea default).
              // While a turn is running, Ctrl+Enter routes to interject (instant
              // message) so the user never loses the ability to inject input
              // mid-turn.
              if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                e.preventDefault();
                if (!isLoading) {
                  handleSubmit();
                } else if (onInterject) {
                  const text = input.trim();
                  if (!text) return;
                  onInterject(text);
                  setInput('');
                  if (textareaRef.current) textareaRef.current.style.height = 'auto';
                }
              }
            }}
            onPaste={handlePaste}
            onDrop={handleDrop}
            onDragOver={(e) => e.preventDefault()}
            placeholder={`Ask ${agentName ?? 'agent'} anything... (Ctrl/⌘+Enter to send, Enter for new line)`}
            rows={1}
            className="w-full bg-transparent text-sm text-gray-200 placeholder:text-gray-600 resize-none outline-none min-h-[20px] max-h-[200px] pr-20"
          />
          <input
            ref={fileInputRef}
            type="file"
            accept={ACCEPTED_IMAGE_MIME.join(',')}
            multiple
            className="hidden"
            onChange={(e) => {
              if (e.target.files) void addFiles(e.target.files);
              e.target.value = '';
            }}
          />
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={isLoading}
            title="Attach image"
            className="absolute right-12 bottom-3 w-8 h-8 rounded-lg text-gray-500 hover:bg-[#222] disabled:text-gray-700 disabled:cursor-not-allowed flex items-center justify-center transition-colors"
          >
            <Paperclip size={16} />
          </button>
          <button
            onClick={handleSubmit}
            disabled={(!input.trim() && attachments.length === 0) || isLoading}
            title="Send (Ctrl/⌘+Enter)"
            className="absolute right-3 bottom-3 w-8 h-8 rounded-lg bg-[#2563eb] text-white flex items-center justify-center disabled:opacity-40 disabled:cursor-not-allowed hover:bg-blue-600 transition-colors"
          >
            {isLoading ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
          </button>
        </div>
        <div className="flex items-center justify-between mt-2 text-[10px] text-gray-600">
          <div className="flex items-center gap-3">
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={isLoading}
              className="flex items-center gap-1 hover:text-gray-400 transition-colors disabled:opacity-40"
            >
              <Paperclip size={12} />
              Attach
            </button>
            <div className="relative" ref={reasonRef}>
              <button
                onClick={() => setReasonOpen(!reasonOpen)}
                className={`flex items-center gap-1 transition-colors ${reasoningEffort && reasoningEffort !== 'none' ? 'text-purple-400 hover:text-purple-300' : 'hover:text-gray-400'}`}
              >
                <Brain size={12} />
                Reason{reasoningEffort && reasoningEffort !== 'none' ? `: ${reasoningEffort}` : ''}
              </button>
              {reasonOpen && onReasoningEffortChange && (
                <div className="absolute bottom-full left-0 mb-1 bg-[#1a1a1a] border border-[#2a2a2a] rounded-lg shadow-lg py-1 min-w-[120px] z-50">
                  {(['none', 'low', 'medium', 'high', 'max'] as const).map((effort) => (
                    <button
                      key={effort}
                      onClick={() => {
                        onReasoningEffortChange(effort);
                        setReasonOpen(false);
                      }}
                      className={`w-full text-left px-3 py-1.5 text-[11px] capitalize transition-colors ${
                        reasoningEffort === effort
                          ? 'text-purple-400 bg-[#222]'
                          : 'text-gray-400 hover:text-gray-200 hover:bg-[#222]'
                      }`}
                    >
                      {effort}
                    </button>
                  ))}
                </div>
              )}
            </div>
            {onInterject && (
              <button
                onClick={() => {
                  const text = input.trim();
                  if (!text) return;
                  onInterject(text);
                  setInput('');
                  if (textareaRef.current) textareaRef.current.style.height = 'auto';
                }}
                disabled={!input.trim()}
                className="flex items-center gap-1 hover:text-amber-400 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                title="Send as interject (same-turn injection)"
              >
                <Zap size={12} />
                Interject
              </button>
            )}
          </div>
          <div>
            {attachments.length > 0
              ? `${attachments.length} image${attachments.length > 1 ? 's' : ''} · `
              : ''}
            {Math.round((input.length / 1024) * 10) / 10}K / {Math.round(contextWindow / 1024)}K
          </div>
        </div>
      </div>
    </div>
  );
}

/* ---------- Utilities ---------- */

function genId(size = 12): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let id = '';
  const bytes = crypto.getRandomValues(new Uint8Array(size));
  for (const byte of bytes) id += chars[byte % chars.length];
  return id;
}
