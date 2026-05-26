import { existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { MCP_CONFIG_FILENAME } from '@berry-agent/mcp';

export class ClawHome {
  readonly configPath: string;

  constructor(readonly appDir: string) {
    this.configPath = join(appDir, 'config.json');
  }

  ensureRoot(): void {
    ensureDir(this.appDir);
    ensureDir(this.agentsDir());
  }

  agentsDir(): string {
    return join(this.appDir, 'agents');
  }

  agentWorkspace(agentId: string): string {
    return join(this.agentsDir(), agentId);
  }

  ensureAgentWorkspace(agentId: string): string {
    const dir = this.agentWorkspace(agentId);
    ensureDir(dir);
    return dir;
  }

  globalMCPPath(): string {
    return join(this.appDir, MCP_CONFIG_FILENAME);
  }

  projectMCPPath(projectRoot: string): string {
    return join(projectRoot, MCP_CONFIG_FILENAME);
  }

  globalSkillsDir(): string {
    const dir = join(this.appDir, 'skills');
    ensureDir(dir);
    return dir;
  }

  /**
   * Built-in skill pool shipped inside the berry-claw package itself
   * (`<pkg>/skills/builtin/`). The package-local copy is created by prepack;
   * the repo-root path is the source of truth in dev.
   */
  builtinSkillsDir(): string {
    const here = dirname(fileURLToPath(import.meta.url));
    const packageLocal = join(here, '../../skills/builtin');
    if (existsSync(packageLocal)) return packageLocal;
    return join(here, '../../../../skills/builtin');
  }

  promptPacksDir(): string {
    const dir = join(this.appDir, 'prompt-packs');
    ensureDir(dir);
    return dir;
  }
}

export function ensureDir(dir: string): void {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}
