// ============================================================
// berry-claw — a8s client (the BFF's only door to the control plane)
// ============================================================
// berry-claw is a thin BFF. Agent engines run on a8s/workers, never in
// this process. Every call into the control plane goes through this one
// typed A8sClient — there is no in-process ControlPlane and no special
// "if a8s is local, shortcut" path: even a co-located a8s is reached over
// HTTP+token, so the relationship (product → infrastructure) is uniform
// whether a8s is on localhost or across the network.
//
// The admin/bootstrap token lives here, server-side, and is never sent to
// the browser. A future multi-tenant BFF can swap the static token for a
// per-request token provider — A8sClient already accepts a `() => token`
// function for exactly that.

import { A8sClient } from '@berry-agent/client';
import type { AppConfig } from './config-schema.js';

export interface ResolveA8sOptions {
  /** Falls back to env BERRY_A8S_URL, then http://localhost:8080. */
  url?: string;
  /** Falls back to env BERRY_A8S_ADMIN_TOKEN. */
  token?: string;
}

/**
 * Resolve the a8s connection (config → env → default) and build the
 * client. Returns null only when no token is available AND a8s isn't
 * configured — i.e. the legacy in-process path should still be used
 * during migration. Once the BFF cut-over completes this should throw
 * instead of returning null.
 */
export function resolveA8sClient(config: AppConfig, overrides: ResolveA8sOptions = {}): A8sClient | null {
  const url = overrides.url
    ?? config.a8s?.url
    ?? process.env.BERRY_A8S_URL
    ?? 'http://localhost:8080';
  const token = overrides.token
    ?? config.a8s?.token
    ?? process.env.BERRY_A8S_ADMIN_TOKEN;

  // No token + no explicit a8s config → not wired for the BFF path yet.
  if (!token && !config.a8s) return null;

  return new A8sClient({ a8sUrl: url, token: token ?? '' });
}
