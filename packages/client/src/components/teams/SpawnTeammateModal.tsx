import { useMemo, useState } from 'react';
import { Loader2, UserPlus } from 'lucide-react';
import type { ModelCatalogItem } from '@berry-agent/claw-contracts';
import { Modal } from '../ui/Modal';
import { ModelPicker } from '../ui/ModelPicker';
import { Field, PrimaryButton, SecondaryButton, TextInput } from '../workbench';
import { deriveAgentId, ensureUniqueId } from '../../utils/slug';

export interface SpawnTeammateValues {
  teammateId: string;
  role: string;
  model: string;
}

export interface SpawnTeammateModalProps {
  open: boolean;
  catalog: ModelCatalogItem[];
  /** Existing agent ids so the derived teammate id never collides. */
  takenIds: string[];
  onCancel: () => void;
  onSpawn: (values: SpawnTeammateValues) => void | Promise<void>;
  busy?: boolean;
}

/**
 * Add a teammate to a team. The console seeds it directly (the leader can also
 * spawn more in-chat). Type a role; the id auto-derives. Model defaults to
 * tier:strong when left unset.
 */
export function SpawnTeammateModal({ open, catalog, takenIds, onCancel, onSpawn, busy }: SpawnTeammateModalProps) {
  const [role, setRole] = useState('');
  const [id, setId] = useState('');
  const [idDirty, setIdDirty] = useState(false);
  const [model, setModel] = useState('');

  const teammateId = useMemo(
    () => (idDirty ? id : ensureUniqueId(deriveAgentId(role), takenIds)),
    [role, id, idDirty, takenIds],
  );

  const reset = () => { setRole(''); setId(''); setIdDirty(false); setModel(''); };
  const close = () => { reset(); onCancel(); };
  const canSpawn = role.trim().length > 0 && teammateId.length > 0;

  const spawn = async () => {
    if (!canSpawn) return;
    await onSpawn({ teammateId, role: role.trim(), model: model || 'tier:strong' });
    reset();
  };

  return (
    <Modal open={open} onClose={close} size="md" className="!p-0">
      <div className="flex items-center gap-2 border-b border-white/[0.07] px-5 py-4">
        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-sky-400/15 text-sky-300"><UserPlus size={16} /></span>
        <div>
          <div className="text-sm font-semibold text-zinc-100">添加 teammate</div>
          <div className="text-[11px] text-zinc-500">起个角色名,id 自动生成</div>
        </div>
      </div>

      <div className="space-y-4 px-5 py-5">
        <Field label="角色" hint="例如 reviewer / tester / writer">
          <TextInput autoFocus value={role} onChange={(e) => setRole(e.target.value)} placeholder="reviewer" className="w-full" />
        </Field>
        <Field label="Teammate ID" hint={idDirty ? '已手动编辑' : '按角色自动生成'}>
          <div className="flex items-center gap-2">
            <TextInput
              value={teammateId}
              onChange={(e) => { setIdDirty(true); setId(e.target.value.replace(/[^a-z0-9-_]/g, '')); }}
              placeholder="reviewer"
              className="w-full font-mono"
            />
            {idDirty && (
              <button
                type="button"
                onClick={() => { setIdDirty(false); setId(''); }}
                className="shrink-0 rounded-lg border border-white/[0.10] px-2.5 py-2 text-[11px] text-zinc-400 hover:bg-white/[0.05]"
                title="恢复自动生成"
              >
                自动
              </button>
            )}
          </div>
        </Field>
        <Field label="模型" hint="可选 —— 默认 tier:strong">
          <ModelPicker catalog={catalog} value={model} onSelect={setModel} placeholder="(默认 tier:strong)" />
        </Field>
      </div>

      <div className="flex items-center justify-end gap-2 border-t border-white/[0.07] px-5 py-3">
        <SecondaryButton onClick={close}>取消</SecondaryButton>
        <PrimaryButton onClick={spawn} disabled={!canSpawn || busy}>
          {busy ? <Loader2 size={14} className="animate-spin" /> : <UserPlus size={14} />}
          添加
        </PrimaryButton>
      </div>
    </Modal>
  );
}
