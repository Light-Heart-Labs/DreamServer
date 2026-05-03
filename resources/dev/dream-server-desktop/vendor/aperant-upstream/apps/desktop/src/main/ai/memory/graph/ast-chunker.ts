/**
 * AST-based File Chunker
 *
 * Splits files at function/class boundaries using tree-sitter.
 * For files without AST structure (JSON, .md, .txt), falls back to 100-line chunks.
 *
 * The contextPrefix is critical — it is prepended at embed time for contextual embeddings.
 */

import type { Node, Parser, Tree } from 'web-tree-sitter';
import { basename } from 'path';

export interface ASTChunk {
  content: string;
  filePath: string;
  language: string;
  chunkType: 'function' | 'class' | 'module' | 'prose';
  startLine: number;
  endLine: number;
  name?: string;
  contextPrefix: string;
}

const FALLBACK_CHUNK_SIZE = 100;

/**
 * Determines chunk type from a tree-sitter node type.
 */
function nodeTypeToChunkType(nodeType: string): 'function' | 'class' {
  const CLASS_TYPES = new Set([
    'class_declaration', 'class_definition',
    'interface_declaration', 'enum_declaration', 'struct_item',
  ]);
  return CLASS_TYPES.has(nodeType) ? 'class' : 'function';
}

/**
 * Extracts the name of a declaration node.
 */
function extractName(node: Node): string | undefined {
  // Direct child named 'name' or first identifier
  for (let i = 0; i < node.childCount; i++) {
    const child = node.child(i);
    if (!child) continue;
    if (
      child.type === 'identifier' ||
      child.type === 'property_identifier' ||
      child.type === 'type_identifier'
    ) {
      return child.text;
    }
  }
  // Named children fallback
  for (let i = 0; i < node.namedChildCount; i++) {
    const child = node.namedChild(i);
    if (!child) continue;
    if (child.type === 'identifier' || child.type === 'type_identifier') {
      return child.text;
    }
  }
  return undefined;
}

/**
 * Builds the contextPrefix for a chunk.
 * Format: "File: path/to/file.ts | function: myFunction | Lines: 10-25"
 */
function buildContextPrefix(
  filePath: string,
  chunkType: 'function' | 'class' | 'module' | 'prose',
  name: string | undefined,
  startLine: number,
  endLine: number,
): string {
  const parts: string[] = [`File: ${filePath}`];
  if (chunkType !== 'module' && chunkType !== 'prose' && name) {
    parts.push(`${chunkType}: ${name}`);
  }
  parts.push(`Lines: ${startLine}-${endLine}`);
  return parts.join(' | ');
}

/**
 * Fallback: chunk by fixed line count (for non-code files).
 */
function fallbackChunks(content: string, filePath: string): ASTChunk[] {
  const lines = content.split('\n');
  const chunks: ASTChunk[] = [];

  for (let i = 0; i < lines.length; i += FALLBACK_CHUNK_SIZE) {
    const startLine = i + 1;
    const endLine = Math.min(i + FALLBACK_CHUNK_SIZE, lines.length);
    const chunkContent = lines.slice(i, i + FALLBACK_CHUNK_SIZE).join('\n');

    chunks.push({
      content: chunkContent,
      filePath,
      language: 'text',
      chunkType: 'prose',
      startLine,
      endLine,
      contextPrefix: buildContextPrefix(filePath, 'prose', undefined, startLine, endLine),
    });
  }

  return chunks;
}

/**
 * Node types that should be top-level chunks.
 * Keyed by language.
 */
const CHUNK_NODE_TYPES: Record<string, Set<string>> = {
  typescript: new Set([
    'function_declaration',
    'class_declaration',
    'interface_declaration',
    'type_alias_declaration',
    'enum_declaration',
    'export_statement', // export default function / export class
  ]),
  tsx: new Set([
    'function_declaration',
    'class_declaration',
    'interface_declaration',
    'type_alias_declaration',
    'enum_declaration',
    'export_statement',
  ]),
  javascript: new Set([
    'function_declaration',
    'class_declaration',
    'export_statement',
  ]),
  python: new Set([
    'function_definition',
    'class_definition',
    'decorated_definition',
  ]),
  rust: new Set([
    'function_item',
    'impl_item',
    'struct_item',
    'enum_item',
    'trait_item',
  ]),
  go: new Set([
    'function_declaration',
    'method_declaration',
    'type_declaration',
  ]),
  java: new Set([
    'class_declaration',
    'method_declaration',
    'interface_declaration',
    'enum_declaration',
  ]),
};

/**
 * Checks if a node represents an arrow function variable binding.
 * e.g. const foo = () => {}
 */
function isArrowFunctionDecl(node: Node): { name: string } | null {
  if (node.type !== 'lexical_declaration' && node.type !== 'variable_declaration') return null;

  for (let i = 0; i < node.namedChildCount; i++) {
    const decl = node.namedChild(i);
    if (!decl || decl.type !== 'variable_declarator') continue;
    const nameNode = decl.namedChild(0);
    const valueNode = decl.namedChild(1);
    if (!nameNode || !valueNode) continue;
    if (valueNode.type === 'arrow_function' || valueNode.type === 'function') {
      return { name: nameNode.text };
    }
  }
  return null;
}

