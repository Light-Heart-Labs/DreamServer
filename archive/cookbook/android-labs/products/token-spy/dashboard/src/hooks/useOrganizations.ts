/**
 * Organizations Hook
 *
 * React hooks for managing organizations, members, and invitations.
 */

import { useState, useEffect, useCallback } from 'react';
import { api, Organization, OrganizationMember, OrganizationInvitation, OrganizationCreate, OrganizationUpdate, MemberInvite } from '../lib/api';

interface UseOrganizationsResult {
  organizations: Organization[];
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  createOrganization: (data: OrganizationCreate) => Promise<Organization>;
  updateOrganization: (id: string, data: OrganizationUpdate) => Promise<Organization>;
  deleteOrganization: (id: string) => Promise<void>;
}

export function useOrganizations(): UseOrganizationsResult {
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await api.getOrganizations();
      setOrganizations(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch organizations');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const createOrganization = useCallback(async (data: OrganizationCreate): Promise<Organization> => {
    const newOrg = await api.createOrganization(data);
    setOrganizations(prev => [...prev, newOrg]);
    return newOrg;
  }, []);

  const updateOrganization = useCallback(async (id: string, data: OrganizationUpdate): Promise<Organization> => {
    const updated = await api.updateOrganization(id, data);
    setOrganizations(prev => prev.map(o => o.id === id ? updated : o));
    return updated;
  }, []);

  const deleteOrganization = useCallback(async (id: string): Promise<void> => {
    await api.deleteOrganization(id);
    setOrganizations(prev => prev.filter(o => o.id !== id));
  }, []);

  return {
    organizations,
    loading,
    error,
    refresh: fetchData,
    createOrganization,
    updateOrganization,
    deleteOrganization,
  };
}

interface UseOrganizationResult {
  organization: Organization | null;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  update: (data: OrganizationUpdate) => Promise<Organization>;
}

export function useOrganization(orgId: string | null): UseOrganizationResult {
  const [organization, setOrganization] = useState<Organization | null>(null);
  const [loading, setLoading] = useState(orgId !== null);
  const [error, setError] = useState<string | null>(null);

  const fetchOrg = useCallback(async () => {
    if (orgId === null) return;

    try {
      setLoading(true);
      setError(null);
      const data = await api.getOrganization(orgId);
      setOrganization(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch organization');
    } finally {
      setLoading(false);
    }
  }, [orgId]);

  useEffect(() => {
    fetchOrg();
  }, [fetchOrg]);

  const update = useCallback(async (data: OrganizationUpdate): Promise<Organization> => {
    if (orgId === null) throw new Error('No organization ID');
    const updated = await api.updateOrganization(orgId, data);
    setOrganization(updated);
    return updated;
  }, [orgId]);

  return {
    organization,
    loading,
    error,
    refresh: fetchOrg,
    update,
  };
}

interface UseOrganizationMembersResult {
  members: OrganizationMember[];
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  inviteMember: (data: MemberInvite) => Promise<{ invitation_id: string; token: string }>;
  updateRole: (userId: string, role: OrganizationMember['role']) => Promise<OrganizationMember>;
  removeMember: (userId: string) => Promise<void>;
}

export function useOrganizationMembers(orgId: string | null): UseOrganizationMembersResult {
  const [members, setMembers] = useState<OrganizationMember[]>([]);
  const [loading, setLoading] = useState(orgId !== null);
  const [error, setError] = useState<string | null>(null);

  const fetchMembers = useCallback(async () => {
    if (orgId === null) return;

    try {
      setLoading(true);
      setError(null);
      const data = await api.getOrganizationMembers(orgId);
      setMembers(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch members');
    } finally {
      setLoading(false);
    }
  }, [orgId]);

  useEffect(() => {
    fetchMembers();
  }, [fetchMembers]);

  const inviteMember = useCallback(async (data: MemberInvite): Promise<{ invitation_id: string; token: string }> => {
    if (orgId === null) throw new Error('No organization ID');
    const result = await api.inviteMember(orgId, data);
    return result;
  }, [orgId]);

  const updateRole = useCallback(async (userId: string, role: OrganizationMember['role']): Promise<OrganizationMember> => {
    if (orgId === null) throw new Error('No organization ID');
    const updated = await api.updateMemberRole(orgId, userId, role);
    setMembers(prev => prev.map(m => m.user_id === userId ? updated : m));
    return updated;
  }, [orgId]);

  const removeMember = useCallback(async (userId: string): Promise<void> => {
    if (orgId === null) throw new Error('No organization ID');
    await api.removeMember(orgId, userId);
    setMembers(prev => prev.filter(m => m.user_id !== userId));
  }, [orgId]);

  return {
    members,
    loading,
    error,
    refresh: fetchMembers,
    inviteMember,
    updateRole,
    removeMember,
  };
}

interface UseInvitationsResult {
  invitations: OrganizationInvitation[];
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

export function useInvitations(orgId: string | null): UseInvitationsResult {
  const [invitations, setInvitations] = useState<OrganizationInvitation[]>([]);
  const [loading, setLoading] = useState(orgId !== null);
  const [error, setError] = useState<string | null>(null);

  const fetchInvitations = useCallback(async () => {
    if (orgId === null) return;

    try {
      setLoading(true);
      setError(null);
      const data = await api.getInvitations(orgId);
      setInvitations(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch invitations');
    } finally {
      setLoading(false);
    }
  }, [orgId]);

  useEffect(() => {
    fetchInvitations();
  }, [fetchInvitations]);

  return {
    invitations,
    loading,
    error,
    refresh: fetchInvitations,
  };
}
