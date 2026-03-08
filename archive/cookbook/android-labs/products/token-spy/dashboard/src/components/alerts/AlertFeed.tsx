import { useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { AlertTriangle, Info, XCircle, X, Bell } from 'lucide-react';
import { useAlertStore } from '../../stores/useAlertStore';
import { AlertEvent } from '../../types';

const SEVERITY_CONFIG = {
  info: {
    icon: Info,
    bgColor: 'bg-blue-50',
    borderColor: 'border-blue-200',
    iconColor: 'text-blue-500',
    textColor: 'text-blue-900',
  },
  warning: {
    icon: AlertTriangle,
    bgColor: 'bg-yellow-50',
    borderColor: 'border-yellow-200',
    iconColor: 'text-yellow-500',
    textColor: 'text-yellow-900',
  },
  critical: {
    icon: XCircle,
    bgColor: 'bg-red-50',
    borderColor: 'border-red-200',
    iconColor: 'text-red-500',
    textColor: 'text-red-900',
  },
};

interface AlertItemProps {
  alert: AlertEvent;
  onAcknowledge: (id: string) => void;
  onDismiss: (id: string) => void;
}

function AlertItem({ alert, onAcknowledge, onDismiss }: AlertItemProps) {
  const config = SEVERITY_CONFIG[alert.severity];
  const Icon = config.icon;

  return (
    <motion.div
      initial={{ opacity: 0, y: -20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, x: 100 }}
      className={`p-4 rounded-lg border ${config.bgColor} ${config.borderColor} mb-3`}
    >
      <div className="flex items-start gap-3">
        <Icon className={`w-5 h-5 ${config.iconColor} mt-0.5 flex-shrink-0`} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-2">
            <h4 className={`font-semibold text-sm ${config.textColor}`}>
              {alert.type.charAt(0).toUpperCase() + alert.type.slice(1)} Alert
            </h4>
            <span className="text-xs text-gray-400">
              {new Date(alert.timestamp).toLocaleTimeString()}
            </span>
          </div>
          <p className={`text-sm mt-1 ${config.textColor}`}>{alert.message}</p>
          <div className="flex items-center gap-2 mt-2 text-xs text-gray-500">
            <span>{alert.metric}</span>
            <span>•</span>
            <span>{alert.currentValue.toFixed(2)} / {alert.thresholdValue}</span>
          </div>
          <div className="flex gap-2 mt-3">
            <button
              onClick={() => onAcknowledge(alert.id)}
              className="px-3 py-1 text-xs font-medium bg-white border border-gray-300 rounded hover:bg-gray-50"
            >
              Acknowledge
            </button>
            <button
              onClick={() => onDismiss(alert.id)}
              className="px-3 py-1 text-xs font-medium text-gray-600 hover:text-gray-900"
            >
              Dismiss
            </button>
          </div>
        </div>
        <button
          onClick={() => onDismiss(alert.id)}
          className="text-gray-400 hover:text-gray-600"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
    </motion.div>
  );
}

interface AlertFeedProps {
  maxAlerts?: number;
}

export function AlertFeed({ maxAlerts = 10 }: AlertFeedProps) {
  const { alerts, acknowledgedIds, acknowledge, dismiss } = useAlertStore();
  const [filter, setFilter] = useState<'all' | 'unack'>('unack');

  const filteredAlerts = useMemo(() => {
    let result = alerts;
    if (filter === 'unack') {
      result = alerts.filter((a) => !acknowledgedIds.has(a.id));
    }
    return result.slice(0, maxAlerts);
  }, [alerts, acknowledgedIds, filter, maxAlerts]);

  const unreadCount = alerts.filter((a) => !acknowledgedIds.has(a.id)).length;

  return (
    <div className="w-full max-w-md bg-white rounded-lg shadow-lg overflow-hidden">
      <div className="p-4 border-b border-gray-200 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Bell className="w-5 h-5 text-gray-600" />
          <h3 className="font-semibold text-gray-900">Alerts</h3>
          {unreadCount > 0 && (
            <span className="px-2 py-0.5 bg-red-500 text-white text-xs font-bold rounded-full">
              {unreadCount}
            </span>
          )}
        </div>
        <div className="flex gap-1">
          <button
            onClick={() => setFilter('unack')}
            className={`px-2 py-1 text-xs rounded ${
              filter === 'unack' ? 'bg-gray-200' : 'hover:bg-gray-100'
            }`}
          >
            Unack
          </button>
          <button
            onClick={() => setFilter('all')}
            className={`px-2 py-1 text-xs rounded ${
              filter === 'all' ? 'bg-gray-200' : 'hover:bg-gray-100'
            }`}
          >
            All
          </button>
        </div>
      </div>

      <div className="p-4 max-h-96 overflow-y-auto">
        <AnimatePresence>
          {filteredAlerts.length === 0 ? (
            <p className="text-center text-gray-500 py-8">No alerts</p>
          ) : (
            filteredAlerts.map((alert) => (
              <AlertItem
                key={alert.id}
                alert={alert}
                onAcknowledge={acknowledge}
                onDismiss={dismiss}
              />
            ))
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
