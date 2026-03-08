/**
 * Organizations Page
 *
 * Manage organizations, team members, and invitations.
 * Supports: create org, invite members, manage roles, view pending invites
 */

import { useState } from 'react';
import { useOrganizations, useOrganizationMembers, useInvitations } from '../hooks/useOrganizations';
import { Organization, OrganizationMember, OrganizationInvitation, OrganizationCreate, MemberInvite } from '../lib/api';

const PLAN_BADGES: Record<string, { label: string; color: string }> = {
  free: { label: 'Free', color: 'bg-gray-100 text-gray-800' },
  pro: { label: 'Pro', color: 'bg-blue-100 text-blue-800' },
  enterprise: { label: 'Enterprise', color: 'bg-purple-100 text-purple-800' },
};

const ROLE_BADGES: Record<string, { label: string; color: string }> = {
  owner: { label: 'Owner', color: 'bg-purple-100 text-purple-800' },
  admin: { label: 'Admin', color: 'bg-blue-100 text-blue-800' },
  member: { label: 'Member', color: 'bg-green-100 text-green-800' },
  viewer: { label: 'Viewer', color: 'bg-gray-100 text-gray-800' },
};

function PlanBadge({ tier }: { tier: string }) {
  const badge = PLAN_BADGES[tier] || PLAN_BADGES.free;
  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${badge.color}`}>
      {badge.label}
    </span>
  );
}

function RoleBadge({ role }: { role: string }) {
  const badge = ROLE_BADGES[role] || ROLE_BADGES.viewer;
  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${badge.color}`}>
      {badge.label}
    </span>
  );
}

function OrgCard({
  org,
  isSelected,
  onSelect,
}: {
  org: Organization;
  isSelected: boolean;
  onSelect: () => void;
}) {
  return (
    <div
      onClick={onSelect}
      className={`p-4 rounded-lg border cursor-pointer transition-colors ${
        isSelected
          ? 'border-blue-500 bg-blue-50'
          : 'border-gray-200 hover:border-gray-300 hover:bg-gray-50'
      }`}
    >
      <div className="flex items-center justify-between">
        <h3 className="font-medium text-gray-900">{org.name}</h3>
        <PlanBadge tier={org.plan_tier} />
      </div>
      <p className="text-sm text-gray-500 mt-1">@{org.slug}</p>
      <div className="flex items-center gap-4 mt-3 text-sm text-gray-600">
        <span>{org.member_count} members</span>
        {org.max_users && <span className="text-gray-400">/ {org.max_users} max</span>}
      </div>
    </div>
  );
}

interface CreateOrgModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (data: OrganizationCreate) => Promise<void>;
  loading: boolean;
}

function CreateOrgModal({ isOpen, onClose, onSubmit, loading }: CreateOrgModalProps) {
  const [name, setName] = useState('');
  const [planTier, setPlanTier] = useState<'free' | 'pro' | 'enterprise'>('free');
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      setError('Organization name is required');
      return;
    }
    setError(null);
    try {
      await onSubmit({ name: name.trim(), plan_tier: planTier });
      setName('');
      setPlanTier('free');
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create organization');
    }
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg p-6 w-full max-w-md">
        <h2 className="text-lg font-medium text-gray-900 mb-4">Create Organization</h2>
        {error && (
          <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded text-red-700 text-sm">{error}</div>
        )}
        <form onSubmit={handleSubmit}>
          <div className="mb-4">
            <label className="block text-sm font-medium text-gray-700 mb-1">Organization Name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="My Team"
              autoFocus
            />
          </div>
          <div className="mb-6">
            <label className="block text-sm font-medium text-gray-700 mb-1">Plan Tier</label>
            <select
              value={planTier}
              onChange={(e) => setPlanTier(e.target.value as 'free' | 'pro' | 'enterprise')}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="free">Free</option>
              <option value="pro">Pro</option>
              <option value="enterprise">Enterprise</option>
            </select>
          </div>
          <div className="flex justify-end gap-3">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-gray-700 hover:text-gray-900"
              disabled={loading}
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading}
              className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50"
            >
              {loading ? 'Creating...' : 'Create'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

interface InviteModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (data: MemberInvite) => Promise<void>;
  loading: boolean;
}

