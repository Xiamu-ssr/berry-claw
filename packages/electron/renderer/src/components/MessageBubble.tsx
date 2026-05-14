import { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { AlertTriangle, Brain, CheckCircle, ChevronDown, ChevronRight, CircleDot, Layers, Loader2, Network, ShieldCheck, Wrench } from 'lucide-react';
import CodeBlock from './CodeBlock';
import ToolCallCard from './ToolCallCard';
import type { ChatMessage, ChatStep, ChatTimelineEvent, ChatTimelineItem, InferenceInfo, ToolCallInfo } from '@berry-agent/claw-contracts';

interface MessageBubbleProps {
  message: ChatMessage;
  startedAt?: number;
}

/**
 * Render one chat message.
 *
 * Assistant messages may carry a `steps` array — one entry per LLM inference
 * inside the turn. When present, we render steps top-to-bottom so the user
 * sees the model's own order: thinking → text → tool calls → (next
 * inference) … Each step is a visually self-contained card so a turn with
 * multiple inferences reads as a short conversation within the assistant's
 * reply, not one flattened blob.
 *
 * When `steps` is missing, session history is rendered from its flattened
 * message-level fields: collapsed thinking, then all tool calls, then the
 * final text bubble.
 */
export default function MessageBubble({ message, startedAt }: MessageBubbleProps) {
  const isUser = message.role === 'user';
  const isInterject = message.delivery === 'interject';
  const statusLabel =
    message.status === 'pending' ? 'sending' :
    message.status === 'queued' ? 'queued' :
    message.status === 'failed' ? 'failed' :
    undefined;

  const hasStructuredTimeline = !isUser && message.timeline && message.timeline.length > 0;
  const hasSteps = !isUser && !hasStructuredTimeline && message.steps && message.steps.length > 0;
  const assistantContent = !isUser ? assistantContentForMessage(message) : '';
  const hasAssistantActivity = !isUser && hasActivity({
    items: message.timeline,
    steps: message.steps,
    events: message.events,
    toolCalls: message.toolCalls,
    thinking: message.thinking,
  });

  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'} mb-4`}>
      <div className={`${isUser ? 'max-w-[75%]' : 'w-full max-w-none'} order-1`}>
        {!isUser && hasAssistantActivity && (
          <TurnActivitySummary
            items={message.timeline}
            steps={message.steps}
            events={message.events}
            toolCalls={message.toolCalls}
            thinking={message.thinking}
            startedAt={startedAt ?? message.timestamp}
            endedAt={message.timestamp}
            turnSettled={message.status !== 'streaming' && message.status !== 'pending'}
          />
        )}

        {/* Main bubble: user messages always, assistant only when we don't
            have steps (otherwise the final step card owns the text). */}
        {(isUser || assistantContent) && (
          <div
            className={`${
              isUser
                ? isInterject
                  ? 'rounded-2xl border border-amber-500/20 bg-amber-500/10 px-4 py-3 text-amber-100'
                  : message.status === 'failed'
                    ? 'rounded-2xl bg-red-500 px-4 py-3 text-white'
                    : 'rounded-2xl bg-[#2f2f2f] px-4 py-3 text-zinc-50'
                : 'px-1 py-1 text-zinc-100'
            } ${message.status === 'pending' ? 'opacity-80' : ''}`}
          >
            {isUser ? (
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
                  <p className="text-sm whitespace-pre-wrap">{message.content}</p>
                )}
              </div>
            ) : (
              <AssistantMarkdown content={assistantContent} />
            )}
          </div>
        )}

        {/* Timestamp for user */}
        {isUser && (
          <div className="text-xs text-gray-400 mt-1 text-right mr-1">
            YOU · {new Date(message.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            {statusLabel && ` · ${statusLabel}`}
          </div>
        )}

        {/* Usage badge */}
        {!isUser && message.usage && (
          <div className="text-xs text-gray-400 mt-1 ml-1">
            {message.usage.inputTokens}↓ {message.usage.outputTokens}↑
          </div>
        )}

        {/* Per-inference token / cost details — derived from steps when we
            have them (truer per-inference picture), else from message-level
            inferences. */}
        {!isUser && (hasSteps || (message.inferences && message.inferences.length > 0)) && (
          <InferenceDetails
            inferences={hasSteps
              ? message.steps!.map(s => s.inference).filter((i): i is InferenceInfo => !!i)
              : (message.inferences ?? [])}
            totalUsage={message.usage}
          />
        )}
      </div>
    </div>
  );
}

