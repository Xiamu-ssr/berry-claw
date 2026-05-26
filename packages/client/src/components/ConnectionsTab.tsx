import { useState } from 'react';
import { Check, Copy, KeyRound, Pencil, Plus, Trash2 } from 'lucide-react';
import {
  InvalidPemError,
  ensureToken,
  parseEd25519PrivateKeyPem,
  removeInstance,
  setActive,
  updateInstance,
  useActiveInstanceId,
  useInstances,
  type Instance,
} from '../connection';
import { clearToken } from '../connection';
import { ConnectSetupScreen } from './ConnectSetupScreen';
import { Modal, ModalBody, ModalFooter, ModalHeader } from './ui/Modal';

/**
 * Settings → Connections tab.
 *
 * Lists every Instance with: name, server endpoint, fingerprint, active badge,
 * and a row of actions (activate, rename, replace key, remove). "+ Add" opens
 * the ConnectSetupScreen in modal mode; "Replace key" opens a minimal
 * "paste PEM" dialog that pre-flights the new key before persisting.
 *
 * This file is intentionally the one place in the client that mutates the
 * connection store directly — other components read through the hooks.
 */
export function ConnectionsTab() {
  const instances = useInstances();
  const activeId = useActiveInstanceId();

  const [showAdd, setShowAdd] = useState(false);
  const [replaceFor, setReplaceFor] = useState<Instance | null>(null);
  const [editingNameFor, setEditingNameFor] = useState<string | null>(null);

  return (
    <section className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-6 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-gray-800 dark:text-gray-100">Connections</h2>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            Each connection is a berry-claw server instance. Switch at any time; private keys
            stay on this machine.
          </p>
        </div>
        <button
          onClick={() => setShowAdd(true)}
          className="flex items-center gap-1.5 px-3 py-1.5 text-sm rounded bg-sky-300 hover:bg-sky-200 text-slate-950"
        >
          <Plus size={14} /> Add
        </button>
      </div>

      {instances.length === 0 ? (
        <div className="text-sm text-gray-500 dark:text-gray-400 py-8 text-center">
          No connections yet.
        </div>
      ) : (
        <ul className="divide-y divide-gray-200 dark:divide-gray-700">
          {instances.map((inst) => (
            <InstanceRow
              key={inst.id}
              instance={inst}
              active={inst.id === activeId}
              isEditingName={editingNameFor === inst.id}
              onStartEditName={() => setEditingNameFor(inst.id)}
              onCancelEditName={() => setEditingNameFor(null)}
              onSaveName={(name) => {
                updateInstance(inst.id, { name });
                setEditingNameFor(null);
              }}
              onActivate={() => setActive(inst.id)}
              onReplaceKey={() => setReplaceFor(inst)}
              onRemove={() => {
                const ok = window.confirm(
                  `Remove connection "${inst.name}"? This deletes the private key from this machine.`,
                );
                if (ok) removeInstance(inst.id);
              }}
            />
          ))}
        </ul>
      )}

      {/* Add new connection modal */}
      <Modal open={showAdd} onClose={() => setShowAdd(false)} size="lg">
        {/*
          Inside a modal we reuse ConnectSetupScreen's form, but override the
          fullscreen chrome by placing the form inside a normal card — the
          form itself doesn't rely on the outer positioning.
          We pass onCancel so the form can close itself on success/cancel.
        */}
        <ModalHeader>
          <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100">
            Add connection
          </h3>
        </ModalHeader>
        <ModalBody className="!p-0 !space-y-0">
          <ConnectSetupScreenInline onDone={() => setShowAdd(false)} />
        </ModalBody>
      </Modal>

      {/* Replace private key modal */}
      <ReplaceKeyModal
        instance={replaceFor}
        onClose={() => setReplaceFor(null)}
      />
    </section>
  );
}

