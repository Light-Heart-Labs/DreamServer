const fs = require("fs");
const fsp = require("fs/promises");
const path = require("path");
const {
  applyWorkspaceEdit,
  decodeActionToken,
  encodeActionToken,
  getActiveClientSnapshots,
  getClientForFile,
  getServerAvailabilitySync,
  normalizeHoverResult,
  normalizeLocationResults,
  normalizeSymbolResults
} = require("./lsp-external");

const SUPPORTED_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"]);
const SKIP_DIRS = new Set([".git", "node_modules", "dist", "build", "coverage", ".next", ".idea", ".vscode"]);
const PROJECTS = new Map();

let cachedTsModule = undefined;
let cachedTsError = null;

function loadTypeScript() {
  if (cachedTsModule !== undefined) {
    return cachedTsModule;
  }

  try {
    cachedTsModule = require("typescript");
    cachedTsError = null;
  } catch (error) {
    cachedTsModule = null;
    cachedTsError = error instanceof Error ? error.message : String(error || "Falha ao carregar TypeScript.");
  }

  return cachedTsModule;
}

function isSupportedLspFile(filePath) {
  return SUPPORTED_EXTENSIONS.has(path.extname(String(filePath || "")).toLowerCase());
}

function ensureAbsolute(filePath, workspaceRoot = process.cwd()) {
  return path.isAbsolute(filePath)
    ? path.normalize(filePath)
    : path.normalize(path.resolve(workspaceRoot, filePath));
}

function walkSourceFiles(rootPath, results = [], depth = 0, maxDepth = 8, maxFiles = 2400) {
  if (results.length >= maxFiles || depth > maxDepth) {
    return results;
  }

  let entries = [];
  try {
    entries = fs.readdirSync(rootPath, { withFileTypes: true });
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
        walkSourceFiles(fullPath, results, depth + 1, maxDepth, maxFiles);
      }
      continue;
    }

    if (isSupportedLspFile(fullPath)) {
      results.push(path.normalize(fullPath));
    }
  }

  return results;
}

function displayPartsToString(parts) {
  return Array.isArray(parts) ? parts.map((entry) => entry.text || "").join("") : "";
}

function clampNumber(value, min, max, fallback) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return fallback;
  }
  return Math.min(Math.max(numeric, min), max);
}

function defaultCompilerOptions(ts) {
  return {
    allowJs: true,
    checkJs: true,
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.NodeJs,
    jsx: ts.JsxEmit.ReactJSX,
    esModuleInterop: true,
    allowSyntheticDefaultImports: true,
    skipLibCheck: true,
    resolveJsonModule: true
  };
}

function defaultFormatOptions() {
  return {
    indentSize: 2,
    tabSize: 2,
    newLineCharacter: "\n",
    convertTabsToSpaces: true,
    semicolons: "insert",
    insertSpaceAfterCommaDelimiter: true,
    insertSpaceAfterSemicolonInForStatements: true,
    insertSpaceBeforeAndAfterBinaryOperators: true
  };
}

function defaultPreferences() {
  return {
    allowTextChangesInNewFiles: true,
    providePrefixAndSuffixTextForRename: true,
    includeCompletionsForImportStatements: true,
    includeCompletionsWithSnippetText: true
  };
}

function getProjectConfig(ts, workspaceRoot) {
  const configPath =
    ts.findConfigFile(workspaceRoot, ts.sys.fileExists, "tsconfig.json") ||
    ts.findConfigFile(workspaceRoot, ts.sys.fileExists, "jsconfig.json");

  if (!configPath) {
    return {
      root: workspaceRoot,
      configPath: null,
      compilerOptions: defaultCompilerOptions(ts),
      fileNames: walkSourceFiles(workspaceRoot, [])
    };
  }

  const config = ts.readConfigFile(configPath, ts.sys.readFile);
  if (config.error) {
    throw new Error(String(ts.flattenDiagnosticMessageText(config.error.messageText, "\n") || "Falha ao ler tsconfig/jsconfig."));
  }

  const parsed = ts.parseJsonConfigFileContent(
    config.config,
    ts.sys,
    path.dirname(configPath),
    defaultCompilerOptions(ts),
    configPath
  );

  return {
    root: path.dirname(configPath),
    configPath,
    compilerOptions: parsed.options || defaultCompilerOptions(ts),
    fileNames: (parsed.fileNames || []).map((entry) => path.normalize(entry)).filter((entry) => isSupportedLspFile(entry))
  };
}

