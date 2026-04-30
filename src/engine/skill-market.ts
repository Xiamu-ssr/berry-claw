// ============================================================
// Berry-Claw — Skill Market
// ============================================================
// Wraps the ClawHub CLI as the single upstream skill marketplace
// (https://clawhub.ai), reflected under `~/.berry-claw/skills/`.
//
// Design notes:
//   - ClawHub ships as an npm dependency of berry-claw, so the
//     `clawhub` bin is always resolvable via `require.resolve`;
//     users never have to install anything globally.
//   - We don't manage our own `_meta.json` — ClawHub already
//     writes one at the skill root AND a `.clawhub/origin.json`
//     we can read for provenance (source, slug, installedAt).
//     A skill dir without `.clawhub/origin.json` is treated as
//     `manual` (the user dropped files in by hand).
//   - Browsing (no query) uses `explore --sort trending --json` so
//     the front page reflects what's actually in demand; we surface
//     install/download/star counts so users can judge popularity.
//   - Searching (query present) uses `clawhub search` — a real vector
//     search — for best-match ordering. Search output is plain text
//     (`<slug>  <Display>  (<score>)`), so we join its ordered slugs
//     against a short-lived cache of `explore --sort installsAllTime`
//     to surface stats for each hit. Skills not in that top-200
//     (rare for a query-of-interest) degrade to name-only rendering.
//   - Install uses the CLI's own pathing: we pass
//     `--workdir <parent-of-skills-dir> --dir <basename>` so the
//     CLI writes into `<parent>/<basename>/<slug>/` which is
//     exactly our global pool.
//   - Uninstall prefers `clawhub uninstall` (keeps the CLI's
//     lockfile coherent); falls back to `rm -rf` for skills
//     without a `.clawhub/origin.json` (manual installs).

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, readFile, rm } from 'node:fs/promises';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { loadSkill, loadSkillsFromDir } from '@berry-agent/core';
import type { InstalledSkill } from '../facts/types.js';

const execFileP = promisify(execFile);

// ===== Public types =====

/** A market listing before install — consumed by the UI. */
export interface SkillMarketItem {
  /** Source-specific slug used as the `install` key. */
  slug: string;
  /** Display name (clawhub displayName, or slug as fallback). */
  name: string;
  /** Short description (clawhub summary). */
  description?: string;
  /** Tags, if the source surfaces them. */
  tags?: string[];
  /** Source that owns this entry (echoed back for the UI). */
  source: SkillSourceId;
  /** Currently-active installs reported by ClawHub (popularity proxy). */
  installs?: number;
  /** Lifetime downloads reported by ClawHub. */
  downloads?: number;
  /** Star count reported by ClawHub. */
  stars?: number;
  /** Latest version tag (e.g. `1.0.0`). */
  version?: string;
  /** Last-updated epoch millis reported by the registry. */
  updatedAt?: number;
}

export type SkillSourceId = 'clawhub';

/** One adapter per marketplace. */
export interface SkillSource {
  readonly id: SkillSourceId;
  readonly displayName: string;
  /**
   * Whether this source is usable in the current environment.
   * For ClawHub that means the bundled CLI resolves and runs —
   * which should always succeed post-`npm install`, but we keep
   * the check as a graceful guard against broken installs.
   */
  isAvailable(): Promise<boolean>;
  /** Browse / search. `query` may be empty for "list everything". */
  list(query?: string): Promise<SkillMarketItem[]>;
  /**
   * Download a single skill into the global pool. Returns the
   * directory name that was written (which becomes the skill name
   * the SDK will load it under).
   */
  install(slug: string, globalSkillsDir: string): Promise<string>;
  /**
   * Remove a previously-installed skill by its on-disk name.
   * Implementations should keep their own bookkeeping (e.g.
   * lockfiles) coherent in addition to deleting the directory.
   */
  uninstall(name: string, globalSkillsDir: string): Promise<void>;
}

// ===== ClawHub adapter (bundled CLI) =====

/**
 * ClawHub is the first-party skill registry for OpenClaw
 * (https://clawhub.ai). We shell out to the `clawhub` CLI that
 * ships as an npm dep so the user never has to install anything
 * out-of-band.
 */
