import type { ReactNode } from 'react';
import { Loader2 } from 'lucide-react';

export function WorkbenchPage({
  title,
  eyebrow,
  description,
  actions,
  children,
}: {
  title: string;
  eyebrow?: string;
  description?: string;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-[#0e0f11] text-zinc-200">
      <header className="flex min-h-16 items-center justify-between gap-4 border-b border-white/[0.07] px-5 py-4">
        <div className="min-w-0">
          {eyebrow && <div className="text-[11px] font-medium uppercase tracking-wide text-emerald-300/80">{eyebrow}</div>}
          <h1 className="truncate text-base font-semibold text-zinc-50">{title}</h1>
          {description && <p className="mt-1 max-w-3xl truncate text-sm text-zinc-500">{description}</p>}
        </div>
        {actions && <div className="flex flex-shrink-0 items-center gap-2">{actions}</div>}
      </header>
      {children}
    </div>
  );
}

export function SplitWorkbench({
  left,
  children,
  right,
  leftClassName = '',
}: {
  left: ReactNode;
  children: ReactNode;
  right?: ReactNode;
  leftClassName?: string;
}) {
  return (
    <div className="grid h-[calc(100vh-64px)] min-h-0 grid-cols-[320px_minmax(0,1fr)] max-lg:grid-cols-1">
      <aside className={`min-h-0 overflow-y-auto border-r border-white/[0.07] bg-[#0b0c0d] ${leftClassName}`}>
        {left}
      </aside>
      <section className="min-h-0 overflow-y-auto">
        <div className={right ? 'grid min-h-full grid-cols-[minmax(0,1fr)_300px] max-2xl:grid-cols-1' : ''}>
          <div className="min-w-0">{children}</div>
          {right && <aside className="border-l border-white/[0.07] bg-[#0a0b0c] max-2xl:hidden">{right}</aside>}
        </div>
      </section>
    </div>
  );
}

export function SectionCard({
  title,
  subtitle,
  icon,
  action,
  children,
  className = '',
}: {
  title?: string;
  subtitle?: string;
  icon?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`rounded-xl border border-white/[0.08] bg-white/[0.035] ${className}`}>
      {(title || action) && (
        <div className="flex items-start justify-between gap-3 border-b border-white/[0.07] px-4 py-3">
          <div className="min-w-0">
            {title && (
              <div className="flex items-center gap-2 text-sm font-medium text-zinc-100">
                {icon && <span className="text-zinc-500">{icon}</span>}
                <span className="truncate">{title}</span>
              </div>
            )}
            {subtitle && <p className="mt-1 text-xs text-zinc-500">{subtitle}</p>}
          </div>
          {action && <div className="flex-shrink-0">{action}</div>}
        </div>
      )}
      <div className="p-4">{children}</div>
    </section>
  );
}

