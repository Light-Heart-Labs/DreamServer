/**
 * Token Spy API Client
 * 
 * Typed API client for Token Spy backend endpoints.
 * Uses VITE_API_URL environment variable for base URL.
 */

const API_BASE = import.meta.env.VITE_API_URL || '/api';

// ── Types matching backend Pydantic models ───────────────────────────────────

export interface OverviewResponse {
  total_requests_24h: number;
  total_tokens_24h: number;
  total_cost_24h: number;
  active_sessions: number;
  avg_latency_ms: number | null;
  top_model: string | null;
  budget_used_percent: number | null;
}

export interface AgentMetrics {
  agent_id: string;
  name: string | null;
  total_requests: number;
  total_tokens: number;
  total_cost: number;
  avg_latency_ms: number | null;
  last_active: string | null;
  health_score: number;
}

export interface ModelMetrics {
  provider: string;
  model: string;
  request_count: number;
  total_tokens: number;
  total_cost: number;
  avg_latency_ms: number | null;
  tokens_per_second: number | null;
  cost_per_1k_tokens: number | null;
}

export interface HourlyUsage {
  hour: string;
  provider: string;
  model: string;
  request_count: number;
  total_tokens: number;
  total_cost: number;
  avg_latency_ms: number | null;
}

export interface SessionInfo {
  session_id: string;
  agent_id: string | null;
  model: string;
  total_requests: number;
  total_tokens: number;
  total_cost: number;
  created_at: string;
  last_activity: string;
  health_score: number;
  status: 'active' | 'idle' | 'error';
}

export interface ProviderKey {
  id: number;
  provider: string;
  name: string;
  key_prefix: string;
  is_active: boolean;
  is_default: boolean;
  created_at: string;
  updated_at: string;
  expires_at: string | null;
  last_used_at: string | null;
  use_count: number;
  metadata: Record<string, unknown> | null;
}

export interface ProviderKeyCreate {
  provider: string;
  name: string;
  api_key: string;
  is_default?: boolean;
  expires_at?: string;
  metadata?: Record<string, unknown>;
}

export interface ProviderKeyUpdate {
  name?: string;
  is_active?: boolean;
  is_default?: boolean;
  expires_at?: string;
  metadata?: Record<string, unknown>;
}

export interface ProviderKeyLimits {
  current_count: number;
  max_allowed: number | null;
  remaining: number | null;
  can_create: boolean;
}

// ── Organization Types ───────────────────────────────────────────────────────

export interface Organization {
  id: string;
  name: string;
  slug: string;
  plan_tier: 'free' | 'pro' | 'enterprise';
  is_active: boolean;
  max_api_keys: number | null;
  max_provider_keys: number | null;
  max_monthly_tokens: number | null;
  max_monthly_cost: number | null;
  max_users: number | null;
  max_teams: number | null;
  member_count: number;
  created_at: string;
  updated_at: string;
}

export interface OrganizationMember {
  user_id: string;
  email: string;
  display_name: string | null;
  avatar_url: string | null;
  role: 'owner' | 'admin' | 'member' | 'viewer';
  is_active: boolean;
  email_verified: boolean;
  joined_at: string | null;
  last_login_at: string | null;
}

export interface OrganizationInvitation {
  id: string;
  email: string;
  role: 'admin' | 'member' | 'viewer';
  team_ids: string[];
  expires_at: string;
  created_at: string;
}

export interface OrganizationCreate {
  name: string;
  slug?: string;
  plan_tier?: 'free' | 'pro' | 'enterprise';
}

export interface OrganizationUpdate {
  name?: string;
  plan_tier?: 'free' | 'pro' | 'enterprise';
}

export interface MemberInvite {
  email: string;
  role?: 'admin' | 'member' | 'viewer';
  team_ids?: string[];
}

export interface AcceptInvitation {
  token: string;
}

export interface ApiError {
  detail: string;
  status: number;
}

// ── API Client Class ─────────────────────────────────────────────────────────

class TokenSpyApi {
  private baseUrl: string;
  private apiKey: string | null = null;

  constructor(baseUrl: string = API_BASE) {
    this.baseUrl = baseUrl;
  }

  setApiKey(key: string) {
    this.apiKey = key;
  }

  private async request<T>(
    endpoint: string,
    options: RequestInit = {}
  ): Promise<T> {
    const headers: HeadersInit = {
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    };

    if (this.apiKey) {
      headers['Authorization'] = `Bearer ${this.apiKey}`;
    }

    const response = await fetch(`${this.baseUrl}${endpoint}`, {
      ...options,
      headers,
    });

    if (!response.ok) {
      const error: ApiError = {
        detail: response.statusText,
        status: response.status,
      };
      try {
        const body = await response.json();
        error.detail = body.detail || body.message || response.statusText;
      } catch {
        // Use default statusText
      }
      throw error;
    }

    return response.json();
  }

  // ── Endpoints ────────────────────────────────────────────────────────────

  async getOverview(): Promise<OverviewResponse> {
    return this.request<OverviewResponse>('/api/overview');
  }

  async getAgents(days: number = 7): Promise<AgentMetrics[]> {
    return this.request<AgentMetrics[]>(`/api/agents?days=${days}`);
  }