export class ClawHubSource implements SkillSource {
  readonly id = 'clawhub' as const;
  readonly displayName = 'ClawHub';
  private _available: boolean | null = null;
  private _binPath: string | null = null;
  /**
   * Short-lived cache of `explore --json` keyed by slug. Populated by
   * {@link refreshExploreCache} — used both as the un-queried browse
   * listing and as the stats source when merging search hits.
   */
  private _exploreCache: {
    at: number;
    /** Pre-sorted by descending installsAllTime (popularity-first browsing). */
    items: SkillMarketItem[];
    bySlug: Map<string, SkillMarketItem>;
  } | null = null;
  private static EXPLORE_TTL_MS = 5 * 60 * 1000;

  /**
   * Resolve the JS entry point for the bundled clawhub bin.
   * We avoid `node_modules/.bin/clawhub` shell-resolution hacks by
   * reading the dep's own `package.json`, which is rooted by
   * `createRequire` relative to this module — robust under
   * tsx-watch, esbuild bundles, and npm-link layouts alike.
   */
  private binPath(): string {
    if (this._binPath) return this._binPath;
    const req = createRequire(import.meta.url);
    const pkgPath = req.resolve('clawhub/package.json');
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8')) as {
      bin?: string | Record<string, string>;
    };
    const binRel =
      typeof pkg.bin === 'string'
        ? pkg.bin
        : pkg.bin?.clawhub ?? pkg.bin?.clawdhub;
    if (!binRel) throw new Error('clawhub package.json has no bin.clawhub entry');
    this._binPath = join(dirname(pkgPath), binRel);
    return this._binPath;
  }

  async isAvailable(): Promise<boolean> {
    if (this._available !== null) return this._available;
    try {
      const bin = this.binPath();
      if (!existsSync(bin)) {
        this._available = false;
        return false;
      }
      // `-V` is the actual version flag; `--version` isn't supported.
      await execFileP(process.execPath, [bin, '-V'], { timeout: 5000 });
      this._available = true;
    } catch {
      this._available = false;
    }
    return this._available;
  }

  async list(query?: string): Promise<SkillMarketItem[]> {
    if (!(await this.isAvailable())) return [];
    const q = query?.trim();
    try {
      if (!q) {
        // Browse: popularity-first — ClawHub's `installsAllTime` sort
        // surfaces the durably-used skills, which matches what a user
        // exploring the market wants to see up top.
        const cache = await this.refreshExploreCache();
        return cache.items;
      }
      // Search: use ClawHub's vector search for real semantic ordering,
      // then hydrate each hit with stats from the explore cache.
      return await this.vectorSearch(q);
    } catch (err) {
      console.error('[skill-market] clawhub list failed:', (err as Error).message);
      return [];
    }
  }

  /**
   * Run `explore --json --sort installsAllTime --limit 200` and build
   * both an ordered array (popularity-first browsing) and a slug→item
   * lookup used when merging search hits. Respects {@link EXPLORE_TTL_MS}.
   */
  private async refreshExploreCache(force = false): Promise<{
    at: number;
    items: SkillMarketItem[];
    bySlug: Map<string, SkillMarketItem>;
  }> {
    const now = Date.now();
    if (
      !force &&
      this._exploreCache &&
      now - this._exploreCache.at < ClawHubSource.EXPLORE_TTL_MS
    ) {
      return this._exploreCache;
    }
    const { stdout } = await execFileP(
      process.execPath,
      [
        this.binPath(),
        'explore',
        '--json',
        '--limit', '200',
        '--sort', 'installsAllTime',
      ],
      { timeout: 20_000, maxBuffer: 16 * 1024 * 1024 },
    );
    const json = safeParseJson(stripSpinnerLines(stdout));
    const rawItems = extractItemArray(json);
    const items = rawItems
      .map((item) => mapRegistryItem(item))
      .filter((i): i is SkillMarketItem => !!i && !!i.slug);
    const bySlug = new Map(items.map((i) => [i.slug, i]));
    this._exploreCache = { at: now, items, bySlug };
    return this._exploreCache;
  }

  /**
   * Run `clawhub search <query>` and parse its plain-text output:
   * `<slug>  <Display Name>  (<score>)` per line. Merge with the
   * explore cache to populate stats; preserve search order.
   */
  private async vectorSearch(query: string): Promise<SkillMarketItem[]> {
    const { stdout } = await execFileP(
      process.execPath,
      [this.binPath(), 'search', '--limit', '60', query],
      { timeout: 20_000, maxBuffer: 8 * 1024 * 1024 },
    );
    const lines = stdout.split('\n');
    const hits: Array<{ slug: string; name: string; score?: number }> = [];
    const lineRe = /^(\S+)\s+(.*?)\s+\(([\d.]+)\)\s*$/;
    for (const raw of lines) {
      const line = raw.trimEnd();
      // Skip spinner / noise lines.
      if (!line || line.startsWith('-') || line.startsWith('✓') || line.startsWith('Searching')) continue;
      const m = line.match(lineRe);
      if (!m) continue;
      hits.push({ slug: m[1], name: m[2].trim(), score: Number(m[3]) });
    }
    if (hits.length === 0) return [];
    // Best-effort stats hydration. Don't let an explore failure kill search.
    const cache = await this.refreshExploreCache().catch(() => null);
    return hits.map<SkillMarketItem>((hit) => {
      const cached = cache?.bySlug.get(hit.slug);
      if (cached) return cached;
      return {
        slug: hit.slug,
        name: hit.name || hit.slug,
        source: 'clawhub' as const,
      };
    });
  }

  async install(slug: string, globalSkillsDir: string): Promise<string> {
    if (!(await this.isAvailable())) {
      throw new Error('clawhub CLI is not available. Reinstall berry-claw dependencies.');
    }
    // The CLI installs into `<workdir>/<dir>/<slug>/`. Our target is
    // `<globalSkillsDir>/<slug>/`, so split the path accordingly.
    const parent = dirname(globalSkillsDir);
    const baseDir = globalSkillsDir.slice(parent.length + 1);
    await mkdir(globalSkillsDir, { recursive: true });
    try {
      await execFileP(
        process.execPath,
        [
          this.binPath(),
          '--workdir', parent,
          '--dir', baseDir,
          '--no-input',
          'install', slug,
        ],
        { timeout: 120_000, maxBuffer: 16 * 1024 * 1024 },
      );
    } catch (err) {
      // Surface stderr to the user — it typically contains the real reason
      // (skill not found, network, permission, etc.).
      const e = err as NodeJS.ErrnoException & { stderr?: string };
      const detail = e.stderr?.toString().trim() ?? e.message;
      throw new Error(`clawhub install failed: ${detail}`);
    }
    // clawhub installs into a dir named after the slug's last segment.
    // Resolve the actual skill name from the SKILL.md frontmatter for
    // the installed dir so downstream dedup / disabledSkills work by name.
    const targetName = slug.split('/').pop() as string;
    const targetDir = join(globalSkillsDir, targetName);
    if (!existsSync(targetDir)) {
      throw new Error(`clawhub install succeeded but no directory appeared at ${targetDir}`);
    }
    const loaded = await loadSkill(targetDir).catch(() => null);
    return loaded?.meta.name ?? targetName;
  }

  async uninstall(name: string, globalSkillsDir: string): Promise<void> {
    // Prefer the CLI so its lockfile stays consistent; fall back to
    // rm -rf if clawhub doesn't know about this dir.
    const dir = join(globalSkillsDir, name);
    if (!existsSync(dir)) return;
    const origin = readOriginSync(dir);
    if (origin && (await this.isAvailable())) {
      const parent = dirname(globalSkillsDir);
      const baseDir = globalSkillsDir.slice(parent.length + 1);
      try {
        await execFileP(
          process.execPath,
          [
            this.binPath(),
            '--workdir', parent,
            '--dir', baseDir,
            '--no-input',
            'uninstall', origin.slug ?? name,
          ],
          { timeout: 30_000, maxBuffer: 4 * 1024 * 1024 },
        );
      } catch (err) {
        console.error('[skill-market] clawhub uninstall failed, falling back to rm:', (err as Error).message);
        await rm(dir, { recursive: true, force: true });
      }
    } else {
      await rm(dir, { recursive: true, force: true });
    }
  }
}

