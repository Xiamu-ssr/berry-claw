import { useRef, useCallback, useEffect, useState } from 'react';
import type { WsIncoming, WsOutgoing } from '@berry-claw/contracts';
import { useActiveInstance } from '../connection/store';
import { clearToken, ensureToken } from '../connection';

/**
 * Client-side WebSocket with:
 *   - Active-instance-aware URL (wsBase + token from the connection store).
 *   - Reconnect with exponential backoff 1s → 30s, ±20% jitter, so a flaky
 *     server doesn't thundering-herd reconnections once recovery happens.
 *   - Close-code 4001 ("unauthorized") handling: drop the cached token and
 *     retry immediately with a fresh challenge — matches the REST 401 path
 *     so `key reset` or a server restart doesn't need a user-visible re-login.
 *
 * The hook is a single long-lived effect keyed on the active instance id —
 * when the user switches instances, `<AppForInstance key={id}/>` remounts the
 * tree and this effect runs from scratch, so explicit cleanup suffices.
 */

const MIN_BACKOFF_MS = 1_000;
const MAX_BACKOFF_MS = 30_000;

function backoffDelay(attempt: number): number {
  const base = Math.min(MIN_BACKOFF_MS * 2 ** attempt, MAX_BACKOFF_MS);
  const jitter = base * (0.8 + Math.random() * 0.4); // ±20%
  return Math.round(jitter);
}

export function useWebSocket(onMessage: (msg: WsIncoming) => void) {
  const instance = useActiveInstance();
  const wsRef = useRef<WebSocket | null>(null);
  const [connected, setConnected] = useState(false);
  const onMessageRef = useRef(onMessage);
  onMessageRef.current = onMessage;

  useEffect(() => {
    if (!instance) {
      setConnected(false);
      return;
    }

    let cancelled = false;
    let attempt = 0;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

    const connect = async (): Promise<void> => {
      if (cancelled) return;

      let token: string;
      try {
        token = await ensureToken(instance);
      } catch (err) {
        console.error('[ws] ensureToken failed:', err);
        scheduleReconnect();
        return;
      }
      if (cancelled) return;

      const url = `${instance.wsBase}/ws?token=${encodeURIComponent(token)}`;
      const ws = new WebSocket(url);
      wsRef.current = ws;

      ws.onopen = () => {
        if (cancelled) {
          ws.close();
          return;
        }
        attempt = 0; // reset backoff after a clean open
        setConnected(true);
        console.log('🔌 Connected to Berry-Claw');
      };

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data) as WsIncoming;
          onMessageRef.current(msg);
        } catch (e) {
          console.error('Failed to parse WS message:', e);
        }
      };

      ws.onclose = (ev) => {
        setConnected(false);
        if (cancelled) return;
        // 4001 = server's "unauthorized" close code (see server.ts:1034).
        // The cached token is stale; drop it and the next ensureToken() will
        // run a fresh challenge/verify.
        if (ev.code === 4001) {
          clearToken(instance.id);
          attempt = 0; // don't count auth-failures toward backoff
        }
        scheduleReconnect();
      };

      ws.onerror = () => {
        /* handled in onclose */
      };
    };

    const scheduleReconnect = () => {
      if (cancelled) return;
      const delay = backoffDelay(attempt++);
      reconnectTimer = setTimeout(connect, delay);
    };

    void connect();

    return () => {
      cancelled = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      if (wsRef.current) {
        wsRef.current.onclose = null; // don't retrigger the backoff loop
        wsRef.current.close();
        wsRef.current = null;
      }
      setConnected(false);
    };
  }, [instance?.id, instance?.wsBase]);

  const send = useCallback((msg: WsOutgoing) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(msg));
    }
  }, []);

  return { send, connected };
}
