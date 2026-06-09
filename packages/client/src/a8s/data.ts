/**
 * a8s data-plane reads for the chat UI.
 *
 * Thin wrappers over @berry-agent/client that return exactly the shapes App.tsx
 * already consumes (session list items, rendered messages, context size, todos),
 * so the migration from the console's /api/* routes is a body swap, not a
 * rewrite of the call sites. Everything here is best-effort: a throw bubbles to
 * the caller's try/catch, which already degrades gracefully.
 */
import type { ChatMessage, TodoItem } from '@berry-agent/claw-contracts';
import { a8sClient } from './client';

export interface SessionListItem {
  id: string;
  title?: string;
  updatedAt?: number;
  messageCount?: number;
  status?: string;
}

/** List an agent's sessions (newest-active first is the server's order). */
export async function fetchSessions(agentId: string): Promise<SessionListItem[]> {
  const client = await a8sClient();
  const { sessions } = await client.listSessions(agentId);
  return sessions.map((s) => ({
    id: s.id,
    title: s.title,
    updatedAt: s.lastActiveAt ?? s.createdAt,
    messageCount: s.messageCount,
    status: s.status,
  }));
}

/** Load a session's rendered message timeline. Returns [] for a missing
 *  session rather than throwing — the UI treats it as an empty session. */
export async function fetchSessionMessages(agentId: string, sessionId: string): Promise<ChatMessage[]> {
  const client = await a8sClient();
  // activate:false — reading history must not flip the agent's active session.
  const { session } = await client.getSession(agentId, sessionId, { activate: false });
  const messages = (session as { messages?: unknown } | null)?.messages;
  return Array.isArray(messages) ? (messages as ChatMessage[]) : [];
}

/** Create a fresh session and return its id + rendered messages. */
export async function createSession(agentId: string): Promise<{ id: string; messages: ChatMessage[] }> {
  const client = await a8sClient();
  const { session } = await client.createSession(agentId);
  const view = session as { id: string; messages?: unknown };
  return { id: view.id, messages: Array.isArray(view.messages) ? (view.messages as ChatMessage[]) : [] };
}

/** Resume an existing session: activate it on the agent and return its id +
 *  rendered messages. Mirrors createSession's return shape. */
export async function resumeSession(agentId: string, sessionId: string): Promise<{ id: string; messages: ChatMessage[] }> {
  const client = await a8sClient();
  const { session } = await client.getSession(agentId, sessionId, { activate: true });
  const view = (session ?? { id: sessionId }) as { id?: string; messages?: unknown };
  return { id: view.id ?? sessionId, messages: Array.isArray(view.messages) ? (view.messages as ChatMessage[]) : [] };
}

export async function fetchContextSize(agentId: string, sessionId?: string): Promise<{ current: number; window: number } | null> {
  const client = await a8sClient();
  const res = await client.agentContextSize(agentId, sessionId);
  if (typeof res.current === 'number' && typeof res.window === 'number') {
    return { current: res.current, window: res.window };
  }
  return null;
}

export async function fetchSessionTodos(agentId: string, sessionId: string): Promise<TodoItem[]> {
  const client = await a8sClient();
  const { todos } = await client.getSessionTodos(agentId, sessionId);
  return todos;
}

/**
 * Model picker options for an agent: the canonical list from the a8s models
 * template (tier aliases + concrete model ids) with the agent's current model
 * floated to the front. The console's old /api/models returned the same shape;
 * here the template is the single source of truth.
 */
export async function fetchModelOptions(agentId?: string): Promise<{ current?: string; options: string[] }> {
  const client = await a8sClient();
  const [{ template }, current] = await Promise.all([
    client.getModelsTemplate(),
    agentId
      ? client.agentSnapshot(agentId).then((s) => s.model).catch(() => undefined)
      : Promise.resolve(undefined),
  ]);
  const tiers = template ? Object.keys(template.tiers).map((t) => `tier:${t}`) : [];
  const models = template ? Object.keys(template.models) : [];
  return { current, options: [...tiers, ...models] };
}

/** Switch an agent's primary model live (takes effect next turn). */
export async function switchModel(agentId: string, model: string): Promise<void> {
  const client = await a8sClient();
  await client.patchAgentSpec(agentId, { model });
}

/** Change an agent's reasoning effort live. */
export async function setReasoningEffort(agentId: string, reasoningEffort: string): Promise<void> {
  const client = await a8sClient();
  await client.patchAgentSpec(agentId, { reasoningEffort });
}
