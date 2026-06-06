import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * ClawHome — the on-disk layout of `~/.berry-claw`.
 *
 * The console keeps almost nothing locally: just its config + auth keypair.
 * Agents, agent workspaces, MCP config, skills and prompt packs all live on
 * a8s (or on the local Hand connector), never here.
 */
export class ClawHome {
  readonly configPath: string;

  constructor(readonly appDir: string) {
    this.configPath = join(appDir, 'config.json');
  }

  ensureRoot(): void {
    ensureDir(this.appDir);
  }
}

export function ensureDir(dir: string): void {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}
