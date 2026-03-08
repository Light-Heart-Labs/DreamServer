/**
 * Token Spy React Query Hooks
 * 
 * Typed hooks for fetching data from Token Spy API.
 * Replaces mock data with real API calls.
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  api,
  timeRangeToHours,
  timeRangeToDays,
  OverviewResponse,
  AgentMetrics,
  ModelMetrics,
  HourlyUsage,
  SessionInfo,
} from '../lib/api';

// ── Query Keys ───────────────────────────────────────────────────────────────

export const queryKeys = {
  overview: ['overview'] as const,
  agents: (days: number) => ['agents', days] as const,
  models: (days: number) => ['models', days] as const,
  hourlyUsage: (hours: number) => ['hourlyUsage', hours] as const,
  sessions: (status?: string) => ['sessions', status] as const,
  health: ['health'] as const,
};

// ── Overview Hook ────────────────────────────────────────────────────────────

export function useOverview() {
  return useQuery<OverviewResponse, Error>({
    queryKey: queryKeys.overview,
    queryFn: () => api.getOverview(),
    refetchInterval: 30000, // Refresh every 30 seconds
    staleTime: 10000,
  });
}

// ── Agents Hook ──────────────────────────────────────────────────────────────

export function useAgents(days: number = 7) {
  return useQuery<AgentMetrics[], Error>({
    queryKey: queryKeys.agents(days),
    queryFn: () => api.getAgents(days),
    refetchInterval: 60000, // Refresh every minute
    staleTime: 30000,
  });
}

// ── Models Hook ──────────────────────────────────────────────────────────────

export function useModels(days: number = 7) {
  return useQuery<ModelMetrics[], Error>({
    queryKey: queryKeys.models(days),
    queryFn: () => api.getModels(days),
    refetchInterval: 60000,
    staleTime: 30000,
  });
}

// ── Hourly Usage Hook ────────────────────────────────────────────────────────

export function useHourlyUsage(hours: number = 24) {
  return useQuery<HourlyUsage[], Error>({
    queryKey: queryKeys.hourlyUsage(hours),
    queryFn: () => api.getHourlyUsage(hours),
    refetchInterval: 60000,
    staleTime: 30000,
  });
}

// ── Sessions Hook ────────────────────────────────────────────────────────────

export function useSessions(status?: 'active' | 'idle' | 'error', limit: number = 50) {
  return useQuery<SessionInfo[], Error>({
    queryKey: queryKeys.sessions(status),
    queryFn: () => api.getSessions(status, limit),
    refetchInterval: 15000, // Refresh every 15 seconds for active monitoring
    staleTime: 5000,
  });
}

// ── Terminate Session Mutation ───────────────────────────────────────────────

export function useTerminateSession() {
  const queryClient = useQueryClient();

  return useMutation<void, Error, string>({
    mutationFn: (sessionId: string) => api.terminateSession(sessionId),
    onSuccess: () => {
      // Invalidate sessions to trigger refetch
      queryClient.invalidateQueries({ queryKey: ['sessions'] });
    },
  });
}

// ── Health Check Hook ────────────────────────────────────────────────────────

export function useHealthCheck() {
  return useQuery({
    queryKey: queryKeys.health,
    queryFn: () => api.healthCheck(),
    refetchInterval: 60000,
    staleTime: 30000,
  });
}

// ── Legacy Hooks (for backwards compatibility) ───────────────────────────────

/**
 * @deprecated Use useOverview() and useHourlyUsage() instead
 */
export function useTokenUsage(timeRange: '1h' | '24h' | '7d' | '30d' = '24h') {
  const hours = timeRangeToHours(timeRange);
  const { data: overview, isLoading: overviewLoading, error: overviewError } = useOverview();
  const { data: hourly, isLoading: hourlyLoading, error: hourlyError } = useHourlyUsage(hours);

  // Aggregate hourly data
  const aggregated = hourly?.reduce(
    (acc, h) => ({
      total_requests: acc.total_requests + h.request_count,
      total_input_tokens: acc.total_input_tokens + Math.floor(h.total_tokens * 0.4),
      total_output_tokens: acc.total_output_tokens + Math.floor(h.total_tokens * 0.6),
      total_tokens: acc.total_tokens + h.total_tokens,
    }),
    { total_requests: 0, total_input_tokens: 0, total_output_tokens: 0, total_tokens: 0 }
  );

  return {
    data: aggregated || {
      total_requests: overview?.total_requests_24h || 0,
      total_input_tokens: Math.floor((overview?.total_tokens_24h || 0) * 0.4),
      total_output_tokens: Math.floor((overview?.total_tokens_24h || 0) * 0.6),
      total_tokens: overview?.total_tokens_24h || 0,
    },
    isLoading: overviewLoading || hourlyLoading,
    error: overviewError || hourlyError,
  };
}

/**
 * @deprecated Use useOverview() instead
 */
export function useCostSummary(timeRange: '1h' | '24h' | '7d' | '30d' = '24h') {
  const { data: overview, isLoading, error } = useOverview();

  return {
    data: {
      total_cost: overview?.total_cost_24h || 0,
      budget_used_percent: overview?.budget_used_percent || null,
    },
    isLoading,
    error,
  };
}
