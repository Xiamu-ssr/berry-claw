import App from '../App';
import { useEffect, useRef, useState } from 'react';
import {
  addInstance,
  normaliseEndpoint,
  setActive,
  useActiveInstanceId,
  useInstances,
  wsBaseFromApiBase,
  type Instance,
} from '../connection';
import { DEFAULT_DEV_API_BASE } from '../connection/constants';
import { ConnectSetupScreen } from './ConnectSetupScreen';
import { AppForInstance } from './AppForInstance';

/**
 * Top-level decision point between "set up a connection" and "run the app".
 *
 * When the user has zero instances, or an active id that no longer resolves
 * to a known instance, we render the full-screen setup flow. Once they add
 * one it auto-activates and we remount the real app tree keyed by the active
 * instance id — that forces every child `useState` / WebSocket back to a
 * clean slate, which is exactly what you want when switching backends.
 *
 * In dev mode, `VITE_DEV_A8S_TOKEN` (+ optional `VITE_API_BASE`) can seed the
 * first instance so local dev skips the paste-token screen. Normal
 * user-created instances are read from local storage and restored before the
 * setup screen is shown.
 */
export function ConnectionGate() {
  const instances = useInstances();
  const activeId = useActiveInstanceId();
  const hasActive = !!activeId && instances.some((i) => i.id === activeId);
  const hasKnownInstance = instances.length > 0;
  const [devState, setDevState] = useState<'idle' | 'connecting' | 'failed'>('idle');
  const devBootStarted = useRef(false);

  useEffect(() => {
    if (hasActive) return;
    if (instances[0]) {
      setActive(instances[0].id);
    }
  }, [activeId, hasActive, instances]);

  useEffect(() => {
    if (hasActive || hasKnownInstance || devBootStarted.current || !import.meta.env.DEV) {
      return;
    }

    const devToken = (import.meta.env.VITE_DEV_A8S_TOKEN as string | undefined)?.trim();
    if (!devToken) return;

    devBootStarted.current = true;
    setDevState('connecting');

    (async () => {
      try {
        const apiBase = normaliseEndpoint(
          ((import.meta.env.VITE_API_BASE as string | undefined)?.trim() || DEFAULT_DEV_API_BASE),
        );
        // Prove the token reaches a8s before persisting.
        const res = await fetch(`${apiBase}/v1/agents`, {
          headers: { authorization: `Bearer ${devToken}` },
        });
        if (!res.ok) throw new Error(`a8s returned ${res.status}`);
        const candidate: Instance = {
          id: `dev-${new URL(apiBase).host}`,
          name: new URL(apiBase).hostname || 'local-dev',
          apiBase,
          wsBase: wsBaseFromApiBase(apiBase),
          token: devToken,
          addedAt: Date.now(),
        };
        addInstance(candidate);
        setActive(candidate.id);
      } catch (err) {
        console.warn('[connection] dev auto-connect failed:', err);
        setDevState('failed');
      }
    })();
  }, [hasActive, hasKnownInstance]);

  if (!hasActive) {
    if (hasKnownInstance) {
      return (
        <div className="fixed inset-0 grid place-items-center bg-gray-950 text-gray-300">
          <div className="text-sm">Restoring saved a8s connection...</div>
        </div>
      );
    }
    if (devState === 'connecting') {
      return (
        <div className="fixed inset-0 grid place-items-center bg-gray-950 text-gray-300">
          <div className="text-sm">Connecting to local a8s...</div>
        </div>
      );
    }
    return <ConnectSetupScreen />;
  }
  return <AppForInstance key={activeId} instanceId={activeId!} />;
}

// Keep the direct App export reachable for anyone who imports this module
// for testing purposes — the gate itself always goes through the two
// dedicated surfaces above.
export { App };

