import { FolderOpen } from 'lucide-react';

/**
 * FilesRail — agent workspace file browser.
 *
 * The file-tree browse/read endpoints lived on the console backend, which is
 * gone. a8s does not (yet) expose an agent-workspace filesystem read path, so
 * this rail degrades to an explicit "not available" notice instead of calling
 * a dead /api/* route. When a8s offers a workspace-files surface this becomes
 * a thin client over it.
 */
export function FilesRail({ agentId }: { agentId?: string }) {
  if (!agentId) {
    return <div className="rounded-xl border border-dashed border-white/[0.08] px-4 py-8 text-center text-xs text-zinc-600">未选择 agent</div>;
  }
  return (
    <div className="rounded-xl border border-dashed border-white/[0.08] px-4 py-10 text-center">
      <FolderOpen size={22} className="mx-auto mb-3 text-zinc-600" />
      <div className="text-sm text-zinc-400">工作区文件浏览暂未接入</div>
      <p className="mx-auto mt-2 max-w-xs text-xs leading-5 text-zinc-600">
        agent 的工作区文件读路径尚未在 a8s 控制台暴露。等控制台提供工作区文件接口后,这里会直接接上。
      </p>
    </div>
  );
}
