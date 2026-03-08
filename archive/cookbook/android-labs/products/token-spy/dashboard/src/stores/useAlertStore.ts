import { create } from 'zustand';
import { AlertEvent } from '../types';

interface ThresholdConfig {
  tokensPerMinute: { warning: number; critical: number };
  tokensPerHour: { warning: number; critical: number };
  costPerDay: { warning: number; critical: number };
  costPerMonth: { warning: number; critical: number };
  maxSessionTokens: { warning: number; critical: number };
  maxSessionCost: { warning: number; critical: number };
  providerOverrides: Record<string, Partial<ThresholdConfig>>;
  notifications: {
    sound: boolean;
    desktop: boolean;
    email?: string;
  };
}

interface AlertState {
  alerts: AlertEvent[];
  acknowledgedIds: Set<string>;
  thresholds: ThresholdConfig;

  // Actions
  addAlert: (alert: AlertEvent) => void;
  acknowledge: (alertId: string) => void;
  dismiss: (alertId: string) => void;
  updateThresholds: (config: Partial<ThresholdConfig>) => void;
  clearAlerts: () => void;
}

const DEFAULT_THRESHOLDS: ThresholdConfig = {
  tokensPerMinute: { warning: 1000, critical: 5000 },
  tokensPerHour: { warning: 10000, critical: 50000 },
  costPerDay: { warning: 10, critical: 50 },
  costPerMonth: { warning: 100, critical: 500 },
  maxSessionTokens: { warning: 10000, critical: 50000 },
  maxSessionCost: { warning: 1, critical: 5 },
  providerOverrides: {},
  notifications: {
    sound: true,
    desktop: true,
  },
};

export const useAlertStore = create<AlertState>((set) => ({
  alerts: [],
  acknowledgedIds: new Set(),
  thresholds: DEFAULT_THRESHOLDS,

  addAlert: (alert) => {
    set((state) => ({
      alerts: [alert, ...state.alerts].slice(0, 100), // Keep last 100
    }));

    // Play sound if enabled
    if (DEFAULT_THRESHOLDS.notifications.sound) {
      playAlertSound(alert.severity);
    }
  },

  acknowledge: (alertId) => {
    set((state) => ({
      acknowledgedIds: new Set([...state.acknowledgedIds, alertId]),
    }));
  },

  dismiss: (alertId) => {
    set((state) => ({
      alerts: state.alerts.filter((a) => a.id !== alertId),
    }));
  },

  updateThresholds: (config) => {
    set((state) => ({
      thresholds: { ...state.thresholds, ...config },
    }));
  },

  clearAlerts: () => set({ alerts: [], acknowledgedIds: new Set() }),
}));

function playAlertSound(severity: string) {
  const frequencies: Record<string, number> = {
    info: 800,
    warning: 600,
    critical: 400,
  };

  try {
    const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
    const oscillator = audioContext.createOscillator();
    const gainNode = audioContext.createGain();

    oscillator.connect(gainNode);
    gainNode.connect(audioContext.destination);

    oscillator.frequency.value = frequencies[severity] || 800;
    oscillator.type = severity === 'critical' ? 'square' : 'sine';

    gainNode.gain.setValueAtTime(0.3, audioContext.currentTime);
    gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.5);

    oscillator.start(audioContext.currentTime);
    oscillator.stop(audioContext.currentTime + 0.5);
  } catch (e) {
    // Audio not supported
  }
}
