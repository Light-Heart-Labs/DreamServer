// ── Configuration & Constants ───────────────────────────────────────────────

export const VERSION = '1.0.0';
export const REPO_URL = 'https://github.com/Light-Heart-Labs/DreamServer.git';
export const MIN_DRIVER_VERSION = 570;

import { getHome, getDefaultInstallDir, getOsName } from './platform.ts';

/**
 * Resolve the real user's home directory, even under sudo.
 * Delegates to platform.ts for cross-platform logic.
 */
export function getUserHome(): string {
  return getHome();
}

export const DEFAULT_INSTALL_DIR = getDefaultInstallDir();

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
  // vLLM-specific fields
  vllmModel: string;
  vllmArgs: string[];
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
    vllmModel: 'Qwen/Qwen3.5-4B',
    vllmArgs: ['--language-model-only', '--max-model-len', '4096'],
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
    vllmModel: 'Qwen/Qwen3.5-4B',
    vllmArgs: ['--language-model-only', '--max-model-len', '4096'],
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
    vllmModel: 'Qwen/Qwen3.5-4B',
    vllmArgs: ['--language-model-only', '--max-model-len', '16384'],
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
    vllmModel: 'Qwen/Qwen3.5-9B',
    vllmArgs: ['--language-model-only'],
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
    vllmModel: 'Qwen/Qwen3.5-32B',
    vllmArgs: ['--language-model-only'],
  },
};

export type FeatureSet = {
  voice: boolean;
  workflows: boolean;
  rag: boolean;
  openclaw: boolean;
  devtools: boolean;
};

export const FEATURE_PRESETS: Record<string, FeatureSet> = {
  full: { voice: true, workflows: true, rag: true, openclaw: true, devtools: true },
  core: { voice: false, workflows: false, rag: false, openclaw: false, devtools: false },
};

export type LlmBackend = 'llamacpp' | 'vllm' | 'ollama' | 'external';

export interface InstallContext {
  installDir: string;
  interactive: boolean;
  dryRun: boolean;
  force: boolean;
  verbose: boolean;
  tier: string;
  llmBackend: LlmBackend;
  features: FeatureSet;
  gpu: {
    backend: 'nvidia' | 'amd' | 'apple' | 'cpu';
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
  offlineMode: boolean;
  /** URL of an externally-managed LLM inference server (Ollama, vLLM, etc.) */
  externalLlmUrl: string | null;
}

export function createDefaultContext(): InstallContext {
  return {
    installDir: DEFAULT_INSTALL_DIR,
    interactive: true,
    dryRun: false,
    force: false,
    verbose: false,
    tier: '',
    llmBackend: 'llamacpp',
    features: { ...FEATURE_PRESETS.full },
    gpu: { backend: 'cpu', name: 'Not detected', vramMB: 0, count: 0 },
    system: { os: getOsName(), distro: '', ramGB: 0, diskGB: 0, arch: process.arch },
    tailscaleIp: null,
    offlineMode: false,
    externalLlmUrl: null,
  };
}
