import { useMemo, useState } from 'react';
import { Users } from 'lucide-react';
import type { ModelCatalogItem } from '@berry-agent/claw-contracts';
import { Modal } from '../ui/Modal';
import { Stepper } from '../ui/Stepper';
import { ModelPicker } from '../ui/ModelPicker';
import { ProjectPicker } from '../ui/ProjectPicker';
import { Field, TextInput } from '../workbench';
import { deriveAgentId, ensureUniqueId } from '../../utils/slug';

export interface CreateTeamValues {
  leaderId: string;
  name: string;
  project: string;
  model: string;
}

export interface CreateTeamWizardProps {
  open: boolean;
  catalog: ModelCatalogItem[];
  /** Existing agent ids so the auto-derived leader id never collides. */
  takenIds: string[];
  /** Known project roots for the ProjectPicker. */
  knownProjects: string[];
  onCancel: () => void;
  onCreate: (values: CreateTeamValues) => void | Promise<void>;
  busy?: boolean;
}

/**
 * Gate per step: name → derived leader id (step 0), project bound (step 1),
 * model chosen (step 2). A team must have a project — that's what scopes its
 * shared worklist + messages — so unlike an agent, project is required here.
 */
export function teamWizardCanAdvance(
  step: number,
  state: { name: string; leaderId: string; project?: string; model: string },
): boolean {
  if (step === 0) return state.name.trim().length > 0 && state.leaderId.length > 0;
  if (step === 1) return !!state.project && state.project.trim().length > 0;
  return state.model.length > 0;
}

/**
 * Step wizard for forming a team — the same anti-"type the id / fill a raw form"
 * UX as the agent wizard. The user types a team name (→ leader id auto-derives),
 * picks the shared project, then the leader's model. Creating the team creates
 * its leader agent, labelled so the worker mounts the leader collaboration
 * tools. Teammates are added afterward (console or in-chat by the leader).
 */
export function CreateTeamWizard({
  open,
  catalog,
  takenIds,
  knownProjects,
  onCancel,
  onCreate,
  busy,
}: CreateTeamWizardProps) {
  const [step, setStep] = useState(0);
  const [name, setName] = useState('');
  const [id, setId] = useState('');
  const [idDirty, setIdDirty] = useState(false);
  const [project, setProject] = useState<string | undefined>(knownProjects[0]);
  const [model, setModel] = useState('');

  const leaderId = useMemo(
    () => (idDirty ? id : ensureUniqueId(deriveAgentId(name), takenIds)),
    [name, id, idDirty, takenIds],
  );

  const reset = () => {
    setStep(0); setName(''); setId(''); setIdDirty(false);
    setProject(knownProjects[0]); setModel('');
  };
  const close = () => { reset(); onCancel(); };

  const canAdvance = teamWizardCanAdvance(step, { name, leaderId, project, model });

  const finish = async () => {
    if (!project) return;
    await onCreate({ leaderId, name: name.trim(), project, model });
    reset();
  };

  return (
    <Modal open={open} onClose={close} size="lg" className="!p-0">
      <div className="flex items-center gap-2 border-b border-white/[0.07] px-5 py-4">
        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-amber-400/15 text-amber-300"><Users size={16} /></span>
        <div>
          <div className="text-sm font-semibold text-zinc-100">组建团队</div>
          <div className="text-[11px] text-zinc-500">起个名字、选个项目 —— leader 会自动生成</div>
        </div>
      </div>

      <Stepper
        steps={[
          { key: 'identity', title: '团队', hint: 'leader 的 agent id 按团队名自动生成,可改但通常无需手填。' },
          { key: 'project', title: '项目', hint: '团队共享一个项目根 —— worklist 与消息日志都按它隔离,必填。' },
          { key: 'model', title: 'Leader 模型', hint: 'leader 用这个模型;teammate 之后各自选,默认 tier:strong。' },
        ]}
        index={step}
        onIndexChange={setStep}
        canAdvance={canAdvance}
        onCancel={close}
        onFinish={finish}
        finishLabel="组建"
        busy={busy}
      >
        {step === 0 && (
          <div className="space-y-4">
            <Field label="团队名称" hint="也是 leader 的显示名">
              <TextInput
                autoFocus
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="前端小队 / Frontend squad"
                className="w-full"
              />
            </Field>
            <Field label="Leader ID" hint={idDirty ? '已手动编辑' : '按团队名自动生成'}>
              <div className="flex items-center gap-2">
                <TextInput
                  value={leaderId}
                  onChange={(e) => { setIdDirty(true); setId(e.target.value.replace(/[^a-z0-9-_]/g, '')); }}
                  placeholder="frontend-squad"
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
            <Field label="共享项目" hint="必填 —— 团队成员都绑定在这个项目根上">
              <ProjectPicker knownPaths={knownProjects} value={project} onChange={setProject} allowNone={false} />
            </Field>
          </div>
        )}

        {step === 2 && (
          <div className="space-y-4">
            <Field label="Leader 模型" hint="必填">
              <ModelPicker catalog={catalog} value={model} onSelect={setModel} placeholder="选择 leader 模型" />
            </Field>
          </div>
        )}
      </Stepper>
    </Modal>
  );
}
