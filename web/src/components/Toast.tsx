import { useState, useEffect, useCallback } from 'react';
import { CheckCircle, XCircle, X } from 'lucide-react';

export interface ToastMessage {
  id: number;
  text: string;
  type: 'success' | 'error';
}

let toastId = 0;
let addToastFn: ((text: string, type: 'success' | 'error') => void) | null = null;

/** Show a toast from anywhere */
export function showToast(text: string, type: 'success' | 'error' = 'success') {
  addToastFn?.(text, type);
}

export default function ToastContainer() {
  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  const addToast = useCallback((text: string, type: 'success' | 'error') => {
    const id = ++toastId;
    setToasts(prev => [...prev, { id, text, type }]);
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 3000);
  }, []);

  useEffect(() => {
    addToastFn = addToast;
    return () => { addToastFn = null; };
  }, [addToast]);

  const dismiss = (id: number) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  };

  if (toasts.length === 0) return null;

  return (
    <div className="fixed top-4 right-4 z-[100] flex flex-col gap-2">
      {toasts.map(toast => (
        <div
          key={toast.id}
          className={`flex items-center gap-2 px-4 py-3 rounded-lg shadow-lg text-sm font-medium animate-slide-in ${
            toast.type === 'success'
              ? 'bg-green-50 text-green-800 border border-green-200'
              : 'bg-red-50 text-red-800 border border-red-200'
          }`}
        >
          {toast.type === 'success'
            ? <CheckCircle size={16} className="text-green-500 flex-shrink-0" />
            : <XCircle size={16} className="text-red-500 flex-shrink-0" />}
          <span className="flex-1">{toast.text}</span>
          <button onClick={() => dismiss(toast.id)} className="text-gray-400 hover:text-gray-600 ml-2">
            <X size={14} />
          </button>
        </div>
      ))}
    </div>
  );
}
