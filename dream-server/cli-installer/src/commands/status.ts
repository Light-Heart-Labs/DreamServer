// ── Status Command ──────────────────────────────────────────────────────────

import { exec } from '../lib/shell.ts';
import { getComposeCommand } from '../lib/docker.ts';
import { getDockerBaseCmd } from '../phases/services.ts';
import { DEFAULT_INSTALL_DIR } from '../lib/config.ts';
import { parseEnv } from '../lib/env.ts';
import { IS_MACOS, getPermissionFixHint, getRamGB } from '../lib/platform.ts';
import { isNativeLlamaRunning } from '../phases/native-metal.ts';
import * as ui from '../lib/ui.ts';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export interface StatusOptions {
  dir?: string;
}

export async function status(opts: StatusOptions): Promise<void> {
  const installDir = opts.dir || DEFAULT_INSTALL_DIR;

  if (!existsSync(join(installDir, '.env'))) {
    ui.fail('No Dream Server installation found');
    ui.info(`Expected at: ${installDir}`);
    ui.info('Run: dream-installer install');
    process.exit(1);
  }

  ui.header('Dream Server Status');
  console.log('');

  // Read .env for config info
  const envContent = readFileSync(join(installDir, '.env'), 'utf-8');
  const envParsed = parseEnv(envContent);
  const getEnv = (key: string): string => envParsed[key] || '';

  // Show current config
  const model = getEnv('LLM_MODEL');
  const gpuBackend = getEnv('GPU_BACKEND');
  const mode = getEnv('DREAM_MODE');

  ui.table([
    ['Mode', mode || 'local'],
    ['Model', model || 'unknown'],
    ['GPU', gpuBackend || 'cpu'],
    ['Install Dir', installDir],
  ]);
  console.log('');

  // Features
  const features = [
    getEnv('ENABLE_VOICE') === 'true' ? '✓ Voice' : '○ Voice',
    getEnv('ENABLE_WORKFLOWS') === 'true' ? '✓ Workflows' : '○ Workflows',
    getEnv('ENABLE_RAG') === 'true' ? '✓ RAG' : '○ RAG',
    getEnv('ENABLE_OPENCLAW') === 'true' ? '✓ OpenClaw' : '○ OpenClaw',
  ];
  ui.info(`Features: ${features.join('  ')}`);
  console.log('');

  // ── GPU / VRAM Status ──
  let composeCmd: string[] | undefined;
  try {
    composeCmd = await getComposeCommand();
  } catch { /* Docker unavailable, no compose cmd */ }

  const gpuInfo = await showGpuStatus(gpuBackend, installDir, composeCmd);
  console.log('');

  // ── Container status ──
  try {
    if (!composeCmd) composeCmd = await getComposeCommand();
  } catch (e) {
    ui.fail('Docker not available');
    if (e instanceof Error) ui.info(e.message);
    return;
  }

  ui.step('Container status:');
  let failingServices: { name: string; fullName: string; status: string }[] = [];
  try {
    const { stdout } = await exec(
      [...composeCmd, 'ps', '--format', 'json'],
      { cwd: installDir, throwOnError: false, timeout: 10000 },
    );

    if (!stdout.trim()) {
      ui.warn('No containers running');
      return;
    }

    let containers: Record<string, unknown>[] = [];
    const trimmed = stdout.trim();
    if (trimmed.startsWith('[')) {
      try { containers = JSON.parse(trimmed); } catch (e) {
        ui.info('Could not parse container JSON — falling back to line-by-line');
      }
    } else {
      for (const line of trimmed.split('\n')) {
        try { containers.push(JSON.parse(line)); } catch { /* non-JSON line, skip */ }
      }
    }

    const running: string[] = [];

    for (const c of containers) {
      const fullName = (c.Name ?? c.name ?? '') as string;
      const name = fullName.replace(/^dream-/, '');
      const state = ((c.State ?? c.state ?? '') as string).toLowerCase();
      const statusText = (c.Status ?? c.status ?? '') as string;

      if (state === 'running') {
        running.push(name);
      } else {
        failingServices.push({ name, fullName, status: statusText || state });
      }
    }

    if (running.length > 0) {
      ui.ok(`Running (${running.length}): ${running.join(', ')}`);
    }

    // Show failing containers with diagnostics
    for (const svc of failingServices) {
      ui.warn(`${svc.name} (${svc.status})`);
      const logs = await getContainerLogs(svc.fullName);
      if (logs) {
        const diagnosis = diagnoseFailure(svc.name, logs, gpuInfo);
        for (const line of logs.split('\n').slice(-3)) {
          console.log(`       ${line.trim()}`);
        }
        if (diagnosis) {
          console.log('');
          ui.info(`💡 ${diagnosis}`);
        }
      }
    }
  } catch (e) {
    // JSON parse failed — try plain text fallback
    try {
      const { stdout } = await exec(
        [...composeCmd, 'ps'],
        { cwd: installDir, throwOnError: false, timeout: 10000 },
      );
      if (stdout.trim()) console.log(stdout);
    } catch {
      ui.warn('Could not query container status');
    }
  }

  console.log('');

  // ── Health checks ──
  ui.step('Health checks:');
  const webuiPort = getEnv('WEBUI_PORT') || '3000';
  const dashPort = getEnv('DASHBOARD_PORT') || '3001';
  const llmBackend = getEnv('LLM_BACKEND') || 'llamacpp';

  // Build LLM health check based on backend type
  let llmCheck: { name: string; url: string };
  if (llmBackend === 'ollama') {
    const port = getEnv('OLLAMA_PORT') || '11434';
    llmCheck = { name: 'LLM (Ollama)', url: `http://localhost:${port}/api/tags` };
  } else if (llmBackend === 'external') {
    const url = getEnv('LLM_API_URL') || 'http://localhost:8080';
    llmCheck = { name: 'LLM (External)', url: `${url}/health` };
  } else {
    const port = getEnv('OLLAMA_PORT') || '8080';
    llmCheck = { name: 'LLM (llama-server)', url: `http://localhost:${port}/health` };
  }

  const checks = [
    { name: 'Chat (WebUI)', url: `http://localhost:${webuiPort}` },
    { name: 'Dashboard', url: `http://localhost:${dashPort}` },
    llmCheck,
  ];

  for (const check of checks) {
    try {
      const resp = await fetch(check.url, { signal: AbortSignal.timeout(3000) });
      if (resp.ok || resp.status === 401 || resp.status === 200) {
        ui.ok(check.name);
      } else {
        ui.warn(`${check.name} (HTTP ${resp.status})`);
      }
    } catch {
      ui.fail(`${check.name} — not responding`);
    }
  }

  console.log('');
}

