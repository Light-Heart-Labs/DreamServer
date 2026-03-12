#!/usr/bin/env bun
// ── Dream Server CLI ────────────────────────────────────────────────────────

import { Command } from 'commander';
import { install } from './commands/install.ts';
import { status } from './commands/status.ts';
import { config } from './commands/config.ts';
import { update } from './commands/update.ts';
import { uninstall } from './commands/uninstall.ts';
import { doctor } from './commands/doctor.ts';
import { VERSION, DEFAULT_INSTALL_DIR } from './lib/config.ts';

const program = new Command()
  .name('dream-installer')
  .description('Dream Server — Local AI Management CLI')
  .version(VERSION)
  .option('-v, --verbose', 'Show detailed debug output during installation');

program
  .command('install')
  .description('Install or resume Dream Server setup')
  .option('--dry-run', 'Show what would be done without making changes')
  .option('--force', 'Overwrite existing installation')
  .option('--tier <tier>', 'Force specific tier (1-4, NV_ULTRA)')
  .option('--non-interactive', 'Run without prompts (use defaults)')
  .option('--all', 'Enable all optional services')
  .option('--voice', 'Enable voice services')
  .option('--workflows', 'Enable n8n workflows')
  .option('--rag', 'Enable RAG with Qdrant')
  .option('--openclaw', 'Enable OpenClaw agents')
  .option('--devtools', 'Install AI developer tools (Claude Code, Codex, OpenCode)')
  .option('--dir <path>', 'Installation directory', DEFAULT_INSTALL_DIR)
  .option('--offline', 'Configure for fully offline/air-gapped operation (M1 mode)')
  .action(install);

program
  .command('status')
  .description('Show running services, health, and configuration')
  .option('--dir <path>', 'Installation directory', DEFAULT_INSTALL_DIR)
  .action(status);

program
  .command('config')
  .description('Reconfigure features, tier, or model')
  .option('--features', 'Configure features only')
  .option('--tier', 'Configure tier/model only')
  .option('--dir <path>', 'Installation directory', DEFAULT_INSTALL_DIR)
  .action(config);

program
  .command('update')
  .description('Pull latest code, update images, and restart')
  .option('--skip-self-update', 'Skip CLI binary self-update')
  .option('--dir <path>', 'Installation directory', DEFAULT_INSTALL_DIR)
  .action(update);

program
  .command('uninstall')
  .description('Stop services, remove containers/images, and optionally delete data')
  .option('--keep-data', 'Keep data directory (models, databases, configs)')
  .option('--force', 'Skip confirmation prompts')
  .option('--dir <path>', 'Installation directory', DEFAULT_INSTALL_DIR)
  .action(uninstall);

program
  .command('doctor')
  .description('Run diagnostics and health checks')
  .option('--dir <path>', 'Installation directory', DEFAULT_INSTALL_DIR)
  .action(doctor);

// Default to install if no command specified
if (process.argv.length <= 2) {
  process.argv.push('install');
}

program.parse();
