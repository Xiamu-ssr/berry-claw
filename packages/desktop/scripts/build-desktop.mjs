#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const desktopDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const root = resolve(desktopDir, '../..');
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

// Build the front-end the shell loads, then let electron-builder produce the
// installers declared in electron-builder.yml. The mac target is `dmg` — a
// proper drag-to-Applications disk image with the Applications alias and
// window layout — NOT a hand-rolled hdiutil bundle (that produced a bare
// double-click-the-app image with no /Applications shortcut).
run('npm', ['-w', '@berry-agent/claw-contracts', 'run', 'build']);
run('npm', ['-w', '@berry-agent/claw-client', 'run', 'build']);

// Pass any explicit args straight through; otherwise let electron-builder pick
// targets per the current platform from electron-builder.yml.
run('electron-builder', passthroughArgs, { cwd: desktopDir });
