import { useState, useRef, useEffect, useCallback } from 'react';
import { Send, Loader2, Terminal, CheckCircle, XCircle, Brain, ChevronDown, ChevronRight, Paperclip, X } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import CodeBlock from './CodeBlock';
import MessageBubble from './MessageBubble';
import ChatHeader from './ChatHeader';
import type { ChatMessage, ToolCallInfo } from '../types';

/** An image attachment queued for the next send. */
interface ImageAttachment {
  id: string;
  name: string;
  mediaType: string;
  /** base64 data URL so <img src=...> works directly in the preview. */
  dataUrl: string;
  /** raw base64 (without `data:...;base64,` prefix) — what the provider wants. */
  data: string;
  sizeBytes: number;
}

/**
 * Outbound payload from ChatArea. Either pure text or a ContentBlock[]
 * mirroring the SDK wire format (only text + image blocks here).
 */
export type SendPayload =
  | string
  | Array<
      | { type: 'text'; text: string }
      | { type: 'image'; data: string; mediaType: string }
    >;

interface ChatAreaProps {
  messages: ChatMessage[];
  streamingText: string;
  thinkingText: string;
  pendingTools: ToolCallInfo[];
  isLoading: boolean;
  onSend: (prompt: SendPayload) => void;
  onCompact: () => void;
}

// Keep the in-browser cap conservative. Anthropic image limit is ~3.75MB
// raw; base64 inflates ~33%, so 4MB raw ≈ 5.3MB on the wire. We stop there.
const MAX_IMAGE_BYTES = 4 * 1024 * 1024;
const ACCEPTED_IMAGE_MIME = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];

