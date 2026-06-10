/**
 * a8sConnection — resolve the control-plane connection for an instance.
 *
 * berry-claw talks to a8s DIRECTLY. An instance already carries everything
 * needed: `apiBase` is the a8s URL and `token` is the bearer token an operator
 * handed the user (a `bp_…` product root token or a `bs_…` subject token). So
 * "resolving the connection" is just reading those two fields — there is no
 * console/BFF, no challenge/verify handshake, no token exchange.
 *
 * This module stays as a thin seam (rather than inlining `instance.token` at
 * call sites) so the a8s client factory keeps one place to read the
 * connection from, and a future token-refresh story has a home.
 */
import type { Instance } from './types';
import type { A8sConnectionInfo } from '@berry-agent/claw-contracts/auth';

/** Resolve the a8s connection for an instance (URL + bearer token). */
export async function getA8sConnection(instance: Instance): Promise<A8sConnectionInfo> {
  return { url: instance.apiBase, token: instance.token };
}

/** No-op kept for call-site compatibility (there is no cached connection). */
export function clearA8sConnection(_instanceId: string): void {
  /* direct-connect: nothing cached to clear */
}

/** Test hook — no-op (no caches under direct-connect). */
export function __resetA8sConnectionForTests(): void {
  /* nothing to reset */
}