function positionToLineChar(ts, sourceFile, pos) {
  const value = sourceFile.getLineAndCharacterOfPosition(Math.max(0, pos));
  return {
    line: value.line + 1,
    character: value.character + 1
  };
}

function lineCharToPosition(ts, sourceFile, line, character) {
  const safeLine = Math.max(1, Number(line || 1));
  const safeCharacter = Math.max(1, Number(character || 1));
  return sourceFile.getPositionOfLineAndCharacter(safeLine - 1, safeCharacter - 1);
}

function kindName(kind) {
  const raw = String(kind || "symbol").replace(/([A-Z])/g, " $1").trim().toLowerCase();
  return raw || "symbol";
}

function sortTextChangesDescending(changes = []) {
  return [...changes].sort((left, right) => {
    const leftStart = Number(left?.span?.start || 0);
    const rightStart = Number(right?.span?.start || 0);
    return rightStart - leftStart;
  });
}

async function applyFileTextChanges(fileName, textChanges) {
  let content = await fsp.readFile(fileName, "utf8");
  for (const change of sortTextChangesDescending(textChanges)) {
    const start = Number(change?.span?.start || 0);
    const length = Number(change?.span?.length || 0);
    const newText = String(change?.newText || "");
    content = `${content.slice(0, start)}${newText}${content.slice(start + length)}`;
  }
  await fsp.writeFile(fileName, content, "utf8");
}

class TypeScriptWorkspaceService {
  constructor(workspaceRoot) {
    this.workspaceRoot = path.normalize(workspaceRoot);
    this.ts = loadTypeScript();
    this.lastError = cachedTsError;
    this.fileVersions = new Map();
    this.openOverrides = new Map();
    this.fileSet = new Set();
    this.projectRoot = this.workspaceRoot;
    this.configPath = null;
    this.compilerOptions = {};

    if (!this.ts) {
      return;
    }

    this._loadProject();
    this.host = this._createHost();
    this.languageService = this.ts.createLanguageService(this.host, this.ts.createDocumentRegistry());
  }

  _loadProject() {
    const config = getProjectConfig(this.ts, this.workspaceRoot);
    this.projectRoot = config.root;
    this.configPath = config.configPath;
    this.compilerOptions = config.compilerOptions;
    this.fileSet = new Set(config.fileNames);
  }

  _createHost() {
    const ts = this.ts;
    return {
      getCompilationSettings: () => this.compilerOptions,
      getScriptFileNames: () => [...this.fileSet],
      getScriptVersion: (fileName) => String(this.fileVersions.get(path.normalize(fileName)) || 0),
      getScriptSnapshot: (fileName) => {
        const normalized = path.normalize(fileName);
        const override = this.openOverrides.get(normalized);
        if (override !== undefined) {
          return ts.ScriptSnapshot.fromString(override);
        }

        if (!fs.existsSync(normalized)) {
          return undefined;
        }

        return ts.ScriptSnapshot.fromString(fs.readFileSync(normalized, "utf8"));
      },
      getCurrentDirectory: () => this.projectRoot,
      getDefaultLibFileName: (options) => ts.getDefaultLibFilePath(options),
      fileExists: ts.sys.fileExists,
      readFile: ts.sys.readFile,
      readDirectory: ts.sys.readDirectory,
      readFileSync: ts.sys.readFile,
      getDirectories: ts.sys.getDirectories,
      directoryExists: ts.sys.directoryExists,
      realpath: ts.sys.realpath,
      useCaseSensitiveFileNames: () => ts.sys.useCaseSensitiveFileNames,
      getNewLine: () => ts.sys.newLine
    };
  }