export function EmptyState({
  icon,
  title,
  body,
  action,
}: {
  icon?: ReactNode;
  title: string;
  body?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex min-h-[260px] flex-col items-center justify-center rounded-xl border border-dashed border-white/[0.10] bg-white/[0.02] px-6 text-center">
      {icon && <div className="mb-3 text-zinc-600">{icon}</div>}
      <div className="text-sm font-medium text-zinc-200">{title}</div>
      {body && <div className="mt-1 max-w-md text-sm text-zinc-500">{body}</div>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function StatTile({ label, value, hint }: { label: string; value: ReactNode; hint?: string }) {
  return (
    <div className="rounded-lg border border-white/[0.07] bg-black/20 px-3 py-2">
      <div className="text-[10px] uppercase tracking-wide text-zinc-600">{label}</div>
      <div className="mt-1 truncate text-sm font-medium text-zinc-100">{value}</div>
      {hint && <div className="mt-0.5 truncate text-[11px] text-zinc-600">{hint}</div>}
    </div>
  );
}

export function Pill({
  children,
  tone = 'neutral',
  title,
}: {
  children: ReactNode;
  tone?: 'neutral' | 'good' | 'warn' | 'bad' | 'info';
  title?: string;
}) {
  const cls =
    tone === 'good'
      ? 'border-emerald-400/20 bg-emerald-400/10 text-emerald-300'
      : tone === 'warn'
        ? 'border-amber-400/20 bg-amber-400/10 text-amber-300'
        : tone === 'bad'
          ? 'border-red-400/20 bg-red-400/10 text-red-300'
          : tone === 'info'
            ? 'border-sky-400/20 bg-sky-400/10 text-sky-300'
            : 'border-white/[0.08] bg-white/[0.05] text-zinc-400';
  return (
    <span title={title} className={`inline-flex max-w-full items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10px] ${cls}`}>
      {children}
    </span>
  );
}

export function StatusDot({
  status,
  ok,
}: {
  status?: string;
  ok?: boolean;
}) {
  const cls =
    ok === true || status === 'idle' || status === 'connected'
      ? 'bg-emerald-400'
      : ok === false || status === 'error' || status === 'failed'
        ? 'bg-red-400'
        : status === 'sleeping' || status === 'disabled'
          ? 'bg-zinc-500'
          : status
            ? 'bg-sky-400 animate-pulse'
            : 'bg-zinc-600';
  return <span className={`h-2 w-2 flex-shrink-0 rounded-full ${cls}`} />;
}

export function PrimaryButton({
  children,
  onClick,
  disabled,
  type = 'button',
}: {
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  type?: 'button' | 'submit';
}) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className="inline-flex h-8 items-center gap-1.5 rounded-md bg-emerald-400 px-3 text-xs font-medium text-zinc-950 transition-colors hover:bg-emerald-300 disabled:cursor-not-allowed disabled:opacity-40"
    >
      {children}
    </button>
  );
}

export function SecondaryButton({
  children,
  onClick,
  disabled,
  title,
  tone = 'neutral',
}: {
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  title?: string;
  tone?: 'neutral' | 'bad';
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`inline-flex h-8 items-center gap-1.5 rounded-md border px-3 text-xs transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
        tone === 'bad'
          ? 'border-red-400/20 bg-red-400/10 text-red-300 hover:bg-red-400/15'
          : 'border-white/[0.08] bg-white/[0.04] text-zinc-300 hover:bg-white/[0.08] hover:text-zinc-100'
      }`}
    >
      {children}
    </button>
  );
}

export function IconButton({
  children,
  onClick,
  disabled,
  title,
  tone = 'neutral',
}: {
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  title: string;
  tone?: 'neutral' | 'bad' | 'good';
}) {
  const toneClass =
    tone === 'bad'
      ? 'text-zinc-500 hover:bg-red-400/10 hover:text-red-300'
      : tone === 'good'
        ? 'text-zinc-500 hover:bg-emerald-400/10 hover:text-emerald-300'
        : 'text-zinc-500 hover:bg-white/[0.07] hover:text-zinc-100';
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      disabled={disabled}
      className={`inline-flex h-8 w-8 items-center justify-center rounded-md transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${toneClass}`}
    >
      {children}
    </button>
  );
}

export function TextInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={`h-9 rounded-md border border-white/[0.08] bg-black/20 px-3 text-sm text-zinc-100 outline-none placeholder:text-zinc-600 focus:border-emerald-400/40 disabled:cursor-not-allowed disabled:opacity-50 ${props.className ?? ''}`}
    />
  );
}

export function SelectInput(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      {...props}
      className={`h-9 rounded-md border border-white/[0.08] bg-[#111315] px-3 text-sm text-zinc-100 outline-none focus:border-emerald-400/40 disabled:cursor-not-allowed disabled:opacity-50 ${props.className ?? ''}`}
    />
  );
}

export function TextArea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      {...props}
      className={`rounded-md border border-white/[0.08] bg-black/20 px-3 py-2 text-sm text-zinc-100 outline-none placeholder:text-zinc-600 focus:border-emerald-400/40 disabled:cursor-not-allowed disabled:opacity-50 ${props.className ?? ''}`}
    />
  );
}

export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <label className="block">
      <div className="mb-1 flex items-center justify-between gap-2">
        <span className="text-xs font-medium text-zinc-400">{label}</span>
        {hint && <span className="text-[10px] text-zinc-600">{hint}</span>}
      </div>
      {children}
    </label>
  );
}

export function InlineSpinner({ label = 'Loading' }: { label?: string }) {
  return (
    <div className="flex items-center gap-2 text-sm text-zinc-500">
      <Loader2 size={14} className="animate-spin" />
      {label}
    </div>
  );
}
