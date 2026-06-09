import { useMemo, useState } from 'react';
import { Bot } from 'lucide-react';
import type { ModelCatalogItem } from '@berry-agent/claw-contracts';
import { Modal } from '../ui/Modal';
import { Stepper } from '../ui/Stepper';
import { ModelPicker } from '../ui/ModelPicker';
import { ProjectPicker } from '../ui/ProjectPicker';
import { PickerButton } from '../ui/PickerButton';
import { Field, TextInput } from '../workbench';
import { deriveAgentId, ensureUniqueId } from '../../utils/slug';
import { modelFamily } from '../../utils/format';
import type { ReasoningEffort } from '@berry-agent/claw-contracts';

export interface AgentCreateValues {
  agentId: string;
  name: string;
  model: string;
  classifierModel?: string;
  reasoningEffort?: ReasoningEffort;
  project?: string;
}

export interface AgentCreateWizardProps {
  open: boolean;
  catalog: ModelCatalogItem[];
  /** Existing agent ids so the auto-derived id never collides. */
  takenIds: string[];
  /** Known project paths for the ProjectPicker. */
  knownProjects: string[];
  onCancel: () => void;
  onCreate: (values: AgentCreateValues) => void | Promise<void>;
  busy?: boolean;
}

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
 * Per-step gate for the create wizard. Exported + pure so the step-advance
 * contract is unit-testable without rendering: step 0 needs a name + derived
 * id, step 1 needs a model, step 2 (project/reasoning, all optional) is free.
 */
export function wizardCanAdvance(step: number, state: { name: string; derivedId: string; model: string }): boolean {
  if (step === 0) return state.name.trim().length > 0 && state.derivedId.length > 0;
  if (step === 1) return state.model.length > 0;
  return true;
}

/**
 * Step wizard for creating an agent — the anti-"type the id / fill a raw form"
 * UX. The user types only a display name; the id auto-derives (editable but
 * never required). Model is picked from the family-aware catalog; the
 * classifier (optional) is family-locked to the chosen model. Project +
 * reasoning are optional final touches.
 */
export function AgentCreateWizard({
  open,
  catalog,
  takenIds,
  knownProjects,
  onCancel,
  onCreate,
  busy,
}: AgentCreateWizardProps) {
  const [step, setStep] = useState(0);
  const [name, setName] = useState('');
  const [id, setId] = useState('');
  const [idDirty, setIdDirty] = useState(false);
  const [model, setModel] = useState('');
  const [classifier, setClassifier] = useState('');
  const [project, setProject] = useState<string | undefined>();
  const [reasoning, setReasoning] = useState<string>('');

  // Auto-derive the id from the name until the user edits the id directly.
  const derivedId = useMemo(
    () => (idDirty ? id : ensureUniqueId(deriveAgentId(name), takenIds)),
    [name, id, idDirty, takenIds],
  );

  const modelFam = modelFamily(model) ?? catalog.find((m) => m.model === model)?.family;

  const reset = () => {
    setStep(0); setName(''); setId(''); setIdDirty(false);
    setModel(''); setClassifier(''); setProject(undefined); setReasoning('');
  };

  const close = () => { reset(); onCancel(); };

  const canAdvance = wizardCanAdvance(step, { name, derivedId, model });

  const finish = async () => {
    await onCreate({
      agentId: derivedId,
      name: name.trim(),
      model,
      classifierModel: classifier || undefined,
      reasoningEffort: (reasoning || undefined) as ReasoningEffort | undefined,
      project: project || undefined,
    });
    reset();
  };

  return (
    <Modal open={open} onClose={close} size="lg" className="!p-0">
      <div className="flex items-center gap-2 border-b border-white/[0.07] px-5 py-4">
        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-sky-400/15 text-sky-300"><Bot size={16} /></span>
        <div>
          <div className="text-sm font-semibold text-zinc-100">新建智能体</div>
          <div className="text-[11px] text-zinc-500">三步创建——你只需起个名字</div>
        </div>
      </div>

      <Stepper
        steps={[
          { key: 'identity', title: '身份', hint: 'Agent ID 是文件身份 key,默认按名字自动生成,可改但通常无需手动填。' },
          { key: 'model', title: '模型', hint: '主模型决定协议家族;分类模型(可选)会被锁定为同一家族。' },
          { key: 'extra', title: '项目 / 推理', hint: '都可留空——之后随时能在智能体设置里调整。' },
        ]}
        index={step}
        onIndexChange={setStep}
        canAdvance={canAdvance}
        onCancel={close}
        onFinish={finish}
        finishLabel="创建"
        busy={busy}
      >
        {step === 0 && (
          <div className="space-y-4">
            <Field label="显示名" hint="给智能体起个名字">
              <TextInput
                autoFocus
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="工程师 / Coder"
                className="w-full"
              />
            </Field>
            <Field label="Agent ID" hint={idDirty ? '已手动编辑' : '按名字自动生成'}>
              <div className="flex items-center gap-2">
                <TextInput
                  value={derivedId}
                  onChange={(e) => { setIdDirty(true); setId(e.target.value.replace(/[^a-z0-9-_]/g, '')); }}
                  placeholder="coder"
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
          </div>
        )}

        {step === 1 && (
          <div className="space-y-4">
            <Field label="主模型" hint="必填">
              <ModelPicker catalog={catalog} value={model} onSelect={setModel} placeholder="选择主模型" />
            </Field>
            <Field label="分类模型" hint="可选——用于轻量分类/路由,锁定主模型家族">
              <ModelPicker
                catalog={catalog}
                value={classifier}
                onSelect={setClassifier}
                lockFamily={modelFam}
                placeholder="(可选)选择分类模型"
              />
            </Field>
          </div>
        )}

        {step === 2 && (
          <div className="space-y-4">
            <Field label="项目" hint="可选——绑定一个代码根">
              <ProjectPicker knownPaths={knownProjects} value={project} onChange={setProject} />
            </Field>
            <Field label="推理强度" hint="可选">
              <PickerButton
                options={REASONING_OPTS.map((o) => ({ value: o.value, label: o.label }))}
                value={reasoning}
                onSelect={setReasoning}
                placeholder="继承 / 默认"
              />
            </Field>
          </div>
        )}
      </Stepper>
    </Modal>
  );
}
