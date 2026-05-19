#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const desktopDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const root = resolve(desktopDir, '../..');
const pkg = JSON.parse(readFileSync(resolve(desktopDir, 'package.json'), 'utf-8'));
const passthroughArgs = process.argv.slice(2);

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: root,
    stdio: 'inherit',
    shell: false,
    ...options,
  });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

function appBundlePath() {
  const candidates = [
    resolve(desktopDir, 'dist/mac-arm64/Berry Claw.app'),
    resolve(desktopDir, 'dist/mac/Berry Claw.app'),
  ];
  return candidates.find((candidate) => existsSync(candidate));
}

function createDmg() {
  if (process.platform !== 'darwin') return;
  const app = appBundlePath();
  if (!app) {
    throw new Error('Cannot create DMG: Berry Claw.app was not produced by electron-builder.');
  }
  const arch = process.arch === 'arm64' ? 'arm64' : 'x64';
  const distDir = resolve(desktopDir, 'dist');
  mkdirSync(distDir, { recursive: true });
  const dmgPath = resolve(distDir, `Berry Claw-${pkg.version}-${arch}.dmg`);
  rmSync(dmgPath, { force: true });
  run('hdiutil', [
    'create',
    '-volname',
    'Berry Claw',
    '-srcfolder',
    app,
    '-ov',
    '-format',
    'UDZO',
    dmgPath,
  ], { cwd: desktopDir });
}

run('npm', ['-w', '@berry-agent/claw-contracts', 'run', 'build']);
run('npm', ['-w', '@berry-agent/claw-client', 'run', 'build']);

if (passthroughArgs.length > 0) {
  run('electron-builder', passthroughArgs, { cwd: desktopDir });
} else if (process.platform === 'darwin') {
  run('electron-builder', ['--mac', 'zip'], { cwd: desktopDir });
  createDmg();
} else {
  run('electron-builder', [], { cwd: desktopDir });
}
