import { describe, test, expect } from 'bun:test';
import { classifyTier, detectRam, detectDisk, detectGpu } from '../src/phases/detection.ts';
import { resolveComposeFiles } from '../src/phases/configure.ts';
import { createDefaultContext, TIER_MAP, FEATURE_PRESETS, type InstallContext } from '../src/lib/config.ts';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// ── Tier Classification Tests ───────────────────────────────────────────────

describe('classifyTier', () => {
  test('GPU ≥90GB → NV_ULTRA', () => {
    expect(classifyTier({ backend: 'nvidia', name: 'A100', vramMB: 92000, count: 1 }, 128)).toBe('NV_ULTRA');
  });

  test('dual GPU → Tier 4', () => {
    expect(classifyTier({ backend: 'nvidia', name: 'RTX 4090', vramMB: 24000, count: 2 }, 128)).toBe('4');
  });

  test('single GPU ≥40GB → Tier 4', () => {
    expect(classifyTier({ backend: 'nvidia', name: 'A6000', vramMB: 48000, count: 1 }, 64)).toBe('4');
  });

  test('24GB GPU → Tier 3', () => {
    expect(classifyTier({ backend: 'nvidia', name: 'RTX 3090', vramMB: 24576, count: 1 }, 128)).toBe('3');
  });

  test('12GB GPU → Tier 2', () => {
    expect(classifyTier({ backend: 'nvidia', name: 'RTX 4070', vramMB: 12288, count: 1 }, 32)).toBe('2');
  });

  test('8GB GPU → Tier 1', () => {
    expect(classifyTier({ backend: 'nvidia', name: 'RTX 3060', vramMB: 8192, count: 1 }, 16)).toBe('1');
  });

  test('no GPU, low RAM → Tier 1', () => {
    expect(classifyTier({ backend: 'cpu', name: 'None', vramMB: 0, count: 0 }, 16)).toBe('1');
  });

  test('no GPU, high RAM (96GB) → Tier 3', () => {
    expect(classifyTier({ backend: 'cpu', name: 'None', vramMB: 0, count: 0 }, 96)).toBe('3');
  });

  test('no GPU, 48GB RAM → Tier 2', () => {
    expect(classifyTier({ backend: 'cpu', name: 'None', vramMB: 0, count: 0 }, 48)).toBe('2');
  });
});

// ── Tier Map Validity ───────────────────────────────────────────────────────

describe('TIER_MAP', () => {
  test('all tiers have required fields', () => {
    for (const [tier, config] of Object.entries(TIER_MAP)) {
      expect(config.name).toBeTruthy();
      expect(config.model).toBeTruthy();
      expect(config.speed).toBeGreaterThan(0);
      expect(config.minRam).toBeGreaterThan(0);
      expect(config.minDisk).toBeGreaterThan(0);
    }
  });

  test('tiers 1-4 exist', () => {
    expect(TIER_MAP['1']).toBeDefined();
    expect(TIER_MAP['2']).toBeDefined();
    expect(TIER_MAP['3']).toBeDefined();
    expect(TIER_MAP['4']).toBeDefined();
  });

  test('disk requirements increase with tier', () => {
    expect(TIER_MAP['1'].minDisk).toBeLessThan(TIER_MAP['2'].minDisk);
    expect(TIER_MAP['2'].minDisk).toBeLessThan(TIER_MAP['3'].minDisk);
    expect(TIER_MAP['3'].minDisk).toBeLessThan(TIER_MAP['4'].minDisk);
  });
});

// ── Feature Presets ─────────────────────────────────────────────────────────

describe('FEATURE_PRESETS', () => {
  test('full preset enables everything', () => {
    const full = FEATURE_PRESETS.full;
    expect(full.voice).toBe(true);
    expect(full.workflows).toBe(true);
    expect(full.rag).toBe(true);
    expect(full.openclaw).toBe(true);
  });

  test('core preset disables everything', () => {
    const core = FEATURE_PRESETS.core;
    expect(core.voice).toBe(false);
    expect(core.workflows).toBe(false);
    expect(core.rag).toBe(false);
    expect(core.openclaw).toBe(false);
  });
});

// ── Default Context ─────────────────────────────────────────────────────────

