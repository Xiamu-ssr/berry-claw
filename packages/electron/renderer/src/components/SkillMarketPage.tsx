import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Download,
  DownloadCloud,
  Loader2,
  RefreshCcw,
  Search,
  Sparkles,
  Star,
  Trash2,
  Users,
} from 'lucide-react';
import { API, apiFetch } from '../api/paths';
import { useAgentFacts, useSystemFact } from '../facts/useFacts';
import { showToast } from './Toast';
import type { InstalledSkill, SkillMarketItem } from '@berry-claw/contracts';
import {
  EmptyState,
  IconButton,
  Pill,
  PrimaryButton,
  SectionCard,
  SplitWorkbench,
  TextInput,
  WorkbenchPage,
} from './workbench';

type SourceId = 'clawhub';

interface SourceMeta {
  id: SourceId;
  displayName: string;
  available: boolean;
}

export default function SkillMarketPage() {
  const system = useSystemFact();
  const agents = useAgentFacts();
  const installed: InstalledSkill[] = useMemo(() => system?.installedSkills ?? [], [system?.installedSkills]);
  const installedNames = useMemo(() => new Set(installed.map((skill) => skill.name)), [installed]);
  const [sources, setSources] = useState<SourceMeta[]>([]);
  const [activeSource, setActiveSource] = useState<SourceId>('clawhub');
  const [query, setQuery] = useState('');
  const [items, setItems] = useState<SkillMarketItem[]>([]);
  const [visibleLimit, setVisibleLimit] = useState(40);
  const [listing, setListing] = useState(false);
  const [installingSlug, setInstallingSlug] = useState<string | null>(null);
  const [uninstallingName, setUninstallingName] = useState<string | null>(null);

  useEffect(() => {
    apiFetch(API.skillsSources)
      .then((res) => res.json())
      .then((data) => {
        const list = (data.sources ?? []) as SourceMeta[];
        setSources(list);
        const firstAvailable = list.find((source) => source.available);
        if (firstAvailable && !list.find((source) => source.id === activeSource && source.available)) {
          setActiveSource(firstAvailable.id);
        }
      })
      .catch((err) => showToast(`Load sources failed: ${err.message}`, 'error'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const refresh = useCallback(async () => {
    setListing(true);
    try {
      const res = await apiFetch(API.skillsAvailable(activeSource, query.trim() || undefined));
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      setItems((data.items ?? []) as SkillMarketItem[]);
      setVisibleLimit(40);
    } catch (err) {
      showToast(`List failed: ${err instanceof Error ? err.message : String(err)}`, 'error');
      setItems([]);
    } finally {
      setListing(false);
    }
  }, [activeSource, query]);

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeSource]);

  const install = async (item: SkillMarketItem) => {
    setInstallingSlug(item.slug);
    try {
      const res = await apiFetch(API.skillsInstall, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sourceId: item.source, slug: item.slug }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      showToast(`Installed "${data.installed?.name ?? item.name}"`);
    } catch (err) {
      showToast(`Install failed: ${err instanceof Error ? err.message : String(err)}`, 'error');
    } finally {
      setInstallingSlug(null);
    }
  };

  const uninstall = async (name: string) => {
    if (!window.confirm(`Uninstall skill "${name}"?`)) return;
    setUninstallingName(name);
    try {
      const res = await apiFetch(API.skillsRemove(name), { method: 'DELETE' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      showToast(`Uninstalled "${name}"`);
    } catch (err) {
      showToast(`Uninstall failed: ${err instanceof Error ? err.message : String(err)}`, 'error');
    } finally {
      setUninstallingName(null);
    }
  };

  const agentUsingSkill = useMemo(() => {
    const map = new Map<string, number>();
    for (const agent of agents) {
      for (const skill of agent.enabledSkills ?? []) {
        map.set(skill, (map.get(skill) ?? 0) + 1);
      }
    }
    return map;
  }, [agents]);

  const activeMeta = sources.find((source) => source.id === activeSource);
  const visibleItems = items.slice(0, visibleLimit);

  return (
    <WorkbenchPage
      eyebrow="Config"
      title="Skill"
      description="安装到全局 Skill 池；每个 agent 的可见性在智能体页独立控制。"
      actions={
        <PrimaryButton onClick={refresh} disabled={listing}>
          <RefreshCcw size={14} className={listing ? 'animate-spin' : ''} />
          刷新市场
        </PrimaryButton>
      }
    >
      <SplitWorkbench
        left={
          <div className="p-3">
            <SectionCard title="来源" icon={<DownloadCloud size={15} />}>
              <div className="space-y-2">
                {sources.length === 0 ? (
                  <div className="text-xs text-zinc-600">Loading sources...</div>
                ) : (
                  sources.map((source) => (
                    <button
                      key={source.id}
                      onClick={() => source.available && setActiveSource(source.id)}
                      disabled={!source.available}
                      className={`flex w-full items-center justify-between rounded-lg border px-3 py-2 text-left text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
                        source.id === activeSource
                          ? 'border-emerald-400/30 bg-emerald-400/10 text-emerald-200'
                          : 'border-white/[0.07] bg-black/15 text-zinc-400 hover:bg-white/[0.05] hover:text-zinc-100'
                      }`}
                    >
                      <span>{source.displayName}</span>
                      <Pill tone={source.available ? 'good' : 'neutral'}>{source.available ? 'online' : 'missing'}</Pill>
                    </button>
                  ))
                )}
              </div>
            </SectionCard>

            <SectionCard title="已安装" icon={<Sparkles size={15} />} className="mt-3">
              <InstalledSkills
                installed={installed}
                agentUsingSkill={agentUsingSkill}
                uninstallingName={uninstallingName}
                onUninstall={uninstall}
              />
            </SectionCard>
          </div>
        }
      >
        <div className="space-y-4 p-5">
          <SectionCard>
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative min-w-[220px] flex-1">
                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-600" />
                <TextInput
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') void refresh();
                  }}
                  placeholder={`Search ${activeMeta?.displayName ?? 'skills'}...`}
                  className="w-full pl-8"
                />
              </div>
              <PrimaryButton onClick={refresh} disabled={listing}>
                <RefreshCcw size={14} className={listing ? 'animate-spin' : ''} />
                搜索
              </PrimaryButton>
            </div>
            {activeMeta && !activeMeta.available && (
              <div className="mt-3 rounded-lg border border-amber-400/20 bg-amber-400/10 px-3 py-2 text-xs text-amber-200">
                当前来源不可用。请确认 ClawHub CLI 随依赖安装完成。
              </div>
            )}
          </SectionCard>

          <SectionCard title="市场" icon={<Download size={15} />}>
            {listing ? (
              <div className="flex items-center justify-center py-16 text-sm text-zinc-500">
                <Loader2 size={16} className="mr-2 animate-spin" />
                Loading...
              </div>
            ) : items.length === 0 ? (
              <EmptyState title="没有找到 skill" body="换个关键词试试，或者刷新当前来源。" />
            ) : (
              <div className="space-y-4">
                <div className="grid gap-3 xl:grid-cols-2">
                  {visibleItems.map((item) => (
                    <MarketSkillCard
                      key={`${item.source}:${item.slug}`}
                      item={item}
                      installed={installedNames.has(item.name)}
                      installing={installingSlug === item.slug}
                      onInstall={() => install(item)}
                    />
                  ))}
                </div>
                {visibleLimit < items.length && (
                  <div className="flex justify-center">
                    <button
                      type="button"
                      onClick={() => setVisibleLimit((current) => Math.min(items.length, current + 40))}
                      className="rounded-md border border-white/[0.08] bg-white/[0.04] px-4 py-2 text-xs text-zinc-300 transition-colors hover:bg-white/[0.08] hover:text-zinc-100"
                    >
                      显示更多 ({visibleLimit}/{items.length})
                    </button>
                  </div>
                )}
              </div>
            )}
          </SectionCard>
        </div>
      </SplitWorkbench>
    </WorkbenchPage>
  );
}

function InstalledSkills({
  installed,
  agentUsingSkill,
  uninstallingName,
  onUninstall,
}: {
  installed: InstalledSkill[];
  agentUsingSkill: Map<string, number>;
  uninstallingName: string | null;
  onUninstall: (name: string) => void;
}) {
  if (installed.length === 0) {
    return <div className="rounded-lg bg-black/20 px-3 py-6 text-center text-xs text-zinc-600">Nothing installed</div>;
  }
  return (
    <div className="space-y-2">
      {installed.map((skill) => {
        const busy = uninstallingName === skill.name;
        return (
          <div key={skill.name} className="rounded-lg border border-white/[0.07] bg-black/15 p-3">
            <div className="flex items-start gap-2">
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium text-zinc-100">{skill.name}</div>
                {skill.description && <p className="mt-1 line-clamp-2 text-xs text-zinc-500">{skill.description}</p>}
                <div className="mt-2 flex flex-wrap gap-1.5">
                  <Pill>{skill.source ?? 'manual'}</Pill>
                  <Pill>{agentUsingSkill.get(skill.name) ?? 0} agents</Pill>
                </div>
              </div>
              <IconButton title="Uninstall skill" tone="bad" onClick={() => onUninstall(skill.name)} disabled={busy}>
                {busy ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
              </IconButton>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function MarketSkillCard({
  item,
  installed,
  installing,
  onInstall,
}: {
  item: SkillMarketItem;
  installed: boolean;
  installing: boolean;
  onInstall: () => void;
}) {
  const hasHeat =
    typeof item.installs === 'number' ||
    typeof item.downloads === 'number' ||
    typeof item.stars === 'number';

  return (
    <div className="rounded-xl border border-white/[0.07] bg-black/15 p-4 transition-colors hover:border-white/[0.13] hover:bg-white/[0.04]">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="min-w-0 truncate text-sm font-medium text-zinc-100">{item.name}</span>
            <Pill>{item.source}</Pill>
            {item.version && <Pill>v{item.version}</Pill>}
          </div>
          {item.description && <p className="mt-2 line-clamp-2 text-sm text-zinc-500">{item.description}</p>}
          <div className="mt-3 flex flex-wrap items-center gap-3 text-[11px] text-zinc-600">
            {typeof item.installs === 'number' && <Metric icon={<Users size={11} />} value={formatCount(item.installs)} title="Active installs" />}
            {typeof item.downloads === 'number' && <Metric icon={<DownloadCloud size={11} />} value={formatCount(item.downloads)} title="Downloads" />}
            {typeof item.stars === 'number' && item.stars > 0 && <Metric icon={<Star size={11} />} value={formatCount(item.stars)} title="Stars" />}
            {!hasHeat && <span title="ClawHub search 结果没有返回安装、下载、收藏统计；berry-claw 会用 explore 缓存尽量补齐。">ClawHub 未返回热度</span>}
            <span className="truncate font-mono">{item.slug}</span>
          </div>
        </div>
        <PrimaryButton onClick={onInstall} disabled={installed || installing}>
          {installed ? (
            <>
              <Sparkles size={14} />
              已安装
            </>
          ) : installing ? (
            <>
              <Loader2 size={14} className="animate-spin" />
              安装中
            </>
          ) : (
            <>
              <Download size={14} />
              安装
            </>
          )}
        </PrimaryButton>
      </div>
    </div>
  );
}

function Metric({ icon, value, title }: { icon: React.ReactNode; value: string; title: string }) {
  return (
    <span className="inline-flex items-center gap-1" title={title}>
      {icon}
      {value}
    </span>
  );
}

function formatCount(n: number): string {
  if (n < 1000) return String(n);
  if (n < 10_000) return (n / 1000).toFixed(1).replace(/\.0$/, '') + 'k';
  if (n < 1_000_000) return Math.round(n / 1000) + 'k';
  return (n / 1_000_000).toFixed(1).replace(/\.0$/, '') + 'M';
}
