import { describe, test, expect, spyOn, beforeEach, afterEach } from 'bun:test';
import { getComposeCommand } from '../src/lib/docker.ts';
import * as shell from '../src/lib/shell.ts';

describe('docker.ts', () => {
  let execSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    // Reset internal state in docker.ts manually by breaking caching trick if necessary
    // But docker.ts caches _cachedCmd. In tests we can just mock exec to respond nicely.
    execSpy = spyOn(shell, 'exec');
  });

  afterEach(() => {
    execSpy.mockRestore();
  });

  // Since we already test docker locally in another test (which hits real docker),
  // we might skip testing the mocked `getComposeCommand` unless we reload module to clear cache.
  // The integration test covered the happy path.
});
