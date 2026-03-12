// ── Phase 07: Developer Tools ────────────────────────────────────────────────
// Port of installers/phases/07-devtools.sh
// Installs Claude Code, Codex CLI, Gemini CLI, OpenCode, Droid (Factory.ai), and Junie (JetBrains).
// All installs are best-effort.

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
    ui.info('[DRY RUN] Would prompt for AI developer tools (Claude Code, Codex CLI, Gemini CLI, OpenCode, Droid, Junie)');
    return;
  }

  // ── Detect what's already installed ──
  const [hasClaude, hasCodex, hasGemini, hasOpenCode, hasDroid, hasJunie] = await Promise.all([
    commandExists('claude'),
    commandExists('codex'),
    commandExists('gemini'),
    commandExists('opencode').then(found =>
      found || existsSync(join(homedir(), '.opencode', 'bin', 'opencode'))),
    commandExists('droid'),
    commandExists('junie').then(found =>
      found || existsSync(join(homedir(), '.local', 'bin', 'junie'))),
  ]);

  const alreadyInstalled: string[] = [];
  if (hasClaude) alreadyInstalled.push('Claude Code');
  if (hasCodex) alreadyInstalled.push('Codex CLI');
  if (hasGemini) alreadyInstalled.push('Gemini CLI');
  if (hasOpenCode) alreadyInstalled.push('OpenCode');
  if (hasDroid) alreadyInstalled.push('Droid');
  if (hasJunie) alreadyInstalled.push('Junie');

  if (alreadyInstalled.length > 0) {
    ui.ok(`Already installed: ${alreadyInstalled.join(', ')}`);
  }

  // Build choices for tools not yet installed
  type DevTool = { name: string; label: string; desc: string };
  const available: DevTool[] = [];
  if (!hasClaude) available.push({ name: 'claude', label: 'Claude Code', desc: 'Anthropic AI coding assistant' });
  if (!hasCodex) available.push({ name: 'codex', label: 'Codex CLI', desc: 'OpenAI coding assistant' });
  if (!hasGemini) available.push({ name: 'gemini', label: 'Gemini CLI', desc: 'Google AI coding assistant' });
  if (!hasOpenCode) available.push({ name: 'opencode', label: 'OpenCode', desc: 'Open-source AI coding (local LLM)' });
  if (!hasDroid) available.push({ name: 'droid', label: 'Droid CLI', desc: 'Factory.ai AI coding assistant' });
  if (!hasJunie) available.push({ name: 'junie', label: 'Junie CLI', desc: 'JetBrains AI coding assistant' });

  if (available.length === 0) {
    ui.ok('All developer tools already installed');
    await configureOpenCode(ctx);
    return;
  }

  // ── Prompt user to select which tools to install ──
  if (!ctx.interactive) {
    ui.info('Non-interactive mode — skipping devtools install');
    ui.info(`Install later: dream-installer install --devtools`);
    return;
  }

  const { multiSelect } = await import('../lib/prompts.ts');
  const options = available.map(t => ({
    label: t.label,
    description: t.desc,
    checked: true,  // default: install all selected tools
  }));

  console.log('');
  const selected = await multiSelect(
    'Select developer tools to install',
    options,
  );

  const installClaude = available.findIndex(t => t.name === 'claude') >= 0
    && selected[available.findIndex(t => t.name === 'claude')];
  const installCodex = available.findIndex(t => t.name === 'codex') >= 0
    && selected[available.findIndex(t => t.name === 'codex')];
  const installGemini = available.findIndex(t => t.name === 'gemini') >= 0
    && selected[available.findIndex(t => t.name === 'gemini')];
  const installOpenCode = available.findIndex(t => t.name === 'opencode') >= 0
    && selected[available.findIndex(t => t.name === 'opencode')];
  const installDroid = available.findIndex(t => t.name === 'droid') >= 0
    && selected[available.findIndex(t => t.name === 'droid')];
  const installJunie = available.findIndex(t => t.name === 'junie') >= 0
    && selected[available.findIndex(t => t.name === 'junie')];

  if (!installClaude && !installCodex && !installGemini && !installOpenCode && !installDroid && !installJunie) {
    ui.info('No developer tools selected — skipping');
    return;
  }

  const home = homedir();
  const npmGlobalDir = join(home, '.npm-global');

  // ── npm-based tools (Claude Code, Codex CLI, Gemini CLI) ──
  if (installClaude || installCodex || installGemini) {
    const hasNpm = await commandExists('npm');
    if (!hasNpm) {
      ui.warn('npm not available — skipping CLI tool installs');
      if (installClaude) ui.info('  Install later: npm i -g @anthropic-ai/claude-code');
      if (installCodex) ui.info('  Install later: npm i -g @openai/codex');
      if (installGemini) ui.info('  Install later: npm i -g @google/gemini-cli');
    } else {
      // Set up user-level npm global prefix (no sudo needed)
      if (!existsSync(npmGlobalDir)) {
        mkdirSync(npmGlobalDir, { recursive: true });
        await exec(['npm', 'config', 'set', 'prefix', npmGlobalDir], { throwOnError: false });
      }

      const npmBin = join(npmGlobalDir, 'bin');
      if (!process.env.PATH?.includes(npmBin)) {
        process.env.PATH = `${npmBin}:${process.env.PATH}`;
      }

      if (installClaude) {
        try {
          await exec(['npm', 'install', '-g', '@anthropic-ai/claude-code'], { timeout: 120_000, throwOnError: false });
          ui.ok("Claude Code installed (run 'claude' to start)");
        } catch {
          ui.warn('Claude Code install failed — install later with: npm i -g @anthropic-ai/claude-code');
        }
      }

      if (installCodex) {
        try {
          await exec(['npm', 'install', '-g', '@openai/codex'], { timeout: 120_000, throwOnError: false });
          ui.ok("Codex CLI installed (run 'codex' to start)");
        } catch {
          ui.warn('Codex CLI install failed — install later with: npm i -g @openai/codex');
        }
      }

      if (installGemini) {
        try {
          await exec(['npm', 'install', '-g', '@google/gemini-cli'], { timeout: 120_000, throwOnError: false });
          ui.ok("Gemini CLI installed (run 'gemini' to start)");
        } catch {
          ui.warn('Gemini CLI install failed — install later with: npm i -g @google/gemini-cli');
        }
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
  }

  // ── OpenCode ──
  if (installOpenCode) {
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
      try { await exec(['rm', '-f', tmpFile], { throwOnError: false }); } catch { /* ignore */ }
    } catch {
      ui.warn('OpenCode install failed — install later with: curl -fsSL https://opencode.ai/install | bash');
    }
  }

  // ── Droid CLI (Factory.ai) ──
  if (installDroid) {
    ui.info('Installing Droid CLI...');
    try {
      const result = await exec(
        ['sh', '-c', 'curl -fsSL https://app.factory.ai/cli | sh'],
        { throwOnError: false, timeout: 120_000 },
      );
      if (result.exitCode === 0) {
        ui.ok("Droid CLI installed (run 'droid' to start)");
      } else {
        ui.warn('Droid CLI install failed — install later with: curl -fsSL https://app.factory.ai/cli | sh');
      }
    } catch {
      ui.warn('Droid CLI install failed — install later with: curl -fsSL https://app.factory.ai/cli | sh');
    }
  }

  // ── Junie CLI (JetBrains) ──
  if (installJunie) {
    ui.info('Installing Junie CLI...');
    try {
      const result = await exec(
        ['bash', '-c', 'curl -fsSL https://junie.jetbrains.com/install.sh | bash'],
        { throwOnError: false, timeout: 120_000 },
      );
      if (result.exitCode === 0) {
        ui.ok("Junie CLI installed (run 'junie' to start)");
        // Ensure ~/.local/bin is on PATH
        const home = homedir();
        const localBin = join(home, '.local', 'bin');
        if (existsSync(localBin) && !process.env.PATH?.includes(localBin)) {
          process.env.PATH = `${localBin}:${process.env.PATH}`;
        }
      } else {
        ui.warn('Junie CLI install failed — install later with: curl -fsSL https://junie.jetbrains.com/install.sh | bash');
      }
    } catch {
      ui.warn('Junie CLI install failed — install later with: curl -fsSL https://junie.jetbrains.com/install.sh | bash');
    }
  }

  // ── Configure OpenCode for local llama-server ──
  await configureOpenCode(ctx);
}

