import { useState } from 'react';
import { Check, ChevronDown, Plug } from 'lucide-react';
import { setActive, useActiveInstance, useInstances } from '../connection';

/**
 * Tiny sidebar dropdown for switching between connected instances.
 *
 * Intentionally dumb: renders the active instance name + a popover list.
 * Clicking another entry calls `setActive`, which — because every consumer
 * is mounted under `<AppForInstance key={activeId}/>` in ConnectionGate —
 * cleanly remounts the whole app state. No need for WebSocket cleanup logic
 * here; React's key-change cleanup handles it.
 *
 * The "Manage connections…" link is a soft nav: it emits a CustomEvent that
 * the App layer listens for and uses to flip SettingsPage onto the
 * 'connections' tab. Avoids hard-coupling this picker to the tab system.
 */
export function InstancePicker() {
  const instances = useInstances();
  const active = useActiveInstance();
  const [open, setOpen] = useState(false);

  if (!active) return null;

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between px-2.5 py-1.5 rounded text-sm bg-gray-100 hover:bg-gray-200 dark:bg-gray-800 dark:hover:bg-gray-700 text-gray-800 dark:text-gray-100"
      >
        <span className="flex items-center gap-1.5 min-w-0">
          <Plug size={13} className="shrink-0 opacity-60" />
          <span className="truncate">{active.name}</span>
        </span>
        <ChevronDown size={13} className="opacity-60 shrink-0" />
      </button>

      {open && (
        <>
          {/* Backdrop to dismiss on outside click */}
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute z-50 mt-1 w-64 rounded-md border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 shadow-lg overflow-hidden">
            <ul className="py-1 max-h-80 overflow-y-auto">
              {instances.map((inst) => (
                <li key={inst.id}>
                  <button
                    onClick={() => {
                      setActive(inst.id);
                      setOpen(false);
                    }}
                    className="w-full text-left px-3 py-1.5 text-sm flex items-center justify-between hover:bg-gray-100 dark:hover:bg-gray-800"
                  >
                    <span className="flex-1 min-w-0">
                      <span className="block text-gray-800 dark:text-gray-100 truncate">
                        {inst.name}
                      </span>
                      <span className="block text-[10px] text-gray-500 font-mono truncate">
                        {inst.apiBase}
                      </span>
                    </span>
                    {inst.id === active.id && (
                      <Check size={14} className="text-teal-300 shrink-0" />
                    )}
                  </button>
                </li>
              ))}
            </ul>
            <div className="border-t border-gray-200 dark:border-gray-700">
              <button
                onClick={() => {
                  setOpen(false);
                  window.dispatchEvent(
                    new CustomEvent('berry-claw:open-connections-tab'),
                  );
                }}
                className="w-full text-left px-3 py-1.5 text-xs text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800"
              >
                Manage connections…
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
