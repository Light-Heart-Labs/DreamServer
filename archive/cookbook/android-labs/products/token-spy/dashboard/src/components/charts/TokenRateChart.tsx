import { useMemo } from 'react';
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';
import { format } from 'date-fns';

export interface TimeSeriesPoint {
  timestamp: number;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  cost: number;
}

interface TokenRateChartProps {
  data: TimeSeriesPoint[];
  granularity?: '1s' | '10s' | '1m';
  showProviders?: string[];
  maxPoints?: number;
  onPointClick?: (point: TimeSeriesPoint) => void;
}

export function TokenRateChart({
  data,
  maxPoints = 300,
  onPointClick,
}: TokenRateChartProps) {
  const chartData = useMemo(() => {
    // Sliding window - keep only last maxPoints
    const windowed = data.slice(-maxPoints);
    return windowed.map((point) => ({
      ...point,
      time: format(point.timestamp, 'HH:mm:ss'),
    }));
  }, [data, maxPoints]);

  const handleClick = (state: any) => {
    if (state && state.activePayload && onPointClick) {
      onPointClick(state.activePayload[0].payload);
    }
  };

  return (
    <div className="w-full h-80 bg-white rounded-lg shadow p-4">
      <h3 className="text-lg font-semibold mb-4 text-gray-800">Token Rate Over Time</h3>
      <ResponsiveContainer width="100%" height="85%">
        <AreaChart data={chartData} onClick={handleClick}>
          <defs>
            <linearGradient id="colorPrompt" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.8} />
              <stop offset="95%" stopColor="#3b82f6" stopOpacity={0.2} />
            </linearGradient>
            <linearGradient id="colorCompletion" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#10b981" stopOpacity={0.8} />
              <stop offset="95%" stopColor="#10b981" stopOpacity={0.2} />
            </linearGradient>
            <linearGradient id="colorTotal" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#8b5cf6" stopOpacity={0.8} />
              <stop offset="95%" stopColor="#8b5cf6" stopOpacity={0.2} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
          <XAxis
            dataKey="time"
            tick={{ fontSize: 12 }}
            stroke="#6b7280"
            interval="preserveStartEnd"
          />
          <YAxis tick={{ fontSize: 12 }} stroke="#6b7280" />
          <Tooltip
            contentStyle={{
              backgroundColor: '#1f2937',
              border: 'none',
              borderRadius: '8px',
              color: '#fff',
            }}
            labelStyle={{ color: '#9ca3af' }}
          />
          <Area
            type="monotone"
            dataKey="promptTokens"
            name="Prompt"
            stroke="#3b82f6"
            fillOpacity={1}
            fill="url(#colorPrompt)"
            strokeWidth={2}
          />
          <Area
            type="monotone"
            dataKey="completionTokens"
            name="Completion"
            stroke="#10b981"
            fillOpacity={1}
            fill="url(#colorCompletion)"
            strokeWidth={2}
          />
          <Area
            type="monotone"
            dataKey="totalTokens"
            name="Total"
            stroke="#8b5cf6"
            fillOpacity={1}
            fill="url(#colorTotal)"
            strokeWidth={2}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
