import type * as React from 'react';
import {
  Palette,
  Plug,
} from 'lucide-react';
import type { SettingsTabId } from './types';

interface SettingsNavProps {
  active: SettingsTabId;
  onChange: (tab: SettingsTabId) => void;
}

export default function SettingsNav({ active, onChange }: SettingsNavProps) {
  const items: Array<{ id: SettingsTabId; label: string; icon: React.ReactNode }> = [
    { id: 'connections', label: '后端实例', icon: <Plug size={15} /> },
    { id: 'theme', label: '外观主题', icon: <Palette size={15} /> },
  ];

  return (
    <div className="rounded-2xl border border-white/[0.04] bg-white/[0.02] p-1.5 backdrop-blur-md">
      <div className="grid gap-1 md:grid-cols-2">
        {items.map((item) => (
          <button
            key={item.id}
            onClick={() => onChange(item.id)}
            className={`flex min-h-[52px] items-center gap-3 rounded-xl px-4 py-2 text-left transition-all duration-200 ${
              active === item.id
                ? 'bg-white/[0.06] text-zinc-100 shadow-sm border border-white/[0.04]'
                : 'text-zinc-500 hover:bg-white/[0.03] hover:text-zinc-300 border border-transparent'
            }`}
          >
            <span className={active === item.id ? 'text-[var(--theme-primary)]' : 'text-zinc-500 group-hover:text-zinc-400'}>{item.icon}</span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[13px] font-semibold tracking-wide">{item.label}</span>
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
