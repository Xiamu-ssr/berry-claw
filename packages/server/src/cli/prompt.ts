/**
 * Tiny readline wrapper for CLI prompts. Zero deps.
 */
import { createInterface, Interface } from 'node:readline';

let rl: Interface | null = null;

function getRl(): Interface {
  if (!rl) {
    rl = createInterface({ input: process.stdin, output: process.stdout });
  }
  return rl;
}

export function prompt(question: string): Promise<string> {
  return new Promise((resolve) => {
    getRl().question(question, (answer) => resolve(answer));
  });
}

export function closePrompt(): void {
  if (rl) {
    rl.close();
    rl = null;
  }
}