// ===== Service facade =====

export class SkillMarketService {
  readonly sources: SkillSource[];

  constructor(
    private globalSkillsDir: string,
    sources?: SkillSource[],
  ) {
    this.sources = sources ?? [new ClawHubSource()];
  }

  getSource(id: SkillSourceId): SkillSource | undefined {
    return this.sources.find((s) => s.id === id);
  }

  async listSources(): Promise<Array<{ id: SkillSourceId; displayName: string; available: boolean }>> {
    return Promise.all(
      this.sources.map(async (s) => ({
        id: s.id,
        displayName: s.displayName,
        available: await s.isAvailable(),
      })),
    );
  }

  async list(sourceId: SkillSourceId, query?: string): Promise<SkillMarketItem[]> {
    const s = this.getSource(sourceId);
    if (!s) throw new Error(`Unknown skill source: ${sourceId}`);
    return s.list(query);
  }

  async install(sourceId: SkillSourceId, slug: string): Promise<InstalledSkill> {
    const s = this.getSource(sourceId);
    if (!s) throw new Error(`Unknown skill source: ${sourceId}`);
    await mkdir(this.globalSkillsDir, { recursive: true });
    const name = await s.install(slug, this.globalSkillsDir);
    const installed = await this.inspect(name);
    if (!installed) throw new Error(`install wrote but could not read back skill "${name}"`);
    return installed;
  }

