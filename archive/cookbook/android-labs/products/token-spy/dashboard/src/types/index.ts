export interface TokenEvent {
  id: string;
  timestamp: number;
  sessionId: string;
  provider: 'openai' | 'anthropic' | 'google' | 'local';
  model: string;
  agent: string;
  tokens: {
    prompt: number;
    completion: number;
    total: number;
  };
  cost: {
    prompt: number;
    completion: number;
    total: number;
  };
  latency: number;
  metadata?: Record<string, any>;
}

export interface TokenWindow {
  windowStart: number;
  windowEnd: number;
  granularity: '1s' | '10s' | '1m' | '5m' | '1h';
  events: TokenEvent[];
  aggregates: {
    totalTokens: number;
    totalCost: number;
    avgLatency: number;
    byProvider: Record<string, { tokens: number; cost: number }>;
    byModel: Record<string, { tokens: number; cost: number }>;
    byAgent: Record<string, { tokens: number; cost: number }>;
  };
}

export interface SessionBoundary {
  sessionId: string;
  startTime: number;
  endTime?: number;
  parentSessionId?: string;
  metadata: {
    agent: string;
    userQuery?: string;
    toolCalls?: string[];
  };
}

export interface AlertEvent {
  id: string;
  timestamp: number;
  severity: 'info' | 'warning' | 'critical';
  type: 'threshold' | 'spike' | 'budget' | 'rate';
  message: string;
  metric: string;
  currentValue: number;
  thresholdValue: number;
  context: TokenEvent | TokenWindow;
}

export interface CostByProvider {
  provider: string;
  cost: number;
  percentage: number;
  tokenCount: number;
}

export interface CostByModel {
  model: string;
  provider: string;
  cost: number;
  avgCostPer1K: number;
}

export interface CostByAgent {
  agent: string;
  cost: number;
  sessionCount: number;
  projectedMonthly: number;
}

export interface TimelineSession {
  id: string;
  agent: string;
  startTime: number;
  endTime?: number;
  tokenCount: number;
  cost: number;
  parentId?: string;
  depth: number;
  markers: Array<{
    timestamp: number;
    type: 'query' | 'tool_call' | 'error' | 'alert';
    label: string;
  }>;
}
