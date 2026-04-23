import { useState, useCallback, useEffect, useRef } from 'react';
import Sidebar from './components/Sidebar';
import ChatArea from './components/ChatArea';
import TodoPanel from './components/TodoPanel';
import ObserveDashboard from './components/ObserveDashboard';
import SettingsPage from './components/SettingsPage';
import AgentsPage from './components/AgentsPage';
import TeamsPage from './components/TeamsPage';
import ToastContainer, { useToast } from './components/Toast';
import { useWebSocket } from './hooks/useWebSocket';
import type { AgentStatus, ChatMessage, ToolCallInfo, TodoItem, WsIncoming } from './types';
import { API } from './api/paths';

export default function App() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [streamingText, setStreamingText] = useState('');
  const [thinkingText, setThinkingText] = useState('');
  const [pendingTools, setPendingTools] = useState<ToolCallInfo[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [activeSessionId, setActiveSessionId] = useState<string>();
  const [activeTab, setActiveTab] = useState<'chat' | 'observe' | 'agents' | 'team' | 'settings'>('chat');
  const [agentStatus, setAgentStatus] = useState<AgentStatus>('idle');
  const [agentStatusDetail, setAgentStatusDetail] = useState<string | undefined>(undefined);
  const [todos, setTodos] = useState<TodoItem[]>([]);

  // Ref mirrors for use inside the 'done' closure
  const pendingToolsRef = useRef<ToolCallInfo[]>([]);
  const thinkingTextRef = useRef('');

  // Toast is read via a ref so handleWsMessage stays stable.
  const toast = useToast();
  const toastRef = useRef(toast);
  toastRef.current = toast;

  // Fetch active session on mount
  useEffect(() => {
    fetchActiveSession();
  }, []);

  // Cross-component tab switch: TeamsPage uses this to jump into Chat
  // after activating the leader agent. Using a window CustomEvent keeps
  // App's API surface small (no need to prop-drill setActiveTab).
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail === 'chat' || detail === 'observe' || detail === 'agents' || detail === 'team' || detail === 'settings') {
        setActiveTab(detail);
      }
    };
    window.addEventListener('berry:switch-tab', handler);
    return () => window.removeEventListener('berry:switch-tab', handler);
  }, []);

  const fetchActiveSession = async () => {
    try {
      const res = await fetch(API.sessions);
      const data = await res.json();
      const list = data.sessions || [];
      if (list.length > 0) {
        setActiveSessionId(list[0].id);
      }
    } catch {
      // Server not ready yet
    }
  };

  const handleWsMessage = useCallback((msg: WsIncoming) => {
    switch (msg.type) {
      case 'start':
        setIsLoading(true);
        setStreamingText('');
        setThinkingText('');
        setPendingTools([]);
        pendingToolsRef.current = [];
        thinkingTextRef.current = '';
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
        const updated = pendingToolsRef.current.map(t => {
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
        // Strong-supervision surface: SDK decided this inference failed fast and
        // will retry. Show a single upsertable toast so repeated retries stack
        // into one notification instead of a spammy column.
        const reasonLabel =
          msg.reason === 'stream_idle_timeout'
            ? '模型首次响应超时'
            : '临时网络错误';
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
          toolCalls: pendingToolsRef.current.length > 0 ? pendingToolsRef.current : undefined,
          thinking: thinkingTextRef.current || undefined,
          usage: msg.usage,
        };
        setMessages((prev) => [...prev, assistantMsg]);
        setStreamingText('');
        setThinkingText('');
        setPendingTools([]);
        setIsLoading(false);
        setActiveSessionId(msg.sessionId);
        pendingToolsRef.current = [];
        thinkingTextRef.current = '';
        fetchActiveSession();
        break;
      }

      case 'api_response':
        // Backend accumulates inference data into the final message; no-op here.
        break;

      case 'error':
        toastRef.current.show({
          variant: 'error',
          title: '推理失败',
          message: msg.message,
          durationMs: 8000,
        });
        setMessages((prev) => [
          ...prev,
          {
            id: genId(),
            role: 'assistant',
            content: `Error: ${msg.message}`,
            timestamp: Date.now(),
          },
        ]);
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

      case 'session_resumed':
        setActiveSessionId(msg.sessionId);
        if (msg.messages && msg.messages.length > 0) {
          setMessages(msg.messages);
        }
        break;

      case 'session_compacted':
        toastRef.current.show({
          variant: 'info',
          title: 'Session compacted',
          message: `Freed ${msg.tokensFreed ?? 0} tokens. Layers: ${(msg.layersApplied ?? []).join(', ') || 'none'}.`,
          durationMs: 4000,
        });
        setMessages([]);
        break;

      case 'config_changed': {
        // Notify all interested components that they should refresh their data.
        window.dispatchEvent(new CustomEvent('berry:config-changed', { detail: msg }));
        break;
      }

      case 'interject_acked':
        // Surface as a subtle system note in the chat log
        setMessages((prev) => [
          ...prev,
          {
            id: genId(),
            role: 'user',
            content: `⌁ interject: ${msg.text}`,
            timestamp: Date.now(),
          },
        ]);
        break;
    }
  }, []);

  // Keep ref of streaming text for use in 'done' handler
  const streamingTextRef = useRef('');
  useEffect(() => {
    streamingTextRef.current = streamingText;
  }, [streamingText]);

  const { send, connected } = useWebSocket(handleWsMessage);

  const handleSend = useCallback(
    (prompt: string) => {
      setMessages((prev) => [
        ...prev,
        {
          id: genId(),
          role: 'user',
          content: prompt,
          timestamp: Date.now(),
        },
      ]);
      send({ type: 'chat', prompt, sessionId: activeSessionId });
    },
    [send, activeSessionId],
  );

  const handleCompact = useCallback(() => {
    send({ type: 'new_session' });
  }, [send]);

  return (
    <div className="flex h-screen bg-white dark:bg-gray-900">
      <ToastContainer />
      {/* Sidebar */}
      <Sidebar
        activeTab={activeTab}
        onCompact={handleCompact}
        onTabChange={setActiveTab}
      />

      {/* Main area */}
      <div className="flex-1 flex flex-col min-w-0 pt-14 md:pt-0">
        {/* Connection status */}
        {!connected && (
          <div className="bg-amber-50 border-b border-amber-200 px-4 py-2 text-sm text-amber-700">
            ⚠️ Disconnected from server. Reconnecting...
          </div>
        )}

        {/* Agent status badge (hidden when idle) */}
        {activeTab === 'chat' && agentStatus !== 'idle' && (
          <AgentStatusBadge
            status={agentStatus}
            detail={agentStatusDetail}
            onInterject={(text) => send({ type: 'interject', text })}
          />
        )}

        {activeTab === 'chat' && <TodoPanel todos={todos} />}

        {activeTab === 'chat' && (
          <ChatArea
            messages={messages}
            streamingText={streamingText}
            thinkingText={thinkingText}
            pendingTools={pendingTools}
            isLoading={isLoading}
            onSend={handleSend}
          />
        )}

        {activeTab === 'observe' && <ObserveDashboard />}

        {activeTab === 'agents' && <AgentsPage />}

        {activeTab === 'team' && <TeamsPage />}

        {activeTab === 'settings' && <SettingsPage />}
      </div>
    </div>
  );
}

