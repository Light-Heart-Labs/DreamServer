import { useMemo } from 'react';
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip, Legend } from 'recharts';

interface CostByProvider {
  provider: string;
  cost: number;
  percentage: number;
  tokenCount: number;
}

interface CostBreakdownChartProps {
  data: CostByProvider[];
  period?: 'today' | 'week' | 'month';
}

const PROVIDER_COLORS: Record<string, string> = {
  openai: '#10A37F',
  anthropic: '#D97757',
  google: '#4285F4',
  local: '#6366F1',
  other: '#9ca3af',
};

export function CostBreakdownChart({ data, period = 'today' }: CostBreakdownChartProps) {
  const chartData = useMemo(() => {
    return data.map((item) => ({
      name: item.provider.charAt(0).toUpperCase() + item.provider.slice(1),
      value: item.cost,
      percentage: item.percentage,
      tokens: item.tokenCount,
    }));
  }, [data]);

  const totalCost = useMemo(() => {
    return data.reduce((sum, item) => sum + item.cost, 0);
  }, [data]);

  const periodLabel = {
    today: 'Today',
    week: 'This Week',
    month: 'This Month',
  }[period];

  return (
    <div className="w-full h-80 bg-white rounded-lg shadow p-4">
      <div className="flex justify-between items-center mb-4">
        <h3 className="text-lg font-semibold text-gray-800">Cost by Provider</h3>
        <div className="text-right">
          <p className="text-sm text-gray-500">{periodLabel} Total</p>
          <p className="text-2xl font-bold text-gray-900">${totalCost.toFixed(2)}</p>
        </div>
      </div>
      <ResponsiveContainer width="100%" height="75%">
        <PieChart>
          <Pie
            data={chartData}
            cx="50%"
            cy="50%"
            innerRadius={60}
            outerRadius={100}
            paddingAngle={2}
            dataKey="value"
          >
            {chartData.map((entry, index) => (
              <Cell
                key={`cell-${index}`}
                fill={
                  PROVIDER_COLORS[entry.name.toLowerCase()] ||
                  PROVIDER_COLORS.other
                }
              />
            ))}
          </Pie>
          <Tooltip
            formatter={(value: number, name: string, props: any) => {
              const percentage = props?.payload?.percentage?.toFixed(1) || 0;
              return [`$${value.toFixed(4)} (${percentage}%)`, name];
            }}
            contentStyle={{
              backgroundColor: '#1f2937',
              border: 'none',
              borderRadius: '8px',
              color: '#fff',
            }}
          />
          <Legend verticalAlign="bottom" height={36} />
        </PieChart>
      </ResponsiveContainer>
    </div>
  );
}
