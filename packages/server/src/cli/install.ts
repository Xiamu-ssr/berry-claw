/**
 * `berry-claw install <capability>` — install optional product capabilities.
 *
 * Current capabilities:
 *   browser   Install browser runtime (Playwright Chromium)
 */
import { installBrowserRuntime } from './browser-runtime.js';

export async function runInstall(args: string[]): Promise<boolean> {
  const target = args[0];

  if (!target) {
    console.log('Usage: berry-claw install <capability>');
    console.log('');
    console.log('Capabilities:');
    console.log('  browser   Install browser runtime (Playwright Chromium)');
    return false;
  }

  switch (target) {
    case 'browser':
      return installBrowserRuntime();
    default:
      console.error(`Unknown capability: ${target}`);
      console.error('Run `berry-claw install` for the list of available capabilities.');
      return false;
  }
}
