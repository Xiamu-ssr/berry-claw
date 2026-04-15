import { useState, useRef, useEffect } from 'react';
import { Send, Loader2, Terminal, CheckCircle, XCircle, Brain, ChevronDown, ChevronRight } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import CodeBlock from './CodeBlock';
import MessageBubble from './MessageBubble';
import type { ChatMessage, ToolCallInfo } from '../types';

interface ChatAreaProps {
  messages: ChatMessage[];
  streamingText: string;
  thinkingText: string;
  pendingTools: ToolCallInfo[];
  isLoading: boolean;
  onSend: (prompt: string) => void;
}

export default function ChatArea({ messages, streamingText, thinkingText, pendingTools, isLoading, onSend }: ChatAreaProps) {
  const [input, setInput] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Auto-scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, streamingText, pendingTools, thinkingText]);

  // Auto-resize textarea
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = Math.min(textareaRef.current.scrollHeight, 200) + 'px';
    }
  }, [input]);

  const handleSubmit = () => {
    const prompt = input.trim();
    if (!prompt || isLoading) return;
    onSend(prompt);
    setInput('');
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const hasStreamingContent = streamingText || thinkingText || pendingTools.length > 0;

  return (
    <div className="flex-1 flex flex-col h-full bg-white dark:bg-gray-900">
      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-6 py-4">
        {messages.length === 0 && !hasStreamingContent && !isLoading && (
          <div className="flex items-center justify-center h-full">
            <div className="text-center">
              <div className="text-5xl mb-4">🐾</div>
              <h2 className="text-xl font-semibold text-gray-800 dark:text-gray-200 mb-2">Berry Claw</h2>
              <p className="text-gray-400 text-sm">Ask me anything. I can read files, run commands, and help with code.</p>
            </div>
          </div>
        )}

        {messages.map((msg) => (
          <MessageBubble key={msg.id} message={msg} />
        ))}

        {/* Streaming area -- thinking + tool calls + text */}
        {(isLoading || hasStreamingContent) && (
          <div className="flex justify-start mb-4">
            <div className="max-w-[75%]">
              <div className="text-xs text-gray-400 mb-1 ml-1">BERRY CLAW AI</div>

              {/* Thinking display */}
              {thinkingText && <ThinkingBlock text={thinkingText} isStreaming={isLoading} />}

              {/* Streaming tool calls */}
              {pendingTools.length > 0 && (
                <div className="mb-2">
                  {pendingTools.map((tool, i) => (
                    <StreamingToolCard key={i} tool={tool} />
                  ))}
                </div>
              )}

              {/* Streaming text */}
              {streamingText ? (
                <div className="rounded-2xl px-4 py-3 bg-gray-100 dark:bg-gray-800 text-gray-800 dark:text-gray-200">
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
                      {streamingText}
                    </ReactMarkdown>
                    <span className="animate-pulse">▌</span>
                  </div>
                </div>
              ) : isLoading && pendingTools.length === 0 && !thinkingText ? (
                <div className="rounded-2xl px-4 py-3 bg-gray-100 dark:bg-gray-800">
                  <Loader2 size={16} className="animate-spin text-berry-500" />
                </div>
              ) : null}
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div className="border-t border-gray-200 dark:border-gray-700 px-6 py-4 bg-white dark:bg-gray-900">
        <div className="flex items-end gap-3 max-w-4xl mx-auto">
          <div className="flex-1 relative">
            <textarea
              ref={textareaRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Message Berry Claw..."
              rows={1}
              className="w-full resize-none rounded-xl border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-4 py-3 pr-12 text-sm text-gray-800 dark:text-gray-200 focus:outline-none focus:ring-2 focus:ring-berry-500 focus:border-transparent placeholder:text-gray-400"
              disabled={isLoading}
            />
            <button
              onClick={handleSubmit}
              disabled={!input.trim() || isLoading}
              className="absolute right-2 bottom-2 w-8 h-8 rounded-lg bg-berry-600 hover:bg-berry-700 disabled:bg-gray-300 dark:disabled:bg-gray-600 flex items-center justify-center transition-colors"
            >
              <Send size={14} className="text-white" />
            </button>
          </div>
        </div>
        <p className="text-center text-xs text-gray-400 mt-2">
          Press <kbd className="px-1.5 py-0.5 bg-gray-100 dark:bg-gray-800 border border-gray-200 dark:border-gray-600 rounded text-xs">Enter</kbd> to send, <kbd className="px-1.5 py-0.5 bg-gray-100 dark:bg-gray-800 border border-gray-200 dark:border-gray-600 rounded text-xs">Shift + Enter</kbd> for new line.
        </p>
      </div>
    </div>
  );
}

/** Live tool call display during streaming */
function StreamingToolCard({ tool }: { tool: ToolCallInfo }) {
  const [expanded, setExpanded] = useState(false);
  const isDone = tool.isError !== undefined;

  return (
    <div className="border border-gray-200 dark:border-gray-700 rounded-lg my-1.5 overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-2 px-3 py-2 bg-gray-50 dark:bg-gray-800 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors text-left"
      >
        <Terminal size={14} className="text-gray-400 flex-shrink-0" />
        <span className="text-sm font-mono text-gray-600 dark:text-gray-300 flex-1 truncate">
          {tool.name}
        </span>
        {isDone ? (
          tool.isError
            ? <XCircle size={14} className="text-red-400 flex-shrink-0" />
            : <CheckCircle size={14} className="text-green-400 flex-shrink-0" />
        ) : (
          <Loader2 size={14} className="animate-spin text-berry-500 flex-shrink-0" />
        )}
        {expanded
          ? <ChevronDown size={14} className="text-gray-400 flex-shrink-0" />
          : <ChevronRight size={14} className="text-gray-400 flex-shrink-0" />}
      </button>
      {expanded && (
        <div className="px-3 py-2 bg-white dark:bg-gray-900 border-t border-gray-100 dark:border-gray-700">
          <pre className="text-xs font-mono text-gray-500 whitespace-pre-wrap break-all max-h-40 overflow-y-auto">
            {typeof tool.input === 'string'
              ? tool.input
              : JSON.stringify(tool.input, null, 2)}
          </pre>
        </div>
      )}
    </div>
  );
}

/** Thinking process display */
function ThinkingBlock({ text, isStreaming }: { text: string; isStreaming: boolean }) {
  const [expanded, setExpanded] = useState(true);

  return (
    <div className="mb-2 border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-2 px-3 py-2 bg-gray-50 dark:bg-gray-800 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors text-left"
      >
        <Brain size={14} className="text-purple-400 flex-shrink-0" />
        <span className="text-sm text-purple-600 dark:text-purple-400 font-medium flex-1">
          Thinking{isStreaming ? '...' : ''}
        </span>
        {isStreaming && <Loader2 size={14} className="animate-spin text-purple-400 flex-shrink-0" />}
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
