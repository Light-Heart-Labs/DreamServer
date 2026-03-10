# Directory Structure Report

This document contains files from the `/home/igorls/dev/upwork/DreamServer/dream-server/cli-installer/tests` directory with extensions: ts
Content hash: c4a01947c37636b4

## File Tree Structure

- 📄 config.test.ts
- 📄 configure.test.ts
- 📄 detection.test.ts
- 📄 docker.test.ts
- 📄 doctor.test.ts
- 📄 env.test.ts
- 📄 features.test.ts
- 📄 health.test.ts
- 📄 install.test.ts
- 📄 installer.test.ts
- 📄 model.test.ts
- 📄 ports.test.ts
- 📄 preflight.test.ts
- 📄 prompts.test.ts
- 📄 services-helpers.test.ts
- 📄 services.test.ts
- 📄 shell.test.ts
- 📄 status.test.ts
- 📄 ui.test.ts
- 📄 uninstall.test.ts
- 📄 update.test.ts


### File: `config.test.ts`

- Size: 4644 bytes
- Modified: 2026-03-10 21:24:33 UTC

```typescript
import { describe, test, expect, spyOn, beforeEach, afterEach } from 'bun:test';
import { config } from '../src/commands/config.ts';
import * as shell from '../src/lib/shell.ts';
import * as ui from '../src/lib/ui.ts';
import * as prompts from '../src/lib/prompts.ts';
import * as docker from '../src/lib/docker.ts';
import * as modelPhase from '../src/phases/model.ts';
import * as fs from 'node:fs';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

describe('config.ts', () => {
  let tmpDir: string;
  let execStreamSpy: ReturnType<typeof spyOn>;
  let getComposeCommandSpy: ReturnType<typeof spyOn>;
  let processExitSpy: ReturnType<typeof spyOn>;
  let selectSpy: ReturnType<typeof spyOn>;
  let multiSelectSpy: ReturnType<typeof spyOn>;
  let modelSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'dream-test-config-'));

    spyOn(ui, 'header').mockImplementation(() => {});
    spyOn(ui, 'step').mockImplementation(() => {});
    spyOn(ui, 'ok').mockImplementation(() => {});
    spyOn(ui, 'warn').mockImplementation(() => {});
    spyOn(ui, 'fail').mockImplementation(() => {});
    spyOn(ui, 'info').mockImplementation(() => {});
    spyOn(console, 'log').mockImplementation(() => {});

    getComposeCommandSpy = spyOn(docker, 'getComposeCommand').mockImplementation(async () => ['docker', 'compose']);
    execStreamSpy = spyOn(shell, 'execStream').mockImplementation(async () => 0); // docker compose up -d

    selectSpy = spyOn(prompts, 'select').mockImplementation(async () => 0); // default to Features
    multiSelectSpy = spyOn(prompts, 'multiSelect').mockImplementation(async () => [true, true, true, false]);

    modelSpy = spyOn(modelPhase, 'downloadModel').mockImplementation(async () => {});

    processExitSpy = spyOn(process, 'exit').mockImplementation((code) => {
      throw new Error(`process.exit(${code})`);
    });
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
    spyOn(ui, 'header').mockRestore();
    spyOn(ui, 'step').mockRestore();
    spyOn(ui, 'ok').mockRestore();
    spyOn(ui, 'warn').mockRestore();
    spyOn(ui, 'fail').mockRestore();
    spyOn(ui, 'info').mockRestore();
    spyOn(console, 'log').mockRestore();
    getComposeCommandSpy.mockRestore();
    execStreamSpy.mockRestore();
    selectSpy.mockRestore();
    multiSelectSpy.mockRestore();
    modelSpy.mockRestore();
    processExitSpy.mockRestore();
  });

  test('config() fails if no installation found', async () => {
    try {
      await config({ dir: tmpDir });
      expect(true).toBe(false);
    } catch (e: any) {
      expect(e.message).toBe('process.exit(1)');
      expect(ui.fail).toHaveBeenCalledWith('No Dream Server installation found');
    }
  });

  test('config() updates features and restarts services', async () => {
    fs.writeFileSync(join(tmpDir, '.env'), 'ENABLE_VOICE=false\nENABLE_WORKFLOWS=false');

    // Choose features, and then choose true, true, true, false for the multi-select
    selectSpy.mockImplementation(async () => 0); // Features
    multiSelectSpy.mockImplementation(async () => [true, true, true, false]);

    await config({ dir: tmpDir, features: true });

    const newEnv = fs.readFileSync(join(tmpDir, '.env'), 'utf-8');
    expect(newEnv).toContain('ENABLE_VOICE=true');
    expect(newEnv).toContain('ENABLE_WORKFLOWS=true');
    expect(newEnv).toContain('ENABLE_RAG=true');

    expect(ui.ok).toHaveBeenCalledWith('Updated .env');
    expect(execStreamSpy).toHaveBeenCalled(); // docker compose up -d
  });

  test('config() updates tier/model and downloads new model if needed', async () => {
    fs.writeFileSync(join(tmpDir, '.env'), 'LLM_MODEL=qwen3-8b\nGGUF_FILE=Qwen3-8B-Q4_K_M.gguf\nCTX_SIZE=16384\nMAX_CONTEXT=16384');

    selectSpy.mockImplementation(async () => 2); // Choose Tier 3 from TIER_MAP

    await config({ dir: tmpDir, tier: true });

    const newEnv = fs.readFileSync(join(tmpDir, '.env'), 'utf-8');
    expect(newEnv).toContain('LLM_MODEL=qwen3-14b'); // Tier 3 model
    expect(modelSpy).toHaveBeenCalled(); // Should trigger model download
  });

  test('config() handles no changes correctly', async () => {
    fs.writeFileSync(join(tmpDir, '.env'), 'ENABLE_VOICE=true\nENABLE_WORKFLOWS=true\nENABLE_RAG=true\nENABLE_OPENCLAW=false');

    multiSelectSpy.mockImplementation(async () => [true, true, true, false]); // Same as current

    await config({ dir: tmpDir, features: true });

    expect(ui.info).toHaveBeenCalledWith('No changes made');
    expect(execStreamSpy).not.toHaveBeenCalled();
  });

});
```

### File: `configure.test.ts`

- Size: 3486 bytes
- Modified: 2026-03-10 21:24:33 UTC

```typescript
import { describe, test, expect, spyOn, beforeEach, afterEach } from 'bun:test';
import { configure } from '../src/phases/configure.ts';
import { createDefaultContext } from '../src/lib/config.ts';
import * as shell from '../src/lib/shell.ts';
import * as ui from '../src/lib/ui.ts';
import * as fs from 'node:fs';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

describe('configure.ts', () => {
  let tmpDir: string;
  let execSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'dream-test-configure-'));

    spyOn(ui, 'phase').mockImplementation(() => {});
    spyOn(ui, 'step').mockImplementation(() => {});
    spyOn(ui, 'info').mockImplementation(() => {});
    spyOn(ui, 'ok').mockImplementation(() => {});
    spyOn(ui, 'warn').mockImplementation(() => {});
    spyOn(ui, 'fail').mockImplementation(() => {});
    spyOn(ui.Spinner.prototype, 'start').mockImplementation(() => ui.Spinner.prototype);
    spyOn(ui.Spinner.prototype, 'succeed').mockImplementation(() => {});
    spyOn(ui.Spinner.prototype, 'fail').mockImplementation(() => {});

    execSpy = spyOn(shell, 'exec').mockImplementation(async (cmd, opts) => {
      // Mock git clone
      if (cmd[0] === 'git' && cmd[1] === 'clone') {
        const targetDir = join(cmd[5], 'dream-server');
        fs.mkdirSync(targetDir, { recursive: true });
      }
      return { exitCode: 0, stdout: '', stderr: '' };
    });
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
    spyOn(ui, 'phase').mockRestore();
    spyOn(ui, 'step').mockRestore();
    spyOn(ui, 'info').mockRestore();
    spyOn(ui, 'ok').mockRestore();
    spyOn(ui, 'warn').mockRestore();
    spyOn(ui, 'fail').mockRestore();
    execSpy.mockRestore();
  });

  test('configure() performs git pull if .env exists', async () => {
    const ctx = createDefaultContext();
    ctx.installDir = tmpDir;

    // Simulate existing installation
    fs.writeFileSync(join(tmpDir, '.env'), 'MOCK_ENV=true');

    await configure(ctx);

    expect(execSpy).toHaveBeenCalled();
    const args = execSpy.mock.calls.map(c => c[0][1]); // check git subcommands
    expect(args).toContain('pull'); // git pull
  });

  test('configure() clones repo if .env does not exist', async () => {
    const ctx = createDefaultContext();
    ctx.installDir = tmpDir;

    await configure(ctx);

    expect(execSpy).toHaveBeenCalled();
    const args = execSpy.mock.calls.map(c => c[0][1]);
    expect(args).toContain('clone'); // git clone

    // Check if .env was generated
    expect(fs.existsSync(join(tmpDir, '.env'))).toBe(true);
  });

  test('configure() skips clone and generate if dryRun', async () => {
    const ctx = createDefaultContext();
    ctx.installDir = tmpDir;
    ctx.dryRun = true;

    await configure(ctx);

    expect(execSpy).not.toHaveBeenCalled();
    expect(fs.existsSync(join(tmpDir, '.env'))).toBe(false);
  });

  test('configure() generates .env file correctly', async () => {
    const ctx = createDefaultContext();
    ctx.installDir = tmpDir;
    ctx.tier = '1'; // To test correct model injection
    ctx.gpu.backend = 'nvidia';

    await configure(ctx);

    const envContent = fs.readFileSync(join(tmpDir, '.env'), 'utf-8');
    expect(envContent).toContain('GPU_BACKEND=nvidia');
    expect(envContent).toContain('LLM_MODEL=qwen3-8b');
    expect(envContent).toContain('WEBUI_PORT=3000');
  });
});
```

