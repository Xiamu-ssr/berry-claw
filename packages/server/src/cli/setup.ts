/**
 * `berry-claw setup` — first-time product setup.
 *
 * Responsibilities (product view, not dependency view):
 *   1. Create ~/.berry-claw data directory
 *   2. Seed a default product config if missing
 *   3. Offer to install browser runtime if missing
 *   4. Print next steps
 *
 * This command must NOT expose internal package names (playwright-core, npm
 * install, etc.) to the end user. Those are implementation details.
 */
import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { checkBrowserRuntime, installBrowserRuntime } from './browser-runtime.js';
import { prompt, closePrompt } from './prompt.js';
import { ClawConfig } from '../engine/claw-config.js';

const APP_DIR = process.env.BERRY_CLAW_HOME ?? join(homedir(), '.berry-claw');

export async function runSetup(): Promise<void> {
  console.log('🍓 berry-claw setup\n');

  // 1. Data directory
  if (!existsSync(APP_DIR)) mkdirSync(APP_DIR, { recursive: true });
  console.log(`✓ Data directory ready: ${APP_DIR}`);

  // 2. Seed config if missing. ClawConfig writes a default (auth + a8s)
  //    config.json on first construction. Agents/models live on a8s now,
  //    so there is nothing agent-shaped to seed here.
  const configPath = join(APP_DIR, 'config.json');
  const hadConfig = existsSync(configPath);
  // eslint-disable-next-line no-new
  new ClawConfig({ appDir: APP_DIR });
  console.log(hadConfig ? '✓ Config already present, left untouched' : '✓ Created default config.json');

  // 3. Browser runtime
  const browser = await checkBrowserRuntime();
  if (browser.ready) {
    console.log('✓ Browser runtime available');
  } else {
    console.log(`! Browser runtime not installed (${browser.reason})`);
    const answer = (await prompt('  Install browser runtime now? [Y/n] ')).trim().toLowerCase();
    if (answer === '' || answer === 'y' || answer === 'yes') {
      const installed = await installBrowserRuntime();
      console.log(installed ? '✓ Browser runtime installed' : '✗ Browser runtime install failed — run `berry-claw install browser` later');
    } else {
      console.log('  Skipped. Run `berry-claw install browser` when you need it.');
    }
  }

  closePrompt();

  console.log('\nNext:');
  console.log('  berry-claw           # start server + Web UI');
  console.log('  berry-claw doctor    # run environment self-check');
}