function InviteModal({ isOpen, onClose, onSubmit, loading }: InviteModalProps) {
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<OrganizationMember['role']>('member');
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim() || !email.includes('@')) {
      setError('Valid email is required');
      return;
    }
    setError(null);
    try {
      await onSubmit({ email: email.trim(), role });
      setEmail('');
      setRole('member');
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to send invitation');
    }
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg p-6 w-full max-w-md">
        <h2 className="text-lg font-medium text-gray-900 mb-4">Invite Member</h2>
        {error && (
          <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded text-red-700 text-sm">{error}</div>
        )}
        <form onSubmit={handleSubmit}>
          <div className="mb-4">
            <label className="block text-sm font-medium text-gray-700 mb-1">Email Address</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="colleague@example.com"
              autoFocus
            />
          </div>
          <div className="mb-6">
            <label className="block text-sm font-medium text-gray-700 mb-1">Role</label>
            <select
              value={role}
              onChange={(e) => setRole(e.target.value as OrganizationMember['role'])}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="admin">Admin - Full access except billing</option>
              <option value="member">Member - Can use API keys and view data</option>
              <option value="viewer">Viewer - Read-only access</option>
            </select>
          </div>
          <div className="flex justify-end gap-3">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-gray-700 hover:text-gray-900"
              disabled={loading}
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading}
              className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50"
            >
              {loading ? 'Sending...' : 'Send Invite'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function MemberRow({
  member,
  canManage,
  onRoleChange,
  onRemove,
  updating,
}: {
  member: OrganizationMember;
  canManage: boolean;
  onRoleChange: (userId: string, role: OrganizationMember['role']) => Promise<void>;
  onRemove: (userId: string) => Promise<void>;
  updating: boolean;
}) {
  const [showActions, setShowActions] = useState(false);

  return (
    <tr>
      <td className="px-6 py-4 whitespace-nowrap">
        <div className="flex items-center">
          {member.avatar_url ? (
            <img src={member.avatar_url} alt="" className="h-8 w-8 rounded-full" />
          ) : (
            <div className="h-8 w-8 rounded-full bg-gray-200 flex items-center justify-center text-sm font-medium text-gray-600">
              {member.display_name?.[0] || member.email[0].toUpperCase()}
            </div>
          )}
          <div className="ml-3">
            <div className="text-sm font-medium text-gray-900">
              {member.display_name || member.email}
            </div>
            <div className="text-sm text-gray-500">{member.email}</div>
          </div>
        </div>
      </td>
      <td className="px-6 py-4 whitespace-nowrap">
        <RoleBadge role={member.role} />
      </td>
      <td className="px-6 py-4 whitespace-nowrap">
        <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs ${member.is_active ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-800'}`}>
          {member.is_active ? 'Active' : 'Inactive'}
        </span>
        {!member.email_verified && (
          <span className="ml-2 inline-flex items-center px-2 py-0.5 rounded text-xs bg-yellow-100 text-yellow-800">
            Unverified
          </span>
        )}
      </td>
      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
        {member.joined_at ? new Date(member.joined_at).toLocaleDateString() : '—'}
      </td>
      <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
        {canManage && member.role !== 'owner' && (
          <div className="relative">
            <button
              onClick={() => setShowActions(!showActions)}
              className="text-gray-400 hover:text-gray-600"
            >
              •••
            </button>
            {showActions && (
              <div className="absolute right-0 mt-2 w-48 bg-white border border-gray-200 rounded-md shadow-lg z-10">
                <button
                  onClick={() => {
                    onRoleChange(member.user_id, member.role === 'admin' ? 'member' : 'admin');
                    setShowActions(false);
                  }}
                  disabled={updating}
                  className="block w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-100"
                >
                  Make {member.role === 'admin' ? 'Member' : 'Admin'}
                </button>
                <button
                  onClick={() => {
                    onRemove(member.user_id);
                    setShowActions(false);
                  }}
                  disabled={updating}
                  className="block w-full text-left px-4 py-2 text-sm text-red-600 hover:bg-red-50"
                >
                  Remove
                </button>
              </div>
            )}
          </div>
        )}
      </td>
    </tr>
  );
}

function InvitationRow({ invitation }: { invitation: OrganizationInvitation }) {
  const isExpired = new Date(invitation.expires_at) < new Date();

  return (
    <tr>
      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
        {invitation.email}
      </td>
      <td className="px-6 py-4 whitespace-nowrap">
        <RoleBadge role={invitation.role} />
      </td>
      <td className="px-6 py-4 whitespace-nowrap">
        <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs ${isExpired ? 'bg-red-100 text-red-800' : 'bg-yellow-100 text-yellow-800'}`}>
          {isExpired ? 'Expired' : 'Pending'}
        </span>
      </td>
      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
        {new Date(invitation.expires_at).toLocaleDateString()}
      </td>
    </tr>
  );
}

export default function OrganizationsPage() {
  const [selectedOrgId, setSelectedOrgId] = useState<string | null>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [activeTab, setActiveTab] = useState<'members' | 'invitations'>('members');

  const {
    organizations,
    loading: orgsLoading,
    error: orgsError,
    createOrganization,
    deleteOrganization,
    refresh: refreshOrgs,
  } = useOrganizations();

  const {
    members,
    loading: membersLoading,
    error: membersError,
    refresh: refreshMembers,
    inviteMember,
    updateRole,
    removeMember,
  } = useOrganizationMembers(selectedOrgId);

  const {
    invitations,
    loading: invitesLoading,
    error: invitesError,
    refresh: refreshInvites,
  } = useInvitations(selectedOrgId);

  const selectedOrg = organizations.find((o) => o.id === selectedOrgId);
  const isOwner = selectedOrg ? true : false; // Simplified - would check actual user role

  const handleCreateOrg = async (data: OrganizationCreate) => {
    await createOrganization(data);
  };

  const handleInvite = async (data: MemberInvite) => {
    await inviteMember(data);
    refreshInvites();
  };

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-semibold text-gray-900">Organizations</h1>
        <button
          onClick={() => setShowCreateModal(true)}
          className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700"
        >
          Create Organization
        </button>
      </div>

      {orgsError && (
        <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-md text-red-700">
          {orgsError}
        </div>
      )}

      {orgsLoading ? (
        <div className="text-gray-500">Loading organizations...</div>
      ) : organizations.length === 0 ? (
        <div className="text-center py-12 bg-gray-50 rounded-lg">
          <p className="text-gray-500 mb-4">You&apos;re not a member of any organizations yet.</p>
          <button
            onClick={() => setShowCreateModal(true)}
            className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700"
          >
            Create your first organization
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Organization List */}
          <div className="lg:col-span-1">
            <h2 className="text-sm font-medium text-gray-500 uppercase tracking-wide mb-3">
              Your Organizations
            </h2>
            <div className="space-y-3">
              {organizations.map((org) => (
                <OrgCard
                  key={org.id}
                  org={org}
                  isSelected={org.id === selectedOrgId}
                  onSelect={() => setSelectedOrgId(org.id)}
                />
              ))}
            </div>
          </div>

          {/* Organization Details */}
          <div className="lg:col-span-2">
            {selectedOrg ? (
              <div>
                <div className="flex items-center justify-between mb-4">
                  <div>
                    <h2 className="text-xl font-medium text-gray-900">{selectedOrg.name}</h2>
                    <p className="text-sm text-gray-500">@{selectedOrg.slug}</p>
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={() => setShowInviteModal(true)}
                      className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700"
                    >
                      Invite Member
                    </button>
                  </div>
                </div>

                {/* Tabs */}
                <div className="border-b border-gray-200 mb-4">
                  <nav className="flex gap-6">
                    <button
                      onClick={() => setActiveTab('members')}
                      className={`pb-2 text-sm font-medium border-b-2 ${
                        activeTab === 'members'
                          ? 'border-blue-500 text-blue-600'
                          : 'border-transparent text-gray-500 hover:text-gray-700'
                      }`}
                    >
                      Members ({selectedOrg.member_count})
                    </button>
                    <button
                      onClick={() => setActiveTab('invitations')}
                      className={`pb-2 text-sm font-medium border-b-2 ${
                        activeTab === 'invitations'
                          ? 'border-blue-500 text-blue-600'
                          : 'border-transparent text-gray-500 hover:text-gray-700'
                      }`}
                    >
                      Invitations
                    </button>
                  </nav>
                </div>

                {/* Members Tab */}
                {activeTab === 'members' && (
                  <div>
                    {membersError && (
                      <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded text-red-700 text-sm">
                        {membersError}
                      </div>
                    )}
                    {membersLoading ? (
                      <div className="text-gray-500">Loading members...</div>
                    ) : (
                      <table className="min-w-full divide-y divide-gray-200">
                        <thead>
                          <tr>
                            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                              User
                            </th>
                            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                              Role
                            </th>
                            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                              Status
                            </th>
                            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                              Joined
                            </th>
                            <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                              Actions
                            </th>
                          </tr>
                        </thead>
                        <tbody className="bg-white divide-y divide-gray-200">
                          {members.map((member) => (
                            <MemberRow
                              key={member.user_id}
                              member={member}
                              canManage={isOwner}
                              onRoleChange={updateRole}
                              onRemove={removeMember}
                              updating={false}
                            />
                          ))}
                        </tbody>
                      </table>
                    )}
                  </div>
                )}

                {/* Invitations Tab */}
                {activeTab === 'invitations' && (
                  <div>
                    {invitesError && (
                      <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded text-red-700 text-sm">
                        {invitesError}
                      </div>
                    )}
                    {invitesLoading ? (
                      <div className="text-gray-500">Loading invitations...</div>
                    ) : invitations.length === 0 ? (
                      <div className="text-center py-8 text-gray-500">
                        No pending invitations
                      </div>
                    ) : (
                      <table className="min-w-full divide-y divide-gray-200">
                        <thead>
                          <tr>
                            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                              Email
                            </th>
                            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                              Role
                            </th>
                            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                              Status
                            </th>
                            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                              Expires
                            </th>
                          </tr>
                        </thead>
                        <tbody className="bg-white divide-y divide-gray-200">
                          {invitations.map((invitation) => (
                            <InvitationRow key={invitation.id} invitation={invitation} />
                          ))}
                        </tbody>
                      </table>
                    )}
                  </div>
                )}
              </div>
            ) : (
              <div className="text-center py-12 bg-gray-50 rounded-lg">
                <p className="text-gray-500">Select an organization to view details</p>
              </div>
            )}
          </div>
        </div>
      )}

      <CreateOrgModal
        isOpen={showCreateModal}
        onClose={() => setShowCreateModal(false)}
        onSubmit={handleCreateOrg}
        loading={false}
      />

      <InviteModal
        isOpen={showInviteModal}
        onClose={() => setShowInviteModal(false)}
        onSubmit={handleInvite}
        loading={false}
      />
    </div>
  );
}