  async getModels(days: number = 7): Promise<ModelMetrics[]> {
    return this.request<ModelMetrics[]>(`/api/models?days=${days}`);
  }

  async getHourlyUsage(hours: number = 24): Promise<HourlyUsage[]> {
    return this.request<HourlyUsage[]>(`/api/usage/hourly?hours=${hours}`);
  }

  async getSessions(
    status?: 'active' | 'idle' | 'error',
    limit: number = 50
  ): Promise<SessionInfo[]> {
    const params = new URLSearchParams({ limit: String(limit) });
    if (status) params.set('status', status);
    return this.request<SessionInfo[]>(`/api/sessions?${params}`);
  }

  async terminateSession(sessionId: string): Promise<void> {
    await this.request(`/api/sessions/${sessionId}/terminate`, {
      method: 'POST',
    });
  }

  async healthCheck(): Promise<{ status: string; version: string }> {
    return this.request('/health');
  }

  // ── Provider Key Management ─────────────────────────────────────────────

  async getProviderKeys(provider?: string): Promise<ProviderKey[]> {
    const params = provider ? `?provider=${encodeURIComponent(provider)}` : '';
    return this.request<ProviderKey[]>(`/api/provider-keys${params}`);
  }

  async getProviderKey(keyId: number): Promise<ProviderKey> {
    return this.request<ProviderKey>(`/api/provider-keys/${keyId}`);
  }

  async createProviderKey(data: ProviderKeyCreate): Promise<ProviderKey> {
    return this.request<ProviderKey>('/api/provider-keys', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async updateProviderKey(keyId: number, data: ProviderKeyUpdate): Promise<ProviderKey> {
    return this.request<ProviderKey>(`/api/provider-keys/${keyId}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    });
  }

  async deleteProviderKey(keyId: number): Promise<{ status: string; key_id: number }> {
    return this.request<{ status: string; key_id: number }>(`/api/provider-keys/${keyId}`, {
      method: 'DELETE',
    });
  }

  async getProviderKeyLimits(): Promise<ProviderKeyLimits> {
    return this.request<ProviderKeyLimits>('/api/provider-keys/limits');
  }

  // ── Organization Management ───────────────────────────────────────────────

  async getOrganizations(): Promise<Organization[]> {
    return this.request<Organization[]>('/api/organizations');
  }

  async getOrganization(orgId: string): Promise<Organization> {
    return this.request<Organization>(`/api/organizations/${orgId}`);
  }

  async createOrganization(data: OrganizationCreate): Promise<Organization> {
    return this.request<Organization>('/api/organizations', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async updateOrganization(orgId: string, data: OrganizationUpdate): Promise<Organization> {
    return this.request<Organization>(`/api/organizations/${orgId}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    });
  }

  async deleteOrganization(orgId: string): Promise<{ status: string; id: string }> {
    return this.request<{ status: string; id: string }>(`/api/organizations/${orgId}`, {
      method: 'DELETE',
    });
  }

  async getOrganizationMembers(orgId: string): Promise<OrganizationMember[]> {
    return this.request<OrganizationMember[]>(`/api/organizations/${orgId}/members`);
  }

  async inviteMember(orgId: string, data: MemberInvite): Promise<{ invitation_id: string; token: string }> {
    return this.request<{ invitation_id: string; token: string }>(`/api/organizations/${orgId}/invite`, {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async updateMemberRole(orgId: string, userId: string, role: OrganizationMember['role']): Promise<OrganizationMember> {
    return this.request<OrganizationMember>(`/api/organizations/${orgId}/members/${userId}/role`, {
      method: 'POST',
      body: JSON.stringify({ role }),
    });
  }

  async removeMember(orgId: string, userId: string): Promise<{ status: string; user_id: string }> {
    return this.request<{ status: string; user_id: string }>(`/api/organizations/${orgId}/members/${userId}`, {
      method: 'DELETE',
    });
  }

  async getInvitations(orgId: string): Promise<OrganizationInvitation[]> {
    return this.request<OrganizationInvitation[]>(`/api/organizations/${orgId}/invitations`);
  }

  async acceptInvitation(token: string): Promise<{ status: string; organization_id: string }> {
    return this.request<{ status: string; organization_id: string }>('/api/invitations/accept', {
      method: 'POST',
      body: JSON.stringify({ token }),
    });
  }
}

// ── Singleton Instance ───────────────────────────────────────────────────────

export const api = new TokenSpyApi();

// ── Helper Functions ─────────────────────────────────────────────────────────

/**
 * Convert time range to hours for API calls
 */
export function timeRangeToHours(range: '1h' | '24h' | '7d' | '30d'): number {
  switch (range) {
    case '1h': return 1;
    case '24h': return 24;
    case '7d': return 168;
    case '30d': return 720;
    default: return 24;
  }
}

/**
 * Convert time range to days for API calls
 */
export function timeRangeToDays(range: '1h' | '24h' | '7d' | '30d'): number {
  switch (range) {
    case '1h': return 1;
    case '24h': return 1;
    case '7d': return 7;
    case '30d': return 30;
    default: return 7;
  }
}

export default api;
