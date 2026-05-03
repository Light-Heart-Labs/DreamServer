/**
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { InsightsConfig } from '../insights/config';

vi.mock('electron', () => ({
  app: {
    getAppPath: () => '/app',
    getPath: () => '/tmp',
    isPackaged: false
  }
}));

vi.mock('../rate-limit-detector', () => ({
  getBestAvailableProfileEnv: () => ({
    env: { CLAUDE_CODE_OAUTH_TOKEN: 'oauth-token' },
    profileId: 'default',
    profileName: 'Default',
    wasSwapped: false
  })
}));

const mockGetApiProfileEnv = vi.fn();
vi.mock('../services/profile', () => ({
  getAPIProfileEnv: (...args: unknown[]) => mockGetApiProfileEnv(...args)
}));

describe('InsightsConfig', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv, TEST_ENV: 'ok' };
    mockGetApiProfileEnv.mockResolvedValue({
      ANTHROPIC_BASE_URL: 'https://api.z.ai',
      ANTHROPIC_AUTH_TOKEN: 'key'
    });
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.clearAllMocks();
    vi.restoreAllMocks();
  });

  it('should build process env with profile settings', async () => {
    const config = new InsightsConfig();
    vi.spyOn(config, 'loadAutoBuildEnv').mockReturnValue({ CUSTOM_ENV: '1' });

    const env = await config.getProcessEnv();

    expect(env.TEST_ENV).toBe('ok');
    expect(env.CUSTOM_ENV).toBe('1');
    expect(env.CLAUDE_CODE_OAUTH_TOKEN).toBe('oauth-token');
    expect(env.ANTHROPIC_BASE_URL).toBe('https://api.z.ai');
    expect(env.ANTHROPIC_AUTH_TOKEN).toBe('key');
  });

  it('should clear ANTHROPIC env vars in OAuth mode when no API profile is set', async () => {
    const config = new InsightsConfig();
    mockGetApiProfileEnv.mockResolvedValue({});
    process.env = {
      ...originalEnv,
      ANTHROPIC_AUTH_TOKEN: 'stale-token',
      ANTHROPIC_BASE_URL: 'https://stale.example'
    };

    const env = await config.getProcessEnv();

    expect(env.ANTHROPIC_AUTH_TOKEN).toBe('');
    expect(env.ANTHROPIC_BASE_URL).toBe('');
  });
});
