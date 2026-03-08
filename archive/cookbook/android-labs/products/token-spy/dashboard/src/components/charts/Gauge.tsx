import { useMemo } from 'react';

interface GaugeProps {
  currentValue: number;
  maxValue: number;
  warningThreshold?: number;
  criticalThreshold?: number;
  history?: number[];
  providerBreakdown?: Record<string, number>;
  label?: string;
}

export function Gauge({
  currentValue,
  maxValue,
  warningThreshold = 0.7,
  criticalThreshold = 0.9,
  history = [],
  label = 'Tokens/sec',
}: GaugeProps) {
  const percentage = Math.min((currentValue / maxValue) * 100, 100);

  const getColor = () => {
    if (percentage >= criticalThreshold * 100) return '#ef4444'; // red
    if (percentage >= warningThreshold * 100) return '#f59e0b'; // yellow
    return '#10b981'; // green
  };

  const getStatus = () => {
    if (percentage >= criticalThreshold * 100) return 'Critical';
    if (percentage >= warningThreshold * 100) return 'Warning';
    return 'Normal';
  };

  // Calculate arc path for gauge
  const radius = 80;
  const strokeWidth = 12;
  const normalizedRadius = radius - strokeWidth / 2;
  const circumference = normalizedRadius * Math.PI; // Half circle
  const strokeDashoffset = circumference - (percentage / 100) * circumference;

  // Mini sparkline path
  const sparklinePath = useMemo(() => {
    if (history.length < 2) return '';
    const width = 100;
    const height = 30;
    const max = Math.max(...history, maxValue * 0.1);
    const min = 0;
    const range = max - min;

    return history
      .map((value, index) => {
        const x = (index / (history.length - 1)) * width;
        const y = height - ((value - min) / range) * height;
        return `${index === 0 ? 'M' : 'L'} ${x} ${y}`;
      })
      .join(' ');
  }, [history, maxValue]);

  return (
    <div className="w-full max-w-xs bg-white rounded-lg shadow p-4">
      <h3 className="text-sm font-medium text-gray-500 mb-2">{label}</h3>
      
      {/* Main Gauge */}
      <div className="relative flex justify-center">
        <svg width={radius * 2} height={radius} className="transform rotate-0">
          {/* Background arc */}
          <path
            d={`M ${strokeWidth / 2} ${radius} A ${normalizedRadius} ${normalizedRadius} 0 0 1 ${radius * 2 - strokeWidth / 2} ${radius}`}
            fill="none"
            stroke="#e5e7eb"
            strokeWidth={strokeWidth}
            strokeLinecap="round"
          />
          {/* Value arc */}
          <path
            d={`M ${strokeWidth / 2} ${radius} A ${normalizedRadius} ${normalizedRadius} 0 0 1 ${radius * 2 - strokeWidth / 2} ${radius}`}
            fill="none"
            stroke={getColor()}
            strokeWidth={strokeWidth}
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={strokeDashoffset}
            className="transition-all duration-500 ease-out"
          />
        </svg>
        
        {/* Center value */}
        <div className="absolute bottom-0 text-center">
          <p className="text-3xl font-bold text-gray-900">{Math.round(currentValue)}</p>
          <p className={`text-sm font-medium ${
            getStatus() === 'Critical' ? 'text-red-500' :
            getStatus() === 'Warning' ? 'text-yellow-500' : 'text-green-500'
          }`}>
            {getStatus()}
          </p>
        </div>
      </div>

      {/* Sparkline */}
      {history.length > 1 && (
        <div className="mt-4">
          <svg viewBox="0 0 100 30" className="w-full h-8">
            <path
              d={sparklinePath}
              fill="none"
              stroke={getColor()}
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          <p className="text-xs text-gray-400 text-center mt-1">Last {history.length} seconds</p>
        </div>
      )}

      {/* Stats */}
      <div className="mt-4 flex justify-between text-sm">
        <div>
          <p className="text-gray-500">Current</p>
          <p className="font-semibold">{currentValue.toFixed(0)}/s</p>
        </div>
        <div className="text-right">
          <p className="text-gray-500">Capacity</p>
          <p className="font-semibold">{maxValue.toFixed(0)}/s</p>
        </div>
      </div>
    </div>
  );
}
