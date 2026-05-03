/**
 * Tests for ASTExtractor — imports, functions, classes, call edges.
 *
 * Uses mock tree-sitter nodes since WASM binaries aren't available in unit tests.
 */

import { describe, it, expect } from 'vitest';
import { ASTExtractor } from '../../graph/ast-extractor';
import type { Node, Tree } from 'web-tree-sitter';

// ============================================================
// Mock tree-sitter node factory
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

function makeNode(
  type: string,
  text: string,
  startRow: number,
  endRow: number,
  children: MockNode[] = [],
  namedChildren?: MockNode[],
): MockNode {
  const named = namedChildren ?? children;
  const node: MockNode = {
    type,
    text,
    startPosition: { row: startRow, column: 0 },
    endPosition: { row: endRow, column: 0 },
    childCount: children.length,
    namedChildCount: named.length,
    child: (i: number) => children[i] ?? null,
    namedChild: (i: number) => named[i] ?? null,
    parent: null,
  };
  return node;
}

function identifier(name: string, row = 0): MockNode {
  return makeNode('identifier', name, row, row);
}

function makeTree(children: MockNode[]): Tree {
  const root = makeNode('program', '', 0, 100, children);
  return { rootNode: root } as unknown as Tree;
}

// ============================================================
// TESTS
// ============================================================

const extractor = new ASTExtractor();

describe('ASTExtractor - File node', () => {
  it('always creates a file node', () => {
    const tree = makeTree([]);
    const { nodes } = extractor.extract(tree, 'src/foo.ts', 'typescript');

    const fileNode = nodes.find(n => n.type === 'file');
    expect(fileNode).toBeDefined();
    expect(fileNode?.label).toBe('src/foo.ts');
    expect(fileNode?.filePath).toBe('src/foo.ts');
  });
});

describe('ASTExtractor - Import edges', () => {
  it('extracts an import_statement as imports edge', () => {
    const stringNode = makeNode('string', '"./auth"', 0, 0);
    const importNode = makeNode('import_statement', 'import { foo } from "./auth"', 0, 0, [stringNode]);

    const tree = makeTree([importNode]);
    const { edges } = extractor.extract(tree, 'src/app.ts', 'typescript');

    const importEdge = edges.find(e => e.type === 'imports');
    expect(importEdge).toBeDefined();
    expect(importEdge?.fromLabel).toBe('src/app.ts');
    expect(importEdge?.toLabel).toBe('./auth');
  });

  it('extracts module_specifier as import source', () => {
    const specifier = makeNode('module_specifier', '"react"', 0, 0);
    const importNode = makeNode('import_statement', 'import React from "react"', 0, 0, [specifier]);

    const tree = makeTree([importNode]);
    const { edges } = extractor.extract(tree, 'src/component.tsx', 'tsx');

    const importEdge = edges.find(e => e.type === 'imports');
    expect(importEdge).toBeDefined();
    expect(importEdge?.toLabel).toBe('react');
  });
});

describe('ASTExtractor - Function nodes', () => {
  it('extracts function_declaration node', () => {
    const id = identifier('myFunction', 5);
    const funcNode = makeNode('function_declaration', 'function myFunction() {}', 5, 10, [id]);

    const tree = makeTree([funcNode]);
    const { nodes } = extractor.extract(tree, 'src/utils.ts', 'typescript');

    const fnNode = nodes.find(n => n.type === 'function' && n.label.includes('myFunction'));
    expect(fnNode).toBeDefined();
    expect(fnNode?.startLine).toBe(6); // row 5 + 1
    expect(fnNode?.endLine).toBe(11);  // row 10 + 1
  });

  it('creates defined_in edge from function to file', () => {
    const id = identifier('myFunc', 0);
    const funcNode = makeNode('function_declaration', 'function myFunc() {}', 0, 5, [id]);

    const tree = makeTree([funcNode]);
    const { edges } = extractor.extract(tree, 'src/foo.ts', 'typescript');

    const definedInEdge = edges.find(
      e => e.type === 'defined_in' && e.fromLabel.includes('myFunc'),
    );
    expect(definedInEdge).toBeDefined();
    expect(definedInEdge?.toLabel).toBe('src/foo.ts');
  });
});

describe('ASTExtractor - Class nodes', () => {
  it('extracts class_declaration node', () => {
    const id = identifier('MyService', 0);
    const classNode = makeNode('class_declaration', 'class MyService {}', 0, 20, [id]);

    const tree = makeTree([classNode]);
    const { nodes } = extractor.extract(tree, 'src/service.ts', 'typescript');

    const classN = nodes.find(n => n.type === 'class');
    expect(classN).toBeDefined();
    expect(classN?.label).toBe('src/service.ts:MyService');
  });

  it('creates defined_in edge from class to file', () => {
    const id = identifier('MyClass', 0);
    const classNode = makeNode('class_declaration', 'class MyClass {}', 0, 10, [id]);

    const tree = makeTree([classNode]);
    const { edges } = extractor.extract(tree, 'src/my-class.ts', 'typescript');

    const edge = edges.find(e => e.type === 'defined_in' && e.fromLabel.includes('MyClass'));
    expect(edge).toBeDefined();
    expect(edge?.toLabel).toBe('src/my-class.ts');
  });
});

