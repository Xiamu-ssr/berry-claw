import type { Express } from 'express';
import type { AuthStore } from '../auth/challenge.js';
import { loadIdentity, type KeyStore } from '../auth/keystore.js';
import {
  zAuthChallengeRequest,
  zAuthVerifyRequest,
} from '@berry-agent/claw-contracts';

export function registerAuthRoutes(app: Express, authStore: AuthStore, keyStore: KeyStore): void {
  app.post('/api/auth/challenge', (req, res) => {
    try {
      zAuthChallengeRequest.parse(req.body ?? {});
      res.json(authStore.issueChallenge());
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  app.post('/api/auth/verify', (req, res) => {
    try {
      const body = zAuthVerifyRequest.parse(req.body ?? {});
      const token = authStore.verify(body.nonce, body.signature);
      res.json({ sessionToken: token.token, expiresAt: token.expiresAt });
    } catch (err: any) {
      res.status(401).json({ error: err.message });
    }
  });

  app.get('/api/auth/instance', (_req, res) => {
    res.json(loadIdentity(keyStore));
  });
}