  async uninstall(name: string): Promise<void> {
    const dir = join(this.globalSkillsDir, name);
    if (!existsSync(dir)) return;
    // Route to the owning source if we can identify one.
    const origin = readOriginSync(dir);
    if (origin?.registry && origin.registry.includes('clawhub')) {
      const clawhub = this.getSource('clawhub');
      if (clawhub) {
        await clawhub.uninstall(name, this.globalSkillsDir);
        return;
      }
    }
    await rm(dir, { recursive: true, force: true });
  }

  async listInstalled(): Promise<InstalledSkill[]> {
    if (!existsSync(this.globalSkillsDir)) return [];
    const skills = await loadSkillsFromDir(this.globalSkillsDir);
    return skills.map((s) => skillWithOrigin(s.meta.name, s.meta.description, s.dir));
  }

  async inspect(name: string): Promise<InstalledSkill | null> {
    const dir = join(this.globalSkillsDir, name);
    const skill = await loadSkill(dir);
    if (!skill) return null;
    return skillWithOrigin(skill.meta.name, skill.meta.description, dir);
  }

  /** Names of all globally-installed skills (used to compute disabledSkills). */
  async installedNames(): Promise<string[]> {
    const installed = await this.listInstalled();
    return installed.map((s) => s.name);
  }
}

/**
 * Synchronously produce full {@link InstalledSkill} records for every
 * globally-installed skill. Reads SKILL.md frontmatter for name+description
 * and `.clawhub/origin.json` for provenance.
 *
 * Sync because both callers (`deriveSystemFact` and agent-init) run on
 * hot paths we don't want to turn async for O(dozen) fs reads.
 */
export function listInstalledSkillsSync(globalSkillsDir: string): InstalledSkill[] {
  if (!existsSync(globalSkillsDir)) return [];
  let entries: string[];
  try {
    entries = readdirSync(globalSkillsDir);
  } catch {
    return [];
  }
  const out: InstalledSkill[] = [];
  for (const e of entries) {
    const child = join(globalSkillsDir, e);
    let isDir = false;
    try {
      isDir = statSync(child).isDirectory();
    } catch {
      continue;
    }
    if (!isDir) continue;
    const header = readSkillHeaderSync(child);
    if (!header) continue;
    out.push(skillWithOriginSync(header.name ?? e, header.description, child));
  }
  return out;
}

/**
 * Synchronously enumerate installed skill names. Thin convenience wrapper
 * over {@link listInstalledSkillsSync} kept for the agent-init call site
 * that only needs names to build the disabledSkills blacklist.
 *
 * Scan is one level deep — we `readdirSync(dir)` and for each child look
 * for a direct `child/SKILL.md`. Subdirs without a SKILL.md at that level
 * (e.g. `drafts/` which holds `drafts/<name>/SKILL.md`) are silently
 * skipped. This is the mechanism that makes the per-agent `skills/drafts/`
 * convention invisible to the agent until a draft is promoted up one
 * level — no special-casing required.
 */
export function listInstalledSkillNamesSync(globalSkillsDir: string): string[] {
  if (!existsSync(globalSkillsDir)) return [];
  let entries: string[];
  try {
    entries = readdirSync(globalSkillsDir);
  } catch {
    return [];
  }
  const names: string[] = [];
  for (const e of entries) {
    const child = join(globalSkillsDir, e);
    let isDir = false;
    try {
      isDir = statSync(child).isDirectory();
    } catch {
      continue;
    }
    if (!isDir) continue;
    const header = readSkillHeaderSync(child);
    if (!header) continue;
    names.push(header.name ?? e);
  }
  return names;
}

// ===== Internal helpers =====

/** Shape of ClawHub's own per-skill provenance sidecar. */
interface ClawHubOrigin {
  version?: number;
  registry?: string;
  slug?: string;
  installedVersion?: string;
  installedAt?: number;
}

