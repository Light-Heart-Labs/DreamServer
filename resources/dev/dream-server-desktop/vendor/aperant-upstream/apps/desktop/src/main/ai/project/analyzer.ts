/**
 * Main Project Analyzer
 * =====================
 *
 * Orchestrates project analysis to build dynamic security profiles.
 * Coordinates stack detection, framework detection, and structure analysis.
 *
 * See apps/desktop/src/main/ai/project/analyzer.ts for the TypeScript implementation.
 */

import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';

import {
  BASE_COMMANDS,
  CLOUD_COMMANDS,
  CODE_QUALITY_COMMANDS,
  DATABASE_COMMANDS,
  FRAMEWORK_COMMANDS,
  INFRASTRUCTURE_COMMANDS,
  LANGUAGE_COMMANDS,
  PACKAGE_MANAGER_COMMANDS,
  VERSION_MANAGER_COMMANDS,
} from './command-registry';
import { FrameworkDetector } from './framework-detector';
import { StackDetector } from './stack-detector';
import {
  createCustomScripts,
  createProjectSecurityProfile,
  createTechnologyStack,
} from './types';
import type {
  CustomScripts,
  ProjectSecurityProfile,
  SerializedSecurityProfile,
} from './types';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const PROFILE_FILENAME = '.auto-claude-security.json';
const CUSTOM_ALLOWLIST_FILENAME = '.auto-claude-allowlist';

const HASH_FILES = [
  'package.json',
  'package-lock.json',
  'yarn.lock',
  'pnpm-lock.yaml',
  'pyproject.toml',
  'requirements.txt',
  'Pipfile',
  'poetry.lock',
  'Cargo.toml',
  'Cargo.lock',
  'go.mod',
  'go.sum',
  'Gemfile',
  'Gemfile.lock',
  'composer.json',
  'composer.lock',
  'pubspec.yaml',
  'pubspec.lock',
  'pom.xml',
  'build.gradle',
  'build.gradle.kts',
  'settings.gradle',
  'settings.gradle.kts',
  'build.sbt',
  'Package.swift',
  'Makefile',
  'Dockerfile',
  'docker-compose.yml',
  'docker-compose.yaml',
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function readTextFile(filePath: string): string | null {
  try {
    return fs.readFileSync(filePath, 'utf-8');
  } catch {
    return null;
  }
}

function readJsonFile(filePath: string): Record<string, unknown> | null {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8')) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function getFileMtime(filePath: string): number | null {
  try {
    return fs.statSync(filePath).mtimeMs;
  } catch {
    return null;
  }
}

function getFileSize(filePath: string): number | null {
  try {
    return fs.statSync(filePath).size;
  } catch {
    return null;
  }
}

function collectGlobFiles(dir: string, ext: string, depth: number): string[] {
  if (depth > 6) return [];
  const results: string[] = [];
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
      const fullPath = path.join(dir, entry.name);
      if (entry.isFile() && entry.name.endsWith(ext)) {
        results.push(fullPath);
      } else if (entry.isDirectory()) {
        results.push(...collectGlobFiles(fullPath, ext, depth + 1));
      }
    }
  } catch {
    // ignore
  }
  return results;
}

// ---------------------------------------------------------------------------
// Structure analysis (replaces StructureAnalyzer)
// ---------------------------------------------------------------------------

function detectNpmScripts(projectDir: string): string[] {
  try {
    const pkg = readJsonFile(path.join(projectDir, 'package.json'));
    if (pkg && typeof pkg.scripts === 'object' && pkg.scripts !== null) {
      return Object.keys(pkg.scripts as Record<string, unknown>);
    }
  } catch {
    // ignore
  }
  return [];
}

function detectMakefileTargets(projectDir: string): string[] {
  const targets: string[] = [];
  const content = readTextFile(path.join(projectDir, 'Makefile'));
  if (!content) return targets;

  for (const line of content.split('\n')) {
    const match = line.match(/^([a-zA-Z_][a-zA-Z0-9_-]*)\s*:/);
    if (match && !match[1].startsWith('.')) {
      targets.push(match[1]);
    }
  }
  return targets;
}

