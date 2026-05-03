const fs = require("fs");
const fsp = require("fs/promises");
const path = require("path");
const { spawn, spawnSync } = require("child_process");
const { pathToFileURL, fileURLToPath } = require("url");

const SERVER_CATALOG = [
  {
    id: "python",
    extensions: [".py"],
    candidates: [
      { name: "basedpyright", command: "basedpyright-langserver", args: ["--stdio"], languageId: "python" },
      { name: "pyright", command: "pyright-langserver", args: ["--stdio"], languageId: "python" },
      { name: "pylsp", command: "pylsp", args: [], languageId: "python" }
    ]
  },
  {
    id: "rust",
    extensions: [".rs"],
    candidates: [{ name: "rust-analyzer", command: "rust-analyzer", args: [], languageId: "rust" }]
  },
  {
    id: "go",
    extensions: [".go"],
    candidates: [{ name: "gopls", command: "gopls", args: [], languageId: "go" }]
  },
  {
    id: "lua",
    extensions: [".lua"],
    candidates: [{ name: "lua-language-server", command: "lua-language-server", args: [], languageId: "lua" }]
  },
  {
    id: "json",
    extensions: [".json", ".jsonc"],
    candidates: [{ name: "json-ls", command: "vscode-json-language-server", args: ["--stdio"], languageId: "json" }]
  },
  {
    id: "html",
    extensions: [".html", ".htm"],
    candidates: [{ name: "html-ls", command: "vscode-html-language-server", args: ["--stdio"], languageId: "html" }]
  },
  {
    id: "css",
    extensions: [".css", ".scss", ".less"],
    candidates: [{ name: "css-ls", command: "vscode-css-language-server", args: ["--stdio"], languageId: "css" }]
  }
];

const CLIENTS = new Map();
const COMMAND_CACHE = new Map();

function normalizeExtension(filePath) {
  return path.extname(String(filePath || "")).toLowerCase();
}

function findServerSpecForFile(filePath) {
  const extension = normalizeExtension(filePath);
  return SERVER_CATALOG.find((entry) => entry.extensions.includes(extension)) || null;
}

function toFileUri(filePath) {
  return pathToFileURL(path.resolve(filePath)).href;
}

function fromFileUri(uri) {
  if (!String(uri || "").startsWith("file:")) {
    return null;
  }
  try {
    return path.normalize(fileURLToPath(uri));
  } catch {
    return null;
  }
}

function looksExecutableOnWindows(command) {
  return /\.(exe|cmd|bat|ps1)$/i.test(command);
}

function commandExists(command) {
  const cacheKey = process.platform === "win32" ? command.toLowerCase() : command;
  if (COMMAND_CACHE.has(cacheKey)) {
    return COMMAND_CACHE.get(cacheKey);
  }

  const promise = new Promise((resolve) => {
    const checker = process.platform === "win32"
      ? spawn("where.exe", [command], { windowsHide: true, stdio: ["ignore", "pipe", "ignore"] })
      : spawn("which", [command], { stdio: ["ignore", "pipe", "ignore"] });

    let stdout = "";
    checker.stdout?.on("data", (chunk) => {
      stdout += String(chunk || "");
    });
    checker.once("error", () => resolve(null));
    checker.once("close", (code) => {
      if (code === 0) {
        const first = stdout.split(/\r?\n/).map((entry) => entry.trim()).find(Boolean) || null;
        resolve(first);
        return;
      }
      resolve(null);
    });
  });

  COMMAND_CACHE.set(cacheKey, promise);
  return promise;
}

function commandExistsSync(command) {
  const cacheKey = `sync:${process.platform === "win32" ? command.toLowerCase() : command}`;
  if (COMMAND_CACHE.has(cacheKey)) {
    return COMMAND_CACHE.get(cacheKey);
  }

  try {
    const result = process.platform === "win32"
      ? spawnSync("where.exe", [command], { windowsHide: true, encoding: "utf8" })
      : spawnSync("which", [command], { encoding: "utf8" });
    const resolved =
      result.status === 0
        ? String(result.stdout || "")
            .split(/\r?\n/)
            .map((entry) => entry.trim())
            .find(Boolean) || null
        : null;
    COMMAND_CACHE.set(cacheKey, resolved);
    return resolved;
  } catch {
    COMMAND_CACHE.set(cacheKey, null);
    return null;
  }
}

