import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type * as React from 'react';
import {
  Bot,
  FolderKanban,
  Loader2,
} from 'lucide-react';
import type {
  AgentFact,
  ChatMessage,
  ChatStep,
  ChatTimelineEvent,
  ContentBlock,
  InferenceInfo,
  TodoItem,
} from '@berry-agent/claw-contracts';
import { cn } from '../../utils/cn';
import {
  buildDisplayMessages,
  buildFinalTimeline,
  type StreamingTimelineItem,
} from '../../chat/display';
import ChatInput, { type ReasoningEffort } from '../ChatInput';
import MessageBubble, { TimelineItemList } from '../MessageBubble';
import type {
  AnnotationAttachment,
  SessionListItem,
  WorkspaceRailTab,
} from '../workspace/types';
import AgentSwitcher from './AgentSwitcher';
import ContextProgressBar from './ContextProgressBar';
import EmptyInbox from './EmptyInbox';
import InferenceDetails from './InferenceDetails';
import SessionSwitcher from './SessionSwitcher';

const WorkspaceRail = lazy(() => import('../WorkspaceRail'));

const RIGHT_RAIL_DEFAULT_WIDTH = 440;
const RIGHT_RAIL_MIN_WIDTH = 360;
const RIGHT_RAIL_MAX_RATIO = 0.85;

interface InboxViewProps {
  messages: ChatMessage[];
  streamingSteps: ChatStep[];
  streamingEvents: ChatTimelineEvent[];
  streamingTimeline: StreamingTimelineItem[];
  isLoading: boolean;
  selectedAgent?: AgentFact;
  agents: AgentFact[];
  activeSessionId?: string;
  contextTokensUsed: number;
  contextWindow: number | null;
  streamingInferences: InferenceInfo[];
  sessions: SessionListItem[];
  todos: TodoItem[];
  newSessionDisabled: boolean;
  onSend: (prompt: string | ContentBlock[]) => void;
  onInterject: (text: string) => void;
  onPause: () => void;
  onNewSession: () => void;
  onResumeSession: (sessionId: string) => void;
  onSwitchAgent: (agentId: string) => void;
  onReasoningEffortChange: (effort: ReasoningEffort) => void;
  modelOptions: string[];
  onModelChange: (model: string) => void;
}

