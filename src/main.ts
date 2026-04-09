/**
 * Berry-Claw — Entry Point
 * Simple CLI agent for SDK validation.
 */
import { createAgent } from './agent/config.js';
import { createInterface } from 'node:readline';

const apiKey = process.env.ANTHROPIC_API_KEY;
if (!apiKey) {
  console.error('❌ Set ANTHROPIC_API_KEY environment variable');
  process.exit(1);
}

const agent = createAgent({
  apiKey,
  cwd: process.cwd(),
  sessionDir: '.berry-claw/sessions',
});

console.log('🐾 Berry-Claw ready. Type your message (Ctrl+C to exit).\n');

const rl = createInterface({ input: process.stdin, output: process.stdout });
let sessionId: string | undefined;

rl.on('line', async (line) => {
  const prompt = line.trim();
  if (!prompt) return;

  try {
    const result = await agent.query(prompt, {
      resume: sessionId,
      stream: true,
      onEvent: (event) => {
        if (event.type === 'text_delta') process.stdout.write(event.text);
        if (event.type === 'tool_call') console.log(`\n🔧 ${event.name}(${JSON.stringify(event.input).slice(0, 100)})`);
        if (event.type === 'tool_result') console.log(`  → ${event.isError ? '❌' : '✅'}`);
      },
    });

    sessionId = result.sessionId;
    console.log(`\n\n[${result.usage.inputTokens}in/${result.usage.outputTokens}out, tools:${result.toolCalls}]\n`);
  } catch (err) {
    console.error(`\n❌ ${err instanceof Error ? err.message : err}\n`);
  }
});
