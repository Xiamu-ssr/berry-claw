import { useCallback, useEffect, useState } from 'react';
import { ShieldCheck, RefreshCw, ChevronRight, X, ArrowLeft } from 'lucide-react';
import {
  EmptyState,
  InlineSpinner,
  SectionCard,
  SecondaryButton,
  StatTile,
  WorkbenchPage,
} from './workbench';
import { showToast } from './Toast';
import { cn } from '../utils/cn';
import { money, compact, shortModel, sharePct, when } from '../a8s/usageFormat';
import {
  fetchOperatorUsage,
  fetchUsageSessions,
  fetchUsageTurns,
  fetchUsageInferences,
  fetchUsageInferenceDetail,
  type OperatorUsageResponse,
  type UsageSession,
  type UsageTurn,
  type UsageInference,
  type UsageInferenceDetail,
} from '../a8s/usage';

/**
 * AuditPage — native consumption view over a8s usage endpoints.
 *
 * Overview: cluster totals + daily cost trend + by-product / by-model /
 * by-agent rollups (each with a cost-share bar). Drilldown: click an agent →
 * a drawer walks sessions → turns → inferences → one inference's full detail.
 * Replaces the old degraded notice; this is claw's first-class observability.
 */
export default function AuditPage() {
  const [data, setData] = useState<OperatorUsageResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [drillAgent, setDrillAgent] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await fetchOperatorUsage());
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载用量失败');
      setData(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const totalCost = data?.totals.totalCost ?? 0;
  const totalCalls = (data?.byModel ?? []).reduce((s, m) => s + m.calls, 0);
  const blendedPerCall = totalCalls > 0 ? totalCost / totalCalls : 0;

  return (
    <WorkbenchPage
      eyebrow="Observe"
      title="审计"
      description="集群消耗:成本 / Token / 会话 / 推理。点击 agent 钻取 session → turn → 推理明细。"
      actions={
        <SecondaryButton onClick={load}>
          <RefreshCw size={13} />
          刷新
        </SecondaryButton>
      }
    >
      <div className="space-y-5 p-6">
        {loading && !data ? (
          <InlineSpinner label="加载集群用量…" />
        ) : error ? (
          <EmptyState icon={<ShieldCheck size={24} />} title="加载失败" body={error} action={<SecondaryButton onClick={load}>重试</SecondaryButton>} />
        ) : !data || data.totals.agentCount === 0 ? (
          <EmptyState icon={<ShieldCheck size={24} />} title="暂无消耗数据" body="还没有产生任何推理消耗;一旦 agent 开始对话,这里会出现成本、Token 与钻取明细。" />
        ) : (
          <>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              <StatTile label="总成本" value={money(totalCost)} />
              <StatTile label="总 Token" value={compact(data.totals.totalTokens)} />
              <StatTile label="会话数" value={String(data.totals.sessionCount)} />
              <StatTile label="Agent 数" value={String(data.totals.agentCount)} hint={`均价 ${money(blendedPerCall)}/次`} />
            </div>

            {data.trend.length > 0 && (
              <SectionCard title="每日成本趋势" subtitle="近 30 天">
                <CostTrend points={data.trend} />
              </SectionCard>
            )}

            {data.byProduct.length > 0 && (
              <SectionCard title="按产品">
                <RollupTable
                  cols={['产品', '会话', 'Token', '占比', '成本']}
                  rows={data.byProduct.map((p) => ({
                    key: p.product,
                    cells: [p.product || '(未归属)', String(p.sessionCount), compact(p.totalTokens), <ShareBar value={p.totalCost} total={totalCost} />, money(p.totalCost)],
                  }))}
                />
              </SectionCard>
            )}

            {data.byModel.length > 0 && (
              <SectionCard title="按模型">
                <RollupTable
                  cols={['模型', '调用', 'Token', '占比', '成本']}
                  rows={data.byModel.map((m) => ({
                    key: m.model,
                    cells: [shortModel(m.model), compact(m.calls), compact(m.totalTokens), <ShareBar value={m.totalCost} total={totalCost} />, money(m.totalCost)],
                  }))}
                />
              </SectionCard>
            )}

            <SectionCard title="按 Agent" subtitle="点击行钻取明细">
              <RollupTable
                cols={['Agent', '归属', '会话', 'Token', '成本', '']}
                rows={[...data.agents]
                  .sort((a, b) => b.totalCost - a.totalCost)
                  .map((a) => ({
                    key: a.agentId,
                    onClick: () => setDrillAgent(a.agentId),
                    cells: [
                      <span className="font-mono text-zinc-200">{a.agentId}</span>,
                      a.owner ?? '—',
                      String(a.sessionCount),
                      compact(a.totalTokens),
                      money(a.totalCost),
                      <ChevronRight size={14} className="text-zinc-600" />,
                    ],
                  }))}
              />
            </SectionCard>
          </>
        )}
      </div>

      {drillAgent && <DrilldownDrawer agentId={drillAgent} onClose={() => setDrillAgent(null)} />}
    </WorkbenchPage>
  );
}

