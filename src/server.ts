/**
 * Berry-Claw Server — HTTP + WebSocket (thin shell over engine)
 */
import express from 'express';
import cors from 'cors';
import { WebSocketServer, WebSocket } from 'ws';
import { createServer } from 'node:http';
import { resolve, join } from 'node:path';
import { existsSync } from 'node:fs';
import { AgentManager } from './engine/agent-manager.js';
import { createObserveRouter } from '@berry-agent/observe';
import type { AgentEvent } from '@berry-agent/core';

export function startServer(port: number) {
  const manager = new AgentManager();
  const app = express();
  app.use(cors());
  app.use(express.json());

  // ============================
  // Config API
  // ============================

  /** Get full config */
  app.get('/api/config', (_req, res) => {
    const config = manager.config.get();
    // Mask API keys in response
    const safe = {
      ...config,
      providers: Object.fromEntries(
        Object.entries(config.providers).map(([k, v]) => [
          k,
          { ...v, apiKey: v.apiKey.slice(0, 8) + '...' },
        ]),
      ),
    };
    res.json(safe);
  });

  /** Check if configured */
  app.get('/api/config/status', (_req, res) => {
    res.json({
      configured: manager.config.isConfigured,
      defaultModel: manager.config.defaultModel,
      models: manager.config.listModels(),
    });
  });

  /** Add/update a provider */
  app.put('/api/config/providers/:name', (req, res) => {
    const { type, baseUrl, apiKey, models } = req.body;
    if (!type || !models?.length) {
      return res.status(400).json({ error: 'type and models[] required' });
    }
    // apiKey is optional for updates — keep existing if not provided
    const existing = manager.config.get().providers[req.params.name];
    const resolvedApiKey: string = apiKey || existing?.apiKey;
    if (!resolvedApiKey) {
      return res.status(400).json({ error: 'apiKey required for new providers' });
    }
    manager.config.setProvider(req.params.name, { type, baseUrl, apiKey: resolvedApiKey, models });
    // Re-init agent with new config
    try {
      manager.initAgent();
    } catch {
      // Config saved but agent init may fail if no default model yet
    }
    res.json({ ok: true, models: manager.config.listModels() });
  });

  /** Remove a provider */
  app.delete('/api/config/providers/:name', (req, res) => {
    manager.config.removeProvider(req.params.name);
    res.json({ ok: true });
  });

  /** Set default model */
  app.put('/api/config/model', (req, res) => {
    const { model } = req.body;
    if (!model) return res.status(400).json({ error: 'model required' });
    const resolved = manager.config.resolveModel(model);
    if (!resolved) return res.status(404).json({ error: `Model "${model}" not found` });
    manager.config.update({ defaultModel: model });
    // Switch live agent
    try { manager.switchModel(model); } catch { /* agent not init yet */ }
    res.json({ ok: true, model, provider: resolved.providerName });
  });

  // Legacy workspace endpoint removed — each agent has its own workspace

  /** List all available models */
  app.get('/api/models', (_req, res) => {
    res.json({
      models: manager.config.listModels(),
      current: manager.currentModel(),
    });
  });

  /** Switch model at runtime */
  app.post('/api/models/switch', (req, res) => {
    const { model } = req.body;
    if (!model) return res.status(400).json({ error: 'model required' });
    try {
      manager.switchModel(model);
      res.json({ ok: true, current: manager.currentModel() });
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  // ============================
  // Agent API
  // ============================

  /** List agents */
  app.get('/api/agents', (_req, res) => {
    const agents = manager.config.listAgents();
    res.json({ agents, activeAgent: manager.activeAgent });
  });

  /** Create/update agent */
  app.put('/api/agents/:id', (req, res) => {
    const { name, systemPrompt, model, workspace, tools, skillDirs } = req.body;
    if (!name || !model) return res.status(400).json({ error: 'name and model required' });
    manager.config.setAgent(req.params.id, { name, systemPrompt, model, workspace, tools, skillDirs });
    res.json({ ok: true });
  });

  /** Delete agent */
  app.delete('/api/agents/:id', (req, res) => {
    manager.config.removeAgent(req.params.id);
    res.json({ ok: true });
  });

  /** Switch active agent */
  app.post('/api/agents/:id/activate', (req, res) => {
    try {
      manager.switchAgent(req.params.id);
      res.json({ ok: true, activeAgent: req.params.id });
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  /** Inspect agent (system prompt, tools, skills, provider) */
  app.get('/api/agents/:id/inspect', (req, res) => {
    try {
      const info = manager.inspectAgent(req.params.id);
      res.json(info);
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  // ============================
  // Session API
  // ============================

  /** List sessions (from session manager, enriched with observe data) */
  app.get('/api/sessions', (_req, res) => {
    const sessions = manager.sessions.listSessions();
    res.json({ sessions });
  });

  /** Get session detail + messages */
  app.get('/api/sessions/:id', (req, res) => {
    const messages = manager.sessions.getMessages(req.params.id);
    const observeSummary = manager.observer.analyzer.sessionSummary(req.params.id);
    res.json({ id: req.params.id, messages, observe: observeSummary });
  });

  /** Delete session */
  app.delete('/api/sessions/:id', (req, res) => {
    manager.sessions.deleteSession(req.params.id);
    res.json({ ok: true });
  });

  // ============================
  // Observe API (from @berry-agent/observe)
  // ============================

  app.use('/api/observe', createObserveRouter(manager.observer));

  // ============================
  // Static frontend (production)
  // ============================

  const webDist = resolve(import.meta.dirname, '../web/dist');
  if (existsSync(webDist)) {
    app.use(express.static(webDist));
    app.get('/{*splat}', (_req, res) => {
      res.sendFile(join(webDist, 'index.html'));
    });
  }

  // ============================
  // HTTP + WebSocket
  // ============================

  const server = createServer(app);
  const wss = new WebSocketServer({ server, path: '/ws' });

  wss.on('connection', (ws) => {
    console.log('🔌 Client connected');

    ws.on('message', async (data) => {
      try {
        const msg = JSON.parse(data.toString());

        switch (msg.type) {
          case 'chat':
            await handleChat(ws, manager, msg.prompt, msg.sessionId);
            break;
          case 'new_session':
            manager.sessions.newSession();
            ws.send(JSON.stringify({ type: 'session_cleared' }));
            break;
          case 'resume_session': {
            const state = manager.sessions.switchSession(msg.sessionId);
            ws.send(JSON.stringify({
              type: 'session_resumed',
              sessionId: msg.sessionId,
              messages: state?.messages ?? [],
            }));
            break;
          }
          case 'switch_model':
            try {
              manager.switchModel(msg.model);
              ws.send(JSON.stringify({ type: 'model_switched', model: msg.model }));
            } catch (err: any) {
              ws.send(JSON.stringify({ type: 'error', message: err.message }));
            }
            break;
        }
      } catch (err: any) {
        ws.send(JSON.stringify({ type: 'error', message: err.message }));
      }
    });

    ws.on('close', () => console.log('🔌 Client disconnected'));
  });

  server.listen(port, () => {
    console.log(`🐾 Berry-Claw server at http://localhost:${port}`);
    console.log(`📁 Agents dir: ${join(manager.config.appDir, 'agents')}`);
    if (manager.config.isConfigured) {
      console.log(`🤖 Default model: ${manager.config.defaultModel}`);
    } else {
      console.log('⚠️  No providers configured. POST /api/config/providers/:name to add one.');
    }
  });

  return { server, manager };
}

async function handleChat(ws: WebSocket, manager: AgentManager, prompt: string, sessionId?: string) {
  // Reject chat if no agent is configured
  if (!manager.activeAgent || !manager.config.getAgent(manager.activeAgent)) {
    ws.send(JSON.stringify({ type: 'error', message: 'No agent configured. Create an agent first.' }));
    return;
  }

  ws.send(JSON.stringify({ type: 'start' }));

  try {
    const { result, assistantMessage } = await manager.chat(prompt, {
      sessionId,
      onEvent: (event: AgentEvent) => {
        switch (event.type) {
          case 'text_delta':
            ws.send(JSON.stringify({ type: 'text_delta', text: event.text }));
            break;
          case 'thinking_delta':
            ws.send(JSON.stringify({ type: 'thinking_delta', thinking: event.thinking }));
            break;
          case 'tool_call':
            ws.send(JSON.stringify({ type: 'tool_call', name: event.name, input: event.input }));
            break;
          case 'tool_result':
            ws.send(JSON.stringify({ type: 'tool_result', name: event.name, isError: event.isError }));
            break;
        }
      },
    });

    ws.send(JSON.stringify({
      type: 'done',
      sessionId: result.sessionId,
      message: assistantMessage,
      usage: result.usage,
      totalUsage: result.totalUsage,
      toolCalls: result.toolCalls,
    }));
  } catch (err: any) {
    ws.send(JSON.stringify({ type: 'error', message: err.message }));
  }
}
