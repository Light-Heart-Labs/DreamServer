import { useEffect, useRef, useState, useCallback } from 'react';

/**
 * SSE Event types from Token Spy backend
 */
export type SSEEventType = 
  | 'session.started'
  | 'session.updated'
  | 'usage.tick'
  | 'alert.triggered';

export interface SSEEventPayload {
  type: SSEEventType;
  data: Record<string, any>;
  timestamp: number;
}

export interface UseSSEOptions {
  url: string;
  onMessage?: (event: SSEEventPayload) => void;
  onConnect?: () => void;
  onDisconnect?: () => void;
  onError?: (error: Event) => void;
  reconnect?: boolean;
  maxReconnectAttempts?: number;
  initialBackoffMs?: number;
  maxBackoffMs?: number;
}

export interface UseSSEReturn {
  connect: () => void;
  disconnect: () => void;
  isConnected: boolean;
  reconnectAttempts: number;
  lastEvent: SSEEventPayload | null;
}

/**
 * React hook for Server-Sent Events with exponential backoff reconnection.
 * 
 * @example
 * ```tsx
 * const { isConnected, lastEvent } = useSSE({
 *   url: '/api/events/stream',
 *   onMessage: (event) => {
 *     if (event.type === 'session.started') {
 *       sessionStore.addSession(event.data);
 *     }
 *   },
 * });
 * ```
 */
export function useSSE({
  url,
  onMessage,
  onConnect,
  onDisconnect,
  onError,
  reconnect = true,
  maxReconnectAttempts = 10,
  initialBackoffMs = 1000,
  maxBackoffMs = 30000,
}: UseSSEOptions): UseSSEReturn {
  const eventSourceRef = useRef<EventSource | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [reconnectAttempts, setReconnectAttempts] = useState(0);
  const [lastEvent, setLastEvent] = useState<SSEEventPayload | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const shouldReconnectRef = useRef(true);

  const calculateBackoff = useCallback((attempt: number): number => {
    // Exponential backoff: initialBackoff * 2^attempt with jitter
    const backoff = Math.min(
      initialBackoffMs * Math.pow(2, attempt),
      maxBackoffMs
    );
    // Add 0-20% jitter to prevent thundering herd
    const jitter = backoff * 0.2 * Math.random();
    return Math.floor(backoff + jitter);
  }, [initialBackoffMs, maxBackoffMs]);

  const disconnect = useCallback(() => {
    shouldReconnectRef.current = false;
    
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }

    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }
    
    setIsConnected(false);
  }, []);

  const connect = useCallback(() => {
    // Clean up existing connection
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
    }

    shouldReconnectRef.current = true;

    try {
      const eventSource = new EventSource(url);
      eventSourceRef.current = eventSource;

      eventSource.onopen = () => {
        setIsConnected(true);
        setReconnectAttempts(0);
        onConnect?.();
      };

      // Handle specific event types
      const eventTypes: SSEEventType[] = [
        'session.started',
        'session.updated',
        'usage.tick',
        'alert.triggered',
      ];

      eventTypes.forEach((eventType) => {
        eventSource.addEventListener(eventType, (event: MessageEvent) => {
          try {
            const payload: SSEEventPayload = JSON.parse(event.data);
            setLastEvent(payload);
            onMessage?.(payload);
          } catch (e) {
            console.error('Failed to parse SSE event:', e);
          }
        });
      });

      // Also handle generic message events (fallback)
      eventSource.onmessage = (event: MessageEvent) => {
        try {
          const payload: SSEEventPayload = JSON.parse(event.data);
          setLastEvent(payload);
          onMessage?.(payload);
        } catch (e) {
          // Ignore parse errors for keep-alive comments
        }
      };

      eventSource.onerror = (error: Event) => {
        setIsConnected(false);
        onError?.(error);
        onDisconnect?.();

        // Attempt reconnection with exponential backoff
        if (reconnect && shouldReconnectRef.current && reconnectAttempts < maxReconnectAttempts) {
          const backoff = calculateBackoff(reconnectAttempts);
          console.log(`SSE reconnecting in ${backoff}ms (attempt ${reconnectAttempts + 1}/${maxReconnectAttempts})`);
          
          setReconnectAttempts((prev) => prev + 1);
          
          reconnectTimeoutRef.current = setTimeout(() => {
            if (shouldReconnectRef.current) {
              connect();
            }
          }, backoff);
        } else if (reconnectAttempts >= maxReconnectAttempts) {
          console.error('SSE max reconnection attempts reached');
        }
      };
    } catch (e) {
      console.error('Failed to create EventSource:', e);
    }
  }, [
    url,
    onMessage,
    onConnect,
    onDisconnect,
    onError,
    reconnect,
    reconnectAttempts,
    maxReconnectAttempts,
    calculateBackoff,
  ]);

  // Auto-connect on mount, cleanup on unmount
  useEffect(() => {
    connect();
    return disconnect;
  }, []);  // Only on mount/unmount

  return {
    connect,
    disconnect,
    isConnected,
    reconnectAttempts,
    lastEvent,
  };
}

/**
 * Hook to integrate SSE with session store updates.
 */
export function useSessionSSE(baseUrl: string = '') {
  const { useSessionStore } = require('../stores/useSessionStore');
  const { useAlertStore } = require('../stores/useAlertStore');
  
  const sessionStore = useSessionStore();
  const alertStore = useAlertStore();

  return useSSE({
    url: `${baseUrl}/api/events/stream`,
    onMessage: (event) => {
      switch (event.type) {
        case 'session.started':
          sessionStore.startSession(event.data);
          break;
        case 'session.updated':
          // Update session with new data
          if (event.data.sessionId && event.data.endTime) {
            sessionStore.endSession(event.data.sessionId, event.data.endTime);
          }
          break;
        case 'alert.triggered':
          alertStore.addAlert?.(event.data);
          break;
        case 'usage.tick':
          // Could update a usage store here
          break;
      }
    },
  });
}
