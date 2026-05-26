import { ChevronDown, Zap } from 'lucide-react';
import type {
  ConfigResponse as ConfigPayload,
  ConfigTierId as TierId,
} from '@berry-agent/claw-contracts';
import { API, apiFetch } from '../../api/paths';
import { showToast } from '../Toast';
import { emitModelCatalogChanged } from './modelCatalogEvents';

const TIER_META: Record<TierId, { label: string; desc: string; color: string; border: string; ring: string }> = {
  strong: {
    label: 'Strong',
    desc: 'Deep reasoning, architecture, hard debugging.',
    color: 'text-purple-600 dark:text-purple-300',
    border: 'border-l-4 border-l-purple-500',
    ring: 'ring-purple-500',
  },
  balanced: {
    label: 'Balanced',
    desc: 'Default working model: the one agents pick when unspecified.',
    color: 'text-sky-300',
    border: 'border-l-4 border-l-berry-500',
    ring: 'ring-berry-500',
  },
  fast: {
    label: 'Fast',
    desc: 'Short latency tasks: classification, compaction, title gen.',
    color: 'text-green-600 dark:text-green-300',
    border: 'border-l-4 border-l-green-500',
    ring: 'ring-green-500',
  },
};

export default function TiersTab({ config, onChange }: {
  config: ConfigPayload;
  onChange: () => void;
}) {
  const modelIds = Object.keys(config.models);

  const setTier = async (tier: TierId, modelId: string | null) => {
    await apiFetch(API.configTier(tier), {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ modelId }),
    });
    showToast(`Tier "${tier}" updated`);
    emitModelCatalogChanged();
    onChange();
  };

  return (
    <section className="rounded-xl border border-white/[0.08] bg-[#20242a]/75 p-5">
      <div className="mb-5">
        <h2 className="flex items-center gap-2 text-lg font-semibold text-zinc-100">
          <Zap size={20} className="text-[var(--theme-primary)]" /> Tiers
        </h2>
        <p className="mt-1 text-sm text-zinc-500">
          Layer 3: agents can reference <code>tier:strong</code>, <code>tier:balanced</code>,
          or <code>tier:fast</code> instead of hard-coding a model id.
        </p>
      </div>

      {modelIds.length === 0 ? (
        <p className="py-8 text-center text-sm italic text-gray-400">
          Add at least one model binding first.
        </p>
      ) : (
        <div className="space-y-4">
          {(Object.keys(TIER_META) as TierId[]).map(tier => {
            const meta = TIER_META[tier];
            const current = config.tiers[tier] ?? '';
            return (
              <div
                key={tier}
                className={`rounded-lg border border-white/[0.08] bg-[#20242a]/75 p-4 ${meta.border}`}
              >
                <div className="mb-1 flex items-center gap-2">
                  <Zap size={14} className={meta.color} />
                  <span className={`font-semibold ${meta.color}`}>{meta.label}</span>
                  <span className="font-mono text-xs text-zinc-600">tier:{tier}</span>
                  {!current && (
                    <span className="ml-auto rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-700 dark:bg-amber-900/40 dark:text-amber-300">
                      unset
                    </span>
                  )}
                </div>
                <p className="mb-3 text-xs text-zinc-500">{meta.desc}</p>
                <div className="relative">
                  <select
                    className={`settings-input w-full cursor-pointer appearance-none pr-9 focus:${meta.ring}`}
                    value={current}
                    onChange={event => setTier(tier, event.target.value || null)}
                  >
                    <option value="">-- not set --</option>
                    {modelIds.map(id => <option key={id} value={id}>{id}</option>)}
                  </select>
                  <ChevronDown
                    size={16}
                    className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-gray-400"
                  />
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