function InstanceRow({
  instance,
  active,
  isEditingName,
  onStartEditName,
  onCancelEditName,
  onSaveName,
  onActivate,
  onReplaceKey,
  onRemove,
}: {
  instance: Instance;
  active: boolean;
  isEditingName: boolean;
  onStartEditName: () => void;
  onCancelEditName: () => void;
  onSaveName: (name: string) => void;
  onActivate: () => void;
  onReplaceKey: () => void;
  onRemove: () => void;
}) {
  const [draftName, setDraftName] = useState(instance.name);
  const [copied, setCopied] = useState(false);

  const copyFingerprint = async () => {
    if (!instance.fingerprint) return;
    try {
      await navigator.clipboard.writeText(instance.fingerprint);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard not available; ignore */
    }
  };

  return (
    <li className="py-3 flex items-start gap-3">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          {isEditingName ? (
            <>
              <input
                autoFocus
                value={draftName}
                onChange={(e) => setDraftName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') onSaveName(draftName.trim() || instance.name);
                  if (e.key === 'Escape') onCancelEditName();
                }}
                className="px-2 py-0.5 text-sm rounded bg-gray-100 dark:bg-gray-700 border border-gray-300 dark:border-gray-600"
              />
              <button
                onClick={() => onSaveName(draftName.trim() || instance.name)}
                className="text-xs text-teal-400 dark:text-teal-200"
              >
                Save
              </button>
              <button onClick={onCancelEditName} className="text-xs text-gray-500">
                Cancel
              </button>
            </>
          ) : (
            <>
              <span className="font-medium text-gray-900 dark:text-gray-100">{instance.name}</span>
              {active && (
                <span className="px-1.5 py-0.5 text-[10px] font-medium rounded bg-emerald-600 text-white">
                  ACTIVE
                </span>
              )}
              <button
                onClick={onStartEditName}
                className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
                title="Rename"
              >
                <Pencil size={12} />
              </button>
            </>
          )}
        </div>
        <div className="mt-1 text-xs text-gray-500 dark:text-gray-400 font-mono break-all">
          {instance.apiBase}
        </div>
        {instance.fingerprint && (
          <div className="mt-1 text-[11px] text-gray-400 dark:text-gray-500 font-mono break-all flex items-center gap-1.5">
            <span>{instance.fingerprint}</span>
            <button
              onClick={copyFingerprint}
              title="Copy fingerprint"
              className="hover:text-gray-600 dark:hover:text-gray-300"
            >
              {copied ? <Check size={11} /> : <Copy size={11} />}
            </button>
          </div>
        )}
      </div>

      <div className="flex items-center gap-1.5 shrink-0">
        {!active && (
          <button
            onClick={onActivate}
            className="px-2.5 py-1 text-xs rounded bg-gray-100 hover:bg-gray-200 dark:bg-gray-700 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-200"
          >
            Activate
          </button>
        )}
        <button
          onClick={onReplaceKey}
          title="Replace private key"
          className="p-1.5 rounded text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-700"
        >
          <KeyRound size={14} />
        </button>
        <button
          onClick={onRemove}
          title="Remove connection"
          className="p-1.5 rounded text-red-500 hover:bg-red-50 dark:hover:bg-red-950/50"
        >
          <Trash2 size={14} />
        </button>
      </div>
    </li>
  );
}

/**
 * Inline variant of the setup screen for use inside a modal. We reuse the
 * same form markup via ConnectSetupScreen but hide the outer fullscreen
 * wrapper by rendering it in a contained div — cleanest way to keep a
 * single source of truth for the form without a prop explosion.
 */
function ConnectSetupScreenInline({ onDone }: { onDone: () => void }) {
  return (
    <div className="p-2">
      {/*
        ConnectSetupScreen renders a `fixed inset-0` backdrop which we do NOT
        want inside another modal. We wrap it in a container that cancels
        `fixed` positioning for its subtree via Tailwind's `[&_.fixed]:!static`
        escape hatch — avoids forking the component.
      */}
      <div className="[&_.fixed]:!static [&_.fixed]:!bg-transparent [&_.fixed]:!p-0">
        <ConnectSetupScreen onCancel={onDone} title="Add connection" />
      </div>
    </div>
  );
}

function ReplaceKeyModal({
  instance,
  onClose,
}: {
  instance: Instance | null;
  onClose: () => void;
}) {
  const [pem, setPem] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (!instance) return null;

  const submit = async () => {
    setError(null);
    try {
      parseEd25519PrivateKeyPem(pem);
    } catch (e) {
      setError(
        e instanceof InvalidPemError
          ? e.message
          : e instanceof Error
            ? e.message
            : String(e),
      );
      return;
    }
    setBusy(true);
    // Preflight: prove the new key still authenticates against this server
    // before persisting. We use a temporary instance shape; if it works the
    // real update replaces the stored PEM.
    const candidate: Instance = { ...instance, privateKeyPem: pem.trim() };
    try {
      clearToken(instance.id); // force fresh challenge with new key
      await ensureToken(candidate);
    } catch (e) {
      setBusy(false);
      setError(`Server rejected the new key: ${e instanceof Error ? e.message : String(e)}`);
      return;
    }
    updateInstance(instance.id, { privateKeyPem: pem.trim() });
    setBusy(false);
    setPem('');
    onClose();
  };

  return (
    <Modal open={!!instance} onClose={busy ? undefined : onClose} size="lg">
      <ModalHeader>
        <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100">
          Replace private key · {instance.name}
        </h3>
        <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
          Paste a new PKCS#8 PEM. We'll verify it against the server before saving.
        </p>
      </ModalHeader>
      <ModalBody>
        <textarea
          value={pem}
          onChange={(e) => setPem(e.target.value)}
          placeholder={'-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----'}
          rows={6}
          disabled={busy}
          className="w-full px-3 py-2 text-xs font-mono rounded bg-gray-100 dark:bg-gray-800 border border-gray-300 dark:border-gray-700 focus:outline-none"
        />
        {error && (
          <div className="text-xs text-red-500 bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900/60 rounded px-3 py-2 whitespace-pre-wrap">
            {error}
          </div>
        )}
      </ModalBody>
      <ModalFooter>
        <button
          onClick={onClose}
          disabled={busy}
          className="px-3 py-1.5 text-sm rounded bg-gray-100 hover:bg-gray-200 dark:bg-gray-700 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-200 disabled:opacity-50"
        >
          Cancel
        </button>
        <button
          onClick={submit}
          disabled={busy || !pem.trim()}
          className="px-3 py-1.5 text-sm rounded bg-sky-300 hover:bg-sky-200 text-slate-950 disabled:opacity-50"
        >
          {busy ? 'Verifying…' : 'Replace'}
        </button>
      </ModalFooter>
    </Modal>
  );
}
