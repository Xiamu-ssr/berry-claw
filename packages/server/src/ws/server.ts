import type { Server } from 'node:http';
import { WebSocket, WebSocketServer } from 'ws';
import { zWsOutgoing } from '@berry-agent/claw-contracts';
import type { AgentManager } from '../engine/agent-manager.js';
import { assertWsAuth, type AuthMiddlewareOptions } from '../auth/middleware.js';
import { handleChat } from './chat-handler.js';

export interface WsBroadcaster {
  broadcast(type: string, payload: Record<string, unknown>): void;
  add(client: WebSocket): void;
  delete(client: WebSocket): void;
}

export function createWsBroadcaster(): WsBroadcaster {
  const clients = new Set<WebSocket>();

  return {
    broadcast(type, payload) {
      const msg = JSON.stringify({ type, ...payload });
      for (const client of clients) {
        if (client.readyState === WebSocket.OPEN) {
          client.send(msg);
        }
      }
    },
    add(client) {
      clients.add(client);
    },
    delete(client) {
      clients.delete(client);
    },
  };
}

export function attachWebSocketServer(
  server: Server,
  manager: AgentManager,
  authOptions: AuthMiddlewareOptions,
  broadcaster: WsBroadcaster,
): WebSocketServer {
  const wss = new WebSocketServer({ server, path: '/ws' });

  manager.factBus.on((change) => {
    broadcaster.broadcast('fact_changed', change as unknown as Record<string, unknown>);
  });

  wss.on('connection', (ws, req) => {
    if (!assertWsAuth(req, authOptions)) {
      ws.close(4001, 'unauthorized');
      return;
    }
    broadcaster.add(ws);
    console.log('Client connected');

    ws.on('message', async (data) => {
      try {
        const msg = zWsOutgoing.parse(JSON.parse(data.toString()));

        switch (msg.type) {
          case 'chat': {
            await handleChat(ws, manager, msg.prompt, msg.sessionId, msg.requestId, msg.agentId);
            break;
          }
          case 'pause_agent': {
            try {
              const reason = typeof msg.reason === 'string' ? msg.reason : 'paused by user';
              const result = manager.pauseAgent(msg.agentId, reason);
              ws.send(JSON.stringify({
                type: 'agent_paused',
                agentId: result.agentId,
                sessionId: msg.sessionId,
                paused: result.paused,
                reason,
              }));
            } catch (err: any) {
              ws.send(JSON.stringify({ type: 'error', message: err.message }));
            }
            break;
          }
          case 'interject': {
            const text = typeof msg.text === 'string' ? msg.text : '';
            const interjectAgentId = manager.activeAgent;
            if (!text.trim()) {
              ws.send(JSON.stringify({ type: 'error', agentId: interjectAgentId, message: 'interject text required' }));
              break;
            }
            try {
              manager.interjectAgent(text, interjectAgentId);
              ws.send(JSON.stringify({
                type: 'interject_acked',
                agentId: interjectAgentId,
                text,
                status: 'queued',
                delivery: 'interject',
                behavior: 'same_turn',
              }));
            } catch (err: any) {
              ws.send(JSON.stringify({ type: 'error', agentId: interjectAgentId, message: err.message }));
            }
            break;
          }
        }
      } catch (err: any) {
        ws.send(JSON.stringify({ type: 'error', message: err.message }));
      }
    });

    ws.on('close', () => {
      broadcaster.delete(ws);
      console.log('Client disconnected');
    });
  });

  return wss;
}
