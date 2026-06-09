import { ShieldCheck } from 'lucide-react';
import { EmptyState, WorkbenchPage } from './workbench';

/**
 * AuditPage — SDK observability (sessions / turns / inferences / cost / cache).
 *
 * The embedded ObserveApp spoke to the console backend's `/api/observe/*`
 * proxy, which is gone. a8s exposes consumption as a rollup API (usage routes),
 * not the full observe REST surface ObserveApp expects, so wiring ObserveApp
 * straight to a8s would 404. Rather than embed a broken viewer, this degrades
 * to a notice; the雪山引擎 console (a8s UI) carries the first-class observability
 * column today.
 *
 * When a8s serves the observe REST shape (or we port ObserveApp onto the usage
 * rollup API), this becomes a thin embed again.
 */
export default function AuditPage() {
  return (
    <WorkbenchPage
      eyebrow="Observe"
      title="审计"
      description="SDK 记录的 session / turn / 推理 / 成本 / 缓存可观测性。"
    >
      <div className="p-8">
        <EmptyState
          icon={<ShieldCheck size={24} />}
          title="可观测性暂未接入控制台"
          body="审计与消耗钻取由 a8s 的 observe 数据驱动,直连模式下尚未把 observe 的完整读接口接到这里。当前可在雪山引擎控制台的「日志 / 用量」栏目查看 session、turn、推理、成本与缓存明细。"
        />
      </div>
    </WorkbenchPage>
  );
}
