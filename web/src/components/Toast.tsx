/**
 * Tiny toast system.
 *
 * Used for non-blocking, ephemeral signals (SDK retries, transient errors,
 * capability status) that shouldn't hijack the chat stream. Deliberately
 * zero-dependency — we already carry enough UI libs.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { AlertTriangle, Info, XCircle, X } from 'lucide-react';

export type ToastVariant = 'info' | 'warn' | 'error';

export interface ToastInit {
  id?: string;
  variant?: ToastVariant;
  title?: string;
  message: string;
  /** Auto-dismiss after this many ms. 0 = sticky. Default: 5000 */
  durationMs?: number;
}

interface ToastEntry extends Required<Omit<ToastInit, 'durationMs'>> {
  durationMs: number;
}

interface ToastContextValue {
  show: (init: ToastInit) => string;
  dismiss: (id: string) => void;
  /**
   * Upsert by id (replaces if exists). Useful for progress-style toasts
   * like "retry 1/3" → "retry 2/3".
   */
  update: (id: string, init: Partial<ToastInit> & { message: string }) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

/**
 * Module-level bridge so non-React code (e.g. legacy imperative call sites)
 * can still fire toasts. Set on ToastProvider mount, cleared on unmount.
 */
let activeDispatch: ToastContextValue | null = null;

/**
 * Legacy-compatible helper: accepts either the rich ToastInit object or the
 * short `showToast(message, variant?)` signature older call sites were using.
 */
export function showToast(init: ToastInit | string, variant?: ToastVariant): string {
  if (!activeDispatch) {
    // Drop silently; happens before mount or in tests without a provider.
    return '';
  }
  if (typeof init === 'string') {
    return activeDispatch.show({ message: init, variant });
  }
  return activeDispatch.show(init);
}

/** Default export kept for historical `import ToastContainer from './Toast'` call sites. */
export default function ToastContainer() {
  // The real viewport is mounted by ToastProvider; this default export stays
  // around only for import compatibility.
  return null;
}

let nextId = 1;
function genId(): string {
  return `toast-${nextId++}`;
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastEntry[]>([]);
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());

  const dismiss = useCallback((id: string) => {
    const timer = timers.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timers.current.delete(id);
    }
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const scheduleAutoDismiss = useCallback((id: string, durationMs: number) => {
    if (durationMs <= 0) return;
    const existing = timers.current.get(id);
    if (existing) clearTimeout(existing);
    timers.current.set(
      id,
      setTimeout(() => dismiss(id), durationMs),
    );
  }, [dismiss]);

  const show = useCallback((init: ToastInit): string => {
    const id = init.id ?? genId();
    const entry: ToastEntry = {
      id,
      variant: init.variant ?? 'info',
      title: init.title ?? '',
      message: init.message,
      durationMs: init.durationMs ?? 5000,
    };
    setToasts((prev) => {
      const without = prev.filter((t) => t.id !== id);
      return [...without, entry];
    });
    scheduleAutoDismiss(id, entry.durationMs);
    return id;
  }, [scheduleAutoDismiss]);

  const update = useCallback((id: string, init: Partial<ToastInit> & { message: string }) => {
    setToasts((prev) => {
      const idx = prev.findIndex((t) => t.id === id);
      if (idx < 0) {
        // Fall back to insert so callers don't have to check existence.
        const entry: ToastEntry = {
          id,
          variant: init.variant ?? 'info',
          title: init.title ?? '',
          message: init.message,
          durationMs: init.durationMs ?? 5000,
        };
        return [...prev, entry];
      }
      const current = prev[idx]!;
      const merged: ToastEntry = {
        id,
        variant: init.variant ?? current.variant,
        title: init.title ?? current.title,
        message: init.message,
        durationMs: init.durationMs ?? current.durationMs,
      };
      const next = prev.slice();
      next[idx] = merged;
      return next;
    });
    scheduleAutoDismiss(id, init.durationMs ?? 5000);
  }, [scheduleAutoDismiss]);

  // Cleanup on unmount
  useEffect(() => {
    const map = timers.current;
    return () => {
      for (const timer of map.values()) clearTimeout(timer);
      map.clear();
    };
  }, []);

  const value = useMemo<ToastContextValue>(() => ({ show, dismiss, update }), [show, dismiss, update]);

  useEffect(() => {
    activeDispatch = value;
    return () => {
      if (activeDispatch === value) activeDispatch = null;
    };
  }, [value]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <ToastViewport toasts={toasts} onClose={dismiss} />
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used inside <ToastProvider>');
  return ctx;
}

function ToastViewport({ toasts, onClose }: { toasts: ToastEntry[]; onClose: (id: string) => void }) {
  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-50 flex w-[360px] max-w-[90vw] flex-col gap-2">
      {toasts.map((t) => (
        <ToastItem key={t.id} toast={t} onClose={() => onClose(t.id)} />
      ))}
    </div>
  );
}

function ToastItem({ toast, onClose }: { toast: ToastEntry; onClose: () => void }) {
  const { variant } = toast;
  const palette =
    variant === 'error'
      ? 'border-red-500/60 bg-red-900/80 text-red-50'
      : variant === 'warn'
        ? 'border-amber-500/60 bg-amber-900/80 text-amber-50'
        : 'border-slate-500/60 bg-slate-900/85 text-slate-50';

  const Icon = variant === 'error' ? XCircle : variant === 'warn' ? AlertTriangle : Info;

  return (
    <div
      className={`pointer-events-auto flex gap-2 rounded-md border p-3 shadow-lg backdrop-blur ${palette}`}
      role="status"
    >
      <Icon className="mt-0.5 h-4 w-4 flex-shrink-0" />
      <div className="flex-1 text-sm leading-snug">
        {toast.title ? <div className="font-medium">{toast.title}</div> : null}
        <div className="opacity-90">{toast.message}</div>
      </div>
      <button
        onClick={onClose}
        className="flex-shrink-0 self-start rounded p-0.5 opacity-60 hover:opacity-100"
        aria-label="Dismiss"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}
