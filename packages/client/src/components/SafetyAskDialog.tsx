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

import { useEffect, useState } from 'react';
import { CheckCircle2, ShieldAlert, XCircle } from 'lucide-react';
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
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setNote('');
    setError(null);
    setSubmitting(false);
  }, [ask?.id]);

  const send = async (approved: boolean) => {
    if (!ask) return;
    setSubmitting(true);
    setError(null);
    // Approval resolution was a console-backend route (POST /api/safety/ask/:id
    // resolved a server-held Promise). a8s does not expose human-in-the-loop
    // approval yet, so we can't settle the ask from the console; surface that
    // and clear it locally rather than hitting a dead route.
    // TODO(a8s): wire approvals through the control plane when available.
    void approved;
    setSubmitting(false);
    setError('审批通道暂未接入控制台(a8s 尚未提供 human-in-the-loop 审批接口)。');
  };

  const inputPreview = ask ? JSON.stringify(ask.question.input, null, 2) : '';

  return (
    <Modal open={!!ask} size="lg">
      {ask && (
        <>
          <ModalHeader>
            <div className="flex items-start gap-3">
              <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl border border-amber-300/25 bg-amber-300/10 text-amber-200">
                <ShieldAlert size={19} />
              </div>
              <div className="min-w-0">
                <h3 className="text-base font-semibold text-gray-900 dark:text-zinc-100">
                  Agent requesting approval
                </h3>
                <p className="mt-1 text-sm text-gray-500 dark:text-zinc-500">
                  Safety mode <span className="font-mono text-zinc-300">auto</span> intercepted this tool call.
                </p>
              </div>
            </div>
          </ModalHeader>

          <ModalBody className="space-y-4">
            <div className="rounded-xl border border-white/[0.08] bg-black/10 p-3">
              <div className="mb-1 text-[11px] font-medium uppercase tracking-wide text-zinc-600">Tool</div>
              <div className="font-mono text-sm text-gray-800 dark:text-zinc-100">
                {ask.question.toolName}
              </div>
            </div>

            {ask.question.reason && (
              <div className="rounded-xl border border-amber-300/20 bg-amber-300/10 p-3">
                <div className="mb-1 text-[11px] font-medium uppercase tracking-wide text-amber-300/80">Reason</div>
                <div className="text-sm text-amber-100">{ask.question.reason}</div>
              </div>
            )}

            <div>
              <div className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-zinc-600">Input</div>
              <pre className="max-h-56 overflow-auto whitespace-pre-wrap rounded-xl border border-white/[0.08] bg-[#17191c] px-3 py-2 font-mono text-xs leading-5 text-zinc-300">
                {inputPreview}
              </pre>
            </div>

            <div className="rounded-xl border border-white/[0.07] bg-white/[0.025] p-3">
              <div className="mb-1 text-[11px] font-medium uppercase tracking-wide text-zinc-600">Session</div>
              <div className="truncate font-mono text-xs text-gray-600 dark:text-zinc-500">
                {ask.question.session.id.slice(0, 8)} · {ask.question.session.cwd}
              </div>
            </div>

            <div>
              <label className="mb-1.5 block text-[11px] font-medium uppercase tracking-wide text-zinc-600">Note (optional)</label>
              <input
                type="text"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Explain your decision..."
                className="h-10 w-full rounded-lg border border-white/[0.08] bg-[#24282e]/75 px-3 text-sm text-zinc-100 outline-none placeholder:text-zinc-600 transition-colors focus:border-sky-300/45 focus:bg-[#262c33]"
              />
            </div>

            {error && (
              <div className="rounded-xl border border-rose-300/20 bg-rose-300/10 px-3 py-2 text-sm text-rose-100">
                {error}
              </div>
            )}
          </ModalBody>

          <ModalFooter>
            <button
              onClick={() => send(false)}
              disabled={submitting}
              className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-rose-300/25 bg-rose-300/10 px-4 text-sm text-rose-200 transition-colors hover:bg-rose-300/15 disabled:opacity-50"
            >
              <XCircle size={15} />
              Deny
            </button>
            <button
              onClick={() => send(true)}
              disabled={submitting}
              className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-sky-200 px-4 text-sm font-medium text-slate-950 shadow-[0_8px_24px_rgba(125,211,252,0.16)] transition-colors hover:bg-sky-100 disabled:opacity-50"
            >
              <CheckCircle2 size={15} />
              Approve
            </button>
          </ModalFooter>
        </>
      )}
    </Modal>
  );
}
