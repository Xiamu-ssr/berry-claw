import { useState } from 'react';
import { FolderGit2, Pencil } from 'lucide-react';
import { PickerButton } from './PickerButton';
import type { PickerOption } from './Picker';
import { TextInput } from '../workbench';
import { lastPathPart } from '../../utils/format';

const CUSTOM = '__custom__';
const NONE = '__none__';

export interface ProjectPickerProps {
  /** Known project root paths to offer (deduped + sorted by the caller is fine). */
  knownPaths: string[];
  value?: string;
  onChange: (path: string | undefined) => void;
  /** Allow "no project" (agent workspace only). Default true. */
  allowNone?: boolean;
  className?: string;
}

/**
 * Pick a project root from known projects, with a "自定义路径" escape hatch for
 * cold-start (no projects exist yet). Project binding is optional on an agent,
 * so "不绑定" is the default. Replaces the freeform path TextInput so users
 * select rather than type — but the escape hatch keeps typing possible for the
 * first project on a fresh cluster.
 */
export function ProjectPicker({ knownPaths, value, onChange, allowNone = true, className }: ProjectPickerProps) {
  // If the current value isn't a known path (and isn't empty), we're in custom mode.
  const isKnown = !value || knownPaths.includes(value);
  const [custom, setCustom] = useState(!isKnown);

  if (custom) {
    return (
      <div className={className}>
        <div className="flex items-center gap-2">
          <TextInput
            value={value ?? ''}
            onChange={(e) => onChange(e.target.value || undefined)}
            placeholder="/Users/you/code/project"
            className="w-full font-mono"
          />
          {knownPaths.length > 0 && (
            <button
              type="button"
              onClick={() => { setCustom(false); onChange(undefined); }}
              className="shrink-0 rounded-lg border border-white/[0.10] px-2.5 py-2 text-xs text-zinc-400 hover:bg-white/[0.05]"
              title="从已有项目中选择"
            >
              选择
            </button>
          )}
        </div>
      </div>
    );
  }

  const options: PickerOption[] = [];
  if (allowNone) options.push({ value: NONE, label: '不绑定项目', description: '仅使用 agent workspace', group: '通用' });
  for (const p of knownPaths) {
    options.push({ value: p, label: lastPathPart(p), description: p, group: '已有项目', icon: <FolderGit2 size={14} /> });
  }
  options.push({ value: CUSTOM, label: '自定义路径…', description: '手动输入项目根目录', group: '通用', icon: <Pencil size={14} /> });

  return (
    <PickerButton
      className={className}
      options={options}
      value={value ?? (allowNone ? NONE : undefined)}
      groupOrder={['已有项目', '通用']}
      placeholder="选择项目"
      searchPlaceholder="搜索项目…"
      onSelect={(v) => {
        if (v === CUSTOM) { setCustom(true); return; }
        onChange(v === NONE ? undefined : v);
      }}
    />
  );
}
