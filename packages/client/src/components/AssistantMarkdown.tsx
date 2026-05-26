import { lazy, Suspense } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';

const CodeBlock = lazy(() => import('./CodeBlock'));

export default function AssistantMarkdown({ content }: { content: string }) {
  return (
    <div className="text-[15px] leading-[1.75] prose prose-zinc max-w-none dark:prose-invert prose-p:my-3 prose-li:my-1.5 prose-headings:font-medium prose-a:text-[var(--theme-primary)] hover:prose-a:opacity-80 prose-strong:text-zinc-100 prose-code:text-[var(--theme-primary)]">
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[rehypeKatex]}
        components={{
          code({ className, children, ...props }) {
            const match = /language-(\w+)/.exec(className || '');
            const code = String(children).replace(/\n$/, '');
            if (!match && !code.includes('\n')) {
              return (
                <code className="rounded bg-white/[0.08] px-1.5 py-0.5 font-mono text-[13px] text-zinc-200 border border-white/[0.05]" {...props}>
                  {children}
                </code>
              );
            }
            return (
              <Suspense fallback={<CodeBlockFallback language={match?.[1] || ''} code={code} />}>
                <CodeBlock language={match?.[1] || ''} code={code} />
              </Suspense>
            );
          },
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}

function CodeBlockFallback({ language, code }: { language: string; code: string }) {
  return (
    <pre className="my-2 overflow-x-auto rounded-lg border border-white/[0.08] bg-black/30 px-4 py-3 text-xs leading-6 text-zinc-300">
      <div className="mb-2 font-mono text-[11px] uppercase tracking-wide text-zinc-500">{language || 'text'}</div>
      <code>{code}</code>
    </pre>
  );
}
