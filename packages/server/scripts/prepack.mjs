#!/usr/bin/env node
/**
 * prepack — swap local `file:` SDK deps for published semver ranges so the
 * packaged tarball is installable from the public registry.
 *
 * package.json is restored by scripts/postpack.mjs after npm finishes packing.
 */
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync, copyFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const MONOREPO_ROOT = resolve(ROOT, '../..');
const PKG_PATH = resolve(ROOT, 'package.json');
const BACKUP_PATH = resolve(ROOT, 'package.json.prepack-backup');
const WEB_DIST_SRC = resolve(MONOREPO_ROOT, 'packages/electron/renderer/dist');
const WEB_DIST_DEST = resolve(ROOT, 'web-dist');
const BUILTIN_SKILLS_SRC = resolve(MONOREPO_ROOT, 'skills/builtin');
const BUILTIN_SKILLS_DEST = resolve(ROOT, 'skills/builtin');

// Alpha-channel release ranges, per-package. Different sub-packages ship on
// different minor tracks (e.g. memory-file landed later), so a single range
// doesn't work.
const SDK_RANGES = {
  '@berry-agent/core': '^0.5.0-alpha.0',
  '@berry-agent/observe': '^0.5.0-alpha.0',
  '@berry-agent/safe': '^0.5.0-alpha.0',
  '@berry-agent/tools-common': '^0.5.0-alpha.0',
  '@berry-agent/memory-file': '^0.5.0-alpha.0',
  '@berry-agent/models': '^0.5.0-alpha.0',
  '@berry-agent/prompt-pack': '^0.5.0-alpha.0',
  '@berry-agent/team': '^0.5.0-alpha.0',
  '@berry-agent/mcp': '^0.5.0-alpha.0',
};
const FALLBACK_RANGE = '^0.5.0-alpha.0';

const pkg = JSON.parse(readFileSync(PKG_PATH, 'utf-8'));

// Backup before mutating — restored in postpack.
copyFileSync(PKG_PATH, BACKUP_PATH);

let changed = 0;
for (const [name, spec] of Object.entries(pkg.dependencies ?? {})) {
  if (typeof spec === 'string' && spec.startsWith('file:') && name.startsWith('@berry-agent/')) {
    pkg.dependencies[name] = SDK_RANGES[name] ?? FALLBACK_RANGE;
    changed++;
  }
}

writeFileSync(PKG_PATH, JSON.stringify(pkg, null, 2) + '\n');
console.log(`prepack: rewrote ${changed} SDK deps (per-package ranges)`);

if (!existsSync(WEB_DIST_SRC)) {
  throw new Error(`prepack: missing renderer build at ${WEB_DIST_SRC}. Run npm run build from the berry-claw root before publishing.`);
}
rmSync(WEB_DIST_DEST, { recursive: true, force: true });
cpSync(WEB_DIST_SRC, WEB_DIST_DEST, { recursive: true });
console.log('prepack: copied renderer dist into server package');

if (!existsSync(BUILTIN_SKILLS_SRC)) {
  throw new Error(`prepack: missing built-in skills at ${BUILTIN_SKILLS_SRC}`);
}
mkdirSync(dirname(BUILTIN_SKILLS_DEST), { recursive: true });
rmSync(BUILTIN_SKILLS_DEST, { recursive: true, force: true });
cpSync(BUILTIN_SKILLS_SRC, BUILTIN_SKILLS_DEST, { recursive: true });
console.log('prepack: copied built-in skills into server package');
