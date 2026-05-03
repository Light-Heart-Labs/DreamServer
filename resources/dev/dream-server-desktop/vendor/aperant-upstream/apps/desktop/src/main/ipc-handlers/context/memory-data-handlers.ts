import { ipcMain } from 'electron';
import type { BrowserWindow } from 'electron';
import { IPC_CHANNELS } from '../../../shared/constants';
import type {
  IPCResult,
  RendererMemory,
  ContextSearchResult,
  MemoryType,
} from '../../../shared/types';
import { projectStore } from '../../project-store';
import { getMemoryService } from './memory-service-factory';
import type { Memory } from '../../ai/memory/types';

// ============================================================
// MAPPING HELPER
// ============================================================

function toRendererMemory(m: Memory): RendererMemory {
  return {
    id: m.id,
    type: m.type as MemoryType,
    content: m.content,
    confidence: m.confidence,
    tags: m.tags,
    relatedFiles: m.relatedFiles,
    relatedModules: m.relatedModules,
    createdAt: m.createdAt,
    lastAccessedAt: m.lastAccessedAt,
    accessCount: m.accessCount,
    scope: m.scope as RendererMemory['scope'],
    source: m.source as RendererMemory['source'],
    needsReview: m.needsReview,
    userVerified: m.userVerified,
    citationText: m.citationText,
    pinned: m.pinned,
    methodology: m.methodology,
    deprecated: m.deprecated,
  };
}

// ============================================================
// REGISTER HANDLERS
// ============================================================

/**
 * Register memory data handlers
 */
export function registerMemoryDataHandlers(
  _getMainWindow: () => BrowserWindow | null
): void {
  // Get all memories (sorted by recency)
  ipcMain.handle(
    IPC_CHANNELS.CONTEXT_GET_MEMORIES,
    async (_, projectId: string, limit: number = 20): Promise<IPCResult<RendererMemory[]>> => {
      const project = projectStore.getProject(projectId);
      if (!project) {
        return { success: false, error: 'Project not found' };
      }

      try {
        const service = await getMemoryService();
        const memories = await service.search({
          projectId,
          limit,
          sort: 'recency',
          excludeDeprecated: true,
        });
        return { success: true, data: memories.map(toRendererMemory) };
      } catch {
        // Graceful degradation: return empty list if memory service is unavailable
        return { success: true, data: [] };
      }
    }
  );

  // Verify a memory (mark as user-verified)
  ipcMain.handle(
    IPC_CHANNELS.CONTEXT_MEMORY_VERIFY,
    async (_, memoryId: string): Promise<IPCResult<void>> => {
      try {
        const service = await getMemoryService();
        await service.verifyMemory(memoryId);
        return { success: true };
      } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : 'Failed to verify memory' };
      }
    }
  );

  // Pin/unpin a memory
  ipcMain.handle(
    IPC_CHANNELS.CONTEXT_MEMORY_PIN,
    async (_, memoryId: string, pinned: boolean): Promise<IPCResult<void>> => {
      try {
        const service = await getMemoryService();
        await service.pinMemory(memoryId, pinned);
        return { success: true };
      } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : 'Failed to pin memory' };
      }
    }
  );

  // Deprecate a memory (soft delete)
  ipcMain.handle(
    IPC_CHANNELS.CONTEXT_MEMORY_DEPRECATE,
    async (_, memoryId: string): Promise<IPCResult<void>> => {
      try {
        const service = await getMemoryService();
        await service.deprecateMemory(memoryId);
        return { success: true };
      } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : 'Failed to deprecate memory' };
      }
    }
  );

  // Delete a memory permanently
  ipcMain.handle(
    IPC_CHANNELS.CONTEXT_MEMORY_DELETE,
    async (_, memoryId: string): Promise<IPCResult<void>> => {
      try {
        const service = await getMemoryService();
        await service.deleteMemory(memoryId);
        return { success: true };
      } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : 'Failed to delete memory' };
      }
    }
  );

  // Search memories
  ipcMain.handle(
    IPC_CHANNELS.CONTEXT_SEARCH_MEMORIES,
    async (_, projectId: string, query: string): Promise<IPCResult<ContextSearchResult[]>> => {
      const project = projectStore.getProject(projectId);
      if (!project) {
        return { success: false, error: 'Project not found' };
      }

      try {
        const service = await getMemoryService();
        const memories = await service.search({
          query,
          projectId,
          limit: 20,
          excludeDeprecated: true,
        });
        return {
          success: true,
          data: memories.map((m) => ({
            content: m.content,
            score: m.confidence,
            type: m.type,
          })),
        };
      } catch {
        // Graceful degradation: return empty list if memory service is unavailable
        return { success: true, data: [] };
      }
    }
  );
}
