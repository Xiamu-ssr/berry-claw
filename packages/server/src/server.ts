/**
 * Berry-Claw server — a thin shell.
 *
 * berry-claw is an operating console for agents that live on a8s. The agent
 * engine, sessions, skills, models, observe — all of that is a8s's now and
 * the front-end talks to a8s directly via @berry-agent/client (see AGENTS.md).
 *
 * So this server does only what is genuinely local to the product:
 *   - browser auth (challenge/verify against the keystore identity)
 *   - serving the built SPA
 *
 * There is deliberately no agent/session/model/skill API here. If a future
 * non-agent business feature needs a backend, it gets added here as its own
 * thin route — never an agent engine.
 */
import express from 'express';
import cors from 'cors';
import { createServer } from 'node:http';
import { resolve, join } from 'node:path';
import { existsSync } from 'node:fs';
import { ClawConfig } from './engine/claw-config.js';
import { createKeyStore, generateIdentity, hasIdentity } from './auth/keystore.js';
import { AuthStore } from './auth/challenge.js';
import { registerAuthRoutes } from './routes/auth-routes.js';

export interface StartServerOptions {
  appDir?: string;
}

export async function startServer(port: number, options: StartServerOptions = {}) {
  const config = new ClawConfig({ appDir: options.appDir });
  const keyStore = createKeyStore(config.appDir);
  if (!hasIdentity(keyStore)) {
    generateIdentity(keyStore);
  }
  const authStore = new AuthStore(keyStore, config.auth);
  if (config.auth.allowAnonymous) {
    console.warn('⚠ AUTH DISABLED: config.auth.allowAnonymous=true');
  }

  const app = express();
  app.use(cors());
  app.use(express.json());

  // Browser auth (challenge/verify). Everything agent-related is on a8s; the
  // front-end reaches a8s directly with its product token.
  registerAuthRoutes(app, authStore, keyStore);

  // Static frontend (production build).
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

  const server = createServer(app);
  server.listen(port, () => {
    console.log(`🐾 Berry-Claw console at http://localhost:${port}`);
    console.log('   Agents/sessions/skills live on a8s; the UI connects there directly.');
  });

  return { server, config };
}