export default function ChatArea({ messages, streamingText, thinkingText, pendingTools, isLoading, onSend, onCompact }: ChatAreaProps) {
  const [input, setInput] = useState('');
  const [attachments, setAttachments] = useState<ImageAttachment[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [stickToBottom, setStickToBottom] = useState(true);

  // Track whether the user is at (or near) the bottom; if they scrolled up,
  // don't force auto-scroll on new content.
  const handleScroll = () => {
    const el = scrollContainerRef.current;
    if (!el) return;
    const threshold = 80; // px of slack so tiny scroll gestures still stick
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight <= threshold;
    setStickToBottom(atBottom);
  };

  // Auto-scroll to bottom only when the user is already there.
  useEffect(() => {
    if (stickToBottom) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, streamingText, pendingTools, thinkingText, stickToBottom]);

  const jumpToBottom = () => {
    setStickToBottom(true);
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  // Auto-resize textarea
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = Math.min(textareaRef.current.scrollHeight, 200) + 'px';
    }
  }, [input]);

  /**
   * Turn a File into an ImageAttachment. Rejects unsupported MIME types
   * and oversize files with a toast-style console warning (no Toast import
   * here to avoid a cycle).
   */
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
    // dataUrl = `data:image/png;base64,XXXX` — split off the base64 body.
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

  const handlePaste = useCallback(async (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    // Only intercept when the clipboard carries images — plain text paste
    // must behave normally.
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

  const removeAttachment = (id: string) => {
    setAttachments((prev) => prev.filter((a) => a.id !== id));
  };

  const handleSubmit = () => {
    const text = input.trim();
    if ((!text && attachments.length === 0) || isLoading) return;
    if (attachments.length === 0) {
      onSend(text);
    } else {
      // Multimodal: assemble a ContentBlock[] in SDK wire format.
      const blocks: SendPayload = [];
      for (const a of attachments) {
        blocks.push({ type: 'image', data: a.data, mediaType: a.mediaType });
      }
      if (text) blocks.push({ type: 'text', text });
      onSend(blocks);
    }
    setInput('');
    setAttachments([]);
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
      <ChatHeader onCompact={onCompact} />
      {/* Messages */}
      <div
        ref={scrollContainerRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto px-6 py-4 relative"
      >
        {!stickToBottom && (messages.length > 0 || hasStreamingContent) && (
          <button
            onClick={jumpToBottom}
            className="sticky bottom-2 left-1/2 -translate-x-1/2 z-10 px-3 py-1.5 rounded-full bg-gray-900/80 dark:bg-gray-100/80 text-white dark:text-gray-900 text-xs shadow-lg hover:bg-gray-900 dark:hover:bg-gray-100 transition-colors flex items-center gap-1"
            style={{ float: 'none', margin: '0 auto', display: 'block' }}
          >
            ↓ Jump to latest
          </button>
        )}
        {messages.length === 0 && !hasStreamingContent && !isLoading && (
          <div className="flex items-center justify-center h-full">
            <div className="text-center max-w-lg px-6">
              <div className="text-5xl mb-4">🐾</div>
              <h2 className="text-xl font-semibold text-gray-800 dark:text-gray-200 mb-2">Berry Claw</h2>
              <p className="text-gray-500 dark:text-gray-400 text-sm mb-6">
                Ask me anything. I can read files, run commands, and help with code.
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-left">
                {[
                  { icon: '📝', text: 'Summarize a file or directory', prompt: 'Summarize what this project does based on README and top-level files.' },
                  { icon: '🔍', text: 'Find something in the codebase', prompt: 'Grep for all TODOs in this repo and list them by file.' },
                  { icon: '🛠️', text: 'Refactor or add a small feature', prompt: 'Suggest a small improvement I can ship in under 30 minutes.' },
                  { icon: '🧠', text: 'Explain a concept', prompt: 'Explain how context compaction works in an agent harness.' },
                ].map(sample => (
                  <button
                    key={sample.text}
                    onClick={() => onSend(sample.prompt)}
                    className="rounded-lg border border-gray-200 dark:border-gray-700 px-3 py-2 text-sm text-gray-700 dark:text-gray-300 hover:border-berry-300 dark:hover:border-berry-700 hover:bg-berry-50/50 dark:hover:bg-berry-900/20 transition-colors flex items-start gap-2"
                  >
                    <span>{sample.icon}</span>
                    <span className="flex-1">{sample.text}</span>
                  </button>
                ))}
              </div>
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
            {/* Attachments preview strip */}
            {attachments.length > 0 && (
              <div className="mb-2 flex flex-wrap gap-2">
                {attachments.map((a) => (
                  <div key={a.id} className="relative group">
                    <img
                      src={a.dataUrl}
                      alt={a.name}
                      className="h-16 w-16 object-cover rounded-md border border-gray-300 dark:border-gray-600"
                    />
                    <button
                      onClick={() => removeAttachment(a.id)}
                      className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-gray-900/80 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                      title="Remove"
                    >
                      <X size={11} />
                    </button>
                    <div className="absolute bottom-0 left-0 right-0 text-[9px] text-white bg-black/60 px-1 truncate rounded-b-md">
                      {Math.round(a.sizeBytes / 1024)}KB
                    </div>
                  </div>
                ))}
              </div>
            )}
            <textarea
              ref={textareaRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              onPaste={handlePaste}
              onDrop={handleDrop}
              onDragOver={(e) => e.preventDefault()}
              placeholder="Message Berry Claw... (paste or drop images)"
              rows={1}
              className="w-full resize-none rounded-xl border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-4 py-3 pr-20 text-sm text-gray-800 dark:text-gray-200 focus:outline-none focus:ring-2 focus:ring-berry-500 focus:border-transparent placeholder:text-gray-400"
              disabled={isLoading}
            />
            {/* Attach button */}
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
              className="absolute right-12 bottom-2 w-8 h-8 rounded-lg text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-700 disabled:text-gray-300 disabled:cursor-not-allowed flex items-center justify-center transition-colors"
            >
              <Paperclip size={16} />
            </button>
            <button
              onClick={handleSubmit}
              disabled={(!input.trim() && attachments.length === 0) || isLoading}
              title="Send (Enter)"
              className="absolute right-2 bottom-2 w-8 h-8 rounded-lg bg-berry-600 hover:bg-berry-700 disabled:bg-gray-400 dark:disabled:bg-gray-600 disabled:cursor-not-allowed flex items-center justify-center transition-colors"
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
