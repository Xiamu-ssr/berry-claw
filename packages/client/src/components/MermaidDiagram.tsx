import { useEffect, useMemo, useState } from 'react';
import mermaid from 'mermaid';

if (typeof window !== 'undefined') {
  mermaid.initialize({
    startOnLoad: false,
    theme: 'dark',
    securityLevel: 'loose',
    fontFamily: 'var(--font-sans)',
  });
}

export default function MermaidDiagram({ code }: { code: string }) {
  const [svg, setSvg] = useState<string>('');
  const [error, setError] = useState<Error | null>(null);
  const id = useMemo(() => `mermaid-${Math.random().toString(36).slice(2, 11)}`, []);

  useEffect(() => {
    let mounted = true;

    async function renderDiagram() {
      try {
        const { svg: svgCode } = await mermaid.render(id, code);
        if (mounted) {
          setSvg(svgCode);
          setError(null);
        }
      } catch (err) {
        if (mounted) setError(err instanceof Error ? err : new Error('Failed to render Mermaid diagram'));
      }
    }

    renderDiagram();
    return () => {
      mounted = false;
    };
  }, [code, id]);

  if (error) {
    return (
      <div className="my-4 rounded-xl border border-red-500/20 bg-red-500/10 p-4 font-mono text-sm text-red-400">
        Failed to render Mermaid diagram:
        <br />
        {error.message}
      </div>
    );
  }

  if (!svg) {
    return (
      <div className="my-4 flex items-center justify-center rounded-xl border border-white/[0.04] bg-white/[0.015] p-8">
        <span className="animate-pulse text-sm font-medium tracking-wide text-zinc-500">Rendering diagram...</span>
      </div>
    );
  }

  return (
    <div
      className="mermaid-wrapper my-4 flex justify-center overflow-x-auto rounded-xl border border-white/[0.04] bg-white/[0.01] p-6"
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}
