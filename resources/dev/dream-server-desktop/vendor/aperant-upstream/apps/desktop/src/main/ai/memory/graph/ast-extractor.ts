/**
 * AST Extractor
 *
 * Extracts structural information from parsed tree-sitter AST trees.
 * Extracts: imports, functions, classes, call edges, exports.
 */

import type { Node, Tree } from 'web-tree-sitter';
import type { GraphNodeType, GraphEdgeType } from '../types';

export interface ExtractedNode {
  type: GraphNodeType;
  label: string;
  filePath: string;
  language: string;
  startLine: number;
  endLine: number;
  metadata?: Record<string, unknown>;
}

export interface ExtractedEdge {
  fromLabel: string;
  toLabel: string;
  type: GraphEdgeType;
  metadata?: Record<string, unknown>;
}

export interface ExtractionResult {
  nodes: ExtractedNode[];
  edges: ExtractedEdge[];
}

/**
 * Extracts the identifier name from a node (e.g. function_declaration name).
 */
function extractIdentifier(node: Node): string | null {
  // Look for a direct 'name' or 'identifier' child
  for (let i = 0; i < node.childCount; i++) {
    const child = node.child(i);
    if (!child) continue;
    if (child.type === 'identifier' || child.type === 'property_identifier') {
      return child.text;
    }
    if (child.type === 'type_identifier') {
      return child.text;
    }
  }
  // For named nodes that have a direct .text that is short (e.g. class name)
  if (node.namedChildCount > 0) {
    const firstNamed = node.namedChild(0);
    if (firstNamed && (firstNamed.type === 'identifier' || firstNamed.type === 'type_identifier')) {
      return firstNamed.text;
    }
  }
  return null;
}

/**
 * Extract the import source path from an import_statement node.
 * e.g. import { foo } from './bar' → './bar'
 */