function detectPoetryScripts(projectDir: string): string[] {
  const scripts: string[] = [];
  const content = readTextFile(path.join(projectDir, 'pyproject.toml'));
  if (!content) return scripts;

  // Look for [tool.poetry.scripts] or [project.scripts] section
  const poetryScripts = content.match(/\[tool\.poetry\.scripts\]([\s\S]*?)(?=\[|$)/);
  if (poetryScripts) {
    const matches = poetryScripts[1].matchAll(/^([a-zA-Z0-9_-]+)\s*=/gm);
    for (const m of matches) {
      scripts.push(m[1]);
    }
  }

  const projectScripts = content.match(/\[project\.scripts\]([\s\S]*?)(?=\[|$)/);
  if (projectScripts) {
    const matches = projectScripts[1].matchAll(/^([a-zA-Z0-9_-]+)\s*=/gm);
    for (const m of matches) {
      scripts.push(m[1]);
    }
  }
  return scripts;
}

function detectShellScripts(projectDir: string): string[] {
  const scripts: string[] = [];
  try {
    const entries = fs.readdirSync(projectDir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isFile() && (entry.name.endsWith('.sh') || entry.name.endsWith('.bash'))) {
        scripts.push(entry.name);
      }
    }
  } catch {
    // ignore
  }
  return scripts;
}

function loadCustomAllowlist(projectDir: string): Set<string> {
  const commands = new Set<string>();
  const content = readTextFile(path.join(projectDir, CUSTOM_ALLOWLIST_FILENAME));
  if (!content) return commands;

  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith('#')) {
      commands.add(trimmed);
    }
  }
  return commands;
}

function analyzeStructure(projectDir: string): {
  customScripts: CustomScripts;
  scriptCommands: Set<string>;
  customCommands: Set<string>;
} {
  const customScripts = createCustomScripts();
  const scriptCommands = new Set<string>();

  customScripts.npmScripts = detectNpmScripts(projectDir);
  if (customScripts.npmScripts.length > 0) {
    scriptCommands.add('npm');
    scriptCommands.add('yarn');
    scriptCommands.add('pnpm');
    scriptCommands.add('bun');
  }

  customScripts.makeTargets = detectMakefileTargets(projectDir);
  if (customScripts.makeTargets.length > 0) {
    scriptCommands.add('make');
  }

  customScripts.poetryScripts = detectPoetryScripts(projectDir);
  customScripts.shellScripts = detectShellScripts(projectDir);
  for (const script of customScripts.shellScripts) {
    scriptCommands.add(`./${script}`);
  }

  const customCommands = loadCustomAllowlist(projectDir);

  return { customScripts, scriptCommands, customCommands };
}

// ---------------------------------------------------------------------------
// Profile serialization
// ---------------------------------------------------------------------------

function profileToDict(profile: ProjectSecurityProfile): SerializedSecurityProfile {
  const result: SerializedSecurityProfile = {
    base_commands: [...profile.baseCommands].sort(),
    stack_commands: [...profile.stackCommands].sort(),
    script_commands: [...profile.scriptCommands].sort(),
    custom_commands: [...profile.customCommands].sort(),
    detected_stack: {
      languages: profile.detectedStack.languages,
      package_managers: profile.detectedStack.packageManagers,
      frameworks: profile.detectedStack.frameworks,
      databases: profile.detectedStack.databases,
      infrastructure: profile.detectedStack.infrastructure,
      cloud_providers: profile.detectedStack.cloudProviders,
      code_quality_tools: profile.detectedStack.codeQualityTools,
      version_managers: profile.detectedStack.versionManagers,
    },
    custom_scripts: {
      npm_scripts: profile.customScripts.npmScripts,
      make_targets: profile.customScripts.makeTargets,
      poetry_scripts: profile.customScripts.poetryScripts,
      cargo_aliases: profile.customScripts.cargoAliases,
      shell_scripts: profile.customScripts.shellScripts,
    },
    project_dir: profile.projectDir,
    created_at: profile.createdAt,
    project_hash: profile.projectHash,
  };

  if (profile.inheritedFrom) {
    result.inherited_from = profile.inheritedFrom;
  }

  return result;
}

