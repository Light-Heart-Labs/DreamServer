/**
 * Stack Detection Module
 * ======================
 *
 * Detects programming languages, package managers, databases,
 * infrastructure tools, and cloud providers from project files.
 *
 * See apps/desktop/src/main/ai/project/stack-detector.ts for the TypeScript implementation.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

import { createTechnologyStack } from './types';
import type { TechnologyStack } from './types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fileExistsInDir(projectDir: string, ...patterns: string[]): boolean {
  for (const pattern of patterns) {
    if (pattern.includes('*')) {
      // Glob pattern
      if (globMatchesAny(projectDir, pattern)) {
        return true;
      }
    } else {
      const fullPath = path.join(projectDir, pattern);
      if (fs.existsSync(fullPath)) {
        return true;
      }
    }
  }
  return false;
}

function globMatchesAny(projectDir: string, pattern: string): boolean {
  try {
    if (pattern.startsWith('**/')) {
      // Recursive glob
      const ext = pattern.slice(3); // Remove '**/'
      return findFileRecursive(projectDir, ext, 0);
    } else if (pattern.startsWith('*.')) {
      // Simple extension match in root dir
      const ext = pattern.slice(1); // e.g. '.py'
      const entries = fs.readdirSync(projectDir);
      return entries.some((f) => f.endsWith(ext));
    } else if (pattern.endsWith('/')) {
      // Directory
      const dirPath = path.join(projectDir, pattern);
      return fs.existsSync(dirPath) && fs.statSync(dirPath).isDirectory();
    } else if (pattern.includes('*')) {
      // General glob - check root only
      const [prefix, suffix] = pattern.split('*');
      const entries = fs.readdirSync(projectDir);
      return entries.some((f) => f.startsWith(prefix) && f.endsWith(suffix ?? ''));
    }
    return false;
  } catch {
    return false;
  }
}

function findFileRecursive(dir: string, ext: string, depth: number): boolean {
  if (depth > 6) return false;
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
      if (entry.isFile() && entry.name.endsWith(ext)) {
        return true;
      }
      if (entry.isDirectory()) {
        if (findFileRecursive(path.join(dir, entry.name), ext, depth + 1)) {
          return true;
        }
      }
    }
  } catch {
    // ignore
  }
  return false;
}

function readJsonFile(projectDir: string, filename: string): Record<string, unknown> | null {
  try {
    const content = fs.readFileSync(path.join(projectDir, filename), 'utf-8');
    return JSON.parse(content) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function readTextFile(projectDir: string, filename: string): string | null {
  try {
    return fs.readFileSync(path.join(projectDir, filename), 'utf-8');
  } catch {
    return null;
  }
}

function globFiles(projectDir: string, pattern: string): string[] {
  const results: string[] = [];
  try {
    if (pattern.startsWith('**/')) {
      const ext = pattern.slice(3);
      collectFilesRecursive(projectDir, ext, results, 0);
    }
  } catch {
    // ignore
  }
  return results;
}

function collectFilesRecursive(dir: string, ext: string, results: string[], depth: number): void {
  if (depth > 6) return;
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
      const fullPath = path.join(dir, entry.name);
      if (entry.isFile() && entry.name.endsWith(ext)) {
        results.push(fullPath);
      } else if (entry.isDirectory()) {
        collectFilesRecursive(fullPath, ext, results, depth + 1);
      }
    }
  } catch {
    // ignore
  }
}

// ---------------------------------------------------------------------------
// Stack Detector
// ---------------------------------------------------------------------------

export class StackDetector {
  private projectDir: string;
  public stack: TechnologyStack;

  constructor(projectDir: string) {
    this.projectDir = path.resolve(projectDir);
    this.stack = createTechnologyStack();
  }

  private fileExists(...patterns: string[]): boolean {
    return fileExistsInDir(this.projectDir, ...patterns);
  }

  private readJson(filename: string): Record<string, unknown> | null {
    return readJsonFile(this.projectDir, filename);
  }

  private readText(filename: string): string | null {
    return readTextFile(this.projectDir, filename);
  }

