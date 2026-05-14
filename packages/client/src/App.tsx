import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Bot,
  Brain,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  FileText,
  FolderKanban,
  Inbox,
  Loader2,
  MessageSquare,
  Paperclip,
  Plug,
  RotateCcw,
  Send,
  Server,
  Settings,
  ShieldCheck,
  Sparkles,
  Search,
  Users,
  X,
  Zap,
} from 'lucide-react';
import { useWebSocket } from './hooks/useWebSocket';
import { InstancePicker } from './components/InstancePicker';
import ToastContainer, { useToast } from './components/Toast';
import MessageBubble, { TimelineItemList } from './components/MessageBubble';
import type {
  AgentStatus,
  ChatMessage,
  ChatStep,
  ChatTimelineEvent,
  ChatTimelineItem,
  ContentBlock,
  InferenceInfo,
  SafetyLevel,
  TeamFact,
  TodoItem,
  ToolCallInfo,
  WsIncoming,
} from '@berry-agent/claw-contracts';
import { API, apiFetch } from './api/paths';
import { useActiveInstance } from './connection';
import { factStore } from './facts/store';
import { useAgentFacts, useFactHydration, useTeamFacts } from './facts/useFacts';
import type { AgentFact } from '@berry-agent/claw-contracts';
import SettingsPage from './components/SettingsPage';
import AgentsPage from './components/AgentsPage';
import { SafetyAskDialog, type PendingSafetyAsk } from './components/SafetyAskDialog';
import TeamsPage from './components/TeamsPage';
import SkillMarketPage from './components/SkillMarketPage';
import McpPage from './components/McpPage';
import AuditPage from './components/AuditPage';

type ClientView = 'inbox' | 'projects' | 'team' | 'agents' | 'audit' | 'settings' | 'skills' | 'mcp';
type ReasoningEffort = 'none' | 'low' | 'medium' | 'high' | 'max' | 'xhigh';

type StreamingTimelineItem =
  | { type: 'event'; event: ChatTimelineEvent }
  | { type: 'step'; stepId: string };

interface SessionListItem {
  id: string;
  title?: string;
  updatedAt?: number;
  messageCount?: number;
}