/**
 * One LLM inference's card: thinking (collapsible) → text → tool calls.
 * Each tool call card is itself collapsible with Input / Output sections.
 */
export function TimelineItemList({ items, turnSettled = true }: { items: ChatTimelineItem[]; turnSettled?: boolean }) {
  if (items.length === 0) return null;
  const liveText = items
    .filter((item): item is Extract<ChatTimelineItem, { type: 'step' }> => item.type === 'step')
    .map((item) => item.step.text)
    .filter((text): text is string => !!text?.trim())
    .join('\n\n');
  return (
    <div className="space-y-3">
      <TurnActivitySummary items={items} turnSettled={turnSettled} includeStepTextInDetails={false} />
      {liveText && (
        <div className="px-1 py-1 text-zinc-100">
          <AssistantMarkdown content={liveText} />
        </div>
      )}
    </div>
  );
}

export function StepCard({ step, turnSettled = true }: { step: ChatStep; turnSettled?: boolean }) {
  const hasText = !!step.text;
  const hasTools = step.toolCalls.length > 0;
  const hasThinking = !!step.thinking;

  // If the step has only tool calls (no text / thinking), skip the outer
  // wrapper so the tool cards stand alone — avoids empty bubble noise.
  const onlyTools = hasTools && !hasText && !hasThinking;

  return (
    <div className={onlyTools ? '' : 'space-y-2'}>
      {hasThinking && <CompletedThinking text={step.thinking!} />}
      {hasTools && <ToolRunGroup tools={step.toolCalls} settled={turnSettled} />}
      {hasText && (
        <div className="px-1 py-1 text-zinc-100">
          <AssistantMarkdown content={step.text!} />
        </div>
      )}
    </div>
  );
}

export function TimelineEventList({ events }: { events: ChatTimelineEvent[] }) {
  if (events.length === 0) return null;
  return (
    <div className="mb-3 space-y-1.5 text-xs text-zinc-500">
      {events.map((event) => (
        <TimelineEventRow key={event.id} event={event} />
      ))}
    </div>
  );
}

