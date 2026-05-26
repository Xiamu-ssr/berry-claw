import type { Express } from 'express';
import type { AgentManager } from '../engine/agent-manager.js';
import {
  ApprovalBroker,
  SAFETY_LEVELS,
  readProjectSafety,
  resolveClassifierConfig,
  writeProjectSafety,
  type SafetyLevel,
} from '@berry-agent/safe';
import {
  zSafetyAskAnswerRequest,
  zSafetyClassifierPatchRequest,
  zSafetyGlobalPatchRequest,
  zSafetyProjectPatchRequest,
} from '@berry-agent/claw-contracts';

export type WsBroadcast = (type: string, payload: Record<string, unknown>) => void;

export function registerSafetyRoutes(app: Express, manager: AgentManager, broadcast: WsBroadcast): void {
  /** Snapshot all three safety layers. */
  app.get('/api/safety', (_req, res) => {
    const config = manager.config.get();
    const registry = manager.config.toModelsRegistry();
    const resolvedClassifier = resolveClassifierConfig({
      safe: { classifier: config.safetyClassifier },
      registry,
    });
    const configuredClassifierModel = config.safetyClassifier?.model?.trim() || null;
    const displayClassifier = resolveClassifierConfig({
      safe: { classifier: { ...config.safetyClassifier, enabled: undefined } },
      registry,
    });
    const classifierEnabled = config.safetyClassifier?.enabled !== false && resolvedClassifier !== null;
    const agents = manager.config.listAgents().map(({ id, entry }) => {
      const projectLevel = entry.project ? (readProjectSafety(entry.project)?.level ?? null) : null;
      return {
        id,
        agentLevel: entry.safetyLevel ?? null,
        projectLevel,
        projectRoot: entry.project ?? null,
        effective: manager.resolveSafetyFor(id),
      };
    });
    res.json({
      levels: SAFETY_LEVELS,
      globalLevel: config.safetyLevel ?? null,
      classifier: {
        enabled: classifierEnabled,
        model: configuredClassifierModel ?? displayClassifier?.modelRef ?? null,
        configuredModel: configuredClassifierModel,
        effectiveModel: classifierEnabled ? resolvedClassifier?.modelRef ?? null : null,
        skipStage2: config.safetyClassifier?.skipStage2 ?? false,
      },
      agents,
    });
  });

  /** Set (or clear) the app-wide safety level. */
  app.patch('/api/safety/global', async (req, res) => {
    const parsed = zSafetyGlobalPatchRequest.safeParse(req.body ?? {});
    if (!parsed.success) return res.status(400).json({ error: parsed.error.message });
    const { level } = parsed.data;
    manager.config.update({ safetyLevel: level ?? undefined });
    await manager.rebuildLiveAgents();
    res.json({ ok: true, globalLevel: level ?? null });
  });

  /** Configure the app-wide LLM classifier used by safety level `auto`. */
  app.patch('/api/safety/classifier', async (req, res) => {
    const parsed = zSafetyClassifierPatchRequest.safeParse(req.body ?? {});
    if (!parsed.success) return res.status(400).json({ error: parsed.error.message });
    const { model, enabled, skipStage2 } = parsed.data;
    const current = manager.config.get().safetyClassifier ?? {};
    const next = {
      ...current,
      ...(model !== undefined ? (model ? { model: model.trim() } : { model: undefined }) : {}),
      ...(enabled !== undefined ? { enabled } : {}),
      ...(skipStage2 !== undefined ? { skipStage2 } : {}),
    };
    manager.config.update({ safetyClassifier: next });
    await manager.rebuildLiveAgents();
    res.json({ ok: true, classifier: manager.config.get().safetyClassifier ?? null });
  });

  /** Set (or clear) the project-level safety file. */
  app.patch('/api/safety/project', async (req, res) => {
    const parsed = zSafetyProjectPatchRequest.safeParse(req.body ?? {});
    if (!parsed.success) return res.status(400).json({ error: parsed.error.message });
    const { projectRoot, level } = parsed.data;
    try {
      writeProjectSafety(projectRoot, (level as SafetyLevel | null) ?? null);
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
    await manager.rebuildLiveAgents((_id, entry) => entry.project === projectRoot);
    res.json({ ok: true, projectRoot, level: level ?? null });
  });

  const approvalBroker = new ApprovalBroker({
    onAsk: (approval) => {
      void manager.recordApprovalRequest(approval).catch((err) => {
        console.error('[safety] failed to record approval request:', err);
      });
      broadcast('safety_ask', { id: approval.id, question: approval.question });
    },
    onResolve: (approval, answer) => {
      void manager.recordApprovalDecision(approval, answer).catch((err) => {
        console.error('[safety] failed to record approval decision:', err);
      });
      broadcast('safety_ask_resolved', { id: approval.id, approved: answer.approved, note: answer.note });
    },
  });
  manager.setAskBridge(approvalBroker.askBridge);

  /** Human answers a pending question. */
  app.post('/api/safety/ask/:id', (req, res) => {
    const parsed = zSafetyAskAnswerRequest.safeParse(req.body ?? {});
    if (!parsed.success) return res.status(400).json({ error: parsed.error.message });
    const approval = approvalBroker.answer(req.params.id, parsed.data);
    if (!approval) return res.status(404).json({ error: 'unknown or already-resolved question id' });
    res.json({ ok: true });
  });

  /** Inspect outstanding approval questions (diagnostic / reconnect). */
  app.get('/api/safety/ask', (_req, res) => {
    res.json({ pending: approvalBroker.listPending() });
  });
}