export default function App() {
  const [activeView, setActiveView] = useState<ClientView>('inbox');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [streamingText, setStreamingText] = useState('');
  const [thinkingText, setThinkingText] = useState('');
  const [pendingTools, setPendingTools] = useState<ToolCallInfo[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [activeSessionId, setActiveSessionId] = useState<string>();
  const [contextTokensUsed, setContextTokensUsed] = useState(0);
  const [contextWindow, setContextWindow] = useState(200_000);
  const [sessions, setSessions] = useState<SessionListItem[]>([]);
  const [creatingSession, setCreatingSession] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [todosBySession, setTodosBySession] = useState<Record<string, TodoItem[]>>({});

  const [pendingSafetyAsks, setPendingSafetyAsks] = useState<PendingSafetyAsk[]>([]);
  const [streamingInferences, setStreamingInferences] = useState<InferenceInfo[]>([]);
  const [streamingSteps, setStreamingSteps] = useState<ChatStep[]>([]);
  const [streamingEvents, setStreamingEvents] = useState<ChatTimelineEvent[]>([]);
  const [streamingTimeline, setStreamingTimeline] = useState<StreamingTimelineItem[]>([]);
  const stepsRef = useRef<ChatStep[]>([]);
  const currentStepRef = useRef<ChatStep | null>(null);
  const pendingToolsRef = useRef<ToolCallInfo[]>([]);
  const streamingEventsRef = useRef<ChatTimelineEvent[]>([]);
  const streamingTimelineRef = useRef<StreamingTimelineItem[]>([]);
  const thinkingTextRef = useRef('');
  const streamingTextRef = useRef('');

  const activeInstance = useActiveInstance();
  const agentFacts = useAgentFacts();
  const teamFacts = useTeamFacts();
  const activeAgent = agentFacts.find((a) => a.isActive) ?? agentFacts[0];
  const [selectedAgentId, setSelectedAgentId] = useState<string | undefined>(activeAgent?.id);
  const [modelOptions, setModelOptions] = useState<string[]>([]);
  const selectedAgentIdRef = useRef<string | undefined>(selectedAgentId);
  selectedAgentIdRef.current = selectedAgentId;
  const selectedAgent = agentFacts.find((a) => a.id === selectedAgentId) ?? activeAgent;

  const toast = useToast();
  const toastRef = useRef(toast);
  toastRef.current = toast;

  useFactHydration();

  useEffect(() => {
    let cancelled = false;
    async function fetchModelOptions() {
      try {
        const res = await apiFetch(API.models);
        if (!res.ok) return;
        const data = await res.json();
        const models = Array.isArray(data.models)
          ? data.models.map((m: any) => String(m.model ?? '')).filter(Boolean)
          : [];
        const current = typeof data.current === 'string' ? data.current : undefined;
        if (!cancelled) setModelOptions(uniqueStrings([current, ...models]));
      } catch {
        if (!cancelled) setModelOptions([]);
      }
    }
    void fetchModelOptions();
    return () => {
      cancelled = true;
    };
  }, [activeInstance?.name]);

  useEffect(() => {
    streamingTextRef.current = streamingText;
  }, [streamingText]);

  useEffect(() => {
    if (!agentFacts.length) {
      if (selectedAgentId) setSelectedAgentId(undefined);
      return;
    }
    if (!selectedAgentId || !agentFacts.some((a) => a.id === selectedAgentId)) {
      setSelectedAgentId(activeAgent?.id ?? agentFacts[0]?.id);
    }
  }, [activeAgent?.id, agentFacts, selectedAgentId]);

  const ensureCurrentStep = useCallback((): ChatStep => {
    if (!currentStepRef.current) {
      const step: ChatStep = {
        id: `step-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        toolCalls: [],
        status: 'streaming',
      };
      currentStepRef.current = step;
      streamingTimelineRef.current = [...streamingTimelineRef.current, { type: 'step', stepId: step.id }];
      setStreamingTimeline(streamingTimelineRef.current);
    }
    return currentStepRef.current;
  }, []);

  const publishSteps = useCallback(() => {
    setStreamingSteps(
      currentStepRef.current
        ? [...stepsRef.current, currentStepRef.current]
        : [...stepsRef.current],
    );
  }, []);

  const resetStepAccumulators = useCallback(() => {
    stepsRef.current = [];
    currentStepRef.current = null;
    setStreamingSteps([]);
  }, []);

  const resetEventAccumulators = useCallback(() => {
    streamingEventsRef.current = [];
    setStreamingEvents([]);
  }, []);

  const resetStreamingTimeline = useCallback(() => {
    streamingTimelineRef.current = [];
    setStreamingTimeline([]);
  }, []);

  const appendStreamingEvent = useCallback((event: ChatTimelineEvent) => {
    streamingEventsRef.current = [...streamingEventsRef.current, event];
    setStreamingEvents(streamingEventsRef.current);
    streamingTimelineRef.current = [...streamingTimelineRef.current, { type: 'event', event }];
    setStreamingTimeline(streamingTimelineRef.current);
  }, []);

  const fetchAgentSessions = useCallback(async (agentId?: string, preferredSessionId?: string) => {
    if (!agentId) return;
    try {
      const res = await apiFetch(`${API.sessions}?agentId=${encodeURIComponent(agentId)}`);
      if (!res.ok) return;
      const data = await res.json();
      const list = Array.isArray(data.sessions) ? data.sessions : [];
      const next = list.map((s: any) => ({
        id: s.id,
        title: s.title,
        updatedAt: s.lastActiveAt ?? s.createdAt,
        messageCount: Array.isArray(s.messages) ? s.messages.length : undefined,
      }));
      setSessions(next);
      if (list.length === 0) {
        setActiveSessionId(undefined);
        setMessages([]);
        return;
      }
      const targetSessionId = preferredSessionId ?? activeSessionId;
      const stillActive = targetSessionId && list.some((s: any) => s.id === targetSessionId);
      const session = stillActive ? list.find((s: any) => s.id === targetSessionId) : list[0];
      setActiveSessionId(session.id);
      setMessages(Array.isArray(session.messages) ? session.messages : []);
    } catch {
      // The connection gate and toast layer surface auth / network failures.
    }
  }, [activeSessionId]);

  const fetchAgentContextSize = useCallback(async (agentId?: string, sessionId?: string) => {
    if (!agentId) return;
    try {
      const res = await apiFetch(API.agentContextSize(agentId, sessionId));
      if (!res.ok) return;
      const data = await res.json();
      if (typeof data.current === 'number' && typeof data.window === 'number') {
        setContextTokensUsed(data.current);
        setContextWindow(data.window);
      }
    } catch {
      // Best-effort dashboard data.
    }
  }, []);

  const fetchSessionTodos = useCallback(async (sessionId?: string, agentId?: string) => {
    if (!sessionId) return;
    try {
      const res = await apiFetch(API.sessionTodos(sessionId, agentId));
      if (!res.ok) return;
      const data = await res.json();
      setTodosBySession((prev) => ({
        ...prev,
        [sessionId]: Array.isArray(data.todos) ? data.todos : [],
      }));
    } catch {
      // Best-effort side panel data.
    }
  }, []);

  useEffect(() => {
    void fetchAgentSessions(selectedAgent?.id);
  }, [selectedAgent?.id, fetchAgentSessions]);

  useEffect(() => {
    void fetchAgentContextSize(selectedAgent?.id, activeSessionId);
  }, [selectedAgent?.id, activeSessionId, fetchAgentContextSize]);

  useEffect(() => {
    void fetchSessionTodos(activeSessionId, selectedAgent?.id);
  }, [activeSessionId, selectedAgent?.id, fetchSessionTodos]);

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
        resetStepAccumulators();
        resetEventAccumulators();
        resetStreamingTimeline();
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

      case 'text_delta': {
        setStreamingText((prev) => prev + msg.text);
        const step = ensureCurrentStep();
        step.text = (step.text ?? '') + msg.text;
        publishSteps();
        break;
      }

      case 'thinking_delta': {
        thinkingTextRef.current += msg.thinking;
        setThinkingText(thinkingTextRef.current);
        const step = ensureCurrentStep();
        step.thinking = (step.thinking ?? '') + msg.thinking;
        publishSteps();
        break;
      }

      case 'tool_call': {
        const nextTool: ToolCallInfo = {
          name: msg.name,
          input: msg.input,
          toolUseId: msg.toolUseId,
        };
        pendingToolsRef.current = [...pendingToolsRef.current, nextTool];
        setPendingTools([...pendingToolsRef.current]);
        const step = ensureCurrentStep();
        step.toolCalls = [...step.toolCalls, nextTool];
        publishSteps();
        break;
      }

      case 'tool_result': {
        const matches = (t: ToolCallInfo): boolean =>
          (msg.toolUseId && t.toolUseId === msg.toolUseId) ||
          (!msg.toolUseId && t.name === msg.name && t.isError === undefined);
        const fillTool = (t: ToolCallInfo): ToolCallInfo =>
          matches(t) ? { ...t, isError: msg.isError, result: msg.output } : t;

        pendingToolsRef.current = pendingToolsRef.current.map(fillTool);
        setPendingTools([...pendingToolsRef.current]);
        stepsRef.current = stepsRef.current.map((s) => ({ ...s, toolCalls: s.toolCalls.map(fillTool) }));
        if (currentStepRef.current) {
          currentStepRef.current = {
            ...currentStepRef.current,
            toolCalls: currentStepRef.current.toolCalls.map(fillTool),
          };
        }
        publishSteps();
        break;
      }

      case 'status_change':
        break;

      case 'todo_updated':
        setTodosBySession((prev) => ({
          ...prev,
          [msg.sessionId]: msg.todos,
        }));
        break;

      case 'retry': {
        const reasonLabel = msg.reason === 'stream_idle_timeout' ? '模型首次响应超时' : '临时网络错误';
        const delaySeconds = Math.max(1, Math.round(msg.delayMs / 1000));
        toastRef.current.show({
          id: 'provider-retry',
          variant: 'warn',
          title: `${reasonLabel}, ${delaySeconds}s 后重试 (${msg.attempt}/${msg.maxAttempts})`,
          message: msg.errorMessage || '准备重试...',
          durationMs: Math.max(4000, msg.delayMs + 2000),
        });
        break;
      }

      case 'api_response': {
        const inference: InferenceInfo = {
          model: msg.model,
          inputTokens: msg.usage.inputTokens,
          outputTokens: msg.usage.outputTokens,
          cacheReadTokens: msg.usage.cacheReadTokens,
          cacheWriteTokens: msg.usage.cacheWriteTokens,
          stopReason: msg.stopReason,
          cost: msg.cost,
        };
        setStreamingInferences((prev) => [...prev, inference]);
        if (currentStepRef.current) {
          const step = currentStepRef.current;
          stepsRef.current = [
            ...stepsRef.current,
            { ...step, inference, status: 'completed' as const },
          ];
          currentStepRef.current = null;
          publishSteps();
        }
        if (typeof msg.contextTokens === 'number' && msg.contextTokens > 0) {
          setContextTokensUsed(msg.contextTokens);
        }
        break;
      }

      case 'timeline_event':
        appendStreamingEvent(msg.event);
        break;

      case 'done': {
        const collectedSteps: ChatStep[] = currentStepRef.current
          ? [...stepsRef.current, { ...currentStepRef.current, status: 'completed' as const }]
          : [...stepsRef.current];
        const hydratedSteps = mergeFinalToolResults(collectedSteps, msg.message.toolCalls);
        const collectedEvents = streamingEventsRef.current;
        const timeline = buildFinalTimeline(streamingTimelineRef.current, hydratedSteps);
        const assistantMsg: ChatMessage = timeline.length > 0
          ? { ...msg.message, steps: hydratedSteps, events: collectedEvents, timeline }
          : collectedSteps.length > 0
            ? { ...msg.message, steps: hydratedSteps, events: collectedEvents }
            : { ...msg.message, events: collectedEvents };

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
        setCreatingSession(false);
        setActiveSessionId(msg.sessionId);
        pendingToolsRef.current = [];
        thinkingTextRef.current = '';
        resetStepAccumulators();
        resetEventAccumulators();
        resetStreamingTimeline();
        void fetchAgentSessions(selectedAgentIdRef.current, msg.sessionId);
        void fetchAgentContextSize(selectedAgentIdRef.current, msg.sessionId);
        break;
      }

      case 'compaction': {
        setContextWindow(msg.contextWindow);
        setContextTokensUsed(msg.contextAfter);
        toastRef.current.show({
          variant: 'info',
          title: msg.triggerReason === 'soft_threshold' ? 'Context optimized' : 'Context compressed',
          message: `Freed ${msg.tokensFreed?.toLocaleString() ?? 0} tokens`,
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
        setCreatingSession(false);
        pendingToolsRef.current = [];
        thinkingTextRef.current = '';
        resetStepAccumulators();
        resetEventAccumulators();
        resetStreamingTimeline();
        break;

      case 'session_cleared':
        setMessages([]);
        setActiveSessionId(undefined);
        setCreatingSession(false);
        break;

      case 'session_created':
        setActiveSessionId(msg.sessionId);
        setMessages(msg.messages ?? []);
        setCreatingSession(false);
        void fetchAgentContextSize(selectedAgentIdRef.current, msg.sessionId);
        void fetchAgentSessions(selectedAgentIdRef.current, msg.sessionId);
        break;

      case 'session_resumed':
        setActiveSessionId(msg.sessionId);
        setMessages(msg.messages ?? []);
        setCreatingSession(false);
        void fetchAgentContextSize(selectedAgentIdRef.current);
        break;

      case 'session_compacted':
        toastRef.current.show({
          variant: 'info',
          title: 'Session compacted',
          message: `Freed ${msg.tokensFreed ?? 0} tokens.`,
          durationMs: 4000,
        });
        setMessages([]);
        void fetchAgentSessions(selectedAgentIdRef.current);
        break;

      case 'agent_switched':
        void fetchAgentContextSize(msg.agentId);
        break;

      case 'fact_changed':
        factStore.apply(msg);
        break;

      case 'interject_acked':
        setMessages((prev) => [
          ...prev,
          {
            id: genId(),
            role: 'user',
            content: `interject (${msg.behavior ?? 'same_turn'}): ${msg.text}`,
            timestamp: Date.now(),
            status: msg.status ?? 'queued',
            delivery: msg.delivery ?? 'interject',
          },
        ]);
        break;

      case 'safety_ask':
        setPendingSafetyAsks((prev) => [...prev, { id: msg.id, question: msg.question }]);
        break;

      case 'safety_ask_resolved':
        setPendingSafetyAsks((prev) => prev.filter((a) => a.id !== msg.id));
        break;

      case 'api_call':
        break;
      case 'model_switched':
        appendStreamingEvent({
          id: genId(),
          kind: 'model',
          title: `模型已切换：${msg.model}`,
          timestamp: Date.now(),
          tone: 'info',
          collapsed: true,
        });
        break;
    }
  }, [appendStreamingEvent, ensureCurrentStep, fetchAgentContextSize, fetchAgentSessions, publishSteps, resetEventAccumulators, resetStepAccumulators, resetStreamingTimeline]);

  const { send, connected } = useWebSocket(handleWsMessage);

  const handleSwitchAgent = useCallback((agentId: string) => {
    if (agentId === selectedAgentIdRef.current) return;
    setSelectedAgentId(agentId);
    setMessages([]);
    setActiveSessionId(undefined);
    setStreamingText('');
    setThinkingText('');
    setPendingTools([]);
    setCreatingSession(false);
    setStreamingInferences([]);
    pendingToolsRef.current = [];
    thinkingTextRef.current = '';
    resetStepAccumulators();
    resetEventAccumulators();
    resetStreamingTimeline();
    send({ type: 'switch_agent', agentId });
    void fetchAgentContextSize(agentId);
  }, [fetchAgentContextSize, resetEventAccumulators, resetStepAccumulators, resetStreamingTimeline, send]);

  useEffect(() => {
    const handleSwitchTab = (event: Event) => {
      const detail = (event as CustomEvent<string>).detail;
      const next = detail === 'chat' ? 'inbox' : detail;
      if (next && ['inbox', 'projects', 'team', 'agents', 'audit', 'settings', 'skills', 'mcp'].includes(next)) {
        setActiveView(next as ClientView);
      }
    };
    const handleSelectAgent = (event: Event) => {
      const agentId = (event as CustomEvent<string>).detail;
      if (agentId) handleSwitchAgent(agentId);
    };
    window.addEventListener('berry:switch-tab', handleSwitchTab);
    window.addEventListener('berry:select-agent', handleSelectAgent);
    return () => {
      window.removeEventListener('berry:switch-tab', handleSwitchTab);
      window.removeEventListener('berry:select-agent', handleSelectAgent);
    };
  }, [handleSwitchAgent]);

  const handleSend = useCallback((prompt: string | ContentBlock[]) => {
    const isBlocks = typeof prompt !== 'string';
    const textPreview = isBlocks
      ? prompt.map((b) => (b.type === 'text' ? b.text : `[${b.type}]`)).join(' ').trim() || '(media)'
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
  }, [activeSessionId, send]);

  const handleInterject = useCallback((text: string) => {
    if (!text.trim()) return;
    send({ type: 'interject', text });
  }, [send]);

  const handleReasoningEffortChange = useCallback(async (effort: ReasoningEffort) => {
    const agentId = selectedAgentIdRef.current;
    if (!agentId) return;
    try {
      const res = await apiFetch(API.agent(agentId), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reasoningEffort: effort }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
    } catch (err) {
      console.error('[reasoning] failed to update:', err);
    }
  }, []);

  const handleModelChange = useCallback(async (model: string) => {
    const nextModel = model.trim();
    if (!nextModel) return;
    try {
      const res = await apiFetch(API.modelsSwitch, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: nextModel }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setModelOptions((prev) => uniqueStrings([nextModel, ...prev]));
      toastRef.current.show({
        variant: 'info',
        title: '模型已切换',
        message: nextModel,
        durationMs: 2500,
      });
    } catch (err) {
      toastRef.current.show({
        variant: 'error',
        title: '模型切换失败',
        message: err instanceof Error ? err.message : String(err),
        durationMs: 5000,
      });
    }
  }, []);

  const handleNewSession = useCallback(() => {
    if (isLoading || creatingSession) return;
    setCreatingSession(true);
    setContextTokensUsed(0);
    setContextWindow(200_000);
    send({ type: 'new_session', agentId: selectedAgentIdRef.current });
  }, [creatingSession, isLoading, send]);

  const handleResumeSession = useCallback((sessionId: string) => {
    setContextTokensUsed(0);
    setContextWindow(200_000);
    send({ type: 'resume_session', sessionId, agentId: selectedAgentIdRef.current });
  }, [send]);

  const projectSummaries = useProjectSummaries(agentFacts, teamFacts);

  return (
    <div className="h-screen bg-[#0b0c0d] text-zinc-200 overflow-hidden">
      <ToastContainer />
      <SafetyAskDialog
        ask={pendingSafetyAsks[0] ?? null}
        onResolved={(id) => setPendingSafetyAsks((prev) => prev.filter((a) => a.id !== id))}
      />

      <div
        className={`grid h-full min-h-0 overflow-hidden max-md:grid-cols-1 ${
          sidebarCollapsed
            ? 'grid-cols-[68px_minmax(0,1fr)]'
            : 'grid-cols-[280px_minmax(0,1fr)] max-xl:grid-cols-[260px_minmax(0,1fr)]'
        }`}
      >
        <ClientSidebar
          activeView={activeView}
          onViewChange={setActiveView}
          activeInstanceName={activeInstance?.name}
          connected={connected}
          selectedAgent={selectedAgent}
          agentCount={agentFacts.length}
          projectCount={projectSummaries.length}
          collapsed={sidebarCollapsed}
          onToggleCollapsed={() => setSidebarCollapsed((value) => !value)}
        />

        <main className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden border-x border-white/[0.07] bg-[#0e0f11] max-md:border-x-0">
          <MobileTopNav
            activeView={activeView}
            onViewChange={setActiveView}
            activeInstanceName={activeInstance?.name}
            connected={connected}
          />

          {!connected && (
            <div className="border-b border-amber-500/20 bg-amber-500/10 px-4 py-2 text-xs text-amber-200">
              后端实例未连接，正在重连。
            </div>
          )}

          {activeView === 'inbox' && (
            <InboxView
              messages={messages}
              streamingSteps={streamingSteps}
              streamingEvents={streamingEvents}
              streamingTimeline={streamingTimeline}
              isLoading={isLoading}
              selectedAgent={selectedAgent}
              agents={agentFacts}
              activeSessionId={activeSessionId}
              contextTokensUsed={contextTokensUsed}
              contextWindow={contextWindow}
              streamingInferences={streamingInferences}
              sessions={sessions}
              todos={activeSessionId ? todosBySession[activeSessionId] ?? [] : []}
              newSessionDisabled={isLoading || creatingSession}
              onSend={handleSend}
              onInterject={handleInterject}
              onNewSession={handleNewSession}
              onResumeSession={handleResumeSession}
              onSwitchAgent={handleSwitchAgent}
              onReasoningEffortChange={handleReasoningEffortChange}
              modelOptions={modelOptions}
              onModelChange={handleModelChange}
            />
          )}

          {activeView === 'projects' && (
            <ProjectsPage
              projects={projectSummaries}
              selectedAgentId={selectedAgent?.id}
              onOpenAgent={(agentId) => {
                handleSwitchAgent(agentId);
                setActiveView('inbox');
              }}
            />
          )}

          {activeView === 'team' && <TeamsPage />}
          {activeView === 'agents' && <AgentsPage />}
          {activeView === 'audit' && <AuditPage />}
          {activeView === 'settings' && <SettingsPage />}
          {activeView === 'skills' && <SkillMarketPage />}
          {activeView === 'mcp' && <McpPage />}
        </main>
      </div>
    </div>
  );
}

function MobileTopNav({
  activeView,
  onViewChange,
  activeInstanceName,
  connected,
}: {
  activeView: ClientView;
  onViewChange: (view: ClientView) => void;
  activeInstanceName?: string;
  connected: boolean;
}) {
  const items: Array<{ id: ClientView; label: string; icon: React.ReactNode }> = [
    { id: 'inbox', label: '收件箱', icon: <Inbox size={14} /> },
    { id: 'projects', label: '项目', icon: <FolderKanban size={14} /> },
    { id: 'team', label: '团队', icon: <Users size={14} /> },
    { id: 'agents', label: '智能体', icon: <Bot size={14} /> },
    { id: 'audit', label: '审计', icon: <ShieldCheck size={14} /> },
    { id: 'settings', label: '设置', icon: <Settings size={14} /> },
    { id: 'skills', label: 'Skill', icon: <Sparkles size={14} /> },
    { id: 'mcp', label: 'MCP', icon: <Plug size={14} /> },
  ];

  return (
    <div className="hidden border-b border-white/[0.07] bg-[#0a0b0c] max-md:block">
      <div className="flex items-center justify-between gap-3 px-3 py-2">
        <div className="min-w-0">
          <div className="text-sm font-semibold text-zinc-100">Berry Claw</div>
          <div className="flex items-center gap-1.5 text-[11px] text-zinc-500">
            <StatusDot ok={connected} />
            <span className="truncate">{activeInstanceName ?? '未选择实例'}</span>
          </div>
        </div>
        <div className="w-36">
          <InstancePicker />
        </div>
      </div>
      <div className="flex gap-1 overflow-x-auto px-2 pb-2">
        {items.map((item) => (
          <button
            key={item.id}
            onClick={() => onViewChange(item.id)}
            className={`inline-flex flex-shrink-0 items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs transition-colors ${
              activeView === item.id
                ? 'bg-emerald-400/10 text-emerald-200'
                : 'bg-white/[0.04] text-zinc-400 hover:bg-white/[0.08] hover:text-zinc-100'
            }`}
          >
            {item.icon}
            {item.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function ClientSidebar({
  activeView,
  onViewChange,
  activeInstanceName,
  connected,
  selectedAgent,
  agentCount,
  projectCount,
  collapsed,
  onToggleCollapsed,
}: {
  activeView: ClientView;
  onViewChange: (view: ClientView) => void;
  activeInstanceName?: string;
  connected: boolean;
  selectedAgent?: AgentFact;
  agentCount: number;
  projectCount: number;
  collapsed: boolean;
  onToggleCollapsed: () => void;
}) {
  return (
    <aside className="relative flex h-full min-h-0 flex-col overflow-hidden bg-[#0a0b0c] max-md:hidden">
      <button
        type="button"
        onClick={onToggleCollapsed}
        title={collapsed ? '展开左侧栏目' : '收起左侧栏目'}
        className="absolute right-[-1px] top-4 z-20 flex h-7 w-5 items-center justify-center rounded-l-md border border-r-0 border-white/[0.10] bg-[#111417] text-zinc-500 transition-colors hover:text-zinc-100"
      >
        {collapsed ? <ChevronRight size={14} /> : <ChevronLeft size={14} />}
      </button>

      <div className={`border-b border-white/[0.07] ${collapsed ? 'px-3 py-4' : 'px-4 py-4'}`}>
        <div className={`flex items-center ${collapsed ? 'justify-center' : 'gap-3'}`}>
          <div className="flex h-9 w-9 items-center justify-center rounded-lg border border-emerald-400/20 bg-emerald-400/10 text-emerald-300">
            <Bot size={18} />
          </div>
          <div className={`min-w-0 ${collapsed ? 'hidden' : ''}`}>
            <div className="text-sm font-semibold text-zinc-100">Berry Claw</div>
            <div className="truncate text-[11px] text-zinc-500">Agent workspace</div>
          </div>
        </div>
      </div>

      <div className={`border-b border-white/[0.07] ${collapsed ? 'px-2 py-3' : 'px-3 py-3'}`}>
        {collapsed ? (
          <div className="flex justify-center" title={activeInstanceName ?? '服务器切换'}>
            <StatusDot ok={connected} />
          </div>
        ) : (
          <>
            <SidebarLabel icon={<Server size={13} />} label="服务器切换" />
            <div className="mt-2">
              <InstancePicker />
            </div>
            <div className="mt-2 flex items-center gap-2 px-1 text-[11px] text-zinc-500">
              <StatusDot ok={connected} />
              <span className="min-w-0 truncate">{activeInstanceName ?? '未选择实例'}</span>
            </div>
          </>
        )}
      </div>

      <nav className={`min-h-0 flex-1 overflow-y-auto ${collapsed ? 'px-2 py-3' : 'px-3 py-3'}`}>
        <SidebarItem
          collapsed={collapsed}
          active={activeView === 'inbox'}
          icon={<Inbox size={16} />}
          label="收件箱"
          badge={selectedAgent?.status ?? undefined}
          onClick={() => onViewChange('inbox')}
        />

        <SidebarGroup title="工作区" collapsed={collapsed}>
          <SidebarItem
            collapsed={collapsed}
            active={activeView === 'projects'}
            icon={<FolderKanban size={16} />}
            label="项目"
            count={projectCount}
            onClick={() => onViewChange('projects')}
          />
          <SidebarItem
            collapsed={collapsed}
            active={activeView === 'team'}
            icon={<Users size={16} />}
            label="团队"
            onClick={() => onViewChange('team')}
          />
          <SidebarItem
            collapsed={collapsed}
            active={activeView === 'agents'}
            icon={<Bot size={16} />}
            label="智能体"
            count={agentCount}
            onClick={() => onViewChange('agents')}
          />
          <SidebarItem
            collapsed={collapsed}
            active={activeView === 'audit'}
            icon={<ShieldCheck size={16} />}
            label="审计"
            helper="Observe"
            onClick={() => onViewChange('audit')}
          />
        </SidebarGroup>

        <SidebarGroup title="配置" collapsed={collapsed}>
          <SidebarItem
            collapsed={collapsed}
            active={activeView === 'settings'}
            icon={<Settings size={16} />}
            label="设置"
            onClick={() => onViewChange('settings')}
          />
          <SidebarItem
            collapsed={collapsed}
            active={activeView === 'skills'}
            icon={<Sparkles size={16} />}
            label="Skill"
            helper="市场 / Global"
            onClick={() => onViewChange('skills')}
          />
          <SidebarItem
            collapsed={collapsed}
            active={activeView === 'mcp'}
            icon={<Plug size={16} />}
            label="MCP"
            helper="Global / Project / Agent"
            onClick={() => onViewChange('mcp')}
          />
        </SidebarGroup>
      </nav>

      <div className={`border-t border-white/[0.07] ${collapsed ? 'px-2 py-3' : 'px-4 py-3'}`}>
        {collapsed ? (
          <div className="flex justify-center" title={selectedAgent?.name ?? '当前智能体'}>
            <StatusDot status={selectedAgent?.status} />
          </div>
        ) : (
          <>
            <div className="text-[11px] text-zinc-500">当前智能体</div>
            <div className="mt-1 flex items-center gap-2">
              <StatusDot status={selectedAgent?.status} />
              <div className="min-w-0">
                <div className="truncate text-sm text-zinc-200">{selectedAgent?.name ?? '无智能体'}</div>
                <div className="truncate text-[10px] text-zinc-600">{modelShortName(selectedAgent?.model)}</div>
              </div>
            </div>
          </>
        )}
        </div>
    </aside>
  );
}

function SidebarLabel({ icon, label }: { icon: React.ReactNode; label: string }) {
  return (
    <div className="flex items-center gap-2 text-[11px] font-medium uppercase tracking-wide text-zinc-500">
      {icon}
      {label}
    </div>
  );
}

function SidebarGroup({ title, children, collapsed }: { title: string; children: React.ReactNode; collapsed?: boolean }) {
  return (
    <div className="mt-5">
      {!collapsed && <div className="mb-2 px-2 text-[11px] font-medium text-zinc-500">{title}</div>}
      <div className="space-y-1">{children}</div>
    </div>
  );
}

function SidebarItem({
  collapsed,
  active,
  icon,
  label,
  helper,
  badge,
  count,
  onClick,
}: {
  collapsed?: boolean;
  active: boolean;
  icon: React.ReactNode;
  label: string;
  helper?: string;
  badge?: string;
  count?: number;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      title={collapsed ? label : undefined}
      className={`flex w-full items-center rounded-lg text-left text-sm transition-colors ${
        collapsed ? 'h-10 justify-center px-0' : 'gap-2 px-2.5 py-2'
      } ${
        active
          ? 'border border-white/[0.08] bg-white/[0.08] text-zinc-50'
          : 'text-zinc-400 hover:bg-white/[0.05] hover:text-zinc-100'
      }`}
    >
      <span className={active ? 'text-emerald-300' : 'text-zinc-500'}>{icon}</span>
      {!collapsed && (
        <>
          <span className="min-w-0 flex-1">
            <span className="block truncate">{label}</span>
            {helper && <span className="block truncate text-[10px] text-zinc-600">{helper}</span>}
          </span>
          {typeof count === 'number' && (
            <span className="rounded-md bg-white/[0.06] px-1.5 py-0.5 text-[10px] text-zinc-400">{count}</span>
          )}
          {badge && (
            <span className="max-w-20 truncate rounded-md bg-emerald-400/10 px-1.5 py-0.5 text-[10px] text-emerald-300">
              {badge}
            </span>
          )}
        </>
      )}
    </button>
  );
}

function InboxView({
  messages,
  streamingSteps,
  streamingEvents,
  streamingTimeline,
  isLoading,
  selectedAgent,
  agents,
  activeSessionId,
  contextTokensUsed,
  contextWindow,
  streamingInferences,
  sessions,
  todos,
  newSessionDisabled,
  onSend,
  onInterject,
  onNewSession,
  onResumeSession,
  onSwitchAgent,
  onReasoningEffortChange,
  modelOptions,
  onModelChange,
}: {
  messages: ChatMessage[];
  streamingSteps: ChatStep[];
  streamingEvents: ChatTimelineEvent[];
  streamingTimeline: StreamingTimelineItem[];
  isLoading: boolean;
  selectedAgent?: AgentFact;
  agents: AgentFact[];
  activeSessionId?: string;
  contextTokensUsed: number;
  contextWindow: number;
  streamingInferences: InferenceInfo[];
  sessions: SessionListItem[];
  todos: TodoItem[];
  newSessionDisabled: boolean;
  onSend: (prompt: string | ContentBlock[]) => void;
  onInterject: (text: string) => void;
  onNewSession: () => void;
  onResumeSession: (sessionId: string) => void;
  onSwitchAgent: (agentId: string) => void;
  onReasoningEffortChange: (effort: ReasoningEffort) => void;
  modelOptions: string[];
  onModelChange: (model: string) => void;
}) {
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const [stickToBottom, setStickToBottom] = useState(true);
  const [rightPanelOpen, setRightPanelOpen] = useState(false);
  const streamingTimelineItems = useMemo(
    () => buildFinalTimeline(streamingTimeline, streamingSteps),
    [streamingSteps, streamingTimeline],
  );
  const displayMessages = useMemo(() => buildDisplayMessages(messages), [messages]);
  const hasStreamingContent = streamingTimelineItems.length > 0 || streamingSteps.length > 0 || streamingEvents.length > 0;
  const activeSession = sessions.find((session) => session.id === activeSessionId);

  useEffect(() => {
    if (stickToBottom) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, streamingSteps, streamingTimelineItems, stickToBottom]);

  const handleScroll = () => {
    const el = scrollContainerRef.current;
    if (!el) return;
    setStickToBottom(el.scrollHeight - el.scrollTop - el.clientHeight <= 80);
  };

  return (
    <>
      <div className="flex h-14 items-center justify-between gap-3 border-b border-white/[0.07] px-4">
        <AgentSwitcher
          agents={agents}
          selectedAgent={selectedAgent}
          onSwitchAgent={onSwitchAgent}
        />
        <div className="flex min-w-0 items-center gap-2">
          <SessionSwitcher
            sessions={sessions}
            activeSession={activeSession}
            activeSessionId={activeSessionId}
            newSessionDisabled={newSessionDisabled}
            onResumeSession={onResumeSession}
            onNewSession={onNewSession}
          />
          <button
            type="button"
            onClick={() => setRightPanelOpen((value) => !value)}
            title={rightPanelOpen ? '收起右侧栏目' : '拉出右侧栏目'}
            className={`inline-flex h-8 w-8 items-center justify-center rounded-md border transition-colors ${
              rightPanelOpen
                ? 'border-emerald-400/25 bg-emerald-400/10 text-emerald-300'
                : 'border-white/[0.08] bg-white/[0.04] text-zinc-500 hover:bg-white/[0.08] hover:text-zinc-100'
            }`}
          >
            {rightPanelOpen ? <ChevronRight size={15} /> : <ChevronLeft size={15} />}
          </button>
        </div>
      </div>

      <ContextProgressBar used={contextTokensUsed} window={contextWindow} />

      <div className={`grid min-h-0 flex-1 ${rightPanelOpen ? 'grid-cols-[minmax(0,1fr)_300px]' : 'grid-cols-1'} max-lg:grid-cols-1`}>
        <div
          ref={scrollContainerRef}
          onScroll={handleScroll}
          className="min-h-0 overflow-y-auto px-4 py-5"
        >
          {messages.length === 0 && !hasStreamingContent && !isLoading ? (
            <EmptyInbox agent={selectedAgent} onNewSession={onNewSession} newSessionDisabled={newSessionDisabled} />
          ) : (
            <div className="mx-auto max-w-4xl">
              {displayMessages.map((item) => (
                <MessageBubble
                  key={item.message.id}
                  message={item.message}
                  startedAt={item.startedAt}
                />
              ))}

              {(isLoading || hasStreamingContent) && (
                <div className="mb-4 flex justify-start">
                  <div className="w-full max-w-none">
                    <div className="mb-2 ml-1 text-xs text-zinc-500">BERRY CLAW AI</div>
                    {hasStreamingContent ? (
                      <TimelineItemList items={streamingTimelineItems} turnSettled={false} />
                    ) : (
                      <div className="inline-flex rounded-lg border border-white/[0.07] bg-white/[0.035] px-3 py-2">
                        <Loader2 size={16} className="animate-spin text-zinc-500" />
                      </div>
                    )}
                    {streamingInferences.length > 0 && <InferenceDetails inferences={streamingInferences} />}
                  </div>
                </div>
              )}
              <div ref={messagesEndRef} />
            </div>
          )}
        </div>
        {rightPanelOpen && (
          <SessionRail
            sessions={sessions}
            todos={todos}
            activeSessionId={activeSessionId}
            newSessionDisabled={newSessionDisabled}
            onResumeSession={onResumeSession}
            onNewSession={onNewSession}
          />
        )}
      </div>

      <ChatInput
        onSend={onSend}
        onInterject={onInterject}
        isLoading={isLoading}
        agentName={selectedAgent?.name}
        contextWindow={contextWindow}
        model={selectedAgent?.model}
        modelOptions={modelOptions}
        onModelChange={onModelChange}
        reasoningEffort={selectedAgent?.reasoningEffort}
        onReasoningEffortChange={onReasoningEffortChange}
      />
    </>
  );
}

function SessionRail({
  sessions,
  todos,
  activeSessionId,
  newSessionDisabled,
  onResumeSession,
  onNewSession,
}: {
  sessions: SessionListItem[];
  todos: TodoItem[];
  activeSessionId?: string;
  newSessionDisabled: boolean;
  onResumeSession: (sessionId: string) => void;
  onNewSession: () => void;
}) {
  return (
    <aside className="min-h-0 overflow-y-auto border-l border-white/[0.07] bg-[#0a0b0c] p-3 max-lg:hidden">
      <TodoRail todos={todos} />

      <div className="mb-3 mt-4 flex items-center justify-between gap-2">
        <div className="text-xs font-medium text-zinc-400">Sessions</div>
        <button
          type="button"
          disabled={newSessionDisabled}
          onClick={onNewSession}
          className="inline-flex h-7 items-center gap-1 rounded-md border border-white/[0.08] bg-white/[0.04] px-2 text-[11px] text-zinc-300 hover:bg-white/[0.08] disabled:cursor-not-allowed disabled:opacity-45 disabled:hover:bg-white/[0.04]"
        >
          <RotateCcw size={12} />
          新会话
        </button>
      </div>
      <div className="space-y-2">
        {sessions.length === 0 ? (
          <div className="rounded-lg border border-dashed border-white/[0.10] px-3 py-8 text-center text-xs text-zinc-600">
            暂无 session
          </div>
        ) : (
          sessions.map((session) => {
            const active = session.id === activeSessionId;
            return (
              <button
                key={session.id}
                onClick={() => onResumeSession(session.id)}
                className={`w-full rounded-lg border px-3 py-2 text-left transition-colors ${
                  active
                    ? 'border-emerald-400/30 bg-emerald-400/10'
                    : 'border-white/[0.06] bg-white/[0.025] hover:border-white/[0.12] hover:bg-white/[0.05]'
                }`}
              >
                <div className="flex items-center gap-2">
                  <MessageSquare size={13} className="text-zinc-500" />
                  <span className="min-w-0 flex-1 truncate text-sm text-zinc-100">
                    {session.title || shortSessionId(session.id)}
                  </span>
                </div>
                <div className="mt-1 flex items-center justify-between gap-2 text-[11px] text-zinc-600">
                  <span className="truncate font-mono">{shortSessionId(session.id)}</span>
                  <span>{formatSessionTime(session.updatedAt)}</span>
                </div>
              </button>
            );
          })
        )}
      </div>
    </aside>
  );
}

function TodoRail({ todos }: { todos: TodoItem[] }) {
  const openCount = todos.filter((todo) => !todo.done).length;

  return (
    <section className="rounded-lg border border-white/[0.07] bg-white/[0.025] p-3">
      <div className="mb-3 flex items-center justify-between gap-2">
        <div className="text-xs font-medium text-zinc-300">Todo</div>
        <span className="rounded-md bg-white/[0.06] px-1.5 py-0.5 font-mono text-[10px] text-zinc-500">
          {openCount}/{todos.length}
        </span>
      </div>
      {todos.length === 0 ? (
        <div className="rounded-md border border-dashed border-white/[0.10] px-3 py-6 text-center text-xs text-zinc-600">
          当前 session 暂无 todo
        </div>
      ) : (
        <div className="space-y-2">
          {todos.map((todo, index) => (
            <div
              key={`${todo.text}-${index}`}
              className={`rounded-md border px-3 py-2 ${
                todo.done
                  ? 'border-white/[0.05] bg-black/15 text-zinc-600'
                  : 'border-emerald-400/15 bg-emerald-400/[0.06] text-zinc-200'
              }`}
            >
              <div className="flex items-start gap-2">
                <span
                  className={`mt-1 h-1.5 w-1.5 shrink-0 rounded-full ${
                    todo.done ? 'bg-zinc-700' : 'bg-emerald-300'
                  }`}
                />
                <span className={`min-w-0 flex-1 text-xs leading-5 ${todo.done ? 'line-through' : ''}`}>
                  {todo.text}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function AgentSwitcher({
  agents,
  selectedAgent,
  onSwitchAgent,
}: {
  agents: AgentFact[];
  selectedAgent?: AgentFact;
  onSwitchAgent: (agentId: string) => void;
}) {
  const [open, setOpen] = useState(false);

  return (
    <div className="relative min-w-0 flex-1">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="flex min-w-0 max-w-full items-center gap-2 rounded-lg border border-transparent px-2 py-1.5 text-left transition-colors hover:border-white/[0.08] hover:bg-white/[0.04]"
      >
        <StatusDot status={selectedAgent?.status} />
        <span className="min-w-0 flex-1">
          <span className="flex min-w-0 items-center gap-2">
            <span className="truncate text-sm font-semibold text-zinc-100">
              {selectedAgent?.name ?? '未选择智能体'}
            </span>
            <span className="hidden truncate text-[11px] text-zinc-500 sm:block">
              {modelShortName(selectedAgent?.model)}
            </span>
          </span>
          <span className="mt-0.5 block truncate text-[11px] text-zinc-600">
            {selectedAgent?.project || selectedAgent?.workspace || '未绑定工作区'}
          </span>
        </span>
        <ChevronDown size={14} className={`shrink-0 text-zinc-600 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="absolute left-0 top-12 z-30 w-[min(420px,calc(100vw-96px))] rounded-xl border border-white/[0.10] bg-[#101113] p-2 shadow-2xl">
          <div className="mb-2 px-2 text-[10px] uppercase tracking-wide text-zinc-600">Agent</div>
          <div className="max-h-80 space-y-1 overflow-y-auto pr-1">
            {agents.length === 0 ? (
              <div className="rounded-lg border border-dashed border-white/[0.10] px-3 py-6 text-center text-xs text-zinc-600">
                没有可用 agent
              </div>
            ) : (
              agents.map((agent) => {
                const active = agent.id === selectedAgent?.id;
                return (
                  <button
                    key={agent.id}
                    type="button"
                    onClick={() => {
                      onSwitchAgent(agent.id);
                      setOpen(false);
                    }}
                    className={`flex w-full items-center gap-3 rounded-lg border px-3 py-2 text-left transition-colors ${
                      active
                        ? 'border-emerald-400/30 bg-emerald-400/10'
                        : 'border-transparent hover:border-white/[0.08] hover:bg-white/[0.05]'
                    }`}
                  >
                    <StatusDot status={agent.status} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-zinc-100">{agent.name}</span>
                      <span className="mt-0.5 block truncate text-[11px] text-zinc-600">
                        {modelShortName(agent.model)} / {agent.project ? lastPathPart(agent.project) : 'workspace only'}
                      </span>
                    </span>
                    {agent.isActive && (
                      <span className="rounded-md bg-emerald-400/10 px-1.5 py-0.5 text-[10px] text-emerald-300">
                        active
                      </span>
                    )}
                  </button>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function SessionSwitcher({
  sessions,
  activeSession,
  activeSessionId,
  newSessionDisabled,
  onResumeSession,
  onNewSession,
}: {
  sessions: SessionListItem[];
  activeSession?: SessionListItem;
  activeSessionId?: string;
  newSessionDisabled: boolean;
  onResumeSession: (sessionId: string) => void;
  onNewSession: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (boxRef.current && !boxRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    if (open) document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [open]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return sessions;
    return sessions.filter((session) =>
      [session.title ?? '', session.id].join(' ').toLowerCase().includes(q),
    );
  }, [query, sessions]);

  return (
    <div ref={boxRef} className="relative">
      <div className="flex items-center gap-2">
        <button
          onClick={() => setOpen((value) => !value)}
          className="hidden h-8 max-w-[280px] items-center gap-2 rounded-md border border-white/[0.08] bg-white/[0.04] px-2.5 text-left text-xs text-zinc-300 transition-colors hover:bg-white/[0.08] md:inline-flex"
          title={activeSessionId ?? 'No session'}
        >
          <MessageSquare size={13} className="text-zinc-500" />
          <span className="min-w-0 truncate">
            {activeSession?.title || shortSessionId(activeSessionId) || '没有 session'}
          </span>
          {typeof activeSession?.messageCount === 'number' && (
            <span className="rounded bg-black/20 px-1.5 py-0.5 text-[10px] text-zinc-500">
              {activeSession.messageCount}
            </span>
          )}
          <ChevronDown size={13} className={`text-zinc-600 transition-transform ${open ? 'rotate-180' : ''}`} />
        </button>
        <button
          disabled={newSessionDisabled}
          onClick={() => {
            if (newSessionDisabled) return;
            onNewSession();
            setOpen(false);
          }}
          className="inline-flex h-8 items-center gap-1.5 rounded-md border border-white/[0.08] bg-white/[0.04] px-2.5 text-xs text-zinc-300 transition-colors hover:bg-white/[0.08] disabled:cursor-not-allowed disabled:opacity-45 disabled:hover:bg-white/[0.04]"
        >
          <RotateCcw size={13} />
          新会话
        </button>
      </div>

      {open && (
        <div className="absolute right-0 top-10 z-50 w-[360px] overflow-hidden rounded-xl border border-white/[0.10] bg-[#151719] shadow-2xl max-md:hidden">
          <div className="border-b border-white/[0.07] p-2">
            <div className="relative">
              <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-zinc-600" />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="搜索 session"
                className="h-8 w-full rounded-lg border border-white/[0.08] bg-black/20 pl-8 pr-3 text-xs text-zinc-200 outline-none placeholder:text-zinc-600 focus:border-emerald-400/40"
              />
            </div>
          </div>
          <div className="max-h-[420px] overflow-y-auto p-2">
            {filtered.length === 0 ? (
              <div className="rounded-lg border border-dashed border-white/[0.10] px-3 py-8 text-center text-xs text-zinc-600">
                没有匹配的 session
              </div>
            ) : (
              filtered.map((session) => {
                const active = session.id === activeSessionId;
                return (
                  <button
                    key={session.id}
                    onClick={() => {
                      onResumeSession(session.id);
                      setOpen(false);
                    }}
                    className={`w-full rounded-lg border px-3 py-2 text-left transition-colors ${
                      active
                        ? 'border-emerald-400/30 bg-emerald-400/10'
                        : 'border-transparent hover:border-white/[0.08] hover:bg-white/[0.04]'
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <span className="min-w-0 flex-1 truncate text-sm text-zinc-100">
                        {session.title || shortSessionId(session.id)}
                      </span>
                      {typeof session.messageCount === 'number' && (
                        <span className="rounded-md bg-black/20 px-1.5 py-0.5 text-[10px] text-zinc-500">
                          {session.messageCount}
                        </span>
                      )}
                    </div>
                    <div className="mt-1 flex items-center justify-between gap-3 text-[11px] text-zinc-600">
                      <span className="truncate font-mono">{shortSessionId(session.id)}</span>
                      <span className="flex-shrink-0">{formatSessionTime(session.updatedAt)}</span>
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function EmptyInbox({
  agent,
  onNewSession,
  newSessionDisabled,
}: {
  agent?: AgentFact;
  onNewSession: () => void;
  newSessionDisabled: boolean;
}) {

  return (
    <div className="flex h-full min-h-[420px] items-center justify-center">
      <div className="w-full max-w-2xl text-center">
        <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-xl border border-emerald-400/20 bg-emerald-400/10 text-emerald-300">
          <Inbox size={24} />
        </div>
        <h2 className="text-xl font-semibold text-zinc-100">{agent?.name ?? '选择一个智能体开始'}</h2>
        <p className="mx-auto mt-2 max-w-lg text-sm text-zinc-500">
          收件箱承载当前 agent 的 session。消息历史来自 session events，agent 身份来自它的文件目录。
        </p>
        <button
          disabled={newSessionDisabled}
          onClick={onNewSession}
          className="mt-6 inline-flex h-9 items-center gap-2 rounded-lg border border-emerald-400/25 bg-emerald-400/10 px-3 text-sm text-emerald-200 transition-colors hover:bg-emerald-400/15 disabled:cursor-not-allowed disabled:opacity-45 disabled:hover:bg-emerald-400/10"
        >
          <RotateCcw size={14} />
          新会话
        </button>
      </div>
    </div>
  );
}

function ProjectsPage({
  projects,
  selectedAgentId,
  onOpenAgent,
}: {
  projects: ProjectSummary[];
  selectedAgentId?: string;
  onOpenAgent: (agentId: string) => void;
}) {
  const [selectedKey, setSelectedKey] = useState<string | undefined>(projects[0]?.key);
  const selected = projects.find((project) => project.key === selectedKey) ?? projects[0];

  useEffect(() => {
    if (!projects.length) {
      setSelectedKey(undefined);
      return;
    }
    if (!selectedKey || !projects.some((project) => project.key === selectedKey)) {
      setSelectedKey(projects[0]?.key);
    }
  }, [projects, selectedKey]);

  return (
    <div className="min-h-0 flex-1 overflow-hidden">
      <PageHeader
        icon={<FolderKanban size={18} />}
        title="项目"
      />

      <div className="grid h-[calc(100vh-64px)] min-h-0 grid-cols-[320px_minmax(0,1fr)] max-lg:grid-cols-1">
        <aside className="min-h-0 overflow-y-auto border-r border-white/[0.07] bg-[#0b0c0d] p-3">
          {projects.length === 0 ? (
            <div className="rounded-lg border border-dashed border-white/[0.10] px-3 py-8 text-center text-xs text-zinc-600">
              还没有项目绑定
            </div>
          ) : (
            <div className="space-y-2">
              {projects.map((project) => (
                <button
                  key={project.key}
                  onClick={() => setSelectedKey(project.key)}
                  className={`w-full rounded-lg border p-3 text-left transition-colors ${
                    project.key === selected?.key
                      ? 'border-emerald-400/30 bg-emerald-400/10'
                      : 'border-white/[0.07] bg-white/[0.025] hover:border-white/[0.13] hover:bg-white/[0.05]'
                  }`}
                >
                  <div className="truncate text-sm font-medium text-zinc-100">{project.name}</div>
                  <div className="mt-1 truncate font-mono text-[11px] text-zinc-600">{project.path}</div>
                  <div className="mt-2 flex gap-1.5">
                    <span className="rounded-md bg-white/[0.06] px-1.5 py-0.5 text-[10px] text-zinc-400">{project.agents.length} agents</span>
                    <span className="rounded-md bg-white/[0.06] px-1.5 py-0.5 text-[10px] text-zinc-400">{project.teams.length} teams</span>
                  </div>
                </button>
              ))}
            </div>
          )}
        </aside>

        <section className="min-h-0 overflow-y-auto p-5">
          {!selected ? (
            <EmptyPanel
              icon={<FolderKanban size={22} />}
              title="还没有项目绑定"
              body="在智能体里设置 project 后，这里会显示该项目下的 agents 和 teams。"
            />
          ) : (
            <ProjectDetail
              project={selected}
              selectedAgentId={selectedAgentId}
              onOpenAgent={onOpenAgent}
            />
          )}
        </section>
      </div>
    </div>
  );
}

function ProjectDetail({
  project,
  selectedAgentId,
  onOpenAgent,
}: {
  project: ProjectSummary;
  selectedAgentId?: string;
  onOpenAgent: (agentId: string) => void;
}) {
  return (
    <section className="relative overflow-hidden rounded-xl border border-white/[0.08] bg-[#10110f]">
      <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-emerald-300/40 to-transparent" />
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-white/[0.07] px-4 py-4">
        <div className="min-w-0">
          <div className="text-[10px] uppercase tracking-[0.24em] text-emerald-300/60">project dossier</div>
          <h2 className="mt-1 truncate text-lg font-semibold text-zinc-100">{project.name}</h2>
          <div className="mt-1 truncate font-mono text-[11px] text-zinc-500">{project.path}</div>
        </div>
        <div className="grid grid-cols-2 gap-2 text-[11px] text-zinc-500">
          <ProjectStat label="Agents" value={project.agents.length} />
          <ProjectStat label="Teams" value={project.teams.length} />
        </div>
      </div>
      <div className="grid gap-4 p-4 xl:grid-cols-[minmax(0,1fr)_320px]">
        <div>
          <div className="mb-2 flex items-center gap-2 text-xs font-medium text-zinc-400">
            <Bot size={13} />
            绑定主体
          </div>
          <div className="grid gap-2 md:grid-cols-2">
            {project.agents.map((agent) => (
              <button
                key={agent.id}
                onClick={() => onOpenAgent(agent.id)}
                className={`flex w-full items-center gap-3 rounded-lg border px-3 py-2 text-left transition-colors ${
                  agent.id === selectedAgentId
                    ? 'border-emerald-400/30 bg-emerald-400/10'
                    : 'border-white/[0.07] bg-black/10 hover:border-white/[0.14] hover:bg-white/[0.05]'
                }`}
              >
                <StatusDot status={agent.status} />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium text-zinc-100">{agent.name}</div>
                  <div className="truncate text-[11px] text-zinc-600">{modelShortName(agent.model)}</div>
                </div>
              </button>
            ))}
          </div>
          {project.agents.length === 0 && (
            <div className="rounded-lg bg-black/15 px-3 py-6 text-center text-xs text-zinc-600">
              这个项目目前没有绑定 agent。
            </div>
          )}
        </div>
        {project.key === '__unbound__' ? (
          <div className="rounded-lg border border-white/[0.07] bg-black/15 p-3 text-xs leading-relaxed text-zinc-500">
            这些 agent 还没有绑定 project。绑定后才可以加入团队。
          </div>
        ) : (
          <div className="space-y-4 rounded-lg border border-white/[0.07] bg-black/15 p-3">
            <ProjectSafetyPanel project={project} />
            <div className="flex items-center gap-2 text-xs font-medium text-zinc-300">
              <FileText size={13} />
              项目事实源
            </div>
            <ProjectFile label="project context" path={`${project.path}/AGENTS.md`} />
            <ProjectFile label="team state" path={`${project.path}/.berry/team.json`} />
            <ProjectFile label="team messages" path={`${project.path}/.berry/messages.jsonl`} />
            <ProjectFile label="worklist" path={`${project.path}/.berry/worklist.json`} />
            <div>
              <div className="mb-2 text-[10px] uppercase tracking-wide text-zinc-600">Teams</div>
              {project.teams.length > 0 ? (
                <div className="space-y-1">
                  {project.teams.map((team) => (
                    <div key={team.id} className="rounded-md border border-white/[0.06] bg-white/[0.03] px-2 py-1.5">
                      <div className="truncate text-xs text-zinc-300">{team.name}</div>
                      <div className="mt-0.5 text-[10px] text-zinc-600">{team.worklist.length} tasks · {team.messageCount} messages</div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="rounded-md border border-dashed border-white/[0.08] px-2 py-3 text-center text-[11px] text-zinc-600">
                  还没有 team 绑定这个 project
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

function ProjectStat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-white/[0.07] bg-black/20 px-3 py-2 text-right">
      <div className="text-[10px] uppercase tracking-wide text-zinc-600">{label}</div>
      <div className="text-base font-semibold text-zinc-100">{value}</div>
    </div>
  );
}

function ProjectSafetyPanel({ project }: { project: ProjectSummary }) {
  const [snapshot, setSnapshot] = useState<SafetySnapshot | null>(null);
  const [saving, setSaving] = useState(false);
  const toast = useToast();

  const refresh = useCallback(async () => {
    const res = await apiFetch(API.safety);
    if (!res.ok) return;
    setSnapshot((await res.json()) as SafetySnapshot);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh, project.path]);

  const projectLayer = snapshot?.agents.find((agent) => agent.projectRoot === project.path);
  const value = projectLayer?.projectLevel ?? null;

  const setProjectLevel = async (level: SafetyLevel | null) => {
    setSaving(true);
    try {
      const res = await apiFetch(API.safetyProject, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ projectRoot: project.path, level }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      toast.show({ title: 'Project safety', message: level ? `Set to ${level}` : 'Cleared' });
      await refresh();
    } catch (err) {
      toast.show({ variant: 'error', title: 'Project safety update failed', message: err instanceof Error ? err.message : String(err) });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-xs font-medium text-zinc-300">
          <ShieldCheck size={13} />
          项目安全策略
        </div>
        {saving && <Loader2 size={13} className="animate-spin text-zinc-500" />}
      </div>
      <div className="grid gap-2">
        <SafetyChoiceButton
          label="继承"
          summary={`继承 global：${snapshot?.globalLevel ?? 'default'}`}
          active={value === null}
          disabled={saving}
          onClick={() => setProjectLevel(null)}
        />
        {SAFETY_LEVELS.map((level) => (
          <SafetyChoiceButton
            key={level}
            label={SAFETY_META[level].label}
            summary={SAFETY_META[level].summary}
            active={value === level}
            disabled={saving}
            onClick={() => setProjectLevel(level)}
          />
        ))}
      </div>
    </div>
  );
}

function SafetyChoiceButton({
  label,
  summary,
  active,
  disabled,
  onClick,
}: {
  label: string;
  summary: string;
  active: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={`rounded-md border px-2.5 py-2 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
        active
          ? 'border-emerald-400/35 bg-emerald-400/10'
          : 'border-white/[0.07] bg-white/[0.025] hover:border-white/[0.13] hover:bg-white/[0.05]'
      }`}
    >
      <div className="text-xs font-medium text-zinc-100">{label}</div>
      <div className="mt-0.5 text-[11px] leading-4 text-zinc-600">{summary}</div>
    </button>
  );
}

function ProjectFile({ label, path }: { label: string; path: string }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wide text-zinc-600">{label}</div>
      <div className="mt-1 truncate font-mono text-[11px] text-zinc-500" title={path}>{path}</div>
    </div>
  );
}

function PageHeader({ icon, title, subtitle }: { icon: React.ReactNode; title: string; subtitle?: string }) {
  return (
    <div className="border-b border-white/[0.07] px-4 py-4 lg:px-6">
      <div className="flex items-center gap-2">
        <span className="text-emerald-300">{icon}</span>
        <h1 className="text-base font-semibold text-zinc-100">{title}</h1>
      </div>
      {subtitle && <p className="mt-1 text-sm text-zinc-500">{subtitle}</p>}
    </div>
  );
}

function EmptyPanel({ icon, title, body }: { icon: React.ReactNode; title: string; body: string }) {
  return (
    <div className="flex min-h-[280px] flex-col items-center justify-center rounded-xl border border-dashed border-white/[0.10] bg-white/[0.02] px-6 text-center">
      <div className="mb-3 text-zinc-500">{icon}</div>
      <div className="text-sm font-medium text-zinc-200">{title}</div>
      <div className="mt-1 max-w-md text-sm text-zinc-500">{body}</div>
    </div>
  );
}

function ContextProgressBar({ used, window }: { used: number; window: number }) {
  const pct = Math.min(100, Math.max(0, (used / Math.max(1, window)) * 100));
  const color = pct > 85 ? 'bg-red-400' : pct > 65 ? 'bg-amber-400' : pct > 40 ? 'bg-sky-400' : 'bg-emerald-400';

  return (
    <div className="flex h-7 items-center gap-3 border-b border-white/[0.07] bg-[#0b0c0d] px-4">
      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/[0.06]">
        <div className={`h-full ${color} transition-all duration-500`} style={{ width: `${pct}%` }} />
      </div>
      <div className="whitespace-nowrap font-mono text-[10px] text-zinc-600">
        {pct.toFixed(1)}% · {used.toLocaleString()}/{window.toLocaleString()}
      </div>
    </div>
  );
}

function InferenceDetails({ inferences }: { inferences: InferenceInfo[] }) {
  const [expanded, setExpanded] = useState(false);
  const totalCost = inferences.reduce((sum, inf) => sum + (inf.cost ?? 0), 0);
  if (inferences.length === 0) return null;

  return (
    <div className="mt-1 ml-1">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-1 text-xs text-zinc-600 transition-colors hover:text-zinc-400"
      >
        <span>{inferences.length} inference{inferences.length > 1 ? 's' : ''}</span>
        {totalCost > 0 && <span>· ${totalCost.toFixed(4)}</span>}
        <ChevronDown size={12} className={`transition-transform ${expanded ? 'rotate-180' : ''}`} />
      </button>
      {expanded && (
        <div className="mt-1 space-y-1">
          {inferences.map((inf, i) => (
            <div key={i} className="font-mono text-xs text-zinc-500">
              <span className="text-zinc-400">{inf.model}</span>
              {' · '}
              {inf.inputTokens}↓ {inf.outputTokens}↑
              {inf.cacheReadTokens ? ` · cache ${inf.cacheReadTokens}R` : ''}
              {inf.cacheWriteTokens ? ` · cache ${inf.cacheWriteTokens}W` : ''}
              {inf.cost != null && ` · $${inf.cost.toFixed(5)}`}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

interface ImageAttachment {
  id: string;
  name: string;
  mediaType: string;
  dataUrl: string;
  data: string;
  sizeBytes: number;
}

interface QueuedPrompt {
  id: string;
  text: string;
  attachments: ImageAttachment[];
  createdAt: number;
}

const MAX_IMAGE_BYTES = 4 * 1024 * 1024;
const ACCEPTED_IMAGE_MIME = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];

function ChatInput({
  onSend,
  onInterject,
  isLoading,
  agentName,
  contextWindow,
  model,
  modelOptions,
  onModelChange,
  reasoningEffort,
  onReasoningEffortChange,
}: {
  onSend: (s: string | ContentBlock[]) => void;
  onInterject?: (text: string) => void;
  isLoading: boolean;
  agentName?: string;
  contextWindow: number;
  model?: string;
  modelOptions: string[];
  onModelChange?: (model: string) => void;
  reasoningEffort?: ReasoningEffort;
  onReasoningEffortChange?: (effort: ReasoningEffort) => void;
}) {
  const [input, setInput] = useState('');
  const [attachments, setAttachments] = useState<ImageAttachment[]>([]);
  const [queue, setQueue] = useState<QueuedPrompt[]>([]);
  const [awaitingQueueStart, setAwaitingQueueStart] = useState(false);
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
    el.style.height = `${Math.min(el.scrollHeight, 180)}px`;
  }, [input]);

  const ingestFile = useCallback(async (file: File): Promise<ImageAttachment | null> => {
    if (!ACCEPTED_IMAGE_MIME.includes(file.type) || file.size > MAX_IMAGE_BYTES) return null;
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(reader.error);
      reader.onload = () => resolve(String(reader.result));
      reader.readAsDataURL(file);
    });
    const comma = dataUrl.indexOf(',');
    return {
      id: `att_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      name: file.name || 'pasted-image',
      mediaType: file.type,
      dataUrl,
      data: comma >= 0 ? dataUrl.slice(comma + 1) : '',
      sizeBytes: file.size,
    };
  }, []);

  const addFiles = useCallback(async (files: FileList | File[]) => {
    const incoming: ImageAttachment[] = [];
    for (const file of Array.from(files)) {
      const att = await ingestFile(file);
      if (att) incoming.push(att);
    }
    if (incoming.length > 0) setAttachments((prev) => [...prev, ...incoming]);
  }, [ingestFile]);

  const promptFromDraft = useCallback((text: string, draftAttachments: ImageAttachment[]): string | ContentBlock[] => {
    if (draftAttachments.length === 0) return text;
    const blocks: ContentBlock[] = draftAttachments.map((a) => ({
      type: 'image',
      data: a.data,
      mediaType: a.mediaType,
    }));
    if (text) blocks.push({ type: 'text', text });
    return blocks;
  }, []);

  useEffect(() => {
    if (isLoading && awaitingQueueStart) setAwaitingQueueStart(false);
  }, [awaitingQueueStart, isLoading]);

  useEffect(() => {
    if (isLoading || awaitingQueueStart || queue.length === 0) return;
    const [next, ...rest] = queue;
    onSend(promptFromDraft(next.text, next.attachments));
    setQueue(rest);
    setAwaitingQueueStart(true);
  }, [awaitingQueueStart, isLoading, onSend, promptFromDraft, queue]);

  const handleSubmit = () => {
    const text = input.trim();
    if (!text && attachments.length === 0) return;
    setQueue((prev) => [
      ...prev,
      {
        id: `queue_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        text,
        attachments,
        createdAt: Date.now(),
      },
    ]);
    setInput('');
    setAttachments([]);
    if (textareaRef.current) textareaRef.current.style.height = 'auto';
  };

  const editQueuedPrompt = (id: string) => {
    const item = queue.find((q) => q.id === id);
    if (!item) return;
    setInput(item.text);
    setAttachments(item.attachments);
    setQueue((prev) => prev.filter((q) => q.id !== id));
    requestAnimationFrame(() => textareaRef.current?.focus());
  };

  const sendQueuedPromptNow = (id: string) => {
    const item = queue.find((q) => q.id === id);
    if (!item) return;
    if (onInterject && item.attachments.length === 0) {
      onInterject(item.text);
    } else if (!isLoading) {
      onSend(promptFromDraft(item.text, item.attachments));
      setAwaitingQueueStart(true);
    } else {
      return;
    }
    setQueue((prev) => prev.filter((q) => q.id !== id));
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

  const modelChoices = uniqueStrings([model, ...modelOptions]);

  return (
    <div className="border-t border-white/[0.06] bg-[#101010] px-4 py-3">
      <div className="mx-auto max-w-4xl">
        {queue.length > 0 && (
          <div className="mb-2 space-y-1.5">
            {queue.map((item, index) => {
              const canInterject = !!onInterject && item.attachments.length === 0;
              const canSendNow = canInterject || !isLoading;
              return (
                <div
                  key={item.id}
                  className="flex items-center gap-2 rounded-lg border border-white/[0.07] bg-white/[0.035] px-3 py-2 text-xs text-zinc-400"
                >
                  <span className="shrink-0 font-mono text-zinc-600">#{index + 1}</span>
                  <span className="min-w-0 flex-1 truncate text-zinc-300">
                    {item.text || `${item.attachments.length} image${item.attachments.length > 1 ? 's' : ''}`}
                  </span>
                  {item.attachments.length > 0 && (
                    <span className="shrink-0 rounded-md bg-white/[0.05] px-1.5 py-0.5 text-[10px] text-zinc-500">
                      {item.attachments.length} image
                    </span>
                  )}
                  <button
                    type="button"
                    onClick={() => editQueuedPrompt(item.id)}
                    className="shrink-0 rounded-md px-2 py-1 text-zinc-500 transition-colors hover:bg-white/[0.06] hover:text-zinc-200"
                  >
                    重新编辑
                  </button>
                  <button
                    type="button"
                    disabled={!canSendNow}
                    onClick={() => sendQueuedPromptNow(item.id)}
                    title={canInterject ? '立即插入当前回合' : '立即发送'}
                    className="shrink-0 rounded-md px-2 py-1 text-zinc-500 transition-colors hover:bg-white/[0.06] hover:text-zinc-200 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    立即发送
                  </button>
                </div>
              );
            })}
          </div>
        )}

        {attachments.length > 0 && (
          <div className="mb-2 flex flex-wrap gap-2">
            {attachments.map((a) => (
              <div key={a.id} className="group relative">
                <img
                  src={a.dataUrl}
                  alt={a.name}
                  className="h-16 w-16 rounded-md border border-white/[0.08] object-cover"
                />
                <button
                  onClick={() => setAttachments((prev) => prev.filter((x) => x.id !== a.id))}
                  className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full border border-white/[0.12] bg-[#151719] text-zinc-400 opacity-0 transition-opacity group-hover:opacity-100"
                  title="Remove"
                >
                  <X size={11} />
                </button>
              </div>
            ))}
          </div>
        )}

        <div className="relative rounded-xl border border-white/[0.08] bg-[#1a1a1a] px-3 py-3 shadow-[0_8px_30px_rgba(0,0,0,0.20)]">
          <textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                e.preventDefault();
                handleSubmit();
              }
            }}
            onPaste={handlePaste}
            onDrop={handleDrop}
            onDragOver={(e) => e.preventDefault()}
            placeholder={`Ask ${agentName ?? 'agent'}...`}
            rows={1}
            className="max-h-[180px] min-h-[24px] w-full resize-none bg-transparent pr-20 text-sm text-zinc-100 outline-none placeholder:text-zinc-600"
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
            title="Attach image"
            className="absolute bottom-3 right-12 flex h-8 w-8 items-center justify-center rounded-lg text-zinc-500 transition-colors hover:bg-white/[0.06] hover:text-zinc-200"
          >
            <Paperclip size={16} />
          </button>
          <button
            onClick={handleSubmit}
            disabled={!input.trim() && attachments.length === 0}
            title="加入发送队列"
            className="absolute bottom-3 right-3 flex h-8 w-8 items-center justify-center rounded-lg bg-zinc-100 text-zinc-950 transition-colors hover:bg-white disabled:cursor-not-allowed disabled:opacity-35"
          >
            <Send size={16} />
          </button>
        </div>

        <div className="mt-2 flex items-center justify-between text-[10px] text-zinc-600">
          <div className="flex items-center gap-3">
            <button
              onClick={() => fileInputRef.current?.click()}
              className="flex items-center gap-1 transition-colors hover:text-zinc-400"
            >
              <Paperclip size={12} />
              Attach
            </button>
            <div className="relative" ref={reasonRef}>
              <button
                onClick={() => setReasonOpen(!reasonOpen)}
                className={`flex items-center gap-1 transition-colors ${
                  reasoningEffort && reasoningEffort !== 'none'
                    ? 'text-zinc-300 hover:text-zinc-100'
                    : 'hover:text-zinc-400'
                }`}
              >
                <Brain size={12} />
                Reason{reasoningEffort && reasoningEffort !== 'none' ? `: ${reasoningEffort}` : ''}
              </button>
              {reasonOpen && onReasoningEffortChange && (
                <div className="absolute bottom-full left-0 z-50 mb-1 min-w-[120px] overflow-hidden rounded-lg border border-white/[0.08] bg-[#151719] py-1 shadow-xl">
                  {(['none', 'low', 'medium', 'high', 'max', 'xhigh'] as const).map((effort) => (
                    <button
                      key={effort}
                      onClick={() => {
                        onReasoningEffortChange(effort);
                        setReasonOpen(false);
                      }}
                      className={`w-full px-3 py-1.5 text-left text-[11px] capitalize transition-colors ${
                        reasoningEffort === effort
                          ? 'bg-white/[0.08] text-zinc-100'
                          : 'text-zinc-400 hover:bg-white/[0.06] hover:text-zinc-200'
                      }`}
                    >
                      {effort}
                    </button>
                  ))}
                </div>
              )}
            </div>
            {modelChoices.length > 0 && (
              <label className="flex items-center gap-1">
                <Zap size={12} />
                <select
                  value={model ?? modelChoices[0] ?? ''}
                  onChange={(e) => onModelChange?.(e.target.value)}
                  className="max-w-40 rounded-md border border-white/[0.06] bg-transparent px-1.5 py-0.5 text-[10px] text-zinc-400 outline-none transition-colors hover:text-zinc-200"
                >
                  {modelChoices.map((choice) => (
                    <option key={choice} value={choice} className="bg-[#151719] text-zinc-200">
                      {modelShortName(choice)}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </div>
          <div>
            {attachments.length > 0 ? `${attachments.length} image${attachments.length > 1 ? 's' : ''} · ` : ''}
            {Math.round((input.length / 1024) * 10) / 10}K / {Math.round(contextWindow / 1024)}K
          </div>
        </div>
      </div>
    </div>
  );
}

interface ProjectSummary {
  key: string;
  name: string;
  path: string;
  agents: AgentFact[];
  teams: TeamFact[];
}

interface SafetyAgentLayer {
  id: string;
  agentLevel: SafetyLevel | null;
  projectLevel: SafetyLevel | null;
  projectRoot: string | null;
  effective: SafetyLevel;
}

interface SafetySnapshot {
  levels: SafetyLevel[];
  globalLevel: SafetyLevel | null;
  agents: SafetyAgentLayer[];
}

const SAFETY_LEVELS: SafetyLevel[] = ['trust', 'default', 'auto'];
const SAFETY_META: Record<SafetyLevel, { label: string; summary: string }> = {
  trust: { label: 'Trust', summary: '只拦截灾难级命令，不限制写入范围。' },
  default: { label: 'Default', summary: '限制写入范围，并拦截高危命令。' },
  auto: { label: 'Auto', summary: 'Default + 高风险工具调用前询问。' },
};

function useProjectSummaries(agents: AgentFact[], teams: TeamFact[]): ProjectSummary[] {
  return useMemo(() => {
    const map = new Map<string, ProjectSummary>();

    for (const agent of agents) {
      const path = agent.project || '__unbound__';
      const existing = map.get(path);
      if (existing) {
        existing.agents.push(agent);
      } else {
        map.set(path, {
          key: path,
          name: path === '__unbound__' ? '未绑定项目' : lastPathPart(path),
          path: path === '__unbound__' ? 'agent workspace only' : path,
          agents: [agent],
          teams: [],
        });
      }
    }

    for (const team of teams) {
      const path = team.project || '__unbound__';
      const existing = map.get(path);
      if (existing) {
        existing.teams.push(team);
      } else {
        map.set(path, {
          key: path,
          name: lastPathPart(path),
          path,
          agents: [],
          teams: [team],
        });
      }
    }

    return [...map.values()].sort((a, b) => {
      if (a.key === '__unbound__') return 1;
      if (b.key === '__unbound__') return -1;
      return a.name.localeCompare(b.name);
    });
  }, [agents, teams]);
}

function StatusDot({ ok, status }: { ok?: boolean; status?: AgentStatus }) {
  const className =
    ok === true || status === 'idle' ? 'bg-emerald-400' :
    ok === false || status === 'error' ? 'bg-red-400' :
    status === 'sleeping' ? 'bg-zinc-500' :
    status ? 'bg-sky-400 animate-pulse' :
    'bg-zinc-600';

  return <span className={`h-2 w-2 flex-shrink-0 rounded-full ${className}`} />;
}

function statusTone(status?: AgentStatus): 'good' | 'warn' | 'bad' | undefined {
  if (status === 'idle') return 'good';
  if (status === 'error') return 'bad';
  if (status) return 'warn';
  return undefined;
}

function modelShortName(model?: string): string {
  if (!model) return '-';
  return model.split('/').pop()?.split(':').pop() ?? model;
}

function shortSessionId(id?: string): string {
  if (!id) return '';
  return id.length > 14 ? `${id.slice(0, 8)}...${id.slice(-4)}` : id;
}

function uniqueStrings(values: Array<string | undefined | null>): string[] {
  return [...new Set(values.filter((value): value is string => !!value && value.trim().length > 0))];
}

function formatSessionTime(value?: number): string {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  const now = new Date();
  if (date.toDateString() === now.toDateString()) {
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }
  return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

function mergeFinalToolResults(steps: ChatStep[], finalTools?: ToolCallInfo[]): ChatStep[] {
  if (!finalTools?.length) return steps;

  const byId = new Map(finalTools.filter((tool) => tool.toolUseId).map((tool) => [tool.toolUseId, tool]));
  const byName = new Map<string, ToolCallInfo[]>();
  for (const tool of finalTools) {
    const bucket = byName.get(tool.name) ?? [];
    bucket.push(tool);
    byName.set(tool.name, bucket);
  }

  return steps.map((step) => ({
    ...step,
    toolCalls: step.toolCalls.map((tool) => {
      const hydrated = (tool.toolUseId ? byId.get(tool.toolUseId) : undefined)
        ?? byName.get(tool.name)?.find((candidate) => candidate.result !== undefined || candidate.isError !== undefined);
      return hydrated ? { ...tool, ...hydrated } : tool;
    }),
  }));
}

interface DisplayMessage {
  message: ChatMessage;
  startedAt?: number;
}

function buildDisplayMessages(messages: ChatMessage[]): DisplayMessage[] {
  const out: DisplayMessage[] = [];
  let assistantGroup: ChatMessage[] = [];
  let lastUserTimestamp: number | undefined;

  const flushAssistantGroup = () => {
    if (assistantGroup.length === 0) return;
    out.push({
      message: combineAssistantMessages(assistantGroup),
      startedAt: lastUserTimestamp,
    });
    assistantGroup = [];
  };

  for (const message of messages) {
    if (message.role === 'user') {
      flushAssistantGroup();
      out.push({ message });
      lastUserTimestamp = message.timestamp;
    } else {
      assistantGroup.push(message);
    }
  }
  flushAssistantGroup();
  return out;
}

function combineAssistantMessages(group: ChatMessage[]): ChatMessage {
  if (group.length === 1) {
    const only = group[0]!;
    if (only.timeline?.length || only.steps?.length || only.events?.length) return only;
    const fallbackTimeline = assistantMessageActivityItems(only, false);
    return fallbackTimeline.length > 0 ? { ...only, timeline: fallbackTimeline } : only;
  }
  const last = group[group.length - 1]!;
  const timeline: ChatTimelineItem[] = [];
  const steps: ChatStep[] = [];
  const events: ChatTimelineEvent[] = [];
  const toolCalls: ToolCallInfo[] = [];
  const inferences: InferenceInfo[] = [];
  const thinking: string[] = [];

  for (const message of group) {
    const includeMessageTextInTimeline = message.id !== last.id;
    timeline.push(...assistantMessageActivityItems(message, includeMessageTextInTimeline));

    if (message.steps?.length) steps.push(...message.steps);
    if (message.events?.length) events.push(...message.events);
    if (message.toolCalls?.length) toolCalls.push(...message.toolCalls);
    if (message.inferences?.length) inferences.push(...message.inferences);
    if (message.thinking) thinking.push(message.thinking);
  }

  return {
    ...last,
    id: `assistant-group-${group[0]!.id}-${last.id}`,
    timestamp: last.timestamp,
    content: last.content,
    timeline: timeline.length > 0 ? timeline : undefined,
    steps: steps.length > 0 ? steps : undefined,
    events: events.length > 0 ? events : undefined,
    toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
    inferences: inferences.length > 0 ? inferences : last.inferences,
    thinking: thinking.length > 0 ? thinking.join('\n\n') : last.thinking,
  };
}

function assistantMessageActivityItems(message: ChatMessage, includeText: boolean): ChatTimelineItem[] {
  if (message.timeline?.length) {
    return includeText
      ? message.timeline
      : message.timeline.map((item) =>
        item.type === 'step'
          ? { type: 'step' as const, step: { ...item.step, text: undefined } }
          : item,
      );
  }

  if (message.steps?.length) {
    return message.steps.map((step) => ({
      type: 'step' as const,
      step: includeText ? step : { ...step, text: undefined },
    }));
  }

  const items: ChatTimelineItem[] = [];
  if (message.events?.length) {
    items.push(...message.events.map((event) => ({ type: 'event' as const, event })));
  }

  const text = includeText && message.content && message.content !== '(image)' ? message.content : undefined;
  if (message.thinking || message.toolCalls?.length || text) {
    items.push({
      type: 'step',
      step: {
        id: `message-step-${message.id}`,
        thinking: message.thinking,
        text,
        toolCalls: message.toolCalls ?? [],
        status: 'completed',
      },
    });
  }

  return items;
}

function buildFinalTimeline(order: StreamingTimelineItem[], steps: ChatStep[]): ChatTimelineItem[] {
  if (order.length === 0) return steps.map((step) => ({ type: 'step', step }));

  const stepById = new Map(steps.map((step) => [step.id, step]));
  const emittedSteps = new Set<string>();
  const out: ChatTimelineItem[] = [];

  for (const item of order) {
    if (item.type === 'event') {
      out.push({ type: 'event', event: item.event });
      continue;
    }
    const step = stepById.get(item.stepId);
    if (!step || emittedSteps.has(step.id)) continue;
    out.push({ type: 'step', step });
    emittedSteps.add(step.id);
  }

  for (const step of steps) {
    if (!emittedSteps.has(step.id)) out.push({ type: 'step', step });
  }

  return out;
}

function lastPathPart(path: string): string {
  const clean = path.replace(/\/+$/, '');
  return clean.split('/').pop() || clean;
}

function genId(size = 12): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let id = '';
  const bytes = crypto.getRandomValues(new Uint8Array(size));
  for (const byte of bytes) id += chars[byte % chars.length];
  return id;
}
