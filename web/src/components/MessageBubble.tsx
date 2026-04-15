import { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Brain, ChevronDown, ChevronRight } from 'lucide-react';
import CodeBlock from './CodeBlock';
import ToolCallCard from './ToolCallCard';
import type { ChatMessage } from '../types';

interface MessageBubbleProps {
  message: ChatMessage;
}

export default function MessageBubble({ message }: MessageBubbleProps) {
  const isUser = message.role === 'user';

  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'} mb-4`}>
      <div className={`max-w-[75%] ${isUser ? 'order-1' : 'order-1'}`}>
        {/* Label */}
        {!isUser && (
          <div className="text-xs text-gray-400 mb-1 ml-1">
            BERRY CLAW AI · {new Date(message.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          </div>
        )}

        {/* Thinking (collapsed by default for completed messages) */}
        {!isUser && message.thinking && <CompletedThinking text={message.thinking} />}

        {/* Tool calls (before text for assistant) */}
        {!isUser && message.toolCalls?.map((tool, i) => (
          <ToolCallCard key={i} tool={tool} />
        ))}

        {/* Bubble */}
        <div
          className={`rounded-2xl px-4 py-3 ${
            isUser
              ? 'bg-berry-600 text-white'
              : 'bg-gray-100 dark:bg-gray-800 text-gray-800 dark:text-gray-200'
          }`}
        >
          {isUser ? (
            <p className="text-sm whitespace-pre-wrap">{message.content}</p>
          ) : (
            <div className="text-sm prose prose-sm max-w-none prose-pre:p-0 prose-pre:m-0 prose-pre:bg-transparent dark:prose-invert">
              <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                components={{
                  code({ className, children, ...props }) {
                    const match = /language-(\w+)/.exec(className || '');
                    const code = String(children).replace(/\n$/, '');
                    if (!match && !code.includes('\n')) {
                      return (
                        <code className="bg-gray-200 dark:bg-gray-700 text-berry-700 dark:text-berry-300 px-1.5 py-0.5 rounded text-xs font-mono" {...props}>
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
          )}
        </div>

        {/* Timestamp for user */}
        {isUser && (
          <div className="text-xs text-gray-400 mt-1 text-right mr-1">
            YOU · {new Date(message.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          </div>
        )}

        {/* Usage badge */}
        {!isUser && message.usage && (
          <div className="text-xs text-gray-400 mt-1 ml-1">
            {message.usage.inputTokens}↓ {message.usage.outputTokens}↑
          </div>
        )}
      </div>
    </div>
  );
}

/** Collapsed thinking block for completed messages */
function CompletedThinking({ text }: { text: string }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="mb-2 border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-2 px-3 py-1.5 bg-gray-50 dark:bg-gray-800 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors text-left"
      >
        <Brain size={14} className="text-purple-400 flex-shrink-0" />
        <span className="text-xs text-purple-600 dark:text-purple-400 font-medium flex-1">Thought process</span>
        {expanded
          ? <ChevronDown size={14} className="text-gray-400 flex-shrink-0" />
          : <ChevronRight size={14} className="text-gray-400 flex-shrink-0" />}
      </button>
      {expanded && (
        <div className="px-3 py-2 bg-white dark:bg-gray-900 border-t border-gray-100 dark:border-gray-700 max-h-48 overflow-y-auto">
          <p className="text-xs text-gray-500 italic whitespace-pre-wrap">{text}</p>
        </div>
      )}
    </div>
  );
}
