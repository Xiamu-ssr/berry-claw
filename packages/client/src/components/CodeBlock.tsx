import { lazy, Suspense } from 'react';

interface CodeBlockProps {
  language: string;
  code: string;
}

const MermaidDiagram = lazy(() => import('./MermaidDiagram'));
const SyntaxCodeBlock = lazy(() => import('./SyntaxCodeBlock'));

export default function CodeBlock({ language, code }: CodeBlockProps) {
  if (language === 'mermaid') {
    return (
      <Suspense fallback={<PlainCodeBlock language={language} code={code} />}>
        <MermaidDiagram code={code} />
      </Suspense>
    );
  }
  return (
    <Suspense fallback={<PlainCodeBlock language={language} code={code} />}>
      <SyntaxCodeBlock language={language} code={code} />
    </Suspense>
  );
}

function PlainCodeBlock({ language, code }: CodeBlockProps) {
  return (
    <pre className="my-4 overflow-x-auto rounded-xl border border-white/[0.06] bg-black/30 px-4 py-3 text-xs leading-6 text-zinc-300">
      <div className="mb-2 font-mono text-[11px] uppercase tracking-wide text-zinc-500">{language || 'text'}</div>
      <code>{code}</code>
    </pre>
  );
}
