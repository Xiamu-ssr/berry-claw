/**
 * Integration test — full agent lifecycle with real API calls
 *
 * Uses zenmux proxy from .env.local
 * Run: npx vitest run src/__tests__/integration.test.ts
 */
import { config } from 'dotenv';
import { resolve, join } from 'node:path';
import { mkdtemp, writeFile, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Agent, FileSessionStore } from '@berry-agent/core';
import { createObserver } from '@berry-agent/observe';
import { compositeGuard, directoryScope } from '@berry-agent/safe';
import { createAllTools } from '@berry-agent/tools-common';
import { SYSTEM_PROMPT } from '../agent/prompt.js';
import { SessionManager } from '../engine/session-manager.js';

// Load env
config({ path: resolve(import.meta.dirname, '../../.env.local') });

const API_KEY = process.env.BERRY_TEST_API_KEY;
const BASE_URL = process.env.BERRY_TEST_BASE_URL;
const MODEL = process.env.BERRY_TEST_MODEL ?? 'anthropic/claude-haiku-4.5';

let tmpDir: string;
let sessionsDir: string;
let agent: Agent;
let observer: ReturnType<typeof createObserver>;
let sessionManager: SessionManager;

beforeAll(async () => {
  if (!API_KEY) throw new Error('BERRY_TEST_API_KEY not set in .env.local');

  tmpDir = await mkdtemp(join(tmpdir(), 'berry-claw-integration-'));
  sessionsDir = join(tmpDir, 'sessions');
  await mkdir(sessionsDir, { recursive: true });

  // Create test files
  await writeFile(join(tmpDir, 'README.md'), '# Test Project\n\nA simple test project for Berry Claw integration testing.');
  await writeFile(join(tmpDir, 'package.json'), JSON.stringify({ name: 'test-project', version: '1.0.0' }, null, 2));
  await mkdir(join(tmpDir, 'src'), { recursive: true });
  await writeFile(join(tmpDir, 'src/index.ts'), 'export const greeting = "Hello from Berry Claw";\n\nconsole.log(greeting);\n');

  observer = createObserver({ dbPath: join(tmpDir, 'observe.db') });
  sessionManager = new SessionManager();

  agent = new Agent({
    provider: {
      type: 'anthropic',
      apiKey: API_KEY,
      baseUrl: BASE_URL,
      model: MODEL,
    },
    systemPrompt: SYSTEM_PROMPT,
    tools: createAllTools(tmpDir),
    cwd: tmpDir,
    sessionStore: new FileSessionStore(sessionsDir),
    toolGuard: compositeGuard(directoryScope(tmpDir)),
    middleware: [observer.middleware],
    onEvent: observer.onEvent,
  });

  console.log(`🧪 Integration test workspace: ${tmpDir}`);
  console.log(`🤖 Model: ${MODEL}`);
});

afterAll(async () => {
  observer.close();
  await rm(tmpDir, { recursive: true, force: true });
});