// ── GPU / VRAM monitoring ─────────────────────────────────────────────────

interface GpuInfo {
  available: boolean;
  name: string;
  totalMB: number;
  usedMB: number;
  freeMB: number;
  processes: GpuProcess[];
}

interface GpuProcess {
  pid: number;
  name: string;
  memMB: number;
}

async function showGpuStatus(backend: string, installDir: string, composeCmd?: string[]): Promise<GpuInfo | null> {
  // Apple Silicon — show chip info and unified memory
  if (backend === 'apple') {
    try {
      let chipName = 'Apple Silicon';
      try {
        const { stdout, exitCode } = await exec(
          ['sysctl', '-n', 'machdep.cpu.brand_string'],
          { throwOnError: false, timeout: 3000 },
        );
        if (exitCode === 0 && stdout.trim()) chipName = stdout.trim();
      } catch { /* use default */ }

      const ramGB = getRamGB();
      ui.step(`GPU: ${chipName}`);
      console.log(`     Unified Memory: ${ramGB}GB (shared between CPU and GPU)`);

      // Check native Metal llama-server daemon
      const nativeStatus = await isNativeLlamaRunning(installDir);
      if (nativeStatus.running) {
        console.log('');
        ui.ok(`Native Metal llama-server running (PID ${nativeStatus.pid})`);
      } else {
        console.log('');
        ui.warn('Native Metal llama-server is NOT running.');
        ui.info('Docker on macOS runs LLM in CPU mode. Restart install for Metal GPU acceleration.');
      }

      return { available: true, name: chipName, totalMB: ramGB * 1024, usedMB: 0, freeMB: ramGB * 1024, processes: [] };
    } catch {
      return null;
    }
  }

  if (backend !== 'nvidia') {
    // AMD ROCm support could be added later
    return null;
  }

  try {
    // Get GPU summary
    const { stdout: gpuOut } = await exec(
      ['nvidia-smi', '--query-gpu=name,memory.total,memory.used,memory.free', '--format=csv,noheader,nounits'],
      { throwOnError: false, timeout: 5000 },
    );

    if (!gpuOut.trim()) return null;

    const [name, totalStr, usedStr, freeStr] = gpuOut.trim().split(', ').map(s => s.trim());
    const totalMB = parseInt(totalStr);
    const usedMB = parseInt(usedStr);
    const freeMB = parseInt(freeStr);
    const usedPct = Math.round((usedMB / totalMB) * 100);

    // Build VRAM bar
    const barWidth = 30;
    const filled = Math.round((usedMB / totalMB) * barWidth);
    const bar = '█'.repeat(filled) + '░'.repeat(barWidth - filled);
    const barColor = usedPct > 90 ? '\x1b[31m' : usedPct > 70 ? '\x1b[33m' : '\x1b[32m';
    const reset = '\x1b[0m';

    ui.step(`GPU: ${name}`);
    console.log(`     VRAM: ${barColor}${bar}${reset} ${usedMB}/${totalMB} MB (${freeMB} MB free)`);

    // Get per-process GPU usage
    const { stdout: procOut } = await exec(
      ['nvidia-smi', '--query-compute-apps=pid,process_name,used_gpu_memory', '--format=csv,noheader,nounits'],
      { throwOnError: false, timeout: 5000 },
    );

    const processes: GpuProcess[] = [];
    if (procOut.trim()) {
      for (const line of procOut.trim().split('\n')) {
        const parts = line.split(', ').map(s => s.trim());
        if (parts.length >= 3) {
          const pid = parseInt(parts[0]);
          const procName = parts[1].split('/').pop() || parts[1];
          const memMB = parseInt(parts[2]);
          processes.push({ pid, name: procName, memMB });
        }
      }

      if (processes.length > 0) {
        // Resolve container names for docker processes
        const containerMap = await getDockerPidMap(composeCmd);
        const sortedProcs = processes.sort((a, b) => b.memMB - a.memMB);

        console.log('');
        console.log('     VRAM consumers:');
        for (const proc of sortedProcs) {
          const container = containerMap.get(proc.pid);
          const label = container
            ? `🐳 ${container.replace('dream-', '')}`
            : `   ${proc.name}`;
          const pct = Math.round((proc.memMB / totalMB) * 100);
          console.log(`       ${label.padEnd(28)} ${String(proc.memMB).padStart(6)} MB  (${pct}%)`);
        }
      }
    }

    // Warning if VRAM is critically low
    if (freeMB < 2000) {
      console.log('');
      ui.warn(`Only ${freeMB} MB VRAM free — LLM may fail to load`);
      if (processes.length > 0) {
        ui.info('Stop GPU-heavy processes or use: dream-installer config --tier');
      }
    }

    return { available: true, name, totalMB, usedMB, freeMB, processes };
  } catch {
    return null;
  }
}

