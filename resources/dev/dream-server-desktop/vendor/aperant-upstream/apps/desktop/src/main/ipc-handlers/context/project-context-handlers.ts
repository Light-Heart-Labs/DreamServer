import { ipcMain } from 'electron';
import type { BrowserWindow } from 'electron';
import path from 'path';
import { existsSync, readFileSync } from 'fs';
import { IPC_CHANNELS, AUTO_BUILD_PATHS } from '../../../shared/constants';
import type {
  IPCResult,
  ProjectContextData,
  ProjectIndex,
  RendererMemory,
  MemoryType,
} from '../../../shared/types';
import { projectStore } from '../../project-store';
import { buildMemoryStatus } from './memory-status-handlers';
import { getMemoryService } from './memory-service-factory';
import { runProjectIndexer } from '../../ai/project/project-indexer';
import type { Memory } from '../../ai/memory/types';

// ============================================================
// HELPERS
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

/**
 * Load project index from file
 */
function loadProjectIndex(projectPath: string): ProjectIndex | null {
  const indexPath = path.join(projectPath, AUTO_BUILD_PATHS.PROJECT_INDEX);
  if (!existsSync(indexPath)) {
    return null;
  }

  try {
    const content = readFileSync(indexPath, 'utf-8');
    return JSON.parse(content);
  } catch {
    return null;
  }
}

/**
 * Load recent memories from the MemoryService with graceful degradation.
 */
async function loadRecentMemories(projectId: string): Promise<RendererMemory[]> {
  try {
    const service = await getMemoryService();
    const memories = await service.search({
      projectId,
      limit: 20,
      sort: 'recency',
      excludeDeprecated: true,
    });
    return memories.map(toRendererMemory);
  } catch {
    // Memory service unavailable — return empty list
    return [];
  }
}

// ============================================================
// REGISTER HANDLERS
// ============================================================

/**
 * Register project context handlers
 */
export function registerProjectContextHandlers(
  _getMainWindow: () => BrowserWindow | null
): void {
  // Get full project context
  ipcMain.handle(
    IPC_CHANNELS.CONTEXT_GET,
    async (_, projectId: string): Promise<IPCResult<ProjectContextData>> => {
      const project = projectStore.getProject(projectId);
      if (!project) {
        return { success: false, error: 'Project not found' };
      }

      try {
        // Load project index
        const projectIndex = loadProjectIndex(project.path);

        // Build memory status (libSQL-based)
        const memoryStatus = await buildMemoryStatus();

        // Load recent memories from memory service
        const recentMemories = await loadRecentMemories(projectId);

        return {
          success: true,
          data: {
            projectIndex,
            memoryStatus,
            memoryState: null,
            recentMemories,
            isLoading: false
          }
        };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to load project context'
        };
      }
    }
  );

  // Refresh project index
  ipcMain.handle(
    IPC_CHANNELS.CONTEXT_REFRESH_INDEX,
    async (_, projectId: string): Promise<IPCResult<ProjectIndex>> => {
      const project = projectStore.getProject(projectId);
      if (!project) {
        return { success: false, error: 'Project not found' };
      }

      try {
        const indexOutputPath = path.join(project.path, AUTO_BUILD_PATHS.PROJECT_INDEX);

        // Run the TypeScript project indexer (replaces Python subprocess)
        const projectIndex = runProjectIndexer(project.path, indexOutputPath);

        return { success: true, data: projectIndex };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to refresh project index'
        };
      }
    }
  );
}