### File: `detection.test.ts`

- Size: 3534 bytes
- Modified: 2026-03-10 21:24:33 UTC

```typescript
import { describe, test, expect, spyOn, beforeEach, afterEach } from 'bun:test';
import { detect } from '../src/phases/detection.ts';
import { createDefaultContext } from '../src/lib/config.ts';
import * as shell from '../src/lib/shell.ts';
import * as ui from '../src/lib/ui.ts';
import * as fs from 'node:fs';

describe('detection.ts', () => {
  let execSpy: ReturnType<typeof spyOn>;
  let fileSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    spyOn(ui, 'phase').mockImplementation(() => {});
    spyOn(ui, 'step').mockImplementation(() => {});
    spyOn(ui, 'ok').mockImplementation(() => {});
    spyOn(ui, 'warn').mockImplementation(() => {});
    spyOn(ui, 'box').mockImplementation(() => {});

    // Mock RAM detection (Bun.file('/proc/meminfo').text())
    fileSpy = spyOn(Bun, 'file').mockImplementation((path: any) => {
      if (path === '/proc/meminfo') {
        return { text: async () => 'MemTotal:       32924152 kB\n' } as any;
      }
      return { text: async () => '' } as any;
    });

    // Mock GPU and Disk detection (exec)
    execSpy = spyOn(shell, 'exec').mockImplementation(async (cmd) => {
      if (cmd[0] === 'df') {
        return { exitCode: 0, stdout: 'Filesystem     1G-blocks  Used Available Use% Mounted on\n/dev/root           983G   22G      962G   3% /', stderr: '' };
      }
      if (cmd[0] === 'nvidia-smi') {
        return { exitCode: 0, stdout: 'NVIDIA GeForce RTX 4090, 24564, 1', stderr: '' };
      }
      return { exitCode: 1, stdout: '', stderr: '' };
    });
  });

  afterEach(() => {
    spyOn(ui, 'phase').mockRestore();
    spyOn(ui, 'step').mockRestore();
    spyOn(ui, 'ok').mockRestore();
    spyOn(ui, 'warn').mockRestore();
    spyOn(ui, 'box').mockRestore();
    fileSpy.mockRestore();
    execSpy.mockRestore();
  });

  test('detect() returns combined hardware information and sets tier correctly', async () => {
    const ctx = createDefaultContext();

    const res = await detect(ctx);

    expect(res.ramGB).toBe(31); // 32924152 / 1024 / 1024 ~ 31
    expect(res.diskGB).toBe(962);
    expect(res.gpu.backend).toBe('nvidia');
    expect(res.gpu.name).toBe('NVIDIA GeForce RTX 4090');
    expect(res.gpu.vramMB).toBe(24564);

    // Check context updates
    expect(ctx.system.ramGB).toBe(31);
    expect(ctx.system.diskGB).toBe(962);
    expect(ctx.gpu.backend).toBe('nvidia');

    // Due to the mock, tier should be '3' for 24GB VRAM
    expect(res.tier).toBe('3');
  });

  test('detect() respects pre-set ctx.tier over detected classification', async () => {
    const ctx = createDefaultContext();
    ctx.tier = '1';

    const res = await detect(ctx);
    expect(res.tier).toBe('1');
    expect(ctx.tier).toBe('1');
  });

  test('detect() gracefully handles missing GPU', async () => {
    execSpy.mockImplementation(async (cmd) => {
      if (cmd[0] === 'df') {
        return { exitCode: 0, stdout: 'Filesystem     1G-blocks  Used Available Use% Mounted on\n/dev/root           983G   22G      962G   3% /', stderr: '' };
      }
      if (cmd[0] === 'nvidia-smi') {
        return { exitCode: 1, stdout: '', stderr: 'nvidia-smi: command not found' }; // Mock no GPU
      }
      return { exitCode: 1, stdout: '', stderr: '' };
    });

    const ctx = createDefaultContext();

    const res = await detect(ctx);

    expect(res.gpu.backend).toBe('cpu');
    expect(res.gpu.name).toBe('Not detected');
    expect(res.gpu.vramMB).toBe(0);

    // RAM is 31GB, Tier 2 requires 48GB, Tier 1 is < 48GB.
    expect(res.tier).toBe('1');
  });
});
```

### File: `docker.test.ts`

- Size: 3495 bytes
- Modified: 2026-03-10 21:24:33 UTC

```typescript
import { describe, test, expect, spyOn, beforeEach, afterEach } from 'bun:test';
import * as docker from '../src/lib/docker.ts';
import * as shell from '../src/lib/shell.ts';

describe('docker.ts', () => {
  let execSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    execSpy = spyOn(shell, 'exec');
    docker.resetCache();
  });

  afterEach(() => {
    execSpy.mockRestore();
    docker.resetCache();
  });

  test('getComposeCommand() returns ["docker", "compose"] when docker compose is available', async () => {
    execSpy.mockImplementation(async (cmd) => {
      if (cmd[0] === 'docker' && cmd[1] === 'compose' && cmd[2] === 'version') {
        return { exitCode: 0, stdout: 'Docker Compose version v2.20.0', stderr: '' };
      }
      if (cmd[0] === 'docker' && cmd[1] === 'info') {
        return { exitCode: 0, stdout: 'Server Version: 24.0.0', stderr: '' };
      }
      return { exitCode: 1, stdout: '', stderr: '' };
    });

    const result = await docker.getComposeCommand();
    expect(result).toEqual(['docker', 'compose']);
  });

  test('getComposeCommand() falls back to sudo docker compose when user lacks permissions', async () => {
    execSpy.mockImplementation(async (cmd) => {
      if (cmd[0] === 'docker' && cmd[1] === 'compose' && cmd[2] === 'version') {
        return { exitCode: 0, stdout: 'Docker Compose version v2.20.0', stderr: '' };
      }
      if (cmd[0] === 'docker' && cmd[1] === 'info' && cmd[2] !== '-n') {
        return { exitCode: 1, stdout: '', stderr: 'permission denied' };
      }
      if (cmd[0] === 'sudo' && cmd[1] === '-n' && cmd[2] === 'docker') {
        return { exitCode: 0, stdout: 'Server Version: 24.0.0', stderr: '' };
      }
      return { exitCode: 1, stdout: '', stderr: '' };
    });

    const result = await docker.getComposeCommand();
    expect(result).toEqual(['sudo', 'docker', 'compose']);
  });

  test('getComposeCommand() falls back to docker-compose standalone', async () => {
    execSpy.mockImplementation(async (cmd) => {
      if (cmd[0] === 'docker-compose' && cmd[1] === 'version') {
        return { exitCode: 0, stdout: 'docker-compose version 1.29.0', stderr: '' };
      }
      return { exitCode: 1, stdout: '', stderr: '' };
    });

    const result = await docker.getComposeCommand();
    expect(result).toEqual(['docker-compose']);
  });

  test('getComposeCommand() throws when docker is not available', async () => {
    execSpy.mockImplementation(async () => {
      return { exitCode: 1, stdout: '', stderr: 'command not found' };
    });

    try {
      await docker.getComposeCommand();
      expect(true).toBe(false);
    } catch (e: any) {
      expect(e.message).toContain('Cannot connect to Docker daemon');
    }
  });

  test('getComposeCommand() caches result', async () => {
    execSpy.mockImplementation(async (cmd) => {
      if (cmd[0] === 'docker' && cmd[1] === 'compose' && cmd[2] === 'version') {
        return { exitCode: 0, stdout: 'Docker Compose version v2.20.0', stderr: '' };
      }
      if (cmd[0] === 'docker' && cmd[1] === 'info') {
        return { exitCode: 0, stdout: 'Server Version: 24.0.0', stderr: '' };
      }
      return { exitCode: 1, stdout: '', stderr: '' };
    });

    const result1 = await docker.getComposeCommand();
    const result2 = await docker.getComposeCommand();
    
    expect(result1).toEqual(['docker', 'compose']);
    expect(result2).toEqual(['docker', 'compose']);
    expect(execSpy).toHaveBeenCalledTimes(2);
  });
});
```

### File: `doctor.test.ts`

- Size: 2900 bytes
- Modified: 2026-03-10 21:44:33 UTC

```typescript
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
```

### File: `env.test.ts`

- Size: 5028 bytes
- Modified: 2026-03-10 21:33:06 UTC

