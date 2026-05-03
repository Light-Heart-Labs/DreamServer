/**
 * Unit tests for useIdeationAuth hook
 * Tests authentication logic based on the unified provider account system.
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';

// Import the hook to test
import { useIdeationAuth } from '../useIdeationAuth';

// Import the store to set test state
import { useSettingsStore } from '../../../../stores/settings-store';

// Mock loadProviderAccounts so we control when it resolves
const mockLoadProviderAccounts = vi.fn();

vi.mock('../../../../stores/settings-store', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../stores/settings-store')>();
  return {
    ...actual,
    useSettingsStore: vi.fn(),
  };
});

describe('useIdeationAuth', () => {
  let providerAccounts: { id: string; isActive: boolean }[];

  beforeEach(() => {
    vi.clearAllMocks();
    providerAccounts = [];
    mockLoadProviderAccounts.mockResolvedValue(undefined);

    (useSettingsStore as unknown as ReturnType<typeof vi.fn>).mockImplementation(
      (selector: (state: { providerAccounts: typeof providerAccounts; loadProviderAccounts: typeof mockLoadProviderAccounts }) => unknown) =>
        selector({ providerAccounts, loadProviderAccounts: mockLoadProviderAccounts })
    );
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('initial state', () => {
    it('should return hasToken false and isLoading true when no accounts are loaded yet', () => {
      const { result } = renderHook(() => useIdeationAuth());

      // No active accounts → hasToken false
      expect(result.current.hasToken).toBe(false);
      // isLoading starts true because load is triggered
      expect(result.current.isLoading).toBe(true);
    });

    it('should call loadProviderAccounts once when accounts array is empty', async () => {
      renderHook(() => useIdeationAuth());

      await waitFor(() => {
        expect(mockLoadProviderAccounts).toHaveBeenCalledTimes(1);
      });
    });

    it('should not call loadProviderAccounts again if already populated', async () => {
      providerAccounts = [{ id: 'acc-1', isActive: true }];

      renderHook(() => useIdeationAuth());

      // Give time for any potential extra calls
      await waitFor(() => {
        expect(mockLoadProviderAccounts).not.toHaveBeenCalled();
      });
    });
  });

  describe('hasToken based on active provider accounts', () => {
    it('should return hasToken true when at least one account is active', async () => {
      providerAccounts = [{ id: 'acc-1', isActive: true }];

      const { result } = renderHook(() => useIdeationAuth());

      expect(result.current.hasToken).toBe(true);
    });

    it('should return hasToken true when accounts exist (auth resolver handles filtering)', () => {
      providerAccounts = [{ id: 'acc-1', isActive: false }];

      const { result } = renderHook(() => useIdeationAuth());

      // Any account present means the provider system can resolve auth
      expect(result.current.hasToken).toBe(true);
    });

    it('should return hasToken false when no accounts exist', () => {
      providerAccounts = [];

      const { result } = renderHook(() => useIdeationAuth());

      expect(result.current.hasToken).toBe(false);
    });

    it('should return hasToken true when multiple accounts exist and one is active', () => {
      providerAccounts = [
        { id: 'acc-1', isActive: false },
        { id: 'acc-2', isActive: true },
        { id: 'acc-3', isActive: false },
      ];

      const { result } = renderHook(() => useIdeationAuth());

      expect(result.current.hasToken).toBe(true);
    });
  });

  describe('loading state', () => {
    it('should set isLoading to false after loadProviderAccounts resolves', async () => {
      let resolveLoad!: () => void;
      mockLoadProviderAccounts.mockReturnValue(
        new Promise<void>(resolve => { resolveLoad = resolve; })
      );

      const { result } = renderHook(() => useIdeationAuth());

      expect(result.current.isLoading).toBe(true);

      act(() => { resolveLoad(); });

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });
    });

    it('should not enter loading state when accounts are already populated', () => {
      providerAccounts = [{ id: 'acc-1', isActive: true }];

      const { result } = renderHook(() => useIdeationAuth());

      // isLoading starts false because no load is triggered
      expect(result.current.isLoading).toBe(false);
    });
  });
});