function positionToLsp(line, character) {
  return {
    line: Math.max(0, Number(line || 1) - 1),
    character: Math.max(0, Number(character || 1) - 1)
  };
}

function positionFromLsp(position = {}) {
  return {
    line: Number(position.line || 0) + 1,
    character: Number(position.character || 0) + 1
  };
}

function rangeFromLsp(range = {}) {
  return {
    start: positionFromLsp(range.start || {}),
    end: positionFromLsp(range.end || {})
  };
}

function appendLimited(target, chunk, maxChars) {
  const next = `${target}${chunk}`;
  return next.length > maxChars ? next.slice(next.length - maxChars) : next;
}

function createMessageParser(onMessage) {
  let buffer = Buffer.alloc(0);

  return (chunk) => {
    buffer = Buffer.concat([buffer, Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk || ""), "utf8")]);
    while (buffer.length) {
      const separatorIndex = buffer.indexOf("\r\n\r\n");
      if (separatorIndex < 0) {
        return;
      }

      const headerText = buffer.slice(0, separatorIndex).toString("utf8");
      const match = /Content-Length:\s*(\d+)/i.exec(headerText);
      if (!match) {
        buffer = Buffer.alloc(0);
        return;
      }

      const contentLength = Number(match[1]);
      const totalLength = separatorIndex + 4 + contentLength;
      if (buffer.length < totalLength) {
        return;
      }

      const body = buffer.slice(separatorIndex + 4, totalLength).toString("utf8");
      buffer = buffer.slice(totalLength);

      try {
        onMessage(JSON.parse(body));
      } catch {}
    }
  };
}

async function applyWorkspaceEdit(edit) {
  const changesByFile = new Map();

  if (edit?.changes && typeof edit.changes === "object") {
    for (const [uri, edits] of Object.entries(edit.changes)) {
      const filePath = fromFileUri(uri);
      if (filePath && Array.isArray(edits)) {
        changesByFile.set(filePath, edits);
      }
    }
  }

  if (Array.isArray(edit?.documentChanges)) {
    for (const change of edit.documentChanges) {
      const textDocument = change?.textDocument || change?.textDocumentEdit?.textDocument || null;
      const edits = change?.edits || change?.textDocumentEdit?.edits || [];
      const filePath = fromFileUri(textDocument?.uri);
      if (filePath && Array.isArray(edits)) {
        changesByFile.set(filePath, edits);
      }
    }
  }

  const changedFiles = [];
  for (const [filePath, edits] of changesByFile.entries()) {
    let content = await fsp.readFile(filePath, "utf8");
    const lines = content.split("\n");

    const changes = edits
      .map((entry) => ({
        range: entry.range || {},
        newText: String(entry.newText || "")
      }))
      .sort((left, right) => {
        if ((left.range.start?.line || 0) !== (right.range.start?.line || 0)) {
          return (right.range.start?.line || 0) - (left.range.start?.line || 0);
        }
        return (right.range.start?.character || 0) - (left.range.start?.character || 0);
      });

    for (const change of changes) {
      const startLine = Number(change.range.start?.line || 0);
      const startCharacter = Number(change.range.start?.character || 0);
      const endLine = Number(change.range.end?.line || startLine);
      const endCharacter = Number(change.range.end?.character || startCharacter);

      const beforeLines = lines.slice(0, startLine);
      const afterLines = lines.slice(endLine + 1);
      const startLineText = lines[startLine] || "";
      const endLineText = lines[endLine] || "";
      const beforeSegment = startLineText.slice(0, startCharacter);
      const afterSegment = endLineText.slice(endCharacter);
      const replacementLines = `${beforeSegment}${change.newText}${afterSegment}`.split("\n");
      lines.splice(0, lines.length, ...beforeLines, ...replacementLines, ...afterLines);
    }

    content = lines.join("\n");
    await fsp.writeFile(filePath, content, "utf8");
    changedFiles.push(filePath);
  }

  return changedFiles;
}

