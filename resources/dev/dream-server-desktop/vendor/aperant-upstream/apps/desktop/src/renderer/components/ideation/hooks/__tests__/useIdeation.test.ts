/**
 * Unit tests for useIdeation hook
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import type {
  IdeationConfig,
  IdeationGenerationStatus,
  IdeationType
} from '../../../../../shared/types';
import { useIdeation } from '../useIdeation';

const mockGenerateIdeation = vi.hoisted(() => vi.fn());
const mockRefreshIdeation = vi.hoisted(() => vi.fn());
const mockAppendIdeation = vi.hoisted(() => vi.fn());
const mockLoadIdeation = vi.hoisted(() => vi.fn());
const mockSetupListeners = vi.hoisted(() => vi.fn(() => () => {}));
const mockAuthState = vi.hoisted(() => ({
  hasToken: true as boolean | null,
  isLoading: false,
}));
const mockToast = vi.hoisted(() => vi.fn());

vi.mock('../useIdeationAuth', () => ({
  useIdeationAuth: () => mockAuthState
}));

vi.mock('../../../../hooks/use-toast', () => ({
  toast: mockToast
}));

vi.mock('../../../../stores/task-store', () => ({
  loadTasks: vi.fn()
}));

vi.mock('../../../../stores/ideation-store', () => {
  const state = {
    session: null,
    generationStatus: {} as IdeationGenerationStatus,
    isGenerating: false,
    config: {
      enabledTypes: [],
      includeRoadmapContext: false,
      includeKanbanContext: false,
      maxIdeasPerType: 3
    } as IdeationConfig,
    logs: [],
    typeStates: {},
    selectedIds: new Set()
  };

  return {
    useIdeationStore: (selector: (s: typeof state) => unknown) => selector(state),
    loadIdeation: mockLoadIdeation,
    generateIdeation: mockGenerateIdeation,
    refreshIdeation: mockRefreshIdeation,
    stopIdeation: vi.fn(),
    appendIdeation: mockAppendIdeation,
    dismissAllIdeasForProject: vi.fn(),
    deleteMultipleIdeasForProject: vi.fn(),
    getIdeasByType: vi.fn(() => []),
    getActiveIdeas: vi.fn(() => []),
    getArchivedIdeas: vi.fn(() => []),
    getIdeationSummary: vi.fn(() => ({ totalIdeas: 0, byType: {}, byStatus: {} })),
    setupIdeationListeners: mockSetupListeners
  };
});

describe('useIdeation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should set up and clean up listeners on unmount', () => {
    const cleanupFn = vi.fn();
    mockSetupListeners.mockReturnValueOnce(cleanupFn);

    const { unmount } = renderHook(() => useIdeation('project-1'));

    expect(mockLoadIdeation).toHaveBeenCalledWith('project-1');

    unmount();

    expect(cleanupFn).toHaveBeenCalled();
  });

  it('should show a toast and not generate when no provider is configured', () => {
    mockAuthState.hasToken = false;
    mockAuthState.isLoading = false;

    const { result } = renderHook(() => useIdeation('project-1'));

    act(() => {
      result.current.handleGenerate();
    });

    expect(mockToast).toHaveBeenCalledWith(
      expect.objectContaining({ variant: 'destructive' })
    );
    expect(mockGenerateIdeation).not.toHaveBeenCalled();
  });

  it('should generate when provider is configured', () => {
    mockAuthState.hasToken = true;
    mockAuthState.isLoading = false;

    const { result } = renderHook(() => useIdeation('project-1'));

    act(() => {
      result.current.handleGenerate();
    });

    expect(mockToast).not.toHaveBeenCalled();
    expect(mockGenerateIdeation).toHaveBeenCalledWith('project-1');
  });

  it('should show a toast and not refresh when no provider is configured', () => {
    mockAuthState.hasToken = false;
    mockAuthState.isLoading = false;

    const { result } = renderHook(() => useIdeation('project-1'));

    act(() => {
      result.current.handleRefresh();
    });

    expect(mockToast).toHaveBeenCalledWith(
      expect.objectContaining({ variant: 'destructive' })
    );
    expect(mockRefreshIdeation).not.toHaveBeenCalled();
  });

  it('should refresh when provider is configured', () => {
    mockAuthState.hasToken = true;
    mockAuthState.isLoading = false;

    const { result } = renderHook(() => useIdeation('project-1'));

    act(() => {
      result.current.handleRefresh();
    });

    expect(mockToast).not.toHaveBeenCalled();
    expect(mockRefreshIdeation).toHaveBeenCalledWith('project-1');
  });

  it('should show a toast and not append ideas when no provider is configured', () => {
    mockAuthState.hasToken = false;
    mockAuthState.isLoading = false;

    const { result } = renderHook(() => useIdeation('project-1'));
    const typesToAdd = ['code_improvements'] as IdeationType[];

    act(() => {
      result.current.setTypesToAdd(typesToAdd);
    });

    act(() => {
      result.current.handleAddMoreIdeas();
    });

    expect(mockToast).toHaveBeenCalledWith(
      expect.objectContaining({ variant: 'destructive' })
    );
    expect(mockAppendIdeation).not.toHaveBeenCalled();
  });

  it('should append ideas when provider is configured', () => {
    mockAuthState.hasToken = true;
    mockAuthState.isLoading = false;

    const { result } = renderHook(() => useIdeation('project-1'));
    const typesToAdd = ['code_improvements'] as IdeationType[];

    act(() => {
      result.current.setTypesToAdd(typesToAdd);
    });

    act(() => {
      result.current.handleAddMoreIdeas();
    });

    expect(mockToast).not.toHaveBeenCalled();
    expect(mockAppendIdeation).toHaveBeenCalledWith('project-1', typesToAdd);
    expect(result.current.typesToAdd).toHaveLength(0);
  });

  it('should not expose showEnvConfigModal or handleEnvConfigured in return value', () => {
    const { result } = renderHook(() => useIdeation('project-1'));

    expect('showEnvConfigModal' in result.current).toBe(false);
    expect('handleEnvConfigured' in result.current).toBe(false);
    expect('setShowEnvConfigModal' in result.current).toBe(false);
  });
});
