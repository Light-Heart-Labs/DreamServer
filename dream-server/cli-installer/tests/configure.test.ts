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
    expect(envContent).toContain('LLM_BACKEND=llamacpp');
  });

  test('configure() generates vLLM env vars when backend is vllm', async () => {
    const ctx = createDefaultContext();
    ctx.installDir = tmpDir;
    ctx.tier = '3';
    ctx.gpu.backend = 'nvidia';
    ctx.llmBackend = 'vllm';

    await configure(ctx);

    const envContent = fs.readFileSync(join(tmpDir, '.env'), 'utf-8');
    expect(envContent).toContain('LLM_BACKEND=vllm');
    expect(envContent).toContain('VLLM_MODEL=Qwen/Qwen3.5-4B');
    expect(envContent).toContain('VLLM_ARGS=--language-model-only --max-model-len 16384');
    expect(envContent).toContain('VLLM_IMAGE=vllm/vllm-openai:v0.17.0');
    expect(envContent).toContain('VLLM_HF_CACHE=./data/hf-cache');
  });

  test('configure() does not include vLLM env vars for llamacpp backend', async () => {
    const ctx = createDefaultContext();
    ctx.installDir = tmpDir;
    ctx.tier = '1';
    ctx.gpu.backend = 'nvidia';
    ctx.llmBackend = 'llamacpp';

    await configure(ctx);

    const envContent = fs.readFileSync(join(tmpDir, '.env'), 'utf-8');
    expect(envContent).toContain('LLM_BACKEND=llamacpp');
    expect(envContent).not.toContain('VLLM_MODEL');
    expect(envContent).not.toContain('VLLM_ARGS');
  });

  test('configure() generates LIVEKIT_API_SECRET as base64 (not hex)', async () => {
    const ctx = createDefaultContext();
    ctx.installDir = tmpDir;
    ctx.tier = '1';

    await configure(ctx);

    const envContent = fs.readFileSync(join(tmpDir, '.env'), 'utf-8');
    const match = envContent.match(/^LIVEKIT_API_SECRET=(.+)$/m);
    expect(match).not.toBeNull();
    const secret = match![1];
    // base64 contains +, /, = and is typically 44 chars for 32 bytes
    // hex is strictly [0-9a-f] and would be 64 chars for 32 bytes
    expect(secret.length).toBe(44); // 32 bytes → 44 base64 chars
    // Verify it's valid base64 (roundtrips correctly)
    const decoded = Buffer.from(secret, 'base64');
    expect(decoded.length).toBe(32);
    expect(Buffer.from(decoded).toString('base64')).toBe(secret);
  });

  test('configure() generates OPENCODE_SERVER_PASSWORD', async () => {
    const ctx = createDefaultContext();
    ctx.installDir = tmpDir;
    ctx.tier = '1';

    await configure(ctx);

    const envContent = fs.readFileSync(join(tmpDir, '.env'), 'utf-8');
    expect(envContent).toContain('OPENCODE_SERVER_PASSWORD=');
    // Should not be empty — the value should be a non-empty base64 string
    const match = envContent.match(/^OPENCODE_SERVER_PASSWORD=(.+)$/m);
    expect(match).not.toBeNull();
    expect(match![1].length).toBeGreaterThan(0);
  });

  test('configure() generates all required .env keys matching bash installer', async () => {
    const ctx = createDefaultContext();
    ctx.installDir = tmpDir;
    ctx.tier = '1';
    ctx.gpu.backend = 'nvidia';

    await configure(ctx);

    const envContent = fs.readFileSync(join(tmpDir, '.env'), 'utf-8');
    // All keys that the bash installer's 06-directories.sh generates
    const requiredKeys = [
      'DREAM_MODE', 'LLM_API_URL', 'GPU_BACKEND',
      'LLM_MODEL', 'GGUF_FILE', 'MAX_CONTEXT', 'CTX_SIZE',
      'LLAMA_SERVER_PORT', 'WEBUI_PORT', 'WHISPER_PORT', 'TTS_PORT',
      'N8N_PORT', 'QDRANT_PORT', 'QDRANT_GRPC_PORT', 'LITELLM_PORT',
      'OPENCLAW_PORT', 'SEARXNG_PORT', 'OPENCODE_PORT',
      'WEBUI_SECRET', 'DASHBOARD_API_KEY', 'N8N_USER', 'N8N_PASS',
      'LITELLM_KEY', 'LIVEKIT_API_KEY', 'LIVEKIT_API_SECRET',
      'OPENCLAW_TOKEN', 'OPENCODE_SERVER_PASSWORD', 'DIFY_SECRET_KEY',
      'WHISPER_MODEL', 'TTS_VOICE',
      'WEBUI_AUTH', 'ENABLE_WEB_SEARCH', 'WEB_SEARCH_ENGINE',
      'N8N_AUTH', 'N8N_HOST', 'N8N_WEBHOOK_URL',
      'TIMEZONE', 'LLM_BACKEND',
      'ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'TOGETHER_API_KEY',
    ];

    for (const key of requiredKeys) {
      expect(envContent).toContain(`${key}=`);
    }
  });

  test('configure() generates AMD-specific vars for amd backend', async () => {
    const ctx = createDefaultContext();
    ctx.installDir = tmpDir;
    ctx.tier = '1';
    ctx.gpu.backend = 'amd';

    await configure(ctx);

    const envContent = fs.readFileSync(join(tmpDir, '.env'), 'utf-8');
    expect(envContent).toContain('VIDEO_GID=');
    expect(envContent).toContain('RENDER_GID=');
    expect(envContent).toContain('HSA_OVERRIDE_GFX_VERSION=');
    expect(envContent).toContain('ROCBLAS_USE_HIPBLASLT=');
  });

  test('configure() does NOT include AMD vars for nvidia/cpu backends', async () => {
    const ctx = createDefaultContext();
    ctx.installDir = tmpDir;
    ctx.tier = '1';
    ctx.gpu.backend = 'nvidia';

    await configure(ctx);

    const envContent = fs.readFileSync(join(tmpDir, '.env'), 'utf-8');
    expect(envContent).not.toContain('VIDEO_GID=');
    expect(envContent).not.toContain('RENDER_GID=');
    expect(envContent).not.toContain('HSA_OVERRIDE_GFX_VERSION');
    expect(envContent).not.toContain('ROCBLAS_USE_HIPBLASLT');
  });
});

