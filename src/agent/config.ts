/**
 * Berry-Claw Agent Configuration
 * This is the main agent setup — pure SDK usage, no server dependency.
 */
import { Agent, FileSessionStore } from '@berry-agent/core';
import { compositeGuard, directoryScope, denyList, createPIProbeMiddleware } from '@berry-agent/safe';

export interface BerryclawConfig {
  /** Anthropic API key */
  apiKey: string;
  /** Model to use (default: claude-sonnet-4-20250514) */
  model?: string;
  /** Working directory for file operations */
  cwd?: string;
  /** Directory for session persistence */
  sessionDir?: string;
}

export function createAgent(config: BerryclawConfig): Agent {
  const cwd = config.cwd ?? process.cwd();

  return new Agent({
    provider: {
      type: 'anthropic',
      apiKey: config.apiKey,
      model: config.model ?? 'claude-sonnet-4-20250514',
    },
    systemPrompt: `You are Berry-Claw, a helpful AI coding assistant.

You have access to tools for reading files, writing files, searching, and running commands.
Always explain what you're about to do before doing it.
When editing files, show the changes you made.
If a task is ambiguous, ask for clarification.`,
    tools: [],  // Will be populated with tools from tools/
    cwd,
    sessionStore: config.sessionDir
      ? new FileSessionStore(config.sessionDir)
      : undefined,
    toolGuard: compositeGuard(
      directoryScope(cwd),
      denyList([
        'rm -rf /',
        'rm -rf ~',
        'DROP TABLE',
        'DROP DATABASE',
        'curl | bash',
        'curl | sh',
        '--force-with-lease',
      ]),
    ),
    middleware: [
      createPIProbeMiddleware(),
    ],
  });
}
