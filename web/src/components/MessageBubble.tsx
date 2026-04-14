import ReactMarkdown from 'react-markdown';
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

        {/* Tool calls (before text for assistant) */}
        {!isUser && message.toolCalls?.map((tool, i) => (
          <ToolCallCard key={i} tool={tool} />
        ))}

        {/* Bubble */}
        <div
          className={`rounded-2xl px-4 py-3 ${
            isUser
              ? 'bg-berry-600 text-white'
              : 'bg-gray-100 text-gray-800'
          }`}
        >
          {isUser ? (
            <p className="text-sm whitespace-pre-wrap">{message.content}</p>
          ) : (
            <div className="text-sm prose prose-sm max-w-none prose-pre:p-0 prose-pre:m-0 prose-pre:bg-transparent">
              <ReactMarkdown
                components={{
                  code({ className, children, ...props }) {
                    const match = /language-(\w+)/.exec(className || '');
                    const code = String(children).replace(/\n$/, '');
                    // Inline code vs block code
                    if (!match && !code.includes('\n')) {
                      return (
                        <code className="bg-gray-200 text-berry-700 px-1.5 py-0.5 rounded text-xs font-mono" {...props}>
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