export default function InboxView({
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
  onPause,
  onNewSession,
  onResumeSession,
  onSwitchAgent,
  onReasoningEffortChange,
  modelOptions,
  onModelChange,
}: InboxViewProps) {
  const contentGridRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const [stickToBottom, setStickToBottom] = useState(true);
  const [rightPanelOpen, setRightPanelOpen] = useState(false);
  const [rightPanelWidth, setRightPanelWidth] = useState(RIGHT_RAIL_DEFAULT_WIDTH);
  const [rightPanelTab, setRightPanelTab] = useState<WorkspaceRailTab>('browser');
  const [incomingAnnotation, setIncomingAnnotation] = useState<AnnotationAttachment | undefined>();
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

  const getRightPanelMaxWidth = useCallback(() => {
    const containerWidth = contentGridRef.current?.clientWidth ?? window.innerWidth;
    return Math.max(RIGHT_RAIL_MIN_WIDTH, Math.floor(containerWidth * RIGHT_RAIL_MAX_RATIO));
  }, []);

  useEffect(() => {
    if (!rightPanelOpen) return;
    const clampWidth = () => {
      const maxWidth = getRightPanelMaxWidth();
      setRightPanelWidth((width) => Math.min(maxWidth, Math.max(RIGHT_RAIL_MIN_WIDTH, width)));
    };
    clampWidth();
    window.addEventListener('resize', clampWidth);
    return () => window.removeEventListener('resize', clampWidth);
  }, [getRightPanelMaxWidth, rightPanelOpen]);

  const handleRightPanelResizeStart = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = rightPanelWidth;
    const previousCursor = document.body.style.cursor;
    const previousUserSelect = document.body.style.userSelect;

    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';

    const handleMove = (moveEvent: PointerEvent) => {
      const nextWidth = startWidth + startX - moveEvent.clientX;
      setRightPanelWidth(Math.min(getRightPanelMaxWidth(), Math.max(RIGHT_RAIL_MIN_WIDTH, nextWidth)));
    };

    const handleUp = () => {
      document.body.style.cursor = previousCursor;
      document.body.style.userSelect = previousUserSelect;
      window.removeEventListener('pointermove', handleMove);
      window.removeEventListener('pointerup', handleUp);
    };

    window.addEventListener('pointermove', handleMove);
    window.addEventListener('pointerup', handleUp);
  }, [getRightPanelMaxWidth, rightPanelWidth]);

  return (
    <div className="relative flex h-full flex-col bg-[#111315]/80 backdrop-blur-[64px]">
      <div className="flex h-16 items-center justify-between gap-6 border-b border-white/[0.04] px-6">
        <div className="min-w-0 max-w-sm flex-1">
          <AgentSwitcher
            agents={agents}
            selectedAgent={selectedAgent}
            onSwitchAgent={onSwitchAgent}
          />
        </div>

        <div className="hidden flex-1 shrink-0 justify-center md:flex">
          <ContextProgressBar used={contextTokensUsed} contextWindow={contextWindow} />
        </div>

        <div className="flex min-w-0 flex-1 items-center justify-end gap-3">
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
            className={cn(
              'inline-flex h-9 w-9 items-center justify-center rounded-xl transition-all duration-200',
              rightPanelOpen
                ? 'bg-[var(--theme-primary-soft)] text-[var(--theme-primary)]'
                : 'text-zinc-400 hover:bg-white/[0.04] hover:text-zinc-200',
            )}
          >
            <FolderKanban size={16} />
          </button>
        </div>
      </div>

      <div
        ref={contentGridRef}
        className={cn(
          'grid min-h-0 flex-1 transition-all duration-300 ease-[cubic-bezier(0.16,1,0.3,1)]',
          rightPanelOpen ? 'grid-cols-[var(--right-rail-columns)]' : 'grid-cols-1',
        )}
        style={rightPanelOpen ? ({
          '--right-rail-columns': `minmax(0, 1fr) minmax(${RIGHT_RAIL_MIN_WIDTH}px, min(${rightPanelWidth}px, ${RIGHT_RAIL_MAX_RATIO * 100}%))`,
        } as React.CSSProperties) : undefined}
      >
        <div
          ref={scrollContainerRef}
          onScroll={handleScroll}
          className="min-h-0 overflow-y-auto px-6 py-6 hide-scrollbar scroll-smooth"
        >
          {messages.length === 0 && !hasStreamingContent && !isLoading ? (
            <EmptyInbox agent={selectedAgent} />
          ) : (
            <div className="mx-auto max-w-4xl pb-40">
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
                    <div className="mb-2 flex items-center gap-2">
                      <div className="flex h-5 w-5 items-center justify-center rounded-full bg-gradient-to-tr from-[var(--theme-primary)] to-white/50 shadow-[0_0_10px_var(--theme-primary-glow)]">
                        <Bot size={10} className="text-[#0a0a0a]" />
                      </div>
                      <span className="text-[11px] font-semibold uppercase tracking-widest text-zinc-300">Berry Claw</span>
                      {hasStreamingContent && (
                        <span className="flex h-1.5 w-1.5 animate-pulse rounded-full bg-[var(--theme-primary)]" />
                      )}
                    </div>
                    {hasStreamingContent ? (
                      <TimelineItemList items={streamingTimelineItems} turnSettled={false} />
                    ) : (
                      <div className="inline-flex rounded-xl border border-white/[0.06] bg-white/[0.04] px-4 py-3">
                        <Loader2 size={16} className="animate-spin text-sky-400" />
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
          <Suspense fallback={<div className="min-h-0 border-l border-white/[0.04] bg-[#111315]/50 max-lg:hidden" />}>
            <WorkspaceRail
              activeTab={rightPanelTab}
              onTabChange={setRightPanelTab}
              agentId={selectedAgent?.id}
              sessions={sessions}
              todos={todos}
              activeSessionId={activeSessionId}
              newSessionDisabled={newSessionDisabled}
              onResumeSession={onResumeSession}
              onNewSession={onNewSession}
              onResizeStart={handleRightPanelResizeStart}
              onAnnotationCreated={(block) => {
                setIncomingAnnotation({
                  id: `ann_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
                  block,
                });
              }}
            />
          </Suspense>
        )}
      </div>

      <div className="pointer-events-none absolute bottom-6 left-1/2 z-40 w-full max-w-3xl -translate-x-1/2 px-6">
        <div className="pointer-events-auto">
          <ChatInput
            onSend={onSend}
            onInterject={onInterject}
            onPause={onPause}
            isLoading={isLoading}
            agentName={selectedAgent?.name}
            contextWindow={contextWindow}
            model={selectedAgent?.model}
            modelOptions={modelOptions}
            onModelChange={onModelChange}
            reasoningEffort={undefined}
            onReasoningEffortChange={onReasoningEffortChange}
            incomingAnnotation={incomingAnnotation}
          />
        </div>
      </div>
    </div>
  );
}