/**
 * Main chunking function.
 * Splits at function/class boundaries using tree-sitter.
 * Falls back to 100-line chunks for unsupported languages.
 */
export async function chunkFileByAST(
  filePath: string,
  content: string,
  lang: string,
  parser: Parser,
): Promise<ASTChunk[]> {
  if (!content.trim()) return [];

  const chunkNodeTypes = CHUNK_NODE_TYPES[lang];
  if (!chunkNodeTypes) {
    return fallbackChunks(content, filePath);
  }

  let tree: Tree | null;
  try {
    tree = parser.parse(content);
  } catch {
    return fallbackChunks(content, filePath);
  }

  if (!tree) return fallbackChunks(content, filePath);

  const lines = content.split('\n');
  const chunks: ASTChunk[] = [];
  const coveredRanges: Array<{ start: number; end: number }> = [];

  // Walk top-level nodes looking for chunk boundaries
  const rootNode = tree.rootNode;

  for (let i = 0; i < rootNode.childCount; i++) {
    const child = rootNode.child(i);
    if (!child) continue;

    let chunkName: string | undefined;
    let chunkType: 'function' | 'class' | 'module' | 'prose' = 'function';
    let shouldChunk = false;

    if (chunkNodeTypes.has(child.type)) {
      shouldChunk = true;
      chunkName = extractName(child);
      chunkType = nodeTypeToChunkType(child.type);

      // For export_statement, look at what's being exported
      if (child.type === 'export_statement') {
        const exported = child.namedChild(0);
        if (exported) {
          chunkName = extractName(exported);
          chunkType = nodeTypeToChunkType(exported.type);
        }
      }
    } else {
      // Check for arrow function variable bindings
      const arrowDecl = isArrowFunctionDecl(child);
      if (arrowDecl) {
        shouldChunk = true;
        chunkName = arrowDecl.name;
        chunkType = 'function';
      }
    }

    if (shouldChunk) {
      const startLine = child.startPosition.row + 1;
      const endLine = child.endPosition.row + 1;

      const chunkContent = lines.slice(startLine - 1, endLine).join('\n');

      chunks.push({
        content: chunkContent,
        filePath,
        language: lang,
        chunkType,
        startLine,
        endLine,
        name: chunkName,
        contextPrefix: buildContextPrefix(filePath, chunkType, chunkName, startLine, endLine),
      });

      coveredRanges.push({ start: startLine, end: endLine });
    }
  }

  // Collect uncovered lines as 'module' chunks (top-level non-function code)
  const uncoveredLines = collectUncoveredLines(lines, coveredRanges);
  if (uncoveredLines.length > 0) {
    const moduleChunks = groupLinesIntoChunks(uncoveredLines, filePath, lang);
    chunks.push(...moduleChunks);
  }

  // If no structured chunks were found, fall back
  if (chunks.length === 0) {
    return fallbackChunks(content, filePath);
  }

  // Sort chunks by start line
  return chunks.sort((a, b) => a.startLine - b.startLine);
}

/**
 * Returns line numbers not covered by any chunk.
 */
function collectUncoveredLines(
  lines: string[],
  covered: Array<{ start: number; end: number }>,
): number[] {
  const uncovered: number[] = [];
  for (let i = 1; i <= lines.length; i++) {
    const inCovered = covered.some(r => i >= r.start && i <= r.end);
    if (!inCovered && lines[i - 1].trim()) {
      uncovered.push(i);
    }
  }
  return uncovered;
}

/**
 * Groups consecutive uncovered lines into module-level chunks.
 */
function groupLinesIntoChunks(
  lineNumbers: number[],
  filePath: string,
  lang: string,
): ASTChunk[] {
  if (lineNumbers.length === 0) return [];

  const chunks: ASTChunk[] = [];
  let groupStart = lineNumbers[0];
  let groupEnd = lineNumbers[0];

  for (let i = 1; i < lineNumbers.length; i++) {
    if (lineNumbers[i] === groupEnd + 1) {
      groupEnd = lineNumbers[i];
    } else {
      chunks.push(buildModuleChunk(groupStart, groupEnd, filePath, lang));
      groupStart = lineNumbers[i];
      groupEnd = lineNumbers[i];
    }
  }
  chunks.push(buildModuleChunk(groupStart, groupEnd, filePath, lang));

  return chunks;
}

function buildModuleChunk(
  startLine: number,
  endLine: number,
  filePath: string,
  lang: string,
): ASTChunk {
  const fileName = basename(filePath);
  return {
    content: '', // Content is stored by EmbeddingService when reading the file
    filePath,
    language: lang,
    chunkType: 'module',
    startLine,
    endLine,
    name: fileName,
    contextPrefix: buildContextPrefix(filePath, 'module', fileName, startLine, endLine),
  };
}