function extractImportSource(node: Node): string | null {
  for (let i = 0; i < node.childCount; i++) {
    const child = node.child(i);
    if (!child) continue;
    if (child.type === 'string' || child.type === 'string_fragment') {
      // Strip quotes
      return child.text.replace(/['"]/g, '');
    }
    if (child.type === 'module_specifier') {
      return child.text.replace(/['"]/g, '');
    }
  }
  return null;
}

/**
 * Extract named imports from an import_statement node.
 * e.g. import { foo, bar } from './x' → ['foo', 'bar']
 */
function extractNamedImports(node: Node): string[] {
  const symbols: string[] = [];

  const walkForImports = (n: Node) => {
    if (n.type === 'import_specifier') {
      for (let i = 0; i < n.childCount; i++) {
        const child = n.child(i);
        if (child?.type === 'identifier') {
          symbols.push(child.text);
          break; // Only take the first identifier (the imported name)
        }
      }
    }
    for (let i = 0; i < n.childCount; i++) {
      const child = n.child(i);
      if (child) walkForImports(child);
    }
  };

  walkForImports(node);
  return [...new Set(symbols)];
}

/**
 * Extract call target from a call_expression.
 * Returns the name of the function being called (syntactic only).
 */
function extractCallTarget(node: Node): string | null {
  const fn = node.namedChild(0);
  if (!fn) return null;

  if (fn.type === 'identifier') return fn.text;
  if (fn.type === 'member_expression') {
    // e.g. foo.bar() — return 'foo.bar'
    return fn.text;
  }
  return null;
}

export class ASTExtractor {
  extract(tree: Tree, filePath: string, language: string): ExtractionResult {
    const nodes: ExtractedNode[] = [];
    const edges: ExtractedEdge[] = [];
    const fileLabel = filePath;

    // File node is always added
    nodes.push({
      type: 'file',
      label: fileLabel,
      filePath,
      language,
      startLine: 1,
      endLine: tree.rootNode.endPosition.row + 1,
    });

    // Context: current container (class/function) for tracking defined_in edges
    const containerStack: string[] = [fileLabel];

    const pushContainer = (label: string) => containerStack.push(label);
    const popContainer = () => {
      if (containerStack.length > 1) containerStack.pop();
    };
    const currentContainer = () => containerStack[containerStack.length - 1];

    this.walkAndExtract(
      tree.rootNode,
      filePath,
      language,
      nodes,
      edges,
      containerStack,
      pushContainer,
      popContainer,
      currentContainer,
    );

    return { nodes, edges };
  }

  private walkAndExtract(
    node: Node,
    filePath: string,
    language: string,
    nodes: ExtractedNode[],
    edges: ExtractedEdge[],
    containerStack: string[],
    pushContainer: (label: string) => void,
    popContainer: () => void,
    currentContainer: () => string,
  ): void {
    const fileLabel = filePath;

    switch (node.type) {
      // ---- IMPORTS ----
      case 'import_statement': {
        const source = extractImportSource(node);
        if (source) {
          edges.push({
            fromLabel: fileLabel,
            toLabel: source,
            type: 'imports',
          });

          const symbols = extractNamedImports(node);
          for (const sym of symbols) {
            edges.push({
              fromLabel: fileLabel,
              toLabel: `${source}:${sym}`,
              type: 'imports_symbol',
            });
          }
        }
        break;
      }

      // Python imports
      case 'import_from_statement': {
        // from x import y
        let moduleName: string | null = null;
        const importedNames: string[] = [];
        for (let i = 0; i < node.childCount; i++) {
          const child = node.child(i);
          if (!child) continue;
          if (child.type === 'dotted_name' && !moduleName) {
            moduleName = child.text;
          } else if (child.type === 'identifier') {
            importedNames.push(child.text);
          }
        }
        if (moduleName) {
          edges.push({ fromLabel: fileLabel, toLabel: moduleName, type: 'imports' });
          for (const name of importedNames) {
            edges.push({ fromLabel: fileLabel, toLabel: `${moduleName}:${name}`, type: 'imports_symbol' });
          }
        }
        break;
      }

      // ---- FUNCTION DEFINITIONS ----
      case 'function_declaration':
      case 'function_definition': // Python
      {
        const name = extractIdentifier(node);
        if (name) {
          const label = `${fileLabel}:${name}`;
          nodes.push({
            type: 'function',
            label,
            filePath,
            language,
            startLine: node.startPosition.row + 1,
            endLine: node.endPosition.row + 1,
          });
          edges.push({
            fromLabel: label,
            toLabel: currentContainer(),
            type: 'defined_in',
          });
          pushContainer(label);
          this.walkChildren(node, filePath, language, nodes, edges, containerStack, pushContainer, popContainer, currentContainer);
          popContainer();
          return; // skip default child traversal
        }
        break;
      }

      case 'method_definition':
      case 'function_signature': {
        const name = extractIdentifier(node);
        if (name) {
          const label = `${fileLabel}:${name}`;
          nodes.push({
            type: 'function',
            label,
            filePath,
            language,
            startLine: node.startPosition.row + 1,
            endLine: node.endPosition.row + 1,
          });
          edges.push({
            fromLabel: label,
            toLabel: currentContainer(),
            type: 'defined_in',
          });
          pushContainer(label);
          this.walkChildren(node, filePath, language, nodes, edges, containerStack, pushContainer, popContainer, currentContainer);
          popContainer();
          return;
        }
        break;
      }

      // Arrow functions with variable binding: const foo = () => {}
      case 'lexical_declaration':
      case 'variable_declaration': {
        // Look for: const NAME = arrow_function
        for (let i = 0; i < node.namedChildCount; i++) {
          const decl = node.namedChild(i);
          if (!decl || decl.type !== 'variable_declarator') continue;
          const nameNode = decl.namedChild(0);
          const valueNode = decl.namedChild(1);
          if (!nameNode || !valueNode) continue;
          if (valueNode.type === 'arrow_function' || valueNode.type === 'function') {
            const name = nameNode.text;
            const label = `${fileLabel}:${name}`;
            nodes.push({
              type: 'function',
              label,
              filePath,
              language,
              startLine: node.startPosition.row + 1,
              endLine: node.endPosition.row + 1,
            });
            edges.push({
              fromLabel: label,
              toLabel: currentContainer(),
              type: 'defined_in',
            });
          }
        }
        break;
      }

      // ---- CLASS DEFINITIONS ----
      case 'class_declaration':
      case 'class_definition': // Python
      {
        const name = extractIdentifier(node);
        if (name) {
          const label = `${fileLabel}:${name}`;
          nodes.push({
            type: 'class',
            label,
            filePath,
            language,
            startLine: node.startPosition.row + 1,
            endLine: node.endPosition.row + 1,
          });
          edges.push({
            fromLabel: label,
            toLabel: currentContainer(),
            type: 'defined_in',
          });

          // extends clause
          for (let i = 0; i < node.childCount; i++) {
            const child = node.child(i);
            if (!child) continue;
            if (child.type === 'class_heritage') {
              for (let j = 0; j < child.childCount; j++) {
                const hChild = child.child(j);
                if (hChild?.type === 'extends_clause' || hChild?.type === 'implements_clause') {
                  for (let k = 0; k < hChild.childCount; k++) {
                    const base = hChild.child(k);
                    if (base?.type === 'identifier' || base?.type === 'type_identifier') {
                      edges.push({
                        fromLabel: label,
                        toLabel: `${fileLabel}:${base.text}`,
                        type: hChild.type === 'extends_clause' ? 'extends' : 'implements',
                      });
                    }
                  }
                }
              }
            }
          }

          pushContainer(label);
          this.walkChildren(node, filePath, language, nodes, edges, containerStack, pushContainer, popContainer, currentContainer);
          popContainer();
          return;
        }
        break;
      }

      // ---- INTERFACE / TYPE ALIAS ----
      case 'interface_declaration': {
        const name = extractIdentifier(node);
        if (name) {
          const label = `${fileLabel}:${name}`;
          nodes.push({
            type: 'interface',
            label,
            filePath,
            language,
            startLine: node.startPosition.row + 1,
            endLine: node.endPosition.row + 1,
          });
          edges.push({ fromLabel: label, toLabel: currentContainer(), type: 'defined_in' });
        }
        break;
      }

      case 'type_alias_declaration': {
        const name = extractIdentifier(node);
        if (name) {
          const label = `${fileLabel}:${name}`;
          nodes.push({
            type: 'type_alias',
            label,
            filePath,
            language,
            startLine: node.startPosition.row + 1,
            endLine: node.endPosition.row + 1,
          });
          edges.push({ fromLabel: label, toLabel: currentContainer(), type: 'defined_in' });
        }
        break;
      }

      // ---- ENUM ----
      case 'enum_declaration': {
        const name = extractIdentifier(node);
        if (name) {
          const label = `${fileLabel}:${name}`;
          nodes.push({
            type: 'enum',
            label,
            filePath,
            language,
            startLine: node.startPosition.row + 1,
            endLine: node.endPosition.row + 1,
          });
          edges.push({ fromLabel: label, toLabel: currentContainer(), type: 'defined_in' });
        }
        break;
      }

      // ---- CALL EXPRESSIONS ----
      case 'call_expression': {
        const target = extractCallTarget(node);
        const container = currentContainer();
        if (target && container !== filePath) {
          // Only emit call edges from named functions/classes, not from file scope
          edges.push({
            fromLabel: container,
            toLabel: target,
            type: 'calls',
          });
        }
        break;
      }

      // ---- EXPORTS ----
      case 'export_statement': {
        for (let i = 0; i < node.namedChildCount; i++) {
          const child = node.namedChild(i);
          if (!child) continue;
          if (
            child.type === 'function_declaration' ||
            child.type === 'class_declaration' ||
            child.type === 'interface_declaration'
          ) {
            const name = extractIdentifier(child);
            if (name) {
              edges.push({
                fromLabel: fileLabel,
                toLabel: `${fileLabel}:${name}`,
                type: 'exports',
              });
            }
          }
        }
        break;
      }
    }

    // Default: traverse children
    this.walkChildren(node, filePath, language, nodes, edges, containerStack, pushContainer, popContainer, currentContainer);
  }

  private walkChildren(
    node: Node,
    filePath: string,
    language: string,
    nodes: ExtractedNode[],
    edges: ExtractedEdge[],
    containerStack: string[],
    pushContainer: (label: string) => void,
    popContainer: () => void,
    currentContainer: () => string,
  ): void {
    for (let i = 0; i < node.childCount; i++) {
      const child = node.child(i);
      if (child) {
        this.walkAndExtract(child, filePath, language, nodes, edges, containerStack, pushContainer, popContainer, currentContainer);
      }
    }
  }
}
