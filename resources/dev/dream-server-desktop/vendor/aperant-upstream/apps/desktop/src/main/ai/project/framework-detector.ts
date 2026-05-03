/**
 * Framework Detection Module
 * ==========================
 *
 * Detects frameworks and libraries from package dependencies
 * (package.json, pyproject.toml, requirements.txt, Gemfile, etc.).
 *
 * See apps/desktop/src/main/ai/project/framework-detector.ts for the TypeScript implementation.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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

function fileExists(projectDir: string, filename: string): boolean {
  return fs.existsSync(path.join(projectDir, filename));
}

// ---------------------------------------------------------------------------
// Framework Detector
// ---------------------------------------------------------------------------

export class FrameworkDetector {
  private projectDir: string;
  public frameworks: string[];

  constructor(projectDir: string) {
    this.projectDir = path.resolve(projectDir);
    this.frameworks = [];
  }

  detectAll(): string[] {
    this.detectNodejsFrameworks();
    this.detectPythonFrameworks();
    this.detectRubyFrameworks();
    this.detectPhpFrameworks();
    this.detectDartFrameworks();
    return this.frameworks;
  }

  detectNodejsFrameworks(): void {
    const pkg = readJsonFile(this.projectDir, 'package.json');
    if (!pkg) return;

    const deps: Record<string, string> = {
      ...(pkg.dependencies as Record<string, string> ?? {}),
      ...(pkg.devDependencies as Record<string, string> ?? {}),
    };

    const frameworkDeps: Record<string, string> = {
      next: 'nextjs',
      nuxt: 'nuxt',
      react: 'react',
      vue: 'vue',
      '@angular/core': 'angular',
      svelte: 'svelte',
      '@sveltejs/kit': 'svelte',
      astro: 'astro',
      '@remix-run/react': 'remix',
      gatsby: 'gatsby',
      express: 'express',
      '@nestjs/core': 'nestjs',
      fastify: 'fastify',
      koa: 'koa',
      '@hapi/hapi': 'hapi',
      '@adonisjs/core': 'adonis',
      strapi: 'strapi',
      '@keystonejs/core': 'keystone',
      payload: 'payload',
      '@directus/sdk': 'directus',
      '@medusajs/medusa': 'medusa',
      blitz: 'blitz',
      '@redwoodjs/core': 'redwood',
      sails: 'sails',
      meteor: 'meteor',
      electron: 'electron',
      '@tauri-apps/api': 'tauri',
      '@capacitor/core': 'capacitor',
      expo: 'expo',
      'react-native': 'react-native',
      // Build tools
      vite: 'vite',
      webpack: 'webpack',
      rollup: 'rollup',
      esbuild: 'esbuild',
      parcel: 'parcel',
      turbo: 'turbo',
      nx: 'nx',
      lerna: 'lerna',
      // Testing
      jest: 'jest',
      vitest: 'vitest',
      mocha: 'mocha',
      '@playwright/test': 'playwright',
      cypress: 'cypress',
      puppeteer: 'puppeteer',
      // Linting
      eslint: 'eslint',
      prettier: 'prettier',
      '@biomejs/biome': 'biome',
      oxlint: 'oxlint',
      // Database
      prisma: 'prisma',
      'drizzle-orm': 'drizzle',
      typeorm: 'typeorm',
      sequelize: 'sequelize',
      knex: 'knex',
    };

    for (const [dep, framework] of Object.entries(frameworkDeps)) {
      if (dep in deps) {
        this.frameworks.push(framework);
      }
    }
  }

  detectPythonFrameworks(): void {
    const pythonDeps = new Set<string>();

    // Parse pyproject.toml as text (no TOML parser available)
    const tomlContent = readTextFile(this.projectDir, 'pyproject.toml');
    if (tomlContent) {
      // Poetry style - extract deps from [tool.poetry.dependencies]
      const poetrySection = tomlContent.match(/\[tool\.poetry(?:\.[\w-]+)*\.dependencies\]([\s\S]*?)(?=\[|$)/g);
      if (poetrySection) {
        for (const section of poetrySection) {
          const depMatches = section.matchAll(/^([a-zA-Z0-9_-]+)\s*=/gm);
          for (const match of depMatches) {
            pythonDeps.add(match[1].toLowerCase());
          }
        }
      }

      // Modern pyproject.toml style - extract from dependencies array
      const depsSection = tomlContent.match(/dependencies\s*=\s*\[([\s\S]*?)\]/);
      if (depsSection) {
        const depMatches = depsSection[1].matchAll(/"([a-zA-Z0-9_-]+)/g);
        for (const match of depMatches) {
          pythonDeps.add(match[1].toLowerCase());
        }
      }
    }

    // Parse requirements.txt files
    for (const reqFile of ['requirements.txt', 'requirements-dev.txt', 'requirements/dev.txt']) {
      const content = readTextFile(this.projectDir, reqFile);
      if (content) {
        for (const line of content.split('\n')) {
          const trimmed = line.trim();
          if (trimmed && !trimmed.startsWith('#') && !trimmed.startsWith('-')) {
            const match = trimmed.match(/^([a-zA-Z0-9_-]+)/);
            if (match) {
              pythonDeps.add(match[1].toLowerCase());
            }
          }
        }
      }
    }

    const pythonFrameworkDeps: Record<string, string> = {
      flask: 'flask',
      django: 'django',
      fastapi: 'fastapi',
      starlette: 'starlette',
      tornado: 'tornado',
      bottle: 'bottle',
      pyramid: 'pyramid',
      sanic: 'sanic',
      aiohttp: 'aiohttp',
      celery: 'celery',
      dramatiq: 'dramatiq',
      rq: 'rq',
      airflow: 'airflow',
      prefect: 'prefect',
      dagster: 'dagster',
      'dbt-core': 'dbt',
      streamlit: 'streamlit',
      gradio: 'gradio',
      panel: 'panel',
      dash: 'dash',
      pytest: 'pytest',
      tox: 'tox',
      nox: 'nox',
      mypy: 'mypy',
      pyright: 'pyright',
      ruff: 'ruff',
      black: 'black',
      isort: 'isort',
      flake8: 'flake8',
      pylint: 'pylint',
      bandit: 'bandit',
      coverage: 'coverage',
      'pre-commit': 'pre-commit',
      alembic: 'alembic',
      sqlalchemy: 'sqlalchemy',
    };

    for (const [dep, framework] of Object.entries(pythonFrameworkDeps)) {
      if (pythonDeps.has(dep)) {
        this.frameworks.push(framework);
      }
    }
  }

  detectRubyFrameworks(): void {
    if (!fileExists(this.projectDir, 'Gemfile')) return;

    const content = readTextFile(this.projectDir, 'Gemfile');
    if (content) {
      const lower = content.toLowerCase();
      if (lower.includes('rails')) this.frameworks.push('rails');
      if (lower.includes('sinatra')) this.frameworks.push('sinatra');
      if (lower.includes('rspec')) this.frameworks.push('rspec');
      if (lower.includes('rubocop')) this.frameworks.push('rubocop');
    }
  }

  detectPhpFrameworks(): void {
    const composer = readJsonFile(this.projectDir, 'composer.json');
    if (!composer) return;

    const deps: Record<string, string> = {
      ...(composer.require as Record<string, string> ?? {}),
      ...((composer['require-dev'] as Record<string, string>) ?? {}),
    };

    if ('laravel/framework' in deps) this.frameworks.push('laravel');
    if ('symfony/framework-bundle' in deps) this.frameworks.push('symfony');
    if ('phpunit/phpunit' in deps) this.frameworks.push('phpunit');
  }

  detectDartFrameworks(): void {
    const content = readTextFile(this.projectDir, 'pubspec.yaml');
    if (!content) return;

    const lower = content.toLowerCase();

    if (lower.includes('flutter:') || lower.includes('sdk: flutter')) {
      this.frameworks.push('flutter');
    }
    if (lower.includes('dart_frog')) this.frameworks.push('dart_frog');
    if (lower.includes('serverpod')) this.frameworks.push('serverpod');
    if (lower.includes('shelf')) this.frameworks.push('shelf');
    if (lower.includes('aqueduct')) this.frameworks.push('aqueduct');
  }
}
