/**
 * SessionManager unit tests
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { SessionManager } from '../engine/session-manager.js';

describe('SessionManager', () => {
  let sm: SessionManager;

  beforeEach(() => {
    sm = new SessionManager();
  });

  it('starts with no sessions', () => {
    expect(sm.listSessions()).toHaveLength(0);
    expect(sm.currentSessionId).toBeUndefined();
  });

  it('addUserMessage creates session state', () => {
    const msg = sm.addUserMessage('ses_1', 'Hello');
    expect(msg.role).toBe('user');
    expect(msg.content).toBe('Hello');
    expect(sm.listSessions()).toHaveLength(1);
    expect(sm.getMessages('ses_1')).toHaveLength(1);
  });

  it('addAssistantMessage appends to session', () => {
    sm.addUserMessage('ses_1', 'Hello');
    const msg = sm.addAssistantMessage('ses_1', 'Hi there!', undefined, { inputTokens: 100, outputTokens: 50 });
    expect(msg.role).toBe('assistant');
    expect(msg.usage).toEqual({ inputTokens: 100, outputTokens: 50 });
    expect(sm.getMessages('ses_1')).toHaveLength(2);
  });

  it('addAssistantMessage records tool calls', () => {
    sm.addUserMessage('ses_1', 'Read a file');
    const tools = [{ name: 'read_file', input: { path: '/tmp/x' }, isError: false }];
    sm.addAssistantMessage('ses_1', 'Contents of file...', tools);
    const messages = sm.getMessages('ses_1');
    expect(messages[1]!.toolCalls).toHaveLength(1);
    expect(messages[1]!.toolCalls![0]!.name).toBe('read_file');
  });

  it('switchSession sets current and returns state', () => {
    sm.addUserMessage('ses_1', 'Hello');
    sm.addAssistantMessage('ses_1', 'Hi');

    const state = sm.switchSession('ses_1');
    expect(state).not.toBeNull();
    expect(state!.messages).toHaveLength(2);
    expect(sm.currentSessionId).toBe('ses_1');
  });

  it('switchSession to unknown creates empty state', () => {
    const state = sm.switchSession('ses_new');
    expect(state).not.toBeNull();
    expect(state!.messages).toHaveLength(0);
    expect(sm.currentSessionId).toBe('ses_new');
  });

  it('newSession clears current', () => {
    sm.addUserMessage('ses_1', 'Hello');
    sm.newSession();
    expect(sm.currentSessionId).toBeUndefined();
  });

  it('deleteSession removes session', () => {
    sm.addUserMessage('ses_1', 'Hello');
    sm.addUserMessage('ses_2', 'World');
    expect(sm.listSessions()).toHaveLength(2);

    sm.deleteSession('ses_1');
    expect(sm.listSessions()).toHaveLength(1);
    expect(sm.getMessages('ses_1')).toHaveLength(0);
  });

  it('listSessions sorted by lastActiveAt descending', async () => {
    sm.addUserMessage('ses_old', 'First');
    // Force timestamp difference
    await new Promise(r => setTimeout(r, 10));
    sm.addUserMessage('ses_new', 'Second');
    const sessions = sm.listSessions();
    expect(sessions[0]!.id).toBe('ses_new');
  });

  it('getMessages returns empty for unknown session', () => {
    expect(sm.getMessages('nonexistent')).toHaveLength(0);
  });
});
