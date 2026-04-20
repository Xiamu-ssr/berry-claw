/**
 * `berry-claw setup` — first-time product setup.
 *
 * Responsibilities (product view, not dependency view):
 *   1. Create ~/.berry-claw data directory
 *   2. Seed a default MEMORY.md placeholder
 *   3. Offer to install browser runtime if missing
 *   4. Print next steps
 *
 * This command must NOT expose internal package names (playwright-core, npm
 * install, etc.) to the end user. Those are implementation details.
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { checkBrowserRuntime, installBrowserRuntime } from './browser-runtime.js';
import { prompt, closePrompt } from './prompt.js';

const APP_DIR = process.env.BERRY_CLAW_HOME ?? join(homedir(), '.berry-claw');

export async function runSetup(): Promise<void> {
  console.log('🍓 berry-claw setup\n');

  // 1. Data directory
  const agentsDir = join(APP_DIR, 'agents');
  if (!existsSync(APP_DIR)) mkdirSync(APP_DIR, { recursive: true });
  if (!existsSync(agentsDir)) mkdirSync(agentsDir, { recursive: true });
  console.log(`✓ Data directory ready: ${APP_DIR}`);

  // 2. Seed config stub if missing (empty, user fills via Web UI / API)
  const configPath = join(APP_DIR, 'config.json');
  if (!existsSync(configPath)) {
    writeFileSync(
      configPath,
      JSON.stringify(
        {
          providers: {},
          agents: {},
          defaultModel: '',
          defaultAgent: '',
        },
        null,
        2,
      ) + '\n',
    );
    console.log('✓ Created default config.json');
  } else {
    console.log('✓ Config already present, left untouched');
  }

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
