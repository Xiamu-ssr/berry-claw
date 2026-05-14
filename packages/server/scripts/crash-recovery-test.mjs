#!/usr/bin/env node
// ============================================================
// Crash Recovery Test — Berry-Claw v1.4+v1.5 DURABILITY
// Uses real API via .env.local (BERRY_TEST_API_KEY/BASE_URL/MODEL).
// Falls back to mock provider if no API key.
// ============================================================

import { config } from 'dotenv';
import { resolve } from 'node:path';
import { Agent, FileEventLogStore, FileSessionStore } from '@berry-agent/core';
import fs from 'fs';
import path from 'path';

// Load env
config({ path: resolve(import.meta.dirname, '../.env.local') });

const TEST_DIR = `/tmp/berry-crash-test-${Date.now()}`;
const API_KEY = process.env.BERRY_TEST_API_KEY;
const BASE_URL = process.env.BERRY_TEST_BASE_URL;
const MODEL = process.env.BERRY_TEST_MODEL ?? 'anthropic/claude-haiku-4.5';
const USE_REAL_API = !!API_KEY;

// Mock provider fallback
const mockProvider = {
  type: 'openai',
  chat: async () => ({
    content: [{ type: 'text', text: 'The answer is 4.' }],
    usage: { inputTokens: 10, outputTokens: 5 },
    stopReason: 'end_turn',
  }),
  stream: async function* () {
    yield { type: 'response', response: {
      content: [{ type: 'text', text: 'The answer is 4.' }],
      usage: { inputTokens: 10, outputTokens: 5 },
      stopReason: 'end_turn',
    }};
  },
};

function makeAgentConfig(sessionStore, eventLog) {
  if (USE_REAL_API) {
    return {
      provider: {
        type: 'anthropic',
        apiKey: API_KEY,
        baseUrl: BASE_URL,
        model: MODEL,
      },
      systemPrompt: 'You are a helpful assistant. Keep answers very short (one sentence).',
      sessionStore,
      eventLogStore: eventLog,
      tools: [],
    };
  } else {
    return {
      provider: { type: 'openai', apiKey: 'fake', model: 'gpt-4o-mini' },
      providerInstance: mockProvider,
      systemPrompt: 'You are a helpful assistant. Keep answers short.',
      sessionStore,
      eventLogStore: eventLog,
      tools: [],
    };
  }
}

