import { Bot, Save } from 'lucide-react';
import type { ModelCatalogItem as ModelInfo } from '@berry-agent/claw-contracts';
import { Field, PrimaryButton, SecondaryButton, TextInput } from '../workbench';
import { Modal } from '../ui/Modal';
import { ModelPicker } from '../ui/ModelPicker';
import { PickerButton } from '../ui/PickerButton';
import { modelFamily } from '../../utils/format';
import type { AgentForm } from './types';

const REASONING_OPTS = [
  { value: '', label: '继承 / 默认' },
  { value: 'none', label: 'none' },
  { value: 'low', label: 'low' },
  { value: 'medium', label: 'medium' },
  { value: 'high', label: 'high' },
  { value: 'max', label: 'max' },
  { value: 'xhigh', label: 'xhigh' },
] as const;

/**
 * Edit an existing agent. The id is identity and immutable — shown as a
 * read-only mono chip, never an input. Model + reasoning are picker-driven
 * (the model picker family-locks to the current model's family so an edit
 * can't break prompt caching). Rendered inside a Modal by AgentsPage.
 */
export function AgentEditor({
  open,
  form,
  models,
  onChange,
  onSave,
  onClose,
}: {
  open: boolean;
  form: AgentForm;
  models: ModelInfo[];
  onChange: (next: AgentForm) => void;
  onSave: () => void;
  onClose: () => void;
}) {
  const family = modelFamily(form.model) ?? models.find((m) => m.model === form.model)?.family;
  return (
    <Modal open={open} onClose={onClose} size="lg" className="!p-0">
      <div className="flex items-center gap-2 border-b border-white/[0.07] px-5 py-4">
        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-sky-400/15 text-sky-300"><Bot size={16} /></span>
        <div className="min-w-0">
          <div className="text-sm font-semibold text-zinc-100">编辑智能体</div>
          <div className="truncate font-mono text-[11px] text-zinc-500">{form.id}</div>
        </div>
      </div>

      <div className="space-y-4 px-5 py-5">
        <Field label="显示名">
          <TextInput
            value={form.name}
            onChange={(event) => onChange({ ...form, name: event.target.value })}
            placeholder="工程师"
            className="w-full"
          />
        </Field>
        <Field label="模型" hint="档位 / 具体模型">
          <ModelPicker
            catalog={models}
            value={form.model}
            onSelect={(model) => onChange({ ...form, model })}
            lockFamily={family}
          />
        </Field>
        <Field label="推理强度">
          <PickerButton
            options={REASONING_OPTS.map((o) => ({ value: o.value, label: o.label }))}
            value={form.reasoningEffort}
            onSelect={(v) => onChange({ ...form, reasoningEffort: v as AgentForm['reasoningEffort'] })}
            placeholder="继承 / 默认"
          />
        </Field>
      </div>

      <div className="flex justify-end gap-2 border-t border-white/[0.07] px-5 py-3">
        <SecondaryButton onClick={onClose}>取消</SecondaryButton>
        <PrimaryButton onClick={onSave}>
          <Save size={14} />
          保存
        </PrimaryButton>
      </div>
    </Modal>
  );
}