function profileFromDict(data: SerializedSecurityProfile): ProjectSecurityProfile {
  const toStringArray = (val: unknown): string[] =>
    Array.isArray(val) ? (val as string[]) : [];

  const stack = createTechnologyStack();
  if (data.detected_stack) {
    stack.languages = toStringArray(data.detected_stack.languages);
    stack.packageManagers = toStringArray(data.detected_stack.package_managers);
    stack.frameworks = toStringArray(data.detected_stack.frameworks);
    stack.databases = toStringArray(data.detected_stack.databases);
    stack.infrastructure = toStringArray(data.detected_stack.infrastructure);
    stack.cloudProviders = toStringArray(data.detected_stack.cloud_providers);
    stack.codeQualityTools = toStringArray(data.detected_stack.code_quality_tools);
    stack.versionManagers = toStringArray(data.detected_stack.version_managers);
  }

  const customScripts = createCustomScripts();
  if (data.custom_scripts) {
    customScripts.npmScripts = toStringArray(data.custom_scripts.npm_scripts);
    customScripts.makeTargets = toStringArray(data.custom_scripts.make_targets);
    customScripts.poetryScripts = toStringArray(data.custom_scripts.poetry_scripts);
    customScripts.cargoAliases = toStringArray(data.custom_scripts.cargo_aliases);
    customScripts.shellScripts = toStringArray(data.custom_scripts.shell_scripts);
  }

  const baseCommands = new Set(toStringArray(data.base_commands));
  const stackCommands = new Set(toStringArray(data.stack_commands));
  const scriptCommands = new Set(toStringArray(data.script_commands));
  const customCommands = new Set(toStringArray(data.custom_commands));

  return {
    baseCommands,
    stackCommands,
    scriptCommands,
    customCommands,
    detectedStack: stack,
    customScripts,
    projectDir: data.project_dir ?? '',
    createdAt: data.created_at ?? '',
    projectHash: data.project_hash ?? '',
    inheritedFrom: data.inherited_from ?? '',
    getAllAllowedCommands(): Set<string> {
      return new Set([
        ...this.baseCommands,
        ...this.stackCommands,
        ...this.scriptCommands,
        ...this.customCommands,
      ]);
    },
  };
}

// ---------------------------------------------------------------------------
// Project Analyzer
// ---------------------------------------------------------------------------

export class ProjectAnalyzer {
  private projectDir: string;
  private specDir: string | null;
  private profile: ProjectSecurityProfile;

  constructor(projectDir: string, specDir?: string) {
    this.projectDir = path.resolve(projectDir);
    this.specDir = specDir ? path.resolve(specDir) : null;
    this.profile = createProjectSecurityProfile();
  }

  getProfilePath(): string {
    const dir = this.specDir ?? this.projectDir;
    return path.join(dir, PROFILE_FILENAME);
  }

  loadProfile(): ProjectSecurityProfile | null {
    const profilePath = this.getProfilePath();
    if (!fs.existsSync(profilePath)) return null;

    try {
      const raw = fs.readFileSync(profilePath, 'utf-8');
      const data = JSON.parse(raw) as SerializedSecurityProfile;
      return profileFromDict(data);
    } catch {
      return null;
    }
  }

  saveProfile(profile: ProjectSecurityProfile): void {
    const profilePath = this.getProfilePath();
    fs.mkdirSync(path.dirname(profilePath), { recursive: true });
    fs.writeFileSync(profilePath, JSON.stringify(profileToDict(profile), null, 2), 'utf-8');
  }

  computeProjectHash(): string {
    const hasher = crypto.createHash('md5');
    let filesFound = 0;

    for (const filename of HASH_FILES) {
      const filePath = path.join(this.projectDir, filename);
      const mtime = getFileMtime(filePath);
      const size = getFileSize(filePath);
      if (mtime !== null && size !== null) {
        hasher.update(`${filename}:${mtime}:${size}`);
        filesFound++;
      }
    }

    // Check C# glob patterns
    for (const ext of ['.csproj', '.sln', '.fsproj', '.vbproj']) {
      const files = collectGlobFiles(this.projectDir, ext, 0);
      for (const filePath of files) {
        const mtime = getFileMtime(filePath);
        const size = getFileSize(filePath);
        if (mtime !== null && size !== null) {
          const relPath = path.relative(this.projectDir, filePath);
          hasher.update(`${relPath}:${mtime}:${size}`);
          filesFound++;
        }
      }
    }

    // Fallback: count source files
    if (filesFound === 0) {
      for (const ext of ['.py', '.js', '.ts', '.go', '.rs', '.dart', '.cs', '.swift', '.kt', '.java']) {
        const count = collectGlobFiles(this.projectDir, ext, 0).length;
        hasher.update(`${ext}:${count}`);
      }
      hasher.update(path.basename(this.projectDir));
    }

    return hasher.digest('hex');
  }