function TurnActivitySummary({
  items,
  steps,
  events,
  toolCalls,
  thinking,
  startedAt,
  endedAt,
  turnSettled = true,
  includeStepTextInDetails = true,
}: {
  items?: ChatTimelineItem[];
  steps?: ChatStep[];
  events?: ChatTimelineEvent[];
  toolCalls?: ToolCallInfo[];
  thinking?: string;
  startedAt?: number;
  endedAt?: number;
  turnSettled?: boolean;
  includeStepTextInDetails?: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const activity = collectActivity({ items, steps, events, toolCalls, thinking, startedAt, endedAt });
  if (!activity.hasActivity) return null;

  const title = activity.pending && !turnSettled
    ? '正在处理'
    : `已处理 ${formatDuration(activity.startedAt, activity.endedAt)}`;
  const pieces = [title];
  if (activity.toolCalls.length > 0) pieces.push(`已运行 ${activity.toolCalls.length} 条命令`);
  const families = toolFamilies(activity.toolCalls);
  if (families.length > 0) pieces.push(`已使用 ${families.slice(0, 3).join('、')}`);
  if (activity.toolCalls.length === 0 && activity.events.length > 0) pieces.push(`${activity.events.length} 个事件`);
  if (activity.hasThinking && activity.toolCalls.length === 0) pieces.push('含思考');

  return (
    <div className="mb-2 overflow-hidden rounded-lg border border-white/[0.06] bg-white/[0.025]">
      <button
        type="button"
        onClick={() => setExpanded((value) => !value)}
        className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-zinc-500 transition-colors hover:bg-white/[0.035] hover:text-zinc-300"
      >
        <ChevronRight size={13} className={`shrink-0 transition-transform ${expanded ? 'rotate-90' : ''}`} />
        <span className="min-w-0 flex-1 truncate">{pieces.join(' · ')}</span>
        {activity.failed ? (
          <AlertTriangle size={13} className="shrink-0 text-red-400" />
        ) : activity.pending && !turnSettled ? (
          <Loader2 size={13} className="shrink-0 animate-spin text-zinc-500" />
        ) : (
          <CheckCircle size={13} className="shrink-0 text-zinc-500" />
        )}
      </button>
      {expanded && (
        <div className="space-y-2 border-t border-white/[0.06] p-2">
          {items && items.length > 0 ? (
            <ChronologicalActivityDetails
              items={items}
              turnSettled={turnSettled}
              includeStepText={includeStepTextInDetails}
            />
          ) : activity.steps.length > 0 ? (
            <>
              {activity.events.length > 0 && <TimelineEventList events={activity.events} />}
              {activity.steps.map((step, idx) => (
                <StepActivityDetails
                  key={step.id ?? idx}
                  step={step}
                  turnSettled={turnSettled}
                  includeText={includeStepTextInDetails}
                />
              ))}
            </>
          ) : (
            <>
              {thinking && <CompletedThinking text={thinking} />}
              {activity.toolCalls.length > 0 && (
                <ToolRunGroup tools={activity.toolCalls} settled={turnSettled} />
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

function ChronologicalActivityDetails({
  items,
  turnSettled,
  includeStepText,
}: {
  items: ChatTimelineItem[];
  turnSettled: boolean;
  includeStepText: boolean;
}) {
  return (
    <div className="space-y-2">
      {items.map((item, idx) => (
        item.type === 'event'
          ? <TimelineEventRow key={item.event.id} event={item.event} />
          : (
            <StepActivityDetails
              key={item.step.id ?? idx}
              step={item.step}
              turnSettled={turnSettled}
              includeText={includeStepText}
            />
          )
      ))}
    </div>
  );
}

function StepActivityDetails({
  step,
  turnSettled,
  includeText = true,
}: {
  step: ChatStep;
  turnSettled: boolean;
  includeText?: boolean;
}) {
  const hasThinking = !!step.thinking;
  const hasTools = step.toolCalls.length > 0;
  const hasText = includeText && !!step.text?.trim();
  if (!hasThinking && !hasTools && !step.inference && !hasText) return null;
  return (
    <div className="space-y-2">
      {hasThinking && <CompletedThinking text={step.thinking!} />}
      {hasTools && <ToolRunGroup tools={step.toolCalls} settled={turnSettled} />}
      {hasText && (
        <div className="px-1 py-1 text-zinc-100">
          <AssistantMarkdown content={step.text!} />
        </div>
      )}
      {step.inference && (
        <div className="px-1 text-[11px] font-mono text-zinc-600">
          {step.inference.model} · {step.inference.inputTokens}↓ {step.inference.outputTokens}↑ · {step.inference.stopReason}
        </div>
      )}
    </div>
  );
}

function assistantContentForMessage(message: ChatMessage): string {
  const content = message.content?.trim();
  if (content && content !== '(image)') return message.content;
  const timelineSteps = message.timeline
    ?.filter((item): item is Extract<ChatTimelineItem, { type: 'step' }> => item.type === 'step')
    .map((item) => item.step) ?? [];
  const steps = timelineSteps.length > 0 ? timelineSteps : message.steps ?? [];
  return steps
    .map((step) => step.text?.trim())
    .filter((text): text is string => !!text)
    .join('\n\n');
}

function hasActivity(input: ActivityInput): boolean {
  return collectActivity(input).hasActivity;
}

interface ActivityInput {
  items?: ChatTimelineItem[];
  steps?: ChatStep[];
  events?: ChatTimelineEvent[];
  toolCalls?: ToolCallInfo[];
  thinking?: string;
  startedAt?: number;
  endedAt?: number;
}

function collectActivity(input: ActivityInput) {
  const timelineEvents = input.items
    ?.filter((item): item is Extract<ChatTimelineItem, { type: 'event' }> => item.type === 'event')
    .map((item) => item.event) ?? [];
  const timelineSteps = input.items
    ?.filter((item): item is Extract<ChatTimelineItem, { type: 'step' }> => item.type === 'step')
    .map((item) => item.step) ?? [];
  const steps = timelineSteps.length > 0 ? timelineSteps : input.steps ?? [];
  const events = timelineEvents.length > 0 ? timelineEvents : input.events ?? [];
  const stepTools = steps.flatMap((step) => step.toolCalls);
  const toolCalls = stepTools.length > 0 ? stepTools : input.toolCalls ?? [];
  const hasThinking = steps.some((step) => !!step.thinking) || !!input.thinking;
  const pending = steps.some((step) => step.status === 'streaming') ||
    toolCalls.some((tool) => tool.result === undefined && tool.isError === undefined);
  const failed = toolCalls.some((tool) => tool.isError);
  const timestamps = [
    input.startedAt,
    input.endedAt,
    ...events.map((event) => event.timestamp),
  ].filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
  const startedAt = timestamps.length > 0 ? Math.min(...timestamps) : Date.now();
  const endedAt = timestamps.length > 0 ? Math.max(...timestamps) : startedAt;

  return {
    events,
    steps,
    toolCalls,
    hasThinking,
    pending,
    failed,
    startedAt,
    endedAt,
    hasActivity: events.length > 0 || steps.length > 0 || toolCalls.length > 0 || hasThinking,
  };
}

function toolFamilies(tools: ToolCallInfo[]): string[] {
  const out = new Set<string>();
  for (const tool of tools) {
    const family = toolFamily(tool.name);
    if (family) out.add(family);
  }
  return [...out];
}

function toolFamily(name: string): string {
  const lower = name.toLowerCase();
  if (/(browser|playwright|chrome|screenshot|page|tab)/.test(lower)) return '浏览器';
  if (/(read_file|list_files|write_file|edit|patch|shell|exec|command|terminal)/.test(lower)) return '终端';
  if (lower.startsWith('antlogs_')) return 'antlogs';
  if (lower.startsWith('archassistant_')) return 'archassistant';
  if (lower.startsWith('product_query_')) return 'product_query';
  if (lower.startsWith('skylark_')) return 'skylark';
  if (lower.startsWith('memory_')) return 'memory';
  return name.split('_')[0] || name;
}

function formatDuration(startedAt: number, endedAt: number): string {
  const ms = Math.max(0, endedAt - startedAt);
  if (ms < 1000) return '<1s';
  const totalSeconds = Math.round(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes === 0) return `${seconds}s`;
  const hours = Math.floor(minutes / 60);
  const restMinutes = minutes % 60;
  if (hours === 0) return `${minutes}m ${seconds}s`;
  return `${hours}h ${restMinutes}m`;
}

function TimelineEventRow({ event }: { event: ChatTimelineEvent }) {
  return (
    <div className="flex items-center gap-2 text-xs text-zinc-500">
      <span className={`flex h-5 w-5 items-center justify-center rounded-full ${eventToneClass(event.tone)}`}>
        {eventIcon(event)}
      </span>
      <span className="min-w-0 truncate">{event.title}</span>
      {event.detail && <span className="hidden min-w-0 truncate font-mono text-zinc-600 sm:inline">{event.detail}</span>}
    </div>
  );
}

function ToolRunGroup({ tools, settled }: { tools: ToolCallInfo[]; settled: boolean }) {
  const [open, setOpen] = useState(!settled || tools.some((tool) => tool.isError));
  if (tools.length === 0) return null;
  const unresolved = tools.some((tool) => tool.result === undefined && tool.isError === undefined);
  const pending = !settled && unresolved;
  const failed = tools.some((tool) => tool.isError);
  const fileSummary = summarizeTouchedFiles(tools);
  const title = tools.length === 1 ? tools[0]!.name : `${tools.length} tool uses`;

  return (
    <div className="overflow-hidden rounded-lg border border-white/[0.07] bg-[#151515]">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-white/[0.04]"
      >
        <Wrench size={14} className="text-zinc-500" />
        <span className="min-w-0 flex-1 truncate font-mono text-sm text-zinc-300">{title}</span>
        {fileSummary && <span className="hidden truncate text-xs text-zinc-600 sm:block">{fileSummary}</span>}
        {pending ? (
          <Loader2 size={14} className="shrink-0 animate-spin text-zinc-500" />
        ) : failed ? (
          <AlertTriangle size={14} className="shrink-0 text-red-400" />
        ) : unresolved ? (
          <CircleDot size={14} className="shrink-0 text-zinc-500" />
        ) : (
          <CheckCircle size={14} className="shrink-0 text-emerald-400" />
        )}
        <ChevronRight size={14} className={`shrink-0 text-zinc-500 transition-transform ${open ? 'rotate-90' : ''}`} />
      </button>
      {open && (
        <div className="border-t border-white/[0.07] p-2">
          {tools.map((tool, i) => (
            <ToolCallCard key={tool.toolUseId ?? `${tool.name}-${i}`} tool={tool} settled={settled} />
          ))}
        </div>
      )}
    </div>
  );
}

function eventToneClass(tone: ChatTimelineEvent['tone']) {
  if (tone === 'good') return 'bg-white/[0.06] text-zinc-300';
  if (tone === 'warn') return 'bg-amber-400/10 text-amber-300';
  if (tone === 'bad') return 'bg-red-400/10 text-red-300';
  if (tone === 'info') return 'bg-white/[0.06] text-zinc-400';
  return 'bg-white/[0.05] text-zinc-500';
}

function eventIcon(event: ChatTimelineEvent) {
  if (event.kind === 'api_call' || event.kind === 'api_response') return <Network size={12} />;
  if (event.kind === 'compaction') return <Layers size={12} />;
  if (event.kind === 'guard') return <ShieldCheck size={12} />;
  if (event.kind === 'status') return <CircleDot size={12} />;
  if (event.tone === 'good') return <CheckCircle size={12} />;
  if (event.tone === 'warn' || event.tone === 'bad') return <AlertTriangle size={12} />;
  return <CircleDot size={12} />;
}

function summarizeTouchedFiles(tools: ToolCallInfo[]): string | null {
  const paths = new Set<string>();
  let writeLike = false;
  for (const tool of tools) {
    const name = tool.name.toLowerCase();
    if (/(write|edit|patch|replace|save)/.test(name)) writeLike = true;
    collectPaths(tool.input, paths);
  }
  if (paths.size === 0) return null;
  const count = paths.size;
  const first = [...paths][0]!;
  return writeLike
    ? `修改了 ${count} 个文件 · ${shortPath(first)}`
    : `读取了 ${count} 个路径 · ${shortPath(first)}`;
}

function collectPaths(value: unknown, out: Set<string>): void {
  if (!value || typeof value !== 'object') return;
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (typeof raw === 'string' && /(path|file|filename)$/i.test(key) && raw.length > 0) {
      out.add(raw);
    } else if (Array.isArray(raw)) {
      for (const item of raw) collectPaths(item, out);
    } else if (raw && typeof raw === 'object') {
      collectPaths(raw, out);
    }
  }
}

function shortPath(path: string): string {
  const clean = path.replace(/\/+$/u, '');
  const parts = clean.split('/');
  return parts.length <= 2 ? clean : `${parts.at(-2)}/${parts.at(-1)}`;
}

function AssistantMarkdown({ content }: { content: string }) {
  return (
    <div className="text-sm leading-7 prose prose-sm max-w-none prose-pre:p-0 prose-pre:m-0 prose-pre:bg-transparent dark:prose-invert prose-p:my-2 prose-li:my-1">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          code({ className, children, ...props }) {
            const match = /language-(\w+)/.exec(className || '');
            const code = String(children).replace(/\n$/, '');
            if (!match && !code.includes('\n')) {
              return (
                <code className="rounded bg-white/[0.08] px-1.5 py-0.5 font-mono text-xs text-zinc-200" {...props}>
                  {children}
                </code>
              );
            }
            return <CodeBlock language={match?.[1] || ''} code={code} />;
          },
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}

/** Collapsed thinking block for completed messages */
function CompletedThinking({ text }: { text: string }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="overflow-hidden rounded-lg border border-white/[0.07] bg-[#151515]">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center gap-2 px-3 py-1.5 text-left transition-colors hover:bg-white/[0.04]"
      >
        <Brain size={14} className="flex-shrink-0 text-zinc-500" />
        <span className="flex-1 text-xs font-medium text-zinc-400">Thought process</span>
        {expanded
          ? <ChevronDown size={14} className="text-gray-400 flex-shrink-0" />
          : <ChevronRight size={14} className="text-gray-400 flex-shrink-0" />}
      </button>
      {expanded && (
        <div className="max-h-48 overflow-y-auto border-t border-white/[0.07] px-3 py-2">
          <p className="whitespace-pre-wrap text-xs italic text-zinc-500">{text}</p>
        </div>
      )}
    </div>
  );
}

function InferenceDetails({ inferences, totalUsage }: { inferences: InferenceInfo[]; totalUsage?: { inputTokens: number; outputTokens: number } }) {
  const [expanded, setExpanded] = useState(false);
  if (inferences.length === 0) return null;
  const totalCost = inferences.reduce((sum, inf) => sum + (inf.cost ?? 0), 0);

  return (
    <div className="mt-1 ml-1">
      <button
        onClick={() => setExpanded(!expanded)}
        className="text-xs text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 flex items-center gap-1"
      >
        <span>{inferences.length} inference{inferences.length > 1 ? 's' : ''}</span>
        {totalCost > 0 && <span>· ${totalCost.toFixed(4)}</span>}
        {expanded
          ? <ChevronDown size={12} className="flex-shrink-0" />
          : <ChevronRight size={12} className="flex-shrink-0" />}
      </button>
      {expanded && (
        <div className="mt-1 space-y-1">
          {inferences.map((inf, i) => (
            <div key={i} className="text-xs text-gray-500 dark:text-gray-400 font-mono">
              <span className="text-gray-600 dark:text-gray-300">{inf.model}</span>
              {' · '}
              {inf.inputTokens}↓ {inf.outputTokens}↑
              {inf.cacheReadTokens ? ` · cache ${inf.cacheReadTokens}R` : ''}
              {inf.cacheWriteTokens ? ` · cache ${inf.cacheWriteTokens}W` : ''}
              {inf.cost != null && ` · $${inf.cost.toFixed(5)}`}
            </div>
          ))}
          {totalUsage && (
            <div className="text-xs text-gray-600 dark:text-gray-300 font-medium border-t border-gray-200 dark:border-gray-700 pt-1 mt-1">
              Turn total: {totalUsage.inputTokens}↓ {totalUsage.outputTokens}↑
              {totalCost > 0 && ` · $${totalCost.toFixed(4)}`}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