  ensureReady() {
    if (!this.ts || !this.languageService) {
      throw new Error(this.lastError || "TypeScript nao esta disponivel neste runtime.");
    }
  }

  refreshProject(filePath = null) {
    this.ensureReady();
    this._loadProject();
    if (filePath && isSupportedLspFile(filePath)) {
      this.fileSet.add(path.normalize(filePath));
    }
  }

  touchFile(filePath, content = undefined) {
    const absolutePath = ensureAbsolute(filePath, this.workspaceRoot);
    if (!isSupportedLspFile(absolutePath)) {
      return;
    }
    this.ensureReady();
    this.fileSet.add(absolutePath);
    this.fileVersions.set(absolutePath, (this.fileVersions.get(absolutePath) || 0) + 1);
    if (content !== undefined) {
      this.openOverrides.set(absolutePath, String(content));
    } else {
      this.openOverrides.delete(absolutePath);
    }
  }

  syncFromDisk(filePath) {
    const absolutePath = ensureAbsolute(filePath, this.workspaceRoot);
    if (!isSupportedLspFile(absolutePath)) {
      return;
    }
    this.touchFile(absolutePath);
  }

  clearOverride(filePath) {
    const absolutePath = ensureAbsolute(filePath, this.workspaceRoot);
    this.openOverrides.delete(absolutePath);
  }

  getState() {
    return {
      available: Boolean(this.ts),
      engine: this.ts ? "typescript-language-service" : "none",
      projects: this.ts
        ? [
            {
              root: this.projectRoot,
              configPath: this.configPath,
              fileCount: this.fileSet.size,
              trackedFiles: this.fileVersions.size,
              supportedExtensions: [...SUPPORTED_EXTENSIONS]
            }
          ]
        : [],
      lastError: this.lastError
    };
  }

  _getSourceFile(filePath) {
    const absolutePath = ensureAbsolute(filePath, this.workspaceRoot);
    this.refreshProject(absolutePath);
    const program = this.languageService.getProgram();
    const sourceFile = program?.getSourceFile(absolutePath);
    if (!sourceFile) {
      throw new Error(`Arquivo nao suportado pelo motor de linguagem: ${absolutePath}`);
    }
    return { absolutePath, sourceFile };
  }

  _position(filePath, line, character) {
    const { absolutePath, sourceFile } = this._getSourceFile(filePath);
    return {
      absolutePath,
      sourceFile,
      position: lineCharToPosition(this.ts, sourceFile, line, character)
    };
  }

  documentSymbols(filePath) {
    const { absolutePath, sourceFile } = this._getSourceFile(filePath);
    const tree = this.languageService.getNavigationTree(absolutePath);
    const symbols = [];

    const visit = (node, container = null) => {
      const children = Array.isArray(node?.childItems) ? node.childItems : [];
      for (const child of children) {
        const span = Array.isArray(child.spans) ? child.spans[0] : null;
        const location = span ? positionToLineChar(this.ts, sourceFile, span.start) : { line: 1, character: 1 };
        symbols.push({
          name: child.text || "(anonimo)",
          kind: kindName(child.kind),
          file: absolutePath,
          line: location.line,
          character: location.character,
          container
        });
        visit(child, child.text || container);
      }
    };

    visit(tree);
    return symbols;
  }

  workspaceSymbols(query = "", options = {}) {
    this.ensureReady();
    this.refreshProject();
    const normalizedQuery = String(query || "").trim().toLowerCase();
    const maxResults = clampNumber(options.maxResults, 1, 300, 80);
    const results = [];

    for (const fileName of this.fileSet) {
      if (results.length >= maxResults) {
        break;
      }
      const symbols = this.documentSymbols(fileName);
      for (const symbol of symbols) {
        if (!normalizedQuery || String(symbol.name || "").toLowerCase().includes(normalizedQuery)) {
          results.push(symbol);
        }
        if (results.length >= maxResults) {
          break;
        }
      }
    }

    return results;
  }

