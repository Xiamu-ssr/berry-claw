import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { cn } from './utils/cn';
import { Loader2, PanelLeftOpen } from 'lucide-react';
import { useA8sChat } from './hooks/useA8sChat';
import ToastContainer, { useToast } from './components/Toast';
import type { SessionListItem } from './components/workspace/types';
import { useProjectSummaries } from './projects/summary';
import type { ContentBlock, WsIncoming } from '@berry-agent/claw-contracts';
import {
  fetchSessions as fetchSessionsFromA8s,
  fetchSessionMessages as fetchSessionMessagesFromA8s,
  fetchContextSize as fetchContextSizeFromA8s,
  fetchSessionTodos as fetchSessionTodosFromA8s,
  createSession as createSessionOnA8s,
  resumeSession as resumeSessionOnA8s,
} from './a8s/data';
import { useActiveInstance } from './connection';
import { factStore } from './facts/store';
import { useAgentFacts, useFactHydration, useTeamFacts } from './facts/useFacts';
import { useModelControls } from './hooks/useModelControls';
import { SafetyAskDialog, type PendingSafetyAsk } from './components/SafetyAskDialog';
import { useAgentRuntimes, type AgentRuntimeHandlers } from './chat/useAgentRuntimes';
import { selectStreamingTimeline, type AgentRuntime } from './chat/runtime';
import { ClientSidebar, MobileTopNav } from './components/app/AppNavigation';
import type { ClientView } from './components/app/types';
import InboxView from './components/inbox/InboxView';
import { genId } from './utils/format';

