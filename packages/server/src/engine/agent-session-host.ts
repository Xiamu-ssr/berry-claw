import type {
  AgentSessionView,
  ManagedAgentRuntime,
  TodoItem,
} from '@berry-agent/core';
import type { AskAnswer, PendingApproval } from '@berry-agent/safe';
import type { ConfigManager } from './config-manager.js';
import type { FactBus } from '../facts/bus.js';
import { deriveSessionFact } from '../facts/derive.js';

export interface AgentSessionHostOptions {
  config: ConfigManager;
  factBus: FactBus;
  getRuntime: (agentId: string) => ManagedAgentRuntime;
}

export class AgentSessionHost {
  constructor(private readonly options: AgentSessionHostOptions) {}

  emit(view: AgentSessionView): void {
    this.options.factBus.emitSession(view.id, deriveSessionFact(view));
  }

  async emitFor(agentId: string, sessionId: string): Promise<void> {
    if (!this.options.config.getAgent(agentId)) return;
    const view = await this.options.getRuntime(agentId).loadSessionView(sessionId, {
      activate: false,
    });
    if (view) this.emit(view);
  }

  async create(agentId: string): Promise<AgentSessionView> {
    const view = await this.options.getRuntime(agentId).createSession();
    this.emit(view);
    return view;
  }

  async load(sessionId: string, agentId: string, options?: { eventLimit?: number }): Promise<AgentSessionView | null> {
    if (!this.options.config.getAgent(agentId)) return null;

    const state = await this.options.getRuntime(agentId).loadSessionView(sessionId, {
      eventLimit: options?.eventLimit,
    });
    if (state) this.emit(state);
    return state;
  }

  async list(agentId: string): Promise<AgentSessionView[]> {
    if (!this.options.config.getAgent(agentId)) return [];
    return this.options.getRuntime(agentId).listSessionViews();
  }

  async delete(sessionId: string, agentId: string): Promise<void> {
    if (!this.options.config.getAgent(agentId)) return;
    await this.options.getRuntime(agentId).deleteSession(sessionId);
    this.options.factBus.emitSession(sessionId, null);
  }

  async todos(sessionId: string, agentId: string): Promise<TodoItem[]> {
    if (!this.options.config.getAgent(agentId)) return [];
    return this.options.getRuntime(agentId).getTodos(sessionId);
  }

  async recordApprovalRequest(approval: PendingApproval): Promise<void> {
    const question = approval.question;
    const targetId = question.agentId;
    if (!targetId || !this.options.config.getAgent(targetId)) return;
    await this.options.getRuntime(targetId).appendSessionEvent(question.session.id, {
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
    await this.options.getRuntime(targetId).appendSessionEvent(question.session.id, {
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