class ExternalLspClient {
  constructor(workspaceRoot, serverSpec, executablePath) {
    this.workspaceRoot = path.resolve(workspaceRoot);
    this.serverSpec = serverSpec;
    this.executablePath = executablePath;
    this.id = `${serverSpec.id}:${this.workspaceRoot}`;
    this.child = null;
    this.initialized = false;
    this.requestCounter = 0;
    this.pending = new Map();
    this.documents = new Map();
    this.stdout = "";
    this.stderr = "";
    this.lastError = null;
    this.capabilities = {};
    this.activeLanguageId = serverSpec.candidates[0]?.languageId || "plaintext";
  }

  async start() {
    if (this.child && this.initialized) {
      return;
    }

    const candidate = this.serverSpec.candidates.find((entry) => entry.command === path.basename(this.executablePath) || entry.command === this.executablePath) || this.serverSpec.candidates[0];
    this.activeLanguageId = candidate?.languageId || this.activeLanguageId;
    this.child = spawn(this.executablePath, candidate?.args || [], {
      cwd: this.workspaceRoot,
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"]
    });

    this.child.stdin.setDefaultEncoding("utf8");
    const parseStdout = createMessageParser((message) => this._handleMessage(message));
    this.child.stdout?.on("data", (chunk) => {
      this.stdout = appendLimited(this.stdout, Buffer.isBuffer(chunk) ? chunk.toString("utf8") : String(chunk || ""), 30000);
      parseStdout(chunk);
    });
    this.child.stderr?.on("data", (chunk) => {
      this.stderr = appendLimited(this.stderr, Buffer.isBuffer(chunk) ? chunk.toString("utf8") : String(chunk || ""), 30000);
    });
    this.child.once("error", (error) => {
      this.lastError = error.message || "Falha ao iniciar servidor LSP externo.";
    });
    this.child.once("close", (code) => {
      this.initialized = false;
      if (code !== 0) {
        this.lastError = this.lastError || `Servidor LSP externo encerrou com codigo ${code}.`;
      }
      for (const pending of this.pending.values()) {
        pending.reject(new Error(this.lastError || "Servidor LSP externo foi encerrado."));
      }
      this.pending.clear();
    });

    const initializeResult = await this.request("initialize", {
      processId: process.pid,
      rootUri: toFileUri(this.workspaceRoot),
      rootPath: this.workspaceRoot,
      workspaceFolders: [{ uri: toFileUri(this.workspaceRoot), name: path.basename(this.workspaceRoot) }],
      capabilities: {
        workspace: {
          applyEdit: true,
          workspaceEdit: { documentChanges: true }
        },
        textDocument: {
          codeAction: {
            codeActionLiteralSupport: {
              codeActionKind: {
                valueSet: ["quickfix", "refactor", "refactor.extract", "refactor.inline", "refactor.rewrite"]
              }
            }
          }
        }
      },
      clientInfo: {
        name: "dream-server-desktop",
        version: "0.1.0"
      }
    });

    this.capabilities = initializeResult?.capabilities || {};
    await this.notify("initialized", {});
    this.initialized = true;
  }

  _handleMessage(message) {
    if (Object.prototype.hasOwnProperty.call(message || {}, "id") && this.pending.has(message.id)) {
      const current = this.pending.get(message.id);
      this.pending.delete(message.id);
      if (message.error) {
        current.reject(new Error(message.error.message || "Falha em request LSP externo."));
        return;
      }
      current.resolve(message.result);
      return;
    }

    if (message?.method === "workspace/applyEdit") {
      Promise.resolve(applyWorkspaceEdit(message.params?.edit))
        .then(() => this.respond(message.id, { applied: true }))
        .catch((error) => this.respondError(message.id, error.message || "Falha ao aplicar edit do servidor."))
        .catch(() => {});
      return;
    }

    if (message?.method === "workspace/configuration") {
      const items = Array.isArray(message.params?.items) ? message.params.items.map(() => null) : [];
      void this.respond(message.id, items);
      return;
    }

    if (message?.method === "window/showMessageRequest") {
      void this.respond(message.id, null);
      return;
    }

    if (Object.prototype.hasOwnProperty.call(message || {}, "id")) {
      void this.respond(message.id, null);
    }
  }

  _write(payload) {
    const body = Buffer.from(JSON.stringify(payload), "utf8");
    const header = Buffer.from(`Content-Length: ${body.length}\r\n\r\n`, "utf8");
    this.child.stdin.write(Buffer.concat([header, body]));
  }

