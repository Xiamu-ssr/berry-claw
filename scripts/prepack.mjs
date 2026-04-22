#!/usr/bin/env node
/**
 * prepack — swap local `file:` SDK deps for published semver ranges so the
 * packaged tarball is installable from the public registry.
 *
 * package.json is restored by scripts/postpack.mjs after npm finishes packing.
 */
import { readFileSync, writeFileSync, copyFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const PKG_PATH = resolve(ROOT, 'package.json');
const BACKUP_PATH = resolve(ROOT, 'package.json.prepack-backup');

// Alpha-channel release ranges, per-package. Different sub-packages ship on
// different minor tracks (e.g. memory-file landed later), so a single range
// doesn't work.
const SDK_RANGES = {
  '@berry-agent/core': '^0.3.0-alpha.0',
  '@berry-agent/observe': '^0.3.0-alpha.0',
  '@berry-agent/safe': '^0.3.0-alpha.0',
  '@berry-agent/tools-common': '^0.3.0-alpha.0',
  '@berry-agent/memory-file': '^0.4.0-alpha.0',
  '@berry-agent/models': '^0.1.0-alpha.0',
  '@berry-agent/team': '^0.1.0-alpha.0',
  '@berry-agent/mcp': '^0.3.0-alpha.0',
};
const FALLBACK_RANGE = '^0.3.0-alpha.0';

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
