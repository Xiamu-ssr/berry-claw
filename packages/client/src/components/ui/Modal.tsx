import { useEffect, type ReactNode } from 'react';

/**
 * Shared modal chrome.
 *
 * Small on purpose — the modal is just a backdrop + a centered card. Every
 * actual dialog (SafetyAsk, ReplaceKey, AddInstance) composes this with its
 * own header / body / footer. Tailwind classes mirror what SafetyAskDialog
 * shipped originally so visual regression is zero when we migrate it over.
 *
 * Behaviours baked in here:
 *   - ESC closes (only when `onClose` is provided — modals that must be
 *     resolved via an explicit button omit it).
 *   - Clicking the backdrop triggers `onClose`; clicks inside the card
 *     bubble is stopped so text selection etc. still works.
 *   - No focus trap yet — acceptable for one-at-a-time dialogs; revisit if
 *     we ever stack modals.
 */
export interface ModalProps {
  open: boolean;
  onClose?: () => void;
  children: ReactNode;
  /**
   * Size preset mapped to tailwind max-w-*. Most dialogs fit in `md`
   * (max-w-lg); forms with long textareas use `lg` (max-w-2xl).
   */
  size?: 'sm' | 'md' | 'lg';
  /** Optional extra classes applied to the inner card. */
  className?: string;
}

const SIZE_CLASS: Record<NonNullable<ModalProps['size']>, string> = {
  sm: 'max-w-sm',
  md: 'max-w-lg',
  lg: 'max-w-2xl',
};

export function Modal({ open, onClose, children, size = 'md', className = '' }: ModalProps) {
  useEffect(() => {
    if (!open || !onClose) return;
    const handler = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className={`w-full overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-xl dark:border-white/[0.08] dark:bg-[#20242a] dark:shadow-[0_24px_80px_rgba(0,0,0,0.32)] ${SIZE_CLASS[size]} ${className}`}
        onClick={(ev) => ev.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        {children}
      </div>
    </div>
  );
}

/** Convenience sub-components so every dialog has the same vertical rhythm. */
export function ModalHeader({ children }: { children: ReactNode }) {
  return (
    <div className="border-b border-gray-200 bg-gray-50/70 px-5 py-4 dark:border-white/[0.07] dark:bg-[#1d2126]/85">{children}</div>
  );
}

export function ModalBody({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`space-y-3 px-5 py-4 text-sm ${className}`}>{children}</div>;
}

export function ModalFooter({ children }: { children: ReactNode }) {
  return (
    <div className="flex justify-end gap-2 border-t border-gray-200 bg-gray-50/70 px-5 py-3 dark:border-white/[0.07] dark:bg-black/10">
      {children}
    </div>
  );
}
