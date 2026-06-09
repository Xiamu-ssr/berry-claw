import type { Express, Request } from 'express';
import type { AuthStore } from '../auth/challenge.js';
import { loadIdentity, type KeyStore } from '../auth/keystore.js';
import {
  zAuthChallengeRequest,
  zAuthVerifyRequest,
} from '@berry-agent/claw-contracts/auth';

/** Pull the bearer token off an Authorization header (Bearer scheme only). */
function bearerToken(req: Request): string | undefined {
  const header = req.headers['authorization'];
  if (typeof header !== 'string') return undefined;
  const [scheme, value] = header.split(' ');
  return scheme === 'Bearer' && value ? value : undefined;
}

export interface AuthRoutesDeps {
  /**
   * Resolve the a8s connection the console hands to a verified browser. The
   * console holds the product token server-side; this releases {url, token}
   * only to a session that passed challenge/verify.
   */
  getA8sConnection: () => { url: string; token?: string };
}

export function registerAuthRoutes(
  app: Express,
  authStore: AuthStore,
  keyStore: KeyStore,
  deps: AuthRoutesDeps,
): void {
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

  // The auth bridge: a verified browser asks the console where a8s is and for
  // the token to reach it. We never expose the admin/product token to an
  // unauthenticated caller, and the browser never reads it from a file.
  app.get('/api/auth/a8s', (req, res) => {
    if (!authStore.isTokenValid(bearerToken(req))) {
      res.status(401).json({ error: 'invalid or missing session token' });
      return;
    }
    const conn = deps.getA8sConnection();
    if (!conn.token) {
      res.status(503).json({
        error: 'a8s token not configured on the console (set a8s.token or BERRY_A8S_ADMIN_TOKEN)',
      });
      return;
    }
    res.json({ url: conn.url, token: conn.token });
  });
}
