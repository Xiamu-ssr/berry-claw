import { useState, useRef, useEffect } from 'react';
import { Send, Loader2 } from 'lucide-react';
import MessageBubble from './MessageBubble';
import type { ChatMessage } from '../types';

interface ChatAreaProps {
  messages: ChatMessage[];
  streamingText: string;
  isLoading: boolean;
  onSend: (prompt: string) => void;
}

export default function ChatArea({ messages, streamingText, isLoading, onSend }: ChatAreaProps) {
  const [input, setInput] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Auto-scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, streamingText]);

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

  return (
    <div className="flex-1 flex flex-col h-full bg-white">
      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-6 py-4">
        {messages.length === 0 && !streamingText && (
          <div className="flex items-center justify-center h-full">
            <div className="text-center">
              <div className="text-5xl mb-4">🐾</div>
              <h2 className="text-xl font-semibold text-gray-800 mb-2">Berry Claw</h2>
              <p className="text-gray-400 text-sm">Ask me anything. I can read files, run commands, and help with code.</p>
            </div>
          </div>
        )}

        {messages.map((msg) => (
          <MessageBubble key={msg.id} message={msg} />
        ))}

        {/* Streaming text */}
        {streamingText && (
          <div className="flex justify-start mb-4">
            <div className="max-w-[75%]">
              <div className="text-xs text-gray-400 mb-1 ml-1">BERRY CLAW AI</div>
              <div className="rounded-2xl px-4 py-3 bg-gray-100 text-gray-800">
                <p className="text-sm whitespace-pre-wrap">{streamingText}<span className="animate-pulse">▌</span></p>
              </div>
            </div>
          </div>
        )}

        {/* Loading indicator */}
        {isLoading && !streamingText && (
          <div className="flex justify-start mb-4">
            <div className="rounded-2xl px-4 py-3 bg-gray-100">
              <Loader2 size={16} className="animate-spin text-berry-500" />
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div className="border-t border-gray-200 px-6 py-4">
        <div className="flex items-end gap-3 max-w-4xl mx-auto">
          <div className="flex-1 relative">
            <textarea
              ref={textareaRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Message Berry Claw..."
              rows={1}
              className="w-full resize-none rounded-xl border border-gray-300 px-4 py-3 pr-12 text-sm focus:outline-none focus:ring-2 focus:ring-berry-500 focus:border-transparent placeholder:text-gray-400"
              disabled={isLoading}
            />
            <button
              onClick={handleSubmit}
              disabled={!input.trim() || isLoading}
              className="absolute right-2 bottom-2 w-8 h-8 rounded-lg bg-berry-600 hover:bg-berry-700 disabled:bg-gray-300 flex items-center justify-center transition-colors"
            >
              <Send size={14} className="text-white" />
            </button>
          </div>
        </div>
        <p className="text-center text-xs text-gray-400 mt-2">
          Press <kbd className="px-1.5 py-0.5 bg-gray-100 border border-gray-200 rounded text-xs">Enter</kbd> to send, <kbd className="px-1.5 py-0.5 bg-gray-100 border border-gray-200 rounded text-xs">Shift + Enter</kbd> for new line.
        </p>
      </div>
    </div>
  );
}
