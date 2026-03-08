import { useEffect, useMemo, useCallback } from 'react';
import { useStreamStore } from '../stores/useStreamStore';
import { useSessionStore } from '../stores/useSessionStore';
import { useAlertStore } from '../stores/useAlertStore';
import { useWebSocket } from './useWebSocket';
import { TokenEvent, SessionBoundary, AlertEvent } from '../types';

interface UseTokenStreamOptions {
  wsUrl: string;
}

export function useTokenStream({ wsUrl }: UseTokenStreamOptions) {
  const { appendEvent, appendEvents, setConnectionStatus } = useStreamStore();
  const { startSession, endSession } = useSessionStore();
  const { addAlert } = useAlertStore();

  const handleMessage = useCallback((message: { type: string; data: any }) => {
    switch (message.type) {
      case 'token':
        appendEvent(message.data as TokenEvent);
        break;
      case 'tokens':
        appendEvents(message.data as TokenEvent[]);
        break;
      case 'session_start':
        startSession(message.data as SessionBoundary);
        break;
      case 'session_end':
        const data = message.data as { sessionId: string; endTime: number };
        endSession(data.sessionId, data.endTime);
        break;
      case 'alert':
        addAlert(message.data as AlertEvent);
        break;
      default:
        console.warn('Unknown message type:', message.type);
    }
  }, [appendEvent, appendEvents, startSession, endSession, addAlert]);

  const { isConnected, connect, disconnect } = useWebSocket({
    url: wsUrl,
    onMessage: handleMessage,
    onConnect: () => setConnectionStatus('connected'),
    onDisconnect: () => setConnectionStatus('disconnected'),
    onError: () => setConnectionStatus('error'),
    reconnect: true,
  });

  useEffect(() => {
    setConnectionStatus(isConnected ? 'connected' : 'disconnected');
  }, [isConnected, setConnectionStatus]);

  return {
    isConnected,
    connect,
    disconnect,
  };
}
