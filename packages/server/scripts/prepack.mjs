#!/usr/bin/env node
/**
 * prepack — swap local `file:` SDK deps for published semver ranges so the
 * packaged tarball is installable from the public registry.
 *
 * package.json is restored by scripts/postpack.mjs after npm finishes packing.
 */
import { cpSync, existsSync, readFileSync, rmSync, writeFileSync, copyFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const MONOREPO_ROOT = resolve(ROOT, '../..');
const PKG_PATH = resolve(ROOT, 'package.json');
const BACKUP_PATH = resolve(ROOT, 'package.json.prepack-backup');
const WEB_DIST_SRC = resolve(MONOREPO_ROOT, 'packages/client/dist');
const WEB_DIST_DEST = resolve(ROOT, 'web-dist');

const pkg = JSON.parse(readFileSync(PKG_PATH, 'utf-8'));

// Backup before mutating — restored in postpack.
copyFileSync(PKG_PATH, BACKUP_PATH);

let changed = 0;
// The only intra-repo dependency the console carries now is claw-contracts;
// pin it to this package's own version for the published tarball.
if (pkg.dependencies?.['@berry-agent/claw-contracts']) {
  pkg.dependencies['@berry-agent/claw-contracts'] = `^${pkg.version}`;
  changed++;
}

writeFileSync(PKG_PATH, JSON.stringify(pkg, null, 2) + '\n');
console.log(`prepack: rewrote ${changed} publish deps`);

if (!existsSync(WEB_DIST_SRC)) {
  throw new Error(`prepack: missing client build at ${WEB_DIST_SRC}. Run npm run build from the berry-claw root before publishing.`);
}
rmSync(WEB_DIST_DEST, { recursive: true, force: true });
cpSync(WEB_DIST_SRC, WEB_DIST_DEST, { recursive: true });
console.log('prepack: copied client dist into server package');