describe('resolveComposeFiles()', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'dream-test-compose-'));
    spyOn(ui, 'phase').mockImplementation(() => {});
    spyOn(ui, 'step').mockImplementation(() => {});
    spyOn(ui, 'info').mockImplementation(() => {});
    spyOn(ui, 'ok').mockImplementation(() => {});
    spyOn(ui, 'warn').mockImplementation(() => {});
    spyOn(ui, 'fail').mockImplementation(() => {});
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
    spyOn(ui, 'phase').mockRestore();
    spyOn(ui, 'step').mockRestore();
    spyOn(ui, 'info').mockRestore();
    spyOn(ui, 'ok').mockRestore();
    spyOn(ui, 'warn').mockRestore();
    spyOn(ui, 'fail').mockRestore();
  });

  test('includes vLLM overlay when llmBackend is vllm', () => {
    const { resolveComposeFiles } = require('../src/phases/configure.ts');

    // Create mock compose files
    fs.writeFileSync(join(tmpDir, 'docker-compose.base.yml'), 'services: {}');
    fs.writeFileSync(join(tmpDir, 'docker-compose.nvidia.yml'), 'services: {}');
    fs.writeFileSync(join(tmpDir, 'docker-compose.vllm.yml'), 'services: {}');

    const ctx = createDefaultContext();
    ctx.installDir = tmpDir;
    ctx.gpu.backend = 'nvidia';
    ctx.llmBackend = 'vllm';

    const files = resolveComposeFiles(ctx);
    expect(files).toContain(join(tmpDir, 'docker-compose.vllm.yml'));
    expect(files).toContain(join(tmpDir, 'docker-compose.nvidia.yml'));
  });

  test('excludes vLLM overlay when llmBackend is llamacpp', () => {
    const { resolveComposeFiles } = require('../src/phases/configure.ts');

    fs.writeFileSync(join(tmpDir, 'docker-compose.base.yml'), 'services: {}');
    fs.writeFileSync(join(tmpDir, 'docker-compose.nvidia.yml'), 'services: {}');
    fs.writeFileSync(join(tmpDir, 'docker-compose.vllm.yml'), 'services: {}');

    const ctx = createDefaultContext();
    ctx.installDir = tmpDir;
    ctx.gpu.backend = 'nvidia';
    ctx.llmBackend = 'llamacpp';

    const files = resolveComposeFiles(ctx);
    expect(files).not.toContain(join(tmpDir, 'docker-compose.vllm.yml'));
    expect(files).toContain(join(tmpDir, 'docker-compose.nvidia.yml'));
  });

  test('includes Apple overlay when gpu.backend is apple', () => {
    const { resolveComposeFiles } = require('../src/phases/configure.ts');

    fs.writeFileSync(join(tmpDir, 'docker-compose.base.yml'), 'services: {}');
    fs.writeFileSync(join(tmpDir, 'docker-compose.apple.yml'), 'services: {}');

    const ctx = createDefaultContext();
    ctx.installDir = tmpDir;
    ctx.gpu.backend = 'apple';
    ctx.llmBackend = 'llamacpp';

    const files = resolveComposeFiles(ctx);
    expect(files).toContain(join(tmpDir, 'docker-compose.apple.yml'));
    expect(files).not.toContain(join(tmpDir, 'docker-compose.nvidia.yml'));
  });
});
