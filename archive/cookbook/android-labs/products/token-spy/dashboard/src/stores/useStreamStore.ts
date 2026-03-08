import { create } from 'zustand';
import { TokenEvent } from '../types';

interface StreamState {
  events: TokenEvent[];
  connectionStatus: 'connecting' | 'connected' | 'disconnected' | 'error';
  bufferSize: number;
  droppedEvents: number;
  lastEventTime: number | null;

  // Actions
  appendEvent: (event: TokenEvent) => void;
  appendEvents: (events: TokenEvent[]) => void;
  clearBuffer: () => void;
  setConnectionStatus: (status: StreamState['connectionStatus']) => void;
  trimBuffer: (maxSize: number) => void;
}

const MAX_BUFFER_SIZE = 10000;

export const useStreamStore = create<StreamState>((set, get) => ({
  events: [],
  connectionStatus: 'disconnected',
  bufferSize: 0,
  droppedEvents: 0,
  lastEventTime: null,

  appendEvent: (event) => {
    set((state) => {
      const newEvents = [...state.events, event];
      // Auto-trim if over limit
      const trimmed = newEvents.length > MAX_BUFFER_SIZE
        ? newEvents.slice(-MAX_BUFFER_SIZE)
        : newEvents;
      
      return {
        events: trimmed,
        bufferSize: trimmed.length,
        lastEventTime: event.timestamp,
        droppedEvents: state.droppedEvents + (newEvents.length - trimmed.length),
      };
    });
  },

  appendEvents: (newEvents) => {
    set((state) => {
      const combined = [...state.events, ...newEvents];
      const trimmed = combined.length > MAX_BUFFER_SIZE
        ? combined.slice(-MAX_BUFFER_SIZE)
        : combined;
      
      return {
        events: trimmed,
        bufferSize: trimmed.length,
        lastEventTime: newEvents[newEvents.length - 1]?.timestamp || state.lastEventTime,
        droppedEvents: state.droppedEvents + (combined.length - trimmed.length),
      };
    });
  },

  clearBuffer: () => set({ events: [], bufferSize: 0, droppedEvents: 0 }),

  setConnectionStatus: (status) => set({ connectionStatus: status }),

  trimBuffer: (maxSize) => {
    set((state) => ({
      events: state.events.slice(-maxSize),
      bufferSize: Math.min(state.events.length, maxSize),
    }));
  },
}));
