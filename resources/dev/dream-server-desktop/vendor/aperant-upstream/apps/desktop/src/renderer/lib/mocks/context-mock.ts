/**
 * Mock implementation for context and memory operations
 */

export const contextMock = {
  getProjectContext: async () => ({
    success: true,
    data: {
      projectIndex: null,
      memoryStatus: null,
      memoryState: null,
      recentMemories: [],
      isLoading: false
    }
  }),

  refreshProjectIndex: async () => ({
    success: false,
    error: 'Not available in browser mock'
  }),

  getMemoryStatus: async () => ({
    success: true,
    data: {
      enabled: false,
      available: false,
      reason: 'Browser mock environment'
    }
  }),

  searchMemories: async () => ({
    success: true,
    data: []
  }),

  getRecentMemories: async () => ({
    success: true,
    data: []
  }),

  // Memory Management
  verifyMemory: async (_memoryId: string) => ({
    success: true
  }),

  pinMemory: async (_memoryId: string, _pinned: boolean) => ({
    success: true
  }),

  deprecateMemory: async (_memoryId: string) => ({
    success: true
  }),

  deleteMemory: async (_memoryId: string) => ({
    success: true
  })
};
