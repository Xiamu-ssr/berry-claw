/**
 * Berry-Claw Server — HTTP + WebSocket (thin shell over engine)
 */
import express from 'express';
import cors from 'cors';
import { createServer } from 'node:http';
import { resolve, join } from 'node:path';
import { existsSync } from 'node:fs';
import { AgentManager } from './engine/agent-manager.js';
import { createObserveRouter } from '@berry-agent/observe';
import { createKeyStore, generateIdentity, hasIdentity } from './auth/keystore.js';
import { AuthStore } from './auth/challenge.js';
import { requireAuth } from './auth/middleware.js';
import { ensurePromptPackDirectory } from '@berry-agent/prompt-pack';
import { registerAgentRoutes } from './routes/agent-routes.js';
import { registerAuthRoutes } from './routes/auth-routes.js';
import { registerConfigRoutes } from './routes/config-routes.js';
import { registerMcpRoutes } from './routes/mcp-routes.js';
import { registerSafetyRoutes } from './routes/safety-routes.js';
import { registerSdkAgentRoutes } from './routes/sdk-agent-routes.js';
import { registerSessionRoutes } from './routes/session-routes.js';
import { registerSkillRoutes } from './routes/skill-routes.js';
import { registerSystemRoutes } from './routes/system-routes.js';
import { registerTeamRoutes } from './routes/team-routes.js';
import { attachWebSocketServer, createWsBroadcaster } from './ws/server.js';
import { installOpenRouterPricing, startSharedMcpServers } from './server-bootstrap.js';

export interface StartServerOptions {
  appDir?: string;
}

export async function startServer(port: number, options: StartServerOptions = {}) {
  const manager = new AgentManager({ appDir: options.appDir });
  ensurePromptPackDirectory(manager.config.promptPacksDir());
  const keyStore = createKeyStore(manager.config.appDir);
  if (!hasIdentity(keyStore)) {
    generateIdentity(keyStore);
  }
  const authStore = new AuthStore(keyStore, manager.config.get().auth);
  const authOptions = {
    allowAnonymous: manager.config.get().auth.allowAnonymous,
    auth: authStore,
  };
  if (authOptions.allowAnonymous) {
    console.warn('⚠ AUTH DISABLED: config.auth.allowAnonymous=true');
  }

  await installOpenRouterPricing(manager);
  await startSharedMcpServers(manager);

  const app = express();
  app.use(cors());
  app.use(express.json());

  registerAuthRoutes(app, authStore, keyStore);

  app.use('/api', requireAuth(authOptions));

  const broadcaster = createWsBroadcaster();

  registerConfigRoutes(app, manager);

  registerAgentRoutes(app, manager);

  registerSafetyRoutes(app, manager, broadcaster.broadcast);

  registerSkillRoutes(app, manager);

  registerMcpRoutes(app, manager);

  registerTeamRoutes(app, manager);

  registerSdkAgentRoutes(app, manager);

  registerSessionRoutes(app, manager);

  // ============================
  // Observe API (from @berry-agent/observe)
  // ============================

  app.use('/api/observe', createObserveRouter(manager.observer));

  registerSystemRoutes(app, manager, port);

  // ============================
  // Static frontend (production)
  // ============================

  const packagedWebDist = resolve(import.meta.dirname, '../web-dist');
  const monorepoWebDist = resolve(import.meta.dirname, '../../client/dist');
  const webDist = process.env.BERRY_CLAW_WEB_DIST
    ? resolve(process.env.BERRY_CLAW_WEB_DIST)
    : existsSync(packagedWebDist)
      ? packagedWebDist
      : monorepoWebDist;
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
  attachWebSocketServer(server, manager, authOptions, broadcaster);

  server.listen(port, () => {
    manager.port = port;
    console.log(`🐾 Berry-Claw server at http://localhost:${port}`);
    console.log(`📁 Agents dir: ${join(manager.config.appDir, 'agents')}`);
    if (manager.config.isConfigured) {
      const firstModel = manager.config.firstConfiguredModelId();
      if (firstModel) console.log(`🤖 First model: ${firstModel}`);
    } else {
      console.log('⚠️  No providers configured. Open Settings → Providers to add one.');
    }
  });

  return { server, manager };
}
