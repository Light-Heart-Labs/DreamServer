// ── Configuration & Constants ───────────────────────────────────────────────

export const VERSION = '1.0.0';
export const REPO_URL = 'https://github.com/Light-Heart-Labs/DreamServer.git';
export const MIN_DRIVER_VERSION = 570;

import { homedir } from 'node:os';
import { execFileSync } from 'node:child_process';

/**
 * Resolve the real user's home directory, even under sudo.
 * When running `sudo dream-installer`, os.homedir() returns /root but we
 * want the original user's home. Falls back to getent lookup for non-standard
 * home directories (NFS, custom paths).
 */
export function getUserHome(): string {
  const sudoUser = process.env.SUDO_USER;
  if (sudoUser && process.getuid?.() === 0) {
    // Try getent for correct path regardless of home dir layout
    try {
      const result = execFileSync('getent', ['passwd', sudoUser], { encoding: 'utf-8', timeout: 2000 });
      const home = result.trim().split(':')[5];
      if (home) return home;
    } catch { /* fallback below */ }
    return `/home/${sudoUser}`;
  }
  return homedir() || process.env.HOME || '/root';
}

export const DEFAULT_INSTALL_DIR = `${getUserHome()}/dream-server`;

export interface TierConfig {
  name: string;
  model: string;
  ggufFile: string;
  ggufUrl: string;
  context: number;
  speed: number;
  users: string;
  minRam: number;
  minDisk: number;
}

export const TIER_MAP: Record<string, TierConfig> = {
  '1': {
    name: 'Entry Level',
    model: 'qwen3-8b',
    ggufFile: 'Qwen3-8B-Q4_K_M.gguf',
    ggufUrl: 'https://huggingface.co/unsloth/Qwen3-8B-GGUF/resolve/main/Qwen3-8B-Q4_K_M.gguf',
    context: 16384,
    speed: 25,
    users: '1-2',
    minRam: 16,
    minDisk: 30,
  },
  '2': {
    name: 'Prosumer',
    model: 'qwen3-8b',
    ggufFile: 'Qwen3-8B-Q4_K_M.gguf',
    ggufUrl: 'https://huggingface.co/unsloth/Qwen3-8B-GGUF/resolve/main/Qwen3-8B-Q4_K_M.gguf',
    context: 32768,
    speed: 45,
    users: '3-5',
    minRam: 32,
    minDisk: 50,
  },
  '3': {
    name: 'Pro',
    model: 'qwen3-14b',
    ggufFile: 'Qwen3-14B-Q4_K_M.gguf',
    ggufUrl: 'https://huggingface.co/unsloth/Qwen3-14B-GGUF/resolve/main/Qwen3-14B-Q4_K_M.gguf',
    context: 32768,
    speed: 55,
    users: '5-8',
    minRam: 48,
    minDisk: 80,
  },
  '4': {
    name: 'Enterprise',
    model: 'qwen3-30b-a3b',
    ggufFile: 'qwen3-30b-a3b-Q4_K_M.gguf',
    ggufUrl: 'https://huggingface.co/unsloth/Qwen3-30B-A3B-GGUF/resolve/main/Qwen3-30B-A3B-Q4_K_M.gguf',
    context: 131072,
    speed: 40,
    users: '10-15',
    minRam: 64,
    minDisk: 150,
  },
  NV_ULTRA: {
    name: 'NV Ultra',
    model: 'qwen3-coder-next',
    ggufFile: 'qwen3-coder-next-Q4_K_M.gguf',
    ggufUrl: 'https://huggingface.co/unsloth/Qwen3-Coder-Next-GGUF/resolve/main/Qwen3-Coder-Next-Q4_K_M.gguf',
    context: 131072,
    speed: 50,
    users: '10-20',
    minRam: 96,
    minDisk: 200,
  },
};

export type FeatureSet = {
  voice: boolean;
  workflows: boolean;
  rag: boolean;
  openclaw: boolean;
};

export const FEATURE_PRESETS: Record<string, FeatureSet> = {
  full: { voice: true, workflows: true, rag: true, openclaw: true },
  core: { voice: false, workflows: false, rag: false, openclaw: false },
};

export interface InstallContext {
  installDir: string;
  interactive: boolean;
  dryRun: boolean;
  force: boolean;
  tier: string;
  features: FeatureSet;
  gpu: {
    backend: 'nvidia' | 'amd' | 'cpu';
    name: string;
    vramMB: number;
    count: number;
  };
  system: {
    os: string;
    distro: string;
    ramGB: number;
    diskGB: number;
    arch: string;
  };
  tailscaleIp: string | null;
}

export function createDefaultContext(): InstallContext {
  return {
    installDir: DEFAULT_INSTALL_DIR,
    interactive: true,
    dryRun: false,
    force: false,
    tier: '',
    features: { ...FEATURE_PRESETS.full },
    gpu: { backend: 'cpu', name: 'Not detected', vramMB: 0, count: 0 },
    system: { os: 'linux', distro: '', ramGB: 0, diskGB: 0, arch: process.arch },
    tailscaleIp: null,
  };
}
