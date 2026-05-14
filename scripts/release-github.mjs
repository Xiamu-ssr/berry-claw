#!/usr/bin/env node
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const root = resolve(import.meta.dirname, '..');
const serverPkg = JSON.parse(readFileSync(resolve(root, 'packages/server/package.json'), 'utf-8'));
const version = process.env.RELEASE_VERSION ?? serverPkg.version;
const tag = process.env.RELEASE_TAG ?? `v${version}`;

function run(cmd, args, options = {}) {
  const result = spawnSync(cmd, args, {
    cwd: root,
    stdio: 'inherit',
    shell: false,
    ...options,
  });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

function collectFiles(dir, matches, out = []) {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    const s = statSync(full);
    if (s.isDirectory()) {
      collectFiles(full, matches, out);
    } else if (matches.some((re) => re.test(full))) {
      out.push(full);
    }
  }
  return out;
}

run('gh', ['auth', 'status']);
run('git', ['tag', '-f', tag]);
run('git', ['push', 'origin', tag, '--force']);

const artifacts = [
  ...collectFiles(resolve(root, 'packages/desktop/dist'), [
    /\.(dmg|zip|exe|AppImage|deb|rpm)$/i,
  ]),
  ...collectFiles(resolve(root, 'packages/mobile/android/app/build/outputs'), [
    /\.(apk|aab)$/i,
  ]),
];

const notes = `Berry Claw ${version}

Includes:
- npm server package: @berry-agent/claw-server@${version}
- shared contracts: @berry-agent/claw-contracts@${version}
- shared React client packaged into server/web, desktop, and mobile shells
- desktop/mobile artifacts when built locally before release`;

const createArgs = [
  'release',
  'create',
  tag,
  '--repo',
  'Xiamu-ssr/berry-claw',
  '--title',
  `Berry Claw ${version}`,
  '--notes',
  notes,
  '--prerelease',
  ...artifacts,
];

run('gh', createArgs);