function readOriginSync(skillDir: string): ClawHubOrigin | null {
  try {
    const raw = readFileSync(join(skillDir, '.clawhub', 'origin.json'), 'utf-8');
    return JSON.parse(raw) as ClawHubOrigin;
  } catch {
    return null;
  }
}

async function readOrigin(skillDir: string): Promise<ClawHubOrigin | null> {
  try {
    const raw = await readFile(join(skillDir, '.clawhub', 'origin.json'), 'utf-8');
    return JSON.parse(raw) as ClawHubOrigin;
  } catch {
    return null;
  }
}

function skillWithOriginSync(name: string, description: string | undefined, dir: string): InstalledSkill {
  const origin = readOriginSync(dir);
  if (!origin) {
    return { name, description, source: 'manual' };
  }
  return {
    name,
    description,
    source: 'clawhub',
    slug: origin.slug,
    installedAt: origin.installedAt ? new Date(origin.installedAt).toISOString() : undefined,
  };
}

function skillWithOrigin(name: string, description: string | undefined, dir: string): InstalledSkill {
  // Async callers; keep the sync variant's branch in a single spot.
  // Node's file APIs are cheap enough that we just forward to sync here.
  return skillWithOriginSync(name, description, dir);
}
// Keep readOrigin exported via use (avoid "unused" lint without changing API)
void readOrigin;

function readSkillHeaderSync(dir: string): { name?: string; description?: string } | null {
  for (const filename of ['SKILL.md', 'skill.md']) {
    try {
      const raw = readFileSync(join(dir, filename), 'utf-8');
      return parseSkillMdHeader(raw);
    } catch {
      // keep trying
    }
  }
  return null;
}

function safeParseJson(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

/**
 * Strip spinner / progress lines that clawhub emits to stdout before
 * its JSON payload (e.g. "- Fetching latest skills\n{...}").
 */
function stripSpinnerLines(s: string): string {
  const idx = s.indexOf('{');
  if (idx === -1) return s;
  return s.slice(idx);
}

/**
 * Map one raw registry row from `clawhub explore --json` into our
 * {@link SkillMarketItem} shape. Returns null for rows without a slug
 * (defensive — shouldn't happen in practice).
 */
function mapRegistryItem(item: Record<string, unknown>): SkillMarketItem | null {
  const slug = typeof item.slug === 'string' ? item.slug : '';
  if (!slug) return null;
  const stats = (item.stats ?? {}) as Record<string, unknown>;
  const tags = (item.tags ?? {}) as Record<string, unknown>;
  const name = String(item.displayName ?? item.name ?? slug);
  const description =
    typeof item.summary === 'string'
      ? item.summary
      : typeof item.description === 'string'
        ? item.description
        : undefined;
  return {
    slug,
    name,
    description,
    source: 'clawhub' as const,
    installs: numOrUndef(stats.installsCurrent ?? stats.installsAllTime),
    downloads: numOrUndef(stats.downloads),
    stars: numOrUndef(stats.stars),
    version: typeof tags.latest === 'string' ? tags.latest : undefined,
    updatedAt: numOrUndef(item.updatedAt),
  };
}

function numOrUndef(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}

function extractItemArray(v: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(v)) return v as Array<Record<string, unknown>>;
  if (v && typeof v === 'object') {
    const obj = v as Record<string, unknown>;
    for (const key of ['items', 'results', 'skills', 'data']) {
      if (Array.isArray(obj[key])) return obj[key] as Array<Record<string, unknown>>;
    }
  }
  return [];
}

/**
 * Lightweight header parser — extracts just name/description from
 * the leading YAML frontmatter of a SKILL.md without pulling the
 * full gray-matter dependency. Good enough for list peek.
 */
function parseSkillMdHeader(raw: string): { name?: string; description?: string } {
  if (!raw.startsWith('---')) return {};
  const end = raw.indexOf('\n---', 3);
  if (end === -1) return {};
  const block = raw.slice(3, end);
  const name = matchYamlField(block, 'name');
  const description = matchYamlField(block, 'description');
  return { name, description };
}

function matchYamlField(block: string, key: string): string | undefined {
  const re = new RegExp(`^${key}\\s*:\\s*(.+)$`, 'm');
  const m = block.match(re);
  if (!m) return undefined;
  let v = m[1].trim();
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
    v = v.slice(1, -1);
  }
  return v || undefined;
}