  definition(filePath, line, character) {
    const { absolutePath, position } = this._position(filePath, line, character);
    const definitions = this.languageService.getDefinitionAtPosition(absolutePath, position) || [];
    return definitions.map((entry) => {
      const sourceFile = this.languageService.getProgram()?.getSourceFile(entry.fileName);
      const location = sourceFile
        ? positionToLineChar(this.ts, sourceFile, entry.textSpan.start)
        : { line: 1, character: 1 };
      return {
        file: path.normalize(entry.fileName),
        line: location.line,
        character: location.character,
        name: entry.name || path.basename(entry.fileName),
        kind: kindName(entry.kind)
      };
    });
  }

  references(filePath, line, character) {
    const { absolutePath, position } = this._position(filePath, line, character);
    const groups = this.languageService.findReferences(absolutePath, position) || [];
    const references = [];

    for (const group of groups) {
      for (const entry of group.references || []) {
        const sourceFile = this.languageService.getProgram()?.getSourceFile(entry.fileName);
        const location = sourceFile
          ? positionToLineChar(this.ts, sourceFile, entry.textSpan.start)
          : { line: 1, character: 1 };
        references.push({
          file: path.normalize(entry.fileName),
          line: location.line,
          character: location.character,
          isDefinition: Boolean(entry.isDefinition),
          text: group.definition?.displayParts ? displayPartsToString(group.definition.displayParts) : group.definition?.name || ""
        });
      }
    }

    return references;
  }

  hover(filePath, line, character) {
    const { absolutePath, position } = this._position(filePath, line, character);
    const info = this.languageService.getQuickInfoAtPosition(absolutePath, position);
    if (!info) {
      return null;
    }
    return {
      display: displayPartsToString(info.displayParts),
      documentation: displayPartsToString(info.documentation),
      kind: kindName(info.kind)
    };
  }

  codeActions(filePath, line, character, endLine = line, endCharacter = character) {
    const { absolutePath, sourceFile } = this._getSourceFile(filePath);
    const start = lineCharToPosition(this.ts, sourceFile, line, character);
    const end = lineCharToPosition(this.ts, sourceFile, endLine, endCharacter);
    const formatOptions = defaultFormatOptions();
    const preferences = defaultPreferences();
    const diagnostics = [
      ...this.languageService.getSyntacticDiagnostics(absolutePath),
      ...this.languageService.getSemanticDiagnostics(absolutePath),
      ...this.languageService.getSuggestionDiagnostics(absolutePath)
    ];

    const relevantCodes = [...new Set(
      diagnostics
        .filter((entry) => {
          const diagStart = Number(entry.start || 0);
          const diagEnd = diagStart + Number(entry.length || 0);
          return diagStart <= end && diagEnd >= start;
        })
        .map((entry) => Number(entry.code))
        .filter((entry) => Number.isFinite(entry))
    )];

    const fixes = this.languageService.getCodeFixesAtPosition(
      absolutePath,
      start,
      end,
      relevantCodes,
      formatOptions,
      preferences
    ) || [];

    const refactors = this.languageService.getApplicableRefactors(
      absolutePath,
      { pos: start, end },
      preferences,
      undefined
    ) || [];

    return {
      fixes: fixes.map((entry) => ({
        id: `fix:${entry.fixName}`,
        kind: "fix",
        title: entry.description,
        fixName: entry.fixName,
        changes: entry.changes?.length || 0
      })),
      refactors: refactors.flatMap((entry) =>
        (entry.actions || []).map((action) => ({
          id: `refactor:${entry.name}:${action.name}`,
          kind: "refactor",
          title: action.description,
          refactorName: entry.name,
          actionName: action.name,
          inlineable: Boolean(action.notApplicableReason) === false
        }))
      )
    };
  }

