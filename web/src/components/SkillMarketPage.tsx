/**
 * Skill Market — browse external sources and install skills into the global pool.
 *
 * UX model:
 * - Source picker (ClawHub / GitHub) at the top. Unavailable sources render
 *   disabled with a hint (e.g. "Install `clawhub` CLI to enable").
 * - Search field + grid of available items on the left (two-thirds).
 * - Installed drawer on the right, fed by SystemFact.installedSkills.
 * - Install / uninstall are one-shot fetches; the server emits a SystemFact
 *   update on success which propagates back through the FactStore — the
 *   drawer re-renders without us manually refetching.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Download, DownloadCloud, Loader2, RefreshCcw, Search, Sparkles, Star, Trash2, Users } from 'lucide-react';
import { API } from '../api/paths';
import { useSystemFact } from '../facts/useFacts';
import { showToast } from './Toast';
import type { InstalledSkill, SkillMarketItem } from '../facts/types';

type SourceId = 'clawhub';

/** Abbreviate big counts (e.g. 4113 → "4.1k", 164452 → "164k"). */
function formatCount(n: number): string {
  if (n < 1000) return String(n);
  if (n < 10_000) return (n / 1000).toFixed(1).replace(/\.0$/, '') + 'k';
  if (n < 1_000_000) return Math.round(n / 1000) + 'k';
  return (n / 1_000_000).toFixed(1).replace(/\.0$/, '') + 'M';
}

interface SourceMeta {
  id: SourceId;
  displayName: string;
  available: boolean;
}