describe('createDefaultContext', () => {
  test('returns valid defaults', () => {
    const ctx = createDefaultContext();
    expect(ctx.interactive).toBe(true);
    expect(ctx.dryRun).toBe(false);
    expect(ctx.force).toBe(false);
    expect(ctx.gpu.backend).toBe('cpu');
    expect(ctx.features.voice).toBe(true); // full stack by default
  });

  test('returns independent copies', () => {
    const a = createDefaultContext();
    const b = createDefaultContext();
    a.features.voice = false;
    expect(b.features.voice).toBe(true); // b unaffected
  });
});

// ── Compose File Resolution ─────────────────────────────────────────────────

describe('resolveComposeFiles', () => {
  let tmpDir: string;

  function setup(files: string[]): InstallContext {
    tmpDir = mkdtempSync(join(tmpdir(), 'dream-test-'));
    for (const f of files) {
      const full = join(tmpDir, f);
      mkdirSync(join(full, '..'), { recursive: true });
      writeFileSync(full, 'version: "3"');
    }
    const ctx = createDefaultContext();
    ctx.installDir = tmpDir;
    return ctx;
  }

  function teardown() {
    if (tmpDir) rmSync(tmpDir, { recursive: true, force: true });
  }

  test('finds standalone docker-compose.yml', () => {
    const ctx = setup(['docker-compose.yml']);
    const files = resolveComposeFiles(ctx);
    expect(files.length).toBe(1);
    expect(files[0]).toContain('docker-compose.yml');
    teardown();
  });

  test('prefers base.yml over standalone', () => {
    const ctx = setup(['docker-compose.base.yml', 'docker-compose.yml']);
    const files = resolveComposeFiles(ctx);
    expect(files[0]).toContain('docker-compose.base.yml');
    teardown();
  });

  test('adds nvidia overlay for nvidia GPUs', () => {
    const ctx = setup(['docker-compose.base.yml', 'docker-compose.nvidia.yml']);
    ctx.gpu.backend = 'nvidia';
    const files = resolveComposeFiles(ctx);
    expect(files.length).toBe(2);
    expect(files[1]).toContain('docker-compose.nvidia.yml');
    teardown();
  });

  test('adds amd overlay for amd GPUs', () => {
    const ctx = setup(['docker-compose.base.yml', 'docker-compose.amd.yml']);
    ctx.gpu.backend = 'amd';
    const files = resolveComposeFiles(ctx);
    expect(files.length).toBe(2);
    expect(files[1]).toContain('docker-compose.amd.yml');
    teardown();
  });

  test('includes extension compose files', () => {
    const ctx = setup([
      'docker-compose.base.yml',
      'extensions/services/token-spy/compose.yaml',
      'extensions/services/n8n/compose.yaml',
    ]);
    ctx.features.workflows = true;
    const files = resolveComposeFiles(ctx);
    expect(files.length).toBe(3); // base + token-spy + n8n
    teardown();
  });

  test('excludes n8n extension when workflows disabled', () => {
    const ctx = setup([
      'docker-compose.base.yml',
      'extensions/services/token-spy/compose.yaml',
      'extensions/services/n8n/compose.yaml',
    ]);
    ctx.features.workflows = false;
    const files = resolveComposeFiles(ctx);
    expect(files.length).toBe(2); // base + token-spy (n8n excluded)
    expect(files.some((f) => f.includes('n8n'))).toBe(false);
    teardown();
  });
});

// ── System Detection (integration tests — run on real hardware) ─────────────

describe('detectRam', () => {
  test('returns non-zero on linux', async () => {
    if (process.platform !== 'linux') return;
    const ram = await detectRam();
    expect(ram).toBeGreaterThan(0);
  });
});

describe('detectDisk', () => {
  test('returns non-zero on linux', async () => {
    if (process.platform !== 'linux') return;
    const disk = await detectDisk();
    expect(disk).toBeGreaterThan(0);
  });
});

describe('detectGpu', () => {
  test('returns valid structure even without GPU', async () => {
    const gpu = await detectGpu();
    expect(gpu).toHaveProperty('backend');
    expect(gpu).toHaveProperty('name');
    expect(gpu).toHaveProperty('vramMB');
    expect(gpu).toHaveProperty('count');
    expect(typeof gpu.vramMB).toBe('number');
  });
});
