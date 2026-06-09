import { type ReactNode } from 'react';
import type { ModelCatalogItem } from '@berry-agent/claw-contracts';
import { PickerButton } from './PickerButton';
import type { PickerOption } from './Picker';
import { modelShortName } from '../../utils/format';
import { cn } from '../../utils/cn';

/** Small family pill. anthropic = warm, openai = teal — purely a glance cue. */
export function FamilyBadge({ family }: { family?: 'anthropic' | 'openai' }) {
  if (!family) return null;
  return (
    <span
      className={cn(
        'rounded-md px-1.5 py-0.5 text-[10px] font-medium',
        family === 'anthropic' ? 'bg-amber-300/10 text-amber-200' : 'bg-teal-300/10 text-teal-200',
      )}
    >
      {family === 'anthropic' ? 'Claude' : 'OpenAI'}
    </span>
  );
}

/**
 * Turn the model catalog into Picker options, grouping tier aliases first then
 * concrete models, tagging each with a family badge and ctx-window hint. When
 * `lockFamily` is set, cross-family models (and family-less ones can't be
 * judged, so they stay enabled) are greyed + disabled — the family-lock that
 * keeps an agent on one wire protocol for its life.
 */
export function catalogToOptions(
  catalog: ModelCatalogItem[],
  lockFamily?: 'anthropic' | 'openai',
): PickerOption[] {
  return catalog.map((m) => {
    const crossFamily = lockFamily !== undefined && m.family !== undefined && m.family !== lockFamily;
    const ctx = m.contextWindow ? `${Math.round(m.contextWindow / 1000)}k ctx` : undefined;
    const desc = [m.providerName !== 'tier' ? m.providerName : null, ctx].filter(Boolean).join(' · ');
    return {
      value: m.model,
      label: m.type === 'tier' ? m.model : modelShortName(m.model),
      description: desc || undefined,
      group: m.type === 'tier' ? '档位 (tier)' : '具体模型',
      badge: <FamilyBadge family={m.family} />,
      disabled: crossFamily,
      keywords: m.model,
    } satisfies PickerOption;
  });
}

export interface ModelPickerProps {
  catalog: ModelCatalogItem[];
  value?: string;
  onSelect: (model: string) => void;
  /** Lock selection to this protocol family (cross-family rows greyed out). */
  lockFamily?: 'anthropic' | 'openai';
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  panelClassName?: string;
  /** Extra footer note appended after the family-lock ribbon. */
  footerNote?: ReactNode;
}

const GROUP_ORDER = ['档位 (tier)', '具体模型'];

/**
 * The one model selector for berry-claw — used in the agent wizard, the agent
 * editor, and the in-chat model switch. Replaces every bare model `<select>`.
 */
export function ModelPicker({
  catalog,
  value,
  onSelect,
  lockFamily,
  placeholder = '选择模型',
  disabled,
  className,
  panelClassName,
  footerNote,
}: ModelPickerProps) {
  const options = catalogToOptions(catalog, lockFamily);
  const footer = lockFamily ? (
    <span>
      已锁定 <b className="text-zinc-300">{lockFamily === 'anthropic' ? 'Claude' : 'OpenAI'}</b> 协议家族
      —— 跨家族切换会破坏 prompt 缓存,故置灰。{footerNote}
    </span>
  ) : (
    footerNote ?? undefined
  );
  return (
    <PickerButton
      options={options}
      value={value}
      onSelect={onSelect}
      placeholder={placeholder}
      searchPlaceholder="搜索模型…"
      groupOrder={GROUP_ORDER}
      footer={footer}
      disabled={disabled}
      className={className}
      panelClassName={panelClassName}
      renderValue={(opt) => (
        <span className="flex min-w-0 items-center gap-2">
          <span className="truncate">{opt?.label ?? placeholder}</span>
        </span>
      )}
    />
  );
}
