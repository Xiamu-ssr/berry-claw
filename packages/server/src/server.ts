/**
 * Berry-Claw server — a static shell.
 *
 * berry-claw is an operating console for agents that live on a8s. The agent
 * engine, sessions, skills, models, observe — all of that is a8s's, and the
 * front-end talks to a8s DIRECTLY via @berry-agent/client (see AGENTS.md).
 * Auth is direct too: the user pastes the a8s access token an operator gave
 * them; the browser sends it straight to a8s. There is no console-side
 * challenge/verify, no token vault, no agent/session API here.
 *
 * So this server does exactly one thing: serve the built SPA. If a future
 * non-agent business feature needs a backend, it gets added here as its own
 * thin route — never an agent engine, never a credential broker.
 */
import express from 'express';
import cors from 'cors';
import { createServer } from 'node:http';
import { resolve, join } from 'node:path';
import { existsSync } from 'node:fs';
import { ClawConfig } from './engine/claw-config.js';

export interface StartServerOptions {
  appDir?: string;
}

export async function startServer(port: number, options: StartServerOptions = {}) {
  const config = new ClawConfig({ appDir: options.appDir });

  const app = express();
  app.use(cors());
  app.use(express.json());

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
    console.log('   Agents/sessions/skills live on a8s; the UI connects there directly with your token.');
  });

  return { server, config };
}
