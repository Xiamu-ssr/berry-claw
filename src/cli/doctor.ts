/**
 * `berry-claw doctor` — environment self-check.
 *
 * Reports capability readiness in product language, not implementation names.
 * Returns true when every required capability is OK.
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { checkBrowserRuntime } from './browser-runtime.js';

const APP_DIR = process.env.BERRY_CLAW_HOME ?? join(homedir(), '.berry-claw');

type CheckResult = { name: string; ok: boolean; detail?: string; optional?: boolean };

export async function runDoctor(): Promise<boolean> {
  console.log('🍓 berry-claw doctor\n');

  const results: CheckResult[] = [];

  // Node
  const nodeMajor = parseInt(process.versions.node.split('.')[0] ?? '0', 10);
  results.push({
    name: 'Node runtime',
    ok: nodeMajor >= 20,
    detail: `node ${process.version} (requires >=20)`,
  });

  // Data dir
  results.push({
    name: 'Data directory',
    ok: existsSync(APP_DIR),
    detail: APP_DIR,
  });

  // Config file
  const configPath = join(APP_DIR, 'config.json');
  results.push({
    name: 'Config file',
    ok: existsSync(configPath),
    detail: configPath,
  });

  // Browser runtime (optional)
  const browser = await checkBrowserRuntime();
  results.push({
    name: 'Browser runtime',
    ok: browser.ready,
    detail: browser.ready ? 'ready' : browser.reason,
    optional: true,
  });

  // Render
  let allOk = true;
  for (const r of results) {
    const mark = r.ok ? '✓' : (r.optional ? '!' : '✗');
    const suffix = r.optional && !r.ok ? ' (optional)' : '';
    const detail = r.detail ? ` — ${r.detail}` : '';
    console.log(`${mark} ${r.name}${suffix}${detail}`);
    if (!r.ok && !r.optional) allOk = false;
  }

  console.log('');
  console.log(allOk ? 'All required capabilities are ready.' : 'Some required capabilities are missing — run `berry-claw setup`.');
  return allOk;
}
