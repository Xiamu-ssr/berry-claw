import { Bot, Save, X } from 'lucide-react';
import type { ModelCatalogItem as ModelInfo, PromptPackInfo } from '@berry-agent/claw-contracts';
import {
  Field,
  IconButton,
  PrimaryButton,
  SecondaryButton,
  SectionCard,
  SelectInput,
  TextInput,
} from '../workbench';
import type { AgentForm } from './types';

export function AgentEditor({
  mode,
  form,
  models,
  promptPacks,
  onChange,
  onSave,
  onClose,
}: {
  mode: 'create' | 'edit';
  form: AgentForm;
  models: ModelInfo[];
  promptPacks: PromptPackInfo[];
  onChange: (next: AgentForm) => void;
  onSave: () => void;
  onClose: () => void;
}) {
  return (
    <SectionCard
      title={mode === 'create' ? '新建智能体' : '编辑智能体'}
      subtitle="Agent 身份由 workspace 目录和配置共同决定；项目绑定只决定它当前操作哪个代码根。"
      icon={<Bot size={15} />}
      action={<IconButton title="Close editor" onClick={onClose}><X size={14} /></IconButton>}
    >
      <div className="grid gap-3 lg:grid-cols-2">
        <Field label="Agent ID" hint={mode === 'edit' ? '不可修改' : '文件身份 key'}>
          <TextInput
            value={form.id}
            disabled={mode === 'edit'}
            onChange={(event) => onChange({ ...form, id: event.target.value.replace(/[^a-z0-9-_]/g, '') })}
            placeholder="coder"
            className="w-full font-mono"
          />
        </Field>
        <Field label="显示名">
          <TextInput
            value={form.name}
            onChange={(event) => onChange({ ...form, name: event.target.value })}
            placeholder="工程师"
            className="w-full"
          />
        </Field>
        <Field label="模型引用" hint="tier / model / raw / 裸 id">
          <SelectInput
            value={form.model}
            onChange={(event) => onChange({ ...form, model: event.target.value })}
            className="w-full"
          >
            {models.length === 0 && <option value={form.model}>{form.model || 'tier:balanced'}</option>}
            {models.map((model) => (
              <option key={model.model} value={model.model}>
                {model.model} ({model.providerName})
              </option>
            ))}
            {!models.some((model) => model.model === form.model) && form.model && (
              <option value={form.model}>{form.model}</option>
            )}
          </SelectInput>
        </Field>
        <Field label="推理强度">
          <SelectInput
            value={form.reasoningEffort}
            onChange={(event) => onChange({ ...form, reasoningEffort: event.target.value as AgentForm['reasoningEffort'] })}
            className="w-full"
          >
            <option value="">继承 / 默认</option>
            <option value="none">none</option>
            <option value="low">low</option>
            <option value="medium">medium</option>
            <option value="high">high</option>
            <option value="max">max</option>
            <option value="xhigh">xhigh</option>
          </SelectInput>
        </Field>
        <Field label="提示词套件" hint="SDK PromptPack">
          <SelectInput
            value={form.promptPack}
            onChange={(event) => onChange({ ...form, promptPack: event.target.value })}
            className="w-full"
          >
            {promptPacks.length === 0 && <option value={form.promptPack}>{form.promptPack || 'berry-default-zh'}</option>}
            {promptPacks.map((pack) => (
              <option key={pack.id} value={pack.id}>
                {pack.name} ({pack.id})
              </option>
            ))}
            {!promptPacks.some((pack) => pack.id === form.promptPack) && form.promptPack && (
              <option value={form.promptPack}>{form.promptPack}</option>
            )}
          </SelectInput>
        </Field>
        <Field label="项目根目录" hint="可为空">
          <TextInput
            value={form.project}
            onChange={(event) => onChange({ ...form, project: event.target.value })}
            placeholder="/Users/lanxuan/agent-workspace/berry-agent"
            className="w-full font-mono"
          />
        </Field>
      </div>
      <div className="mt-4 flex justify-end gap-2">
        <SecondaryButton onClick={onClose}>取消</SecondaryButton>
        <PrimaryButton onClick={onSave}>
          <Save size={14} />
          保存
        </PrimaryButton>
      </div>
    </SectionCard>
  );
}