  async applyCodeAction(action, workspaceRoot = this.workspaceRoot) {
    const absolutePath = ensureAbsolute(action?.path, workspaceRoot);
    const { sourceFile } = this._getSourceFile(absolutePath);
    const start = lineCharToPosition(this.ts, sourceFile, action?.line, action?.character);
    const end = lineCharToPosition(
      this.ts,
      sourceFile,
      action?.endLine || action?.line,
      action?.endCharacter || action?.character
    );
    const formatOptions = defaultFormatOptions();
    const preferences = defaultPreferences();
    const actionId = String(action?.actionId || "").trim();
    const kind = actionId.startsWith("fix:")
      ? "fix"
      : actionId.startsWith("refactor:")
        ? "refactor"
        : String(action?.kind || "").trim().toLowerCase();

    if (kind === "fix") {
      const fixName = actionId.startsWith("fix:")
        ? actionId.slice(4)
        : String(action?.fixName || "").trim();
      if (!fixName) {
        throw new Error("lsp_apply_code_action exige actionId fix:* ou fixName.");
      }

      const diagnostics = [
        ...this.languageService.getSyntacticDiagnostics(absolutePath),
        ...this.languageService.getSemanticDiagnostics(absolutePath),
        ...this.languageService.getSuggestionDiagnostics(absolutePath)
      ];
      const codes = [...new Set(diagnostics.map((entry) => Number(entry.code)).filter((entry) => Number.isFinite(entry)))];
      const fixes = this.languageService.getCodeFixesAtPosition(
        absolutePath,
        start,
        end,
        codes,
        formatOptions,
        preferences
      ) || [];
      const fix = fixes.find((entry) => entry.fixName === fixName);
      if (!fix) {
        throw new Error(`Code action nao encontrada: ${fixName}`);
      }

      for (const change of fix.changes || []) {
        await applyFileTextChanges(change.fileName, change.textChanges || []);
        this.syncFromDisk(change.fileName);
      }

      return `Code action aplicada: ${fix.description}`;
    }

    if (kind === "refactor") {
      const raw = actionId.startsWith("refactor:")
        ? actionId.slice("refactor:".length)
        : `${String(action?.refactorName || "").trim()}:${String(action?.actionName || "").trim()}`;
      const separator = raw.indexOf(":");
      const refactorName = separator >= 0 ? raw.slice(0, separator) : raw;
      const actionName = separator >= 0 ? raw.slice(separator + 1) : "";
      if (!refactorName || !actionName) {
        throw new Error("lsp_apply_code_action exige refactorName e actionName.");
      }

      const edits = this.languageService.getEditsForRefactor(
        absolutePath,
        formatOptions,
        { pos: start, end },
        refactorName,
        actionName,
        preferences
      );
      if (!edits?.edits?.length) {
        throw new Error(`Nenhuma edicao retornada para o refactor ${refactorName}/${actionName}.`);
      }

      for (const change of edits.edits) {
        await applyFileTextChanges(change.fileName, change.textChanges || []);
        this.syncFromDisk(change.fileName);
      }

      return `Refactor aplicado: ${edits.renameFilename || refactorName}/${actionName}`;
    }

    throw new Error("lsp_apply_code_action exige kind fix/refactor.");
  }

  async rename(action, workspaceRoot = this.workspaceRoot) {
    const absolutePath = ensureAbsolute(action?.path, workspaceRoot);
    const { sourceFile } = this._getSourceFile(absolutePath);
    const position = lineCharToPosition(this.ts, sourceFile, action?.line, action?.character);
    const renameInfo = this.languageService.getRenameInfo(absolutePath, position, {
      allowRenameOfImportPath: true
    });
    if (!renameInfo?.canRename) {
      throw new Error(renameInfo?.localizedErrorMessage || "O simbolo nao pode ser renomeado aqui.");
    }

    const newName = String(action?.newName || "").trim();
    if (!newName) {
      throw new Error("lsp_rename exige newName.");
    }

    const locations = this.languageService.findRenameLocations(
      absolutePath,
      position,
      false,
      false,
      true
    ) || [];

    const grouped = new Map();
    for (const location of locations) {
      const fileName = path.normalize(location.fileName);
      if (!grouped.has(fileName)) {
        grouped.set(fileName, []);
      }
      grouped.get(fileName).push({
        span: location.textSpan,
        newText: newName
      });
    }

    let changedFiles = 0;
    for (const [fileName, textChanges] of grouped.entries()) {
      await applyFileTextChanges(fileName, textChanges);
      this.syncFromDisk(fileName);
      changedFiles += 1;
    }

    return {
      changedFiles,
      changedLocations: locations.length,
      displayName: renameInfo.displayName || renameInfo.fullDisplayName || ""
    };
  }
}

