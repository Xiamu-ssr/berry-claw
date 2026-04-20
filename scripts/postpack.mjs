#!/usr/bin/env node
/**
 * postpack — restore the dev-friendly local `file:` SDK deps after npm has
 * finished packing the tarball.
 */
import { existsSync, renameSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const PKG_PATH = resolve(ROOT, 'package.json');
const BACKUP_PATH = resolve(ROOT, 'package.json.prepack-backup');

if (!existsSync(BACKUP_PATH)) {
  console.warn('postpack: no backup to restore, skipping');
  process.exit(0);
}

renameSync(BACKUP_PATH, PKG_PATH);
console.log('postpack: restored local package.json');
