import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Check, Search } from 'lucide-react';
import { cn } from '../../utils/cn';

/**
 * A single choice in a Picker. `value` is what the caller gets back; the rest
 * is presentation. `disabled` greys the row and blocks selection (the
 * family-lock uses this). `group` buckets rows under a header; `badge` shows a
 * small pill on the right (e.g. the model family).
 */
export interface PickerOption<T extends string = string> {
  value: T;
  label: string;
  description?: string;
  badge?: ReactNode;
  icon?: ReactNode;
  group?: string;
  disabled?: boolean;
  /** Hidden from search-text matching control; matched on label+value+description by default. */
  keywords?: string;
}

export interface PickerProps<T extends string = string> {
  options: PickerOption<T>[];
  value?: T;
  onSelect: (value: T) => void;
  /** Placeholder for the search box. Omit to hide search entirely. */
  searchPlaceholder?: string;
  /** Stable ordering of group headers; groups not listed fall to the end. */
  groupOrder?: string[];
  /** Rendered under the list — e.g. the family-lock explainer ribbon. */
  footer?: ReactNode;
  /** Shown when the (filtered) list is empty. */
  emptyText?: string;
  /** Autofocus the search box on mount (popover/modal open). */
  autoFocus?: boolean;
  className?: string;
  maxHeightClass?: string;
}

/**
 * Pure view-builder: filter options by query, bucket into ordered groups, and
 * produce the flat render rows plus the parallel list of selectable options
 * (disabled rows are rendered but excluded from keyboard nav / selection).
 * Extracted so the tricky grouping + filter logic is unit-testable without a
 * DOM renderer.
 */
