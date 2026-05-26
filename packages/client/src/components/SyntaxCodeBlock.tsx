import { useMemo, useState } from 'react';
import { PrismLight as SyntaxHighlighter } from 'react-syntax-highlighter';
import bash from 'react-syntax-highlighter/dist/esm/languages/prism/bash';
import css from 'react-syntax-highlighter/dist/esm/languages/prism/css';
import diff from 'react-syntax-highlighter/dist/esm/languages/prism/diff';
import go from 'react-syntax-highlighter/dist/esm/languages/prism/go';
import java from 'react-syntax-highlighter/dist/esm/languages/prism/java';
import javascript from 'react-syntax-highlighter/dist/esm/languages/prism/javascript';
import json from 'react-syntax-highlighter/dist/esm/languages/prism/json';
import jsx from 'react-syntax-highlighter/dist/esm/languages/prism/jsx';
import markdown from 'react-syntax-highlighter/dist/esm/languages/prism/markdown';
import python from 'react-syntax-highlighter/dist/esm/languages/prism/python';
import rust from 'react-syntax-highlighter/dist/esm/languages/prism/rust';
import sql from 'react-syntax-highlighter/dist/esm/languages/prism/sql';
import tsx from 'react-syntax-highlighter/dist/esm/languages/prism/tsx';
import typescript from 'react-syntax-highlighter/dist/esm/languages/prism/typescript';
import yaml from 'react-syntax-highlighter/dist/esm/languages/prism/yaml';
import { atomDark, oneLight } from 'react-syntax-highlighter/dist/esm/styles/prism';
import { Check, Copy } from 'lucide-react';

const LANGUAGES_REGISTERED = Symbol.for('berry-claw.syntax-languages');

declare global {
  interface Window {
    [LANGUAGES_REGISTERED]?: boolean;
  }
}

if (typeof window !== 'undefined' && !window[LANGUAGES_REGISTERED]) {
  SyntaxHighlighter.registerLanguage('bash', bash);
  SyntaxHighlighter.registerLanguage('sh', bash);
  SyntaxHighlighter.registerLanguage('shell', bash);
  SyntaxHighlighter.registerLanguage('css', css);
  SyntaxHighlighter.registerLanguage('diff', diff);
  SyntaxHighlighter.registerLanguage('go', go);
  SyntaxHighlighter.registerLanguage('java', java);
  SyntaxHighlighter.registerLanguage('javascript', javascript);
  SyntaxHighlighter.registerLanguage('js', javascript);
  SyntaxHighlighter.registerLanguage('json', json);
  SyntaxHighlighter.registerLanguage('jsx', jsx);
  SyntaxHighlighter.registerLanguage('markdown', markdown);
  SyntaxHighlighter.registerLanguage('md', markdown);
  SyntaxHighlighter.registerLanguage('python', python);
  SyntaxHighlighter.registerLanguage('py', python);
  SyntaxHighlighter.registerLanguage('rust', rust);
  SyntaxHighlighter.registerLanguage('rs', rust);
  SyntaxHighlighter.registerLanguage('sql', sql);
  SyntaxHighlighter.registerLanguage('tsx', tsx);
  SyntaxHighlighter.registerLanguage('typescript', typescript);
  SyntaxHighlighter.registerLanguage('ts', typescript);
  SyntaxHighlighter.registerLanguage('yaml', yaml);
  SyntaxHighlighter.registerLanguage('yml', yaml);
  window[LANGUAGES_REGISTERED] = true;
}

export default function SyntaxCodeBlock({ language, code }: { language: string; code: string }) {
  const [copied, setCopied] = useState(false);
  const isDark = useMemo(() => document.documentElement.classList.contains('dark'), []);

  const handleCopy = () => {
    navigator.clipboard.writeText(code);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="group relative my-4 overflow-hidden rounded-xl border border-white/[0.04] bg-[#0d0d0d] shadow-sm">
      <div className="flex items-center justify-between border-b border-white/[0.04] bg-black/40 px-4 py-2">
        <span className="select-none font-mono text-[11px] text-zinc-400">{language || 'text'}</span>
        <button
          onClick={handleCopy}
          className="flex select-none items-center gap-1.5 text-[11px] font-medium text-zinc-500 transition-colors hover:text-[var(--theme-primary)]"
        >
          {copied ? <Check size={12} /> : <Copy size={12} />}
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <SyntaxHighlighter
        language={language || 'text'}
        style={isDark ? atomDark : oneLight}
        customStyle={{
          margin: 0,
          padding: '1rem',
          fontSize: '0.85em',
          lineHeight: '1.6',
          background: 'transparent',
          fontFamily: "'IBM Plex Sans', 'Fira Code', 'SF Mono', monospace",
        }}
      >
        {code}
      </SyntaxHighlighter>
    </div>
  );
}
