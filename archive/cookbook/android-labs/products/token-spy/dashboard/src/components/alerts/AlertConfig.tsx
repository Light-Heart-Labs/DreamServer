import { useState } from 'react';
import { useAlertStore } from '../../stores/useAlertStore';
import { Bell, Volume2, VolumeX, Monitor } from 'lucide-react';

export function AlertConfig() {
  const { thresholds, updateThresholds } = useAlertStore();
  const [localThresholds, setLocalThresholds] = useState(thresholds);

  const handleSave = () => {
    updateThresholds(localThresholds);
  };

  return (
    <div className="bg-white rounded-lg shadow p-6">
      <div className="flex items-center gap-2 mb-6">
        <Bell className="w-5 h-5 text-gray-600" />
        <h3 className="text-lg font-semibold">Alert Configuration</h3>
      </div>

      {/* Rate Thresholds */}
      <div className="mb-6">
        <h4 className="text-sm font-medium text-gray-700 mb-3">Rate Limits</h4>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-xs text-gray-500 mb-1">
              Tokens/Minute Warning
            </label>
            <input
              type="number"
              value={localThresholds.tokensPerMinute.warning}
              onChange={(e) =>
                setLocalThresholds({
                  ...localThresholds,
                  tokensPerMinute: {
                    ...localThresholds.tokensPerMinute,
                    warning: parseInt(e.target.value),
                  },
                })
              }
              className="w-full px-3 py-2 border border-gray-300 rounded text-sm"
            />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">
              Tokens/Minute Critical
            </label>
            <input
              type="number"
              value={localThresholds.tokensPerMinute.critical}
              onChange={(e) =>
                setLocalThresholds({
                  ...localThresholds,
                  tokensPerMinute: {
                    ...localThresholds.tokensPerMinute,
                    critical: parseInt(e.target.value),
                  },
                })
              }
              className="w-full px-3 py-2 border border-gray-300 rounded text-sm"
            />
          </div>
        </div>
      </div>

      {/* Cost Thresholds */}
      <div className="mb-6">
        <h4 className="text-sm font-medium text-gray-700 mb-3">Cost Limits ($)</h4>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-xs text-gray-500 mb-1">Daily Warning</label>
            <input
              type="number"
              step="0.01"
              value={localThresholds.costPerDay.warning}
              onChange={(e) =>
                setLocalThresholds({
                  ...localThresholds,
                  costPerDay: {
                    ...localThresholds.costPerDay,
                    warning: parseFloat(e.target.value),
                  },
                })
              }
              className="w-full px-3 py-2 border border-gray-300 rounded text-sm"
            />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Daily Critical</label>
            <input
              type="number"
              step="0.01"
              value={localThresholds.costPerDay.critical}
              onChange={(e) =>
                setLocalThresholds({
                  ...localThresholds,
                  costPerDay: {
                    ...localThresholds.costPerDay,
                    critical: parseFloat(e.target.value),
                  },
                })
              }
              className="w-full px-3 py-2 border border-gray-300 rounded text-sm"
            />
          </div>
        </div>
      </div>

      {/* Notifications */}
      <div className="mb-6">
        <h4 className="text-sm font-medium text-gray-700 mb-3">Notifications</h4>
        <div className="flex gap-4">
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={localThresholds.notifications.sound}
              onChange={(e) =>
                setLocalThresholds({
                  ...localThresholds,
                  notifications: {
                    ...localThresholds.notifications,
                    sound: e.target.checked,
                  },
                })
              }
              className="rounded"
            />
            {localThresholds.notifications.sound ? (
              <Volume2 className="w-4 h-4 text-gray-600" />
            ) : (
              <VolumeX className="w-4 h-4 text-gray-400" />
            )}
            <span className="text-sm">Sound</span>
          </label>
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={localThresholds.notifications.desktop}
              onChange={(e) =>
                setLocalThresholds({
                  ...localThresholds,
                  notifications: {
                    ...localThresholds.notifications,
                    desktop: e.target.checked,
                  },
                })
              }
              className="rounded"
            />
            <Monitor className="w-4 h-4 text-gray-600" />
            <span className="text-sm">Desktop</span>
          </label>
        </div>
      </div>

      <button
        onClick={handleSave}
        className="w-full py-2 bg-blue-600 text-white rounded font-medium hover:bg-blue-700"
      >
        Save Configuration
      </button>
    </div>
  );
}
