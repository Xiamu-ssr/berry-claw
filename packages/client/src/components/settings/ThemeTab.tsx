import { useState } from 'react';
import { Check, Palette } from 'lucide-react';
import { cn } from '../../utils/cn';

const THEMES = [
  { name: 'Sky Blue', hsl: '199 89% 48%' },
  { name: 'Emerald', hsl: '160 84% 39%' },
  { name: 'Amethyst', hsl: '270 95% 65%' },
  { name: 'Amber', hsl: '43 96% 56%' },
  { name: 'Rose', hsl: '346 87% 60%' },
];

export default function ThemeTab() {
  const [currentHsl, setCurrentHsl] = useState(() => {
    return localStorage.getItem('berry-theme-hsl') || '199 89% 48%';
  });

  const setTheme = (hsl: string) => {
    document.documentElement.style.setProperty('--theme-primary-hsl', hsl);
    localStorage.setItem('berry-theme-hsl', hsl);
    setCurrentHsl(hsl);
  };

  return (
    <section className="rounded-2xl border border-white/[0.04] bg-[#1a1c20]/50 shadow-sm backdrop-blur-md p-6">
      <div className="mb-6">
        <h2 className="text-lg font-semibold text-zinc-100 flex items-center gap-2.5">
          <Palette size={20} className="text-[var(--theme-primary)]" /> UI Theme
        </h2>
        <p className="text-[13px] text-zinc-500 mt-2 leading-relaxed max-w-2xl">
          Customize the accent color of the workspace. The theme state is saved locally in your browser.
        </p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        {THEMES.map((theme) => {
          const isActive = currentHsl === theme.hsl;
          return (
            <button
              key={theme.name}
              onClick={() => setTheme(theme.hsl)}
              className={cn(
                'group relative flex flex-col items-center justify-center gap-3 rounded-2xl border p-5 transition-all duration-300',
                isActive
                  ? 'border-[var(--theme-primary-hover)] bg-[var(--theme-primary-soft)] shadow-[0_0_20px_var(--theme-primary-soft)]'
                  : 'border-white/[0.04] bg-white/[0.01] hover:border-white/[0.08] hover:bg-white/[0.03]',
              )}
            >
              <div
                className="w-10 h-10 rounded-full shadow-lg transition-transform group-hover:scale-110"
                style={{
                  backgroundColor: `hsl(${theme.hsl})`,
                  boxShadow: isActive ? `0 0 20px hsla(${theme.hsl} / 0.5)` : 'none',
                }}
              />
              <span className={cn(
                'text-[12px] font-semibold tracking-wide',
                isActive ? 'text-zinc-100' : 'text-zinc-500 group-hover:text-zinc-300',
              )}>
                {theme.name}
              </span>
              {isActive && (
                <div className="absolute top-3 right-3 text-[var(--theme-primary)]">
                  <Check size={14} />
                </div>
              )}
            </button>
          );
        })}
      </div>
    </section>
  );
}
