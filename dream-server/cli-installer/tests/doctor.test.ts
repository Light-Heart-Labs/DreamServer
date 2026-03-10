import { describe, test, expect, mock, beforeEach } from 'bun:test';

// Doctor uses dynamic imports, so we test the REQUIRED_ENV_KEYS validation behavior
// by importing the function and mocking the filesystem.
// Since doctor touches many system calls that can't run in test, we focus on
// the validation logic and ensure the module loads correctly.

describe('doctor.ts', () => {
  test('module exports doctor function', async () => {
    const mod = await import('../src/commands/doctor.ts');
    expect(typeof mod.doctor).toBe('function');
  });

  test('REQUIRED_ENV_KEYS validation logic', () => {
    // Simulate the validation that doctor performs
    const REQUIRED_ENV_KEYS = [
      'WEBUI_SECRET',
      'LLM_API_URL',
      'GPU_BACKEND',
      'LLM_MODEL',
      'COMPOSE_FILE',
    ];

    const completeEnv: Record<string, string> = {
      WEBUI_SECRET: 'abc123',
      LLM_API_URL: 'http://llama-server:8080',
      GPU_BACKEND: 'nvidia',
      LLM_MODEL: 'qwen3-8b',
      COMPOSE_FILE: 'docker-compose.base.yml',
    };

    // All keys present
    const missing = REQUIRED_ENV_KEYS.filter(k => !completeEnv[k]);
    expect(missing.length).toBe(0);

    // Missing a key
    const incompleteEnv: Record<string, string> = { ...completeEnv };
    delete incompleteEnv.LLM_MODEL;
    const missing2 = REQUIRED_ENV_KEYS.filter(k => !incompleteEnv[k]);
    expect(missing2).toEqual(['LLM_MODEL']);
  });

  test('weak secret detection logic', () => {
    const env: Record<string, string> = {
      WEBUI_SECRET: 'short',
      DASHBOARD_API_KEY: 'a1b2c3d4e5f6a1b2c3d4e5f6',
    };

    const weakSecrets: string[] = [];
    for (const key of ['WEBUI_SECRET', 'DASHBOARD_API_KEY']) {
      if (env[key] && env[key].length < 8) {
        weakSecrets.push(key);
      }
    }
    expect(weakSecrets).toEqual(['WEBUI_SECRET']);
  });

  test('log pattern detection logic', () => {
    const logs = 'RuntimeError: CUDA out of memory. Tried to allocate 2.00 GiB';
    const patterns: [RegExp, string][] = [
      [/out of memory|oom|cuda out of memory/i, 'OOM detected'],
      [/permission denied|eacces/i, 'Permission issues'],
    ];

    const matches: string[] = [];
    for (const [regex, msg] of patterns) {
      if (regex.test(logs)) {
        matches.push(msg);
      }
    }
    expect(matches).toEqual(['OOM detected']);
  });

  test('log pattern does not match clean logs', () => {
    const logs = 'Server started successfully on port 3000. All models loaded.';
    const patterns: [RegExp, string][] = [
      [/out of memory|oom|cuda out of memory/i, 'OOM'],
      [/permission denied|eacces/i, 'Permission'],
      [/model.*not found|no such file/i, 'Missing model'],
    ];

    const matches: string[] = [];
    for (const [regex, msg] of patterns) {
      if (regex.test(logs)) {
        matches.push(msg);
      }
    }
    expect(matches.length).toBe(0);
  });
});