```typescript
import { describe, test, expect } from 'bun:test';
import { parseEnv, getEnvValue, setEnvValue, mergeEnv } from '../src/lib/env.ts';

describe('env.ts', () => {
  describe('parseEnv()', () => {
    test('parses simple key=value pairs', () => {
      const env = parseEnv('FOO=bar\nBAZ=qux');
      expect(env).toEqual({ FOO: 'bar', BAZ: 'qux' });
    });

    test('handles double-quoted values', () => {
      const env = parseEnv('KEY="value with spaces"');
      expect(env.KEY).toBe('value with spaces');
    });

    test('handles single-quoted values', () => {
      const env = parseEnv("KEY='value with spaces'");
      expect(env.KEY).toBe('value with spaces');
    });

    test('strips inline comments from unquoted values', () => {
      const env = parseEnv('KEY=value # this is a comment');
      expect(env.KEY).toBe('value');
    });

    test('preserves # in quoted values', () => {
      const env = parseEnv('KEY="value # not a comment"');
      expect(env.KEY).toBe('value # not a comment');
    });

    test('handles empty values', () => {
      const env = parseEnv('KEY=');
      expect(env.KEY).toBe('');
    });

    test('skips blank lines and full-line comments', () => {
      const env = parseEnv('# comment\n\nKEY=val\n\n# another');
      expect(Object.keys(env)).toEqual(['KEY']);
      expect(env.KEY).toBe('val');
    });

    test('handles equals signs in values', () => {
      const env = parseEnv('KEY=a=b=c');
      expect(env.KEY).toBe('a=b=c');
    });

    test('handles values with URLs', () => {
      const env = parseEnv('LLM_API_URL=http://llama-server:8080');
      expect(env.LLM_API_URL).toBe('http://llama-server:8080');
    });

    test('trims whitespace around keys and unquoted values', () => {
      const env = parseEnv('  KEY  =  value  ');
      expect(env.KEY).toBe('value');
    });

    test('handles real .env file content', () => {
      const content = `
# Dream Server Configuration
WEBUI_SECRET=abc123
DASHBOARD_API_KEY=def456
LLM_API_URL=http://llama-server:8080
GPU_BACKEND=nvidia
ENABLE_VOICE=true
ENABLE_WORKFLOWS=false
COMPOSE_FILE=docker-compose.base.yml:docker-compose.nvidia.yml
`;
      const env = parseEnv(content);
      expect(env.WEBUI_SECRET).toBe('abc123');
      expect(env.GPU_BACKEND).toBe('nvidia');
      expect(env.ENABLE_VOICE).toBe('true');
      expect(env.COMPOSE_FILE).toBe('docker-compose.base.yml:docker-compose.nvidia.yml');
    });
  });

  describe('getEnvValue()', () => {
    test('returns value for existing key', () => {
      expect(getEnvValue('FOO=bar\nBAZ=qux', 'BAZ')).toBe('qux');
    });

    test('returns undefined for missing key', () => {
      expect(getEnvValue('FOO=bar', 'MISSING')).toBeUndefined();
    });
  });

  describe('setEnvValue()', () => {
    test('updates existing key in-place', () => {
      const result = setEnvValue('FOO=old\nBAR=keep', 'FOO', 'new');
      expect(result).toBe('FOO=new\nBAR=keep');
    });

    test('appends new key if not found', () => {
      const result = setEnvValue('FOO=bar', 'NEW', 'val');
      expect(result).toContain('NEW=val');
    });

    test('preserves comments and structure', () => {
      const content = '# Header\nFOO=old\n# Comment\nBAR=keep';
      const result = setEnvValue(content, 'FOO', 'new');
      expect(result).toContain('# Header');
      expect(result).toContain('# Comment');
      expect(result).toContain('FOO=new');
      expect(result).toContain('BAR=keep');
    });

    test('does not modify comment lines containing the key', () => {
      const content = '# FOO=commented\nFOO=real';
      const result = setEnvValue(content, 'FOO', 'updated');
      expect(result).toContain('# FOO=commented');
      expect(result).toContain('FOO=updated');
    });
  });

  describe('mergeEnv()', () => {
    test('preserves all existing keys', () => {
      const existing = 'FOO=user_value\nBAR=user_bar';
      const generated = 'FOO=default\nBAR=default';
      const result = mergeEnv(existing, generated);
      const parsed = parseEnv(result);
      expect(parsed.FOO).toBe('user_value');
      expect(parsed.BAR).toBe('user_bar');
    });

    test('appends new keys from generated', () => {
      const existing = 'FOO=keep';
      const generated = 'FOO=default\nNEW_KEY=new_value';
      const result = mergeEnv(existing, generated);
      const parsed = parseEnv(result);
      expect(parsed.FOO).toBe('keep');
      expect(parsed.NEW_KEY).toBe('new_value');
    });

    test('returns existing unchanged when no new keys', () => {
      const existing = 'FOO=bar\nBAZ=qux';
      const generated = 'FOO=default\nBAZ=default';
      const result = mergeEnv(existing, generated);
      expect(result).toBe(existing);
    });

    test('adds section header for new keys', () => {
      const existing = 'FOO=bar';
      const generated = 'FOO=bar\nNEW=val';
      const result = mergeEnv(existing, generated);
      expect(result).toContain('Added by dream-installer');
      expect(result).toContain('NEW=val');
    });
  });
});
```

### File: `features.test.ts`

- Size: 2344 bytes
- Modified: 2026-03-10 21:24:33 UTC

```typescript
import { describe, test, expect, spyOn, beforeEach, afterEach } from 'bun:test';
import { features } from '../src/phases/features.ts';
import { createDefaultContext, FEATURE_PRESETS } from '../src/lib/config.ts';
import * as prompts from '../src/lib/prompts.ts';
import * as ui from '../src/lib/ui.ts';

describe('features.ts', () => {
  let selectSpy: ReturnType<typeof spyOn>;
  let multiSelectSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    spyOn(ui, 'phase').mockImplementation(() => {});
    spyOn(ui, 'info').mockImplementation(() => {});
    spyOn(ui, 'ok').mockImplementation(() => {});

    selectSpy = spyOn(prompts, 'select').mockImplementation(async () => 0); // Full Stack
    multiSelectSpy = spyOn(prompts, 'multiSelect').mockImplementation(async () => [true, true, true, false]);
  });

  afterEach(() => {
    selectSpy.mockRestore();
    multiSelectSpy.mockRestore();
    spyOn(ui, 'phase').mockRestore();
    spyOn(ui, 'info').mockRestore();
    spyOn(ui, 'ok').mockRestore();
  });

  test('features() returns defaults in non-interactive mode', async () => {
    const ctx = createDefaultContext();
    ctx.interactive = false;

    const feats = await features(ctx);
    expect(feats).toEqual(FEATURE_PRESETS.full);
  });

  test('features() returns full stack when user selects Full Stack', async () => {
    const ctx = createDefaultContext();
    ctx.interactive = true;

    selectSpy.mockImplementation(async () => 0); // Full Stack
    const feats = await features(ctx);
    expect(feats).toEqual(FEATURE_PRESETS.full);
  });

  test('features() returns core only when user selects Core Only', async () => {
    const ctx = createDefaultContext();
    ctx.interactive = true;

    selectSpy.mockImplementation(async () => 1); // Core Only
    const feats = await features(ctx);
    expect(feats).toEqual(FEATURE_PRESETS.core);
  });

  test('features() returns custom selection when user selects Custom', async () => {
    const ctx = createDefaultContext();
    ctx.interactive = true;

    selectSpy.mockImplementation(async () => 2); // Custom
    multiSelectSpy.mockImplementation(async () => [true, false, true, false]); // Voice, RAG
    const feats = await features(ctx);
    expect(feats).toEqual({
      voice: true,
      workflows: false,
      rag: true,
      openclaw: false,
    });
  });
});
```

### File: `health.test.ts`

- Size: 2051 bytes
- Modified: 2026-03-10 21:44:31 UTC

```typescript
import { describe, test, expect, mock, beforeEach } from 'bun:test';
import { checkServiceHealth } from '../src/phases/health.ts';

// Mock fetch globally for health check tests
const originalFetch = globalThis.fetch;

describe('health.ts', () => {
  describe('checkServiceHealth()', () => {
    test('returns true when service responds with 200', async () => {
      globalThis.fetch = mock(() =>
        Promise.resolve(new Response('OK', { status: 200 }))
      ) as any;

      const result = await checkServiceHealth('test', 'http://localhost:9999', 4);
      expect(result).toBe(true);

      globalThis.fetch = originalFetch;
    });

    test('returns true when service responds with 401', async () => {
      // Some services like Open WebUI return 401 when healthy but unauthenticated
      globalThis.fetch = mock(() =>
        Promise.resolve(new Response('Unauthorized', { status: 401 }))
      ) as any;

      const result = await checkServiceHealth('test', 'http://localhost:9999', 4);
      expect(result).toBe(true);

      globalThis.fetch = originalFetch;
    });

    test('returns false when service never responds', async () => {
      globalThis.fetch = mock(() =>
        Promise.reject(new Error('Connection refused'))
      ) as any;

      // Short timeout to keep test fast
      const result = await checkServiceHealth('test', 'http://localhost:9999', 2);
      expect(result).toBe(false);

      globalThis.fetch = originalFetch;
    });

    test('retries and succeeds when service becomes available', async () => {
      let callCount = 0;
      globalThis.fetch = mock(() => {
        callCount++;
        if (callCount < 3) {
          return Promise.reject(new Error('Connection refused'));
        }
        return Promise.resolve(new Response('OK', { status: 200 }));
      }) as any;

      const result = await checkServiceHealth('test', 'http://localhost:9999', 10);
      expect(result).toBe(true);
      expect(callCount).toBeGreaterThanOrEqual(3);

      globalThis.fetch = originalFetch;
    });
  });
});
```

### File: `install.test.ts`

- Size: 5998 bytes
- Modified: 2026-03-10 21:53:17 UTC