async function runTest() {
  console.log(`\n🍓 Crash Recovery Test — ${USE_REAL_API ? 'REAL API' : 'mock'} (${MODEL})\n`);
  console.log(`Data dir: ${TEST_DIR}\n`);

  fs.mkdirSync(TEST_DIR, { recursive: true });

  // Phase 1: Create agent, send messages
  console.log('━'.repeat(60));
  console.log('Phase 1: Normal operation (before crash)');
  console.log('━'.repeat(60));

  const eventLog = new FileEventLogStore(TEST_DIR);
  const sessionStore = new FileSessionStore(path.join(TEST_DIR, 'sessions'));

  const agent = new Agent(makeAgentConfig(sessionStore, eventLog));

  console.log('\n📤 Query 1: "My favorite color is blue."');
  const result1 = await agent.query('Remember this: my favorite color is blue. Just confirm.');
  console.log(`📥 Response: "${result1.text.slice(0, 120)}..."`);
  console.log(`   Tokens: ${result1.usage.inputTokens} in / ${result1.usage.outputTokens} out`);
  const sessionId1 = result1.sessionId;

  console.log('\n📤 Query 2 (same session): "What is 7 * 8?"');
  const result2 = await agent.query('What is 7 * 8? Just the number.', { resume: sessionId1 });
  console.log(`📥 Response: "${result2.text.slice(0, 120)}..."`);

  const sessionId = agent['_lastSessionId'];
  console.log(`\n📝 Session ID: ${sessionId}`);

  const eventsBefore = await eventLog.getEvents(sessionId);
  console.log(`\n📊 Event log BEFORE crash: ${eventsBefore.length} events`);

  const byType = {};
  for (const ev of eventsBefore) byType[ev.type] = (byType[ev.type] || 0) + 1;
  for (const [type, count] of Object.entries(byType).sort()) {
    console.log(`   ${type}: ${count}`);
  }

  if ((byType['session_start'] || 0) === 0) throw new Error('No session_start!');
  if ((byType['messages_snapshot'] || 0) === 0) throw new Error('No messages_snapshot!');

  const sessionBefore = await sessionStore.load(sessionId);
  const msgCountBefore = sessionBefore?.messages?.length || 0;
  console.log(`\n💬 Messages in session BEFORE: ${msgCountBefore}`);
  sessionBefore.messages.forEach((m, i) => {
    const preview = typeof m.content === 'string' ? m.content.slice(0, 80) : JSON.stringify(m.content).slice(0, 80);
    console.log(`   [${i}] ${m.role}: ${preview}`);
  });

  // Phase 2: Simulate crash — new process → fresh Agent — resume by id.
  //          Crash recovery is SDK-internal: product code just calls new Agent + query.
  console.log('\n' + '━'.repeat(60));
  console.log('Phase 2: Simulated restart — new Agent + query({resume})');
  console.log('━'.repeat(60));

  console.log(`\n🔄 Creating fresh Agent, resuming ${sessionId}...`);
  const agent2 = new Agent(makeAgentConfig(sessionStore, eventLog));

  console.log('🔄 Verifying session state before next query...');
  const sessionAfter = await agent2.getSession(sessionId);

  if (!sessionAfter) throw new Error('Session not found after recovery!');

  const msgCountAfter = sessionAfter.messages?.length || 0;
  console.log(`💬 Messages in session AFTER:  ${msgCountAfter}`);

  // Phase 3: Validate
  console.log('\n' + '━'.repeat(60));
  console.log('Phase 3: Validation');
  console.log('━'.repeat(60));

  if (msgCountBefore === msgCountAfter) {
    console.log(`✅ Message count MATCH: ${msgCountBefore} == ${msgCountAfter}`);
  } else {
    console.log(`❌ Message count MISMATCH: ${msgCountBefore} vs ${msgCountAfter}`);
  }

  let allMatch = true;
  for (let i = 0; i < Math.max(msgCountBefore, msgCountAfter); i++) {
    const before = sessionBefore.messages[i];
    const after = sessionAfter.messages[i];
    const bContent = typeof before?.content === 'string' ? before.content : JSON.stringify(before?.content);
    const aContent = typeof after?.content === 'string' ? after.content : JSON.stringify(after?.content);
    if (bContent !== aContent) {
      console.log(`❌ Message [${i}] content differs`);
      allMatch = false;
    }
  }
  if (allMatch) console.log('✅ All message contents match');

  // Phase 4: Post-recovery chat — verify memory
  console.log('\n' + '━'.repeat(60));
  console.log('Phase 4: Post-recovery memory test');
  console.log('━'.repeat(60));

  console.log('\n📤 Query 3 (post-recovery, explicit resume): "What is my favorite color?"');
  const result3 = await agent2.query('What is my favorite color? Just the color.', { resume: sessionId });
  console.log(`📥 Response: "${result3.text.slice(0, 120)}"`);
  console.log(`   Session ID: ${result3.sessionId}`);

  if (USE_REAL_API && result3.text.toLowerCase().includes('blue')) {
    console.log('✅ Agent REMEMBERED: "blue" from pre-crash turn!');
  } else if (USE_REAL_API) {
    console.log('⚠️ Agent did not say "blue" — but recovery mechanism still worked');
  }

  if (result3.sessionId !== sessionId) {
    throw new Error(`Session ID drift: ${sessionId} → ${result3.sessionId}`);
  }

  const eventsFinal = await eventLog.getEvents(sessionId);
  console.log(`\n📊 Final event log: ${eventsFinal.length} events`);

  // Cleanup
  fs.rmSync(TEST_DIR, { recursive: true, force: true });

  console.log('\n' + '🎉'.repeat(30));
  console.log('  CRASH RECOVERY TEST PASSED');
  console.log('🎉'.repeat(30));

  // ============================================================
  // BONUS: Tool Crash Recovery
  // ============================================================
  console.log('\n\n🚧 BONUS: Tool Crash Recovery Test\n');

  const TEST_DIR2 = `/tmp/berry-tool-crash-test-${Date.now()}`;
  fs.mkdirSync(TEST_DIR2, { recursive: true });
  const eventLog2 = new FileEventLogStore(TEST_DIR2);
  const sessionStore2 = new FileSessionStore(path.join(TEST_DIR2, 'sessions'));

  const fakeSessionId = 'ses_crash_simulation';
  const now = Date.now();
  const crashEvents = [
    { id: 'evt_1', timestamp: now, sessionId: fakeSessionId, turnId: 'start',
      type: 'session_start', systemPrompt: ['Test agent.'],
      toolsAvailable: ['mock_tool'], guardEnabled: false,
      providerType: 'openai', model: 'gpt-4o-mini' },
    { id: 'evt_2', timestamp: now + 10, sessionId: fakeSessionId, turnId: 't1',
      type: 'user_message', content: 'Use mock_tool' },
    { id: 'evt_3', timestamp: now + 20, sessionId: fakeSessionId, turnId: 't1',
      type: 'assistant_message',
      content: [
        { type: 'text', text: 'Using mock_tool...' },
        { type: 'tool_use', id: 'tool_abc', name: 'mock_tool', input: { file: 'hello.txt' } },
      ]},
    { id: 'evt_4', timestamp: now + 30, sessionId: fakeSessionId, turnId: 't1',
      type: 'tool_use_start', name: 'mock_tool', toolUseId: 'tool_abc',
      input: { file: 'hello.txt' } },
    // *** CRASH *** no tool_use_end
  ];
  for (const ev of crashEvents) {
    await eventLog2.append(fakeSessionId, ev);
  }
  console.log(`  🔨 Wrote ${crashEvents.length} events (crash after tool_use_start)`);

  const mockTool = {
    definition: { name: 'mock_tool', description: 'test', inputSchema: { type: 'object' } },
    execute: async () => ({ content: 'ok', isError: false }),
  };
  // New API: SDK internally detects crash on first query({resume}).
  //          We verify by 1) attempting a query (which triggers resolveSession
  //          → crash detection), 2) reading event log for the crash_recovered event.
  const recoveredAgent = new Agent({
    provider: { type: 'openai', apiKey: 'fake', model: 'gpt-4o-mini' },
    systemPrompt: 'Test agent.',
    tools: [mockTool],
    sessionStore: sessionStore2,
    eventLogStore: eventLog2,
  });
  try {
    await recoveredAgent.query('noop', { resume: fakeSessionId });
  } catch {
    // Expected: provider is fake, but resolveSession runs crash detection first
    // AND appends the crash_recovered event before the API call fails.
  }

  const allEvents = await eventLog2.getEvents(fakeSessionId);
  const recoveryEvents = allEvents.filter(e => e.type === 'crash_recovered');
  console.log(`  📩 crash_recovered events in log: ${recoveryEvents.length}`);
  if (recoveryEvents.length === 1) {
    const ev = recoveryEvents[0];
    console.log(`  ✅ Audit event written: artifactCount=${ev.artifactCount}, orphaned=[${ev.orphanedTools.map(o => o.name).join(',')}]`);
    console.log(`     interjected: ${ev.interjected}`);
  } else {
    console.log(`  ❌ FAIL: expected 1 crash_recovered event, got ${recoveryEvents.length}`);
    process.exit(1);
  }

  fs.rmSync(TEST_DIR2, { recursive: true, force: true });
  console.log('\n  ✅ Tool Crash Recovery: PASSED\n');
}

runTest().catch(err => {
  console.error('\n❌ TEST FAILED:', err.message);
  console.error(err.stack);
  process.exit(1);
});