  private isDescendantOf(child: string, parent: string): boolean {
    try {
      const resolvedChild = path.resolve(child);
      const resolvedParent = path.resolve(parent);
      return resolvedChild.startsWith(resolvedParent + path.sep) || resolvedChild === resolvedParent;
    } catch {
      return false;
    }
  }

  shouldReanalyze(profile: ProjectSecurityProfile): boolean {
    if (profile.inheritedFrom) {
      const parent = profile.inheritedFrom;
      if (
        fs.existsSync(parent) &&
        fs.statSync(parent).isDirectory() &&
        this.isDescendantOf(this.projectDir, parent) &&
        fs.existsSync(path.join(parent, PROFILE_FILENAME))
      ) {
        return false;
      }
    }

    const currentHash = this.computeProjectHash();
    return currentHash !== profile.projectHash;
  }

  analyze(force = false): ProjectSecurityProfile {
    const existing = this.loadProfile();
    if (existing && !force && !this.shouldReanalyze(existing)) {
      return existing;
    }

    this.profile = createProjectSecurityProfile();
    this.profile.baseCommands = new Set(BASE_COMMANDS);
    this.profile.projectDir = this.projectDir;

    // Detect stack
    const stackDetector = new StackDetector(this.projectDir);
    this.profile.detectedStack = stackDetector.detectAll();

    // Detect frameworks
    const frameworkDetector = new FrameworkDetector(this.projectDir);
    this.profile.detectedStack.frameworks = frameworkDetector.detectAll();

    // Analyze structure
    const { customScripts, scriptCommands, customCommands } = analyzeStructure(this.projectDir);
    this.profile.customScripts = customScripts;
    this.profile.scriptCommands = scriptCommands;
    this.profile.customCommands = customCommands;

    // Build stack commands
    this.buildStackCommands();

    // Finalize
    this.profile.createdAt = new Date().toISOString();
    this.profile.projectHash = this.computeProjectHash();

    this.saveProfile(this.profile);

    return this.profile;
  }

  private buildStackCommands(): void {
    const stack = this.profile.detectedStack;
    const commands = this.profile.stackCommands;

    const addCommands = (registry: Record<string, string[]>, keys: string[]): void => {
      for (const key of keys) {
        const cmds = registry[key];
        if (cmds) {
          for (const cmd of cmds) {
            commands.add(cmd);
          }
        }
      }
    };

    addCommands(LANGUAGE_COMMANDS, stack.languages);
    addCommands(PACKAGE_MANAGER_COMMANDS, stack.packageManagers);
    addCommands(FRAMEWORK_COMMANDS, stack.frameworks);
    addCommands(DATABASE_COMMANDS, stack.databases);
    addCommands(INFRASTRUCTURE_COMMANDS, stack.infrastructure);
    addCommands(CLOUD_COMMANDS, stack.cloudProviders);
    addCommands(CODE_QUALITY_COMMANDS, stack.codeQualityTools);
    addCommands(VERSION_MANAGER_COMMANDS, stack.versionManagers);
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Analyze a project and return its security profile.
 */
export async function analyzeProject(
  projectDir: string,
  specDir?: string,
  force = false,
): Promise<ProjectSecurityProfile> {
  const analyzer = new ProjectAnalyzer(projectDir, specDir);
  return analyzer.analyze(force);
}

/**
 * Build a SecurityProfile (as used by bash-validator.ts) from project analysis.
 *
 * This converts the ProjectSecurityProfile into the minimal SecurityProfile
 * interface required by the security system.
 */
export function buildSecurityProfile(profile: ProjectSecurityProfile): {
  baseCommands: Set<string>;
  stackCommands: Set<string>;
  scriptCommands: Set<string>;
  customCommands: Set<string>;
  customScripts: { shellScripts: string[] };
  getAllAllowedCommands(): Set<string>;
} {
  return {
    baseCommands: profile.baseCommands,
    stackCommands: profile.stackCommands,
    scriptCommands: profile.scriptCommands,
    customCommands: profile.customCommands,
    customScripts: {
      shellScripts: profile.customScripts.shellScripts,
    },
    getAllAllowedCommands(): Set<string> {
      return new Set([
        ...this.baseCommands,
        ...this.stackCommands,
        ...this.scriptCommands,
        ...this.customCommands,
      ]);
    },
  };
}