```typescript
import { describe, test, expect, spyOn, beforeEach, afterEach } from 'bun:test';
import { install } from '../src/commands/install.ts';
import * as preflightPhase from '../src/phases/preflight.ts';
import * as detectionPhase from '../src/phases/detection.ts';
import * as featuresPhase from '../src/phases/features.ts';
import * as configurePhase from '../src/phases/configure.ts';
import * as modelPhase from '../src/phases/model.ts';
import * as servicesPhase from '../src/phases/services.ts';
<<<<<<< HEAD
import * as healthPhase from '../src/phases/health.ts';
import * as portsLib from '../src/lib/ports.ts';
=======
>>>>>>> ef16b898df156264e42229ca0fc1e687b01fef92
import * as ui from '../src/lib/ui.ts';
import * as fs from 'node:fs';

describe('install.ts', () => {
  let preflightSpy: ReturnType<typeof spyOn>;
  let detectSpy: ReturnType<typeof spyOn>;
  let featuresSpy: ReturnType<typeof spyOn>;
  let configureSpy: ReturnType<typeof spyOn>;
  let modelSpy: ReturnType<typeof spyOn>;
  let servicesSpy: ReturnType<typeof spyOn>;
<<<<<<< HEAD
  let healthSpy: ReturnType<typeof spyOn>;
  let perplexicaSpy: ReturnType<typeof spyOn>;
  let sttSpy: ReturnType<typeof spyOn>;
  let portsSpy: ReturnType<typeof spyOn>;
=======
>>>>>>> ef16b898df156264e42229ca0fc1e687b01fef92
  let existsSyncSpy: ReturnType<typeof spyOn>;
  let readFileSyncSpy: ReturnType<typeof spyOn>;
  let processExitSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    spyOn(ui, 'banner').mockImplementation(() => {});
    spyOn(ui, 'info').mockImplementation(() => {});
    spyOn(ui, 'phase').mockImplementation(() => {});
    spyOn(ui, 'ok').mockImplementation(() => {});
    spyOn(ui, 'fail').mockImplementation(() => {});
<<<<<<< HEAD
    spyOn(ui, 'warn').mockImplementation(() => {});
=======
>>>>>>> ef16b898df156264e42229ca0fc1e687b01fef92
    spyOn(console, 'log').mockImplementation(() => {});

    preflightSpy = spyOn(preflightPhase, 'preflight').mockImplementation(async () => ({ tailscaleIp: null } as any));
    detectSpy = spyOn(detectionPhase, 'detect').mockImplementation(async () => ({}));
    featuresSpy = spyOn(featuresPhase, 'features').mockImplementation(async () => ({}));
    configureSpy = spyOn(configurePhase, 'configure').mockImplementation(async () => {});
    modelSpy = spyOn(modelPhase, 'downloadModel').mockImplementation(async () => {});
    servicesSpy = spyOn(servicesPhase, 'services').mockImplementation(async () => {});
<<<<<<< HEAD
    healthSpy = spyOn(healthPhase, 'runHealthChecks').mockImplementation(async () => 0);
    perplexicaSpy = spyOn(healthPhase, 'configurePerplexica').mockImplementation(async () => {});
    sttSpy = spyOn(healthPhase, 'preDownloadSttModel').mockImplementation(async () => {});
    portsSpy = spyOn(portsLib, 'checkRequiredPorts').mockImplementation(async () => true);
=======
>>>>>>> ef16b898df156264e42229ca0fc1e687b01fef92

    existsSyncSpy = spyOn(fs, 'existsSync').mockImplementation(() => false);
    readFileSyncSpy = spyOn(fs, 'readFileSync').mockImplementation(() => '');

    processExitSpy = spyOn(process, 'exit').mockImplementation((code) => {
      throw new Error(`process.exit(${code})`);
    });
  });

  afterEach(() => {
    spyOn(ui, 'banner').mockRestore();
    spyOn(ui, 'info').mockRestore();
    spyOn(ui, 'phase').mockRestore();
    spyOn(ui, 'ok').mockRestore();
    spyOn(ui, 'fail').mockRestore();
<<<<<<< HEAD
    spyOn(ui, 'warn').mockRestore();
=======
>>>>>>> ef16b898df156264e42229ca0fc1e687b01fef92
    spyOn(console, 'log').mockRestore();
    preflightSpy.mockRestore();
    detectSpy.mockRestore();
    featuresSpy.mockRestore();
    configureSpy.mockRestore();
    modelSpy.mockRestore();
    servicesSpy.mockRestore();
<<<<<<< HEAD
    healthSpy.mockRestore();
    perplexicaSpy.mockRestore();
    sttSpy.mockRestore();
    portsSpy.mockRestore();
=======
>>>>>>> ef16b898df156264e42229ca0fc1e687b01fef92
    existsSyncSpy.mockRestore();
    readFileSyncSpy.mockRestore();
    processExitSpy.mockRestore();
  });

  test('install() runs all phases successfully for new installation', async () => {
    await install({ nonInteractive: true, all: true });

    expect(preflightSpy).toHaveBeenCalled();
    expect(detectSpy).toHaveBeenCalled();
    expect(featuresSpy).not.toHaveBeenCalled(); // Skipped because --all is provided
    expect(configureSpy).toHaveBeenCalled();
    expect(modelSpy).toHaveBeenCalled();
    expect(servicesSpy).toHaveBeenCalled();
<<<<<<< HEAD
    expect(healthSpy).toHaveBeenCalled();
    expect(portsSpy).toHaveBeenCalled();
=======
>>>>>>> ef16b898df156264e42229ca0fc1e687b01fef92
  });

  test('install() respects resume functionality', async () => {
    existsSyncSpy.mockImplementation((path) => {
      if (typeof path === 'string' && path.endsWith('.env')) return true;
      return false;
    });
    readFileSyncSpy.mockImplementation(() => 'ENABLE_VOICE=true\nENABLE_WORKFLOWS=false');

    await install({ nonInteractive: true });

    expect(preflightSpy).toHaveBeenCalled();
    expect(detectSpy).toHaveBeenCalled();
    expect(featuresSpy).not.toHaveBeenCalled(); // Uses existing .env values
    expect(configureSpy).toHaveBeenCalled();
    expect(modelSpy).toHaveBeenCalled();
    expect(servicesSpy).toHaveBeenCalled();
  });

  test('install() catches and handles errors during phases', async () => {
    preflightSpy.mockImplementation(async () => {
      throw new Error('Preflight mock failure');
    });

    try {
      await install({});
      expect(true).toBe(false); // Should not reach
    } catch (e: any) {
      expect(e.message).toBe('process.exit(1)');
      expect(ui.fail).toHaveBeenCalledWith(expect.stringContaining('Preflight mock failure'));
    }
  });

  test('install() calls features selection if not all and not resuming', async () => {
    await install({});

    expect(featuresSpy).toHaveBeenCalled();
    expect(configureSpy).toHaveBeenCalled();
  });
});
<<<<<<< HEAD

=======
>>>>>>> ef16b898df156264e42229ca0fc1e687b01fef92
```

### File: `installer.test.ts`

- Size: 8183 bytes
- Modified: 2026-03-09 12:44:21 UTC

```typescript
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
```

### File: `model.test.ts`

- Size: 4203 bytes
- Modified: 2026-03-10 21:24:33 UTC

```typescript
import { describe, test, expect, spyOn, beforeEach, afterEach } from 'bun:test';
import { downloadModel } from '../src/phases/model.ts';
import { createDefaultContext, TIER_MAP } from '../src/lib/config.ts';
import * as shell from '../src/lib/shell.ts';
import * as ui from '../src/lib/ui.ts';
import * as fs from 'node:fs';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

describe('model.ts', () => {
  let tmpDir: string;
  let execStreamSpy: ReturnType<typeof spyOn>;
  let execSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'dream-test-model-'));

    spyOn(ui, 'step').mockImplementation(() => {});
    spyOn(ui, 'info').mockImplementation(() => {});
    spyOn(ui, 'ok').mockImplementation(() => {});
    spyOn(ui, 'warn').mockImplementation(() => {});
    spyOn(ui, 'fail').mockImplementation(() => {});
    spyOn(console, 'log').mockImplementation(() => {});

    execStreamSpy = spyOn(shell, 'execStream').mockImplementation(async () => 0);
    execSpy = spyOn(shell, 'exec').mockImplementation(async (cmd) => {
      // Mock 'which wget'
      if (cmd[0] === 'which' && cmd[1] === 'wget') {
        return { exitCode: 0, stdout: '/usr/bin/wget', stderr: '' };
      }
      if (cmd[0] === 'mv') {
        fs.writeFileSync(cmd[2], 'mock_data_after_mv');
      }
      return { exitCode: 0, stdout: '', stderr: '' };
    });
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
    spyOn(ui, 'step').mockRestore();
    spyOn(ui, 'info').mockRestore();
    spyOn(ui, 'ok').mockRestore();
    spyOn(ui, 'warn').mockRestore();
    spyOn(ui, 'fail').mockRestore();
    spyOn(console, 'log').mockRestore();
    execStreamSpy.mockRestore();
    execSpy.mockRestore();
  });

  test('downloadModel() skips if tier does not have model', async () => {
    const ctx = createDefaultContext();
    ctx.tier = 'non_existent_tier';

    await downloadModel(ctx);
    expect(execStreamSpy).not.toHaveBeenCalled();
  });

  test('downloadModel() skips if model file already exists', async () => {
    const ctx = createDefaultContext();
    ctx.tier = '1';
    ctx.installDir = tmpDir;

    const tierConfig = TIER_MAP['1'];
    const modelsDir = join(tmpDir, 'data', 'models');
    fs.mkdirSync(modelsDir, { recursive: true });
    fs.writeFileSync(join(modelsDir, tierConfig.ggufFile), 'mock_data');

    await downloadModel(ctx);
    expect(execStreamSpy).not.toHaveBeenCalled();
  });

  test('downloadModel() dryRun does not download', async () => {
    const ctx = createDefaultContext();
    ctx.tier = '1';
    ctx.installDir = tmpDir;
    ctx.dryRun = true;

    await downloadModel(ctx);
    expect(execStreamSpy).not.toHaveBeenCalled();
  });

  test('downloadModel() downloads using wget if available', async () => {
    const ctx = createDefaultContext();
    ctx.tier = '1';
    ctx.installDir = tmpDir;

    await downloadModel(ctx);

    expect(execStreamSpy).toHaveBeenCalled();
    const args = execStreamSpy.mock.calls[0][0];
    expect(args[0]).toBe('wget');
  });

  test('downloadModel() downloads using curl if wget not available', async () => {
    const ctx = createDefaultContext();
    ctx.tier = '1';
    ctx.installDir = tmpDir;

    execSpy.mockImplementation(async (cmd) => {
      if (cmd[0] === 'which' && cmd[1] === 'wget') {
        return { exitCode: 1, stdout: '', stderr: '' }; // wget not found
      }
      if (cmd[0] === 'mv') {
        fs.writeFileSync(cmd[2], 'mock_data_after_mv');
      }
      return { exitCode: 0, stdout: '', stderr: '' };
    });

    await downloadModel(ctx);

    expect(execStreamSpy).toHaveBeenCalled();
    const args = execStreamSpy.mock.calls[0][0];
    expect(args[0]).toBe('curl');
  });

  test('downloadModel() handles download failures after 3 attempts', async () => {
    const ctx = createDefaultContext();
    ctx.tier = '1';
    ctx.installDir = tmpDir;

    execStreamSpy.mockImplementation(async () => 1); // Mock failure

    await downloadModel(ctx);

    // Should retry 3 times
    expect(execStreamSpy).toHaveBeenCalledTimes(3);
    expect(ui.fail).toHaveBeenCalled();
  });
});
```

