const fs = require("fs/promises");
const path = require("path");

const CODE_EXTENSIONS = new Set([".js", ".jsx", ".ts", ".tsx", ".mjs", ".cjs", ".py"]);
const SKIP_DIRS = new Set([".git", "node_modules", "dist", "build", "coverage", ".next"]);

function symbolEntry(name, kind, filePath, line) {
  return {
    name,
    kind,
    file: filePath,
    line
  };
}

function extractJavaScriptSymbols(content, filePath) {
  const entries = [];
  const lines = String(content || "").split(/\r?\n/);
  const patterns = [
    { regex: /^\s*export\s+class\s+([A-Za-z_$][\w$]*)/, kind: "class" },
    { regex: /^\s*class\s+([A-Za-z_$][\w$]*)/, kind: "class" },
    { regex: /^\s*export\s+(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/, kind: "function" },
    { regex: /^\s*(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/, kind: "function" },
    { regex: /^\s*export\s+const\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?\(/, kind: "function" },
    { regex: /^\s*const\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?\(/, kind: "function" },
    { regex: /^\s*export\s+const\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?[^=]+=>/, kind: "function" },
    { regex: /^\s*const\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?[^=]+=>/, kind: "function" },
    { regex: /^\s*export\s+interface\s+([A-Za-z_$][\w$]*)/, kind: "interface" },
    { regex: /^\s*interface\s+([A-Za-z_$][\w$]*)/, kind: "interface" },
    { regex: /^\s*export\s+type\s+([A-Za-z_$][\w$]*)\s*=/, kind: "type" },
    { regex: /^\s*type\s+([A-Za-z_$][\w$]*)\s*=/, kind: "type" },
    { regex: /^\s*export\s+enum\s+([A-Za-z_$][\w$]*)/, kind: "enum" },
    { regex: /^\s*enum\s+([A-Za-z_$][\w$]*)/, kind: "enum" }
  ];

  lines.forEach((lineText, index) => {
    for (const pattern of patterns) {
      const match = lineText.match(pattern.regex);
      if (match) {
        entries.push(symbolEntry(match[1], pattern.kind, filePath, index + 1));
        break;
      }
    }
  });

  return entries;
}

function extractPythonSymbols(content, filePath) {
  const entries = [];
  const lines = String(content || "").split(/\r?\n/);
  const patterns = [
    { regex: /^\s*class\s+([A-Za-z_][\w]*)\s*[\(:]?/, kind: "class" },
    { regex: /^\s*def\s+([A-Za-z_][\w]*)\s*\(/, kind: "function" }
  ];

  lines.forEach((lineText, index) => {
    for (const pattern of patterns) {
      const match = lineText.match(pattern.regex);
      if (match) {
        entries.push(symbolEntry(match[1], pattern.kind, filePath, index + 1));
        break;
      }
    }
  });

  return entries;
}

async function walkCodeFiles(rootPath, results = [], depth = 0, maxDepth = 8, maxFiles = 1000) {
  if (results.length >= maxFiles || depth > maxDepth) {
    return results;
  }

  let entries = [];
  try {
    entries = await fs.readdir(rootPath, { withFileTypes: true });
  } catch {
    return results;
  }

  for (const entry of entries) {
    if (results.length >= maxFiles) {
      return results;
    }

    const fullPath = path.join(rootPath, entry.name);
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) {
        await walkCodeFiles(fullPath, results, depth + 1, maxDepth, maxFiles);
      }
      continue;
    }

    if (CODE_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
      results.push(fullPath);
    }
  }

  return results;
}

async function fileSymbols(filePath, workspaceRoot = process.cwd()) {
  const absolutePath = path.isAbsolute(filePath) ? filePath : path.resolve(workspaceRoot, filePath);
  const content = await fs.readFile(absolutePath, "utf8");
  const ext = path.extname(absolutePath).toLowerCase();
  if (ext === ".py") {
    return extractPythonSymbols(content, absolutePath);
  }
  return extractJavaScriptSymbols(content, absolutePath);
}

async function workspaceSymbols(query, workspaceRoot = process.cwd(), options = {}) {
  const files = await walkCodeFiles(workspaceRoot, [], 0, 8, Number(options.maxFiles || 1000));
  const normalizedQuery = String(query || "").trim().toLowerCase();
  const maxResults = Math.max(1, Math.min(Number(options.maxResults || 100), 300));
  const results = [];

  for (const file of files) {
    const symbols = await fileSymbols(file, workspaceRoot).catch(() => []);
    for (const symbol of symbols) {
      if (!normalizedQuery || symbol.name.toLowerCase().includes(normalizedQuery)) {
        results.push(symbol);
      }
      if (results.length >= maxResults) {
        return results;
      }
    }
  }

  return results;
}

module.exports = {
  fileSymbols,
  workspaceSymbols
};
