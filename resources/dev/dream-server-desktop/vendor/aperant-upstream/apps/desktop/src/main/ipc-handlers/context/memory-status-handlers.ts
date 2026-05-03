import { ipcMain } from 'electron';
import type { BrowserWindow } from 'electron';
import { IPC_CHANNELS } from '../../../shared/constants';
import type { IPCResult, MemorySystemStatus } from '../../../shared/types';
import { projectStore } from '../../project-store';
import { getMemoryService, getEmbeddingProvider } from './memory-service-factory';

/**
 * Build memory system status by probing the libSQL database and embedding service.
 * Gracefully returns unavailable status if initialization fails.
 */
export async function buildMemoryStatus(): Promise<MemorySystemStatus> {
  try {
    await getMemoryService();
    // If we got a service instance the DB and embedding layer are up
    const embeddingProvider = getEmbeddingProvider() ?? 'unknown';

    return {
      enabled: true,
      available: true,
      embeddingProvider,
      ...(embeddingProvider === 'none' && {
        reason:
          'No embedding provider found. Install Ollama with an embedding model or set OPENAI_API_KEY.',
      }),
    };
  } catch {
    return {
      enabled: false,
      available: false,
      reason: 'Memory service initialization failed',
    };
  }
}

/**
 * Register memory status handlers
 */
export function registerMemoryStatusHandlers(
  _getMainWindow: () => BrowserWindow | null
): void {
  ipcMain.handle(
    IPC_CHANNELS.CONTEXT_MEMORY_STATUS,
    async (_event, _projectId: string): Promise<IPCResult<MemorySystemStatus>> => {
      const project = _projectId ? projectStore.getProject(_projectId) : null;
      if (_projectId && !project) {
        return { success: false, error: 'Project not found' };
      }

      try {
        const memoryStatus = await buildMemoryStatus();
        return { success: true, data: memoryStatus };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to check memory status',
        };
      }
    }
  );
}
