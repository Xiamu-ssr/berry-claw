import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  AlertTriangle,
  Brain,
  CheckCircle,
  ChevronRight,
  CircleDot,
  Layers,
  Loader2,
  Network,
  ShieldCheck,
  Wrench,
} from 'lucide-react';
import ToolCallCard from '../ToolCallCard';
import { cn } from '../../utils/cn';
import type {
  ChatMessage,
  ChatStep,
  ChatTimelineEvent,
  ChatTimelineItem,
  ToolCallInfo,
} from '@berry-agent/claw-contracts';
import { AssistantMarkdown } from './AssistantMarkdownView';

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

  return (
    <div className="space-y-4">
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

export function TurnActivitySummary({
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
  const [expanded, setExpanded] = useState(!turnSettled);
  const activity = collectActivity({ items, steps, events, toolCalls, thinking, startedAt, endedAt });

  useEffect(() => {
    setExpanded(!turnSettled);
  }, [turnSettled]);

  if (!activity.hasActivity) return null;

  const title = activity.pending && !turnSettled
    ? '正在处理中...'
    : `完成于 ${formatDuration(activity.startedAt, activity.endedAt)}`;
  const pieces = [];
  if (activity.toolCalls.length > 0) pieces.push(`${activity.toolCalls.length} 个动作`);
  const families = toolFamilies(activity.toolCalls);
  if (families.length > 0) pieces.push(`${families.slice(0, 3).join(', ')}`);
  if (activity.toolCalls.length === 0 && activity.events.length > 0) pieces.push(`${activity.events.length} 个事件`);
  if (activity.hasThinking && activity.toolCalls.length === 0) pieces.push('深度思考');

  if (!turnSettled) {
    return (
      <div className="space-y-4 mb-4">
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
                includeText={true}
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
    );
  }

  return (
    <div className="mb-4 overflow-hidden rounded-2xl border border-white/[0.04] bg-white/[0.015] shadow-sm backdrop-blur-sm transition-all hover:bg-white/[0.03]">
      <button
        type="button"
        onClick={() => setExpanded((value) => !value)}
        className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors"
      >
        <div className={cn(
          'flex h-6 w-6 shrink-0 items-center justify-center rounded-full border',
          activity.failed ? 'border-red-500/30 bg-red-500/10 text-red-400' :
          activity.pending && !turnSettled ? 'border-sky-400/30 bg-sky-400/10 text-sky-400' :
          'border-zinc-500/30 bg-zinc-800/50 text-zinc-400',
        )}>
          {activity.failed ? <AlertTriangle size={10} /> :
           activity.pending && !turnSettled ? <Loader2 size={10} className="animate-spin" /> :
           <CheckCircle size={10} />}
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[13px] font-medium text-zinc-200">
            {title}
          </div>
          <div className="truncate text-[11px] text-zinc-500 mt-0.5">
            {pieces.join(' · ')}
          </div>
        </div>
        <ChevronRight size={14} className={cn('shrink-0 text-zinc-600 transition-transform', expanded && 'rotate-90')} />
      </button>
      {expanded && (
        <div className="space-y-3 border-t border-white/[0.04] p-4 bg-black/20">
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
                  includeText={true}
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

export function assistantContentForMessage(message: ChatMessage): string {
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

export function hasActivity(input: ActivityInput): boolean {
  return collectActivity(input).hasActivity;
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

  useEffect(() => {
    setOpen(!settled || tools.some((tool) => tool.isError));
  }, [settled, tools]);

  if (tools.length === 0) return null;
  const unresolved = tools.some((tool) => tool.result === undefined && tool.isError === undefined);
  const pending = !settled && unresolved;
  const failed = tools.some((tool) => tool.isError);
  const fileSummary = summarizeTouchedFiles(tools);
  const title = tools.length === 1 ? tools[0]!.name : `${tools.length} tool uses`;

  if (!settled) {
    return (
      <div className="space-y-3 mb-4">
        {tools.map((tool, i) => (
          <ToolCallCard key={tool.toolUseId ?? `${tool.name}-${i}`} tool={tool} settled={settled} />
        ))}
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-2xl border border-white/[0.04] bg-white/[0.015] shadow-sm backdrop-blur-sm transition-all hover:bg-white/[0.03] mb-4">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors"
      >
        <div className={cn(
          'flex h-6 w-6 shrink-0 items-center justify-center rounded-full border',
          pending ? 'border-amber-500/30 bg-amber-500/10 text-amber-400' :
          failed ? 'border-red-500/30 bg-red-500/10 text-red-400' :
          'border-teal-500/30 bg-teal-500/10 text-teal-400',
        )}>
          {pending ? <Wrench size={10} className="animate-pulse" /> :
           failed ? <AlertTriangle size={10} /> :
           <Wrench size={10} />}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate font-mono text-[13px] text-zinc-300">{title}</span>
            {pending && <span className="flex h-1.5 w-1.5 rounded-full bg-amber-400 animate-pulse" />}
          </div>
          {fileSummary && <div className="truncate text-[11px] text-zinc-500 mt-0.5">{fileSummary}</div>}
        </div>
        <ChevronRight size={14} className={cn('shrink-0 text-zinc-600 transition-transform', open && 'rotate-90')} />
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="border-t border-white/[0.04] bg-black/20"
          >
            <div className="p-4 space-y-3">
              {tools.map((tool, i) => (
                <ToolCallCard key={tool.toolUseId ?? `${tool.name}-${i}`} tool={tool} settled={settled} />
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
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

function CompletedThinking({ text }: { text: string }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="overflow-hidden rounded-2xl border border-white/[0.04] bg-white/[0.015] shadow-sm backdrop-blur-sm transition-all hover:bg-white/[0.03] mb-4">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors"
      >
        <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-[var(--theme-primary-hover)] bg-[var(--theme-primary-soft)] text-[var(--theme-primary)]">
          <Brain size={12} />
        </div>
        <span className="flex-1 text-[13px] font-medium text-zinc-300">深度思考过程</span>
        <ChevronRight size={14} className={cn('text-zinc-600 transition-transform', expanded && 'rotate-90')} />
      </button>
      {expanded && (
        <div className="max-h-[60vh] overflow-y-auto border-t border-white/[0.04] px-4 py-4 bg-black/20 hide-scrollbar">
          <p className="whitespace-pre-wrap text-[13px] leading-relaxed text-zinc-400">{text}</p>
        </div>
      )}
    </div>
  );
}