// ---- overview primitives ---------------------------------------------------

function ShareBar({ value, total }: { value: number; total: number }) {
  const pct = sharePct(value, total);
  return (
    <div className="flex items-center justify-end gap-2">
      <div className="h-1.5 w-14 shrink-0 overflow-hidden rounded-sm bg-white/[0.08]">
        <div className="h-full rounded-sm bg-sky-400" style={{ width: `${pct}%` }} />
      </div>
      <span className="w-10 text-right font-mono text-[11px] text-zinc-500">{pct >= 10 ? pct.toFixed(0) : pct.toFixed(1)}%</span>
    </div>
  );
}

function CostTrend({ points }: { points: OperatorUsageResponse['trend'] }) {
  const recent = points.slice(-30);
  const max = Math.max(...recent.map((d) => d.totalCost), 0.0001);
  const peak = recent.reduce((a, b) => (b.totalCost > a.totalCost ? b : a), recent[0]);
  return (
    <div>
      <div className="mb-2 flex h-32 items-end gap-1.5">
        {recent.map((d, i) => {
          const isLast = i === recent.length - 1;
          const h = Math.max((d.totalCost / max) * 100, d.totalCost > 0 ? 4 : 1);
          return (
            <div key={d.date} className="flex min-w-0 flex-1 flex-col items-center justify-end" style={{ height: '100%' }} title={`${d.date} · ${money(d.totalCost)} · ${compact(d.calls)} 次`}>
              <div className={cn('w-full rounded-t-sm transition-all', isLast ? 'bg-sky-500' : 'bg-sky-400/60')} style={{ height: `${h}%`, minHeight: 2 }} />
            </div>
          );
        })}
      </div>
      <div className="flex items-center justify-between text-[11px] text-zinc-600">
        <span className="font-mono">{recent[0]?.date}</span>
        <span>峰值 <span className="font-mono text-zinc-400">{peak ? `${money(peak.totalCost)} · ${peak.date}` : '—'}</span></span>
        <span className="font-mono">{recent[recent.length - 1]?.date}</span>
      </div>
    </div>
  );
}