  detectAll(): TechnologyStack {
    this.detectLanguages();
    this.detectPackageManagers();
    this.detectDatabases();
    this.detectInfrastructure();
    this.detectCloudProviders();
    this.detectCodeQualityTools();
    this.detectVersionManagers();
    return this.stack;
  }

  detectLanguages(): void {
    // Python
    if (this.fileExists('*.py', '**/*.py', 'pyproject.toml', 'requirements.txt', 'setup.py', 'Pipfile')) {
      this.stack.languages.push('python');
    }

    // JavaScript
    if (this.fileExists('*.js', '**/*.js', 'package.json')) {
      this.stack.languages.push('javascript');
    }

    // TypeScript
    if (this.fileExists('*.ts', '*.tsx', '**/*.ts', '**/*.tsx', 'tsconfig.json')) {
      this.stack.languages.push('typescript');
    }

    // Rust
    if (this.fileExists('Cargo.toml', '*.rs', '**/*.rs')) {
      this.stack.languages.push('rust');
    }

    // Go
    if (this.fileExists('go.mod', '*.go', '**/*.go')) {
      this.stack.languages.push('go');
    }

    // Ruby
    if (this.fileExists('Gemfile', '*.rb', '**/*.rb')) {
      this.stack.languages.push('ruby');
    }

    // PHP
    if (this.fileExists('composer.json', '*.php', '**/*.php')) {
      this.stack.languages.push('php');
    }

    // Java
    if (this.fileExists('pom.xml', 'build.gradle', '*.java', '**/*.java')) {
      this.stack.languages.push('java');
    }

    // Kotlin
    if (this.fileExists('*.kt', '**/*.kt')) {
      this.stack.languages.push('kotlin');
    }

    // Scala
    if (this.fileExists('build.sbt', '*.scala', '**/*.scala')) {
      this.stack.languages.push('scala');
    }

    // C#
    if (this.fileExists('*.csproj', '*.sln', '*.cs', '**/*.cs')) {
      this.stack.languages.push('csharp');
    }

    // C
    if (this.fileExists('*.c', '*.h', '**/*.c', '**/*.h', 'CMakeLists.txt', 'Makefile')) {
      this.stack.languages.push('c');
    }

    // C++
    if (this.fileExists('*.cpp', '*.hpp', '*.cc', '**/*.cpp', '**/*.hpp')) {
      this.stack.languages.push('cpp');
    }

    // Elixir
    if (this.fileExists('mix.exs', '*.ex', '**/*.ex')) {
      this.stack.languages.push('elixir');
    }

    // Swift
    if (this.fileExists('Package.swift', '*.swift', '**/*.swift')) {
      this.stack.languages.push('swift');
    }

    // Dart/Flutter
    if (this.fileExists('pubspec.yaml', '*.dart', '**/*.dart')) {
      this.stack.languages.push('dart');
    }
  }

