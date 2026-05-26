import type { ReactNode } from 'react';
import { useEffect, useRef, useState } from 'react';
import { Check, ChevronDown } from 'lucide-react';
import { RAW_PRESET_ID } from '@berry-agent/claw-contracts/model-config';
import type { ConfigProviderPreset as ProviderPreset } from '@berry-agent/claw-contracts';

export function FormField({ label, hint, className, children }: {
  label: string;
  hint?: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={className}>
      <div className="mb-1 flex items-baseline justify-between">
        <label className="text-xs font-medium text-zinc-400">{label}</label>
        {hint && <span className="text-xs text-zinc-600">{hint}</span>}
      </div>
      {children}
    </div>
  );
}

function ProtocolPill({ type }: { type: 'anthropic' | 'openai' }) {
  return (
    <span
      className={`shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-medium ${
        type === 'anthropic'
          ? 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300'
          : 'bg-teal-100 text-teal-700 dark:bg-teal-300/10 dark:text-teal-200'
      }`}
    >
      {type === 'anthropic' ? 'Anthropic' : 'OpenAI'}
    </span>
  );
}

export function PresetCombobox({ value, onChange, presets }: {
  value: string;
  onChange: (presetId: string) => void;
  presets: ProviderPreset[];
}) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDocClick = (event: MouseEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [open]);

  const selected = presets.find(preset => preset.id === value);
  const isRawSelected = value === RAW_PRESET_ID;

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen(current => !current)}
        className="settings-input flex w-full cursor-pointer items-center justify-between gap-2 text-left"
      >
        {selected ? (
          <span className="flex min-w-0 flex-1 items-center gap-2">
            <span className="truncate font-medium text-zinc-100">{selected.name}</span>
            <ProtocolPill type={selected.type} />
            {selected.baseUrl && (
              <span className="hidden truncate font-mono text-xs text-zinc-600 sm:inline">
                {selected.baseUrl}
              </span>
            )}
          </span>
        ) : isRawSelected ? (
          <span className="text-zinc-300">Custom (raw endpoint)</span>
        ) : (
          <span className="text-zinc-600">Select a provider preset...</span>
        )}
        <ChevronDown
          size={14}
          className={`shrink-0 text-gray-400 transition-transform ${open ? 'rotate-180' : ''}`}
        />
      </button>

      {open && (
        <div className="absolute left-0 right-0 z-20 mt-1 max-h-80 overflow-auto rounded-lg border border-white/[0.08] bg-[#20242a]/75 py-1 shadow-lg">
          {presets.map(preset => {
            const isActive = preset.id === value;
            return (
              <button
                key={preset.id}
                type="button"
                onClick={() => {
                  onChange(preset.id);
                  setOpen(false);
                }}
                className={`flex w-full items-center gap-2 px-3 py-2 text-left transition-colors ${
                  isActive ? 'bg-teal-300/10' : 'hover:bg-gray-50 dark:hover:bg-gray-700/50'
                }`}
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-sm font-medium text-zinc-100">{preset.name}</span>
                    <ProtocolPill type={preset.type} />
                  </div>
                  {preset.baseUrl && (
                    <div className="mt-0.5 truncate font-mono text-xs text-zinc-500">
                      {preset.baseUrl}
                    </div>
                  )}
                </div>
                {isActive && <Check size={14} className="shrink-0 text-berry-600 dark:text-berry-400" />}
              </button>
            );
          })}
          <div className="my-1 border-t border-gray-100 dark:border-gray-700" />
          <button
            type="button"
            onClick={() => {
              onChange(RAW_PRESET_ID);
              setOpen(false);
            }}
            className={`flex w-full items-center gap-2 px-3 py-2 text-left transition-colors ${
              isRawSelected ? 'bg-teal-300/10' : 'hover:bg-gray-50 dark:hover:bg-gray-700/50'
            }`}
          >
            <div className="flex-1">
              <div className="text-sm font-medium text-zinc-100">Custom (raw endpoint)</div>
              <div className="mt-0.5 text-xs text-zinc-500">
                Manually specify baseUrl, protocol, and known models
              </div>
            </div>
            {isRawSelected && <Check size={14} className="shrink-0 text-berry-600 dark:text-berry-400" />}
          </button>
        </div>
      )}
    </div>
  );
}