describe('Berry-Claw Integration', () => {
  let sessionId: string;

  it('1. basic Q&A — agent responds', async () => {
    const events: string[] = [];
    const result = await agent.query('What is 2 + 3? Reply with just the number.', {
      stream: true,
      onEvent: (e) => events.push(e.type),
    });

    sessionId = result.sessionId;
    expect(result.text).toContain('5');
    expect(result.usage.inputTokens).toBeGreaterThan(0);
    expect(events).toContain('query_start');
    expect(events).toContain('text_delta');
    expect(events).toContain('query_end');

    // Record in session manager
    sessionManager.addUserMessage(sessionId, 'What is 2 + 3?');
    sessionManager.addAssistantMessage(sessionId, result.text, undefined, {
      inputTokens: result.usage.inputTokens,
      outputTokens: result.usage.outputTokens,
    });

    console.log(`  ✅ Session: ${sessionId}`);
  }, 30_000);

  it('2. tool calling — read files', async () => {
    const toolEvents: Array<{ name: string; input: unknown; isError?: boolean }> = [];
    const result = await agent.query(
      'List the files in the current directory, then read README.md and tell me what this project is about.',
      {
        resume: sessionId,
        stream: true,
        onEvent: (e) => {
          if (e.type === 'tool_call') toolEvents.push({ name: e.name, input: e.input });
          if (e.type === 'tool_result') {
            const last = [...toolEvents].reverse().find(t => t.name === e.name);
            if (last) last.isError = e.isError;
          }
        },
      },
    );

    expect(result.toolCalls).toBeGreaterThan(0);
    expect(toolEvents.some(t => t.name === 'list_files' || t.name === 'read_file')).toBe(true);
    expect(result.text.toLowerCase()).toContain('test');

    sessionManager.addUserMessage(sessionId, 'List files and read README.md');
    sessionManager.addAssistantMessage(sessionId, result.text, toolEvents, {
      inputTokens: result.usage.inputTokens,
      outputTokens: result.usage.outputTokens,
    });

    console.log(`  ✅ Tool calls: ${toolEvents.map(t => t.name).join(', ')}`);
  }, 30_000);

  it('3. tool calling — shell execution', async () => {
    const result = await agent.query(
      'Run "echo hello-berry" in the shell and tell me the output.',
      { resume: sessionId, stream: true },
    );

    expect(result.toolCalls).toBeGreaterThan(0);
    expect(result.text.toLowerCase()).toContain('hello-berry');

    sessionManager.addUserMessage(sessionId, 'Run echo hello-berry');
    sessionManager.addAssistantMessage(sessionId, result.text);

    console.log(`  ✅ Shell execution verified`);
  }, 30_000);

  it('4. tool calling — write file', async () => {
    const result = await agent.query(
      'Create a file called "output.txt" with the content "Berry Claw was here!" and confirm it was created.',
      { resume: sessionId, stream: true },
    );

    expect(result.toolCalls).toBeGreaterThan(0);

    // Verify file actually exists
    const readTools = createAllTools(tmpDir);
    const readFile = readTools.find(t => t.definition.name === 'read_file')!;
    const content = await readFile.execute({ path: 'output.txt' }, { cwd: tmpDir });
    expect(content.content).toContain('Berry Claw was here');

    sessionManager.addUserMessage(sessionId, 'Create output.txt');
    sessionManager.addAssistantMessage(sessionId, result.text);

    console.log(`  ✅ File written and verified`);
  }, 30_000);

  it('5. session resume — continues conversation', async () => {
    const result = await agent.query(
      'What was the first math question I asked you? Just tell me the question.',
      { resume: sessionId, stream: true },
    );

    // Should remember the earlier "2 + 3" question
    expect(result.text).toMatch(/2.*3|addition|math/i);

    console.log(`  ✅ Session memory confirmed`);
  }, 30_000);

  it('6. observe — data was recorded', async () => {
    const cost = observer.analyzer.costBreakdown(sessionId);
    expect(cost.callCount).toBeGreaterThanOrEqual(4);
    expect(cost.totalCost).toBeGreaterThanOrEqual(0);

    const tools = observer.analyzer.toolStats(sessionId);
    expect(tools.length).toBeGreaterThan(0);

    const summary = observer.analyzer.sessionSummary(sessionId);
    expect(summary).not.toBeNull();
    expect(summary!.llmCallCount).toBeGreaterThanOrEqual(4);

    console.log(`  ✅ Observe: ${cost.callCount} API calls, $${cost.totalCost.toFixed(6)} total`);
    console.log(`  ✅ Tools used: ${tools.map(t => `${t.name}(${t.callCount})`).join(', ')}`);
  });

  it('7. session manager — message history complete', () => {
    const messages = sessionManager.getMessages(sessionId);
    expect(messages.length).toBeGreaterThanOrEqual(8); // 4 user + 4 assistant minimum
    expect(messages.filter(m => m.role === 'user').length).toBeGreaterThanOrEqual(4);
    expect(messages.filter(m => m.role === 'assistant').length).toBeGreaterThanOrEqual(4);

    // Some assistant messages should have tool calls
    const withTools = messages.filter(m => m.toolCalls && m.toolCalls.length > 0);
    expect(withTools.length).toBeGreaterThan(0);

    console.log(`  ✅ ${messages.length} messages in history`);
  });

  it('8. model switch — agent survives provider switch', async () => {
    // Get current provider info
    const before = agent.currentProvider;
    expect(before.model).toBe(MODEL);

    // Switch model (same provider, different model name to verify the method works)
    // We switch to the same model since we only have one in test env
    agent.switchProvider({ model: MODEL });
    const after = agent.currentProvider;
    expect(after.model).toBe(MODEL);

    // Agent should still work after switch
    const result = await agent.query('Say "switch-ok" and nothing else.', {
      resume: sessionId,
      stream: true,
    });
    expect(result.text.toLowerCase()).toContain('switch-ok');

    console.log(`  ✅ Model switch works, agent continues`);
  }, 30_000);
});
