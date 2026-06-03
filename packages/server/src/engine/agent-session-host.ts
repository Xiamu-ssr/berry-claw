import type {
  AgentSessionView,
  TodoItem,
} from '@berry-agent/core';
import type { AskAnswer, PendingApproval } from '@berry-agent/safe';
import type { A8sClient } from '@berry-agent/client';
import type { ConfigManager } from './config-manager.js';
import type { FactBus } from '../facts/bus.js';
import { deriveSessionFact } from '../facts/derive.js';

export interface AgentSessionHostOptions {
  config: ConfigManager;
  factBus: FactBus;
  client: A8sClient;
}

/**
 * Session host — thin BFF over a8s. Sessions live on the worker that runs
 * the agent; this host reads/writes them through the a8s client and derives
 * the product-facing SessionFact. The wire `session` shape IS the SDK's
 * AgentSessionView (serialized verbatim, typed opaque for transport), so a
 * cast back to AgentSessionView is faithful.
 */
export class AgentSessionHost {
  constructor(private readonly options: AgentSessionHostOptions) {}

  emit(view: AgentSessionView): void {
    this.options.factBus.emitSession(view.id, deriveSessionFact(view));
  }

  async emitFor(agentId: string, sessionId: string): Promise<void> {
    if (!this.options.config.getAgent(agentId)) return;
    const { session } = await this.options.client.getSession(agentId, sessionId, { activate: false });
    if (session) this.emit(session as unknown as AgentSessionView);
  }

  async create(agentId: string): Promise<AgentSessionView> {
    const { session } = await this.options.client.createSession(agentId);
    const view = session as unknown as AgentSessionView;
    this.emit(view);
    return view;
  }

  async load(sessionId: string, agentId: string, _options?: { eventLimit?: number }): Promise<AgentSessionView | null> {
    if (!this.options.config.getAgent(agentId)) return null;
    const { session } = await this.options.client.getSession(agentId, sessionId);
    if (!session) return null;
    const view = session as unknown as AgentSessionView;
    this.emit(view);
    return view;
  }

  async list(agentId: string): Promise<AgentSessionView[]> {
    if (!this.options.config.getAgent(agentId)) return [];
    const { sessions } = await this.options.client.listSessions(agentId);
    // listSessions returns lightweight summaries; the UI's session sidebar
    // reads id/title/timestamps/status from them. Cast: the summary is a
    // subset of AgentSessionView the sidebar tolerates (no messages array).
    return sessions as unknown as AgentSessionView[];
  }

  async delete(sessionId: string, agentId: string): Promise<void> {
    if (!this.options.config.getAgent(agentId)) return;
    await this.options.client.deleteSession(agentId, sessionId);
    this.options.factBus.emitSession(sessionId, null);
  }

  async todos(sessionId: string, agentId: string): Promise<TodoItem[]> {
    if (!this.options.config.getAgent(agentId)) return [];
    const { todos } = await this.options.client.getSessionTodos(agentId, sessionId);
    return todos as TodoItem[];
  }

  async recordApprovalRequest(approval: PendingApproval): Promise<void> {
    const question = approval.question;
    const targetId = question.agentId;
    if (!targetId || !this.options.config.getAgent(targetId)) return;
    await this.options.client.appendSessionEvent(targetId, question.session.id, {
      type: 'approval_request',
      approvalId: approval.id,
      agentId: targetId,
      toolName: question.toolName,
      input: question.input,
      callIndex: question.callIndex,
      reason: question.reason,
      cwd: question.session.cwd,
      model: question.session.model,
      turnId: question.session.turnId,
    });
    await this.emitFor(targetId, question.session.id);
  }

  async recordApprovalDecision(approval: PendingApproval, answer: AskAnswer): Promise<void> {
    const question = approval.question;
    const targetId = question.agentId;
    if (!targetId || !this.options.config.getAgent(targetId)) return;
    await this.options.client.appendSessionEvent(targetId, question.session.id, {
      type: 'approval_decision',
      approvalId: approval.id,
      agentId: targetId,
      toolName: question.toolName,
      approved: answer.approved,
      note: answer.note,
      turnId: question.session.turnId,
    });
    await this.emitFor(targetId, question.session.id);
  }
}
