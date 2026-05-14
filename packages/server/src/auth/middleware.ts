import type { IncomingMessage } from 'node:http';
import type { NextFunction, Request, Response } from 'express';
import type { AuthStore } from './challenge.js';

export interface AuthMiddlewareOptions {
  allowAnonymous: boolean;
  auth: AuthStore;
}

const AUTH_WHITELIST = new Set([
  '/api/auth/challenge',
  '/api/auth/verify',
]);

export function requireAuth(opts: AuthMiddlewareOptions) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (opts.allowAnonymous) return next();
    if (AUTH_WHITELIST.has(req.path)) return next();
    const token = bearerToken(req.header('authorization'));
    if (!opts.auth.isTokenValid(token)) {
      res.status(401).json({ error: 'unauthorized' });
      return;
    }
    next();
  };
}

export function assertWsAuth(req: IncomingMessage, opts: AuthMiddlewareOptions): boolean {
  if (opts.allowAnonymous) return true;
  const url = new URL(req.url ?? '/ws', 'ws://berry-claw');
  return opts.auth.isTokenValid(url.searchParams.get('token'));
}

function bearerToken(header: string | undefined): string | null {
  if (!header) return null;
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  return match?.[1] ?? null;
}
