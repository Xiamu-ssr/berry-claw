#!/usr/bin/env node
/**
 * berry-claw CLI — product entry point
 *
 * Commands:
 *   berry-claw                 Start the server + Web UI (default)
 *   berry-claw start           Same as above (explicit)
 *   berry-claw setup           First-time setup wizard (config, deps, browser)
 *   berry-claw doctor          Environment self-check (deps, runtimes, config)
 *   berry-claw install browser Install browser runtime (Playwright Chromium)
 *   berry-claw version         Print version
 *   berry-claw help            Show this help
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const pkgPath = resolve(__dirname, '..', 'package.json');
const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8')) as { name: string; version: string };

type Command = 'start' | 'setup' | 'doctor' | 'install' | 'status' | 'restart' | 'config' | 'version' | 'help';

function parseArgs(argv: string[]): { cmd: Command; rest: string[] } {
  const [first, ...rest] = argv;
  if (!first) return { cmd: 'start', rest: [] };

  switch (first) {
    case 'start': return { cmd: 'start', rest };
    case 'setup': return { cmd: 'setup', rest };
    case 'doctor': return { cmd: 'doctor', rest };
    case 'install': return { cmd: 'install', rest };
    case 'status': return { cmd: 'status', rest };
    case 'restart': return { cmd: 'restart', rest };
    case 'config': return { cmd: 'config', rest };
    case 'version':
    case '--version':
    case '-v':
      return { cmd: 'version', rest };
    case 'help':
    case '--help':
    case '-h':
      return { cmd: 'help', rest };
    default:
      // Unknown: show help, non-zero exit
      return { cmd: 'help', rest: [first, ...rest] };
  }
}

function printHelp(): void {
  console.log(`berry-claw ${pkg.version}

Usage:
  berry-claw [command] [options]

Commands:
  start                     Start server + Web UI (default)
  setup                     First-time setup wizard
  doctor                    Environment self-check
  install browser           Install browser runtime (Playwright Chromium)
  status                    Show server health summary
  restart                   Request graceful server restart
  config get <scope> [key]  Read configuration (provider|model|tier|agent)
  config set <scope> <key> <value>  Write configuration
  version                   Print version
  help                      Show this help

Environment:
  PORT                      HTTP port (default: 3210)
  BERRY_CLAW_HOME           Data directory (default: ~/.berry-claw)
`);
}

async function main(): Promise<void> {
  const { cmd, rest } = parseArgs(process.argv.slice(2));

  switch (cmd) {
    case 'version':
      console.log(pkg.version);
      return;

    case 'help':
      printHelp();
      // Exit non-zero only if the caller hit an unknown command
      if (rest.length > 0 && !['help', '--help', '-h'].includes(rest[0]!)) {
        process.exitCode = 1;
      }
      return;

    case 'start': {
      const { runStart } = await import('./cli/start.js');
      await runStart();
      return;
    }

    case 'setup': {
      const { runSetup } = await import('./cli/setup.js');
      await runSetup();
      return;
    }

    case 'doctor': {
      const { runDoctor } = await import('./cli/doctor.js');
      const ok = await runDoctor();
      process.exitCode = ok ? 0 : 1;
      return;
    }

    case 'install': {
      const { runInstall } = await import('./cli/install.js');
      const ok = await runInstall(rest);
      process.exitCode = ok ? 0 : 1;
      return;
    }

    case 'status': {
      const { runStatus } = await import('./cli/status.js');
      await runStatus();
      return;
    }

    case 'restart': {
      const { runRestart } = await import('./cli/restart.js');
      await runRestart(rest);
      return;
    }

    case 'config': {
      const { runConfig } = await import('./cli/config-cmd.js');
      await runConfig(rest);
      return;
    }
  }
}

main().catch((err) => {
  console.error('✗ berry-claw failed:', err?.message ?? err);
  process.exit(1);
});