export default function SkillMarketPage() {
  const system = useSystemFact();
  const installed: InstalledSkill[] = useMemo(
    () => system?.installedSkills ?? [],
    [system?.installedSkills],
  );
  const installedNames = useMemo(() => new Set(installed.map((s) => s.name)), [installed]);

  const [sources, setSources] = useState<SourceMeta[]>([]);
  const [activeSource, setActiveSource] = useState<SourceId>('clawhub');
  const [query, setQuery] = useState('');
  const [items, setItems] = useState<SkillMarketItem[]>([]);
  const [listing, setListing] = useState(false);
  const [installingSlug, setInstallingSlug] = useState<string | null>(null);
  const [uninstallingName, setUninstallingName] = useState<string | null>(null);

  // One-shot fetch of sources on mount. Server list is stable — no need to poll.
  useEffect(() => {
    fetch(API.skillsSources)
      .then((r) => r.json())
      .then((data) => {
        const list = (data.sources ?? []) as SourceMeta[];
        setSources(list);
        // Auto-fall to an available source if the default (clawhub) isn't installed.
        const firstAvail = list.find((s) => s.available);
        if (firstAvail && !list.find((s) => s.id === activeSource && s.available)) {
          setActiveSource(firstAvail.id);
        }
      })
      .catch((err) => showToast(`Load sources failed: ${err.message}`, 'error'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const refresh = useCallback(async () => {
    setListing(true);
    try {
      const res = await fetch(API.skillsAvailable(activeSource, query.trim() || undefined));
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      setItems((data.items ?? []) as SkillMarketItem[]);
    } catch (err: any) {
      showToast(`List failed: ${err.message}`, 'error');
      setItems([]);
    } finally {
      setListing(false);
    }
  }, [activeSource, query]);

  // Re-list whenever the source changes; searches are manual (Enter / button).
  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeSource]);

  const install = async (item: SkillMarketItem) => {
    setInstallingSlug(item.slug);
    try {
      const res = await fetch(API.skillsInstall, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sourceId: item.source, slug: item.slug }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      showToast(`Installed "${data.installed?.name ?? item.name}"`);
    } catch (err: any) {
      showToast(`Install failed: ${err.message}`, 'error');
    } finally {
      setInstallingSlug(null);
    }
  };

  const uninstall = async (name: string) => {
    if (!window.confirm(`Uninstall skill "${name}"?`)) return;
    setUninstallingName(name);
    try {
      const res = await fetch(API.skillsRemove(name), { method: 'DELETE' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      showToast(`Uninstalled "${name}"`);
    } catch (err: any) {
      showToast(`Uninstall failed: ${err.message}`, 'error');
    } finally {
      setUninstallingName(null);
    }
  };

  const activeMeta = sources.find((s) => s.id === activeSource);

  return (
    <div className="flex-1 overflow-auto bg-[#0d0d0d] text-gray-200">
      <div className="max-w-6xl mx-auto p-6">
        {/* Header */}
        <div className="flex items-center gap-3 mb-6">
          <Sparkles size={22} className="text-berry-400" />
          <div>
            <h1 className="text-xl font-semibold">Skill Market</h1>
            <p className="text-xs text-gray-500 mt-0.5">
              Install skills from external sources into the global pool at
              <code className="px-1 text-gray-400">~/.berry-claw/skills/</code>.
              Each agent chooses which installed skills to enable in the Agents tab.
            </p>
          </div>
        </div>

        {/* Source picker */}
        <div className="flex flex-wrap items-center gap-2 mb-4">
          {sources.map((s) => (
            <button
              key={s.id}
              onClick={() => s.available && setActiveSource(s.id)}
              disabled={!s.available}
              className={`px-3 py-1.5 text-xs rounded-md border transition-colors ${
                s.id === activeSource
                  ? 'bg-berry-600/20 border-berry-500 text-berry-200'
                  : 'bg-[#111] border-[#1f1f1f] text-gray-400 hover:border-[#333]'
              } ${!s.available ? 'opacity-50 cursor-not-allowed' : ''}`}
              title={!s.available ? 'Source unavailable in this environment' : s.displayName}
            >
              {s.displayName}
              {!s.available && <span className="ml-1 text-gray-600">(unavailable)</span>}
            </button>
          ))}
          {sources.length === 0 && (
            <span className="text-xs italic text-gray-500">Loading sources…</span>
          )}
        </div>

        {/* Availability hint for clawhub (should not normally fire — the CLI
            ships as an npm dep of berry-claw, but surface a diagnostic
            message if the bundled binary is somehow missing). */}
        {activeMeta && !activeMeta.available && activeSource === 'clawhub' && (
          <div className="mb-4 p-3 bg-amber-900/20 border border-amber-900/40 rounded-md text-xs text-amber-300">
            The bundled ClawHub CLI isn't resolvable. Reinstall berry-claw dependencies
            (<code className="px-1">npm install</code>) and reload this page.
          </div>
        )}

        {/* Search row */}
        <div className="flex items-center gap-2 mb-4">
          <div className="relative flex-1 max-w-md">
            <Search size={14} className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-600" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') refresh();
              }}
              placeholder={`Search ${activeMeta?.displayName ?? 'skills'}…`}
              className="w-full pl-7 pr-2 py-1.5 text-xs bg-[#111] border border-[#1f1f1f] rounded-md text-gray-200 placeholder:text-gray-600 focus:outline-none focus:border-berry-500"
            />
          </div>
          <button
            onClick={refresh}
            disabled={listing}
            className="px-3 py-1.5 text-xs rounded-md border border-[#1f1f1f] bg-[#111] text-gray-300 hover:border-[#333] flex items-center gap-1.5"
          >
            <RefreshCcw size={12} className={listing ? 'animate-spin' : ''} />
            Refresh
          </button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {/* Available skills grid (spans 2 cols) */}
          <div className="md:col-span-2">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-gray-500 mb-2">
              Available
            </h2>
            {listing ? (
              <div className="flex items-center gap-2 text-xs italic text-gray-500 py-8 justify-center">
                <Loader2 size={14} className="animate-spin" />
                Loading…
              </div>
            ) : items.length === 0 ? (
              <div className="text-xs italic text-gray-500 py-8 text-center">
                No skills found for this source / query.
              </div>
            ) : (
              <div className="space-y-2">
                {items.map((item) => {
                  const isInstalled = installedNames.has(item.name);
                  const isInstalling = installingSlug === item.slug;
                  return (
                    <div
                      key={`${item.source}:${item.slug}`}
                      className="p-3 bg-[#111] border border-[#1f1f1f] rounded-md hover:border-[#2a2a2a] transition-colors"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <span className="font-medium text-sm text-gray-200 truncate">
                              {item.name}
                            </span>
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-[#1a1a1a] text-gray-500 border border-[#222]">
                              {item.source}
                            </span>
                          </div>
                          {item.description && (
                            <p className="text-xs text-gray-500 mt-1 line-clamp-2">
                              {item.description}
                            </p>
                          )}
                          <div className="flex items-center gap-3 mt-1.5 text-[10px] text-gray-500">
                            {typeof item.installs === 'number' && (
                              <span
                                className="flex items-center gap-1"
                                title="Active installs"
                              >
                                <Users size={10} />
                                {formatCount(item.installs)}
                              </span>
                            )}
                            {typeof item.downloads === 'number' && (
                              <span
                                className="flex items-center gap-1"
                                title="Lifetime downloads"
                              >
                                <DownloadCloud size={10} />
                                {formatCount(item.downloads)}
                              </span>
                            )}
                            {typeof item.stars === 'number' && item.stars > 0 && (
                              <span
                                className="flex items-center gap-1"
                                title="Stars"
                              >
                                <Star size={10} />
                                {formatCount(item.stars)}
                              </span>
                            )}
                            {item.version && (
                              <span className="font-mono text-gray-600">v{item.version}</span>
                            )}
                          </div>
                          <div className="text-[10px] text-gray-600 mt-1 truncate font-mono">
                            {item.slug}
                          </div>
                        </div>
                        <button
                          onClick={() => install(item)}
                          disabled={isInstalled || isInstalling}
                          className={`px-3 py-1.5 text-xs rounded-md flex items-center gap-1.5 flex-shrink-0 ${
                            isInstalled
                              ? 'bg-green-900/20 border border-green-900/40 text-green-400 cursor-default'
                              : 'bg-berry-600/20 border border-berry-600/40 text-berry-200 hover:bg-berry-600/30 disabled:opacity-50'
                          }`}
                        >
                          {isInstalled ? (
                            'Installed'
                          ) : isInstalling ? (
                            <>
                              <Loader2 size={12} className="animate-spin" />
                              Installing…
                            </>
                          ) : (
                            <>
                              <Download size={12} />
                              Install
                            </>
                          )}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Installed drawer */}
          <div>
            <h2 className="text-xs font-semibold uppercase tracking-wider text-gray-500 mb-2">
              Installed ({installed.length})
            </h2>
            {installed.length === 0 ? (
              <div className="text-xs italic text-gray-500 py-4">
                Nothing installed yet.
              </div>
            ) : (
              <div className="space-y-2">
                {installed.map((s) => {
                  const isUninstalling = uninstallingName === s.name;
                  return (
                    <div
                      key={s.name}
                      className="p-3 bg-[#111] border border-[#1f1f1f] rounded-md"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <div className="font-medium text-sm text-gray-200 truncate">
                            {s.name}
                          </div>
                          {s.description && (
                            <p className="text-xs text-gray-500 mt-1 line-clamp-2">
                              {s.description}
                            </p>
                          )}
                          <div className="text-[10px] text-gray-600 mt-1">
                            {s.source ?? 'manual'}
                            {s.installedAt && (
                              <> · {new Date(s.installedAt).toLocaleDateString()}</>
                            )}
                          </div>
                        </div>
                        <button
                          onClick={() => uninstall(s.name)}
                          disabled={isUninstalling}
                          className="p-1.5 rounded-md text-gray-500 hover:text-red-400 hover:bg-red-900/10 disabled:opacity-50"
                          title="Uninstall"
                        >
                          {isUninstalling ? (
                            <Loader2 size={14} className="animate-spin" />
                          ) : (
                            <Trash2 size={14} />
                          )}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
