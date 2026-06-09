/**
 * a8s client factory.
 *
 * Builds an `A8sClient` (from @berry-agent/client) bound to the active
 * berry-claw instance, so the UI drives the control plane directly — no agent
 * API on the console anymore.
 *
 * A8sClient fixes its base url at construction, so we resolve the instance's
 * a8s connection first (fetched once through the console's auth bridge, then
 * cached in RAM) and construct the client against the real url. The token
 * source stays a function so a rotated token is picked up after a
 * `clearA8sConnection` without rebuilding the client. Clients are memoised per
 * `instanceId@url`.
 */
import { A8sClient } from '@berry-agent/client';
import { getActiveInstance } from '../connection/store';
import { getA8sConnection, clearA8sConnection } from '../connection/a8sConnection';

const clients = new Map<string, A8sClient>();

/**
 * Resolve the A8sClient for the currently active instance. Throws if no
 * instance is selected; awaits the console auth bridge on first use.
 */
export async function a8sClient(): Promise<A8sClient> {
  const instance = getActiveInstance();
  if (!instance) {
    throw new Error('No active berry-claw instance. Add one in Settings → Connections.');
  }

  const conn = await getA8sConnection(instance);
  const key = `${instance.id}@${conn.url}`;
  const existing = clients.get(key);
  if (existing) return existing;

  const client = new A8sClient({
    a8sUrl: conn.url,
    token: async () => (await getA8sConnection(instance)).token,
  });
  clients.set(key, client);
  return client;
}

/** Drop cached clients + connection for an instance (auth reset / disconnect). */
export function resetA8sClient(instanceId: string): void {
  clearA8sConnection(instanceId);
  for (const key of clients.keys()) {
    if (key === instanceId || key.startsWith(`${instanceId}@`)) clients.delete(key);
  }
}
