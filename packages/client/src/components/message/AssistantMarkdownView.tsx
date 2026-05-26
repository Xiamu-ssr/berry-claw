import { lazy, Suspense } from 'react';

const AssistantMarkdownRenderer = lazy(() => import('../AssistantMarkdown'));

export function AssistantMarkdown({ content }: { content: string }) {
  return (
    <Suspense fallback={<MarkdownFallback content={content} />}>
      <AssistantMarkdownRenderer content={content} />
    </Suspense>
  );
}

function MarkdownFallback({ content }: { content: string }) {
  return (
    <p className="whitespace-pre-wrap text-[15px] leading-[1.75] text-zinc-100">{content}</p>
  );
}
