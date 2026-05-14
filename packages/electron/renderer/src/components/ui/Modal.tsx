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
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className={`bg-white dark:bg-gray-900 rounded-lg shadow-xl ${SIZE_CLASS[size]} w-full mx-4 border border-gray-200 dark:border-gray-700 ${className}`}
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
    <div className="px-5 py-4 border-b border-gray-200 dark:border-gray-700">{children}</div>
  );
}

export function ModalBody({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`px-5 py-4 space-y-3 text-sm ${className}`}>{children}</div>;
}

export function ModalFooter({ children }: { children: ReactNode }) {
  return (
    <div className="px-5 py-3 border-t border-gray-200 dark:border-gray-700 flex justify-end gap-2">
      {children}
    </div>
  );
}