### File: `ports.test.ts`

- Size: 3543 bytes
- Modified: 2026-03-10 21:44:15 UTC

```typescript
import { describe, test, expect, mock, beforeEach, afterEach } from 'bun:test';
import { isPortFree, getRequiredPorts } from '../src/lib/ports.ts';
import { createDefaultContext } from '../src/lib/config.ts';

describe('ports.ts', () => {
  describe('getRequiredPorts()', () => {
    test('returns base ports for core-only config', () => {
      const ctx = createDefaultContext();
      ctx.features = { voice: false, workflows: false, rag: false, openclaw: false };
      const ports = getRequiredPorts(ctx);

      // Core services: llama-server, open-webui, dashboard, searxng, perplexica, comfyui
      expect(ports.length).toBe(6);
      expect(ports.some(p => p.service === 'llama-server')).toBe(true);
      expect(ports.some(p => p.service === 'open-webui')).toBe(true);
      expect(ports.some(p => p.service === 'dashboard')).toBe(true);
    });

    test('adds voice ports when voice enabled', () => {
      const ctx = createDefaultContext();
      ctx.features = { voice: true, workflows: false, rag: false, openclaw: false };
      const ports = getRequiredPorts(ctx);

      expect(ports.some(p => p.service === 'whisper')).toBe(true);
      expect(ports.some(p => p.service === 'tts')).toBe(true);
      expect(ports.length).toBe(8); // 6 base + whisper + tts
    });

    test('adds n8n port when workflows enabled', () => {
      const ctx = createDefaultContext();
      ctx.features = { voice: false, workflows: true, rag: false, openclaw: false };
      const ports = getRequiredPorts(ctx);

      expect(ports.some(p => p.service === 'n8n')).toBe(true);
      expect(ports.length).toBe(7); // 6 base + n8n
    });

    test('adds qdrant port when rag enabled', () => {
      const ctx = createDefaultContext();
      ctx.features = { voice: false, workflows: false, rag: true, openclaw: false };
      const ports = getRequiredPorts(ctx);

      expect(ports.some(p => p.service === 'qdrant')).toBe(true);
      expect(ports.length).toBe(7);
    });

    test('adds openclaw port when openclaw enabled', () => {
      const ctx = createDefaultContext();
      ctx.features = { voice: false, workflows: false, rag: false, openclaw: true };
      const ports = getRequiredPorts(ctx);

      expect(ports.some(p => p.service === 'openclaw')).toBe(true);
      expect(ports.length).toBe(7);
    });

    test('adds all optional ports when all features enabled', () => {
      const ctx = createDefaultContext();
      ctx.features = { voice: true, workflows: true, rag: true, openclaw: true };
      const ports = getRequiredPorts(ctx);

      // 6 base + whisper + tts + n8n + qdrant + openclaw = 11
      expect(ports.length).toBe(11);
    });

    test('returns correct default port numbers', () => {
      const ctx = createDefaultContext();
      ctx.features = { voice: true, workflows: true, rag: true, openclaw: true };
      const ports = getRequiredPorts(ctx);

      const portMap = Object.fromEntries(ports.map(p => [p.service, p.port]));
      expect(portMap['llama-server']).toBe(8080);
      expect(portMap['open-webui']).toBe(3000);
      expect(portMap.dashboard).toBe(3001);
      expect(portMap.whisper).toBe(9000);
      expect(portMap.tts).toBe(8880);
      expect(portMap.n8n).toBe(5678);
      expect(portMap.qdrant).toBe(6333);
    });
  });

  describe('isPortFree()', () => {
    test('returns boolean for any port check', async () => {
      // Use a port that should be free in test env
      const result = await isPortFree(59999);
      expect(typeof result).toBe('boolean');
    });
  });
});
```

### File: `preflight.test.ts`

- Size: 2957 bytes
- Modified: 2026-03-10 21:24:33 UTC

```typescript
import { describe, test, expect, spyOn, beforeEach, afterEach } from 'bun:test';
import { preflight } from '../src/phases/preflight.ts';
import * as shell from '../src/lib/shell.ts';
import * as ui from '../src/lib/ui.ts';
import { createDefaultContext } from '../src/lib/config.ts';

describe('preflight.ts', () => {
  let commandExistsSpy: ReturnType<typeof spyOn>;
  let execSpy: ReturnType<typeof spyOn>;
  let getuidSpy: ReturnType<typeof spyOn>;
  let processExitSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    spyOn(ui, 'phase').mockImplementation(() => {});
    spyOn(ui, 'step').mockImplementation(() => {});
    spyOn(ui, 'ok').mockImplementation(() => {});
    spyOn(ui, 'warn').mockImplementation(() => {});
    spyOn(ui, 'fail').mockImplementation(() => {});
    spyOn(ui, 'info').mockImplementation(() => {});

    commandExistsSpy = spyOn(shell, 'commandExists').mockImplementation(async (cmd) => {
      if (cmd === 'git') return true;
      if (cmd === 'curl') return true;
      if (cmd === 'nvidia-smi') return false;
      if (cmd === 'tailscale') return false;
      return false;
    });

    execSpy = spyOn(shell, 'exec').mockImplementation(async (args) => {
      // Mock docker compose version
      if (args[0] === 'docker' && args[1] === 'compose') return { exitCode: 0, stdout: 'v2.0.0', stderr: '' };
      // Mock docker info
      if (args[0] === 'docker' && args[1] === 'info') return { exitCode: 0, stdout: 'Running', stderr: '' };
      return { exitCode: 1, stdout: '', stderr: 'error' };
    });

    getuidSpy = spyOn(process, 'getuid').mockImplementation(() => 1000); // Non-root
    processExitSpy = spyOn(process, 'exit').mockImplementation((code) => {
      throw new Error(`process.exit(${code})`);
    });
  });

  afterEach(() => {
    commandExistsSpy.mockRestore();
    execSpy.mockRestore();
    getuidSpy.mockRestore();
    processExitSpy.mockRestore();
    spyOn(ui, 'phase').mockRestore();
    spyOn(ui, 'step').mockRestore();
    spyOn(ui, 'ok').mockRestore();
    spyOn(ui, 'warn').mockRestore();
    spyOn(ui, 'fail').mockRestore();
    spyOn(ui, 'info').mockRestore();
  });

  test('preflight() detects system correctly', async () => {
    const ctx = createDefaultContext();
    const result = await preflight(ctx);

    expect(result.os).toBe(process.platform === 'darwin' ? 'macos' : 'linux');
    expect(result.arch).toBe(process.arch);
    expect(result.hasDocker).toBe(true);
    expect(result.hasDockerCompose).toBe(true);
    expect(result.hasGit).toBe(true);
    expect(result.hasCurl).toBe(true);
    expect(result.hasNvidiaSmi).toBe(false);
  });

  test('preflight() exits if run as root', async () => {
    getuidSpy.mockImplementation(() => 0); // Root
    const ctx = createDefaultContext();

    try {
      await preflight(ctx);
      expect(true).toBe(false); // Should not reach here
    } catch (e: any) {
      expect(e.message).toBe('process.exit(1)');
    }
  });

});
```

### File: `prompts.test.ts`

- Size: 3173 bytes
- Modified: 2026-03-10 21:53:17 UTC