  request(method, params) {
    const id = ++this.requestCounter;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      try {
        this._write({ jsonrpc: "2.0", id, method, params });
      } catch (error) {
        this.pending.delete(id);
        reject(error);
      }
    });
  }

  async notify(method, params) {
    this._write({ jsonrpc: "2.0", method, params });
  }

  async respond(id, result) {
    if (id === undefined || id === null) {
      return;
    }
    this._write({ jsonrpc: "2.0", id, result });
  }

  async respondError(id, message) {
    if (id === undefined || id === null) {
      return;
    }
    this._write({ jsonrpc: "2.0", id, error: { code: -32000, message } });
  }

  async ensureDocument(filePath) {
    await this.start();
    const absolutePath = path.resolve(filePath);
    const uri = toFileUri(absolutePath);
    const text = await fsp.readFile(absolutePath, "utf8");
    const known = this.documents.get(uri);

    if (!known) {
      this.documents.set(uri, { version: 1, text });
      await this.notify("textDocument/didOpen", {
        textDocument: {
          uri,
          languageId: this.activeLanguageId,
          version: 1,
          text
        }
      });
      return uri;
    }

    if (known.text !== text) {
      const nextVersion = known.version + 1;
      this.documents.set(uri, { version: nextVersion, text });
      await this.notify("textDocument/didChange", {
        textDocument: {
          uri,
          version: nextVersion
        },
        contentChanges: [{ text }]
      });
    }

    return uri;
  }

  async documentSymbols(filePath) {
    const uri = await this.ensureDocument(filePath);
    return await this.request("textDocument/documentSymbol", {
      textDocument: { uri }
    });
  }

  async workspaceSymbols(query = "") {
    await this.start();
    return await this.request("workspace/symbol", { query: String(query || "") });
  }

  async definition(filePath, line, character) {
    const uri = await this.ensureDocument(filePath);
    return await this.request("textDocument/definition", {
      textDocument: { uri },
      position: positionToLsp(line, character)
    });
  }

  async references(filePath, line, character) {
    const uri = await this.ensureDocument(filePath);
    return await this.request("textDocument/references", {
      textDocument: { uri },
      position: positionToLsp(line, character),
      context: {
        includeDeclaration: true
      }
    });
  }

  async hover(filePath, line, character) {
    const uri = await this.ensureDocument(filePath);
    return await this.request("textDocument/hover", {
      textDocument: { uri },
      position: positionToLsp(line, character)
    });
  }

  async codeActions(filePath, line, character, endLine, endCharacter) {
    const uri = await this.ensureDocument(filePath);
    return await this.request("textDocument/codeAction", {
      textDocument: { uri },
      range: {
        start: positionToLsp(line, character),
        end: positionToLsp(endLine || line, endCharacter || character)
      },
      context: {
        diagnostics: []
      }
    });
  }

  async rename(filePath, line, character, newName) {
    const uri = await this.ensureDocument(filePath);
    return await this.request("textDocument/rename", {
      textDocument: { uri },
      position: positionToLsp(line, character),
      newName: String(newName || "")
    });
  }

  async executeCommand(command, argumentsList = []) {
    await this.start();
    return await this.request("workspace/executeCommand", {
      command,
      arguments: Array.isArray(argumentsList) ? argumentsList : []
    });
  }

  snapshot() {
    return {
      id: this.serverSpec.id,
      workspaceRoot: this.workspaceRoot,
      executablePath: this.executablePath,
      initialized: this.initialized,
      lastError: this.lastError,
      stderrTail: this.stderr.slice(-3000)
    };
  }
}

async function getServerAvailability() {
  const availability = [];
  for (const server of SERVER_CATALOG) {
    let resolved = null;
    let selected = null;
    for (const candidate of server.candidates) {
      const found = await commandExists(candidate.command);
      if (found) {
        resolved = looksExecutableOnWindows(found) ? found : candidate.command;
        selected = candidate;
        break;
      }
    }
    availability.push({
      id: server.id,
      extensions: [...server.extensions],
      available: Boolean(resolved),
      candidate: selected?.name || null,
      command: resolved || null
    });
  }
  return availability;
}