const SettingsPage = lazy(() => import('./components/SettingsPage'));
const AgentsPage = lazy(() => import('./components/AgentsPage'));
const ProjectsPage = lazy(() => import('./components/ProjectsPage'));
const TeamsPage = lazy(() => import('./components/TeamsPage'));
const SkillMarketPage = lazy(() => import('./components/SkillMarketPage'));
const McpPage = lazy(() => import('./components/McpPage'));
const AuditPage = lazy(() => import('./components/AuditPage'));
export default function App() {
  const [activeView, setActiveView] = useState<ClientView>(() => {
    return (localStorage.getItem('berry-active-view') as ClientView) || 'inbox';
  });
  const [sessions, setSessions] = useState<SessionListItem[]>([]);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [sidebarHidden, setSidebarHidden] = useState(false);
  const [pendingSafetyAsks, setPendingSafetyAsks] = useState<PendingSafetyAsk[]>([]);

  const activeInstance = useActiveInstance();
  const agentFacts = useAgentFacts();
  const teamFacts = useTeamFacts();
  // Default to the first agent; selection is frontend-owned (the backend BFF
  // no longer tracks an "active" agent). `selectedAgentId` is the real source
  // of truth for which agent the user is viewing.
  const activeAgent = agentFacts[0];
  const [selectedAgentId, setSelectedAgentId] = useState<string | undefined>(activeAgent?.id);
  const selectedAgentIdRef = useRef<string | undefined>(selectedAgentId);
  selectedAgentIdRef.current = selectedAgentId;
  const selectedAgent = agentFacts.find((a) => a.id === selectedAgentId) ?? activeAgent;

  const toast = useToast();
  const toastRef = useRef(toast);
  toastRef.current = toast;

  const {
    modelOptions,
    modelCatalog,
    refreshModelOptions,
    handleModelChange,
    handleReasoningEffortChange,
  } = useModelControls(selectedAgentIdRef, toastRef, {
    id: activeInstance?.id,
    apiBase: activeInstance?.apiBase,
  });

  useFactHydration();

  // ---- per-agent chat runtime --------------------------------------------
  // The runtime map is the single source of truth for chat streaming state.
  // Effects produced by the reducer (toasts, REST refreshes, fact_changed)
  // are routed through `runtimeHandlers.onEffect` so React-side concerns
  // stay outside the pure reducer.
  const fetchAgentSessionsRef = useRef<(agentId?: string, preferredSessionId?: string) => Promise<void>>(async () => {});
  const fetchAgentContextSizeRef = useRef<(agentId?: string, sessionId?: string) => Promise<void>>(async () => {});
  const runtimeHandlers = useMemo<AgentRuntimeHandlers>(() => ({
    onEffect: (agentId, effect) => {
      switch (effect.type) {
        case 'toast': {
          const payload = effect.payload as { kind: string; frame: any };
          if (payload.kind === 'retry') {
            const f = payload.frame;
            const reasonLabel = f.reason === 'stream_idle_timeout' ? '模型首次响应超时' : '临时网络错误';
            const delaySeconds = Math.max(1, Math.round(f.delayMs / 1000));
            toastRef.current.show({
              id: 'provider-retry',
              variant: 'warn',
              title: `${reasonLabel}, ${delaySeconds}s 后重试 (${f.attempt}/${f.maxAttempts})`,
              message: f.errorMessage || '准备重试...',
              durationMs: Math.max(4000, f.delayMs + 2000),
            });
          } else if (payload.kind === 'compaction') {
            const f = payload.frame;
            toastRef.current.show({
              variant: 'info',
              title: f.triggerReason === 'soft_threshold' ? 'Context optimized' : 'Context compressed',
              message: `Freed ${f.tokensFreed?.toLocaleString() ?? 0} tokens`,
              durationMs: 4000,
            });
          } else if (payload.kind === 'error') {
            const f = payload.frame;
            toastRef.current.show({
              variant: 'error',
              title: '推理失败',
              message: f.message,
              durationMs: 8000,
            });
          }
          break;
        }
        case 'refresh-sessions': {
          const sessionId = (effect.payload as { sessionId?: string } | undefined)?.sessionId;
          void fetchAgentSessionsRef.current(agentId, sessionId);
          break;
        }
        case 'refresh-context': {
          const sessionId = (effect.payload as { sessionId?: string } | undefined)?.sessionId;
          void fetchAgentContextSizeRef.current(agentId, sessionId);
          break;
        }
        case 'fact-changed':
          factStore.apply(effect.payload as any);
          break;
        case 'safety-ask': {
          const f = effect.payload as { id: string; question: any };
          setPendingSafetyAsks((prev) => (
            prev.some((ask) => ask.id === f.id) ? prev : [...prev, { id: f.id, question: f.question }]
          ));
          break;
        }
        case 'safety-ask-resolved': {
          const f = effect.payload as { id: string };
          setPendingSafetyAsks((prev) => prev.filter((a) => a.id !== f.id));
          break;
        }
        case 'agent-paused': {
          const f = effect.payload as { paused: boolean; reason?: string; agentId: string; sessionId?: string };
          toastRef.current.show({
            variant: f.paused ? 'info' : 'warn',
            title: f.paused ? '已暂停当前执行' : '没有正在执行的任务',
            message: f.reason ?? '',
            durationMs: 3500,
          });
          break;
        }
        default:
          break;
      }
    },
  }), []);

  const {
    runtimes,
    getRuntime,
    dispatch: dispatchFrame,
    appendOptimisticUserMessage,
    setActiveSession: setRuntimeActiveSession,
    setContext: setRuntimeContext,
    setTodos: setRuntimeTodos,
    setCreatingSession: setRuntimeCreatingSession,
    resetForAgentSwitch,
  } = useAgentRuntimes(runtimeHandlers);

  // Single, derived view onto the currently-selected agent's runtime.
  const currentRuntime: AgentRuntime = useMemo(
    () => (selectedAgentId ? getRuntime(selectedAgentId) : getRuntime('__none__')),
    [getRuntime, selectedAgentId, runtimes],
  );
  const messages = currentRuntime.messages;
  const activeSessionId = currentRuntime.activeSessionId;
  const isLoading = currentRuntime.isStreaming;
  const creatingSession = currentRuntime.creatingSession;
  const contextTokensUsed = currentRuntime.context.tokensUsed;
  const contextWindow = currentRuntime.context.window;
  const todosBySession = currentRuntime.todosBySession;
  const streamingSelection = useMemo(
    () => selectStreamingTimeline(currentRuntime),
    [currentRuntime],
  );
  const streamingSteps = streamingSelection.steps;
  const streamingEvents = streamingSelection.events;
  const streamingTimeline = streamingSelection.timeline;
  const streamingInferences = streamingSelection.inferences;

  useEffect(() => {
    if (!agentFacts.length) {
      if (selectedAgentId) setSelectedAgentId(undefined);
      return;
    }
    if (!selectedAgentId || !agentFacts.some((a) => a.id === selectedAgentId)) {
      setSelectedAgentId(activeAgent?.id ?? agentFacts[0]?.id);
    }
  }, [activeAgent?.id, agentFacts, selectedAgentId]);

  // -------------------- REST refresh helpers ------------------------------
  // Each helper writes back into the per-agent runtime so the UI is a pure
  // projection of (selectedAgentId -> runtime). We deliberately do NOT keep
  // a parallel global slice of context tokens / messages.

  const fetchAgentSessions = useCallback(async (agentId?: string, preferredSessionId?: string) => {
    if (!agentId) return;
    try {
      const list = await fetchSessionsFromA8s(agentId);
      const next = list.map((s) => ({
        id: s.id,
        title: s.title,
        updatedAt: s.updatedAt,
        messageCount: s.messageCount,
        status: s.status,
      }));
      // Sessions list is a global UI affordance for the active tab; keep one
      // copy. (When we move to a multi-agent split layout this becomes a Map.)
      setSessions(next);
      if (list.length === 0) {
        setRuntimeActiveSession(agentId, undefined, []);
        return;
      }
      const currentSessionId = getRuntime(agentId).activeSessionId;
      const targetSessionId = preferredSessionId ?? currentSessionId;
      const stillActive = targetSessionId && list.some((s) => s.id === targetSessionId);
      const session = stillActive ? list.find((s) => s.id === targetSessionId)! : list[0];
      const messages = await fetchSessionMessagesFromA8s(agentId, session.id);
      setRuntimeActiveSession(agentId, session.id, messages);
    } catch {
      // The connection gate and toast layer surface auth / network failures.
    }
  }, [getRuntime, setRuntimeActiveSession]);

  const fetchAgentContextSize = useCallback(async (agentId?: string, sessionId?: string) => {
    if (!agentId) return;
    try {
      const ctx = await fetchContextSizeFromA8s(agentId, sessionId);
      if (ctx) setRuntimeContext(agentId, ctx.current, ctx.window);
    } catch {
      // Best-effort dashboard data.
    }
  }, [setRuntimeContext]);

  // Stable refs so the runtime effect channel can call into the latest
  // refresh helpers without re-creating the effect handler on every render.
  fetchAgentSessionsRef.current = fetchAgentSessions;
  fetchAgentContextSizeRef.current = fetchAgentContextSize;

  const fetchSessionTodos = useCallback(async (sessionId?: string, agentId?: string) => {
    if (!sessionId || !agentId) return;
    try {
      const todos = await fetchSessionTodosFromA8s(agentId, sessionId);
      setRuntimeTodos(agentId, sessionId, todos);
    } catch {
      // Best-effort side panel data.
    }
  }, [setRuntimeTodos]);

  useEffect(() => {
    void fetchAgentSessions(selectedAgent?.id);
  }, [selectedAgent?.id, fetchAgentSessions]);

  useEffect(() => {
    void fetchAgentContextSize(selectedAgent?.id, activeSessionId);
  }, [activeSessionId, fetchAgentContextSize, selectedAgent?.id]);

  useEffect(() => {
    const handler = () => {
      void refreshModelOptions();
      void fetchAgentContextSize(selectedAgentIdRef.current, activeSessionId);
    };
    window.addEventListener('berry-claw:models-changed', handler);
    window.addEventListener('focus', handler);
    return () => {
      window.removeEventListener('berry-claw:models-changed', handler);
      window.removeEventListener('focus', handler);
    };
  }, [activeSessionId, fetchAgentContextSize, refreshModelOptions]);

  useEffect(() => {
    void fetchSessionTodos(activeSessionId, selectedAgent?.id);
  }, [activeSessionId, selectedAgent?.id, fetchSessionTodos]);

  const handleWsMessage = useCallback((msg: WsIncoming) => {
    dispatchFrame(msg);
  }, [dispatchFrame]);

  const { send, connected } = useA8sChat(handleWsMessage);

  const fetchPendingSafetyAsks = useCallback(async () => {
    // Human-in-the-loop approval was a console-backend broadcast flow. Under
    // direct-connect there is no a8s endpoint for pending asks yet, so this is
    // a no-op; live asks (when supported) will arrive as stream frames.
    // TODO(B1-e): wire approvals through a8s once it exposes them.
  }, []);

  useEffect(() => {
    if (!connected) return;
    void fetchPendingSafetyAsks();
  }, [connected, fetchPendingSafetyAsks]);

  const handleSwitchAgent = useCallback((agentId: string) => {
    if (agentId === selectedAgentIdRef.current) return;
    setSelectedAgentId(agentId);
    factStore.setSelectedAgent(agentId);
    resetForAgentSwitch(agentId);
    // Selection is frontend-owned now — no backend round-trip to "activate".
    void fetchAgentContextSize(agentId);
    void fetchAgentSessions(agentId);
  }, [fetchAgentContextSize, fetchAgentSessions, resetForAgentSwitch]);

  useEffect(() => {
    const handleSwitchTab = (event: Event) => {
      const detail = (event as CustomEvent<string>).detail;
      const next = detail === 'chat' ? 'inbox' : detail;
      if (next && ['inbox', 'projects', 'team', 'agents', 'audit', 'settings', 'skills', 'mcp'].includes(next)) {
        setActiveView(next as ClientView);
        localStorage.setItem('berry-active-view', next);
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
      ? prompt.filter((b): b is ContentBlock =>
        b.type === 'text' || b.type === 'image' || b.type === 'annotation',
      )
      : undefined;
    const requestId = `req_${genId()}`;
    const agentId = selectedAgentIdRef.current;
    if (!agentId) return;
    appendOptimisticUserMessage(agentId, {
      id: genId(),
      role: 'user',
      content: textPreview,
      timestamp: Date.now(),
      status: 'pending',
      delivery: 'turn',
      requestId,
      blocks,
    });
    send({ type: 'chat', prompt, sessionId: getRuntime(agentId).activeSessionId, requestId, agentId });
  }, [appendOptimisticUserMessage, getRuntime, send]);

  const handleInterject = useCallback((text: string) => {
    if (!text.trim()) return;
    send({ type: 'interject', text });
  }, [send]);

  const handlePauseAgent = useCallback(() => {
    send({
      type: 'pause_agent',
      agentId: selectedAgentIdRef.current,
      sessionId: activeSessionId,
      reason: 'paused from client',
    });
  }, [activeSessionId, send]);

  const handleNewSession = useCallback(async () => {
    if (isLoading || creatingSession) return;
    const agentId = selectedAgentIdRef.current;
    if (!agentId) return;
    setRuntimeCreatingSession(agentId, true);
    setRuntimeContext(agentId, 0, contextWindow);
    try {
      const state = await createSessionOnA8s(agentId);
      setRuntimeActiveSession(agentId, state.id, state.messages);
      await fetchAgentSessions(agentId, state.id);
      void fetchAgentContextSize(agentId, state.id);
    } catch (err) {
      toastRef.current.show({
        variant: 'error',
        title: '新建会话失败',
        message: err instanceof Error ? err.message : String(err),
        durationMs: 5000,
      });
    } finally {
      setRuntimeCreatingSession(agentId, false);
    }
  }, [
    contextWindow,
    creatingSession,
    fetchAgentContextSize,
    fetchAgentSessions,
    isLoading,
    setRuntimeActiveSession,
    setRuntimeContext,
    setRuntimeCreatingSession,
  ]);

  const handleResumeSession = useCallback(async (sessionId: string) => {
    const agentId = selectedAgentIdRef.current;
    if (!agentId) return;
    setRuntimeContext(agentId, 0, contextWindow);
    try {
      const state = await resumeSessionOnA8s(agentId, sessionId);
      setRuntimeActiveSession(agentId, state.id, state.messages);
      void fetchAgentSessions(agentId, state.id);
      void fetchAgentContextSize(agentId, state.id);
    } catch (err) {
      toastRef.current.show({
        variant: 'error',
        title: '恢复会话失败',
        message: err instanceof Error ? err.message : String(err),
        durationMs: 5000,
      });
    }
  }, [
    contextWindow,
    fetchAgentContextSize,
    fetchAgentSessions,
    setRuntimeActiveSession,
    setRuntimeContext,
  ]);

  const projectSummaries = useProjectSummaries(agentFacts, teamFacts);

  return (
    <div className="h-screen bg-[var(--theme-bg)] text-zinc-200 overflow-hidden relative font-sans selection:bg-[var(--theme-primary-glow)]">
      {/* Subtle background glow */}
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[800px] h-[300px] bg-[var(--theme-primary)] opacity-5 blur-[120px] rounded-full pointer-events-none" />

      <ToastContainer />
      <SafetyAskDialog
        ask={pendingSafetyAsks[0] ?? null}
        onResolved={(id) => setPendingSafetyAsks((prev) => prev.filter((a) => a.id !== id))}
      />

      <div
        className={cn(
          "grid h-full min-h-0 overflow-hidden grid-cols-[var(--app-shell-columns)] max-md:grid-cols-1 transition-all duration-300 ease-[cubic-bezier(0.16,1,0.3,1)]"
        )}
        style={{
          '--app-shell-columns': sidebarHidden
            ? 'minmax(0, 1fr)'
            : sidebarCollapsed
            ? '72px minmax(0, 1fr)'
            : 'min(30vw, 320px) minmax(0, 1fr)',
        } as React.CSSProperties}
      >
        {!sidebarHidden && (
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
            onHideSidebar={() => setSidebarHidden(true)}
          />
        )}

        <main className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden bg-white/[0.02] border-l border-white/[0.04] backdrop-blur-3xl shadow-[-8px_0_24px_-8px_rgba(0,0,0,0.4)] relative z-10">
          {sidebarHidden && (
            <button
              type="button"
              onClick={() => {
                setSidebarHidden(false);
                setSidebarCollapsed(false);
              }}
              title="展开侧边栏"
              aria-label="展开侧边栏"
              className="absolute left-3 top-3 z-50 hidden h-9 w-9 items-center justify-center rounded-xl border border-white/[0.08] bg-[#17191c]/90 text-zinc-300 shadow-lg backdrop-blur-xl transition-colors hover:bg-white/[0.08] hover:text-white md:inline-flex"
            >
              <PanelLeftOpen size={16} />
            </button>
          )}
          <MobileTopNav
            activeView={activeView}
            onViewChange={setActiveView}
            activeInstanceName={activeInstance?.name}
            connected={connected}
          />

          {!connected && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              className="border-b border-amber-500/20 bg-amber-500/10 px-4 py-2 text-xs text-amber-200 flex items-center justify-center gap-2"
            >
              <Loader2 size={12} className="animate-spin" />
              后端实例未连接，正在重连...
            </motion.div>
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
              onPause={handlePauseAgent}
              onNewSession={handleNewSession}
              onResumeSession={handleResumeSession}
              onSwitchAgent={handleSwitchAgent}
              onReasoningEffortChange={handleReasoningEffortChange}
              modelOptions={modelOptions}
              modelCatalog={modelCatalog}
              onModelChange={handleModelChange}
            />
          )}

          <Suspense fallback={<PageFallback />}>
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
          </Suspense>
        </main>
      </div>
    </div>
  );
}

function PageFallback() {
  return (
    <div className="flex h-full min-h-0 items-center justify-center text-sm text-zinc-500">
      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
      Loading
    </div>
  );
}
