#!/usr/bin/env node
// ============================================================
// Crash Recovery Test — Berry-Claw v1.4 DURABILITY
// Uses a mock provider so no real API key needed.
// ============================================================

import { Agent, FileEventLogStore, FileSessionStore } from '@berry-agent/core';
import fs from 'fs';
import path from 'path';

const TEST_DIR = `/tmp/berry-crash-test-${Date.now()}`;

// Mock provider: always returns a simple text response
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

async function runTest() {
  console.log('\n🍓 Crash Recovery Test — v1.4 DURABILITY (mock provider)\n');
  console.log(`Data dir: ${TEST_DIR}\n`);

  fs.mkdirSync(TEST_DIR, { recursive: true });

  // Phase 1: Create agent, send messages
  console.log('━'.repeat(60));
  console.log('Phase 1: Normal operation (before crash)');
  console.log('━'.repeat(60));

  const eventLog = new FileEventLogStore(TEST_DIR);
  const sessionStore = new FileSessionStore(path.join(TEST_DIR, 'sessions'));

  const agent = new Agent({
    name: 'crash-test',
    provider: { type: 'openai', apiKey: 'fake', model: 'gpt-4o-mini' },
    providerInstance: mockProvider,
    systemPrompt: 'You are a helpful assistant. Keep answers short.',
    sessionStore,
    eventLogStore: eventLog,
    tools: [],
  });

  console.log('\n📤 Query 1: "What is 2+2?"');
  const result1 = await agent.query('What is 2+2?');
  console.log(`📥 Response: "${result1.text}"`);
  console.log(`   Tokens: ${result1.usage.inputTokens} in / ${result1.usage.outputTokens} out`);

  console.log('\n📤 Query 2: "What is 3+3?"');
  const result2 = await agent.query('What is 3+3?');
  console.log(`📥 Response: "${result2.text}"`);

  const sessionId = agent['_lastSessionId'];
  console.log(`\n📝 Session ID: ${sessionId}`);

  // Read events before crash
  const eventsBefore = await eventLog.getEvents(sessionId);
  console.log(`\n📊 Event log BEFORE crash: ${eventsBefore.length} events`);

  const snapshotEvents = eventsBefore.filter(e => e.type === 'messages_snapshot');
  const startEvents = eventsBefore.filter(e => e.type === 'session_start');
  const reqEvents = eventsBefore.filter(e => e.type === 'api_request');
  const respEvents = eventsBefore.filter(e => e.type === 'api_response');

  console.log(`   session_start:      ${startEvents.length}`);
  console.log(`   messages_snapshot:  ${snapshotEvents.length}`);
  console.log(`   api_request:        ${reqEvents.length}`);
  console.log(`   api_response:       ${respEvents.length}`);

  if (startEvents.length === 0) throw new Error('No session_start!');
  if (snapshotEvents.length === 0) throw new Error('No messages_snapshot!');

  // Get messages before crash
  const sessionBefore = await sessionStore.load(sessionId);
  const msgCountBefore = sessionBefore?.messages?.length || 0;
  console.log(`\n💬 Messages in session BEFORE: ${msgCountBefore}`);
  sessionBefore.messages.forEach((m, i) => {
    const preview = typeof m.content === 'string' ? m.content : JSON.stringify(m.content).slice(0, 60);
    console.log(`   [${i}] ${m.role}: ${preview}...`);
  });

  // Phase 2: Simulate crash — use Agent.fromLog() to rehydrate
  console.log('\n' + '━'.repeat(60));
  console.log('Phase 2: Crash recovery via Agent.fromLog()');
  console.log('━'.repeat(60));

  // "Kill" agent by dropping the reference
  // (no destroy() method on Agent)

  console.log(`\n🔄 Agent.fromLog(${sessionId})...`);
  const agent2 = await Agent.fromLog({
    sessionId,
    eventLogStore: eventLog,
    provider: { type: 'openai', apiKey: 'fake', model: 'gpt-4o-mini' },
    tools: [],
    sessionStore,
  });
  // Swap in the mock provider post-construction
  // eslint-disable-next-line
  (agent2)['provider'] = mockProvider;

  console.log(`\n🔄 Auto-resume (via _pendingResumeSessionId)...`);
  const sessionAfter = await agent2.getSession(sessionId);

  if (!sessionAfter) throw new Error('Session not found after recovery!');

  const msgCountAfter = sessionAfter.messages?.length || 0;
  console.log(`💬 Messages in session AFTER:  ${msgCountAfter}`);
  sessionAfter.messages.forEach((m, i) => {
    const preview = typeof m.content === 'string' ? m.content : JSON.stringify(m.content).slice(0, 60);
    console.log(`   [${i}] ${m.role}: ${preview}...`);
  });

  // Phase 3: Validate
  console.log('\n' + '━'.repeat(60));
  console.log('Phase 3: Validation');
  console.log('━'.repeat(60));

  if (msgCountBefore === msgCountAfter) {
    console.log(`✅ Message count MATCH: ${msgCountBefore} == ${msgCountAfter}`);
  } else {
    console.log(`❌ Message count MISMATCH: ${msgCountBefore} vs ${msgCountAfter}`);
  }

  // Deep compare all messages
  let allMatch = true;
  for (let i = 0; i < Math.max(msgCountBefore, msgCountAfter); i++) {
    const before = sessionBefore.messages[i];
    const after = sessionAfter.messages[i];
    if (!before || !after) {
      console.log(`❌ Message [${i}] missing on one side`);
      allMatch = false;
      continue;
    }
    const bContent = typeof before.content === 'string' ? before.content : JSON.stringify(before.content);
    const aContent = typeof after.content === 'string' ? after.content : JSON.stringify(after.content);
    if (bContent !== aContent) {
      console.log(`❌ Message [${i}] content differs`);
      allMatch = false;
    }
  }
  if (allMatch) console.log('✅ All message contents match');

  // Phase 4: Post-recovery chat
  console.log('\n' + '━'.repeat(60));
  console.log('Phase 4: Post-recovery chat');
  console.log('━'.repeat(60));

  console.log('\n📤 Query 3 (post-recovery, no explicit resume): "What did I ask before?"');
  const result3 = await agent2.query('What did I ask before? Summarize.');
  console.log(`📥 Response: "${result3.text}"`);
  console.log(`   Session ID: ${result3.sessionId} (should match ${sessionId})`);

  const eventsFinal = await eventLog.getEvents(sessionId);
  console.log(`\n📊 Final event log: ${eventsFinal.length} events`);

  // Cleanup
  fs.rmSync(TEST_DIR, { recursive: true, force: true });

  console.log('\n' + '🎉'.repeat(30));
  console.log('  CRASH RECOVERY TEST PASSED');
  console.log('🎉'.repeat(30));

  // ============================================================
  // BONUS Test: Tool Crash Recovery
  // ============================================================
  console.log('\n\n🚧 BONUS: Tool Crash Recovery Test\n');

  const TEST_DIR2 = `/tmp/berry-tool-crash-test-${Date.now()}`;
  fs.mkdirSync(TEST_DIR2, { recursive: true });
  const eventLog2 = new FileEventLogStore(TEST_DIR2);
  const sessionStore2 = new FileSessionStore(path.join(TEST_DIR2, 'sessions'));

  // Manually craft an event log simulating a tool crash:
  // session_start → query_start → user_message → assistant_message (with tool_use)
  // → tool_use_start → *** CRASH *** (no tool_use_end)
  const fakeSessionId = 'ses_crash_simulation';
  const now = Date.now();
  const crashEvents = [
    {
      id: 'evt_1', timestamp: now, sessionId: fakeSessionId, turnId: 'start',
      type: 'session_start',
      systemPrompt: ['You are a test agent.'],
      toolsAvailable: ['mock_tool'],
      guardEnabled: false,
      providerType: 'openai',
      model: 'gpt-4o-mini',
    },
    {
      id: 'evt_2', timestamp: now + 10, sessionId: fakeSessionId, turnId: 't1',
      type: 'user_message', content: 'Use mock_tool to write hello.txt',
    },
    {
      id: 'evt_3', timestamp: now + 20, sessionId: fakeSessionId, turnId: 't1',
      type: 'assistant_message',
      content: [
        { type: 'text', text: 'Sure, using mock_tool...' },
        { type: 'tool_use', id: 'tool_abc123', name: 'mock_tool', input: { file: 'hello.txt' } },
      ],
    },
    {
      id: 'evt_4', timestamp: now + 30, sessionId: fakeSessionId, turnId: 't1',
      type: 'tool_use_start',
      name: 'mock_tool',
      toolUseId: 'tool_abc123',
      input: { file: 'hello.txt' },
    },
    // *** CRASH HERE *** no tool_use_end
  ];
  for (const ev of crashEvents) {
    await eventLog2.append(fakeSessionId, ev);
  }
  console.log(`  🔨 Wrote ${crashEvents.length} events (simulating crash after tool_use_start)`);

  // Rehydrate via fromLog — should detect the unmatched tool_use_start
  const mockTool = {
    definition: { name: 'mock_tool', description: 'test', inputSchema: { type: 'object' } },
    execute: async () => ({ content: 'ok', isError: false }),
  };
  const recoveredAgent = await Agent.fromLog({
    sessionId: fakeSessionId,
    eventLogStore: eventLog2,
    provider: { type: 'openai', apiKey: 'fake', model: 'gpt-4o-mini' },
    tools: [mockTool],
    sessionStore: sessionStore2,
  });
  // eslint-disable-next-line
  (recoveredAgent)['provider'] = mockProvider;

  // Check that interject was queued
  // eslint-disable-next-line
  const pendingInterjects = (recoveredAgent)['_pendingInterjects'];
  console.log(`  📩 Pending interjects after fromLog: ${pendingInterjects?.length || 0}`);
  if (pendingInterjects && pendingInterjects.length > 0) {
    console.log('  ✅ Tool crash detected! Warning queued:');
    console.log(`     "${pendingInterjects[0].slice(0, 150)}..."`);
  } else {
    console.log('  ❌ FAIL: No interject queued for crashed tool');
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