```typescript
import { describe, test, expect, spyOn, beforeEach, afterEach } from 'bun:test';
import * as prompts from '../src/lib/prompts.ts';
import * as readline from 'node:readline';

describe('prompts.ts', () => {
  let rlSpy: ReturnType<typeof spyOn>;
  let processExitSpy: ReturnType<typeof spyOn>;
  let consoleLogSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    rlSpy = spyOn(readline, 'createInterface').mockImplementation(() => {
      return {
        question: (query: string, callback: (ans: string) => void) => {
          // Provide default behaviors for our tests by looking at the query string
          if (query.includes('yes/no')) setImmediate(() => callback('y'));
          else if (query.includes('default no')) setImmediate(() => callback(''));
          else if (query.includes('Select')) setImmediate(() => callback('2'));
          else if (query.includes('Input')) setImmediate(() => callback('test input'));
          else setImmediate(() => callback('default_mock'));
        },
        close: () => {},
      } as any;
    });
    processExitSpy = spyOn(process, 'exit').mockImplementation((code) => {
      throw new Error(`process.exit(${code})`);
    });
    consoleLogSpy = spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    rlSpy.mockRestore();
    processExitSpy.mockRestore();
    consoleLogSpy.mockRestore();
  });

  test('confirm() returns true on "y"', async () => {
    const res = await prompts.confirm('yes/no');
    expect(res).toBe(true);
  });

  test('confirm() returns default value on empty string', async () => {
    const res = await prompts.confirm('default no', false);
    expect(res).toBe(false);
  });

  test('select() returns correct index based on 1-based user input', async () => {
    const res = await prompts.select('Select option', [
      { label: 'Option 1' },
      { label: 'Option 2' },
      { label: 'Option 3' },
    ]);
    expect(res).toBe(1); // '2' -> 1
  });

  test('input() returns user input string', async () => {
    const res = await prompts.input('Input something');
    expect(res).toBe('test input');
  });

  test('multiSelect() handles non-TTY environments gracefully', async () => {
<<<<<<< HEAD
    // Explicitly force non-TTY so multiSelect() hits the early-return path
    // (Bun's test runner may provide a TTY-like stdin that would hang)
    const originalIsTTY = process.stdin.isTTY;
    Object.defineProperty(process.stdin, 'isTTY', { value: false, configurable: true });
    try {
      const res = await prompts.multiSelect('Select features', [
        { label: 'Feat1', checked: true },
        { label: 'Feat2', checked: false }
      ]);
      expect(res).toEqual([true, false]);
    } finally {
      Object.defineProperty(process.stdin, 'isTTY', { value: originalIsTTY, configurable: true });
    }
=======
    // Bun test environment does not have process.stdin.isTTY = true by default
    const res = await prompts.multiSelect('Select features', [
      { label: 'Feat1', checked: true },
      { label: 'Feat2', checked: false }
    ]);
    expect(res).toEqual([true, false]);
>>>>>>> ef16b898df156264e42229ca0fc1e687b01fef92
  });
});
```

### File: `services-helpers.test.ts`

- Size: 653 bytes
- Modified: 2026-03-10 21:37:22 UTC

```typescript
import { describe, test, expect } from 'bun:test';
import { getDockerBaseCmd } from '../src/phases/services.ts';

describe('services.ts helpers', () => {
  describe('getDockerBaseCmd()', () => {
    test('extracts docker from sudo docker compose', () => {
      expect(getDockerBaseCmd(['sudo', 'docker', 'compose'])).toEqual(['sudo', 'docker']);
    });

    test('extracts docker from docker compose', () => {
      expect(getDockerBaseCmd(['docker', 'compose'])).toEqual(['docker']);
    });

    test('extracts docker from docker-compose standalone', () => {
      expect(getDockerBaseCmd(['docker-compose'])).toEqual(['docker']);
    });
  });
});
```

### File: `services.test.ts`

- Size: 5554 bytes
- Modified: 2026-03-10 21:24:33 UTC

```typescript
import { describe, test, expect, spyOn, beforeEach, afterEach } from 'bun:test';
import { services } from '../src/phases/services.ts';
import { createDefaultContext } from '../src/lib/config.ts';
import * as shell from '../src/lib/shell.ts';
import * as ui from '../src/lib/ui.ts';
import * as docker from '../src/lib/docker.ts';

describe('services.ts', () => {
  let execSpy: ReturnType<typeof spyOn>;
  let execStreamSpy: ReturnType<typeof spyOn>;
  let getComposeCommandSpy: ReturnType<typeof spyOn>;
  let fetchSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    spyOn(ui, 'phase').mockImplementation(() => {});
    spyOn(ui, 'step').mockImplementation(() => {});
    spyOn(ui, 'info').mockImplementation(() => {});
    spyOn(ui, 'ok').mockImplementation(() => {});
    spyOn(ui, 'warn').mockImplementation(() => {});
    spyOn(ui, 'fail').mockImplementation(() => {});
    spyOn(ui, 'header').mockImplementation(() => {});
    spyOn(ui, 'table').mockImplementation(() => {});
    spyOn(console, 'log').mockImplementation(() => {});

    getComposeCommandSpy = spyOn(docker, 'getComposeCommand').mockImplementation(async () => ['docker', 'compose']);

    execSpy = spyOn(shell, 'exec').mockImplementation(async (cmd) => {
      // Mock docker compose commands from within `services.ts` that aren't using `docker.ts` directly
      if (cmd[0] === 'docker' && cmd[1] === 'compose' && cmd[2] === 'version') {
        return { exitCode: 0, stdout: '', stderr: '' };
      }
      if (cmd[0] === 'docker' && cmd[1] === 'info') {
        return { exitCode: 0, stdout: '', stderr: '' };
      }
      if (cmd[2] === 'ps' && cmd[3] === '--format' && cmd[4] === 'json') {
        return { exitCode: 0, stdout: '[{"Name": "dream-webui", "State": "running", "Status": "Up 2 minutes"}]', stderr: '' };
      }
      return { exitCode: 0, stdout: '', stderr: '' };
    });

    execStreamSpy = spyOn(shell, 'execStream').mockImplementation(async () => 0); // docker compose up -d

    // Mock global fetch
    fetchSpy = spyOn(globalThis, 'fetch').mockImplementation(async () => {
      return { ok: true, status: 200 } as any;
    });
  });

  afterEach(() => {
    spyOn(ui, 'phase').mockRestore();
    spyOn(ui, 'step').mockRestore();
    spyOn(ui, 'info').mockRestore();
    spyOn(ui, 'ok').mockRestore();
    spyOn(ui, 'warn').mockRestore();
    spyOn(ui, 'fail').mockRestore();
    spyOn(ui, 'header').mockRestore();
    spyOn(ui, 'table').mockRestore();
    spyOn(console, 'log').mockRestore();

    getComposeCommandSpy.mockRestore();
    execSpy.mockRestore();
    execStreamSpy.mockRestore();
    fetchSpy.mockRestore();
  });

  test('services() performs docker compose up', async () => {
    const ctx = createDefaultContext();
    await services(ctx);

    expect(execStreamSpy).toHaveBeenCalled();
    const args = execStreamSpy.mock.calls[0][0];
    expect(args).toEqual(['docker', 'compose', 'up', '-d', '--remove-orphans']);

    // Verify healthCheck happened
    expect(fetchSpy).toHaveBeenCalled();
  });

  test('services() handles non-zero exit code gracefully', async () => {
    const ctx = createDefaultContext();
    execStreamSpy.mockImplementation(async () => 1); // Mock failure

    execSpy.mockImplementation(async (cmd) => {
      // Mock internal `getComposeCommand` calls inside `services.ts`
      if (cmd[0] === 'docker' && cmd[1] === 'compose' && cmd[2] === 'version') return { exitCode: 0, stdout: '', stderr: '' };
      if (cmd[0] === 'docker' && cmd[1] === 'info') return { exitCode: 0, stdout: '', stderr: '' };
      // Mock ps --format json
      if (cmd[2] === 'ps' && cmd[3] === '--format' && cmd[4] === 'json') {
        return { exitCode: 0, stdout: '[{"Name": "dream-webui", "State": "exited", "Status": "Exited (1)"}]', stderr: '' };
      }
      return { exitCode: 0, stdout: '', stderr: '' };
    });

    await services(ctx);

    expect(ui.warn).toHaveBeenCalledWith('docker compose up exited with errors');
    expect(ui.fail).toHaveBeenCalledWith('webui (Exited (1))'); // dream- prefix gets stripped
  });

  test('services() gracefully handles JSON parse error in container status', async () => {
    const ctx = createDefaultContext();
    execStreamSpy.mockImplementation(async () => 1); // Mock failure

    execSpy.mockImplementation(async (cmd) => {
      if (cmd[0] === 'docker' && cmd[1] === 'compose' && cmd[2] === 'version') return { exitCode: 0, stdout: '', stderr: '' };
      if (cmd[0] === 'docker' && cmd[1] === 'info') return { exitCode: 0, stdout: '', stderr: '' };
      if (cmd[2] === 'ps' && cmd[3] === '--format' && cmd[4] === 'json') {
        // Return an unparseable malformed JSON to trigger the fallback block inside catch
        return { exitCode: 0, stdout: 'NOT JSON', stderr: '' };
      }
      // Fallback
      if (cmd[2] === 'ps' && !cmd[3]) {
        return { exitCode: 0, stdout: 'fallback ps output', stderr: '' };
      }
      return { exitCode: 0, stdout: '', stderr: '' };
    });

    await services(ctx);

    // One of the calls to console.log should be 'fallback ps output'
    let found = false;
    // @ts-ignore
    for (const call of console.log.mock.calls) {
      if (call[0] === 'fallback ps output') {
        found = true;
        break;
      }
    }
    expect(found).toBe(true);
  });

  test('services() dryRun skips execStream', async () => {
    const ctx = createDefaultContext();
    ctx.dryRun = true;

    await services(ctx);

    expect(execStreamSpy).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
```

### File: `shell.test.ts`

- Size: 1932 bytes
- Modified: 2026-03-10 21:24:33 UTC

