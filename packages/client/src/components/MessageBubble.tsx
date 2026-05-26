import { useState } from 'react';
import { AlertTriangle, Bot, CheckCircle, ChevronDown, ChevronRight, Loader2 } from 'lucide-react';
import type { ChatMessage, InferenceInfo } from '@berry-agent/claw-contracts';
import { AssistantMarkdown } from './message/AssistantMarkdownView';
import { TurnActivitySummary, assistantContentForMessage, hasActivity } from './message/TurnActivity';

export { StepCard, TimelineEventList, TimelineItemList } from './message/TurnActivity';

interface MessageBubbleProps {
  message: ChatMessage;
  startedAt?: number;
}

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
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'} mb-8 group`}>
      {!isUser && (
        <div className="flex flex-shrink-0 flex-col items-center mr-4">
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-tr from-[var(--theme-primary)] to-white/30 shadow-[0_0_12px_var(--theme-primary-glow)] border border-white/20">
            <Bot size={14} className="text-[#0a0a0a]" />
          </div>
        </div>
      )}

      <div className={`${isUser ? 'max-w-[80%]' : 'w-full max-w-[calc(100%-3rem)]'} order-1`}>
        {!isUser && (
          <div className="flex items-center gap-2 mb-2">
            <span className="text-[12px] font-semibold tracking-widest text-zinc-300 uppercase">Berry Claw</span>
            {message.timestamp && (
              <span className="text-[10px] text-zinc-600 opacity-0 group-hover:opacity-100 transition-opacity">
                {new Date(message.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </span>
            )}
          </div>
        )}

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

        {(isUser || assistantContent) && (
          <div
            className={`${
              isUser
                ? isInterject
                  ? 'rounded-[20px] rounded-br-sm border border-amber-500/20 bg-amber-500/10 px-5 py-3.5 text-amber-100 shadow-sm'
                  : message.status === 'failed'
                    ? 'rounded-[20px] rounded-br-sm bg-red-500 px-5 py-3.5 text-white shadow-md shadow-red-500/20'
                    : 'rounded-[20px] rounded-br-sm bg-zinc-800 px-5 py-3.5 text-zinc-100 shadow-[0_4px_12px_rgba(0,0,0,0.2)]'
                : 'px-1 py-1 text-zinc-100'
            } ${message.status === 'pending' ? 'opacity-70' : ''} transition-all`}
          >
            {isUser ? (
              <UserMessageContent message={message} />
            ) : (
              <AssistantMarkdown content={assistantContent} />
            )}
          </div>
        )}

        {isUser && (
          <div className="text-[10px] text-zinc-500 mt-2 text-right mr-1 flex items-center justify-end gap-1.5 font-medium uppercase tracking-wider">
            {statusLabel === 'sending' ? (
              <Loader2 size={10} className="animate-spin text-sky-400" />
            ) : statusLabel === 'failed' ? (
              <AlertTriangle size={10} className="text-red-400" />
            ) : (
              <CheckCircle size={10} className="text-teal-400" />
            )}
            {new Date(message.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          </div>
        )}

        {!isUser && (hasSteps || (message.inferences && message.inferences.length > 0)) && (
          <div className="mt-3">
            <InferenceDetails
              inferences={hasSteps
                ? message.steps!.map((step) => step.inference).filter((item): item is InferenceInfo => !!item)
                : (message.inferences ?? [])}
              totalUsage={message.usage}
            />
          </div>
        )}
      </div>
    </div>
  );
}

function UserMessageContent({ message }: { message: ChatMessage }) {
  return (
    <div className="space-y-3">
      {message.blocks && message.blocks.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {message.blocks.map((block, idx) => {
            if (block.type === 'image') {
              return (
                <img
                  key={idx}
                  src={`data:${block.mediaType};base64,${block.data}`}
                  alt="attachment"
                  className="max-w-[240px] max-h-[240px] rounded-xl object-cover border border-white/10 shadow-sm"
                />
              );
            }
            if (block.type === 'annotation') {
              return (
                <div key={idx} className="max-w-[280px] overflow-hidden rounded-xl border border-sky-300/20 bg-sky-300/10">
                  <img
                    src={`data:${block.image.mediaType};base64,${block.image.data}`}
                    alt="annotation"
                    className="max-h-[220px] w-full object-cover"
                  />
                  <div className="space-y-1 px-3 py-2">
                    <div className="text-xs font-medium text-sky-100">{block.body}</div>
                    <div className="truncate font-mono text-[10px] text-zinc-500">{block.source.url}</div>
                  </div>
                </div>
              );
            }
            return null;
          })}
        </div>
      )}
      {message.content !== '(image)' && message.content !== '(annotation)' && (
        <p className="text-[15px] leading-relaxed whitespace-pre-wrap">{message.content}</p>
      )}
    </div>
  );
}

function InferenceDetails({
  inferences,
  totalUsage,
}: {
  inferences: InferenceInfo[];
  totalUsage?: { inputTokens: number; outputTokens: number };
}) {
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
