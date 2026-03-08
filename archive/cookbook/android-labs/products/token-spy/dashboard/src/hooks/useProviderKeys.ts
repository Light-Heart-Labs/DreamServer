/**
 * Provider Keys Hook
 * 
 * React hooks for managing provider API keys.
 * Includes list, create, update, delete operations.
 */

import { useState, useEffect, useCallback } from 'react';
import { api, ProviderKey, ProviderKeyCreate, ProviderKeyUpdate, ProviderKeyLimits } from '../lib/api';

interface UseProviderKeysResult {
  keys: ProviderKey[];
  limits: ProviderKeyLimits | null;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  createKey: (data: ProviderKeyCreate) => Promise<ProviderKey>;
  updateKey: (id: number, data: ProviderKeyUpdate) => Promise<ProviderKey>;
  deleteKey: (id: number) => Promise<void>;
}

export function useProviderKeys(): UseProviderKeysResult {
  const [keys, setKeys] = useState<ProviderKey[]>([]);
  const [limits, setLimits] = useState<ProviderKeyLimits | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const [keysData, limitsData] = await Promise.all([
        api.getProviderKeys(),
        api.getProviderKeyLimits(),
      ]);
      setKeys(keysData);
      setLimits(limitsData);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch provider keys');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const createKey = useCallback(async (data: ProviderKeyCreate): Promise<ProviderKey> => {
    const newKey = await api.createProviderKey(data);
    setKeys(prev => [...prev, newKey]);
    // Refresh limits after creation
    const newLimits = await api.getProviderKeyLimits();
    setLimits(newLimits);
    return newKey;
  }, []);

  const updateKey = useCallback(async (id: number, data: ProviderKeyUpdate): Promise<ProviderKey> => {
    const updated = await api.updateProviderKey(id, data);
    setKeys(prev => prev.map(k => k.id === id ? updated : k));
    return updated;
  }, []);

  const deleteKey = useCallback(async (id: number): Promise<void> => {
    await api.deleteProviderKey(id);
    setKeys(prev => prev.filter(k => k.id !== id));
    // Refresh limits after deletion
    const newLimits = await api.getProviderKeyLimits();
    setLimits(newLimits);
  }, []);

  return {
    keys,
    limits,
    loading,
    error,
    refresh: fetchData,
    createKey,
    updateKey,
    deleteKey,
  };
}

interface UseProviderKeyResult {
  key: ProviderKey | null;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  update: (data: ProviderKeyUpdate) => Promise<ProviderKey>;
}

export function useProviderKey(keyId: number | null): UseProviderKeyResult {
  const [key, setKey] = useState<ProviderKey | null>(null);
  const [loading, setLoading] = useState(keyId !== null);
  const [error, setError] = useState<string | null>(null);

  const fetchKey = useCallback(async () => {
    if (keyId === null) return;
    
    try {
      setLoading(true);
      setError(null);
      const data = await api.getProviderKey(keyId);
      setKey(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch provider key');
    } finally {
      setLoading(false);
    }
  }, [keyId]);

  useEffect(() => {
    fetchKey();
  }, [fetchKey]);

  const update = useCallback(async (data: ProviderKeyUpdate): Promise<ProviderKey> => {
    if (keyId === null) throw new Error('No key ID');
    const updated = await api.updateProviderKey(keyId, data);
    setKey(updated);
    return updated;
  }, [keyId]);

  return {
    key,
    loading,
    error,
    refresh: fetchKey,
    update,
  };
}
