import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';
import { cn } from '../../utils/cn';
import { Picker, type PickerOption } from './Picker';

export interface PickerButtonProps<T extends string = string> {
  options: PickerOption<T>[];
  value?: T;
  onSelect: (value: T) => void;
  /** Text when nothing is selected. */
  placeholder?: string;
  searchPlaceholder?: string;
  groupOrder?: string[];
  footer?: ReactNode;
  emptyText?: string;
  disabled?: boolean;
  /** Optional leading element inside the trigger (e.g. a status dot). */
  leading?: ReactNode;
  className?: string;
  /** Popover panel width. Defaults to matching the trigger. */
  panelClassName?: string;
  /** Render the selected option's label differently (e.g. mono). */
  renderValue?: (option: PickerOption<T> | undefined) => ReactNode;
}

/**
 * A dropdown trigger that opens a {@link Picker} in a popover — the drop-in
 * replacement for the project's bare `<SelectInput>`. Closes on outside-click,
 * Esc, and selection. Use this everywhere a user would otherwise type or pick
 * from a native select.
 */
export function PickerButton<T extends string = string>({
  options,
  value,
  onSelect,
  placeholder = '选择…',
  searchPlaceholder = '搜索…',
  groupOrder,
  footer,
  emptyText,
  disabled,
  leading,
  className,
  panelClassName,
  renderValue,
}: PickerButtonProps<T>) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const selected = options.find((o) => o.value === value);

  useEffect(() => {
    if (!open) return;
    const onDoc = (ev: MouseEvent) => {
      if (!rootRef.current?.contains(ev.target as Node)) setOpen(false);
    };
    const onEsc = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onEsc);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onEsc);
    };
  }, [open]);

  return (
    <div ref={rootRef} className={cn('relative', className)}>
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
        className={cn(
          'flex w-full items-center gap-2 rounded-lg border border-white/[0.10] bg-white/[0.03] px-3 py-2 text-left text-sm transition-colors',
          disabled ? 'cursor-not-allowed opacity-50' : 'hover:border-sky-200/24 hover:bg-white/[0.05]',
        )}
      >
        {leading}
        <span className={cn('min-w-0 flex-1 truncate', selected ? 'text-zinc-100' : 'text-zinc-500')}>
          {renderValue ? renderValue(selected) : selected?.label ?? placeholder}
        </span>
        {selected?.badge}
        <ChevronDown size={14} className={cn('shrink-0 text-zinc-500 transition-transform', open && 'rotate-180')} />
      </button>
      {open && (
        <div
          className={cn(
            'absolute left-0 z-40 mt-1 w-full min-w-[16rem] overflow-hidden rounded-xl border border-white/[0.10] bg-[#1a1d21] shadow-2xl',
            panelClassName,
          )}
        >
          <Picker
            options={options}
            value={value}
            onSelect={(v) => {
              onSelect(v);
              setOpen(false);
            }}
            searchPlaceholder={options.length > 7 ? searchPlaceholder : undefined}
            groupOrder={groupOrder}
            footer={footer}
            emptyText={emptyText}
          />
        </div>
      )}
    </div>
  );
}
