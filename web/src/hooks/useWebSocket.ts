import { useRef, useCallback, useEffect, useState } from 'react';
import type { WsIncoming, WsOutgoing } from '../types';

export function useWebSocket(onMessage: (msg: WsIncoming) => void) {
  const wsRef = useRef<WebSocket | null>(null);
  const [connected, setConnected] = useState(false);
  const onMessageRef = useRef(onMessage);
  onMessageRef.current = onMessage;

  useEffect(() => {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const url = `${protocol}//${window.location.host}/ws`;
    const ws = new WebSocket(url);

    ws.onopen = () => {
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

    ws.onclose = () => {
      setConnected(false);
      console.log('🔌 Disconnected');
    };

    wsRef.current = ws;

    return () => {
      ws.close();
    };
  }, []);

  const send = useCallback((msg: WsOutgoing) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(msg));
    }
  }, []);

  return { send, connected };
}