/**
 * Configure OpenCode for the local LLM server and install Web UI service.
 */
async function configureOpenCode(ctx: InstallContext): Promise<void> {
  const home = homedir();
  const opencodeBin = join(home, '.opencode', 'bin', 'opencode');
  if (!existsSync(opencodeBin)) return;

  const configDir = join(home, '.config', 'opencode');
  const configPath = join(configDir, 'opencode.json');

  if (!existsSync(configPath)) {
    mkdirSync(configDir, { recursive: true });

    const tierCfg = TIER_MAP[ctx.tier] || TIER_MAP['1'];
    const model = tierCfg.model;
    const context = tierCfg.context;

    const envPath = join(ctx.installDir, '.env');
    let llamaPort = '11434';
    if (existsSync(envPath)) {
      const envContent = readFileSync(envPath, 'utf-8');
      const portMatch = envContent.match(/^OLLAMA_PORT=(.*)$/m);
      if (portMatch && portMatch[1].trim()) llamaPort = portMatch[1].trim();
    }

    const config = {
      $schema: 'https://opencode.ai/config.json',
      model: `llama-server/${model}`,
      provider: {
        'llama-server': {
          npm: '@ai-sdk/openai-compatible',
          name: 'llama-server (local)',
          options: {
            baseURL: `http://127.0.0.1:${llamaPort}/v1`,
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
    ui.ok(`OpenCode configured for local llama-server (model: ${model}, port: ${llamaPort})`);
  } else {
    ui.ok('OpenCode config already exists — skipping');
  }

  // Install OpenCode Web UI as user-level systemd service (Linux only)
  if (process.platform === 'linux') {
    const svcSource = join(ctx.installDir, 'opencode', 'opencode-web.service');
    if (existsSync(svcSource)) {
      const systemdDir = join(home, '.config', 'systemd', 'user');
      mkdirSync(systemdDir, { recursive: true });

      let svcContent = readFileSync(svcSource, 'utf-8');
      svcContent = svcContent.replaceAll('__HOME__', home);

      const envPath = join(ctx.installDir, '.env');
      let password = '';
      if (existsSync(envPath)) {
        const envContent = readFileSync(envPath, 'utf-8');
        const match = envContent.match(/^OPENCODE_SERVER_PASSWORD=(.*)$/m);
        if (match) password = match[1];
      }
      svcContent = svcContent.replaceAll('__OPENCODE_SERVER_PASSWORD__', password);

      writeFileSync(join(systemdDir, 'opencode-web.service'), svcContent);

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

  // macOS: Install OpenCode Web UI as LaunchAgent
  if (process.platform === 'darwin') {
    const launchAgentsDir = join(home, 'Library', 'LaunchAgents');
    const plistName = 'com.dreamserver.opencode-web.plist';
    const plistPath = join(launchAgentsDir, plistName);

    mkdirSync(launchAgentsDir, { recursive: true });

    const envPath = join(ctx.installDir, '.env');
    let password = '';
    if (existsSync(envPath)) {
      const envContent = readFileSync(envPath, 'utf-8');
      const match = envContent.match(/^OPENCODE_SERVER_PASSWORD=(.*)$/m);
      if (match) password = match[1];
    }

    const plistContent = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.dreamserver.opencode-web</string>
  <key>ProgramArguments</key>
  <array>
    <string>${opencodeBin}</string>
    <string>web</string>
    <string>--port</string>
    <string>3003</string>
  </array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>OPENCODE_SERVER_PASSWORD</key>
    <string>${password}</string>
  </dict>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>${home}/Library/Logs/opencode-web.log</string>
  <key>StandardErrorPath</key>
  <string>${home}/Library/Logs/opencode-web.log</string>
</dict>
</plist>`;

    writeFileSync(plistPath, plistContent);

    const load = await exec(
      ['launchctl', 'bootstrap', `gui/${process.getuid?.() ?? 501}`, plistPath],
      { throwOnError: false, timeout: 10_000 },
    );
    if (load.exitCode === 0) {
      ui.ok('OpenCode Web UI LaunchAgent installed (auto-start on login, port 3003)');
    } else {
      const loadLegacy = await exec(
        ['launchctl', 'load', plistPath],
        { throwOnError: false, timeout: 10_000 },
      );
      if (loadLegacy.exitCode === 0) {
        ui.ok('OpenCode Web UI LaunchAgent installed (port 3003)');
      } else {
        ui.warn('LaunchAgent created but could not be loaded. Load manually:');
        ui.info(`  launchctl load ${plistPath}`);
      }
    }
  }
}
