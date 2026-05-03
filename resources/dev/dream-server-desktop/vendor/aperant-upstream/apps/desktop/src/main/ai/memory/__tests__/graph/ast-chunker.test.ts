/**
 * Tests for ASTChunker — function/class boundary splitting.
 *
 * NOTE: These tests stub out the parser since tree-sitter WASM loading
 * requires the WASM binaries to be present. Unit tests use mock parsers.
 */

import { describe, it, expect, vi } from 'vitest';
import { chunkFileByAST } from '../../graph/ast-chunker';
import type { Parser, Node, Tree } from 'web-tree-sitter';

// ============================================================
// Mock tree-sitter Node factory
// ============================================================

type MockNode = {
  type: string;
  startPosition: { row: number; column: number };
  endPosition: { row: number; column: number };
  text: string;
  childCount: number;
  namedChildCount: number;
  child: (i: number) => MockNode | null;
  namedChild: (i: number) => MockNode | null;
  parent: MockNode | null;
};

function makeMockNode(
  nodeType: string,
  startRow: number,
  endRow: number,
  text: string,
  children: MockNode[] = [],
  namedChildren?: MockNode[],
): MockNode {
  const named = namedChildren ?? children;
  return {
    type: nodeType,
    startPosition: { row: startRow, column: 0 },
    endPosition: { row: endRow, column: 0 },
    text,
    childCount: children.length,
    namedChildCount: named.length,
    child: (i: number) => children[i] ?? null,
    namedChild: (i: number) => named[i] ?? null,
    parent: null,
  };
}

function makeIdentifier(name: string, startRow = 0, endRow = 0): MockNode {
  return makeMockNode('identifier', startRow, endRow, name);
}

// ============================================================
// TESTS
// ============================================================

describe('chunkFileByAST - fallback', () => {
  it('falls back to 100-line chunks for unsupported language', async () => {
    const content = Array.from({ length: 250 }, (_, i) => `line ${i + 1}`).join('\n');
    const parser = { parse: vi.fn() } as unknown as Parser;

    const chunks = await chunkFileByAST('test.json', content, 'json', parser);

    // 250 lines → 3 chunks (100, 100, 50)
    expect(chunks.length).toBe(3);
    expect(chunks[0].chunkType).toBe('prose');
    expect(chunks[0].startLine).toBe(1);
    expect(chunks[0].endLine).toBe(100);
    expect(chunks[1].startLine).toBe(101);
    expect(chunks[1].endLine).toBe(200);
    expect(chunks[2].startLine).toBe(201);
    expect(chunks[2].endLine).toBe(250);
  });

  it('returns empty array for empty content', async () => {
    const parser = { parse: vi.fn() } as unknown as Parser;
    const chunks = await chunkFileByAST('empty.ts', '', 'typescript', parser);
    expect(chunks).toHaveLength(0);
  });

  it('falls back gracefully when parser throws', async () => {
    const content = 'const x = 1;\nconst y = 2;\n';
    const parser = {
      parse: vi.fn().mockImplementation(() => { throw new Error('parse error'); }),
    } as unknown as Parser;

    const chunks = await chunkFileByAST('broken.ts', content, 'typescript', parser);
    expect(chunks.length).toBeGreaterThan(0);
    expect(chunks[0].chunkType).toBe('prose');
  });

  it('falls back when parse returns null', async () => {
    const content = 'const x = 1;\n';
    const parser = {
      parse: vi.fn().mockReturnValue(null),
    } as unknown as Parser;

    const chunks = await chunkFileByAST('null-parse.ts', content, 'typescript', parser);
    expect(chunks.length).toBeGreaterThan(0);
    expect(chunks[0].chunkType).toBe('prose');
  });
});

