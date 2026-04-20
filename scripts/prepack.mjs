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

// Keep one source of truth for the alpha release channel.
const SDK_RANGE = '^0.3.0-alpha.0';

const pkg = JSON.parse(readFileSync(PKG_PATH, 'utf-8'));

// Backup before mutating — restored in postpack.
copyFileSync(PKG_PATH, BACKUP_PATH);

let changed = 0;
for (const [name, spec] of Object.entries(pkg.dependencies ?? {})) {
  if (typeof spec === 'string' && spec.startsWith('file:') && name.startsWith('@berry-agent/')) {
    pkg.dependencies[name] = SDK_RANGE;
    changed++;
  }
}

writeFileSync(PKG_PATH, JSON.stringify(pkg, null, 2) + '\n');
console.log(`prepack: rewrote ${changed} SDK deps to ${SDK_RANGE}`);
