// ── Phase 07: Developer Tools ────────────────────────────────────────────────
// Port of installers/phases/07-devtools.sh
// Installs Claude Code, Codex CLI, and OpenCode. All installs are best-effort.

import { type InstallContext, TIER_MAP } from '../lib/config.ts';
import { exec, commandExists } from '../lib/shell.ts';
import * as ui from '../lib/ui.ts';
import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { homedir, tmpdir } from 'node:os';

export async function devtools(ctx: InstallContext): Promise<void> {
  if (!ctx.features.devtools) return;

  ui.phase(0, 0, 'Developer Tools');

  if (ctx.dryRun) {
    ui.info('[DRY RUN] Would install AI developer tools (Claude Code, Codex CLI, OpenCode)');
    ui.info('[DRY RUN] Would configure OpenCode for local llama-server');
    return;
  }

  const home = homedir();
  const npmGlobalDir = join(home, '.npm-global');

  // ── Ensure npm is available ──
  const hasNpm = await commandExists('npm');
  if (!hasNpm) {
    ui.warn('npm not available — skipping Claude Code and Codex CLI install');
    ui.info('  Install Node.js first, then run: npm i -g @anthropic-ai/claude-code @openai/codex');
  }

  if (hasNpm) {
    // Set up user-level npm global prefix (no sudo needed)
    if (!existsSync(npmGlobalDir)) {
      mkdirSync(npmGlobalDir, { recursive: true });
      await exec(['npm', 'config', 'set', 'prefix', npmGlobalDir], { throwOnError: false });
    }

    // Ensure user-level bin is on PATH for this session
    const npmBin = join(npmGlobalDir, 'bin');
    if (!process.env.PATH?.includes(npmBin)) {
      process.env.PATH = `${npmBin}:${process.env.PATH}`;
    }

    // Install Claude Code
    const hasClaude = await commandExists('claude');
    if (!hasClaude) {
      try {
        await exec(['npm', 'install', '-g', '@anthropic-ai/claude-code'], { timeout: 120_000, throwOnError: false });
        ui.ok("Claude Code installed (run 'claude' to start)");
      } catch {
        ui.warn('Claude Code install failed — install later with: npm i -g @anthropic-ai/claude-code');
      }
    } else {
      ui.ok('Claude Code already installed');
    }

    // Install Codex CLI
    const hasCodex = await commandExists('codex');
    if (!hasCodex) {
      try {
        await exec(['npm', 'install', '-g', '@openai/codex'], { timeout: 120_000, throwOnError: false });
        ui.ok("Codex CLI installed (run 'codex' to start)");
      } catch {
        ui.warn('Codex CLI install failed — install later with: npm i -g @openai/codex');
      }
    } else {
      ui.ok('Codex CLI already installed');
    }

    // Ensure ~/.npm-global/bin is on PATH permanently
    const bashrc = join(home, '.bashrc');
    if (existsSync(join(npmGlobalDir, 'bin'))) {
      try {
        const content = existsSync(bashrc) ? readFileSync(bashrc, 'utf-8') : '';
        if (!content.includes('npm-global')) {
          appendFileSync(bashrc, '\nexport PATH="$HOME/.npm-global/bin:$PATH"\n');
          ui.info('Added ~/.npm-global/bin to PATH in ~/.bashrc');
        }
      } catch {
        // non-critical
      }
    }
  }

  // ── OpenCode ──
  const hasOpenCode = await commandExists('opencode') ||
    existsSync(join(home, '.opencode', 'bin', 'opencode'));

  if (!hasOpenCode) {
    ui.info('Installing OpenCode...');
    try {
      const secTmpDir = mkdtempSync(join(tmpdir(), 'opencode-'));
      const tmpFile = join(secTmpDir, 'install.sh');
      const dl = await exec(
        ['curl', '-fsSL', 'https://opencode.ai/install', '-o', tmpFile],
        { throwOnError: false, timeout: 30_000 },
      );
      if (dl.exitCode === 0) {
        const result = await exec(['bash', tmpFile], { throwOnError: false, timeout: 120_000 });
        if (result.exitCode === 0) {
          ui.ok('OpenCode installed (~/.opencode/bin/opencode)');
        } else {
          ui.warn('OpenCode install failed — install later with: curl -fsSL https://opencode.ai/install | bash');
        }
      } else {
        ui.warn('Could not download OpenCode installer');
      }
      // Cleanup temp file
      try { await exec(['rm', '-f', tmpFile], { throwOnError: false }); } catch { /* ignore */ }
    } catch {
      ui.warn('OpenCode install failed — install later with: curl -fsSL https://opencode.ai/install | bash');
    }
  } else {
    ui.ok('OpenCode already installed');
  }

  // ── Configure OpenCode for local llama-server ──
  const opencodeBin = join(home, '.opencode', 'bin', 'opencode');
  if (existsSync(opencodeBin)) {
    const configDir = join(home, '.config', 'opencode');
    const configPath = join(configDir, 'opencode.json');

    if (!existsSync(configPath)) {
      mkdirSync(configDir, { recursive: true });

      const tierCfg = TIER_MAP[ctx.tier] || TIER_MAP['1'];
      const model = tierCfg.model;
      const context = tierCfg.context;

      const config = {
        $schema: 'https://opencode.ai/config.json',
        model: `llama-server/${model}`,
        provider: {
          'llama-server': {
            npm: '@ai-sdk/openai-compatible',
            name: 'llama-server (local)',
            options: {
              baseURL: 'http://127.0.0.1:11434/v1',
              apiKey: 'no-key',
            },
            models: {
              [model]: {
                name: model,
                limit: { context, output: 32768 },
              },
            },
          },
        },
      };

      writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n');
      ui.ok(`OpenCode configured for local llama-server (model: ${model})`);
    } else {
      ui.ok('OpenCode config already exists — skipping');
    }

    // Install OpenCode Web UI as user-level systemd service (Linux only)
    if (process.platform === 'linux') {
      const svcSource = join(ctx.installDir, 'opencode', 'opencode-web.service');
      if (existsSync(svcSource)) {
        const systemdDir = join(home, '.config', 'systemd', 'user');
        mkdirSync(systemdDir, { recursive: true });

        // Read service file and substitute placeholders
        let svcContent = readFileSync(svcSource, 'utf-8');
        svcContent = svcContent.replaceAll('__HOME__', home);

        // Read OPENCODE_SERVER_PASSWORD from .env
        const envPath = join(ctx.installDir, '.env');
        let password = '';
        if (existsSync(envPath)) {
          const envContent = readFileSync(envPath, 'utf-8');
          const match = envContent.match(/^OPENCODE_SERVER_PASSWORD=(.*)$/m);
          if (match) password = match[1];
        }
        svcContent = svcContent.replaceAll('__OPENCODE_SERVER_PASSWORD__', password);

        writeFileSync(join(systemdDir, 'opencode-web.service'), svcContent);

        // Reload and enable
        await exec(['systemctl', '--user', 'daemon-reload'], { throwOnError: false });
        const enable = await exec(
          ['systemctl', '--user', 'enable', '--now', 'opencode-web.service'],
          { throwOnError: false, timeout: 15_000 },
        );
        if (enable.exitCode === 0) {
          ui.ok('OpenCode Web UI service installed (user-level, port 3003)');
        } else {
          ui.warn('OpenCode Web UI service failed to start');
        }

        // Enable lingering so service survives logout
        const user = process.env.USER || process.env.LOGNAME || '';
        const linger = await exec(['loginctl', 'enable-linger', user], { throwOnError: false });
        if (linger.exitCode !== 0) {
          const sudoLinger = await exec(['sudo', '-n', 'loginctl', 'enable-linger', user], { throwOnError: false });
          if (sudoLinger.exitCode !== 0) {
            ui.warn(`Could not enable linger. OpenCode may stop after logout. Run: loginctl enable-linger ${user}`);
          }
        }
      }
    }
  }
}
