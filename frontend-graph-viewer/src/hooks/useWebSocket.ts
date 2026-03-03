import { useEffect, useRef, useCallback } from 'react';

export interface WsMessage {
  type: 'graph:created' | 'graph:deleted' | 'graph:updated';
  graphId?: string;
  engine?: string;
  database?: string;
  title?: string;
}

/**
 * Hook WebSocket avec reconnexion automatique.
 * Se connecte à ws://127.0.0.1:8080/ws et appelle `onMessage` à chaque événement reçu.
 */
export function useWebSocket(onMessage: (msg: WsMessage) => void) {
  const onMessageRef = useRef(onMessage);
  onMessageRef.current = onMessage;

  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout>>();
  const mountedRef = useRef(true);

  const connect = useCallback(() => {
    if (!mountedRef.current) return;

    try {
      const ws = new WebSocket('ws://127.0.0.1:8080/ws');
      wsRef.current = ws;

      ws.onopen = () => {
        console.log('[WS] Connected');
      };

      ws.onmessage = (event) => {
        try {
          const msg: WsMessage = JSON.parse(event.data);
          onMessageRef.current(msg);
        } catch {
          // ignore malformed messages
        }
      };

      ws.onclose = () => {
        console.log('[WS] Disconnected — reconnecting in 3s');
        if (mountedRef.current) {
          reconnectTimerRef.current = setTimeout(connect, 3000);
        }
      };

      ws.onerror = () => {
        ws.close();
      };
    } catch {
      // WebSocket not available, retry
      if (mountedRef.current) {
        reconnectTimerRef.current = setTimeout(connect, 5000);
      }
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    connect();

    return () => {
      mountedRef.current = false;
      clearTimeout(reconnectTimerRef.current);
      wsRef.current?.close();
    };
  }, [connect]);
}