export function computePickerView<T extends string>(
  options: PickerOption<T>[],
  query: string,
  groupOrder?: string[],
): {
  rows: Array<{ kind: 'header'; group: string } | { kind: 'option'; option: PickerOption<T>; selIndex: number }>;
  selectable: PickerOption<T>[];
} {
  const q = query.trim().toLowerCase();
  const filtered = !q
    ? options
    : options.filter((o) =>
        `${o.label} ${o.value} ${o.description ?? ''} ${o.keywords ?? ''}`.toLowerCase().includes(q),
      );

  const groups = new Map<string, PickerOption<T>[]>();
  for (const o of filtered) {
    const g = o.group ?? '';
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g)!.push(o);
  }
  const order = (a: string, b: string) => {
    const ia = groupOrder?.indexOf(a) ?? -1;
    const ib = groupOrder?.indexOf(b) ?? -1;
    if (ia !== -1 || ib !== -1) return (ia === -1 ? Infinity : ia) - (ib === -1 ? Infinity : ib);
    return a.localeCompare(b);
  };
  const sortedGroups = [...groups.keys()].sort(order);
  const rows: Array<{ kind: 'header'; group: string } | { kind: 'option'; option: PickerOption<T>; selIndex: number }> = [];
  const selectable: PickerOption<T>[] = [];
  for (const g of sortedGroups) {
    if (g) rows.push({ kind: 'header', group: g });
    for (const o of groups.get(g)!) {
      if (o.disabled) {
        rows.push({ kind: 'option', option: o, selIndex: -1 });
      } else {
        rows.push({ kind: 'option', option: o, selIndex: selectable.length });
        selectable.push(o);
      }
    }
  }
  return { rows, selectable };
}
export function Picker<T extends string = string>({
  options,
  value,
  onSelect,
  searchPlaceholder,
  groupOrder,
  footer,
  emptyText = '无匹配项',
  autoFocus = true,
  className,
  maxHeightClass = 'max-h-72',
}: PickerProps<T>) {
  const [query, setQuery] = useState('');
  const [highlight, setHighlight] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  const searchable = searchPlaceholder !== undefined;

  const { rows, selectable } = useMemo(
    () => computePickerView(options, query, groupOrder),
    [options, query, groupOrder],
  );

  // Keep the highlight in range as the filter narrows; prefer the current value.
  useEffect(() => {
    const idx = selectable.findIndex((o) => o.value === value);
    setHighlight(idx >= 0 ? idx : 0);
  }, [selectable, value]);

  useEffect(() => {
    const el = listRef.current?.querySelector('[data-highlighted="true"]');
    el?.scrollIntoView({ block: 'nearest' });
  }, [highlight]);

  const onKeyDown = (ev: React.KeyboardEvent) => {
    if (ev.key === 'ArrowDown') {
      ev.preventDefault();
      setHighlight((h) => Math.min(h + 1, selectable.length - 1));
    } else if (ev.key === 'ArrowUp') {
      ev.preventDefault();
      setHighlight((h) => Math.max(h - 1, 0));
    } else if (ev.key === 'Enter') {
      ev.preventDefault();
      const opt = selectable[highlight];
      if (opt) onSelect(opt.value);
    }
  };

  return (
    <div className={cn('flex flex-col', className)} onKeyDown={onKeyDown}>
      {searchable && (
        <div className="relative border-b border-white/[0.07] px-3 py-2">
          <Search size={13} className="pointer-events-none absolute left-5 top-1/2 -translate-y-1/2 text-zinc-500" />
          <input
            // eslint-disable-next-line jsx-a11y/no-autofocus
            autoFocus={autoFocus}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={searchPlaceholder}
            className="w-full rounded-lg bg-white/[0.04] py-1.5 pl-7 pr-2 text-sm text-zinc-100 placeholder:text-zinc-600 outline-none focus:bg-white/[0.06]"
          />
        </div>
      )}
      <div ref={listRef} className={cn('overflow-y-auto p-1.5', maxHeightClass)}>
        {selectable.length === 0 ? (
          <div className="px-3 py-6 text-center text-xs text-zinc-600">{emptyText}</div>
        ) : (
          rows.map((row, i) =>
            row.kind === 'header' ? (
              <div key={`h-${row.group}-${i}`} className="px-2 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wide text-zinc-600">
                {row.group}
              </div>
            ) : (
              <PickerRow
                key={`o-${row.option.value}`}
                option={row.option}
                selected={row.option.value === value}
                highlighted={row.selIndex >= 0 && row.selIndex === highlight}
                onHover={() => row.selIndex >= 0 && setHighlight(row.selIndex)}
                onClick={() => !row.option.disabled && onSelect(row.option.value)}
              />
            ),
          )
        )}
      </div>
      {footer && <div className="border-t border-white/[0.07] px-3 py-2 text-[11px] leading-relaxed text-zinc-500">{footer}</div>}
    </div>
  );
}

function PickerRow<T extends string>({
  option,
  selected,
  highlighted,
  onHover,
  onClick,
}: {
  option: PickerOption<T>;
  selected: boolean;
  highlighted: boolean;
  onHover: () => void;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      data-highlighted={highlighted}
      disabled={option.disabled}
      onMouseEnter={onHover}
      onClick={onClick}
      className={cn(
        'flex w-full items-center gap-3 rounded-lg border px-3 py-2 text-left transition-colors',
        option.disabled
          ? 'cursor-not-allowed border-transparent opacity-40'
          : highlighted
            ? 'border-sky-200/24 bg-sky-200/[0.075]'
            : selected
              ? 'border-sky-200/16 bg-sky-200/[0.05]'
              : 'border-transparent hover:border-sky-200/16 hover:bg-sky-200/[0.055]',
      )}
    >
      {option.icon && <span className="shrink-0 text-zinc-400">{option.icon}</span>}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium text-zinc-100">{option.label}</span>
        {option.description && <span className="mt-0.5 block truncate text-[11px] text-zinc-500">{option.description}</span>}
      </span>
      {option.badge && <span className="shrink-0">{option.badge}</span>}
      {selected && <Check size={14} className="shrink-0 text-sky-300" />}
    </button>
  );
}