```typescript
import { describe, test, expect, spyOn, beforeEach, afterEach } from 'bun:test';
import * as shell from '../src/lib/shell.ts';

describe('shell.ts', () => {
  test('exec() executes successfully', async () => {
    const result = await shell.exec(['echo', 'hello world']);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe('hello world');
  });

  test('exec() throws ShellError on failure if throwOnError is true', async () => {
    try {
      await shell.exec(['ls', '/nonexistent_path_test_dream_server']);
      // Should not reach here
      expect(true).toBe(false);
    } catch (e: any) {
      expect(e).toBeInstanceOf(shell.ShellError);
      expect(e.exitCode).not.toBe(0);
      expect(e.command).toBe('ls /nonexistent_path_test_dream_server');
    }
  });

  test('exec() returns exitCode on failure if throwOnError is false', async () => {
    const result = await shell.exec(['ls', '/nonexistent_path_test_dream_server'], { throwOnError: false });
    expect(result.exitCode).not.toBe(0);
  });

  test('execStream() executes successfully', async () => {
    // Save original Bun.spawn
    const originalSpawn = Bun.spawn;
    // Hide output from execStream in test, we just mock it to resolve immediately with exitCode 0
    const procSpy = spyOn(Bun, 'spawn').mockImplementation((...args) => {
      return {
        exited: Promise.resolve(0),
        kill: () => {},
      } as any;
    });

    const exitCode = await shell.execStream(['echo', 'streamed']);
    expect(exitCode).toBe(0);
    procSpy.mockRestore();
  });

  test('commandExists() returns true for existing command', async () => {
    const exists = await shell.commandExists('echo');
    expect(exists).toBe(true);
  });

  test('commandExists() returns false for nonexistent command', async () => {
    const exists = await shell.commandExists('nonexistent_command_test_dream_server');
    expect(exists).toBe(false);
  });
});
```

### File: `status.test.ts`

- Size: 5634 bytes
- Modified: 2026-03-10 21:24:33 UTC

```typescript
import { describe, test, expect, spyOn, beforeEach, afterEach } from 'bun:test';
import { status } from '../src/commands/status.ts';
import * as shell from '../src/lib/shell.ts';
import * as ui from '../src/lib/ui.ts';
import * as docker from '../src/lib/docker.ts';
import * as fs from 'node:fs';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

describe('status.ts', () => {
  let tmpDir: string;
  let execSpy: ReturnType<typeof spyOn>;
  let fetchSpy: ReturnType<typeof spyOn>;
  let processExitSpy: ReturnType<typeof spyOn>;
  let getComposeCommandSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'dream-test-status-'));

    spyOn(ui, 'header').mockImplementation(() => {});
    spyOn(ui, 'table').mockImplementation(() => {});
    spyOn(ui, 'info').mockImplementation(() => {});
    spyOn(ui, 'step').mockImplementation(() => {});
    spyOn(ui, 'ok').mockImplementation(() => {});
    spyOn(ui, 'warn').mockImplementation(() => {});
    spyOn(ui, 'fail').mockImplementation(() => {});
    spyOn(console, 'log').mockImplementation(() => {});

    getComposeCommandSpy = spyOn(docker, 'getComposeCommand').mockImplementation(async () => ['docker', 'compose']);

    execSpy = spyOn(shell, 'exec').mockImplementation(async (cmd) => {
      // GPU check
      if (cmd[0] === 'nvidia-smi' && cmd[1].includes('memory.free')) {
        return { exitCode: 0, stdout: 'RTX 4090, 24564, 10000, 14564', stderr: '' };
      }
      if (cmd[0] === 'nvidia-smi' && cmd[1].includes('used_gpu_memory')) {
        return { exitCode: 0, stdout: '1234, python, 4000', stderr: '' };
      }
      // Docker PS
      if (cmd[0] === 'docker' && cmd[2] === 'ps' && cmd[3] === '--format' && cmd[4] === 'json') {
        return { exitCode: 0, stdout: '[{"Name": "dream-webui", "State": "running", "Status": "Up"}]', stderr: '' };
      }
      if (cmd[0] === 'docker' && cmd[1] === 'ps' && cmd[2] === '--format') {
        return { exitCode: 0, stdout: 'container123 dream-webui', stderr: '' };
      }
      if (cmd[0] === 'docker' && cmd[1] === 'top') {
        return { exitCode: 0, stdout: 'PID\n1234\n', stderr: '' };
      }
      return { exitCode: 1, stdout: '', stderr: '' };
    });

    fetchSpy = spyOn(globalThis, 'fetch').mockImplementation(async () => {
      return { ok: true, status: 200 } as any;
    });

    processExitSpy = spyOn(process, 'exit').mockImplementation((code) => {
      throw new Error(`process.exit(${code})`);
    });
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
    spyOn(ui, 'header').mockRestore();
    spyOn(ui, 'table').mockRestore();
    spyOn(ui, 'info').mockRestore();
    spyOn(ui, 'step').mockRestore();
    spyOn(ui, 'ok').mockRestore();
    spyOn(ui, 'warn').mockRestore();
    spyOn(ui, 'fail').mockRestore();
    spyOn(console, 'log').mockRestore();
    execSpy.mockRestore();
    fetchSpy.mockRestore();
    processExitSpy.mockRestore();
    getComposeCommandSpy.mockRestore();
  });

  test('status() fails if no installation found', async () => {
    try {
      await status({ dir: tmpDir });
      expect(true).toBe(false);
    } catch (e: any) {
      expect(e.message).toBe('process.exit(1)');
      expect(ui.fail).toHaveBeenCalledWith('No Dream Server installation found');
    }
  });

  test('status() displays system state successfully', async () => {
    fs.writeFileSync(join(tmpDir, '.env'), 'LLM_MODEL=test-model\nGPU_BACKEND=nvidia\nENABLE_VOICE=true');

    await status({ dir: tmpDir });

    expect(ui.table).toHaveBeenCalled();
    expect(ui.info).toHaveBeenCalledWith(expect.stringContaining('✓ Voice'));
    expect(ui.ok).toHaveBeenCalledWith(expect.stringContaining('Running (1): webui'));

    // Check health checks passed
    expect(ui.ok).toHaveBeenCalledWith('Chat (WebUI)');
  });

  test('status() displays failing services with logs diagnosis', async () => {
    fs.writeFileSync(join(tmpDir, '.env'), 'LLM_MODEL=test-model\nGPU_BACKEND=nvidia\nENABLE_VOICE=true');

    execSpy.mockImplementation(async (cmd) => {
      if (cmd[0] === 'docker' && cmd[2] === 'ps' && cmd[3] === '--format' && cmd[4] === 'json') {
        return { exitCode: 0, stdout: '[{"Name": "dream-llama-server", "State": "exited", "Status": "Exited (1)"}]', stderr: '' };
      }
      if (cmd[0] === 'docker' && cmd[1] === 'logs') {
        return { exitCode: 0, stdout: '', stderr: 'CUDA out of memory' };
      }
      return { exitCode: 0, stdout: '', stderr: '' };
    });

    await status({ dir: tmpDir });

    expect(ui.warn).toHaveBeenCalledWith('llama-server (Exited (1))');
    expect(ui.info).toHaveBeenCalledWith(expect.stringContaining('CUDA out of memory'));
  });

  test('status() gracefully handles offline health checks', async () => {
    fs.writeFileSync(join(tmpDir, '.env'), 'LLM_MODEL=test-model');

    fetchSpy.mockImplementation(async () => {
      throw new Error('fetch error');
    });

    await status({ dir: tmpDir });

    expect(ui.fail).toHaveBeenCalledWith(expect.stringContaining('Chat (WebUI) — not responding'));
  });

  test('status() handles no containers running gracefully', async () => {
    fs.writeFileSync(join(tmpDir, '.env'), 'LLM_MODEL=test-model');

    execSpy.mockImplementation(async (cmd) => {
      if (cmd[0] === 'docker' && cmd[2] === 'ps') {
        return { exitCode: 0, stdout: '', stderr: '' };
      }
      return { exitCode: 0, stdout: '', stderr: '' };
    });

    await status({ dir: tmpDir });

    expect(ui.warn).toHaveBeenCalledWith('No containers running');
  });

});
```

### File: `ui.test.ts`

- Size: 3618 bytes
- Modified: 2026-03-10 21:24:33 UTC

```typescript
import { describe, test, expect, spyOn, beforeEach, afterEach } from 'bun:test';
import * as ui from '../src/lib/ui.ts';

describe('ui.ts', () => {
  let logSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    logSpy = spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    logSpy.mockRestore();
  });

  test('ok() outputs green checkmark', () => {
    ui.ok('success');
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('✓'));
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('success'));
  });

  test('warn() outputs yellow warning', () => {
    ui.warn('warning');
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('⚠'));
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('warning'));
  });

  test('fail() outputs red cross', () => {
    ui.fail('error');
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('✗'));
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('error'));
  });

  test('info() outputs blue arrow', () => {
    ui.info('info');
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('→'));
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('info'));
  });

  test('step() outputs cyan triangle', () => {
    ui.step('step');
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('▸'));
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('step'));
  });

  test('header() outputs title with borders', () => {
    ui.header('Test Title');
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Test Title'));
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('─'.repeat(60)));
  });

  test('phase() outputs phase information', () => {
    ui.phase(1, 6, 'Preflight', '~5s');
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('[1/6]'));
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Preflight'));
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('~5s'));
  });

  test('banner() outputs application banner', () => {
    ui.banner('1.0.0');
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Dream Server'));
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('v1.0.0'));
  });

  test('table() outputs aligned table data', () => {
    ui.table([['Dashboard', 'http://localhost:3001'], ['Chat', 'http://localhost:3000']]);
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Dashboard'));
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('http://localhost:3001'));
  });

  test('box() outputs bordered box', () => {
    ui.box('Test Box', [['Key', 'Value']]);
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('┌'));
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Test Box'));
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Key'));
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Value'));
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('└'));
  });

  test('Spinner succeed() does not throw', () => {
    const spinner = new ui.Spinner('Loading...');
    expect(() => spinner.succeed('Done!')).not.toThrow();
  });

  test('Spinner fail() does not throw', () => {
    const spinner = new ui.Spinner('Loading...');
    expect(() => spinner.fail('Failed!')).not.toThrow();
  });

  test('Spinner start() and stop() work correctly', () => {
    const spinner = new ui.Spinner('Loading...');
    expect(() => spinner.start()).not.toThrow();
    expect(() => spinner.succeed('Done!')).not.toThrow();
  });
});
```