  detectPackageManagers(): void {
    // Node.js package managers
    if (this.fileExists('package-lock.json')) {
      this.stack.packageManagers.push('npm');
    }
    if (this.fileExists('yarn.lock')) {
      this.stack.packageManagers.push('yarn');
    }
    if (this.fileExists('pnpm-lock.yaml')) {
      this.stack.packageManagers.push('pnpm');
    }
    if (this.fileExists('bun.lockb', 'bun.lock')) {
      this.stack.packageManagers.push('bun');
    }
    if (this.fileExists('deno.json', 'deno.jsonc')) {
      this.stack.packageManagers.push('deno');
    }

    // Python package managers
    if (this.fileExists('requirements.txt', 'requirements-dev.txt')) {
      this.stack.packageManagers.push('pip');
    }
    if (this.fileExists('pyproject.toml')) {
      const content = this.readText('pyproject.toml');
      if (content) {
        if (content.includes('[tool.poetry]')) {
          this.stack.packageManagers.push('poetry');
        } else if (content.includes('[project]')) {
          if (this.fileExists('uv.lock')) {
            this.stack.packageManagers.push('uv');
          } else if (this.fileExists('pdm.lock')) {
            this.stack.packageManagers.push('pdm');
          } else {
            this.stack.packageManagers.push('pip');
          }
        }
      }
    }
    if (this.fileExists('Pipfile')) {
      this.stack.packageManagers.push('pipenv');
    }

    // Other package managers
    if (this.fileExists('Cargo.toml')) {
      this.stack.packageManagers.push('cargo');
    }
    if (this.fileExists('go.mod')) {
      this.stack.packageManagers.push('go_mod');
    }
    if (this.fileExists('Gemfile')) {
      this.stack.packageManagers.push('gem');
    }
    if (this.fileExists('composer.json')) {
      this.stack.packageManagers.push('composer');
    }
    if (this.fileExists('pom.xml')) {
      this.stack.packageManagers.push('maven');
    }
    if (this.fileExists('build.gradle', 'build.gradle.kts')) {
      this.stack.packageManagers.push('gradle');
    }

    // Dart/Flutter
    if (this.fileExists('pubspec.yaml', 'pubspec.lock')) {
      this.stack.packageManagers.push('pub');
    }
    if (this.fileExists('melos.yaml')) {
      this.stack.packageManagers.push('melos');
    }
  }

  detectDatabases(): void {
    // Check env files
    for (const envFile of ['.env', '.env.local', '.env.development']) {
      const content = this.readText(envFile);
      if (content) {
        const lower = content.toLowerCase();
        if (lower.includes('postgres') || lower.includes('postgresql')) {
          this.stack.databases.push('postgresql');
        }
        if (lower.includes('mysql')) {
          this.stack.databases.push('mysql');
        }
        if (lower.includes('mongodb') || lower.includes('mongo_')) {
          this.stack.databases.push('mongodb');
        }
        if (lower.includes('redis')) {
          this.stack.databases.push('redis');
        }
        if (lower.includes('sqlite')) {
          this.stack.databases.push('sqlite');
        }
      }
    }

    // Check for Prisma schema
    const prismaSchema = this.readText('prisma/schema.prisma');
    if (prismaSchema) {
      const lower = prismaSchema.toLowerCase();
      if (lower.includes('postgresql')) this.stack.databases.push('postgresql');
      if (lower.includes('mysql')) this.stack.databases.push('mysql');
      if (lower.includes('mongodb')) this.stack.databases.push('mongodb');
      if (lower.includes('sqlite')) this.stack.databases.push('sqlite');
    }

    // Check Docker Compose for database services
    for (const composeFile of ['docker-compose.yml', 'docker-compose.yaml', 'compose.yml', 'compose.yaml']) {
      const content = this.readText(composeFile);
      if (content) {
        const lower = content.toLowerCase();
        if (lower.includes('postgres')) this.stack.databases.push('postgresql');
        if (lower.includes('mysql') || lower.includes('mariadb')) this.stack.databases.push('mysql');
        if (lower.includes('mongo')) this.stack.databases.push('mongodb');
        if (lower.includes('redis')) this.stack.databases.push('redis');
        if (lower.includes('elasticsearch')) this.stack.databases.push('elasticsearch');
      }
    }

    // Deduplicate
    this.stack.databases = [...new Set(this.stack.databases)];
  }

