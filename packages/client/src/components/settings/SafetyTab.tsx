import { useCallback, useEffect, useState } from 'react';
import { Loader2, ShieldCheck, Zap } from 'lucide-react';
import { SAFETY_LEVELS } from '@berry-agent/claw-contracts/safety';
import type {
  ConfigResponse as ConfigPayload,
  SafetyLevel,
  SafetySnapshot,
} from '@berry-agent/claw-contracts';
import { API, apiFetch } from '../../api/paths';
import { cn } from '../../utils/cn';
import { showToast } from '../Toast';

const SAFETY_META: Record<SafetyLevel, { label: string; summary: string }> = {
  trust: { label: 'Trust', summary: '只拦截灾难级命令，不限制写入范围。' },
  default: { label: 'Default', summary: '限制写入范围，并拦截高危命令。' },
  auto: { label: 'Auto', summary: 'Default + LLM classifier 自动审批；无 classifier 时回退人工审批。' },
};

export default function SafetyTab({ config }: { config: ConfigPayload }) {
  const [snapshot, setSnapshot] = useState<SafetySnapshot | null>(null);
  const [saving, setSaving] = useState(false);
  const [savingClassifier, setSavingClassifier] = useState(false);

  const refresh = useCallback(async () => {
    const res = await apiFetch(API.safety);
    if (!res.ok) return;
    setSnapshot((await res.json()) as SafetySnapshot);
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const setGlobalLevel = async (level: SafetyLevel | null) => {
    setSaving(true);
    try {
      const res = await apiFetch(API.safetyGlobal, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ level }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      showToast({ title: 'Global safety', message: level ? `Set to ${level}` : 'Cleared' });
      await refresh();
    } catch (err) {
      showToast({
        variant: 'error',
        title: 'Global safety update failed',
        message: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setSaving(false);
    }
  };

  const value = snapshot?.globalLevel ?? null;
  const classifier = snapshot?.classifier;
  const classifierModel = classifier?.model ?? '';
  const modelOptions = [
    ...(config.tiers.fast ? ['tier:fast'] : []),
    ...(config.tiers.balanced ? ['tier:balanced'] : []),
    ...(config.tiers.strong ? ['tier:strong'] : []),
    ...Object.keys(config.models),
  ].filter((item, index, arr) => item && arr.indexOf(item) === index);

  const patchClassifier = async (patch: { model?: string | null; enabled?: boolean; skipStage2?: boolean }) => {
    setSavingClassifier(true);
    try {
      const res = await apiFetch(API.safetyClassifier, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(patch),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      showToast({ title: 'Auto approval', message: 'Classifier updated' });
      await refresh();
    } catch (err) {
      showToast({
        variant: 'error',
        title: 'Classifier update failed',
        message: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setSavingClassifier(false);
    }
  };

  return (
    <div className="space-y-4">
      <section className="rounded-xl border border-white/[0.08] bg-[#20242a]/75">
        <div className="flex items-center justify-between gap-3 border-b border-white/[0.07] px-4 py-3">
          <div className="flex items-center gap-2 text-sm font-medium text-zinc-200">
            <ShieldCheck size={15} className="text-[var(--theme-primary)]" />
            Global 安全策略
          </div>
          {saving && <Loader2 size={14} className="animate-spin text-zinc-500" />}
        </div>
        <div className="grid gap-3 p-4 md:grid-cols-2">
          <SafetyOption
            label="继承"
            summary="未设置 global 时，系统底线为 default。"
            active={value === null}
            disabled={saving}
            onClick={() => setGlobalLevel(null)}
          />
          {SAFETY_LEVELS.map((level) => (
            <SafetyOption
              key={level}
              label={SAFETY_META[level].label}
              summary={SAFETY_META[level].summary}
              active={value === level}
              disabled={saving}
              onClick={() => setGlobalLevel(level)}
            />
          ))}
        </div>
      </section>

      <section className="rounded-xl border border-white/[0.08] bg-[#20242a]/75">
        <div className="flex items-center justify-between gap-3 border-b border-white/[0.07] px-4 py-3">
          <div className="flex items-center gap-2 text-sm font-medium text-zinc-200">
            <Zap size={15} />
            Auto approval classifier
          </div>
          {savingClassifier && <Loader2 size={14} className="animate-spin text-zinc-500" />}
        </div>
        <div className="grid gap-4 p-4 md:grid-cols-[minmax(0,1fr)_220px]">
          <div>
            <label className="mb-1 block text-xs text-zinc-500">Classifier model</label>
            <select
              className="settings-input w-full"
              value={classifierModel}
              disabled={savingClassifier}
              onChange={(event) => patchClassifier({ model: event.target.value || null })}
            >
              <option value="">SDK default - tier:fast</option>
              {modelOptions.map((model) => (
                <option key={model} value={model}>{model}</option>
              ))}
            </select>
            <div className="mt-2 text-xs leading-5 text-zinc-500">
              当前：<span className="font-mono text-zinc-300">{classifier?.enabled ? classifier?.effectiveModel ?? classifierModel : 'HITL fallback'}</span>
              {classifier?.configuredModel ? null : <span> · 来自 SDK safe 默认策略</span>}
            </div>
          </div>
          <div className="space-y-2">
            <label className="flex items-center gap-2 rounded-lg border border-white/[0.07] bg-black/10 px-3 py-2 text-sm text-zinc-300">
              <input
                type="checkbox"
                checked={classifier?.enabled ?? true}
                disabled={savingClassifier || !classifierModel}
                onChange={(event) => patchClassifier({ enabled: event.target.checked })}
              />
              Enabled
            </label>
            <label className="flex items-center gap-2 rounded-lg border border-white/[0.07] bg-black/10 px-3 py-2 text-sm text-zinc-300">
              <input
                type="checkbox"
                checked={classifier?.skipStage2 ?? false}
                disabled={savingClassifier}
                onChange={(event) => patchClassifier({ skipStage2: event.target.checked })}
              />
              Skip Stage 2
            </label>
          </div>
        </div>
      </section>
    </div>
  );
}

function SafetyOption({
  label,
  summary,
  active,
  disabled,
  onClick,
}: {
  label: string;
  summary: string;
  active: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'rounded-xl border p-4 text-left transition-all disabled:cursor-not-allowed disabled:opacity-50',
        active
          ? 'border-[var(--theme-primary-hover)] bg-[var(--theme-primary-soft)] shadow-[0_0_15px_var(--theme-primary-soft)]'
          : 'border-white/[0.04] bg-white/[0.015] hover:border-white/[0.08] hover:bg-white/[0.03]',
      )}
    >
      <div className={cn('text-sm font-semibold tracking-wide', active ? 'text-[var(--theme-primary)]' : 'text-zinc-100')}>
        {label}
      </div>
      <div className="mt-1.5 text-[12px] leading-relaxed text-zinc-500">{summary}</div>
    </button>
  );
}