interface RollupRow {
  key: string;
  cells: React.ReactNode[];
  onClick?: () => void;
}
function RollupTable({ cols, rows }: { cols: string[]; rows: RollupRow[] }) {
  return (
    <div className="overflow-hidden rounded-xl border border-white/[0.07]">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-white/[0.07] bg-white/[0.02] text-[11px] uppercase tracking-wide text-zinc-500">
            {cols.map((c, i) => (
              <th key={c || i} className={cn('px-3 py-2 font-medium', i === 0 ? 'text-left' : 'text-right')}>{c}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr
              key={r.key}
              onClick={r.onClick}
              className={cn('border-b border-white/[0.04] last:border-0', r.onClick && 'cursor-pointer hover:bg-white/[0.03]')}
            >
              {r.cells.map((cell, i) => (
                <td key={i} className={cn('px-3 py-2 align-middle text-zinc-300', i === 0 ? 'text-left' : 'text-right tabular-nums')}>{cell}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ---- drilldown drawer ------------------------------------------------------

type DrillLevel =
  | { kind: 'sessions' }
  | { kind: 'turns'; sessionId: string }
  | { kind: 'inferences'; sessionId: string; turnId: string }
  | { kind: 'inference'; sessionId: string; turnId: string; inferenceId: string };

function DrilldownDrawer({ agentId, onClose }: { agentId: string; onClose: () => void }) {
  const [stack, setStack] = useState<DrillLevel[]>([{ kind: 'sessions' }]);
  const level = stack[stack.length - 1];
  const push = (l: DrillLevel) => setStack((s) => [...s, l]);
  const pop = () => setStack((s) => (s.length > 1 ? s.slice(0, -1) : s));

  const crumb = ['会话', '回合', '推理', '明细'].slice(0, stack.length).join(' / ');

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/50 backdrop-blur-sm" onClick={onClose}>
      <div className="flex h-full w-full max-w-3xl flex-col border-l border-white/[0.08] bg-[#181b1f] shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-3 border-b border-white/[0.07] px-5 py-3">
          {stack.length > 1 && (
            <button type="button" onClick={pop} className="rounded-lg p-1 text-zinc-400 hover:bg-white/[0.06]"><ArrowLeft size={16} /></button>
          )}
          <div className="min-w-0 flex-1">
            <div className="truncate font-mono text-sm text-zinc-100">{agentId}</div>
            <div className="text-[11px] text-zinc-500">{crumb}</div>
          </div>
          <button type="button" onClick={onClose} className="rounded-lg p-1 text-zinc-400 hover:bg-white/[0.06]"><X size={16} /></button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          {level.kind === 'sessions' && <SessionsLevel agentId={agentId} onOpen={(sessionId) => push({ kind: 'turns', sessionId })} />}
          {level.kind === 'turns' && <TurnsLevel agentId={agentId} sessionId={level.sessionId} onOpen={(turnId) => push({ kind: 'inferences', sessionId: level.sessionId, turnId })} />}
          {level.kind === 'inferences' && <InferencesLevel agentId={agentId} turnId={level.turnId} onOpen={(inferenceId) => push({ kind: 'inference', sessionId: level.sessionId, turnId: level.turnId, inferenceId })} />}
          {level.kind === 'inference' && <InferenceDetailLevel agentId={agentId} inferenceId={level.inferenceId} />}
        </div>
      </div>
    </div>
  );
}

function useAsync<T>(fn: () => Promise<T>, deps: unknown[]): { data: T | null; loading: boolean } {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let alive = true;
    setLoading(true);
    fn().then((d) => { if (alive) setData(d); }).catch((e) => { if (alive) { setData(null); showToast(e instanceof Error ? e.message : '加载失败', 'error'); } }).finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return { data, loading };
}

function SessionsLevel({ agentId, onOpen }: { agentId: string; onOpen: (id: string) => void }) {
  const { data, loading } = useAsync<UsageSession[]>(() => fetchUsageSessions(agentId), [agentId]);
  if (loading) return <InlineSpinner label="加载会话…" />;
  if (!data?.length) return <EmptyText text="无会话记录" />;
  return (
    <RollupTable
      cols={['会话', '状态', 'LLM', '工具', '开始', '成本']}
      rows={data.map((s) => ({
        key: s.id,
        onClick: () => onOpen(s.id),
        cells: [<span className="font-mono text-xs">{s.id.slice(0, 12)}</span>, s.status, String(s.llmCallCount), String(s.toolCallCount), when(s.startTime), money(s.totalCost)],
      }))}
    />
  );
}

function TurnsLevel({ agentId, sessionId, onOpen }: { agentId: string; sessionId: string; onOpen: (id: string) => void }) {
  const { data, loading } = useAsync<UsageTurn[]>(() => fetchUsageTurns(agentId, sessionId), [agentId, sessionId]);
  if (loading) return <InlineSpinner label="加载回合…" />;
  if (!data?.length) return <EmptyText text="无回合记录" />;
  return (
    <RollupTable
      cols={['提示', '状态', 'LLM', '工具', '开始', '成本']}
      rows={data.map((t) => ({
        key: t.id,
        onClick: () => onOpen(t.id),
        cells: [<span className="block max-w-[180px] truncate">{t.prompt ?? '—'}</span>, t.status, String(t.llmCallCount), String(t.toolCallCount), when(t.startTime), money(t.totalCost)],
      }))}
    />
  );
}

function InferencesLevel({ agentId, turnId, onOpen }: { agentId: string; turnId: string; onOpen: (id: string) => void }) {
  const { data, loading } = useAsync<UsageInference[]>(() => fetchUsageInferences(agentId, turnId), [agentId, turnId]);
  if (loading) return <InlineSpinner label="加载推理…" />;
  if (!data?.length) return <EmptyText text="无推理记录" />;
  return (
    <RollupTable
      cols={['模型', 'In/Out', '缓存读', '延迟', '停因', '成本']}
      rows={data.map((inf) => ({
        key: inf.id,
        onClick: () => onOpen(inf.id),
        cells: [shortModel(inf.model), `${compact(inf.inputTokens)}/${compact(inf.outputTokens)}`, compact(inf.cacheReadTokens), `${Math.round(inf.latencyMs)}ms`, inf.stopReason, money(inf.totalCost)],
      }))}
    />
  );
}

function InferenceDetailLevel({ agentId, inferenceId }: { agentId: string; inferenceId: string }) {
  const { data, loading } = useAsync<UsageInferenceDetail | null>(() => fetchUsageInferenceDetail(agentId, inferenceId), [agentId, inferenceId]);
  const [tab, setTab] = useState<'messages' | 'system' | 'tools' | 'wire'>('messages');
  if (loading) return <InlineSpinner label="加载明细…" />;
  if (!data) return <EmptyText text="推理明细不存在" />;
  const family = /claude|opus|sonnet|haiku/i.test(data.model) ? 'anthropic' : 'openai';
  const tabs: Array<[typeof tab, string, string | null]> = [
    ['messages', '消息', data.requestMessages],
    ['system', 'System', data.requestSystem],
    ['tools', '工具定义', data.requestTools],
    ['wire', '原始往返', data.providerRequest ?? data.providerResponse],
  ];
  const active = tabs.find((t) => t[0] === tab);
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
        <StatTile label="模型" value={<span className="text-xs">{shortModel(data.model)}</span>} hint={`${family} · ${data.provider}`} />
        <StatTile label="成本" value={money(data.totalCost)} />
        <StatTile label="In / Out" value={`${compact(data.inputTokens)}/${compact(data.outputTokens)}`} hint={`缓存读 ${compact(data.cacheReadTokens)} / 写 ${compact(data.cacheWriteTokens)}`} />
        <StatTile label="延迟" value={`${Math.round(data.latencyMs)}ms`} hint={data.ttftMs != null ? `首字 ${Math.round(data.ttftMs)}ms` : undefined} />
      </div>
      <div className="flex gap-1 border-b border-white/[0.07]">
        {tabs.map(([k, label]) => (
          <button key={k} type="button" onClick={() => setTab(k)} className={cn('px-3 py-1.5 text-xs transition-colors', tab === k ? 'border-b-2 border-sky-400 text-zinc-100' : 'text-zinc-500 hover:text-zinc-300')}>{label}</button>
        ))}
      </div>
      <JsonBlock value={active?.[2] ?? null} />
      {data.toolCalls.length > 0 && (
        <SectionCard title={`工具调用 (${data.toolCalls.length})`}>
          <div className="space-y-2">
            {data.toolCalls.map((tc, i) => (
              <div key={i} className="rounded-lg border border-white/[0.07] p-2 text-xs">
                <div className="flex items-center justify-between">
                  <span className="font-mono text-zinc-200">{tc.name}</span>
                  <span className={cn('rounded px-1.5 py-0.5 text-[10px]', tc.isError ? 'bg-red-400/10 text-red-300' : 'bg-emerald-400/10 text-emerald-300')}>{tc.isError ? 'error' : 'ok'} · {Math.round(tc.durationMs)}ms</span>
                </div>
              </div>
            ))}
          </div>
        </SectionCard>
      )}
    </div>
  );
}

function JsonBlock({ value }: { value: string | null }) {
  if (!value) return <EmptyText text="无内容" />;
  let pretty = value;
  try { pretty = JSON.stringify(JSON.parse(value), null, 2); } catch { /* not JSON; show raw */ }
  return (
    <pre className="max-h-96 overflow-auto rounded-lg border border-white/[0.07] bg-black/30 p-3 font-mono text-[11px] leading-relaxed text-zinc-300">
      {pretty}
    </pre>
  );
}

function EmptyText({ text }: { text: string }) {
  return <div className="rounded-lg border border-dashed border-white/[0.1] px-3 py-8 text-center text-xs text-zinc-600">{text}</div>;
}
