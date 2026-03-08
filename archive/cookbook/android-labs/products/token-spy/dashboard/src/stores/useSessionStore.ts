import { create } from 'zustand';
import { TimelineSession, SessionBoundary } from '../types';

interface SessionState {
  sessions: Map<string, TimelineSession>;
  activeSessionIds: Set<string>;
  selectedSessionId: string | null;
  expandedSessionIds: Set<string>;

  // Actions
  startSession: (session: SessionBoundary) => void;
  endSession: (sessionId: string, endTime: number) => void;
  selectSession: (sessionId: string | null) => void;
  toggleExpanded: (sessionId: string) => void;
  clearSessions: () => void;
}

export const useSessionStore = create<SessionState>((set) => ({
  sessions: new Map(),
  activeSessionIds: new Set(),
  selectedSessionId: null,
  expandedSessionIds: new Set(),

  startSession: (boundary) => {
    set((state) => {
      const session: TimelineSession = {
        id: boundary.sessionId,
        agent: boundary.metadata.agent,
        startTime: boundary.startTime,
        endTime: boundary.endTime,
        tokenCount: 0,
        cost: 0,
        parentId: boundary.parentSessionId,
        depth: boundary.parentSessionId
          ? (state.sessions.get(boundary.parentSessionId)?.depth || 0) + 1
          : 0,
        markers: [],
      };

      const newSessions = new Map(state.sessions);
      newSessions.set(session.id, session);

      const newActiveIds = new Set(state.activeSessionIds);
      if (!session.endTime) {
        newActiveIds.add(session.id);
      }

      return {
        sessions: newSessions,
        activeSessionIds: newActiveIds,
      };
    });
  },

  endSession: (sessionId, endTime) => {
    set((state) => {
      const session = state.sessions.get(sessionId);
      if (!session) return state;

      const newSessions = new Map(state.sessions);
      newSessions.set(sessionId, { ...session, endTime });

      const newActiveIds = new Set(state.activeSessionIds);
      newActiveIds.delete(sessionId);

      return {
        sessions: newSessions,
        activeSessionIds: newActiveIds,
      };
    });
  },

  selectSession: (sessionId) => set({ selectedSessionId: sessionId }),

  toggleExpanded: (sessionId) => {
    set((state) => {
      const newExpanded = new Set(state.expandedSessionIds);
      if (newExpanded.has(sessionId)) {
        newExpanded.delete(sessionId);
      } else {
        newExpanded.add(sessionId);
      }
      return { expandedSessionIds: newExpanded };
    });
  },

  clearSessions: () => set({
    sessions: new Map(),
    activeSessionIds: new Set(),
    selectedSessionId: null,
  }),
}));
