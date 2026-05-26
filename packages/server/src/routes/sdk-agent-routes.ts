import type { Express } from 'express';
import type { AgentManager } from '../engine/agent-manager.js';
import {
  zAgentMemoryUpdateRequest,
  zPromptBlockUpdateRequest,
} from '@berry-agent/claw-contracts';

export function registerSdkAgentRoutes(app: Express, manager: AgentManager): void {
  /** Inspect agent runtime details through AgentManager. */
  app.get('/api/agents/:id/inspect', async (req, res) => {
    try {
      const info = manager.inspectAgent(req.params.id);
      const promptBlocks = await manager.describePromptBlocks(req.params.id);
      const runtime = info.runtime
        ? {
            ...info.runtime,
            promptBlocks,
          }
        : { promptBlocks };
      res.json({ ...info, runtime });
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  /** Edit a SDK-owned prompt block through Agent APIs. */
  app.put('/api/agents/:id/prompt-blocks/:blockId', async (req, res) => {
    const parsed = zPromptBlockUpdateRequest.safeParse(req.body ?? {});
    if (!parsed.success) return res.status(400).json({ error: parsed.error.message });
    const { content } = parsed.data;

    try {
      const promptBlocks = await manager.writePromptBlock(req.params.id, req.params.blockId, content);
      res.json({ ok: true, promptBlocks });
    } catch (err: any) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(message.includes('not found') ? 404 : 400).json({ error: message });
    }
  });

  /** Read agent personal memory through the SDK. */
  app.get('/api/agents/:id/memory', async (req, res) => {
    try {
      res.json(await manager.readAgentMemory(req.params.id));
    } catch (err: any) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(message === 'agent not found' ? 404 : 500).json({ error: message });
    }
  });

  /** Overwrite agent personal memory through the SDK. Mainly for user curation. */
  app.put('/api/agents/:id/memory', async (req, res) => {
    const parsed = zAgentMemoryUpdateRequest.safeParse(req.body ?? {});
    if (!parsed.success) return res.status(400).json({ error: parsed.error.message });
    try {
      const result = await manager.writeAgentMemory(req.params.id, parsed.data.content);
      res.json({ ok: true, bytes: result.bytes, path: result.path });
    } catch (err: any) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(message === 'agent not found' ? 404 : 500).json({ error: message });
    }
  });

  /**
   * Read the shared project knowledge for an agent's project binding.
   * The SDK owns where that project knowledge is stored.
   */
  app.get('/api/agents/:id/project/knowledge', async (req, res) => {
    try {
      res.json(await manager.readAgentProjectKnowledge(req.params.id));
    } catch (err: any) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(message === 'agent not found' ? 404 : 500).json({ error: message });
    }
  });
}
