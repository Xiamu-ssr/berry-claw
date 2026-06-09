import { ShieldCheck } from 'lucide-react';

/**
 * SafetyTab — global / classifier safety policy.
 *
 * Global-level safety and the auto-approval classifier were console-backend
 * state (PATCH /api/safety/*). Under direct-connect, safety lives in each
 * agent's a8s spec — safetyLevel and classifierModel are per-agent fields,
 * resolved server-side with an agent > project > global cascade — and there is
 * no console route for the global layer. So this tab is a read-only explainer;
 * the classifier model is set per agent on the Agents page (P3/P4 wired the
 * classifierModel field into create + live patch).
 */
export default function SafetyTab() {
  return (
    <div className="space-y-4">
      <section className="rounded-xl border border-white/[0.08] bg-[#20242a]/75 p-5">
        <div className="mb-3 flex items-center gap-2 text-sm font-medium text-zinc-200">
          <ShieldCheck size={15} className="text-[var(--theme-primary)]" />
          安全策略归 a8s
        </div>
        <div className="space-y-3 text-sm leading-relaxed text-zinc-400">
          <p>
            安全等级(trust / default / auto)与自动审批 classifier 是 agent 在 a8s 上的 spec 字段,
            按 <span className="font-mono text-zinc-300">agent &gt; project &gt; global</span> 继承,由控制面在服务端解析。
          </p>
          <p>
            控制台不再持有全局安全配置;请在「智能体」页为每个 agent 配置主 model 与审批 classifier model,
            或在 a8s 控制台调整 global / project 层。
          </p>
        </div>
      </section>
    </div>
  );
}
