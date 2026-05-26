import { useState } from 'react';
import { ChevronDown } from 'lucide-react';
import type { InferenceInfo } from '@berry-agent/claw-contracts';

export default function InferenceDetails({ inferences }: { inferences: InferenceInfo[] }) {
  const [expanded, setExpanded] = useState(false);
  const totalCost = inferences.reduce((sum, inf) => sum + (inf.cost ?? 0), 0);
  if (inferences.length === 0) return null;

  return (
    <div className="ml-1 mt-1">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-1 text-xs text-zinc-600 transition-colors hover:text-zinc-400"
      >
        <span>{inferences.length} inference{inferences.length > 1 ? 's' : ''}</span>
        {totalCost > 0 && <span>· ${totalCost.toFixed(4)}</span>}
        <ChevronDown size={12} className={`transition-transform ${expanded ? 'rotate-180' : ''}`} />
      </button>
      {expanded && (
        <div className="mt-1 space-y-1">
          {inferences.map((inf, i) => (
            <div key={i} className="font-mono text-xs text-zinc-500">
              <span className="text-zinc-400">{inf.model}</span>
              {' · '}
              {inf.inputTokens}↓ {inf.outputTokens}↑
              {inf.cacheReadTokens ? ` · cache ${inf.cacheReadTokens}R` : ''}
              {inf.cacheWriteTokens ? ` · cache ${inf.cacheWriteTokens}W` : ''}
              {inf.cost != null && ` · $${inf.cost.toFixed(5)}`}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
