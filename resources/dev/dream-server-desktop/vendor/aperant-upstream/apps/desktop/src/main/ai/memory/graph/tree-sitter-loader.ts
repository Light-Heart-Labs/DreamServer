/**
 * Tree-sitter WASM Grammar Loader
 *
 * Loads tree-sitter WASM grammars for supported languages.
 * Handles dev vs packaged Electron paths.
 */

import { Parser, Language } from 'web-tree-sitter';
import { join } from 'path';

const GRAMMAR_FILES: Record<string, string> = {
  typescript: 'tree-sitter-typescript.wasm',
  tsx: 'tree-sitter-tsx.wasm',
  python: 'tree-sitter-python.wasm',
  rust: 'tree-sitter-rust.wasm',
  go: 'tree-sitter-go.wasm',
  java: 'tree-sitter-java.wasm',
  javascript: 'tree-sitter-javascript.wasm',
};

export class TreeSitterLoader {
  private static instance: TreeSitterLoader | null = null;
  private initialized = false;
  private grammars = new Map<string, Language>();

  static getInstance(): TreeSitterLoader {
    if (!TreeSitterLoader.instance) {
      TreeSitterLoader.instance = new TreeSitterLoader();
    }
    return TreeSitterLoader.instance;
  }

  private getWasmDir(): string {
    // Lazy import to avoid issues in test environments
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { app } = require('electron') as typeof import('electron');
      if (app.isPackaged) {
        return join(process.resourcesPath, 'grammars');
      }
    } catch {
      // Not in Electron (test environment) — fall through to dev path
    }
    return join(__dirname, '..', '..', '..', '..', 'node_modules', 'tree-sitter-wasms', 'out');
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;

    const wasmDir = this.getWasmDir();

    await Parser.init({
      locateFile: (filename: string) => join(wasmDir, filename),
    });

    this.initialized = true;
  }

  async loadGrammar(lang: string): Promise<Language | null> {
    if (!this.initialized) {
      await this.initialize();
    }

    const cached = this.grammars.get(lang);
    if (cached) return cached;

    const wasmFile = GRAMMAR_FILES[lang];
    if (!wasmFile) return null;

    const wasmDir = this.getWasmDir();
    try {
      const language = await Language.load(join(wasmDir, wasmFile));
      this.grammars.set(lang, language);
      return language;
    } catch {
      // Grammar file not found — return null gracefully
      return null;
    }
  }

  async getParser(lang: string): Promise<Parser | null> {
    const language = await this.loadGrammar(lang);
    if (!language) return null;

    const parser = new Parser();
    parser.setLanguage(language);
    return parser;
  }

  /**
   * Detect language from file extension.
   */
  static detectLanguage(filePath: string): string | null {
    const ext = filePath.split('.').pop()?.toLowerCase();
    const EXT_MAP: Record<string, string> = {
      ts: 'typescript',
      tsx: 'tsx',
      js: 'javascript',
      jsx: 'javascript',
      mjs: 'javascript',
      cjs: 'javascript',
      py: 'python',
      rs: 'rust',
      go: 'go',
      java: 'java',
    };
    return EXT_MAP[ext ?? ''] ?? null;
  }

  /** Supported language extensions for file watching */
  static readonly SUPPORTED_EXTENSIONS = [
    '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs',
    '.py', '.rs', '.go', '.java',
  ];
}