function getServerAvailabilitySync() {
  return SERVER_CATALOG.map((server) => {
    let resolved = null;
    let selected = null;
    for (const candidate of server.candidates) {
      const found = commandExistsSync(candidate.command);
      if (found) {
        resolved = looksExecutableOnWindows(found) ? found : candidate.command;
        selected = candidate;
        break;
      }
    }
    return {
      id: server.id,
      extensions: [...server.extensions],
      available: Boolean(resolved),
      candidate: selected?.name || null,
      command: resolved || null
    };
  });
}

function getActiveClientSnapshots() {
  return [...CLIENTS.values()].map((client) => client.snapshot());
}

async function getClientForFile(filePath, workspaceRoot = process.cwd()) {
  const spec = findServerSpecForFile(filePath);
  if (!spec) {
    return null;
  }

  let resolvedCommand = null;
  for (const candidate of spec.candidates) {
    const found = await commandExists(candidate.command);
    if (found) {
      resolvedCommand = looksExecutableOnWindows(found) ? found : candidate.command;
      break;
    }
  }

  if (!resolvedCommand) {
    return null;
  }

  const key = `${spec.id}:${path.resolve(workspaceRoot)}`;
  let client = CLIENTS.get(key);
  if (!client) {
    client = new ExternalLspClient(workspaceRoot, spec, resolvedCommand);
    CLIENTS.set(key, client);
  }
  return client;
}

function normalizeSymbolResults(items, workspaceRoot) {
  const entries = Array.isArray(items) ? items : [];
  const results = [];

  const visit = (item, inheritedFile = null, inheritedContainer = null) => {
    const location = item.location || {};
    const uri = location.uri || item.uri || null;
    const filePath = fromFileUri(uri) || inheritedFile || path.resolve(workspaceRoot);
    const range = location.range || item.selectionRange || item.range || {};
    const start = rangeFromLsp(range).start;
    const currentName = item.name || "(anonimo)";
    results.push({
      name: currentName,
      kind: String(item.kind || "symbol").toLowerCase(),
      file: filePath,
      line: start.line,
      character: start.character,
      container: item.containerName || inheritedContainer || null
    });

    if (Array.isArray(item.children)) {
      for (const child of item.children) {
        visit(child, filePath, currentName);
      }
    }
  };

  for (const item of entries) {
    visit(item, null, null);
  }

  return results;
}

function normalizeLocationResults(items, workspaceRoot) {
  const entries = Array.isArray(items) ? items : items ? [items] : [];
  return entries
    .map((item) => {
      const target = item.targetUri
        ? { uri: item.targetUri, range: item.targetSelectionRange || item.targetRange || {} }
        : item;
      const filePath = fromFileUri(target?.uri) || null;
      if (!filePath) {
        return null;
      }
      const start = rangeFromLsp(target.range || {}).start;
      return {
        file: filePath,
        line: start.line,
        character: start.character
      };
    })
    .filter(Boolean);
}

function normalizeHoverResult(hover) {
  if (!hover) {
    return null;
  }

  const raw = hover.contents;
  if (typeof raw === "string") {
    return { display: raw, documentation: "", kind: "external" };
  }
  if (Array.isArray(raw)) {
    return {
      display: raw
        .map((entry) => {
          if (typeof entry === "string") {
            return entry;
          }
          if (entry?.value) {
            return String(entry.value);
          }
          return "";
        })
        .filter(Boolean)
        .join("\n"),
      documentation: "",
      kind: "external"
    };
  }
  if (raw?.value) {
    return {
      display: String(raw.value),
      documentation: "",
      kind: raw.language ? String(raw.language) : "external"
    };
  }
  return {
    display: "",
    documentation: "",
    kind: "external"
  };
}

function encodeActionToken(payload) {
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
}

function decodeActionToken(token) {
  return JSON.parse(Buffer.from(String(token || ""), "base64url").toString("utf8"));
}

module.exports = {
  SERVER_CATALOG,
  applyWorkspaceEdit,
  decodeActionToken,
  encodeActionToken,
  findServerSpecForFile,
  fromFileUri,
  getClientForFile,
  getActiveClientSnapshots,
  getServerAvailability,
  getServerAvailabilitySync,
  normalizeHoverResult,
  normalizeLocationResults,
  normalizeSymbolResults,
  toFileUri
};
