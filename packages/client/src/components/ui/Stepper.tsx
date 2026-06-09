import { type ReactNode } from 'react';
import { Check } from 'lucide-react';
import { cn } from '../../utils/cn';
import { PrimaryButton, SecondaryButton } from '../workbench';

export interface StepDef {
  /** Stable key. */
  key: string;
  /** Short title shown in the header rail. */
  title: string;
  /** Optional one-line hint under the body. */
  hint?: string;
}

export interface StepperProps {
  steps: StepDef[];
  /** Active step index (parent-controlled). */
  index: number;
  onIndexChange: (index: number) => void;
  /** Body for the active step. */
  children: ReactNode;
  /** Whether the active step is satisfied — gates Next / Finish. */
  canAdvance?: boolean;
  /** Called when Finish is pressed on the last step. */
  onFinish: () => void;
  onCancel: () => void;
  finishLabel?: string;
  busy?: boolean;
}

/**
 * A linear step wizard: a numbered header rail + the active step's body +
 * Back / Next / Finish controls. The parent owns the index and per-step
 * validation (`canAdvance`) so each wizard stays declarative. Used by
 * AgentCreateWizard; reusable for any future multi-step flow.
 */
export function Stepper({
  steps,
  index,
  onIndexChange,
  children,
  canAdvance = true,
  onFinish,
  onCancel,
  finishLabel = '完成',
  busy = false,
}: StepperProps) {
  const last = index === steps.length - 1;
  const active = steps[index];

  return (
    <div className="flex flex-col">
      {/* Header rail */}
      <div className="flex items-center gap-2 border-b border-white/[0.07] px-5 py-4">
        {steps.map((step, i) => {
          const done = i < index;
          const current = i === index;
          return (
            <div key={step.key} className="flex flex-1 items-center gap-2">
              <button
                type="button"
                // Allow jumping back to completed steps, never forward past the gate.
                onClick={() => i < index && onIndexChange(i)}
                disabled={i >= index}
                className={cn(
                  'flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold transition-colors',
                  done
                    ? 'bg-sky-400/20 text-sky-200'
                    : current
                      ? 'bg-sky-400 text-[#0b0e12]'
                      : 'bg-white/[0.06] text-zinc-500',
                  i < index && 'cursor-pointer hover:bg-sky-400/30',
                )}
              >
                {done ? <Check size={13} /> : i + 1}
              </button>
              <span className={cn('truncate text-xs', current ? 'font-medium text-zinc-100' : 'text-zinc-500')}>
                {step.title}
              </span>
              {i < steps.length - 1 && <div className="h-px flex-1 bg-white/[0.07]" />}
            </div>
          );
        })}
      </div>

      {/* Body */}
      <div className="px-5 py-5">
        {children}
        {active?.hint && <p className="mt-3 text-[11px] leading-relaxed text-zinc-500">{active.hint}</p>}
      </div>

      {/* Controls */}
      <div className="flex items-center justify-between border-t border-white/[0.07] px-5 py-3">
        <SecondaryButton onClick={index === 0 ? onCancel : () => onIndexChange(index - 1)}>
          {index === 0 ? '取消' : '上一步'}
        </SecondaryButton>
        <PrimaryButton
          onClick={last ? onFinish : () => onIndexChange(index + 1)}
          disabled={!canAdvance || busy}
        >
          {last ? finishLabel : '下一步'}
        </PrimaryButton>
      </div>
    </div>
  );
}