async function getDockerPidMap(composeCmd?: string[]): Promise<Map<number, string>> {
  const map = new Map<number, string>();
  const dockerCmd = composeCmd ? getDockerBaseCmd(composeCmd) : ['docker'];
  try {
    const { stdout } = await exec(
      [...dockerCmd, 'ps', '--format', '{{.ID}} {{.Names}}', '--no-trunc'],
      { throwOnError: false, timeout: 5000 },
    );
    if (!stdout.trim()) return map;

    for (const line of stdout.trim().split('\n')) {
      const [id, name] = line.split(' ');
      if (!id || !name) continue;
      try {
        // Use `docker top` to get ALL process PIDs in the container
        // This catches sub-processes (e.g. python inside comfyui)
        const { stdout: topOut } = await exec(
          [...dockerCmd, 'top', id, '-o', 'pid'],
          { throwOnError: false, timeout: 3000 },
        );
        for (const pidLine of topOut.trim().split('\n').slice(1)) {
          const pid = parseInt(pidLine.trim());
          if (pid > 0) map.set(pid, name);
        }
      } catch {
        // docker top may fail for stopped containers — expected
      }
    }
  } catch (e) {
    // Docker daemon unreachable or no containers — return empty map
  }
  return map;
}

// ── Failure diagnosis ───────────────────────────────────────────────────

async function getContainerLogs(containerName: string, composeCmd?: string[]): Promise<string | null> {
  const dockerCmd = composeCmd ? getDockerBaseCmd(composeCmd) : ['docker'];
  try {
    // Fetch enough lines for diagnosis (OOM errors appear before the final crash message)
    const { stdout, stderr } = await exec(
      [...dockerCmd, 'logs', '--tail', '20', containerName],
      { throwOnError: false, timeout: 5000 },
    );
    return (stderr || stdout).trim() || null;
  } catch {
    return null;
  }
}

function diagnoseFailure(serviceName: string, logs: string, gpuInfo: GpuInfo | null): string | null {
  const lower = logs.toLowerCase();

  // CUDA OOM — the most common and important failure
  if (lower.includes('out of memory') || lower.includes('cudamalloc failed') || lower.includes('cuda error')) {
    const freeStr = gpuInfo ? ` (${gpuInfo.freeMB} MB free)` : '';
    return `CUDA out of memory${freeStr}. Fix: stop other GPU processes, or switch to a smaller model:\n     dream-installer config --tier`;
  }

  // Permission errors
  if (lower.includes('permission denied') || lower.includes('eacces')) {
    return `Permission denied. ${getPermissionFixHint(`~/dream-server/data/${serviceName}`)}`;
  }

  // Connection refused (depends on another service)
  if (lower.includes('econnrefused') || lower.includes('connection refused')) {
    return `Cannot reach upstream service. Check if its dependency is running.`;
  }

  // Model file not found
  if (lower.includes('failed to load model') || lower.includes('model file not found')) {
    return `Model file missing. Re-download: dream-installer install`;
  }

  // Config missing
  if (lower.includes('no configuration file') || (lower.includes('config') && lower.includes('not found'))) {
    return `Configuration missing. Re-run: dream-installer install`;
  }

  return null;
}
