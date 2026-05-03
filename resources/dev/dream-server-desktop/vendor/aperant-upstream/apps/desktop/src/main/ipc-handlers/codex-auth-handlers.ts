import { ipcMain } from 'electron';
import { startCodexOAuthFlow, getCodexAuthState, clearCodexAuth } from '../ai/auth/codex-oauth';

export function registerCodexAuthHandlers(): void {
  ipcMain.handle('codex-auth-login', async () => {
    try {
      const result = await startCodexOAuthFlow();
      return { success: true, data: result };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  ipcMain.handle('codex-auth-status', async () => {
    try {
      const state = await getCodexAuthState();
      return { success: true, data: state };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  ipcMain.handle('codex-auth-logout', async () => {
    try {
      await clearCodexAuth();
      return { success: true };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });
}
