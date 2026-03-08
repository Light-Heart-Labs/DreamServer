/**
 * Provider Keys Page
 * 
 * Manage provider API keys for Token Spy.
 * Add, edit, delete keys for OpenAI, Anthropic, Google, Moonshot, etc.
 */

import { useState } from 'react';
import { useProviderKeys } from '../hooks/useProviderKeys';
import { ProviderKey, ProviderKeyCreate } from '../lib/api';

const PROVIDER_OPTIONS = [
  { value: 'openai', label: 'OpenAI', color: 'bg-green-500' },
  { value: 'anthropic', label: 'Anthropic', color: 'bg-orange-500' },
  { value: 'google', label: 'Google AI', color: 'bg-blue-500' },
  { value: 'moonshot', label: 'Moonshot AI', color: 'bg-purple-500' },
  { value: 'local', label: 'Local vLLM', color: 'bg-gray-500' },
];

function ProviderBadge({ provider }: { provider: string }) {
  const option = PROVIDER_OPTIONS.find(p => p.value === provider);
  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium text-white ${option?.color || 'bg-gray-500'}`}>
      {option?.label || provider}
    </span>
  );
}

function KeyPrefix({ prefix }: { prefix: string }) {
  return (
    <code className="px-2 py-1 bg-gray-100 rounded text-sm font-mono text-gray-600">
      {prefix}••••••••
    </code>
  );
}

interface KeyRowProps {
  keyData: ProviderKey;
  onEdit: (key: ProviderKey) => void;
  onDelete: (id: number) => void;
  deleting: boolean;
}

function KeyRow({ keyData, onEdit, onDelete, deleting }: KeyRowProps) {
  return (
    <tr className={keyData.is_active ? '' : 'opacity-50'}>
      <td className="px-6 py-4 whitespace-nowrap">
        <ProviderBadge provider={keyData.provider} />
      </td>
      <td className="px-6 py-4 whitespace-nowrap">
        <div className="text-sm font-medium text-gray-900">{keyData.name}</div>
      </td>
      <td className="px-6 py-4 whitespace-nowrap">
        <KeyPrefix prefix={keyData.key_prefix} />
      </td>
      <td className="px-6 py-4 whitespace-nowrap">
        {keyData.is_default && (
          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800">
            Default
          </span>
        )}
        {!keyData.is_active && (
          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-800 ml-2">
            Inactive
          </span>
        )}
      </td>
      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
        {keyData.use_count.toLocaleString()} uses
      </td>
      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
        {keyData.last_used_at
          ? new Date(keyData.last_used_at).toLocaleDateString()
          : 'Never'}
      </td>
      <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
        <button
          onClick={() => onEdit(keyData)}
          className="text-blue-600 hover:text-blue-900 mr-4"
        >
          Edit
        </button>
        <button
          onClick={() => onDelete(keyData.id)}
          disabled={deleting}
          className="text-red-600 hover:text-red-900 disabled:opacity-50"
        >
          {deleting ? 'Deleting...' : 'Delete'}
        </button>
      </td>
    </tr>
  );
}

interface AddKeyModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (data: ProviderKeyCreate) => Promise<void>;
  limits: { current_count: number; max_allowed: number | null; can_create: boolean } | null;
}

function AddKeyModal({ isOpen, onClose, onSubmit, limits }: AddKeyModalProps) {
  const [provider, setProvider] = useState('openai');
  const [name, setName] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [isDefault, setIsDefault] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !apiKey.trim()) return;

    setSubmitting(true);
    setError(null);

    try {
      await onSubmit({
        provider,
        name: name.trim(),
        api_key: apiKey.trim(),
        is_default: isDefault,
      });
      setName('');
      setApiKey('');
      setIsDefault(false);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create key');
    } finally {
      setSubmitting(false);
    }
  };

  const atLimit = limits && limits.max_allowed !== null && limits.current_count >= limits.max_allowed;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl max-w-md w-full mx-4">
        <div className="px-6 py-4 border-b border-gray-200">
          <h2 className="text-lg font-semibold text-gray-900">Add Provider Key</h2>
          {limits && (
            <p className="text-sm text-gray-600 mt-1">
              {limits.current_count} of {limits.max_allowed ?? '∞'} keys used
            </p>
          )}
        </div>

        {atLimit ? (
          <div className="px-6 py-8 text-center">
            <p className="text-red-600 font-medium">Provider key limit reached</p>
            <p className="text-gray-600 text-sm mt-2">
              Upgrade your plan to add more provider keys.
            </p>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="px-6 py-4 space-y-4">
            {error && (
              <div className="p-3 bg-red-50 border border-red-200 rounded text-sm text-red-700">
                {error}
              </div>
            )}

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Provider
              </label>
              <select
                value={provider}
                onChange={(e) => setProvider(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              >
                {PROVIDER_OPTIONS.map(opt => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Key Name
              </label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g., Production OpenAI"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                required
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                API Key
              </label>
              <input
                type="password"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder="sk-..."
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                required
              />
              <p className="text-xs text-gray-500 mt-1">
                Your key will be encrypted and only the first 8 characters shown.
              </p>
            </div>

            <div className="flex items-center">
              <input
                type="checkbox"
                id="isDefault"
                checked={isDefault}
                onChange={(e) => setIsDefault(e.target.checked)}
                className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
              />
              <label htmlFor="isDefault" className="ml-2 text-sm text-gray-700">
                Set as default for this provider
              </label>
            </div>

            <div className="flex gap-3 pt-4">
              <button
                type="button"
                onClick={onClose}
                className="flex-1 px-4 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={submitting || !name.trim() || !apiKey.trim()}
                className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {submitting ? 'Adding...' : 'Add Key'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

interface EditKeyModalProps {
  keyData: ProviderKey | null;
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (id: number, data: { name?: string; is_active?: boolean; is_default?: boolean }) => Promise<void>;
}

function EditKeyModal({ keyData, isOpen, onClose, onSubmit }: EditKeyModalProps) {
  const [name, setName] = useState('');
  const [isActive, setIsActive] = useState(true);
  const [isDefault, setIsDefault] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset form when key changes
  useState(() => {
    if (keyData) {
      setName(keyData.name);
      setIsActive(keyData.is_active);
      setIsDefault(keyData.is_default);
    }
  });

  if (!isOpen || !keyData) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);

    try {
      await onSubmit(keyData.id, {
        name: name.trim() || undefined,
        is_active: isActive,
        is_default: isDefault,
      });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update key');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl max-w-md w-full mx-4">
        <div className="px-6 py-4 border-b border-gray-200">
          <h2 className="text-lg font-semibold text-gray-900">Edit Provider Key</h2>
          <p className="text-sm text-gray-600 mt-1">
            <ProviderBadge provider={keyData.provider} /> {keyData.key_prefix}••••••••
          </p>
        </div>

        <form onSubmit={handleSubmit} className="px-6 py-4 space-y-4">
          {error && (
            <div className="p-3 bg-red-50 border border-red-200 rounded text-sm text-red-700">
              {error}
            </div>
          )}

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Key Name
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              required
            />
          </div>

          <div className="flex items-center">
            <input
              type="checkbox"
              id="editIsActive"
              checked={isActive}
              onChange={(e) => setIsActive(e.target.checked)}
              className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
            />
            <label htmlFor="editIsActive" className="ml-2 text-sm text-gray-700">
              Active
            </label>
          </div>

          <div className="flex items-center">
            <input
              type="checkbox"
              id="editIsDefault"
              checked={isDefault}
              onChange={(e) => setIsDefault(e.target.checked)}
              className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
            />
            <label htmlFor="editIsDefault" className="ml-2 text-sm text-gray-700">
              Set as default for this provider
            </label>
          </div>

          <div className="flex gap-3 pt-4">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 px-4 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
            >
              {submitting ? 'Saving...' : 'Save Changes'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export function ProviderKeysPage() {
  const { keys, limits, loading, error, refresh, createKey, updateKey, deleteKey } = useProviderKeys();
  const [showAddModal, setShowAddModal] = useState(false);
  const [editingKey, setEditingKey] = useState<ProviderKey | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);

  const handleDelete = async (id: number) => {
    if (!confirm('Are you sure you want to delete this key?')) return;
    setDeletingId(id);
    try {
      await deleteKey(id);
    } finally {
      setDeletingId(null);
    }
  };

  const keysByProvider = keys.reduce((acc, key) => {
    if (!acc[key.provider]) acc[key.provider] = [];
    acc[key.provider].push(key);
    return acc;
  }, {} as Record<string, ProviderKey[]>);

  return (
    <div className="max-w-7xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Provider Keys</h2>
          <p className="text-gray-600 mt-1">
            Manage API keys for LLM providers. Keys are encrypted at rest.
          </p>
        </div>
        <div className="flex items-center gap-4">
          {limits && (
            <span className="text-sm text-gray-600">
              {limits.current_count} / {limits.max_allowed ?? '∞'} keys
            </span>
          )}
          <button
            onClick={() => setShowAddModal(true)}
            disabled={limits?.can_create === false}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed font-medium"
          >
            Add Key
          </button>
        </div>
      </div>

      {error && (
        <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg">
          <p className="text-red-700 font-medium">Error loading provider keys</p>
          <p className="text-red-600 text-sm">{error}</p>
          <button
            onClick={refresh}
            className="mt-2 text-sm text-red-700 hover:text-red-900 font-medium"
          >
            Retry
          </button>
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-12">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
          <span className="ml-3 text-gray-600">Loading keys...</span>
        </div>
      ) : keys.length === 0 ? (
        <div className="text-center py-12 bg-white rounded-lg border border-gray-200">
          <p className="text-gray-500 mb-4">No provider keys configured</p>
          <button
            onClick={() => setShowAddModal(true)}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-medium"
          >
            Add Your First Key
          </button>
        </div>
      ) : (
        <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Provider
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Name
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Key
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Status
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Usage
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Last Used
                </th>
                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {keys.map((key) => (
                <KeyRow
                  key={key.id}
                  keyData={key}
                  onEdit={setEditingKey}
                  onDelete={handleDelete}
                  deleting={deletingId === key.id}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}

      <AddKeyModal
        isOpen={showAddModal}
        onClose={() => setShowAddModal(false)}
        onSubmit={createKey}
        limits={limits}
      />

      <EditKeyModal
        keyData={editingKey}
        isOpen={!!editingKey}
        onClose={() => setEditingKey(null)}
        onSubmit={updateKey}
      />
    </div>
  );
}