function getProjectService(workspaceRoot = process.cwd()) {
  const absoluteRoot = path.normalize(path.resolve(workspaceRoot));
  let project = PROJECTS.get(absoluteRoot);
  if (!project) {
    project = new TypeScriptWorkspaceService(absoluteRoot);
    PROJECTS.set(absoluteRoot, project);
  }
  return project;
}

function getLspState(workspaceRoot = process.cwd()) {
  const project = getProjectService(workspaceRoot);
  const internalState = project.getState();
  return {
    ...internalState,
    externalServers: getServerAvailabilitySync(),
    activeClients: getActiveClientSnapshots()
  };
}

function notifyFileChanged(filePath, workspaceRoot = process.cwd(), content = undefined) {
  const absolutePath = ensureAbsolute(filePath, workspaceRoot);
  if (!isSupportedLspFile(absolutePath)) {
    return;
  }
  getProjectService(workspaceRoot).touchFile(absolutePath, content);
}

async function fileSymbolsLsp(filePath, workspaceRoot = process.cwd()) {
  const absolutePath = ensureAbsolute(filePath, workspaceRoot);
  if (isSupportedLspFile(absolutePath)) {
    return getProjectService(workspaceRoot).documentSymbols(absolutePath);
  }

  const client = await getClientForFile(absolutePath, workspaceRoot);
  if (!client) {
    throw new Error(`Nenhum servidor LSP externo disponivel para ${path.extname(absolutePath) || absolutePath}.`);
  }

  const result = await client.documentSymbols(absolutePath);
  return normalizeSymbolResults(Array.isArray(result) ? result : [], workspaceRoot);
}

async function workspaceSymbolsLsp(query, workspaceRoot = process.cwd(), options = {}) {
  const state = getLspState(workspaceRoot);
  const maxResults = clampNumber(options.maxResults, 1, 300, 80);
  const items = [];

  if (state.available) {
    items.push(...getProjectService(workspaceRoot).workspaceSymbols(query, options));
  }

  for (const server of state.externalServers || []) {
    if (!server.available) {
      continue;
    }
    const syntheticPath = path.join(workspaceRoot, `placeholder${server.extensions[0] || ""}`);
    const client = await getClientForFile(syntheticPath, workspaceRoot);
    if (!client) {
      continue;
    }
    try {
      const result = await client.workspaceSymbols(query);
      items.push(...normalizeSymbolResults(result, workspaceRoot));
    } catch {}
    if (items.length >= maxResults) {
      break;
    }
  }

  return items.slice(0, maxResults);
}

async function lspDefinition(action, workspaceRoot = process.cwd()) {
  const absolutePath = ensureAbsolute(action?.path, workspaceRoot);
  if (isSupportedLspFile(absolutePath)) {
    return getProjectService(workspaceRoot).definition(absolutePath, action?.line, action?.character);
  }

  const client = await getClientForFile(absolutePath, workspaceRoot);
  if (!client) {
    return [];
  }
  return normalizeLocationResults(await client.definition(absolutePath, action?.line, action?.character), workspaceRoot);
}

async function lspReferences(action, workspaceRoot = process.cwd()) {
  const absolutePath = ensureAbsolute(action?.path, workspaceRoot);
  if (isSupportedLspFile(absolutePath)) {
    return getProjectService(workspaceRoot).references(absolutePath, action?.line, action?.character);
  }

  const client = await getClientForFile(absolutePath, workspaceRoot);
  if (!client) {
    return [];
  }
  return normalizeLocationResults(await client.references(absolutePath, action?.line, action?.character), workspaceRoot);
}

async function lspHover(action, workspaceRoot = process.cwd()) {
  const absolutePath = ensureAbsolute(action?.path, workspaceRoot);
  if (isSupportedLspFile(absolutePath)) {
    return getProjectService(workspaceRoot).hover(absolutePath, action?.line, action?.character);
  }

  const client = await getClientForFile(absolutePath, workspaceRoot);
  if (!client) {
    return null;
  }
  return normalizeHoverResult(await client.hover(absolutePath, action?.line, action?.character));
}

