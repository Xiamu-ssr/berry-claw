/**
 * Browser runtime helpers for setup/doctor/install.
 *
 * "Browser runtime" in product language = the system-level browser binary
 * (Playwright-managed Chromium). We intentionally DO NOT expose the
 * underlying package name to end users.
 */
import { spawn } from 'node:child_process';

async function loadOptional(moduleName: string): Promise<unknown | null> {
  try {
    // Dynamic string prevents TS from resolving the module at build time.
    return await import(/* @vite-ignore */ moduleName);
  } catch {
    return null;
  }
}

export interface BrowserRuntimeStatus {
  ready: boolean;
  reason?: string;
}

/**
 * Detect whether a browser runtime is ready. Uses Playwright's own probe if
 * installed; otherwise reports the runtime as missing.
 */
export async function checkBrowserRuntime(): Promise<BrowserRuntimeStatus> {
  try {
    // Resolve dynamically by module name so TypeScript doesn't require the
    // peer dep at build time and so `doctor` doesn't hard-fail when it's
    // missing at runtime (e.g. minimal install).
    const mod = await loadOptional('playwright-core');
    if (!mod) {
      return { ready: false, reason: 'browser engine not installed' };
    }

    const chromium = (mod as any).chromium;
    if (!chromium || typeof chromium.executablePath !== 'function') {
      return { ready: false, reason: 'browser engine incomplete' };
    }

    const path = chromium.executablePath();
    if (!path) {
      return { ready: false, reason: 'browser binary not installed' };
    }

    // Missing binary on disk surfaces as launch failure later; skip stat()
    // here to avoid importing fs for the happy path.
    return { ready: true };
  } catch (err: any) {
    return { ready: false, reason: err?.message ?? 'unknown error' };
  }
}

/**
 * Install browser runtime via Playwright's CLI. We shell out rather than
 * touching npm directly so this stays a single capability the product owns.
 */
export async function installBrowserRuntime(): Promise<boolean> {
  console.log('→ Installing browser runtime (this downloads Chromium, ~150MB)...');
  const ok = await run('npx', ['--yes', 'playwright', 'install', 'chromium']);
  if (!ok) {
    console.error('✗ Browser runtime install failed.');
    return false;
  }
  return true;
}

function run(cmd: string, args: string[]): Promise<boolean> {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { stdio: 'inherit' });
    child.on('error', () => resolve(false));
    child.on('exit', (code) => resolve(code === 0));
  });
}