describe('chunkFileByAST - TypeScript parsing', () => {
  it('creates function chunks', async () => {
    const lines = [
      'import { foo } from "./foo";',
      '',
      'function myFunction(x: number): number {',
      '  return x * 2;',
      '}',
      '',
      'const y = 1;',
    ];
    const content = lines.join('\n');

    // Build a mock AST with a function_declaration
    const identifierNode = makeIdentifier('myFunction', 2, 2);
    const funcNode = makeMockNode(
      'function_declaration',
      2, 4,
      lines.slice(2, 5).join('\n'),
      [identifierNode],
    );

    const rootNode = makeMockNode(
      'program',
      0, 6,
      content,
      [
        makeMockNode('import_statement', 0, 0, lines[0]),
        funcNode,
        makeMockNode('lexical_declaration', 6, 6, lines[6]),
      ],
    );

    const mockTree = { rootNode } as unknown as Tree;
    const parser = {
      parse: vi.fn().mockReturnValue(mockTree),
    } as unknown as Parser;

    const chunks = await chunkFileByAST('src/utils.ts', content, 'typescript', parser);

    const funcChunk = chunks.find(c => c.chunkType === 'function');
    expect(funcChunk).toBeDefined();
    expect(funcChunk?.name).toBe('myFunction');
    expect(funcChunk?.startLine).toBe(3); // row 2 = line 3 (1-indexed)
    expect(funcChunk?.endLine).toBe(5);
  });

  it('creates class chunks', async () => {
    const lines = [
      'class MyClass {',
      '  method() { return 1; }',
      '}',
    ];
    const content = lines.join('\n');

    const identifierNode = makeIdentifier('MyClass', 0, 0);
    const classNode = makeMockNode(
      'class_declaration',
      0, 2,
      content,
      [identifierNode],
    );

    const rootNode = makeMockNode('program', 0, 2, content, [classNode]);
    const mockTree = { rootNode } as unknown as Tree;
    const parser = {
      parse: vi.fn().mockReturnValue(mockTree),
    } as unknown as Parser;

    const chunks = await chunkFileByAST('src/MyClass.ts', content, 'typescript', parser);

    const classChunk = chunks.find(c => c.chunkType === 'class');
    expect(classChunk).toBeDefined();
    expect(classChunk?.name).toBe('MyClass');
  });

  it('builds correct contextPrefix', async () => {
    const content = 'function hello() { return "world"; }';

    const identifierNode = makeIdentifier('hello', 0, 0);
    const funcNode = makeMockNode('function_declaration', 0, 0, content, [identifierNode]);
    const rootNode = makeMockNode('program', 0, 0, content, [funcNode]);

    const mockTree = { rootNode } as unknown as Tree;
    const parser = {
      parse: vi.fn().mockReturnValue(mockTree),
    } as unknown as Parser;

    const chunks = await chunkFileByAST('src/greet.ts', content, 'typescript', parser);
    const chunk = chunks.find(c => c.name === 'hello');

    expect(chunk?.contextPrefix).toContain('File: src/greet.ts');
    expect(chunk?.contextPrefix).toContain('function: hello');
    expect(chunk?.contextPrefix).toContain('Lines:');
  });
});

describe('chunkFileByAST - contextPrefix format', () => {
  it('module chunks include file name but not chunk type label', async () => {
    const content = 'const x = 1;\nconst y = 2;';

    // Root with only variable declarations (no function/class)
    const rootNode = makeMockNode('program', 0, 1, content, [
      makeMockNode('lexical_declaration', 0, 0, 'const x = 1;'),
      makeMockNode('lexical_declaration', 1, 1, 'const y = 2;'),
    ]);

    const mockTree = { rootNode } as unknown as Tree;
    const parser = {
      parse: vi.fn().mockReturnValue(mockTree),
    } as unknown as Parser;

    const chunks = await chunkFileByAST('src/constants.ts', content, 'typescript', parser);

    // Might fall back to prose chunks or module chunks
    expect(chunks.length).toBeGreaterThan(0);
    for (const chunk of chunks) {
      expect(chunk.contextPrefix).toContain('src/constants.ts');
      expect(chunk.filePath).toBe('src/constants.ts');
      expect(chunk.language).toBe('typescript');
    }
  });
});

describe('chunkFileByAST - chunk ordering', () => {
  it('returns chunks sorted by startLine', async () => {
    const lines = [
      'function a() { return 1; }',
      '',
      'function b() { return 2; }',
      '',
      'function c() { return 3; }',
    ];
    const content = lines.join('\n');

    const makeFunc = (name: string, row: number): MockNode => {
      const id = makeIdentifier(name, row, row);
      return makeMockNode('function_declaration', row, row, lines[row] ?? '', [id]);
    };

    const rootNode = makeMockNode('program', 0, 4, content, [
      makeFunc('a', 0),
      makeMockNode('empty_statement', 1, 1, ''),
      makeFunc('b', 2),
      makeMockNode('empty_statement', 3, 3, ''),
      makeFunc('c', 4),
    ]);

    const mockTree = { rootNode } as unknown as Tree;
    const parser = {
      parse: vi.fn().mockReturnValue(mockTree),
    } as unknown as Parser;

    const chunks = await chunkFileByAST('src/fns.ts', content, 'typescript', parser);
    const funcChunks = chunks.filter(c => c.chunkType === 'function');

    // Verify sorted
    for (let i = 1; i < funcChunks.length; i++) {
      expect(funcChunks[i].startLine).toBeGreaterThanOrEqual(funcChunks[i - 1].startLine);
    }
  });
});