describe('ASTExtractor - Interface/Type/Enum nodes', () => {
  it('extracts interface_declaration', () => {
    const typeId = makeNode('type_identifier', 'IUser', 0, 0);
    const interfaceNode = makeNode('interface_declaration', 'interface IUser {}', 0, 5, [typeId]);

    const tree = makeTree([interfaceNode]);
    const { nodes } = extractor.extract(tree, 'src/types.ts', 'typescript');

    const iface = nodes.find(n => n.type === 'interface');
    expect(iface).toBeDefined();
    expect(iface?.label).toContain('IUser');
  });

  it('extracts enum_declaration', () => {
    const id = identifier('Status', 0);
    const enumNode = makeNode('enum_declaration', 'enum Status { active, inactive }', 0, 3, [id]);

    const tree = makeTree([enumNode]);
    const { nodes } = extractor.extract(tree, 'src/enums.ts', 'typescript');

    const enumN = nodes.find(n => n.type === 'enum');
    expect(enumN).toBeDefined();
    expect(enumN?.label).toContain('Status');
  });
});

describe('ASTExtractor - Call edges', () => {
  it('extracts call_expression inside a named function', () => {
    // Build: function caller() { target() }
    const callerIdNode = identifier('caller', 0);

    const targetIdNode = identifier('target', 1);
    const callNode = makeNode('call_expression', 'target()', 1, 1, [targetIdNode]);

    const bodyNode = makeNode('statement_block', '{ target() }', 0, 2, [callNode]);
    const callerFn = makeNode('function_declaration', 'function caller() { target() }', 0, 2, [callerIdNode, bodyNode]);

    const tree = makeTree([callerFn]);
    const { edges } = extractor.extract(tree, 'src/caller.ts', 'typescript');

    const callEdge = edges.find(e => e.type === 'calls');
    expect(callEdge).toBeDefined();
    expect(callEdge?.fromLabel).toContain('caller');
    expect(callEdge?.toLabel).toBe('target');
  });
});

describe('ASTExtractor - Export edges', () => {
  it('extracts export_statement with function', () => {
    const id = identifier('exportedFn', 0);
    const funcNode = makeNode('function_declaration', 'function exportedFn() {}', 0, 5, [id]);
    const exportNode = makeNode('export_statement', 'export function exportedFn() {}', 0, 5, [], [funcNode]);

    const tree = makeTree([exportNode]);
    const { edges } = extractor.extract(tree, 'src/exports.ts', 'typescript');

    const exportEdge = edges.find(e => e.type === 'exports');
    expect(exportEdge).toBeDefined();
    expect(exportEdge?.fromLabel).toBe('src/exports.ts');
    expect(exportEdge?.toLabel).toContain('exportedFn');
  });
});

describe('ASTExtractor - Python support', () => {
  it('extracts Python import_from_statement', () => {
    const moduleNameNode = makeNode('dotted_name', 'os.path', 0, 0);
    const importedName = identifier('join', 0);
    const importNode = makeNode(
      'import_from_statement',
      'from os.path import join',
      0, 0,
      [moduleNameNode, importedName],
    );

    const tree = makeTree([importNode]);
    const { edges } = extractor.extract(tree, 'script.py', 'python');

    const importEdge = edges.find(e => e.type === 'imports');
    expect(importEdge).toBeDefined();
    expect(importEdge?.toLabel).toBe('os.path');

    const symbolEdge = edges.find(e => e.type === 'imports_symbol' && e.toLabel.includes('join'));
    expect(symbolEdge).toBeDefined();
  });

  it('extracts Python function_definition', () => {
    const id = identifier('process_data', 0);
    const funcNode = makeNode('function_definition', 'def process_data():\n  pass', 0, 2, [id]);

    const tree = makeTree([funcNode]);
    const { nodes } = extractor.extract(tree, 'script.py', 'python');

    const fnNode = nodes.find(n => n.type === 'function');
    expect(fnNode).toBeDefined();
    expect(fnNode?.label).toContain('process_data');
  });
});

describe('ASTExtractor - Node types', () => {
  it('returned nodes always include filePath and language', () => {
    const id = identifier('myFn', 0);
    const funcNode = makeNode('function_declaration', 'function myFn() {}', 0, 5, [id]);

    const tree = makeTree([funcNode]);
    const { nodes } = extractor.extract(tree, 'src/test.ts', 'typescript');

    for (const node of nodes) {
      expect(node.filePath).toBe('src/test.ts');
      expect(node.language).toBe('typescript');
    }
  });
});
