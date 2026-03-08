import { useState, useMemo } from 'react';
import {
  useOverview,
  useAgents,
  useModels,
  useHourlyUsage,
  useSessions,
  useTerminateSession,
} from './hooks/useApi';
import {
  TokenRateChart,
  CostBreakdownChart,
  Gauge,
} from './components/charts';
import { AlertFeed, AlertConfig } from './components/alerts';
import { useStreamStore } from './stores/useStreamStore';
import { useAlertStore } from './stores/useAlertStore';
import { TimeSeriesPoint } from './components/charts';
import { HourlyUsage, ModelMetrics, AgentMetrics, SessionInfo } from './lib/api';
import { ProviderKeysPage } from './pages/ProviderKeysPage';
import OrganizationsPage from './pages/OrganizationsPage';

// Convert hourly usage to chart time series
function hourlyToTimeSeries(hourly: HourlyUsage[]): TimeSeriesPoint[] {
  if (!hourly?.length) return [];

  // Group by hour
  const byHour = new Map<string, TimeSeriesPoint>();

  for (const h of hourly) {
    const key = h.hour;
    const existing = byHour.get(key);
    const inputTokens = Math.floor(h.total_tokens * 0.4);
    const outputTokens = h.total_tokens - inputTokens;

    if (existing) {
      existing.promptTokens += inputTokens;
      existing.completionTokens += outputTokens;
      existing.totalTokens += h.total_tokens;
      existing.cost += h.total_cost;
    } else {
      byHour.set(key, {
        timestamp: new Date(h.hour).getTime(),
        promptTokens: inputTokens,
        completionTokens: outputTokens,
        totalTokens: h.total_tokens,
        cost: h.total_cost,
      });
    }
  }

  return Array.from(byHour.values()).sort((a, b) => a.timestamp - b.timestamp);
}

// Convert models to cost breakdown
function modelsToCostBreakdown(models: ModelMetrics[]) {
  const byProvider = new Map<string, { cost: number; tokens: number }>();

  for (const m of models) {
    const existing = byProvider.get(m.provider);
    if (existing) {
      existing.cost += m.total_cost;
      existing.tokens += m.total_tokens;
    } else {
      byProvider.set(m.provider, { cost: m.total_cost, tokens: m.total_tokens });
    }
  }

  const totalCost = Array.from(byProvider.values()).reduce((sum, v) => sum + v.cost, 0);

  return Array.from(byProvider.entries()).map(([provider, data]) => ({
    provider,
    cost: data.cost,
    percentage: totalCost > 0 ? (data.cost / totalCost) * 100 : 0,
    tokenCount: data.tokens,
  }));
}

