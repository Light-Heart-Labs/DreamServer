/**
 * Project Indexer
 * ===============
 *
 * Generates project_index.json by analyzing project structure, detecting
 * services, frameworks, infrastructure, and conventions.
 *
 * Replaces the Python backend/analyzer.py subprocess for project indexing.
 * Output format matches the ProjectIndex interface used by the frontend.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

import type {
  ConventionsInfo,
  InfrastructureInfo,
  ProjectIndex,
  ServiceInfo,
} from '../../../shared/types';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SKIP_DIRS = new Set([
  'node_modules',
  '.git',
  '__pycache__',
  '.venv',
  'venv',
  'dist',
  'build',
  '.next',
  '.nuxt',
  'target',
  'vendor',
  '.auto-claude',
  'coverage',
  '.nyc_output',
]);

const SERVICE_ROOT_FILES = [
  'package.json',
  'requirements.txt',
  'pyproject.toml',
  'Cargo.toml',
  'go.mod',
  'Gemfile',
  'composer.json',
  'pom.xml',
  'build.gradle',
];

const MONOREPO_INDICATORS = [
  'pnpm-workspace.yaml',
  'lerna.json',
  'nx.json',
  'turbo.json',
  'rush.json',
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function exists(filePath: string): boolean {
  return fs.existsSync(filePath);
}

function readTextFile(filePath: string): string | null {
  try {
    return fs.readFileSync(filePath, 'utf-8');
  } catch {
    return null;
  }
}

function readJsonFile(filePath: string): Record<string, unknown> | null {
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(content) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function isDirectory(filePath: string): boolean {
  try {
    return fs.statSync(filePath).isDirectory();
  } catch {
    return false;
  }
}

function listDirectory(dirPath: string): fs.Dirent[] {
  try {
    return fs.readdirSync(dirPath, { withFileTypes: true });
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Language / Framework detection
// ---------------------------------------------------------------------------

interface DetectedService {
  language: string | null;
  framework: string | null;
  type: ServiceInfo['type'];
  package_manager: string | null;
  testing?: string;
  e2e_testing?: string;
  test_directory?: string;
}

function detectLanguageAndFramework(serviceDir: string): DetectedService {
  const result: DetectedService = {
    language: null,
    framework: null,
    type: 'unknown',
    package_manager: null,
  };

  // TypeScript / JavaScript
  if (exists(path.join(serviceDir, 'package.json'))) {
    const pkg = readJsonFile(path.join(serviceDir, 'package.json'));
    if (pkg) {
      const allDeps: Record<string, unknown> = {
        ...((pkg.dependencies as Record<string, unknown>) ?? {}),
        ...((pkg.devDependencies as Record<string, unknown>) ?? {}),
      };

      const hasTsconfig = exists(path.join(serviceDir, 'tsconfig.json'));
      const hasTsDep = 'typescript' in allDeps;
      result.language = hasTsconfig || hasTsDep ? 'TypeScript' : 'JavaScript';

      // Framework detection
      if ('next' in allDeps) {
        result.framework = 'Next.js';
        result.type = 'frontend';
      } else if ('react' in allDeps && ('@vitejs/plugin-react' in allDeps || 'vite' in allDeps)) {
        result.framework = 'React + Vite';
        result.type = 'frontend';
      } else if ('react' in allDeps) {
        result.framework = 'React';
        result.type = 'frontend';
      } else if ('vue' in allDeps) {
        result.framework = 'Vue.js';
        result.type = 'frontend';
      } else if ('svelte' in allDeps) {
        result.framework = 'Svelte';
        result.type = 'frontend';
      } else if ('nuxt' in allDeps) {
        result.framework = 'Nuxt.js';
        result.type = 'frontend';
      } else if ('express' in allDeps) {
        result.framework = 'Express';
        result.type = 'backend';
      } else if ('fastify' in allDeps) {
        result.framework = 'Fastify';
        result.type = 'backend';
      } else if ('koa' in allDeps) {
        result.framework = 'Koa';
        result.type = 'backend';
      } else if ('electron' in allDeps) {
        result.framework = 'Electron';
        result.type = 'desktop';
      } else if ('hono' in allDeps) {
        result.framework = 'Hono';
        result.type = 'backend';
      } else if ('@nestjs/core' in allDeps) {
        result.framework = 'NestJS';
        result.type = 'backend';
      }

      // Testing detection
      if ('vitest' in allDeps) {
        result.testing = 'Vitest';
      } else if ('jest' in allDeps) {
        result.testing = 'Jest';
      } else if ('mocha' in allDeps) {
        result.testing = 'Mocha';
      }

      if ('@playwright/test' in allDeps) {
        result.e2e_testing = 'Playwright';
      } else if ('cypress' in allDeps) {
        result.e2e_testing = 'Cypress';
      }
    }

    // Package manager
    if (exists(path.join(serviceDir, 'package-lock.json'))) {
      result.package_manager = 'npm';
    } else if (exists(path.join(serviceDir, 'yarn.lock'))) {
      result.package_manager = 'yarn';
    } else if (exists(path.join(serviceDir, 'pnpm-lock.yaml'))) {
      result.package_manager = 'pnpm';
    } else if (exists(path.join(serviceDir, 'bun.lockb')) || exists(path.join(serviceDir, 'bun.lock'))) {
      result.package_manager = 'bun';
    } else {
      result.package_manager = 'npm';
    }

    return result;
  }

  // Python
  if (
    exists(path.join(serviceDir, 'requirements.txt')) ||
    exists(path.join(serviceDir, 'pyproject.toml')) ||
    exists(path.join(serviceDir, 'Pipfile'))
  ) {
    result.language = 'Python';

    const pyprojectContent = readTextFile(path.join(serviceDir, 'pyproject.toml')) ?? '';
    const requirementsContent = readTextFile(path.join(serviceDir, 'requirements.txt')) ?? '';
    const allText = pyprojectContent + requirementsContent;

    if (allText.includes('fastapi') || allText.includes('FastAPI')) {
      result.framework = 'FastAPI';
      result.type = 'backend';
    } else if (allText.includes('django')) {
      result.framework = 'Django';
      result.type = 'backend';
    } else if (allText.includes('flask')) {
      result.framework = 'Flask';
      result.type = 'backend';
    } else if (allText.includes('litestar')) {
      result.framework = 'Litestar';
      result.type = 'backend';
    } else if (allText.includes('starlette')) {
      result.framework = 'Starlette';
      result.type = 'backend';
    } else if (allText.includes('typer') || allText.includes('click')) {
      result.framework = null;
      result.type = 'backend';
    } else {
      result.type = 'backend';
    }

    // Package manager
    if (exists(path.join(serviceDir, 'uv.lock'))) {
      result.package_manager = 'uv';
    } else if (exists(path.join(serviceDir, 'poetry.lock'))) {
      result.package_manager = 'poetry';
    } else if (exists(path.join(serviceDir, 'Pipfile'))) {
      result.package_manager = 'pipenv';
    } else if (exists(path.join(serviceDir, 'pyproject.toml'))) {
      result.package_manager = 'pip';
    } else {
      result.package_manager = 'pip';
    }

    // Testing
    if (
      exists(path.join(serviceDir, 'pytest.ini')) ||
      pyprojectContent.includes('[tool.pytest') ||
      exists(path.join(serviceDir, 'setup.cfg'))
    ) {
      result.testing = 'pytest';
    }

    return result;
  }

  // Rust
  if (exists(path.join(serviceDir, 'Cargo.toml'))) {
    result.language = 'Rust';
    result.package_manager = 'cargo';
    result.type = 'backend';
    return result;
  }

  // Go
  if (exists(path.join(serviceDir, 'go.mod'))) {
    result.language = 'Go';
    result.package_manager = 'go_mod';
    result.type = 'backend';
    const goMod = readTextFile(path.join(serviceDir, 'go.mod')) ?? '';
    if (goMod.includes('gin-gonic')) {
      result.framework = 'Gin';
    } else if (goMod.includes('echo')) {
      result.framework = 'Echo';
    } else if (goMod.includes('fiber')) {
      result.framework = 'Fiber';
    }
    return result;
  }

  // Ruby
  if (exists(path.join(serviceDir, 'Gemfile'))) {
    result.language = 'Ruby';
    result.package_manager = 'gem';
    const gemfileContent = readTextFile(path.join(serviceDir, 'Gemfile')) ?? '';
    if (gemfileContent.includes('rails')) {
      result.framework = 'Ruby on Rails';
      result.type = 'backend';
    } else if (gemfileContent.includes('sinatra')) {
      result.framework = 'Sinatra';
      result.type = 'backend';
    } else {
      result.type = 'backend';
    }
    return result;
  }

  // PHP
  if (exists(path.join(serviceDir, 'composer.json'))) {
    result.language = 'PHP';
    result.package_manager = 'composer';
    const composer = readJsonFile(path.join(serviceDir, 'composer.json'));
    const phpDeps: Record<string, unknown> = {
      ...((composer?.require as Record<string, unknown>) ?? {}),
    };
    if ('laravel/framework' in phpDeps) {
      result.framework = 'Laravel';
    } else if ('symfony/symfony' in phpDeps) {
      result.framework = 'Symfony';
    }
    result.type = 'backend';
    return result;
  }

  // Java
  if (exists(path.join(serviceDir, 'pom.xml'))) {
    result.language = 'Java';
    result.package_manager = 'maven';
    result.type = 'backend';
    return result;
  }

  if (
    exists(path.join(serviceDir, 'build.gradle')) ||
    exists(path.join(serviceDir, 'build.gradle.kts'))
  ) {
    // Could be Java or Kotlin
    const gradleContent =
      readTextFile(path.join(serviceDir, 'build.gradle')) ??
      readTextFile(path.join(serviceDir, 'build.gradle.kts')) ??
      '';
    result.language = gradleContent.includes('kotlin') ? 'Kotlin' : 'Java';
    result.package_manager = 'gradle';
    result.type = 'backend';
    return result;
  }

  return result;
}

// ---------------------------------------------------------------------------
// Service type inference from name
// ---------------------------------------------------------------------------

function inferTypeFromName(
  name: string,
  detectedType: ServiceInfo['type'],
): ServiceInfo['type'] {
  if (detectedType && detectedType !== 'unknown') return detectedType;

  const lower = name.toLowerCase();
  if (['frontend', 'client', 'web', 'ui', 'app'].some((kw) => lower.includes(kw))) {
    return 'frontend';
  }
  if (['backend', 'api', 'server', 'service'].some((kw) => lower.includes(kw))) {
    return 'backend';
  }
  if (['worker', 'job', 'queue', 'task', 'celery'].some((kw) => lower.includes(kw))) {
    return 'worker';
  }
  if (['scraper', 'crawler', 'spider'].some((kw) => lower.includes(kw))) {
    return 'scraper';
  }
  if (['proxy', 'gateway', 'router'].some((kw) => lower.includes(kw))) {
    return 'proxy';
  }
  if (['lib', 'shared', 'common', 'core', 'utils'].some((kw) => lower.includes(kw))) {
    return 'library';
  }
  return 'unknown';
}

// ---------------------------------------------------------------------------
// Entry point detection
// ---------------------------------------------------------------------------

function detectEntryPoint(serviceDir: string): string | undefined {
  const patterns = [
    'main.py',
    'app.py',
    '__main__.py',
    'server.py',
    'wsgi.py',
    'asgi.py',
    'index.ts',
    'index.js',
    'main.ts',
    'main.js',
    'server.ts',
    'server.js',
    'app.ts',
    'app.js',
    'src/index.ts',
    'src/index.js',
    'src/main.ts',
    'src/app.ts',
    'src/server.ts',
    'src/App.tsx',
    'src/App.jsx',
    'pages/_app.tsx',
    'pages/_app.js',
    'main.go',
    'cmd/main.go',
    'src/main.rs',
    'src/lib.rs',
  ];

  for (const pattern of patterns) {
    if (exists(path.join(serviceDir, pattern))) {
      return pattern;
    }
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Key directories detection
// ---------------------------------------------------------------------------

function detectKeyDirectories(
  serviceDir: string,
): Record<string, { path: string; purpose: string }> | undefined {
  const patterns: Record<string, string> = {
    src: 'Source code',
    lib: 'Library code',
    app: 'Application code',
    api: 'API endpoints',
    routes: 'Route handlers',
    controllers: 'Controllers',
    models: 'Data models',
    schemas: 'Schemas/DTOs',
    services: 'Business logic',
    components: 'UI components',
    pages: 'Page components',
    views: 'Views/templates',
    hooks: 'Custom hooks',
    utils: 'Utilities',
    helpers: 'Helper functions',
    middleware: 'Middleware',
    tests: 'Tests',
    test: 'Tests',
    __tests__: 'Tests',
    config: 'Configuration',
    tasks: 'Background tasks',
    jobs: 'Background jobs',
    workers: 'Worker processes',
  };

  const result: Record<string, { path: string; purpose: string }> = {};

  for (const [dirName, purpose] of Object.entries(patterns)) {
    const dirPath = path.join(serviceDir, dirName);
    if (exists(dirPath) && isDirectory(dirPath)) {
      result[dirName] = { path: dirName, purpose };
    }
  }

  return Object.keys(result).length > 0 ? result : undefined;
}

// ---------------------------------------------------------------------------
// Dependencies detection
// ---------------------------------------------------------------------------

function detectDependencies(serviceDir: string): {
  dependencies?: string[];
  dev_dependencies?: string[];
} {
  if (exists(path.join(serviceDir, 'package.json'))) {
    const pkg = readJsonFile(path.join(serviceDir, 'package.json'));
    if (pkg) {
      const deps = Object.keys((pkg.dependencies as Record<string, unknown>) ?? {}).slice(0, 20);
      const devDeps = Object.keys((pkg.devDependencies as Record<string, unknown>) ?? {}).slice(
        0,
        10,
      );
      return { dependencies: deps, dev_dependencies: devDeps };
    }
  }

  if (exists(path.join(serviceDir, 'requirements.txt'))) {
    const content = readTextFile(path.join(serviceDir, 'requirements.txt')) ?? '';
    const deps: string[] = [];
    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (trimmed && !trimmed.startsWith('#') && !trimmed.startsWith('-')) {
        const match = trimmed.match(/^([a-zA-Z0-9_-]+)/);
        if (match) deps.push(match[1]);
      }
    }
    return { dependencies: deps.slice(0, 20) };
  }

  return {};
}

// ---------------------------------------------------------------------------
// Test directory detection
// ---------------------------------------------------------------------------

function detectTestDirectory(serviceDir: string): string | undefined {
  for (const testDir of ['tests', 'test', '__tests__', 'spec']) {
    if (exists(path.join(serviceDir, testDir)) && isDirectory(path.join(serviceDir, testDir))) {
      return testDir;
    }
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Dockerfile detection
// ---------------------------------------------------------------------------

function detectDockerfile(serviceDir: string, serviceName: string): string | undefined {
  const patterns = [
    'Dockerfile',
    `Dockerfile.${serviceName}`,
    `docker/${serviceName}.Dockerfile`,
    `docker/Dockerfile.${serviceName}`,
  ];

  for (const pattern of patterns) {
    if (exists(path.join(serviceDir, pattern))) {
      return pattern;
    }
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Full service analysis
// ---------------------------------------------------------------------------

function analyzeService(serviceDir: string, serviceName: string): ServiceInfo | null {
  const detected = detectLanguageAndFramework(serviceDir);

  if (!detected.language) return null;

  const serviceType = inferTypeFromName(serviceName, detected.type);
  const entryPoint = detectEntryPoint(serviceDir);
  const keyDirectories = detectKeyDirectories(serviceDir);
  const deps = detectDependencies(serviceDir);
  const testDirectory = detectTestDirectory(serviceDir);
  const dockerfile = detectDockerfile(serviceDir, serviceName);

  const service: ServiceInfo = {
    name: serviceName,
    path: serviceDir,
    language: detected.language ?? undefined,
    framework: detected.framework ?? undefined,
    type: serviceType,
    package_manager: detected.package_manager ?? undefined,
    ...(entryPoint ? { entry_point: entryPoint } : {}),
    ...(keyDirectories ? { key_directories: keyDirectories } : {}),
    ...(deps.dependencies ? { dependencies: deps.dependencies } : {}),
    ...(deps.dev_dependencies ? { dev_dependencies: deps.dev_dependencies } : {}),
    ...(detected.testing ? { testing: detected.testing } : {}),
    ...(detected.e2e_testing ? { e2e_testing: detected.e2e_testing } : {}),
    ...(testDirectory ? { test_directory: testDirectory } : {}),
    ...(dockerfile ? { dockerfile } : {}),
  };

  return service;
}

// ---------------------------------------------------------------------------
// Infrastructure detection
// ---------------------------------------------------------------------------

function analyzeInfrastructure(projectDir: string): InfrastructureInfo {
  const infra: InfrastructureInfo = {};

  // Docker Compose
  for (const composeFile of ['docker-compose.yml', 'docker-compose.yaml']) {
    if (exists(path.join(projectDir, composeFile))) {
      infra.docker_compose = composeFile;
      const content = readTextFile(path.join(projectDir, composeFile)) ?? '';
      infra.docker_services = parseComposeServices(content);
      break;
    }
  }

  // Root Dockerfile
  if (exists(path.join(projectDir, 'Dockerfile'))) {
    infra.dockerfile = 'Dockerfile';
  }

  // Docker directory
  const dockerDir = path.join(projectDir, 'docker');
  if (exists(dockerDir) && isDirectory(dockerDir)) {
    const dockerfiles = listDirectory(dockerDir)
      .filter(
        (e) =>
          e.isFile() &&
          (e.name.startsWith('Dockerfile') || e.name.endsWith('.Dockerfile')),
      )
      .map((e) => `docker/${e.name}`);

    if (dockerfiles.length > 0) {
      infra.docker_directory = 'docker/';
      infra.dockerfiles = dockerfiles;
    }
  }

  // CI/CD
  if (
    exists(path.join(projectDir, '.github', 'workflows')) &&
    isDirectory(path.join(projectDir, '.github', 'workflows'))
  ) {
    infra.ci = 'GitHub Actions';
    const workflows = listDirectory(path.join(projectDir, '.github', 'workflows'))
      .filter((e) => e.isFile() && (e.name.endsWith('.yml') || e.name.endsWith('.yaml')))
      .map((e) => e.name);
    infra.ci_workflows = workflows;
  } else if (exists(path.join(projectDir, '.gitlab-ci.yml'))) {
    infra.ci = 'GitLab CI';
  } else if (exists(path.join(projectDir, '.circleci')) && isDirectory(path.join(projectDir, '.circleci'))) {
    infra.ci = 'CircleCI';
  }

  // Deployment platform
  const deploymentFiles: Record<string, string> = {
    'vercel.json': 'Vercel',
    'netlify.toml': 'Netlify',
    'fly.toml': 'Fly.io',
    'render.yaml': 'Render',
    'railway.json': 'Railway',
    Procfile: 'Heroku',
    'app.yaml': 'Google App Engine',
    'serverless.yml': 'Serverless Framework',
  };

  for (const [file, platform] of Object.entries(deploymentFiles)) {
    if (exists(path.join(projectDir, file))) {
      infra.deployment = platform;
      break;
    }
  }

  return infra;
}

function parseComposeServices(content: string): string[] {
  const services: string[] = [];
  let inServices = false;

  for (const line of content.split('\n')) {
    if (line.trim() === 'services:') {
      inServices = true;
      continue;
    }
    if (inServices) {
      if (line.startsWith('  ') && !line.startsWith('    ') && line.trim().endsWith(':')) {
        services.push(line.trim().replace(/:$/, ''));
      } else if (line.length > 0 && !line.startsWith(' ')) {
        break;
      }
    }
  }
  return services;
}

// ---------------------------------------------------------------------------
// Conventions detection
// ---------------------------------------------------------------------------

function detectConventions(projectDir: string): ConventionsInfo {
  const conventions: ConventionsInfo = {};

  // Python linting
  if (
    exists(path.join(projectDir, 'ruff.toml')) ||
    (exists(path.join(projectDir, 'pyproject.toml')) &&
      (readTextFile(path.join(projectDir, 'pyproject.toml')) ?? '').includes('[tool.ruff]'))
  ) {
    conventions.python_linting = 'Ruff';
  } else if (exists(path.join(projectDir, '.flake8'))) {
    conventions.python_linting = 'Flake8';
  } else if (exists(path.join(projectDir, 'pylintrc'))) {
    conventions.python_linting = 'Pylint';
  }

  // Python formatting
  const pyprojectContent = readTextFile(path.join(projectDir, 'pyproject.toml')) ?? '';
  if (pyprojectContent.includes('[tool.black]')) {
    conventions.python_formatting = 'Black';
  }

  // JavaScript/TypeScript linting
  const eslintFiles = [
    '.eslintrc',
    '.eslintrc.js',
    '.eslintrc.json',
    '.eslintrc.yml',
    'eslint.config.js',
    'eslint.config.mjs',
  ];
  if (eslintFiles.some((f) => exists(path.join(projectDir, f)))) {
    conventions.js_linting = 'ESLint';
  } else if (
    exists(path.join(projectDir, 'biome.json')) ||
    exists(path.join(projectDir, 'biome.jsonc'))
  ) {
    conventions.js_linting = 'Biome';
  }

  // Prettier
  const prettierFiles = [
    '.prettierrc',
    '.prettierrc.js',
    '.prettierrc.json',
    'prettier.config.js',
    'prettier.config.mjs',
  ];
  if (prettierFiles.some((f) => exists(path.join(projectDir, f)))) {
    conventions.formatting = 'Prettier';
  }

  // TypeScript
  if (exists(path.join(projectDir, 'tsconfig.json'))) {
    conventions.typescript = true;
  }

  // Git hooks
  if (exists(path.join(projectDir, '.husky')) && isDirectory(path.join(projectDir, '.husky'))) {
    conventions.git_hooks = 'Husky';
  } else if (exists(path.join(projectDir, '.pre-commit-config.yaml'))) {
    conventions.git_hooks = 'pre-commit';
  }

  return conventions;
}

// ---------------------------------------------------------------------------
// Monorepo / project type detection
// ---------------------------------------------------------------------------

function detectProjectType(projectDir: string): 'single' | 'monorepo' {
  // Check for monorepo tool config files
  for (const indicator of MONOREPO_INDICATORS) {
    if (exists(path.join(projectDir, indicator))) {
      return 'monorepo';
    }
  }

  // Check for packages/apps directories
  if (
    (exists(path.join(projectDir, 'packages')) && isDirectory(path.join(projectDir, 'packages'))) ||
    (exists(path.join(projectDir, 'apps')) && isDirectory(path.join(projectDir, 'apps')))
  ) {
    return 'monorepo';
  }

  // Check for multiple service directories with root files
  let serviceDirsFound = 0;
  for (const entry of listDirectory(projectDir)) {
    if (!entry.isDirectory()) continue;
    if (SKIP_DIRS.has(entry.name) || entry.name.startsWith('.')) continue;

    const entryPath = path.join(projectDir, entry.name);
    const hasRootFile = SERVICE_ROOT_FILES.some((f) => exists(path.join(entryPath, f)));
    if (hasRootFile) serviceDirsFound++;
  }

  return serviceDirsFound >= 2 ? 'monorepo' : 'single';
}

// ---------------------------------------------------------------------------
// Services enumeration
// ---------------------------------------------------------------------------

function findAndAnalyzeServices(
  projectDir: string,
  projectType: 'single' | 'monorepo',
): Record<string, ServiceInfo> {
  const services: Record<string, ServiceInfo> = {};

  if (projectType === 'monorepo') {
    const serviceLocations = [
      projectDir,
      path.join(projectDir, 'packages'),
      path.join(projectDir, 'apps'),
      path.join(projectDir, 'services'),
    ];

    for (const location of serviceLocations) {
      if (!exists(location) || !isDirectory(location)) continue;

      for (const entry of listDirectory(location)) {
        if (!entry.isDirectory()) continue;
        if (SKIP_DIRS.has(entry.name) || entry.name.startsWith('.')) continue;

        const entryPath = path.join(location, entry.name);
        const hasRootFile = SERVICE_ROOT_FILES.some((f) => exists(path.join(entryPath, f)));

        if (hasRootFile) {
          const serviceInfo = analyzeService(entryPath, entry.name);
          if (serviceInfo) {
            services[entry.name] = serviceInfo;
          }
        }
      }
    }
  } else {
    // Single project - analyze root as "main"
    const serviceInfo = analyzeService(projectDir, 'main');
    if (serviceInfo) {
      services['main'] = serviceInfo;
    }
  }

  return services;
}

// ---------------------------------------------------------------------------
// Dependency mapping
// ---------------------------------------------------------------------------

function mapDependencies(services: Record<string, ServiceInfo>): void {
  for (const [serviceName, serviceInfo] of Object.entries(services)) {
    const consumes: string[] = [];

    // Frontend typically consumes backend APIs
    if (serviceInfo.type === 'frontend') {
      for (const [otherName, otherInfo] of Object.entries(services)) {
        if (otherName !== serviceName && otherInfo.type === 'backend') {
          consumes.push(`${otherName}.api`);
        }
      }
    }

    // Check for shared library references
    if (serviceInfo.dependencies) {
      for (const otherName of Object.keys(services)) {
        if (
          otherName !== serviceName &&
          (serviceInfo.dependencies.includes(otherName) ||
            serviceInfo.dependencies.includes(`@${otherName}`))
        ) {
          consumes.push(otherName);
        }
      }
    }

    if (consumes.length > 0) {
      serviceInfo.consumes = consumes;
    }
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Build a ProjectIndex for the given project directory.
 *
 * This is the TypeScript equivalent of the Python ProjectAnalyzer.
 * It detects project structure, services, frameworks, infrastructure, and conventions,
 * then serialises the result to the ProjectIndex format used by the frontend.
 */
export function buildProjectIndex(projectDir: string): ProjectIndex {
  const resolvedDir = path.resolve(projectDir);

  const projectType = detectProjectType(resolvedDir);
  const services = findAndAnalyzeServices(resolvedDir, projectType);
  mapDependencies(services);

  const infrastructure = analyzeInfrastructure(resolvedDir);
  const conventions = detectConventions(resolvedDir);

  return {
    project_root: resolvedDir,
    project_type: projectType,
    services,
    infrastructure,
    conventions,
  };
}

/**
 * Analyse a project and write the resulting ProjectIndex to the given output path.
 *
 * @param projectDir - Root directory of the project to analyse.
 * @param outputPath - Absolute path where project_index.json will be written.
 * @returns The generated ProjectIndex.
 */
export function runProjectIndexer(projectDir: string, outputPath: string): ProjectIndex {
  const index = buildProjectIndex(projectDir);

  // Ensure the output directory exists
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, JSON.stringify(index, null, 2), 'utf-8');

  return index;
}
