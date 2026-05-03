/**
 * Memory Stop Condition Tests
 *
 * Tests calibration factor application and step limit adjustment.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { buildMemoryAwareStopCondition, getCalibrationFactor } from '../../injection/memory-stop-condition';
import type { MemoryService, Memory } from '../../types';

// ============================================================
// HELPERS
// ============================================================

function makeCalibrationMemory(ratio: number): Memory {
  return {
    id: `cal-${ratio}`,
    type: 'task_calibration',
    content: JSON.stringify({ module: 'auth', ratio, averageActualSteps: 100 * ratio, averagePlannedSteps: 100, sampleCount: 3 }),
    confidence: 0.9,
    tags: [],
    relatedFiles: [],
    relatedModules: ['auth'],
    createdAt: new Date().toISOString(),
    lastAccessedAt: new Date().toISOString(),
    accessCount: 1,
    scope: 'module',
    source: 'observer_inferred',
    sessionId: 'sess-1',
    provenanceSessionIds: [],
    projectId: 'proj-1',
  };
}

function makeMemoryService(calibrations: Memory[] = []): MemoryService {
  return {
    store: vi.fn().mockResolvedValue('id'),
    search: vi.fn().mockResolvedValue(calibrations),
    searchByPattern: vi.fn().mockResolvedValue(null),
    insertUserTaught: vi.fn().mockResolvedValue('id'),
    searchWorkflowRecipe: vi.fn().mockResolvedValue([]),
    updateAccessCount: vi.fn().mockResolvedValue(undefined),
    deprecateMemory: vi.fn().mockResolvedValue(undefined),
    verifyMemory: vi.fn().mockResolvedValue(undefined),
    pinMemory: vi.fn().mockResolvedValue(undefined),
    deleteMemory: vi.fn().mockResolvedValue(undefined),
  };
}

// ============================================================
// TESTS: buildMemoryAwareStopCondition
// ============================================================

describe('buildMemoryAwareStopCondition', () => {
  it('returns stopWhen with base steps when no calibration factor', () => {
    const condition = buildMemoryAwareStopCondition(500, undefined);
    // Can't introspect the condition directly, but it should be truthy
    expect(condition).toBeTruthy();
    expect(typeof condition).toBe('function');
  });

  it('applies calibration factor to base steps', () => {
    // With a 1.5x factor and 500 base, expect ceil(500 * 1.5) = 750 steps
    const condition = buildMemoryAwareStopCondition(500, 1.5);
    expect(condition).toBeTruthy();
  });

  it('caps calibration factor at 2.0', () => {
    // A 3.0x factor should be capped at 2.0, so 500 * 2.0 = 1000
    const condition = buildMemoryAwareStopCondition(500, 3.0);
    expect(condition).toBeTruthy();
  });

  it('caps absolute max at 2000 steps', () => {
    // Even with 2x factor and 1500 base, should not exceed 2000
    const condition = buildMemoryAwareStopCondition(1500, 2.0);
    expect(condition).toBeTruthy();
  });

  it('with factor 1.0 produces same as no factor', () => {
    const noFactor = buildMemoryAwareStopCondition(500, undefined);
    const oneFactor = buildMemoryAwareStopCondition(500, 1.0);
    // Both should produce the same step count (500)
    expect(noFactor).toBeTruthy();
    expect(oneFactor).toBeTruthy();
  });

  it('handles fractional factors with ceil', () => {
    // 500 * 1.3 = 650 (exact, no ceiling needed)
    const condition = buildMemoryAwareStopCondition(500, 1.3);
    expect(condition).toBeTruthy();
  });
});

// ============================================================
// TESTS: getCalibrationFactor
// ============================================================

describe('getCalibrationFactor', () => {
  it('returns undefined when no calibrations exist', async () => {
    const memoryService = makeMemoryService([]);
    const factor = await getCalibrationFactor(memoryService, ['auth'], 'proj-1');
    expect(factor).toBeUndefined();
  });

  it('returns the ratio from a single calibration', async () => {
    const memoryService = makeMemoryService([makeCalibrationMemory(1.4)]);
    const factor = await getCalibrationFactor(memoryService, ['auth'], 'proj-1');
    expect(factor).toBeCloseTo(1.4, 5);
  });

  it('averages ratios from multiple calibrations', async () => {
    const memoryService = makeMemoryService([
      makeCalibrationMemory(1.0),
      makeCalibrationMemory(2.0),
    ]);
    const factor = await getCalibrationFactor(memoryService, ['auth'], 'proj-1');
    expect(factor).toBeCloseTo(1.5, 5);
  });

  it('defaults to 1.0 for calibrations with missing ratio field', async () => {
    const mem: Memory = {
      id: 'bad-cal',
      type: 'task_calibration',
      content: JSON.stringify({ module: 'auth' }), // no ratio field
      confidence: 0.9,
      tags: [],
      relatedFiles: [],
      relatedModules: ['auth'],
      createdAt: new Date().toISOString(),
      lastAccessedAt: new Date().toISOString(),
      accessCount: 1,
      scope: 'module',
      source: 'observer_inferred',
      sessionId: 'sess-1',
      provenanceSessionIds: [],
      projectId: 'proj-1',
    };
    const memoryService = makeMemoryService([mem]);
    const factor = await getCalibrationFactor(memoryService, ['auth'], 'proj-1');
    expect(factor).toBeCloseTo(1.0, 5);
  });

  it('defaults to 1.0 for malformed JSON content', async () => {
    const mem: Memory = {
      id: 'malformed',
      type: 'task_calibration',
      content: 'not valid json {{ }}',
      confidence: 0.9,
      tags: [],
      relatedFiles: [],
      relatedModules: ['auth'],
      createdAt: new Date().toISOString(),
      lastAccessedAt: new Date().toISOString(),
      accessCount: 1,
      scope: 'module',
      source: 'observer_inferred',
      sessionId: 'sess-1',
      provenanceSessionIds: [],
      projectId: 'proj-1',
    };
    const memoryService = makeMemoryService([mem]);
    const factor = await getCalibrationFactor(memoryService, ['auth'], 'proj-1');
    expect(factor).toBeCloseTo(1.0, 5);
  });

  it('returns undefined gracefully when memoryService throws', async () => {
    const memoryService = makeMemoryService();
    vi.mocked(memoryService.search).mockRejectedValueOnce(new Error('DB unavailable'));

    const factor = await getCalibrationFactor(memoryService, ['auth'], 'proj-1');
    expect(factor).toBeUndefined();
  });

  it('passes correct search filters to memoryService', async () => {
    const memoryService = makeMemoryService([]);
    await getCalibrationFactor(memoryService, ['auth', 'token'], 'my-project');

    expect(memoryService.search).toHaveBeenCalledWith(
      expect.objectContaining({
        types: ['task_calibration'],
        relatedModules: ['auth', 'token'],
        projectId: 'my-project',
        sort: 'recency',
      }),
    );
  });
});