function App() {
  const [timeRange, setTimeRange] = useState<'1h' | '24h' | '7d' | '30d'>('24h');
  const [showConfig, setShowConfig] = useState(false);
  const [activeView, setActiveView] = useState<'overview' | 'agents' | 'models' | 'sessions' | 'provider-keys' | 'organizations'>('overview');

  // API hooks
  const { data: overview, isLoading: overviewLoading, error: overviewError } = useOverview();
  const { data: agents, isLoading: agentsLoading, error: agentsError } = useAgents(
    timeRange === '7d' ? 7 : timeRange === '30d' ? 30 : 1
  );
  const { data: models, isLoading: modelsLoading, error: modelsError } = useModels(
    timeRange === '7d' ? 7 : timeRange === '30d' ? 30 : 1
  );
  const { data: hourly, isLoading: hourlyLoading } = useHourlyUsage(
    timeRange === '1h' ? 1 : timeRange === '24h' ? 24 : timeRange === '7d' ? 168 : 720
  );
  const { data: sessions, isLoading: sessionsLoading } = useSessions();
  const terminateSession = useTerminateSession();

  const { connectionStatus } = useStreamStore();
  const { alerts } = useAlertStore();

  // Transform data for charts
  const chartData = useMemo(() => hourlyToTimeSeries(hourly || []), [hourly]);
  const gaugeHistory = useMemo(
    () => chartData.slice(-60).map((d) => d.totalTokens),
    [chartData]
  );
  const costByProvider = useMemo(
    () => modelsToCostBreakdown(models || []),
    [models]
  );

  const connectionColor =
    connectionStatus === 'connected'
      ? 'bg-green-500'
      : connectionStatus === 'connecting'
      ? 'bg-yellow-500'
      : 'bg-red-500';

  const handleTerminateSession = async (sessionId: string) => {
    if (confirm(`Terminate session ${sessionId}?`)) {
      await terminateSession.mutateAsync(sessionId);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white border-b border-gray-200 px-8 py-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Token Spy Dashboard</h1>
            <p className="text-sm text-gray-600">
              Real-time LLM API usage & cost monitoring
            </p>
          </div>
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2">
              <div className={`w-2 h-2 rounded-full ${connectionColor}`} />
              <span className="text-sm text-gray-600 capitalize">
                {connectionStatus}
              </span>
            </div>
            {alerts.filter((a) => !a.acknowledged).length > 0 && (
              <div className="px-3 py-1 bg-red-100 text-red-700 rounded-full text-sm font-medium">
                {alerts.filter((a) => !a.acknowledged).length} alerts
              </div>
            )}
            <button
              onClick={() => setShowConfig(!showConfig)}
              className="px-4 py-2 bg-gray-100 hover:bg-gray-200 rounded-lg text-sm font-medium"
            >
              {showConfig ? 'Hide Config' : 'Config'}
            </button>
          </div>
        </div>

        {/* Navigation */}
        <nav className="mt-4 flex gap-4">
          {(['overview', 'agents', 'models', 'sessions', 'provider-keys', 'organizations'] as const).map((view) => (
            <button
              key={view}
              onClick={() => setActiveView(view)}
              className={`px-4 py-2 rounded-lg font-medium transition-colors ${
                activeView === view
                  ? 'bg-blue-600 text-white'
                  : 'bg-white text-gray-700 hover:bg-gray-100 border border-gray-300'
              }`}
            >
              {view === 'provider-keys' ? 'Provider Keys' : view === 'organizations' ? 'Organizations' : view}
            </button>
          ))}
        </nav>
      </header>

      <main className="p-8">
        {/* Error Display */}
        {(overviewError || agentsError || modelsError) && (
          <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg">
            <p className="text-red-700 font-medium">Error loading data</p>
            <p className="text-red-600 text-sm">
              {(overviewError || agentsError || modelsError)?.message || 'Unknown error'}
            </p>
          </div>
        )}

        {/* Time Range Selector */}
        <div className="mb-6 flex gap-2">
          {(['1h', '24h', '7d', '30d'] as const).map((range) => (
            <button
              key={range}
              onClick={() => setTimeRange(range)}
              className={`px-4 py-2 rounded-lg font-medium transition-colors ${
                timeRange === range
                  ? 'bg-blue-600 text-white'
                  : 'bg-white text-gray-700 hover:bg-gray-100 border border-gray-300'
              }`}
            >
              {range === '1h'
                ? 'Last Hour'
                : range === '24h'
                ? 'Last 24h'
                : range === '7d'
                ? 'Last 7 Days'
                : 'Last 30 Days'}
            </button>
          ))}
        </div>

        {/* Overview View */}
        {activeView === 'overview' && (
          <>
            {/* Metrics Row */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
              <MetricCard
                title="Total Requests (24h)"
                value={overview?.total_requests_24h?.toLocaleString() || '—'}
                loading={overviewLoading}
              />
              <MetricCard
                title="Total Tokens (24h)"
                value={overview?.total_tokens_24h?.toLocaleString() || '—'}
                loading={overviewLoading}
              />
              <MetricCard
                title="Avg Latency"
                value={overview?.avg_latency_ms ? `${overview.avg_latency_ms.toFixed(0)}ms` : '—'}
                loading={overviewLoading}
              />
              <MetricCard
                title="Estimated Cost (24h)"
                value={overview?.total_cost_24h != null ? `$${overview.total_cost_24h.toFixed(2)}` : '—'}
                loading={overviewLoading}
              />
            </div>

            {/* Charts & Gauges Row */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-8">
              <div className="lg:col-span-2">
                {hourlyLoading ? (
                  <LoadingCard height="h-64" />
                ) : chartData.length > 0 ? (
                  <TokenRateChart data={chartData} maxPoints={100} />
                ) : (
                  <EmptyCard message="No usage data available" />
                )}
              </div>
              <div className="space-y-4">
                <Gauge
                  currentValue={overview?.total_tokens_24h ? overview.total_tokens_24h / 1440 : 0}
                  maxValue={5000}
                  warningThreshold={0.6}
                  criticalThreshold={0.85}
                  history={gaugeHistory}
                  label="Tokens/min"
                />
                {modelsLoading ? (
                  <LoadingCard height="h-48" />
                ) : costByProvider.length > 0 ? (
                  <CostBreakdownChart data={costByProvider} period="today" />
                ) : (
                  <EmptyCard message="No cost data" height="h-48" />
                )}
              </div>
            </div>

            {/* Alerts & Config Row */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <div>
                <h2 className="text-lg font-semibold text-gray-900 mb-4">Alerts</h2>
                <AlertFeed maxAlerts={5} />
              </div>
              {showConfig && (
                <div>
                  <h2 className="text-lg font-semibold text-gray-900 mb-4">
                    Configuration
                  </h2>
                  <AlertConfig />
                </div>
              )}
            </div>

            {/* Top Model */}
            {overview?.top_model && (
              <div className="mt-6 bg-white rounded-xl shadow-sm border border-gray-200 p-6">
                <h2 className="text-lg font-semibold text-gray-900 mb-2">Top Model</h2>
                <p className="text-2xl font-mono text-blue-600">{overview.top_model}</p>
                {overview.budget_used_percent != null && (
                  <p className="text-sm text-gray-500 mt-2">
                    Budget used: {overview.budget_used_percent.toFixed(1)}%
                  </p>
                )}
              </div>
            )}
          </>
        )}

        {/* Agents View */}
        {activeView === 'agents' && (
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-4">
              Agents {agents && `(${agents.length})`}
            </h2>
            {agentsLoading ? (
              <LoadingCard />
            ) : agents && agents.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-gray-200">
                      <th className="text-left py-3 px-2 font-medium text-gray-700">Agent</th>
                      <th className="text-right py-3 px-2 font-medium text-gray-700">Requests</th>
                      <th className="text-right py-3 px-2 font-medium text-gray-700">Tokens</th>
                      <th className="text-right py-3 px-2 font-medium text-gray-700">Cost</th>
                      <th className="text-right py-3 px-2 font-medium text-gray-700">Avg Latency</th>
                      <th className="text-right py-3 px-2 font-medium text-gray-700">Health</th>
                    </tr>
                  </thead>
                  <tbody>
                    {agents.map((agent: AgentMetrics) => (
                      <tr key={agent.agent_id} className="border-b border-gray-100 hover:bg-gray-50">
                        <td className="py-3 px-2">
                          <span className="font-medium text-gray-900">
                            {agent.name || agent.agent_id}
                          </span>
                        </td>
                        <td className="text-right py-3 px-2 text-gray-600">
                          {agent.total_requests.toLocaleString()}
                        </td>
                        <td className="text-right py-3 px-2 text-gray-600">
                          {agent.total_tokens.toLocaleString()}
                        </td>
                        <td className="text-right py-3 px-2 text-gray-600">
                          ${agent.total_cost.toFixed(4)}
                        </td>
                        <td className="text-right py-3 px-2 text-gray-600">
                          {agent.avg_latency_ms ? `${agent.avg_latency_ms.toFixed(0)}ms` : '—'}
                        </td>
                        <td className="text-right py-3 px-2">
                          <HealthBadge score={agent.health_score} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <EmptyCard message="No agent data available" />
            )}
          </div>
        )}

        {/* Models View */}
        {activeView === 'models' && (
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-4">
              Models {models && `(${models.length})`}
            </h2>
            {modelsLoading ? (
              <LoadingCard />
            ) : models && models.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-gray-200">
                      <th className="text-left py-3 px-2 font-medium text-gray-700">Provider</th>
                      <th className="text-left py-3 px-2 font-medium text-gray-700">Model</th>
                      <th className="text-right py-3 px-2 font-medium text-gray-700">Requests</th>
                      <th className="text-right py-3 px-2 font-medium text-gray-700">Tokens</th>
                      <th className="text-right py-3 px-2 font-medium text-gray-700">Cost</th>
                      <th className="text-right py-3 px-2 font-medium text-gray-700">$/1K tokens</th>
                    </tr>
                  </thead>
                  <tbody>
                    {models.map((model: ModelMetrics) => (
                      <tr
                        key={`${model.provider}-${model.model}`}
                        className="border-b border-gray-100 hover:bg-gray-50"
                      >
                        <td className="py-3 px-2">
                          <span className="font-medium text-gray-900">{model.provider}</span>
                        </td>
                        <td className="py-3 px-2 font-mono text-sm text-gray-700">
                          {model.model}
                        </td>
                        <td className="text-right py-3 px-2 text-gray-600">
                          {model.request_count.toLocaleString()}
                        </td>
                        <td className="text-right py-3 px-2 text-gray-600">
                          {model.total_tokens.toLocaleString()}
                        </td>
                        <td className="text-right py-3 px-2 text-gray-600">
                          ${model.total_cost.toFixed(4)}
                        </td>
                        <td className="text-right py-3 px-2 text-gray-600">
                          {model.cost_per_1k_tokens
                            ? `$${model.cost_per_1k_tokens.toFixed(4)}`
                            : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <EmptyCard message="No model data available" />
            )}
          </div>
        )}

        {/* Sessions View */}
        {activeView === 'sessions' && (
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-4">
              Sessions {sessions && `(${sessions.length})`}
            </h2>
            {sessionsLoading ? (
              <LoadingCard />
            ) : sessions && sessions.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-gray-200">
                      <th className="text-left py-3 px-2 font-medium text-gray-700">Session ID</th>
                      <th className="text-left py-3 px-2 font-medium text-gray-700">Agent</th>
                      <th className="text-left py-3 px-2 font-medium text-gray-700">Model</th>
                      <th className="text-right py-3 px-2 font-medium text-gray-700">Requests</th>
                      <th className="text-right py-3 px-2 font-medium text-gray-700">Cost</th>
                      <th className="text-center py-3 px-2 font-medium text-gray-700">Status</th>
                      <th className="text-center py-3 px-2 font-medium text-gray-700">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sessions.map((session: SessionInfo) => (
                      <tr key={session.session_id} className="border-b border-gray-100 hover:bg-gray-50">
                        <td className="py-3 px-2 font-mono text-sm text-gray-700">
                          {session.session_id.slice(0, 8)}...
                        </td>
                        <td className="py-3 px-2 text-gray-600">
                          {session.agent_id || '—'}
                        </td>
                        <td className="py-3 px-2 font-mono text-sm text-gray-700">
                          {session.model}
                        </td>
                        <td className="text-right py-3 px-2 text-gray-600">
                          {session.total_requests.toLocaleString()}
                        </td>
                        <td className="text-right py-3 px-2 text-gray-600">
                          ${session.total_cost.toFixed(4)}
                        </td>
                        <td className="text-center py-3 px-2">
                          <StatusBadge status={session.status} />
                        </td>
                        <td className="text-center py-3 px-2">
                          {session.status === 'active' && (
                            <button
                              onClick={() => handleTerminateSession(session.session_id)}
                              disabled={terminateSession.isPending}
                              className="px-3 py-1 bg-red-100 hover:bg-red-200 text-red-700 rounded text-sm font-medium disabled:opacity-50"
                            >
                              Terminate
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <EmptyCard message="No active sessions" />
            )}
          </div>
        )}

        {/* Provider Keys View */}
        {activeView === 'provider-keys' && <ProviderKeysPage />}

        {/* Organizations View */}
        {activeView === 'organizations' && <OrganizationsPage />}
      </main>
    </div>
  );
}

// ── Helper Components ────────────────────────────────────────────────────────

function MetricCard({
  title,
  value,
  loading,
}: {
  title: string;
  value: string | number;
  loading?: boolean;
}) {
  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
      <h3 className="text-sm font-medium text-gray-500 mb-2">{title}</h3>
      {loading ? (
        <div className="h-8 w-24 bg-gray-200 animate-pulse rounded" />
      ) : (
        <p className="text-2xl font-bold text-gray-900">{value}</p>
      )}
    </div>
  );
}

function LoadingCard({ height = 'h-32' }: { height?: string }) {
  return (
    <div className={`${height} bg-gray-100 animate-pulse rounded-xl flex items-center justify-center`}>
      <span className="text-gray-500">Loading...</span>
    </div>
  );
}

function EmptyCard({ message, height = 'h-32' }: { message: string; height?: string }) {
  return (
    <div className={`${height} bg-gray-50 rounded-xl flex items-center justify-center border border-gray-200`}>
      <span className="text-gray-500">{message}</span>
    </div>
  );
}

function HealthBadge({ score }: { score: number }) {
  const color =
    score >= 80
      ? 'bg-green-100 text-green-700'
      : score >= 50
      ? 'bg-yellow-100 text-yellow-700'
      : 'bg-red-100 text-red-700';

  return (
    <span className={`px-2 py-1 rounded text-sm font-medium ${color}`}>
      {score.toFixed(0)}%
    </span>
  );
}

function StatusBadge({ status }: { status: 'active' | 'idle' | 'error' }) {
  const colors = {
    active: 'bg-green-100 text-green-700',
    idle: 'bg-yellow-100 text-yellow-700',
    error: 'bg-red-100 text-red-700',
  };

  return (
    <span className={`px-2 py-1 rounded text-sm font-medium capitalize ${colors[status]}`}>
      {status}
    </span>
  );
}

export default App;