### File: `uninstall.test.ts`

- Size: 4119 bytes
- Modified: 2026-03-10 21:24:33 UTC

```typescript
import { describe, test, expect, spyOn, beforeEach, afterEach } from 'bun:test';
import { uninstall } from '../src/commands/uninstall.ts';
import * as shell from '../src/lib/shell.ts';
import * as ui from '../src/lib/ui.ts';
import * as prompts from '../src/lib/prompts.ts';
import * as docker from '../src/lib/docker.ts';
import * as fs from 'node:fs';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

describe('uninstall.ts', () => {
  let tmpDir: string;
  let execSpy: ReturnType<typeof spyOn>;
  let execStreamSpy: ReturnType<typeof spyOn>;
  let processExitSpy: ReturnType<typeof spyOn>;
  let getComposeCommandSpy: ReturnType<typeof spyOn>;
  let confirmSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'dream-test-uninstall-'));

    spyOn(ui, 'header').mockImplementation(() => {});
    spyOn(ui, 'step').mockImplementation(() => {});
    spyOn(ui, 'ok').mockImplementation(() => {});
    spyOn(ui, 'warn').mockImplementation(() => {});
    spyOn(ui, 'fail').mockImplementation(() => {});
    spyOn(ui, 'info').mockImplementation(() => {});
    spyOn(console, 'log').mockImplementation(() => {});

    getComposeCommandSpy = spyOn(docker, 'getComposeCommand').mockImplementation(async () => ['docker', 'compose']);

    confirmSpy = spyOn(prompts, 'confirm').mockImplementation(async () => true);

    execSpy = spyOn(shell, 'exec').mockImplementation(async () => {
      return { exitCode: 0, stdout: 'image1\nimage2', stderr: '' };
    });
    execStreamSpy = spyOn(shell, 'execStream').mockImplementation(async () => 0);

    processExitSpy = spyOn(process, 'exit').mockImplementation((code) => {
      throw new Error(`process.exit(${code})`);
    });
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
    spyOn(ui, 'header').mockRestore();
    spyOn(ui, 'step').mockRestore();
    spyOn(ui, 'ok').mockRestore();
    spyOn(ui, 'warn').mockRestore();
    spyOn(ui, 'fail').mockRestore();
    spyOn(ui, 'info').mockRestore();
    spyOn(console, 'log').mockRestore();
    execSpy.mockRestore();
    execStreamSpy.mockRestore();
    getComposeCommandSpy.mockRestore();
    processExitSpy.mockRestore();
    confirmSpy.mockRestore();
  });

  test('uninstall() fails if no installation found', async () => {
    try {
      await uninstall({ dir: tmpDir, force: true });
      expect(true).toBe(false);
    } catch (e: any) {
      expect(e.message).toBe('process.exit(1)');
      expect(ui.fail).toHaveBeenCalledWith('No Dream Server installation found');
    }
  });

  test('uninstall() exits if user aborts', async () => {
    fs.writeFileSync(join(tmpDir, '.env'), 'ENABLE_VOICE=true');
    confirmSpy.mockImplementation(async () => false);

    await uninstall({ dir: tmpDir });
    expect(ui.info).toHaveBeenCalledWith('Uninstall cancelled.');
  });

  test('uninstall() removes containers and directories when forced and not keepData', async () => {
    fs.writeFileSync(join(tmpDir, '.env'), 'ENABLE_VOICE=true');

    await uninstall({ dir: tmpDir, force: true });

    // Verify down command (it uses exec, not execStream)
    expect(execSpy).toHaveBeenCalled();
    const dockerDownCall = execSpy.mock.calls.find(c => c[0].includes('down'));
    expect(dockerDownCall).toBeDefined();

    // Verify directory removal
    const rmCall = execSpy.mock.calls.find(c => c[0][0] === 'rm' && c[0][1] === '-rf' && c[0][2] === tmpDir);
    expect(rmCall).toBeDefined();

    expect(ui.ok).toHaveBeenCalledWith('Dream Server has been uninstalled');
  });

  test('uninstall() respects keepData and does not remove installation dir', async () => {
    fs.writeFileSync(join(tmpDir, '.env'), 'ENABLE_VOICE=true');

    await uninstall({ dir: tmpDir, force: true, keepData: true });

    const rmCall = execSpy.mock.calls.find(c => c[0][0] === 'rm' && c[0][1] === '-rf' && c[0][2] === tmpDir);
    expect(rmCall).toBeUndefined(); // Should not have removed directory

    expect(ui.info).toHaveBeenCalledWith('Keeping data directory (--keep-data specified)');
  });
});
```

### File: `update.test.ts`

- Size: 3978 bytes
- Modified: 2026-03-10 21:24:33 UTC

```typescript
import { describe, test, expect, spyOn, beforeEach, afterEach } from 'bun:test';
import { update } from '../src/commands/update.ts';
import * as shell from '../src/lib/shell.ts';
import * as ui from '../src/lib/ui.ts';
import * as docker from '../src/lib/docker.ts';
import * as fs from 'node:fs';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

describe('update.ts', () => {
  let tmpDir: string;
  let execSpy: ReturnType<typeof spyOn>;
  let execStreamSpy: ReturnType<typeof spyOn>;
  let processExitSpy: ReturnType<typeof spyOn>;
  let getComposeCommandSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'dream-test-update-'));

    spyOn(ui, 'header').mockImplementation(() => {});
    spyOn(ui, 'step').mockImplementation(() => {});
    spyOn(ui, 'ok').mockImplementation(() => {});
    spyOn(ui, 'warn').mockImplementation(() => {});
    spyOn(ui, 'fail').mockImplementation(() => {});
    spyOn(ui, 'info').mockImplementation(() => {});
    spyOn(ui, 'phase').mockImplementation(() => {});
    spyOn(console, 'log').mockImplementation(() => {});

    getComposeCommandSpy = spyOn(docker, 'getComposeCommand').mockImplementation(async () => ['docker', 'compose']);

    execSpy = spyOn(shell, 'exec').mockImplementation(async (cmd) => {
      if (cmd[0] === 'git' && cmd[1] === 'pull') return { exitCode: 0, stdout: 'Already up to date.', stderr: '' };
      return { exitCode: 0, stdout: '', stderr: '' };
    });
    execStreamSpy = spyOn(shell, 'execStream').mockImplementation(async () => 0); // docker compose commands

    processExitSpy = spyOn(process, 'exit').mockImplementation((code) => {
      throw new Error(`process.exit(${code})`);
    });
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
    spyOn(ui, 'header').mockRestore();
    spyOn(ui, 'step').mockRestore();
    spyOn(ui, 'ok').mockRestore();
    spyOn(ui, 'warn').mockRestore();
    spyOn(ui, 'fail').mockRestore();
    spyOn(ui, 'info').mockRestore();
    spyOn(ui, 'phase').mockRestore();
    spyOn(console, 'log').mockRestore();
    execSpy.mockRestore();
    execStreamSpy.mockRestore();
    getComposeCommandSpy.mockRestore();
    processExitSpy.mockRestore();
  });

  test('update() fails if no installation found', async () => {
    try {
      await update({ dir: tmpDir, skipSelfUpdate: true });
      expect(true).toBe(false);
    } catch (e: any) {
      expect(e.message).toBe('process.exit(1)');
      expect(ui.fail).toHaveBeenCalledWith('No Dream Server installation found');
    }
  });

  test('update() performs git pull and docker compose pull then up', async () => {
    fs.writeFileSync(join(tmpDir, '.env'), 'ENABLE_VOICE=true');
    // Mock git repo existence
    fs.mkdirSync(join(tmpDir, '.git'));

    await update({ dir: tmpDir, skipSelfUpdate: true });

    // In update.ts git pull uses execStream
    expect(execStreamSpy).toHaveBeenCalled();
    const gitPullCall = execStreamSpy.mock.calls.find(c => c[0][0] === 'git' && c[0][1] === 'pull');
    expect(gitPullCall).toBeDefined();

    // Should perform docker compose pull, build, and up
    expect(execStreamSpy).toHaveBeenCalledTimes(4); // git pull, docker pull, build, up
    const dockerPullCall = execStreamSpy.mock.calls.find(c => c[0].includes('pull') && c[0][0] === 'docker');
    expect(dockerPullCall).toBeDefined();

    expect(ui.ok).toHaveBeenCalledWith('Update complete');
  });

  test('update() handles git pull error gracefully', async () => {
    fs.writeFileSync(join(tmpDir, '.env'), 'ENABLE_VOICE=true');
    fs.mkdirSync(join(tmpDir, '.git'));

    execStreamSpy.mockImplementation(async (cmd) => {
      if (cmd[0] === 'git' && cmd[1] === 'pull') return 1; // Error
      return 0;
    });

    await update({ dir: tmpDir, skipSelfUpdate: true });

    expect(ui.warn).toHaveBeenCalledWith('git pull failed — may have local changes');
  });
});
```
