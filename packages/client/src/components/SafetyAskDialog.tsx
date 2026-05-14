/**
 * SafetyAskDialog — human-in-the-loop approval UI.
 *
 * Rendered when the server-side askList guard has suspended a tool call
 * and broadcast a `safety_ask` WS event. The user decides approve / deny;
 * a note can be attached. Submission POSTs to /api/safety/ask/:id and the
 * server resolves the pending Promise, letting the tool proceed or bounce
 * with a "human denied" ToolGuardDecision.
 *
 * Multiple concurrent asks stack — we only render the oldest; the server
 * emits `safety_ask_resolved` on settle, which the parent uses to drop
 * the entry from the queue.
 */

import { useState } from 'react';
import { API, apiFetch } from '../api/paths';
import { Modal, ModalBody, ModalFooter, ModalHeader } from './ui/Modal';

export interface PendingSafetyAsk {
  id: string;
  question: {
    toolName: string;
    input: Record<string, unknown>;
    session: { id: string; cwd: string; model: string };
    reason?: string;
  };
}

export function SafetyAskDialog({
  ask,
  onResolved,
}: {
  ask: PendingSafetyAsk | null;
  onResolved: (id: string) => void;
}) {
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const send = async (approved: boolean) => {
    if (!ask) return;
    setSubmitting(true);
    try {
      await apiFetch(API.safetyAskResolve(ask.id), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ approved, note: note.trim() || undefined }),
      });
      onResolved(ask.id);
      setNote('');
    } finally {
      setSubmitting(false);
    }
  };

  const inputPreview = ask ? JSON.stringify(ask.question.input, null, 2) : '';

  return (
    <Modal open={!!ask}>
      {ask && (
        <>
          <ModalHeader>
            <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100 flex items-center gap-2">
              <span className="text-amber-500">⚠</span>
              Agent requesting human approval
            </h3>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
              Safety mode <span className="font-mono">auto</span> intercepted this call.
            </p>
          </ModalHeader>

          <ModalBody>
            <div>
              <div className="text-xs text-gray-400 mb-1">Tool</div>
              <div className="font-mono text-gray-800 dark:text-gray-200">
                {ask.question.toolName}
              </div>
            </div>

            {ask.question.reason && (
              <div>
                <div className="text-xs text-gray-400 mb-1">Reason</div>
                <div className="text-gray-700 dark:text-gray-300">{ask.question.reason}</div>
              </div>
            )}

            <div>
              <div className="text-xs text-gray-400 mb-1">Input</div>
              <pre className="bg-gray-50 dark:bg-gray-800 rounded px-2 py-1.5 text-xs font-mono text-gray-700 dark:text-gray-300 overflow-auto max-h-48 whitespace-pre-wrap">
                {inputPreview}
              </pre>
            </div>

            <div>
              <div className="text-xs text-gray-400 mb-1">Session</div>
              <div className="text-xs font-mono text-gray-600 dark:text-gray-400">
                {ask.question.session.id.slice(0, 8)} · {ask.question.session.cwd}
              </div>
            </div>

            <div>
              <label className="text-xs text-gray-400 mb-1 block">Note (optional)</label>
              <input
                type="text"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Explain your decision..."
                className="w-full px-2 py-1.5 text-sm rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200"
              />
            </div>
          </ModalBody>

          <ModalFooter>
            <button
              onClick={() => send(false)}
              disabled={submitting}
              className="px-3 py-1.5 text-sm rounded bg-red-600 hover:bg-red-700 text-white disabled:opacity-50"
            >
              Deny
            </button>
            <button
              onClick={() => send(true)}
              disabled={submitting}
              className="px-3 py-1.5 text-sm rounded bg-emerald-600 hover:bg-emerald-700 text-white disabled:opacity-50"
            >
              Approve
            </button>
          </ModalFooter>
        </>
      )}
    </Modal>
  );
}