  detectInfrastructure(): void {
    // Docker
    if (this.fileExists('Dockerfile', 'docker-compose.yml', 'docker-compose.yaml', '.dockerignore')) {
      this.stack.infrastructure.push('docker');
    }

    // Podman
    if (this.fileExists('Containerfile')) {
      this.stack.infrastructure.push('podman');
    }

    // Kubernetes - check YAML files for apiVersion/kind
    const yamlFiles = [
      ...globFiles(this.projectDir, '**/*.yaml'),
      ...globFiles(this.projectDir, '**/*.yml'),
    ];
    for (const yamlFile of yamlFiles) {
      try {
        const content = fs.readFileSync(yamlFile, 'utf-8');
        if (content.includes('apiVersion:') && content.includes('kind:')) {
          this.stack.infrastructure.push('kubernetes');
          break;
        }
      } catch {
        // ignore
      }
    }

    // Helm
    if (this.fileExists('Chart.yaml', 'charts/')) {
      this.stack.infrastructure.push('helm');
    }

    // Terraform
    if (globFiles(this.projectDir, '**/*.tf').length > 0) {
      this.stack.infrastructure.push('terraform');
    }

    // Ansible
    if (this.fileExists('ansible.cfg', 'playbook.yml', 'playbooks/')) {
      this.stack.infrastructure.push('ansible');
    }

    // Vagrant
    if (this.fileExists('Vagrantfile')) {
      this.stack.infrastructure.push('vagrant');
    }

    // Minikube
    if (this.fileExists('.minikube/')) {
      this.stack.infrastructure.push('minikube');
    }

    // Deduplicate
    this.stack.infrastructure = [...new Set(this.stack.infrastructure)];
  }

  detectCloudProviders(): void {
    // AWS
    if (this.fileExists('aws/', '.aws/', 'serverless.yml', 'sam.yaml', 'template.yaml', 'cdk.json', 'amplify.yml')) {
      this.stack.cloudProviders.push('aws');
    }

    // GCP
    if (this.fileExists('app.yaml', '.gcloudignore', 'firebase.json', '.firebaserc')) {
      this.stack.cloudProviders.push('gcp');
    }

    // Azure
    if (this.fileExists('azure-pipelines.yml', '.azure/', 'host.json')) {
      this.stack.cloudProviders.push('azure');
    }

    // Vercel
    if (this.fileExists('vercel.json', '.vercel/')) {
      this.stack.cloudProviders.push('vercel');
    }

    // Netlify
    if (this.fileExists('netlify.toml', '_redirects')) {
      this.stack.cloudProviders.push('netlify');
    }

    // Heroku
    if (this.fileExists('Procfile', 'app.json')) {
      this.stack.cloudProviders.push('heroku');
    }

    // Railway
    if (this.fileExists('railway.json', 'railway.toml')) {
      this.stack.cloudProviders.push('railway');
    }

    // Fly.io
    if (this.fileExists('fly.toml')) {
      this.stack.cloudProviders.push('fly');
    }

    // Cloudflare
    if (this.fileExists('wrangler.toml', 'wrangler.json')) {
      this.stack.cloudProviders.push('cloudflare');
    }

    // Supabase
    if (this.fileExists('supabase/')) {
      this.stack.cloudProviders.push('supabase');
    }
  }

  detectCodeQualityTools(): void {
    const toolConfigs: [string, string][] = [
      ['.shellcheckrc', 'shellcheck'],
      ['.hadolint.yaml', 'hadolint'],
      ['.yamllint', 'yamllint'],
      ['.vale.ini', 'vale'],
      ['cspell.json', 'cspell'],
      ['.codespellrc', 'codespell'],
      ['.semgrep.yml', 'semgrep'],
      ['.snyk', 'snyk'],
      ['.trivyignore', 'trivy'],
    ];

    for (const [config, tool] of toolConfigs) {
      if (this.fileExists(config)) {
        this.stack.codeQualityTools.push(tool);
      }
    }
  }

  detectVersionManagers(): void {
    if (this.fileExists('.tool-versions')) {
      this.stack.versionManagers.push('asdf');
    }
    if (this.fileExists('.mise.toml', 'mise.toml')) {
      this.stack.versionManagers.push('mise');
    }
    if (this.fileExists('.nvmrc', '.node-version')) {
      this.stack.versionManagers.push('nvm');
    }
    if (this.fileExists('.python-version')) {
      this.stack.versionManagers.push('pyenv');
    }
    if (this.fileExists('.ruby-version')) {
      this.stack.versionManagers.push('rbenv');
    }
    if (this.fileExists('rust-toolchain.toml', 'rust-toolchain')) {
      this.stack.versionManagers.push('rustup');
    }
    if (this.fileExists('.fvm', '.fvmrc', 'fvm_config.json')) {
      this.stack.versionManagers.push('fvm');
    }
  }
}