async function lspCodeActions(action, workspaceRoot = process.cwd()) {
  const absolutePath = ensureAbsolute(action?.path, workspaceRoot);
  if (isSupportedLspFile(absolutePath)) {
    return getProjectService(workspaceRoot).codeActions(
      absolutePath,
      action?.line,
      action?.character,
      action?.endLine,
      action?.endCharacter
    );
  }

  const client = await getClientForFile(absolutePath, workspaceRoot);
  if (!client) {
    return { fixes: [], refactors: [] };
  }

  const result = await client.codeActions(
    absolutePath,
    action?.line,
    action?.character,
    action?.endLine,
    action?.endCharacter
  );

  const fixes = [];
  const refactors = [];
  for (const entry of Array.isArray(result) ? result : []) {
    const token = encodeActionToken({
      path: absolutePath,
      action: entry
    });
    const normalized = {
      id: `external:${token}`,
      kind: /refactor/i.test(String(entry.kind || "")) ? "refactor" : "fix",
      title: String(entry.title || entry.command?.title || "External code action"),
      provider: "external-lsp"
    };
    if (normalized.kind === "refactor") {
      refactors.push(normalized);
    } else {
      fixes.push(normalized);
    }
  }

  return { fixes, refactors };
}

async function lspApplyCodeAction(action, workspaceRoot = process.cwd()) {
  const absolutePath = ensureAbsolute(action?.path, workspaceRoot);
  if (isSupportedLspFile(absolutePath)) {
    return await getProjectService(workspaceRoot).applyCodeAction(action, workspaceRoot);
  }

  const actionId = String(action?.actionId || "");
  if (!actionId.startsWith("external:")) {
    throw new Error("Code action externa invalida.");
  }

  const payload = decodeActionToken(actionId.slice("external:".length));
  const targetPath = ensureAbsolute(payload?.path || absolutePath, workspaceRoot);
  const client = await getClientForFile(targetPath, workspaceRoot);
  if (!client) {
    throw new Error("Nenhum servidor LSP externo disponivel para aplicar esta code action.");
  }

  const codeAction = payload?.action || {};
  let changedFiles = [];

  if (codeAction.edit) {
    changedFiles = await applyWorkspaceEdit(codeAction.edit);
  }

  if (codeAction.command?.command) {
    await client.executeCommand(codeAction.command.command, codeAction.command.arguments || []);
  }

  for (const filePath of changedFiles) {
    notifyFileChanged(filePath, workspaceRoot);
  }

  return `Code action externa aplicada: ${codeAction.title || "acao sem titulo"}${changedFiles.length ? `. Arquivos alterados: ${changedFiles.length}` : ""}.`;
}

async function lspRename(action, workspaceRoot = process.cwd()) {
  const absolutePath = ensureAbsolute(action?.path, workspaceRoot);
  if (isSupportedLspFile(absolutePath)) {
    return await getProjectService(workspaceRoot).rename(action, workspaceRoot);
  }

  const client = await getClientForFile(absolutePath, workspaceRoot);
  if (!client) {
    throw new Error("Nenhum servidor LSP externo disponivel para rename neste arquivo.");
  }

  const workspaceEdit = await client.rename(
    absolutePath,
    action?.line,
    action?.character,
    action?.newName
  );
  const changedFiles = await applyWorkspaceEdit(workspaceEdit);
  for (const filePath of changedFiles) {
    notifyFileChanged(filePath, workspaceRoot);
  }
  return {
    changedFiles: changedFiles.length,
    changedLocations: changedFiles.length,
    displayName: path.basename(absolutePath)
  };
}

module.exports = {
  getLspState,
  isSupportedLspFile,
  fileSymbolsLsp,
  workspaceSymbolsLsp,
  lspDefinition,
  lspReferences,
  lspHover,
  lspCodeActions,
  lspApplyCodeAction,
  lspRename,
  notifyFileChanged
};