// ============================================================
// AgentStatusBadge — strip between connection bar and chat area
// ============================================================
function AgentStatusBadge({
  status,
  detail,
  onInterject,
}: {
  status: AgentStatus;
  detail?: string;
  onInterject: (text: string) => void;
}) {
  const config: Record<AgentStatus, { label: string; emoji: string; cls: string }> = {
    idle:            { label: 'Idle',              emoji: '🟢', cls: 'bg-gray-50 text-gray-600 border-gray-200 dark:bg-gray-800 dark:text-gray-400 dark:border-gray-700' },
    thinking:        { label: 'Thinking',          emoji: '💡', cls: 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-900/20 dark:text-amber-300 dark:border-amber-800' },
    tool_executing:  { label: 'Running tool',      emoji: '🔨', cls: 'bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-900/20 dark:text-blue-300 dark:border-blue-800' },
    compacting:      { label: 'Compacting context', emoji: '📚', cls: 'bg-purple-50 text-purple-700 border-purple-200 dark:bg-purple-900/20 dark:text-purple-300 dark:border-purple-800' },
    memory_flushing: { label: 'Flushing memory',   emoji: '🧠', cls: 'bg-pink-50 text-pink-700 border-pink-200 dark:bg-pink-900/20 dark:text-pink-300 dark:border-pink-800' },
    delegating:      { label: 'Delegating',        emoji: '👥', cls: 'bg-indigo-50 text-indigo-700 border-indigo-200 dark:bg-indigo-900/20 dark:text-indigo-300 dark:border-indigo-800' },
    sleeping:        { label: 'Sleeping',          emoji: '💤', cls: 'bg-cyan-50 text-cyan-700 border-cyan-200 dark:bg-cyan-900/20 dark:text-cyan-300 dark:border-cyan-800' },
    error:           { label: 'Error',             emoji: '❌', cls: 'bg-red-50 text-red-700 border-red-200 dark:bg-red-900/20 dark:text-red-300 dark:border-red-800' },
  };
  const c = config[status];
  const canInterject = status === 'sleeping' || status === 'thinking' || status === 'tool_executing';

  return (
    <div className={`border-b px-4 py-1.5 text-xs flex items-center gap-2 ${c.cls}`}>
      <span className="animate-pulse">{c.emoji}</span>
      <span className="font-medium">{c.label}</span>
      {detail && <span className="opacity-70 font-mono truncate">— {detail}</span>}
      {canInterject && (
        <button
          onClick={() => {
            const text = prompt('Interject message (seen on next LLM call, same turn):');
            if (text && text.trim()) onInterject(text.trim());
          }}
          className="ml-auto px-2 py-0.5 rounded bg-white/40 dark:bg-black/20 hover:bg-white/70 dark:hover:bg-black/40 transition-colors"
          title="Send an interject message (immediate, no new turn)"
        >
          Interject
        </button>
      )}
    </div>
  );
}

function genId(size = 12): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let id = '';
  const bytes = crypto.getRandomValues(new Uint8Array(size));
  for (const byte of bytes) id += chars[byte % chars.length];
  return id;
}
