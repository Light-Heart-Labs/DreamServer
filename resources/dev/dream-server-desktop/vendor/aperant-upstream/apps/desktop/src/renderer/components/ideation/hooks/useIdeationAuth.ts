import { useState, useEffect, useRef } from 'react';
import { useSettingsStore } from '../../../stores/settings-store';

/**
 * Hook to check if the ideation feature has valid authentication.
 * Checks that at least one active provider account exists in the unified provider system.
 *
 * @returns { hasToken, isLoading }
 * - hasToken: true if at least one active provider account is configured
 * - isLoading: true while loading provider accounts
 */
export function useIdeationAuth() {
  const providerAccounts = useSettingsStore((state) => state.providerAccounts);
  const loadProviderAccounts = useSettingsStore((state) => state.loadProviderAccounts);

  // Check if provider accounts are loaded (non-empty array means loaded)
  // If empty, attempt to load them once
  const [isLoading, setIsLoading] = useState(false);
  const hasLoadedRef = useRef(false);

  useEffect(() => {
    if (providerAccounts.length === 0 && !hasLoadedRef.current) {
      hasLoadedRef.current = true;
      setIsLoading(true);
      loadProviderAccounts().finally(() => setIsLoading(false));
    }
  }, [providerAccounts.length, loadProviderAccounts]);

  // At least one provider account means auth is available
  // The auth resolver handles scoring/filtering at runtime
  const hasProvider = providerAccounts.length > 0;

  return { hasToken: hasProvider, isLoading };
}
