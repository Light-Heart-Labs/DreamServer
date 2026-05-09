const { spawn } = require("child_process");
const fs = require("fs/promises");
const { existsSync } = require("fs");
const net = require("net");
const os = require("os");
const path = require("path");
const crypto = require("crypto");
const { fileURLToPath, pathToFileURL } = require("url");
const { normalizeLocalEvent } = require("./state");
const {
  ensureGitWorkspace,
  gitCreateBranch,
  gitStatus,
  gitWorktreeAdd,
  gitWorktreeList,
  gitWorktreeRemove
} = require("./git");
const {
  fileSymbolsLsp,
  getLspState,
  isSupportedLspFile,
  lspApplyCodeAction,
  lspCodeActions,
  lspDefinition,
  lspHover,
  lspReferences,
  lspRename,
  notifyFileChanged,
  workspaceSymbolsLsp
} = require("./lsp");
const { fileSymbols, workspaceSymbols } = require("./symbols");
const { findBrowserExecutable, formatVerification, verifyBrowser, verifyFiles, verifySite, verifyUrl } = require("./verifier");
const { createToolRegistry, normalizeToolResult } = require("./tool-registry");
const {
  commandBaseName,
  nativeWindowsPosixProblem,
  shouldExposeWslPaths
} = require("./platform");

let nodePty = null;
try {
  nodePty = require("node-pty");
} catch {
  nodePty = null;
}
if (/^(1|true|yes)$/i.test(String(process.env.DREAM_DISABLE_PTY || ""))) {
  nodePty = null;
}

const PATH_ALIASES = new Map([
  ["desktop", path.join(os.homedir(), "Desktop")],
  ["documents", path.join(os.homedir(), "Documents")],
  ["downloads", path.join(os.homedir(), "Downloads")],
  ["music", path.join(os.homedir(), "Music")],
  ["pictures", path.join(os.homedir(), "Pictures")],
  ["videos", path.join(os.homedir(), "Videos")],
  ["home", os.homedir()],
  ["temp", os.tmpdir()]
]);

const PATH_GLYPH_REPLACEMENTS = Object.freeze({
  "\uF03A": ":",
  "\uFF1A": ":",
  "\uFE55": ":",
  "\uA789": ":",
  "\u2236": ":",
  "\uF05C": "\\",
  "\uFF3C": "\\",
  "\u2216": "\\",
  "\u29F5": "\\",
  "\u2044": "/",
  "\u2215": "/",
  "\uFF0F": "/"
});

function normalizePathText(value = "") {
  const normalized = String(value || "")
    .trim()
    .replace(/[\uF03A\uFF1A\uFE55\uA789\u2236\uF05C\uFF3C\u2216\u29F5\u2044\u2215\uFF0F]/g, (char) => PATH_GLYPH_REPLACEMENTS[char] || char)
    .replace(/^([a-zA-Z])\s*:\s*[\\/]+/, (_, drive) => `${drive}:\\`);
  if (process.platform !== "win32") {
    return normalized;
  }
  const wslDrive = normalized.match(/^[/\\]mnt[/\\]([a-zA-Z])(?=$|[/\\])([\s\S]*)$/i);
  const msysDrive = normalized.match(/^[/\\]([a-zA-Z])(?=$|[/\\])([\s\S]*)$/);
  const match = wslDrive || msysDrive;
  if (!match) {
    return normalized;
  }
  const rest = String(match[2] || "").replace(/^[/\\]+/, "").replace(/[\\/]+/g, "\\");
  return `${match[1].toUpperCase()}:\\${rest}`;
}

const SUPPORTED_APPS = {
  explorer: { command: "explorer.exe", label: "Explorer" },
  notepad: { command: "notepad.exe", label: "Notepad" },
  calculator: { command: "calc.exe", label: "Calculator" },
  powershell: { command: "powershell.exe", label: "PowerShell" },
  cmd: { command: "cmd.exe", label: "Command Prompt" },
  vscode: { command: "code", label: "VS Code" },
  discord: { command: "discord", label: "Discord" },
  chrome: { command: "chrome", label: "Google Chrome" },
  brave: { command: "brave.exe", label: "Brave Browser" },
  edge: { command: "msedge", label: "Microsoft Edge" },
  whatsapp: { command: "whatsapp", label: "WhatsApp" },
  spotify: { command: "spotify", label: "Spotify" }
};

const SUPPORTED_APP_ALIASES = {
  explorer: "explorer",
  fileexplorer: "explorer",
  windowsexplorer: "explorer",
  explorerdearquivos: "explorer",
  notepad: "notepad",
  bloconotas: "notepad",
  blocodenotas: "notepad",
  calc: "calculator",
  calcexe: "calculator",
  calculator: "calculator",
  calculadora: "calculator",
  powershell: "powershell",
  pwshell: "powershell",
  commandprompt: "cmd",
  promptdecomando: "cmd",
  cmd: "cmd",
  cmdexe: "cmd",
  vscode: "vscode",
  code: "vscode",
  visualstudiocode: "vscode",
  chrome: "chrome",
  googlechrome: "chrome",
  brave: "brave",
  bravebrowser: "brave",
  bravenavigator: "brave",
  navigatorbrave: "brave",
  navegadorbrave: "brave",
  edge: "edge",
  microsoftedge: "edge",
  msedge: "edge",
  discord: "discord",
  whatsapp: "whatsapp",
  spotify: "spotify"
};

const LIMITED_TOOL_NAMES = new Set([
  "launch_app",
  "open_url",
  "open_path",
  "reveal_path",
  "set_preview_device",
  "browser_session_state",
  "browser_harness",
  "task_create",
  "task_list",
  "task_get",
  "task_update",
  "task_stop",
  "task_delete",
  "task_logs"
]);
const TERMINAL_SESSIONS = new Map();
const BACKGROUND_PROCESSES = new Map();
const EDIT_HISTORY = new Map();
const MAX_BACKGROUND_PROCESSES = 12;
const MAX_TERMINAL_SESSIONS = 8;
const MAX_EDIT_HISTORY = 120;
const TERMINAL_SHELL_NAMES = ["powershell", "pwsh", "cmd", "bash", "zsh", "sh"];

const TOOL_MANIFESTS = [
  {
    name: "launch_app",
    description: "Open an application, executable or Windows shortcut.",
    permissionClass: "desktop-control",
    supportedSurfaces: ["desktop", "cli", "headless"],
    inputSchema: {
      type: "object",
      properties: {
        app: { type: "string", description: "Common app name, executable name or Start menu entry." },
        path: { type: "string", description: "Full path to an executable or shortcut." },
        args: { type: "array", items: { type: "string" } }
      }
    }
  },
  {
    name: "open_url",
    description: "Open a URL or registered custom protocol on the local machine.",
    permissionClass: "desktop-control",
    supportedSurfaces: ["desktop", "cli", "headless"],
    inputSchema: {
      type: "object",
      properties: {
        url: { type: "string" }
      },
      required: ["url"]
    }
  },
  {
    name: "open_path",
    description: "Open a local file or folder in the default desktop app.",
    permissionClass: "desktop-control",
    supportedSurfaces: ["desktop", "cli", "headless"],
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string" }
      },
      required: ["path"]
    }
  },
  {
    name: "set_preview_device",
    description: "Switch the Workbench preview surface between desktop and mobile/iPhone mode.",
    permissionClass: "desktop-control",
    supportedSurfaces: ["desktop", "cli", "headless"],
    inputSchema: {
      type: "object",
      properties: {
        mode: { type: "string", enum: ["desktop", "mobile"] }
      },
      required: ["mode"]
    }
  },
  {
    name: "browser_session_state",
    description: "Read the current live browser session state from the Workbench preview without navigating.",
    permissionClass: "desktop-control",
    supportedSurfaces: ["desktop", "cli", "headless"],
    inputSchema: {
      type: "object",
      properties: {
        timeoutMs: { type: "number" }
      }
    }
  },
  {
    name: "browser_harness",
    description: "Internal browser-harness-compatible engine for the live Workbench preview. Used by Hermes/Dream to navigate, snapshot, click, type, scroll, evaluate JS and keep preview state coherent.",
    permissionClass: "desktop-control",
    supportedSurfaces: ["desktop", "cli", "headless"],
    inputSchema: {
      type: "object",
      properties: {
        command: {
          type: "string",
          enum: ["goto", "page_info", "snapshot", "click", "type_text", "press_key", "scroll", "screenshot", "js", "back", "session_state", "sequence", "chess_state", "board_state", "chess_wait_turn", "wait_chess_turn", "chess_move", "click_square"]
        },
        url: { type: "string" },
        ref: { type: "string" },
        selector: { type: "string" },
        label: { type: "string" },
        accessibleName: { type: "string" },
        name: { type: "string" },
        ariaLabel: { type: "string" },
        title: { type: "string" },
        fromSquare: { type: "string" },
        toSquare: { type: "string" },
        from_square: { type: "string" },
        to_square: { type: "string" },
        promotion: { type: "string" },
        square: { type: "string" },
        x: { type: "number" },
        y: { type: "number" },
        button: { type: "string" },
        clicks: { type: "integer" },
        text: { type: "string" },
        key: { type: "string" },
        modifiers: { type: "integer" },
        deltaX: { type: "number" },
        deltaY: { type: "number" },
        pixels: { type: "integer" },
        full: { type: "boolean" },
        expression: { type: "string" },
        screenshot: { type: "boolean" },
        deviceMode: { type: "string" },
        timeoutMs: { type: "integer" },
        steps: { type: "array", items: { type: "object" } }
      }
    }
  },
  {
    name: "gateway_control",
    description: "Control Dream Server's real Hermes Gateway through the Electron runtime.",
    permissionClass: "system-write",
    supportedSurfaces: ["desktop"],
    inputSchema: {
      type: "object",
      properties: {
        command: {
          type: "string",
          enum: [
            "start",
            "stop",
            "restart",
            "status",
            "configure",
            "configure_secret",
            "set_secret",
            "capabilities",
            "identity",
            "groups",
            "guilds",
            "channels",
            "chats",
            "recent_messages",
            "pairing_status",
            "approve_pairing",
            "revoke_pairing",
            "clear_pairing",
            "chat",
            "send",
            "edit",
            "send_media",
            "typing"
          ]
        },
        platform: {
          type: "string",
          enum: [
            "whatsapp",
            "discord",
            "telegram",
            "slack",
            "matrix",
            "mattermost",
            "signal",
            "homeassistant",
            "email",
            "sms",
            "api_server",
            "webhook",
            "dingtalk",
            "feishu",
            "wecom",
            "weixin",
            "bluebubbles",
            "qqbot",
            "yuanbao"
          ]
        },
        timeoutMs: { type: "integer" },
        token: { type: "string" },
        botToken: { type: "string" },
        secretField: { type: "string" },
        secretValue: { type: "string" },
        secrets: { type: "object" },
        chatId: { type: "string" },
        target: { type: "string" },
        threadId: { type: "string" },
        guildId: { type: "string" },
        message: { type: "string" },
        messageId: { type: "string" },
        filePath: { type: "string" },
        mediaType: { type: "string" },
        caption: { type: "string" },
        fileName: { type: "string" },
        replyTo: { type: "string" },
        code: { type: "string" },
        pairingCode: { type: "string" },
        approvalCode: { type: "string" },
        userId: { type: "string" },
        limit: { type: "integer" }
      },
      required: ["command"]
    }
  },
  {
    name: "reveal_path",
    description: "Reveal a local file or folder inside Windows Explorer.",
    permissionClass: "desktop-control",
    supportedSurfaces: ["desktop", "cli", "headless"],
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string" }
      },
      required: ["path"]
    }
  },
  {
    name: "create_directory",
    description: "Create a directory on disk.",
    permissionClass: "workspace-write",
    supportedSurfaces: ["desktop", "cli", "headless"],
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string" }
      },
      required: ["path"]
    }
  },
  {
    name: "write_file",
    description: "Write UTF-8 text content to a file, replacing any existing content.",
    permissionClass: "workspace-write",
    supportedSurfaces: ["desktop", "cli", "headless"],
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string" },
        content: { type: "string" }
      },
      required: ["path", "content"]
    }
  },
  {
    name: "append_file",
    description: "Append UTF-8 text content to an existing file or create it if missing.",
    permissionClass: "workspace-write",
    supportedSurfaces: ["desktop", "cli", "headless"],
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string" },
        content: { type: "string" }
      },
      required: ["path", "content"]
    }
  },
  {
    name: "file_edit",
    description: "Apply structured patch-like edits to an existing text file using anchored replacements or insertions.",
    permissionClass: "workspace-write",
    supportedSurfaces: ["desktop", "cli", "headless"],
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string" },
        edits: {
          type: "array",
          items: {
            type: "object",
            properties: {
              type: { type: "string", enum: ["replace", "insert_before", "insert_after", "append", "prepend"] },
              oldText: { type: "string" },
              newText: { type: "string" },
              anchor: { type: "string" },
              text: { type: "string" },
              replaceAll: { type: "boolean" }
            }
          }
        }
      },
      required: ["path", "edits"]
    }
  },
  {
    name: "apply_patch",
    description: "Apply one or more unified-diff hunks transactionally. The patch must match current file content; failed validation rolls back before reporting.",
    permissionClass: "workspace-write",
    supportedSurfaces: ["desktop", "cli", "headless"],
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Optional target path for single-file patches without ---/+++ headers." },
        patch: { type: "string", description: "Unified diff text with @@ hunks." }
      },
      required: ["patch"]
    }
  },
  {
    name: "file_rollback",
    description: "Rollback a previous write_file/file_edit/append_file change by changeId or by the latest change for a path.",
    permissionClass: "workspace-write",
    supportedSurfaces: ["desktop", "cli", "headless"],
    inputSchema: {
      type: "object",
      properties: {
        changeId: { type: "string" },
        path: { type: "string" }
      }
    }
  },
  {
    name: "read_file",
    description: "Read a UTF-8 text file.",
    permissionClass: "safe/read-only",
    supportedSurfaces: ["desktop", "cli", "headless"],
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string" },
        maxChars: { type: "integer" }
      },
      required: ["path"]
    }
  },
  {
    name: "list_directory",
    description: "List directory contents recursively.",
    permissionClass: "safe/read-only",
    supportedSurfaces: ["desktop", "cli", "headless"],
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string" },
        depth: { type: "integer" }
      },
      required: ["path"]
    }
  },
  {
    name: "glob_files",
    description: "Find files using a glob-like pattern relative to the workspace or a base path.",
    permissionClass: "safe/read-only",
    supportedSurfaces: ["desktop", "cli", "headless"],
    inputSchema: {
      type: "object",
      properties: {
        pattern: { type: "string" },
        basePath: { type: "string" },
        maxResults: { type: "integer" }
      },
      required: ["pattern"]
    }
  },
  {
    name: "grep_files",
    description: "Search text within files recursively.",
    permissionClass: "safe/read-only",
    supportedSurfaces: ["desktop", "cli", "headless"],
    inputSchema: {
      type: "object",
      properties: {
        pattern: { type: "string" },
        path: { type: "string" },
        glob: { type: "string" },
        maxMatches: { type: "integer" }
      },
      required: ["pattern"]
    }
  },
  {
    name: "file_symbols",
    description: "List top-level symbols from a single code file.",
    permissionClass: "safe/read-only",
    supportedSurfaces: ["desktop", "cli", "headless"],
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string" }
      },
      required: ["path"]
    }
  },
  {
    name: "workspace_symbols",
    description: "Search symbols across the workspace without requiring a full IDE.",
    permissionClass: "safe/read-only",
    supportedSurfaces: ["desktop", "cli", "headless"],
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string" },
        maxResults: { type: "integer" }
      }
    }
  },
  {
    name: "lsp_document_symbols",
    description: "Use the TypeScript language service to inspect document symbols in a JS/TS file.",
    permissionClass: "safe/read-only",
    supportedSurfaces: ["desktop", "cli", "headless"],
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string" }
      },
      required: ["path"]
    }
  },
  {
    name: "lsp_workspace_symbols",
    description: "Search workspace symbols using the TypeScript language service.",
    permissionClass: "safe/read-only",
    supportedSurfaces: ["desktop", "cli", "headless"],
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string" },
        maxResults: { type: "integer" }
      }
    }
  },
  {
    name: "lsp_definition",
    description: "Jump to symbol definitions using the language service.",
    permissionClass: "safe/read-only",
    supportedSurfaces: ["desktop", "cli", "headless"],
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string" },
        line: { type: "integer" },
        character: { type: "integer" }
      },
      required: ["path", "line", "character"]
    }
  },
  {
    name: "lsp_references",
    description: "Find symbol references using the language service.",
    permissionClass: "safe/read-only",
    supportedSurfaces: ["desktop", "cli", "headless"],
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string" },
        line: { type: "integer" },
        character: { type: "integer" }
      },
      required: ["path", "line", "character"]
    }
  },
  {
    name: "lsp_hover",
    description: "Read hover/type information from the language service.",
    permissionClass: "safe/read-only",
    supportedSurfaces: ["desktop", "cli", "headless"],
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string" },
        line: { type: "integer" },
        character: { type: "integer" }
      },
      required: ["path", "line", "character"]
    }
  },
  {
    name: "lsp_code_actions",
    description: "List available code fixes and refactors for a JS/TS location.",
    permissionClass: "safe/read-only",
    supportedSurfaces: ["desktop", "cli", "headless"],
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string" },
        line: { type: "integer" },
        character: { type: "integer" },
        endLine: { type: "integer" },
        endCharacter: { type: "integer" }
      },
      required: ["path", "line", "character"]
    }
  },
  {
    name: "lsp_apply_code_action",
    description: "Apply a concrete code action or refactor returned by lsp_code_actions.",
    permissionClass: "workspace-write",
    supportedSurfaces: ["desktop", "cli", "headless"],
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string" },
        line: { type: "integer" },
        character: { type: "integer" },
        endLine: { type: "integer" },
        endCharacter: { type: "integer" },
        actionId: { type: "string" },
        kind: { type: "string", enum: ["fix", "refactor"] },
        fixName: { type: "string" },
        refactorName: { type: "string" },
        actionName: { type: "string" }
      },
      required: ["path", "line", "character"]
    }
  },
  {
    name: "lsp_rename",
    description: "Rename a symbol across JS/TS files using the language service.",
    permissionClass: "workspace-write",
    supportedSurfaces: ["desktop", "cli", "headless"],
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string" },
        line: { type: "integer" },
        character: { type: "integer" },
        newName: { type: "string" }
      },
      required: ["path", "line", "character", "newName"]
    }
  },
  {
    name: "run_command",
    description: "Run a local process, PowerShell script or CMD command.",
    permissionClass: "system-write",
    supportedSurfaces: ["desktop", "cli", "headless"],
    inputSchema: {
      type: "object",
      properties: {
        runner: { type: "string", enum: ["process", "powershell", "cmd"] },
        command: { type: "string" },
        args: { type: "array", items: { type: "string" } },
        cwd: { type: "string" },
        shell: { type: "boolean" },
        wait: { type: "boolean" },
        allowNonZero: { type: "boolean" },
        expectedExitCode: { type: "integer" },
        allowedExitCodes: { type: "array", items: { type: "integer" } },
        timeoutMs: { type: "integer" }
      },
      required: ["command"]
    }
  },
  {
    name: "todo_write",
    description: "Create or update persistent todo items for the current workspace session.",
    permissionClass: "workspace-write",
    supportedSurfaces: ["desktop", "cli", "headless"],
    inputSchema: {
      type: "object",
      properties: {
        mode: { type: "string", enum: ["append", "replace", "update"] },
        todos: {
          type: "array",
          items: {
            type: "object",
            properties: {
              id: { type: "string" },
              text: { type: "string" },
              status: { type: "string", enum: ["pending", "in_progress", "done", "blocked"] },
              priority: { type: "string", enum: ["low", "medium", "high"] }
            }
          }
        }
      },
      required: ["todos"]
    }
  },
  {
    name: "todo_read",
    description: "Read the persistent todo list.",
    permissionClass: "safe/read-only",
    supportedSurfaces: ["desktop", "cli", "headless"],
    inputSchema: {
      type: "object",
      properties: {
        status: { type: "string" }
      }
    }
  },
  {
    name: "task_create",
    description: "Create a persistent task record for a larger goal.",
    permissionClass: "workspace-write",
    supportedSurfaces: ["desktop", "cli", "headless"],
    inputSchema: {
      type: "object",
      properties: {
        title: { type: "string" },
        objective: { type: "string" },
        routeId: { type: "string" },
        status: {
          type: "string",
          enum: ["backlog", "queue", "in_progress", "ai_review", "human_review", "done", "archived", "pending", "running", "blocked", "stopped"]
        },
        workspaceRoot: { type: "string" }
      },
      required: ["title", "objective"]
    }
  },
  {
    name: "task_list",
    description: "List persistent tasks.",
    permissionClass: "safe/read-only",
    supportedSurfaces: ["desktop", "cli", "headless"],
    inputSchema: {
      type: "object",
      properties: {
        status: { type: "string" }
      }
    }
  },
  {
    name: "task_get",
    description: "Get one persistent task.",
    permissionClass: "safe/read-only",
    supportedSurfaces: ["desktop", "cli", "headless"],
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string" }
      },
      required: ["id"]
    }
  },
  {
    name: "task_update",
    description: "Update status or result of a persistent task.",
    permissionClass: "workspace-write",
    supportedSurfaces: ["desktop", "cli", "headless"],
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string" },
        title: { type: "string" },
        objective: { type: "string" },
        status: {
          type: "string",
          enum: ["backlog", "queue", "in_progress", "ai_review", "human_review", "creating_pr", "done", "pr_created", "archived", "error", "pending", "running", "blocked", "stopped"]
        },
        result: { type: "string" },
        event: { type: "string" },
        message: { type: "string" },
        reviewReason: { type: "string" },
        assignee: { type: "string" },
        tenant: { type: "string" },
        priority: { type: "integer" },
        maxRuntimeSeconds: { type: "integer" },
        skills: { type: "array", items: { type: "string" } },
        comment: { type: "string" },
        author: { type: "string" },
        linkParentId: { type: "string" },
        linkChildId: { type: "string" },
        prUrl: { type: "string" },
        prState: { type: "string" }
      },
      required: ["id"]
    }
  },
  {
    name: "task_delete",
    description: "Delete an archived or inactive persistent task record from the Kanban.",
    permissionClass: "workspace-write",
    supportedSurfaces: ["desktop", "cli", "headless"],
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string" },
        force: { type: "boolean" }
      },
      required: ["id"]
    }
  },
  {
    name: "task_stop",
    description: "Stop or close a persistent task.",
    permissionClass: "workspace-write",
    supportedSurfaces: ["desktop", "cli", "headless"],
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string" }
      },
      required: ["id"]
    }
  },
  {
    name: "task_recover",
    description: "Recover a stuck Hermes Kanban task and optionally restart its Hermes agent.",
    permissionClass: "system-write",
    supportedSurfaces: ["desktop", "cli", "headless"],
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string" },
        autoRestart: { type: "boolean" },
        force: { type: "boolean" },
        provider: { type: "string", enum: ["local", "cloud"] }
      },
      required: ["id"]
    }
  },
  {
    name: "task_cleanup_worktree",
    description: "Remove the git worktree linked to a task and mark cleanup state.",
    permissionClass: "system-write",
    supportedSurfaces: ["desktop", "cli", "headless"],
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string" },
        force: { type: "boolean" }
      },
      required: ["id"]
    }
  },
  {
    name: "task_create_pr",
    description: "Create a PR for a task through GitHub CLI when available, or record a provided PR URL.",
    permissionClass: "system-write",
    supportedSurfaces: ["desktop", "cli", "headless"],
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string" },
        title: { type: "string" },
        body: { type: "string" },
        draft: { type: "boolean" },
        prUrl: { type: "string" },
        command: { type: "string" },
        timeoutMs: { type: "integer" }
      },
      required: ["id"]
    }
  },
  {
    name: "task_scheduler_tick",
    description: "Run one Hermes Kanban scheduler tick: recover stale tasks, start queued work, PR and cleanup when enabled.",
    permissionClass: "system-write",
    supportedSurfaces: ["desktop", "cli", "headless"],
    inputSchema: {
      type: "object",
      properties: {
        force: { type: "boolean" }
      }
    }
  },
  {
    name: "task_logs",
    description: "Read phase logs for a persistent task.",
    permissionClass: "safe/read-only",
    supportedSurfaces: ["desktop", "cli", "headless"],
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string" },
        phase: { type: "string", enum: ["planning", "coding", "validation"] }
      },
      required: ["id"]
    }
  },
  {
    name: "project_prepare_vite",
    description:
      "Prepare the technical shell for a local Vite app: create a project folder, ensure minimal Vite files exist, optionally install dependencies, start a dev server, and return projectRoot/url. This does not generate the user's themed/content code.",
    permissionClass: "system-write",
    supportedSurfaces: ["desktop", "cli", "headless"],
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string" },
        path: { type: "string" },
        port: { type: "integer" },
        install: { type: "boolean" },
        start: { type: "boolean" },
        overwriteBootstrap: { type: "boolean" }
      },
      required: ["name"]
    }
  },
  {
    name: "terminal_open",
    description: "Open or reuse a persistent terminal session that can run multiple commands in sequence.",
    permissionClass: "system-write",
    supportedSurfaces: ["desktop", "cli", "headless"],
    inputSchema: {
      type: "object",
      properties: {
        session: { type: "string" },
        shell: { type: "string", enum: TERMINAL_SHELL_NAMES },
        cwd: { type: "string" },
        initialCommand: { type: "string" },
        hermesCli: { type: "boolean" },
        provider: { type: "string" },
        apiMode: { type: "string" },
        baseUrl: { type: "string" },
        model: { type: "string" },
        apiKey: { type: "string" },
        taskId: { type: "string" }
      }
    }
  },
  {
    name: "terminal_exec",
    description: "Run a command inside a persistent terminal session and capture the output.",
    permissionClass: "system-write",
    supportedSurfaces: ["desktop", "cli", "headless"],
    inputSchema: {
      type: "object",
      properties: {
        session: { type: "string" },
        command: { type: "string" },
        shell: { type: "string", enum: TERMINAL_SHELL_NAMES },
        taskId: { type: "string" },
        allowNonZero: { type: "boolean" },
        expectedExitCode: { type: "integer" },
        allowedExitCodes: { type: "array", items: { type: "integer" } },
        timeoutMs: { type: "integer" }
      },
      required: ["command"]
    }
  },
  {
    name: "terminal_close",
    description: "Close a persistent terminal session.",
    permissionClass: "system-write",
    supportedSurfaces: ["desktop", "cli", "headless"],
    inputSchema: {
      type: "object",
      properties: {
        session: { type: "string" }
      }
    }
  },
  {
    name: "background_command_start",
    description: "Start a long-running local command in the background and capture its logs.",
    permissionClass: "system-write",
    supportedSurfaces: ["desktop", "cli", "headless"],
    inputSchema: {
      type: "object",
      properties: {
        job: { type: "string" },
        runner: { type: "string", enum: ["process", "powershell", "cmd"] },
        command: { type: "string" },
        args: { type: "array", items: { type: "string" } },
        cwd: { type: "string" },
        shell: { type: "boolean" }
      },
      required: ["command"]
    }
  },
  {
    name: "background_command_logs",
    description: "Read recent logs from a background command and optionally wait for a marker.",
    permissionClass: "safe/read-only",
    supportedSurfaces: ["desktop", "cli", "headless"],
    inputSchema: {
      type: "object",
      properties: {
        job: { type: "string" },
        waitFor: { type: "string" },
        checkUrl: { type: "string" },
        failOnPatterns: { type: "array", items: { type: "string" } },
        expectRunning: { type: "boolean" },
        timeoutMs: { type: "integer" },
        maxChars: { type: "integer" }
      }
    }
  },
  {
    name: "background_command_stop",
    description: "Stop a long-running local background command.",
    permissionClass: "system-write",
    supportedSurfaces: ["desktop", "cli", "headless"],
    inputSchema: {
      type: "object",
      properties: {
        job: { type: "string" }
      }
    }
  },
  {
    name: "verify_file",
    description: "Verify that one or more files exist and optionally contain or do not contain expected text.",
    permissionClass: "safe/read-only",
    supportedSurfaces: ["desktop", "cli", "headless"],
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string" },
        files: { type: "array", items: { type: "string" } },
        contains: { type: "array", items: { type: "string" } },
        notContains: { type: "array", items: { type: "string" } },
        maxChars: { type: "integer" }
      }
    }
  },
  {
    name: "verify_url",
    description: "Verify that an HTTP URL responds before considering a task complete.",
    permissionClass: "safe/read-only",
    supportedSurfaces: ["desktop", "cli", "headless"],
    inputSchema: {
      type: "object",
      properties: {
        url: { type: "string" },
        timeoutMs: { type: "integer" }
      },
      required: ["url"]
    }
  },
  {
    name: "verify_command",
    description: "Run a command as a verification step and fail if exit code or output expectations do not match.",
    permissionClass: "system-write",
    supportedSurfaces: ["desktop", "cli", "headless"],
    inputSchema: {
      type: "object",
      properties: {
        runner: { type: "string", enum: ["process", "powershell", "cmd"] },
        command: { type: "string" },
        args: { type: "array", items: { type: "string" } },
        cwd: { type: "string" },
        shell: { type: "boolean" },
        expectedExitCode: { type: "integer" },
        contains: { type: "array", items: { type: "string" } },
        notContains: { type: "array", items: { type: "string" } },
        timeoutMs: { type: "integer" }
      },
      required: ["command"]
    }
  },
  {
    name: "verify_site",
    description: "Verify a local web app end-to-end: expected files exist, URL responds, browser renders non-blank content and no blocking console/build errors appear.",
    permissionClass: "safe/read-only",
    supportedSurfaces: ["desktop", "cli", "headless"],
    inputSchema: {
      type: "object",
      properties: {
        url: { type: "string" },
        expectedFiles: { type: "array", items: { type: "string" } },
        expectedText: { type: "array", items: { type: "string" } },
        timeoutMs: { type: "integer" },
        browserRequired: { type: "boolean" }
      },
      required: ["url"]
    }
  },
  {
    name: "browser_check",
    description: "Open a URL in a headless installed Chromium browser and inspect render metrics, page errors and console errors.",
    permissionClass: "safe/read-only",
    supportedSurfaces: ["desktop", "cli", "headless"],
    inputSchema: {
      type: "object",
      properties: {
        url: { type: "string" },
        timeoutMs: { type: "integer" }
      },
      required: ["url"]
    }
  },
  {
    name: "browser_control",
    description: "Control the live Dream Server Workbench preview first. Supports navigation, DOM snapshots, coordinate/selector clicks, fill, press, scroll, screenshots, rendered text and console errors. Chromium/Playwright fallback is only used when allowFallback is true.",
    permissionClass: "network",
    supportedSurfaces: ["desktop", "cli", "headless"],
      inputSchema: {
        type: "object",
        properties: {
          url: { type: "string" },
          operation: { type: "string" },
          command: { type: "string" },
          usePreview: { type: "boolean" },
          allowFallback: { type: "boolean" },
          target: { type: "string" },
          ref: { type: "string" },
          selector: { type: "string" },
          text: { type: "string" },
          key: { type: "string" },
          x: { type: "number" },
          y: { type: "number" },
          direction: { type: "string" },
          deltaX: { type: "number" },
          deltaY: { type: "number" },
          pixels: { type: "integer" },
          headless: { type: "boolean" },
          timeoutMs: { type: "integer" },
          screenshot: { type: "boolean" },
        steps: {
          type: "array",
          items: {
            type: "object",
            properties: {
              type: { type: "string", enum: ["snapshot", "wait_for_selector", "wait_for_text", "click", "fill", "press", "scroll", "screenshot", "chess_state", "board_state", "chess_wait_turn", "wait_chess_turn", "chess_move", "click_square"] },
              ref: { type: "string" },
              selector: { type: "string" },
              fromSquare: { type: "string" },
              toSquare: { type: "string" },
              from_square: { type: "string" },
              to_square: { type: "string" },
              square: { type: "string" },
              promotion: { type: "string" },
              text: { type: "string" },
              key: { type: "string" },
              x: { type: "number" },
              y: { type: "number" },
              direction: { type: "string" },
              deltaX: { type: "number" },
              deltaY: { type: "number" },
              pixels: { type: "integer" },
              timeoutMs: { type: "integer" }
            }
          }
        }
      }
    }
  },
  {
    name: "verify_browser_console",
    description: "Alias for browser_check focused on browser console/page errors and blank-page detection.",
    permissionClass: "safe/read-only",
    supportedSurfaces: ["desktop", "cli", "headless"],
    inputSchema: {
      type: "object",
      properties: {
        url: { type: "string" },
        timeoutMs: { type: "integer" }
      },
      required: ["url"]
    }
  },
  {
    name: "stop_all_local_activity",
    description: "Stop all background jobs and persistent terminal sessions owned by Dream Server.",
    permissionClass: "system-write",
    supportedSurfaces: ["desktop", "cli", "headless"],
    inputSchema: {
      type: "object",
      properties: {}
    }
  },
  {
    name: "set_volume",
    description: "Set or adjust the Windows master output volume without opening UI windows.",
    permissionClass: "desktop-control",
    supportedSurfaces: ["desktop", "cli", "headless"],
    inputSchema: {
      type: "object",
      properties: {
        level: { type: "integer", description: "Absolute target volume from 0 to 100." },
        delta: { type: "integer", description: "Relative volume change from -100 to 100." },
        muted: { type: "boolean", description: "Mute or unmute the main output device." }
      }
    }
  },
  {
    name: "media_control",
    description: "Send a Windows global media command to the currently active media session, such as Spotify play/pause/next/previous.",
    permissionClass: "desktop-control",
    supportedSurfaces: ["desktop", "cli", "headless"],
    inputSchema: {
      type: "object",
      properties: {
        action: {
          type: "string",
          enum: ["play", "pause", "play_pause", "next", "previous", "stop"],
          description: "Media command to send to the active player."
        }
      },
      required: ["action"]
    }
  },
  {
    name: "system_query",
    description: "Read concrete local system information without opening UI windows, such as Wi-Fi password, SSID, local IP, hostname or Windows version.",
    permissionClass: "system-write",
    supportedSurfaces: ["desktop", "cli", "headless"],
    inputSchema: {
      type: "object",
      properties: {
        kind: {
          type: "string",
          enum: ["wifi_current_password", "wifi_current_ssid", "local_ip", "hostname", "os_version"]
        }
      },
      required: ["kind"]
    }
  },
  {
    name: "adb_command",
    description: "Run an ADB command against a connected Android device.",
    permissionClass: "system-write",
    supportedSurfaces: ["desktop", "cli", "headless"],
    inputSchema: {
      type: "object",
      properties: {
        args: { type: "array", items: { type: "string" } },
        serial: { type: "string" },
        wait: { type: "boolean" },
        timeoutMs: { type: "integer" }
      },
      required: ["args"]
    }
  },
  {
    name: "adb_shell",
    description: "Run a shell command on a connected Android device through ADB.",
    permissionClass: "system-write",
    supportedSurfaces: ["desktop", "cli", "headless"],
    inputSchema: {
      type: "object",
      properties: {
        command: { type: "string" },
        serial: { type: "string" },
        asRoot: { type: "boolean" },
        timeoutMs: { type: "integer" }
      },
      required: ["command"]
    }
  },
  {
    name: "fastboot_command",
    description: "Run a fastboot command against a device in bootloader mode.",
    permissionClass: "system-write",
    supportedSurfaces: ["desktop", "cli", "headless"],
    inputSchema: {
      type: "object",
      properties: {
        args: { type: "array", items: { type: "string" } },
        timeoutMs: { type: "integer" }
      },
      required: ["args"]
    }
  },
  {
    name: "mcp_list_tools",
    description: "List available tools from a configured MCP server.",
    permissionClass: "safe/read-only",
    supportedSurfaces: ["desktop", "cli", "headless"],
    inputSchema: {
      type: "object",
      properties: {
        server: { type: "string" }
      },
      required: ["server"]
    }
  },
  {
    name: "mcp_call",
    description: "Call a tool exposed by a configured MCP server.",
    permissionClass: "system-write",
    supportedSurfaces: ["desktop", "cli", "headless"],
    inputSchema: {
      type: "object",
      properties: {
        server: { type: "string" },
        tool: { type: "string" },
        arguments: { type: "object" }
      },
      required: ["server", "tool"]
    }
  },
  {
    name: "git_status",
    description: "Read git status for the current workspace.",
    permissionClass: "safe/read-only",
    supportedSurfaces: ["desktop", "cli", "headless"],
    inputSchema: {
      type: "object",
      properties: {
        cwd: { type: "string" }
      }
    }
  },
  {
    name: "git_create_branch",
    description: "Create a git branch and optionally switch to it.",
    permissionClass: "system-write",
    supportedSurfaces: ["desktop", "cli", "headless"],
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string" },
        fromRef: { type: "string" },
        checkout: { type: "boolean" },
        cwd: { type: "string" }
      },
      required: ["name"]
    }
  },
  {
    name: "git_worktree_add",
    description: "Create a git worktree, optionally with a new branch.",
    permissionClass: "system-write",
    supportedSurfaces: ["desktop", "cli", "headless"],
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string" },
        branch: { type: "string" },
        createBranch: { type: "boolean" },
        fromRef: { type: "string" },
        cwd: { type: "string" }
      },
      required: ["path"]
    }
  },
  {
    name: "git_worktree_list",
    description: "List git worktrees for the current repository.",
    permissionClass: "safe/read-only",
    supportedSurfaces: ["desktop", "cli", "headless"],
    inputSchema: {
      type: "object",
      properties: {
        cwd: { type: "string" }
      }
    }
  },
  {
    name: "git_worktree_remove",
    description: "Remove an existing git worktree, optionally forcing deletion.",
    permissionClass: "system-write",
    supportedSurfaces: ["desktop", "cli", "headless"],
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string" },
        cwd: { type: "string" },
        force: { type: "boolean" }
      },
      required: ["path"]
    }
  },
  {
    name: "agent_spawn",
    description: "Spawn a real sub-agent with its own chat and objective.",
    permissionClass: "system-write",
    supportedSurfaces: ["desktop", "cli", "headless"],
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string" },
        objective: { type: "string" },
        routeId: { type: "string" },
        provider: { type: "string", enum: ["local", "cloud"] },
        taskId: { type: "string" },
        useGit: { type: "boolean" },
        useWorktree: { type: "boolean" },
        orchestrate: { type: "boolean" },
        openTerminal: { type: "boolean" },
        branchName: { type: "string" },
        worktreePath: { type: "string" }
      },
      required: ["objective"]
    }
  },
  {
    name: "agent_list",
    description: "List spawned sub-agents and their status.",
    permissionClass: "safe/read-only",
    supportedSurfaces: ["desktop", "cli", "headless"],
    inputSchema: {
      type: "object",
      properties: {}
    }
  },
  {
    name: "agent_wait",
    description: "Wait for a spawned sub-agent to finish and return its latest summary.",
    permissionClass: "safe/read-only",
    supportedSurfaces: ["desktop", "cli", "headless"],
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string" },
        timeoutMs: { type: "integer" }
      },
      required: ["id"]
    }
  },
  {
    name: "agent_result",
    description: "Get the latest result or summary from a spawned sub-agent.",
    permissionClass: "safe/read-only",
    supportedSurfaces: ["desktop", "cli", "headless"],
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string" }
      },
      required: ["id"]
    }
  },
  {
    name: "agent_stop",
    description: "Stop a spawned sub-agent.",
    permissionClass: "system-write",
    supportedSurfaces: ["desktop", "cli", "headless"],
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string" }
      },
      required: ["id"]
    }
  },
  {
    name: "web_fetch",
    description: "Fetch a web page and return a readable text summary.",
    permissionClass: "network",
    supportedSurfaces: ["desktop", "cli", "headless"],
    inputSchema: {
      type: "object",
      properties: {
        url: { type: "string" }
      },
      required: ["url"]
    }
  },
  {
    name: "web_search",
    description: "Search the web using DuckDuckGo HTML results and return a compact summary.",
    permissionClass: "network",
    supportedSurfaces: ["desktop", "cli", "headless"],
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string" },
        maxResults: { type: "integer" }
      },
      required: ["query"]
    }
  }
];

const TOOL_REGISTRY = createToolRegistry(TOOL_MANIFESTS, {
  limitedToolNames: LIMITED_TOOL_NAMES
});

const FALLBACK_TOOL_PROMPT = [
  "You are connected to Dream Server tools.",
  "When local tools are required and native function/tool calling is unavailable, respond with short natural-language text followed by one or more fenced blocks in this exact format:",
  "```dream-server-action",
  '{"type":"launch_app","app":"notepad"}',
  "```",
  "Use the same JSON arguments as the named tools.",
  "Do not invent tools that are not listed.",
  "Do not rely on predefined site/project/topic templates. For coding or content generation, create files from the user's actual request and the observed project state.",
  "Do not turn inspection questions into creation tasks. If the user asks to check/list/verify something, inspect it and report the result.",
  "For system audio changes, use set_volume instead of inventing PowerShell volume commands.",
  "For music playback commands, use media_control instead of opening Spotify, browser checks or unrelated APIs.",
  "For terminal-style coding workflows, prefer terminal_open/terminal_exec/terminal_close instead of opening loose shells.",
  "For local web app work, choose the smallest appropriate tool sequence for the actual request. Use project_prepare_vite only when a Vite shell is genuinely useful; do not force Vite for every HTML/site request.",
  "For public web research/search, use web_search/web_fetch first. Do not open the Workbench preview just to search, compare or summarize webpages.",
  "Use browser_control when you need to interact with a page, capture a screenshot, read rendered text, test a local web app or inspect console/page errors instead of guessing from command output. In desktop mode it controls the visible Workbench preview first; use returned @e refs, selectors, or coordinates for follow-up clicks/typing.",
  "For web app work, use verify_file, verify_url, verify_site, browser_check or verify_browser_console before declaring success; do not open the browser as proof that the app works.",
  "For command-based checks, use verify_command with explicit expected output or exit code instead of assuming a command succeeded.",
  "For Android device work, prefer adb_command/adb_shell/fastboot_command instead of guessing unsupported helpers.",
  "If MCP servers are configured, prefer mcp_list_tools and mcp_call instead of pretending the integration does not exist.",
  "For code navigation, prefer file_symbols and workspace_symbols before blind grep when symbol search is enough.",
  "For JS/TS code intelligence, prefer lsp_document_symbols, lsp_workspace_symbols, lsp_definition, lsp_references, lsp_hover, lsp_code_actions, lsp_apply_code_action and lsp_rename.",
  "For precise file modifications, prefer apply_patch with unified diff. Use file_edit for small anchored edits; do not rewrite whole files unless replacement is intentional.",
  "Every write_file, append_file, file_edit and apply_patch returns a rollback changeId. Use file_rollback if validation or user feedback shows the edit was wrong.",
  "For git workflows, use git_status, git_create_branch and git_worktree_* instead of vague shell instructions.",
  "Use todo_write/task_* to keep persistent progress state when the task spans multiple steps.",
  "Use agent_spawn/agent_wait/agent_result when a sub-agent can work independently on a bounded subtask.",
  "If the user asks for a simple direct desktop action, emit only the needed tool call and stop talking.",
  "Do not substitute approximate actions for a system change. If the exact requested local action is unavailable, say that explicitly.",
  "For write/system actions, prefer the smallest safe step that advances the task."
].join("\n");

const ACTION_BLOCK_PATTERN = /```(?:dream-server-action|dream-server-tool|manus-studio-action)\s*([\s\S]*?)```/gi;

function clampNumber(value, min, max, fallback) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, numeric));
}

function truncateText(value, limit = 4000) {
  const text = String(value || "");
  return text.length > limit ? `${text.slice(0, limit)}\n...[truncated]` : text;
}

function normalizeAppName(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\.exe$/i, "")
    .replace(/[^a-z0-9]+/g, "");
}

function sanitizeArgs(args) {
  if (!Array.isArray(args)) {
    return [];
  }

  return args.slice(0, 32).map((entry) => String(entry));
}

function quoteCmdArg(value) {
  const text = String(value ?? "");
  if (!text.length) {
    return '""';
  }
  if (!/[\s"&|<>^()%!]/.test(text)) {
    return text;
  }
  return `"${text.replace(/"/g, '""')}"`;
}

function makeActionLabel(action) {
  const type = String(action?.type || "").trim();

  if (type === "open_url") return `abrir URL ${action.url || ""}`.trim();
  if (type === "open_path") return `abrir caminho ${action.path || ""}`.trim();
  if (type === "reveal_path") return `revelar caminho ${action.path || ""}`.trim();
  if (type === "set_preview_device") return `mudar preview para ${action.mode || "desktop"}`.trim();
  if (type === "launch_app") return `abrir app ${action.app || action.path || ""}`.trim();
  if (type === "create_directory") return `criar pasta ${action.path || ""}`.trim();
  if (type === "write_file") return `escrever arquivo ${action.path || ""}`.trim();
  if (type === "append_file") return `acrescentar arquivo ${action.path || ""}`.trim();
  if (type === "file_edit") return `editar arquivo ${action.path || ""}`.trim();
  if (type === "apply_patch") return `aplicar patch ${action.path || ""}`.trim();
  if (type === "file_rollback") return `reverter arquivo ${action.changeId || action.path || ""}`.trim();
  if (type === "read_file") return `ler arquivo ${action.path || ""}`.trim();
  if (type === "list_directory") return `listar pasta ${action.path || ""}`.trim();
  if (type === "glob_files") return `buscar arquivos ${action.pattern || ""}`.trim();
  if (type === "grep_files") return `buscar texto ${action.pattern || ""}`.trim();
  if (type === "file_symbols") return `listar simbolos de ${action.path || ""}`.trim();
  if (type === "workspace_symbols") return `buscar simbolos ${action.query || ""}`.trim();
  if (type === "lsp_document_symbols") return `listar simbolos LSP de ${action.path || ""}`.trim();
  if (type === "lsp_workspace_symbols") return `buscar simbolos LSP ${action.query || ""}`.trim();
  if (type === "lsp_definition") return `ir para definicao em ${action.path || ""}`.trim();
  if (type === "lsp_references") return `buscar referencias em ${action.path || ""}`.trim();
  if (type === "lsp_hover") return `ler hover em ${action.path || ""}`.trim();
  if (type === "lsp_code_actions") return `listar code actions em ${action.path || ""}`.trim();
  if (type === "lsp_apply_code_action") return `aplicar code action em ${action.path || ""}`.trim();
  if (type === "lsp_rename") return `renomear simbolo em ${action.path || ""}`.trim();
  if (type === "run_command") return `rodar comando ${action.command || ""}`.trim();
  if (type === "todo_write") return "atualizar todos";
  if (type === "todo_read") return "ler todos";
  if (type === "task_create") return `criar tarefa ${action.title || ""}`.trim();
  if (type === "task_list") return "listar tarefas";
  if (type === "task_get") return `ler tarefa ${action.id || ""}`.trim();
  if (type === "task_update") return `atualizar tarefa ${action.id || ""}`.trim();
  if (type === "task_stop") return `parar tarefa ${action.id || ""}`.trim();
  if (type === "task_delete") return `deletar tarefa ${action.id || ""}`.trim();
  if (type === "task_recover") return `recuperar tarefa ${action.id || ""}`.trim();
  if (type === "task_cleanup_worktree") return `limpar worktree da tarefa ${action.id || ""}`.trim();
  if (type === "task_create_pr") return `criar PR da tarefa ${action.id || ""}`.trim();
  if (type === "task_scheduler_tick") return "rodar scheduler do Kanban";
  if (type === "task_logs") return `ler logs da tarefa ${action.id || ""}`.trim();
  if (type === "project_prepare_vite") return `preparar projeto Vite ${action.name || action.path || ""}`.trim();
  if (type === "terminal_open") return `abrir terminal ${action.session || "main"}`.trim();
  if (type === "terminal_exec") return `executar no terminal ${action.command || ""}`.trim();
  if (type === "terminal_close") return `fechar terminal ${action.session || "main"}`.trim();
  if (type === "background_command_start") return `iniciar processo em background ${action.job || action.command || ""}`.trim();
  if (type === "background_command_logs") return `ler logs do processo ${action.job || ""}`.trim();
  if (type === "background_command_stop") return `parar processo em background ${action.job || ""}`.trim();
  if (type === "verify_file") return `verificar arquivo ${action.path || (Array.isArray(action.files) ? action.files[0] : "") || ""}`.trim();
  if (type === "verify_url") return `verificar URL ${action.url || ""}`.trim();
  if (type === "verify_command") return `verificar comando ${action.command || ""}`.trim();
  if (type === "verify_site") return `verificar site ${action.url || ""}`.trim();
  if (type === "browser_check") return `verificar navegador ${action.url || ""}`.trim();
  if (type === "browser_control") return `controlar navegador ${action.url || ""}`.trim();
  if (type === "gateway_control") return `controlar gateway ${action.command || "status"} ${action.platform || ""}`.trim();
  if (type === "verify_browser_console") return `verificar console do navegador ${action.url || ""}`.trim();
  if (type === "stop_all_local_activity") return "parar atividade local";
  if (type === "set_volume") return `ajustar volume ${action.level ?? action.delta ?? action.muted}`.trim();
  if (type === "media_control") return `controlar midia ${action.action || ""}`.trim();
  if (type === "system_query") return `consultar sistema ${action.kind || ""}`.trim();
  if (type === "adb_command") return `rodar adb ${Array.isArray(action.args) ? action.args.join(" ") : ""}`.trim();
  if (type === "adb_shell") return `rodar adb shell ${action.command || ""}`.trim();
  if (type === "fastboot_command") return `rodar fastboot ${Array.isArray(action.args) ? action.args.join(" ") : ""}`.trim();
  if (type === "mcp_list_tools") return `listar tools MCP ${action.server || ""}`.trim();
  if (type === "mcp_call") return `chamar MCP ${action.server || ""}:${action.tool || ""}`.trim();
  if (type === "git_status") return "ler git status";
  if (type === "git_create_branch") return `criar branch ${action.name || ""}`.trim();
  if (type === "git_worktree_add") return `criar worktree ${action.path || ""}`.trim();
  if (type === "git_worktree_list") return "listar worktrees";
  if (type === "git_worktree_remove") return `remover worktree ${action.path || ""}`.trim();
  if (type === "agent_spawn") return `criar subagente ${action.name || action.objective || ""}`.trim();
  if (type === "agent_list") return "listar subagentes";
  if (type === "agent_wait") return `aguardar subagente ${action.id || ""}`.trim();
  if (type === "agent_result") return `ler resultado do subagente ${action.id || ""}`.trim();
  if (type === "agent_stop") return `parar subagente ${action.id || ""}`.trim();
  if (type === "web_fetch") return `buscar pagina ${action.url || ""}`.trim();
  if (type === "web_search") return `pesquisar na web ${action.query || ""}`.trim();

  return "executar acao local";
}

function resolveSupportedApp(input) {
  const normalized = normalizeAppName(input);
  const appKey = SUPPORTED_APP_ALIASES[normalized] || normalized;
  return {
    appKey,
    appConfig: SUPPORTED_APPS[appKey] || null
  };
}

function expandPathInput(rawPath, workspaceRoot = process.cwd()) {
  const original = normalizePathText(rawPath);
  if (!original) {
    throw new Error("A acao local precisa de um caminho valido.");
  }

  const alias = PATH_ALIASES.get(original.toLowerCase());
  if (alias) {
    return path.normalize(alias);
  }

  const replaced = original
    .replace(/^~(?=$|[\\/])/, os.homedir())
    .replaceAll("%USERPROFILE%", os.homedir())
    .replaceAll("%HOME%", os.homedir())
    .replaceAll("%TEMP%", os.tmpdir())
    .replace(/%([^%]+)%/g, (_, name) => {
      const key = String(name || "").trim();
      return key && typeof process.env[key] === "string" ? process.env[key] : `%${key}%`;
    });

  if (process.platform === "win32" && /^[/\\][^/\\]/.test(replaced) && !/^[/\\]{2}/.test(replaced)) {
    const driveRootPath = path.normalize(replaced);
    if (existsSync(driveRootPath)) {
      return driveRootPath;
    }
    return path.normalize(path.join(workspaceRoot || os.homedir(), replaced.replace(/^[/\\]+/, "")));
  }

  if (path.isAbsolute(replaced)) {
    return path.normalize(replaced);
  }

  return path.normalize(path.join(workspaceRoot || os.homedir(), replaced));
}

function resolveOpenUrlTarget(rawUrl, workspaceRoot = process.cwd()) {
  const original = String(rawUrl || "").trim();
  if (!original) {
    throw new Error("A URL precisa incluir um protocolo valido, como https: ou whatsapp:.");
  }

  if (/^file:/i.test(original)) {
    let filePath = "";
    try {
      const parsed = new URL(original);
      if (parsed.hostname && (!parsed.pathname || parsed.pathname === "/")) {
        filePath = parsed.hostname;
      } else if (parsed.hostname && parsed.pathname) {
        filePath = `${parsed.hostname}${decodeURIComponent(parsed.pathname)}`;
      } else {
        filePath = fileURLToPath(parsed);
      }
    } catch {
      filePath = original.replace(/^file:\/{0,3}/i, "");
    }

    const absolutePath = expandPathInput(filePath, workspaceRoot);
    return {
      kind: "file",
      value: absolutePath,
      display: pathToFileURL(absolutePath).href
    };
  }

  if (!/^[a-z][a-z0-9+.-]*:/i.test(original)) {
    if (looksLikeExplicitPathInput(original)) {
      const absolutePath = expandPathInput(original, workspaceRoot);
      return {
        kind: "file",
        value: absolutePath,
        display: pathToFileURL(absolutePath).href
      };
    }
    throw new Error("A URL precisa incluir um protocolo valido, como https: ou whatsapp:.");
  }

  return {
    kind: "url",
    value: original,
    display: original
  };
}

function looksLikeExplicitPathInput(rawPath) {
  const value = normalizePathText(rawPath);
  if (!value) {
    return false;
  }
  if (PATH_ALIASES.has(value.toLowerCase())) {
    return true;
  }
  return (
    path.isAbsolute(value) ||
    /^[a-zA-Z]:[\\/]/.test(value) ||
    /^~(?=$|[\\/])/.test(value) ||
    /^%[^%]+%(?=$|[\\/])/.test(value) ||
    /[\\/]/.test(value) ||
    /\.[a-z0-9]{1,10}$/i.test(value)
  );
}

function resolvePathInputForAction(rawPath, workspaceRoot = process.cwd(), context = {}) {
  const target = expandPathInput(rawPath, workspaceRoot);
  if (existsSync(target)) {
    return target;
  }

  if (!looksLikeExplicitPathInput(rawPath) && typeof context.runtime?.resolveContextualPath === "function") {
    const contextual = context.runtime.resolveContextualPath({
      rawPath,
      chatId: context.chatId,
      runId: context.runId,
      objective: context.objective,
      workspaceRoot
    });
    if (contextual && existsSync(contextual)) {
      return path.normalize(contextual);
    }
  }

  return target;
}

function isPathInside(rootPath, targetPath) {
  if (!rootPath || !targetPath) {
    return false;
  }

  const relative = path.relative(path.resolve(rootPath), path.resolve(targetPath));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function permissionClassForAction(action, context = {}) {
  const type = String(action?.type || "").trim();
  if (["read_file", "list_directory", "glob_files", "grep_files", "background_command_logs", "verify_file", "verify_url", "verify_site", "browser_check", "verify_browser_console", "mcp_list_tools", "file_symbols", "workspace_symbols", "lsp_document_symbols", "lsp_workspace_symbols", "lsp_definition", "lsp_references", "lsp_hover", "lsp_code_actions", "todo_read", "task_list", "task_get", "task_logs", "agent_list", "agent_wait", "agent_result", "git_status", "git_worktree_list"].includes(type)) {
    return "safe/read-only";
  }
  if (["open_url", "browser_control", "web_fetch", "web_search"].includes(type)) {
    return "network";
  }
  if (["open_path", "reveal_path", "launch_app", "browser_harness", "browser_session_state"].includes(type)) {
    return "desktop-control";
  }
  if (type === "set_volume" || type === "set_preview_device" || type === "media_control") {
    return "desktop-control";
  }
  if (["project_prepare_vite", "gateway_control", "terminal_open", "terminal_exec", "terminal_close", "background_command_start", "background_command_stop", "stop_all_local_activity", "verify_command", "adb_command", "adb_shell", "fastboot_command", "mcp_call", "git_create_branch", "git_worktree_add", "git_worktree_remove", "agent_spawn", "agent_stop", "task_recover", "task_cleanup_worktree", "task_create_pr", "task_scheduler_tick"].includes(type)) {
    return "system-write";
  }
  if (type === "file_rollback" && !action?.path) {
    return "workspace-write";
  }
  if (["create_directory", "write_file", "append_file", "file_edit", "apply_patch", "file_rollback", "lsp_apply_code_action", "lsp_rename"].includes(type)) {
    const resolved = expandPathInput(action.path, context.workspaceRoot);
    return isPathInside(context.workspaceRoot || process.cwd(), resolved)
      ? "workspace-write"
      : "system-write";
  }
  if (["todo_write", "task_create", "task_update", "task_stop", "task_delete"].includes(type)) {
    return "workspace-write";
  }
  return "system-write";
}

function isPermissionAutoAllowed(permissionClass, settings = {}) {
  if (permissionClass === "safe/read-only") {
    return true;
  }

  if (String(settings.trustMode || "ask") === "always") {
    return true;
  }

  if (
    String(settings.trustMode || "ask") === "session" &&
    Array.isArray(settings.allowedPermissionClasses) &&
    settings.allowedPermissionClasses.includes(permissionClass)
  ) {
    return true;
  }

  return false;
}

function parseActionPayload(content) {
  const source = String(content || "");
  const actions = [];
  const body = source.replace(ACTION_BLOCK_PATTERN, (_, rawJson) => {
    try {
      const parsed = JSON.parse(String(rawJson || "").trim());
      if (parsed && typeof parsed === "object") {
        if (!parsed.type && parsed.name) {
          parsed.type = parsed.name;
        }
        actions.push(parsed);
      }
    } catch {}
    return "";
  });

  return {
    body: body.trim(),
    actions
  };
}

function extractActionsFromAssistant(content, nativeToolCalls = []) {
  const nativeActions = nativeToolCalls
    .map((call) => {
      try {
        const parsed = call?.arguments ? JSON.parse(call.arguments) : {};
        return {
          type: call.name,
          ...(parsed && typeof parsed === "object" ? parsed : {})
        };
      } catch {
        return {
          type: call.name,
          rawArguments: call.arguments || ""
        };
      }
    })
    .filter((action) => action && action.type);

  if (nativeActions.length) {
    return {
      body: String(content || "").trim(),
      actions: nativeActions
    };
  }

  return parseActionPayload(content);
}

function getToolRegistry() {
  return TOOL_REGISTRY;
}

function getToolManifests(fullAccessMode = false, options = {}) {
  const normalizedOptions = typeof fullAccessMode === "object"
    ? { ...fullAccessMode }
    : { ...options, fullAccessMode: Boolean(fullAccessMode) };
  return TOOL_REGISTRY.list(normalizedOptions);
}

function getSupportedApps() {
  return Object.entries(SUPPORTED_APPS).map(([key, value]) => ({
    key,
    label: value.label
  }));
}

function getSupportedTools(fullAccessMode = false, options = {}) {
  const normalizedOptions = typeof fullAccessMode === "object"
    ? { ...fullAccessMode }
    : { ...options, fullAccessMode: Boolean(fullAccessMode) };
  return TOOL_REGISTRY.getSupportedTools(normalizedOptions);
}

function normalizeSessionName(value) {
  const trimmed = String(value || "main").trim().toLowerCase();
  return trimmed.replace(/[^a-z0-9._-]+/g, "-").slice(0, 48) || "main";
}

function normalizeJobName(value) {
  return normalizeSessionName(value || "job");
}

function normalizeProjectSlug(value) {
  const normalized = String(value || "dream-project")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
  return normalized || "dream-project";
}

async function isPortAvailable(port, host = "127.0.0.1") {
  return await new Promise((resolve) => {
    const server = net.createServer();
    server.once("error", () => resolve(false));
    server.once("listening", () => {
      server.close(() => resolve(true));
    });
    server.listen(port, host);
  });
}

async function findAvailablePort(preferred = 4173) {
  const start = clampNumber(preferred, 1024, 65535, 4173);
  for (let port = start; port < Math.min(start + 80, 65535); port += 1) {
    if (await isPortAvailable(port)) {
      return port;
    }
  }
  throw new Error(`Nao encontrei porta local livre a partir de ${start}.`);
}

function getOpenAIToolSchemas(fullAccessMode = false, options = {}) {
  const normalizedOptions = typeof fullAccessMode === "object"
    ? { ...fullAccessMode }
    : { ...options, fullAccessMode: Boolean(fullAccessMode) };
  return TOOL_REGISTRY.getOpenAIToolSchemas(normalizedOptions);
}

async function launchDetached(command, args = [], options = {}) {
  await new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      detached: true,
      stdio: "ignore",
      shell: Boolean(options.shell),
      windowsHide: Boolean(options.windowsHide),
      cwd: options.cwd
    });

    let settled = false;
    let verifyTimer = null;
    const verifyMs = Math.max(80, Math.min(Number(options.verifyMs || 400), 3000));

    const finalizeResolve = () => {
      if (settled) {
        return;
      }
      settled = true;
      child.unref();
      resolve({
        pid: child.pid || null
      });
    };

    const finalizeReject = (error) => {
      if (settled) {
        return;
      }
      settled = true;
      reject(error);
    };

    child.once("error", (error) => {
      clearTimeout(verifyTimer);
      finalizeReject(error);
    });
    child.once("spawn", () => {
      verifyTimer = setTimeout(finalizeResolve, verifyMs);
    });
    child.once("exit", (code, signal) => {
      clearTimeout(verifyTimer);
      if (Number(code || 0) !== 0) {
        finalizeReject(
          new Error(
            `O processo "${command}" terminou cedo com codigo ${Number(code || 0)}${signal ? ` (${signal})` : ""}.`
          )
        );
        return;
      }
      finalizeResolve();
    });
  });
}

async function openDesktopTarget(target) {
  if (process.platform === "win32") {
    await launchDetached("cmd.exe", ["/d", "/s", "/c", "start", "", target], { shell: true });
    return;
  }
  if (process.platform === "darwin") {
    await launchDetached("open", [target]);
    return;
  }
  await launchDetached("xdg-open", [target]);
}

async function revealDesktopTarget(target) {
  if (process.platform === "win32") {
    await launchDetached("explorer.exe", [`/select,${target}`]);
    return;
  }
  if (process.platform === "darwin") {
    await launchDetached("open", ["-R", target]);
    return;
  }
  await launchDetached("xdg-open", [path.dirname(target)]);
}

function toPowerShellLiteral(value) {
  return `'${String(value ?? "").replace(/'/g, "''")}'`;
}

async function resolveCommandWithWhere(command, cwd = process.cwd()) {
  const raw = String(command || "").trim();
  if (!raw || /[\\/]/.test(raw) || /^[a-z]:/i.test(raw)) {
    return null;
  }

  try {
    const result = await runProcess("where.exe", [raw], {
      cwd,
      timeoutMs: 5000
    });
    if (Number(result.code || 0) !== 0) {
      return null;
    }
    const candidates = String(result.stdout || "")
      .split(/\r?\n/)
      .map((entry) => entry.trim())
      .filter(Boolean);

    if (!candidates.length) {
      return null;
    }

    const preferredOrder = [".exe", ".cmd", ".bat", ".com", ".ps1"];
    for (const ext of preferredOrder) {
      const match = candidates.find((entry) => path.extname(entry).toLowerCase() === ext);
      if (match) {
        return match;
      }
    }

    for (const candidate of candidates) {
      const baseExt = path.extname(candidate).toLowerCase();
      if (baseExt) {
        return candidate;
      }
      for (const ext of preferredOrder) {
        const sibling = `${candidate}${ext}`;
        if (existsSync(sibling)) {
          return sibling;
        }
      }
    }

    return candidates[0] || null;
  } catch {
    return null;
  }
}

async function startProcessVisible(target, args = [], options = {}) {
  const filePath = String(target || "").trim();
  if (!filePath) {
    throw new Error("Nenhum alvo de execucao foi informado.");
  }

  const safeArgs = sanitizeArgs(args);
  const argsLiteral = safeArgs.length ? `@(${safeArgs.map(toPowerShellLiteral).join(", ")})` : "@()";
  const hasCwd = Boolean(options.cwd);
  const script = [
    "$ErrorActionPreference = 'Stop'",
    `$filePath = ${toPowerShellLiteral(filePath)}`,
    `$argumentList = ${argsLiteral}`,
    hasCwd ? `$workingDirectory = ${toPowerShellLiteral(options.cwd)}` : "$workingDirectory = $null",
    "if ($workingDirectory) {",
    safeArgs.length
      ? "  $proc = Start-Process -FilePath $filePath -ArgumentList $argumentList -WorkingDirectory $workingDirectory -WindowStyle Normal -PassThru"
      : "  $proc = Start-Process -FilePath $filePath -WorkingDirectory $workingDirectory -WindowStyle Normal -PassThru",
    "} else {",
    safeArgs.length
      ? "  $proc = Start-Process -FilePath $filePath -ArgumentList $argumentList -WindowStyle Normal -PassThru"
      : "  $proc = Start-Process -FilePath $filePath -WindowStyle Normal -PassThru",
    "}",
    "if ($null -eq $proc) { throw 'O processo nao foi iniciado.' }",
    "Write-Output ('PID=' + $proc.Id)"
  ].join("; ");

  const result = await runProcess(
    "powershell.exe",
    ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", wrapPowerShellScript(script)],
    {
      cwd: options.cwd,
      timeoutMs: 15000
    }
  );

  if (Number(result.code || 0) !== 0) {
    throw new Error(
      summarizeCommandFailure("powershell", result) ||
        truncateText(result.stderr || result.stdout || "Falha ao iniciar o aplicativo.")
    );
  }

  const pidMatch = String(result.stdout || "").match(/PID=(\d+)/i);
  return {
    pid: pidMatch ? Number(pidMatch[1]) : null
  };
}

async function runProcess(command, args = [], options = {}) {
  return await new Promise((resolve, reject) => {
    const stdout = [];
    const stderr = [];
    const child = spawn(command, args, {
      shell: Boolean(options.shell),
      windowsHide: true,
      cwd: options.cwd
    });

    let didTimeout = false;
    let aborted = false;
    const timeoutMs = Math.max(1000, Math.min(Number(options.timeoutMs || 120000), 300000));
    const timer = setTimeout(() => {
      didTimeout = true;
      if (options.killTree === false) {
        child.kill();
      } else {
        void killProcessTree(child.pid);
      }
    }, timeoutMs);

    const abort = () => {
      aborted = true;
      try {
        if (options.killTree === false) {
          child.kill();
        } else {
          void killProcessTree(child.pid);
        }
      } catch {}
    };

    if (options.signal?.aborted) {
      abort();
    } else if (options.signal) {
      options.signal.addEventListener("abort", abort, { once: true });
    }

    child.once("error", (error) => {
      clearTimeout(timer);
      if (options.signal) {
        options.signal.removeEventListener("abort", abort);
      }
      reject(error);
    });

    child.stdout?.on("data", (chunk) => stdout.push(chunk));
    child.stderr?.on("data", (chunk) => stderr.push(chunk));

    child.once("close", (code) => {
      clearTimeout(timer);
      if (options.signal) {
        options.signal.removeEventListener("abort", abort);
      }
      const stdoutText = decodeProcessBuffer(stdout);
      const stderrText = decodeProcessBuffer(stderr);

      if (didTimeout) {
        reject(new Error("O comando excedeu o tempo limite da ponte local."));
        return;
      }
      if (aborted) {
        reject(new Error("A execucao foi interrompida pelo usuario."));
        return;
      }

      resolve({
        code: Number(code || 0),
        stdout: stdoutText,
        stderr: stderrText
      });
    });
  });
}

function decodeProcessBuffer(chunks) {
  const buffer = Buffer.concat(Array.isArray(chunks) ? chunks : []);
  if (!buffer.length) {
    return "";
  }

  const utf8 = buffer.toString("utf8").replace(/\u0000/g, "");
  if (!utf8.includes("�")) {
    return utf8;
  }

  return buffer.toString("latin1").replace(/\u0000/g, "");
}

function wrapPowerShellScript(script) {
  const prelude = [
    "[Console]::OutputEncoding = [System.Text.Encoding]::UTF8",
    "$OutputEncoding = [System.Text.Encoding]::UTF8",
    "chcp 65001 > $null"
  ].join("; ");

  return `${prelude}; ${script}`;
}

function summarizeCommandFailure(runner, result) {
  const stderr = String(result?.stderr || "");
  const stdout = String(result?.stdout || "");
  const combined = `${stderr}\n${stdout}`;
  const hints = [];

  if (/CommandNotFoundException|nao e reconhecido como nome de cmdlet|n.o . reconhecido como nome de cmdlet/i.test(combined)) {
    hints.push("O comando ou cmdlet que o modelo tentou usar nao existe nesse ambiente.");
  }
  if (/Import-Module.+(nao foi carregado|could not be loaded|was not loaded)/i.test(combined)) {
    hints.push("O modulo citado tambem nao esta disponivel no PowerShell atual.");
  }
  if (/Access is denied|acesso negado/i.test(combined)) {
    hints.push("A execucao foi bloqueada por permissao do Windows ou pelo contexto atual.");
  }
  if (/timed out|tempo limite/i.test(combined)) {
    hints.push("O comando demorou demais para responder e bateu no limite da ponte local.");
  }
  if (runner === "powershell" && !hints.length && result?.code) {
    hints.push("O script PowerShell executou, mas terminou com erro.");
  }

  return hints.join(" ");
}

function formatCommandResult(label, runner, result) {
  const summary = Number(result?.code || 0) === 0 ? "" : summarizeCommandFailure(runner, result);
  const stdout = stripAnsi(result?.stdout || "");
  const stderr = stripAnsi(result?.stderr || "");
  return [
    `${label} finalizado com codigo ${result.code}.`,
    summary ? `RESUMO:\n${summary}` : null,
    `STDOUT:\n${truncateText(stdout || "(vazio)")}`,
    `STDERR:\n${truncateText(stderr || "(vazio)")}`
  ]
    .filter(Boolean)
    .join("\n");
}

function getAllowedExitCodes(action) {
  if (action?.allowNonZero === true) {
    return null;
  }
  if (Array.isArray(action?.allowedExitCodes)) {
    const codes = action.allowedExitCodes
      .map((entry) => Number(entry))
      .filter((entry) => Number.isInteger(entry));
    if (codes.length) {
      return new Set(codes);
    }
  }
  if (Number.isInteger(Number(action?.expectedExitCode))) {
    return new Set([Number(action.expectedExitCode)]);
  }
  return new Set([0]);
}

function assertAllowedCommandExit(action, label, runner, result) {
  const allowedExitCodes = getAllowedExitCodes(action);
  if (!allowedExitCodes || allowedExitCodes.has(Number(result?.code || 0))) {
    return;
  }
  throw new Error(
    [
      `${label} falhou com codigo ${result.code}.`,
      "Este resultado conta como falha operacional; o agente deve observar o erro e reparar antes de finalizar.",
      formatCommandResult(label, runner, result)
    ].join("\n")
  );
}

async function findLaunchTarget(appName) {
  const normalized = normalizeAppName(appName);
  if (!normalized) {
    return null;
  }

  const roots = [
    path.join(process.env.APPDATA || "", "Microsoft", "Windows", "Start Menu", "Programs"),
    path.join(process.env.ProgramData || "C:\\ProgramData", "Microsoft", "Windows", "Start Menu", "Programs"),
    path.join(process.env.LOCALAPPDATA || "", "Programs"),
    path.join(process.env.ProgramFiles || "", ""),
    path.join(process.env["ProgramFiles(x86)"] || "", "")
  ].filter((entry) => entry && existsSync(entry));

  const stack = roots.map((root) => ({ root, depth: 0 }));
  let scanned = 0;

  while (stack.length && scanned < 5000) {
    const current = stack.pop();
    if (!current) {
      continue;
    }

    let entries = [];
    try {
      entries = await fs.readdir(current.root, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      scanned += 1;
      const fullPath = path.join(current.root, entry.name);
      if (entry.isDirectory()) {
        if (current.depth < 4) {
          stack.push({ root: fullPath, depth: current.depth + 1 });
        }
        continue;
      }

      const ext = path.extname(entry.name).toLowerCase();
      if (![".lnk", ".appref-ms", ".url", ".exe"].includes(ext)) {
        continue;
      }

      const normalizedName = normalizeAppName(path.basename(entry.name, ext));
      if (
        normalizedName === normalized ||
        normalizedName.includes(normalized) ||
        normalized.includes(normalizedName)
      ) {
        return fullPath;
      }
    }
  }

  return null;
}

async function tryLaunchTarget(target, args = [], options = {}) {
  const extension = path.extname(String(target || "")).toLowerCase();
  if ([".lnk", ".url", ".appref-ms"].includes(extension)) {
    const result = await runProcess(
      "cmd.exe",
      ["/d", "/s", "/c", "start", "", target],
      {
        cwd: options.cwd,
        timeoutMs: 15000
      }
    );
    if (Number(result.code || 0) !== 0) {
      throw new Error(
        summarizeCommandFailure("cmd", result) ||
          truncateText(result.stderr || result.stdout || "Falha ao iniciar o atalho.")
      );
    }
    return { pid: null };
  }

  return await startProcessVisible(target, args, options);
}

function getPreferredAppTargets(appKey) {
  const localAppData = process.env.LOCALAPPDATA || "";
  const programFiles = process.env.ProgramFiles || "";
  const programFilesX86 = process.env["ProgramFiles(x86)"] || "";
  const candidates = {
    brave: [
      path.join(programFiles, "BraveSoftware", "Brave-Browser", "Application", "brave.exe"),
      path.join(programFilesX86, "BraveSoftware", "Brave-Browser", "Application", "brave.exe"),
      path.join(localAppData, "BraveSoftware", "Brave-Browser", "Application", "brave.exe"),
      path.join(process.env.ProgramData || "C:\\ProgramData", "Microsoft", "Windows", "Start Menu", "Programs", "Brave.lnk")
    ],
    chrome: [
      path.join(programFiles, "Google", "Chrome", "Application", "chrome.exe"),
      path.join(programFilesX86, "Google", "Chrome", "Application", "chrome.exe"),
      path.join(localAppData, "Google", "Chrome", "Application", "chrome.exe")
    ],
    edge: [
      path.join(programFilesX86, "Microsoft", "Edge", "Application", "msedge.exe"),
      path.join(programFiles, "Microsoft", "Edge", "Application", "msedge.exe")
    ],
    discord: [
      path.join(localAppData, "Discord", "Update.exe")
    ],
    whatsapp: [
      path.join(localAppData, "WhatsApp", "WhatsApp.exe"),
      path.join(localAppData, "Microsoft", "WindowsApps", "WhatsApp.exe")
    ]
  };
  return (candidates[String(appKey || "").trim().toLowerCase()] || []).filter((entry) => entry && existsSync(entry));
}

async function launchAnyApp(appName, args = [], workspaceRoot = process.cwd()) {
  const rawName = String(appName || "").trim();
  if (!rawName) {
    throw new Error("A acao launch_app precisa de um nome de app ou caminho.");
  }

  const { appKey, appConfig } = resolveSupportedApp(rawName);
  const candidates = [];

  if (appConfig) {
    candidates.push({ target: appConfig.command, label: appConfig.label });
  }
  for (const preferredTarget of getPreferredAppTargets(appKey)) {
    candidates.push({ target: preferredTarget, label: preferredTarget });
  }

  if (existsSync(rawName)) {
    candidates.push({ target: rawName, label: rawName });
  } else {
    const rawResolved = await resolveCommandWithWhere(rawName, workspaceRoot);
    if (rawResolved) {
      candidates.push({ target: rawResolved, label: rawName });
    }
    if (!/\.exe$/i.test(rawName)) {
      const exeResolved = await resolveCommandWithWhere(`${rawName}.exe`, workspaceRoot);
      if (exeResolved) {
        candidates.push({ target: exeResolved, label: `${rawName}.exe` });
      }
    }
  }

  let lastError = null;
  for (const candidate of candidates) {
    try {
      const launch = await startProcessVisible(candidate.target, args, {
        cwd: workspaceRoot
      });
      return `Aplicativo aberto: ${candidate.label}${launch.pid ? ` (PID ${launch.pid})` : ""}`;
    } catch (error) {
      lastError = error;
    }
  }

  const discoveredTarget = await findLaunchTarget(rawName);
  if (discoveredTarget) {
    const launch = await tryLaunchTarget(discoveredTarget, args, {
      cwd: workspaceRoot
    });
    return `Aplicativo aberto: ${discoveredTarget}${launch.pid ? ` (PID ${launch.pid})` : ""}`;
  }

  const shellFallbacks = [...new Set([rawName, appConfig?.command].filter(Boolean))];
  for (const candidate of shellFallbacks) {
    const result = await runProcess(
      "cmd.exe",
      ["/d", "/s", "/c", "start", "", candidate],
      {
        cwd: workspaceRoot,
        timeoutMs: 15000
      }
    ).catch((error) => ({
      code: 1,
      stdout: "",
      stderr: error.message || "Falha ao iniciar aplicativo via shell."
    }));
    if (Number(result.code || 0) === 0) {
      return `Aplicativo aberto: ${candidate}`;
    }
    lastError = new Error(
      summarizeCommandFailure("cmd", result) ||
        truncateText(result.stderr || result.stdout || `Falha ao iniciar ${candidate}.`)
    );
  }

  throw lastError || new Error(`Nao consegui localizar ou iniciar o app: ${rawName}`);
}

async function writeFileAction(targetPath, content, append = false, workspaceRoot = process.cwd(), lspManager = null) {
  const target = expandPathInput(targetPath, workspaceRoot);
  await fs.mkdir(path.dirname(target), { recursive: true });
  const beforeExists = existsSync(target);
  const before = beforeExists ? await fs.readFile(target, "utf8") : "";
  const nextContent = append ? `${before}${String(content || "")}` : String(content || "");
  const outcome = await commitTextFileChange(target, before, nextContent, beforeExists, workspaceRoot);
  notifyFileChanged(target, workspaceRoot, nextContent);
  return [
    append ? `Arquivo atualizado: ${target}` : `Arquivo escrito: ${target}`,
    outcome.changeSummary,
    outcome.validationSummary,
    outcome.diffSummary
  ].filter(Boolean).join("\n");
}

async function fileEditAction(action, workspaceRoot = process.cwd(), lspManager = null) {
  const target = expandPathInput(action?.path, workspaceRoot);
  const edits = Array.isArray(action?.edits) ? action.edits : [];
  if (!edits.length) {
    throw new Error("file_edit exige ao menos uma edicao.");
  }

  const beforeExists = existsSync(target);
  let content = await fs.readFile(target, "utf8");
  const before = content;
  let applied = 0;

  for (const edit of edits) {
    const type = String(edit?.type || "replace").trim();
    if (type === "replace") {
      const oldText = String(edit?.oldText || "");
      const newText = String(edit?.newText || "");
      if (!oldText) {
        throw new Error("Edicao replace exige oldText.");
      }
      if (Boolean(edit?.replaceAll)) {
        if (!content.includes(oldText)) {
          throw new Error(`Trecho nao encontrado para replaceAll em ${target}.`);
        }
        const pieces = content.split(oldText);
        applied += Math.max(0, pieces.length - 1);
        content = pieces.join(newText);
        continue;
      }
      const firstIndex = content.indexOf(oldText);
      if (firstIndex < 0) {
        throw new Error(`Trecho nao encontrado para replace em ${target}.`);
      }
      const secondIndex = content.indexOf(oldText, firstIndex + oldText.length);
      if (secondIndex >= 0) {
        throw new Error(`Trecho ambiguo para replace em ${target}; use um anchor mais especifico.`);
      }
      content = `${content.slice(0, firstIndex)}${newText}${content.slice(firstIndex + oldText.length)}`;
      applied += 1;
      continue;
    }

    if (type === "insert_before" || type === "insert_after") {
      const anchor = String(edit?.anchor || "");
      const text = String(edit?.text || "");
      if (!anchor) {
        throw new Error(`${type} exige anchor.`);
      }
      const index = content.indexOf(anchor);
      if (index < 0) {
        throw new Error(`Anchor nao encontrado para ${type} em ${target}.`);
      }
      const secondIndex = content.indexOf(anchor, index + anchor.length);
      if (secondIndex >= 0) {
        throw new Error(`Anchor ambiguo para ${type} em ${target}; use um trecho mais especifico.`);
      }
      content =
        type === "insert_before"
          ? `${content.slice(0, index)}${text}${content.slice(index)}`
          : `${content.slice(0, index + anchor.length)}${text}${content.slice(index + anchor.length)}`;
      applied += 1;
      continue;
    }

    if (type === "append") {
      content += String(edit?.text || "");
      applied += 1;
      continue;
    }

    if (type === "prepend") {
      content = `${String(edit?.text || "")}${content}`;
      applied += 1;
      continue;
    }

    throw new Error(`Tipo de edicao nao suportado em file_edit: ${type}`);
  }

  const outcome = await commitTextFileChange(target, before, content, beforeExists, workspaceRoot);
  notifyFileChanged(target, workspaceRoot, content);
  return [
    `Arquivo editado com ${applied} mudanca(s): ${target}`,
    outcome.changeSummary,
    outcome.validationSummary,
    outcome.diffSummary
  ].filter(Boolean).join("\n");
}

function splitPatchLines(value = "") {
  const lines = String(value || "").replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
  if (lines.length && lines[lines.length - 1] === "") {
    lines.pop();
  }
  return lines;
}

function normalizeUnifiedDiffPath(rawPath = "") {
  let value = String(rawPath || "").trim();
  if (!value || value === "/dev/null") {
    return "";
  }
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    value = value.slice(1, -1);
  }
  value = value.replace(/\t.*$/, "").trim();
  if (value.startsWith("a/") || value.startsWith("b/")) {
    value = value.slice(2);
  }
  return value;
}

function parseUnifiedPatch(patchText = "", fallbackPath = "") {
  const lines = splitPatchLines(patchText);
  const patches = [];
  let current = null;
  let index = 0;

  function startPatch(oldPath, newPath) {
    const resolvedPath = normalizeUnifiedDiffPath(newPath) || normalizeUnifiedDiffPath(oldPath) || fallbackPath;
    if (!resolvedPath) {
      throw new Error("Patch sem caminho de arquivo. Informe path ou use cabecalhos ---/+++.");
    }
    current = {
      oldPath: normalizeUnifiedDiffPath(oldPath),
      newPath: normalizeUnifiedDiffPath(newPath),
      path: resolvedPath,
      hunks: []
    };
    patches.push(current);
  }

  if (fallbackPath && lines.some((line) => /^@@\s+-\d+(?:,\d+)?\s+\+\d+(?:,\d+)?\s+@@/.test(line))) {
    startPatch(fallbackPath, fallbackPath);
  }

  while (index < lines.length) {
    const line = lines[index];
    const oldHeader = line.match(/^---\s+(.+)$/);
    if (oldHeader && lines[index + 1]?.startsWith("+++ ")) {
      const newHeader = lines[index + 1].match(/^\+\+\+\s+(.+)$/);
      startPatch(oldHeader[1], newHeader?.[1] || "");
      index += 2;
      continue;
    }

    const hunkHeader = line.match(/^@@\s+-(\d+)(?:,(\d+))?\s+\+(\d+)(?:,(\d+))?\s+@@/);
    if (hunkHeader) {
      if (!current) {
        throw new Error("Patch contem hunk @@ antes do cabecalho de arquivo.");
      }
      const hunk = {
        oldStart: Number(hunkHeader[1]),
        oldCount: hunkHeader[2] ? Number(hunkHeader[2]) : 1,
        newStart: Number(hunkHeader[3]),
        newCount: hunkHeader[4] ? Number(hunkHeader[4]) : 1,
        lines: []
      };
      index += 1;
      while (index < lines.length) {
        const hunkLine = lines[index];
        if (/^@@\s+-\d+(?:,\d+)?\s+\+\d+(?:,\d+)?\s+@@/.test(hunkLine) || (hunkLine.startsWith("--- ") && lines[index + 1]?.startsWith("+++ "))) {
          break;
        }
        if (hunkLine.startsWith("\\ No newline at end of file")) {
          index += 1;
          continue;
        }
        const marker = hunkLine[0] || " ";
        if (![" ", "+", "-"].includes(marker)) {
          throw new Error(`Linha invalida no patch de ${current.path}: ${hunkLine}`);
        }
        hunk.lines.push({
          marker,
          text: hunkLine.slice(1)
        });
        index += 1;
      }
      current.hunks.push(hunk);
      continue;
    }

    index += 1;
  }

  const valid = patches.filter((entry) => entry.hunks.length);
  if (!valid.length) {
    throw new Error("Patch sem hunks validos. Use diff unificado com linhas @@.");
  }
  return valid;
}

function lineEndingForText(value = "") {
  return String(value || "").includes("\r\n") ? "\r\n" : "\n";
}

function splitTextForPatch(value = "") {
  return String(value || "").replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
}

function joinPatchedLines(lines, originalText) {
  const eol = lineEndingForText(originalText);
  return lines.join(eol);
}

function applyParsedPatchToText(beforeText, filePatch) {
  let lines = splitTextForPatch(beforeText);
  let offset = 0;

  for (const hunk of filePatch.hunks) {
    let cursor = Math.max(0, hunk.oldStart - 1 + offset);
    const expectedOld = [];
    const replacement = [];

    for (const entry of hunk.lines) {
      if (entry.marker === " " || entry.marker === "-") {
        expectedOld.push(entry.text);
      }
      if (entry.marker === " " || entry.marker === "+") {
        replacement.push(entry.text);
      }
    }

    const actualOld = lines.slice(cursor, cursor + expectedOld.length);
    if (actualOld.length !== expectedOld.length || actualOld.some((line, index) => line !== expectedOld[index])) {
      const expectedPreview = expectedOld.slice(0, 8).join("\n");
      const actualPreview = actualOld.slice(0, 8).join("\n");
      throw new Error(
        [
          `Patch nao casou em ${filePatch.path} perto da linha ${hunk.oldStart}.`,
          expectedPreview ? `Esperado:\n${expectedPreview}` : "Esperado: trecho vazio",
          actualPreview ? `Atual:\n${actualPreview}` : "Atual: trecho vazio"
        ].join("\n")
      );
    }

    lines.splice(cursor, expectedOld.length, ...replacement);
    offset += replacement.length - expectedOld.length;
  }

  return joinPatchedLines(lines, beforeText);
}

async function applyPatchAction(action, workspaceRoot = process.cwd(), lspManager = null) {
  const patchText = String(action?.patch || "");
  if (!patchText.trim()) {
    throw new Error("apply_patch exige o campo patch com diff unificado.");
  }

  const filePatches = parseUnifiedPatch(patchText, action?.path ? String(action.path) : "");
  const prepared = [];

  for (const filePatch of filePatches) {
    const target = expandPathInput(filePatch.path, workspaceRoot);
    const beforeExists = existsSync(target);
    const before = beforeExists ? await fs.readFile(target, "utf8") : "";
    if (!beforeExists && filePatch.oldPath && filePatch.oldPath !== "/dev/null") {
      throw new Error(`Patch aponta para arquivo ausente: ${target}`);
    }
    const after = applyParsedPatchToText(before, filePatch);
    prepared.push({
      target,
      before,
      after,
      beforeExists
    });
  }

  for (const item of prepared) {
    const validation = await validateTextFile(item.target, item.after, workspaceRoot);
    if (!validation.ok) {
      throw new Error(
        [
          `Patch rejeitado pela validacao antes de gravar: ${item.target}`,
          validation.summary,
          summarizeTextDiff(item.before, item.after, item.target)
        ].filter(Boolean).join("\n")
      );
    }
  }

  const summaries = [];
  for (const item of prepared) {
    await fs.mkdir(path.dirname(item.target), { recursive: true });
    await fs.writeFile(item.target, item.after, "utf8");
    const change = rememberEditChange(item.target, item.before, item.after, item.beforeExists, workspaceRoot);
    notifyFileChanged(item.target, workspaceRoot, item.after);
    summaries.push(
      [
        `Patch aplicado: ${item.target}`,
        `Rollback: changeId=${change.id}`,
        summarizeTextDiff(item.before, item.after, item.target)
      ].join("\n")
    );
  }

  return summaries.join("\n\n");
}

async function commitTextFileChange(target, before, after, beforeExists, workspaceRoot) {
  await fs.writeFile(target, after, "utf8");
  const validation = await validateTextFile(target, after, workspaceRoot);
  if (!validation.ok) {
    if (beforeExists) {
      await fs.writeFile(target, before, "utf8");
    } else {
      await fs.rm(target, { force: true });
    }
    throw new Error(
      [
        `Alteracao revertida porque a validacao falhou: ${target}`,
        validation.summary,
        summarizeTextDiff(before, after, target)
      ].filter(Boolean).join("\n")
    );
  }

  const change = rememberEditChange(target, before, after, beforeExists, workspaceRoot);
  return {
    changeId: change.id,
    changeSummary: `Rollback: changeId=${change.id}`,
    validationSummary: validation.summary,
    diffSummary: summarizeTextDiff(before, after, target)
  };
}

async function validateTextFile(target, content, workspaceRoot) {
  const relativePath = path.relative(workspaceRoot || process.cwd(), target).replace(/\\/g, "/");
  if (/^(<<<<<<<|=======|>>>>>>>) /m.test(content) || /^(<<<<<<<|=======|>>>>>>>)$/m.test(content)) {
    return {
      ok: false,
      summary: "Validacao: falhou porque o arquivo contem marcadores de conflito Git."
    };
  }

  const ext = path.extname(target).toLowerCase();
  const basename = path.basename(target).toLowerCase();
  if (ext === ".json" || basename === "package.json") {
    try {
      JSON.parse(content);
      return { ok: true, summary: `Validacao: JSON OK (${relativePath}).` };
    } catch (error) {
      return {
        ok: false,
        summary: `Validacao JSON falhou em ${relativePath}: ${error.message}`
      };
    }
  }

  if ([".js", ".mjs", ".cjs"].includes(ext)) {
    const result = await runProcess(process.execPath, ["--check", target], {
      cwd: path.dirname(target),
      timeoutMs: 20000,
      killTree: true
    }).catch((error) => ({
      code: 1,
      stdout: "",
      stderr: error.message || String(error)
    }));
    if (Number(result.code || 0) !== 0) {
      return {
        ok: false,
        summary: `Validacao JS falhou em ${relativePath}:\n${truncateText(result.stderr || result.stdout, 3000)}`
      };
    }
    return { ok: true, summary: `Validacao: JS syntax OK (${relativePath}).` };
  }

  if (ext === ".html") {
    const hasDoctypeOrRoot = /<!doctype html|<html[\s>]|<body[\s>]|<main[\s>]|<div[\s>]/i.test(content);
    const hasBrokenScript = /<script[^>]*>\s*<\/script>/i.test(content);
    if (!hasDoctypeOrRoot || hasBrokenScript) {
      return {
        ok: false,
        summary: `Validacao HTML falhou em ${relativePath}: estrutura HTML insuficiente ou script vazio suspeito.`
      };
    }
    return { ok: true, summary: `Validacao: HTML basico OK (${relativePath}).` };
  }

  return { ok: true, summary: "" };
}

function summarizeTextDiff(before, after, target) {
  if (before === after) {
    return "Diff: sem alteracoes.";
  }

  const beforeLines = String(before || "").split(/\r?\n/);
  const afterLines = String(after || "").split(/\r?\n/);
  let prefix = 0;
  while (
    prefix < beforeLines.length &&
    prefix < afterLines.length &&
    beforeLines[prefix] === afterLines[prefix]
  ) {
    prefix += 1;
  }

  let suffix = 0;
  while (
    suffix + prefix < beforeLines.length &&
    suffix + prefix < afterLines.length &&
    beforeLines[beforeLines.length - 1 - suffix] === afterLines[afterLines.length - 1 - suffix]
  ) {
    suffix += 1;
  }

  const removed = beforeLines.slice(prefix, beforeLines.length - suffix);
  const added = afterLines.slice(prefix, afterLines.length - suffix);
  const maxChunk = 40;
  const shownRemoved = removed.slice(0, maxChunk);
  const shownAdded = added.slice(0, maxChunk);
  const lines = [
    `Diff: ${target}`,
    `@@ -${prefix + 1},${removed.length} +${prefix + 1},${added.length} @@`,
    ...shownRemoved.map((line) => `- ${truncateText(line, 220)}`),
    ...shownAdded.map((line) => `+ ${truncateText(line, 220)}`)
  ];
  if (removed.length > maxChunk || added.length > maxChunk) {
    lines.push("... diff truncado ...");
  }
  return lines.join("\n");
}

function rememberEditChange(target, before, after, beforeExists, workspaceRoot) {
  const id = `edit-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
  const entry = {
    id,
    path: target,
    workspaceRoot: workspaceRoot || process.cwd(),
    before: String(before || ""),
    after: String(after || ""),
    beforeExists: Boolean(beforeExists),
    createdAt: Date.now(),
    diffSummary: summarizeTextDiff(before, after, target)
  };
  EDIT_HISTORY.set(id, entry);
  while (EDIT_HISTORY.size > MAX_EDIT_HISTORY) {
    const oldest = [...EDIT_HISTORY.values()].sort((left, right) => left.createdAt - right.createdAt)[0];
    if (!oldest) {
      break;
    }
    EDIT_HISTORY.delete(oldest.id);
  }
  return entry;
}

function findEditChange(action = {}, workspaceRoot = process.cwd()) {
  const changeId = String(action?.changeId || "").trim();
  if (changeId) {
    return EDIT_HISTORY.get(changeId) || null;
  }
  if (!action?.path) {
    return null;
  }
  const target = expandPathInput(action.path, workspaceRoot);
  return [...EDIT_HISTORY.values()]
    .filter((entry) => path.resolve(entry.path) === path.resolve(target))
    .sort((left, right) => right.createdAt - left.createdAt)[0] || null;
}

async function fileRollbackAction(action, workspaceRoot = process.cwd(), lspManager = null) {
  const change = findEditChange(action, workspaceRoot);
  if (!change) {
    throw new Error("Nenhuma alteracao encontrada para rollback. Informe changeId ou path de uma alteracao recente.");
  }
  if (change.beforeExists) {
    await fs.mkdir(path.dirname(change.path), { recursive: true });
    await fs.writeFile(change.path, change.before, "utf8");
    notifyFileChanged(change.path, workspaceRoot, change.before);
  } else {
    await fs.rm(change.path, { force: true });
    notifyFileChanged(change.path, workspaceRoot, "");
  }
  EDIT_HISTORY.delete(change.id);
  return [
    `Rollback aplicado: ${change.path}`,
    `changeId=${change.id}`,
    change.diffSummary
  ].filter(Boolean).join("\n");
}

async function readFileAction(targetPath, maxChars, workspaceRoot = process.cwd()) {
  const target = expandPathInput(targetPath, workspaceRoot);
  const text = await fs.readFile(target, "utf8");
  const limit = clampNumber(maxChars, 100, 24000, 4000);
  return `Conteudo de ${target}:\n${truncateText(text, limit)}`;
}

async function listDirectoryAction(targetPath, depthValue, workspaceRoot = process.cwd()) {
  const target = expandPathInput(targetPath, workspaceRoot);
  const depth = clampNumber(depthValue, 0, 5, 1);
  const lines = [];
  let count = 0;

  async function walk(currentPath, currentDepth, prefix) {
    if (count >= 180) {
      return;
    }

    let entries = await fs.readdir(currentPath, { withFileTypes: true });
    entries = entries.sort((left, right) => {
      if (left.isDirectory() !== right.isDirectory()) {
        return left.isDirectory() ? -1 : 1;
      }
      return left.name.localeCompare(right.name);
    });

    for (const entry of entries) {
      if (count >= 180) {
        return;
      }
      count += 1;
      const marker = entry.isDirectory() ? "[dir]" : "[file]";
      lines.push(`${prefix}${marker} ${entry.name}`);
      if (entry.isDirectory() && currentDepth < depth) {
        await walk(path.join(currentPath, entry.name), currentDepth + 1, `${prefix}  `);
      }
    }
  }

  await walk(target, 0, "");
  return `Conteudo de ${target}:\n${lines.join("\n") || "(vazio)"}`;
}

function globToRegExp(pattern) {
  const normalized = String(pattern || "").replace(/\\/g, "/");
  const escaped = normalized.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  const regexBody = escaped
    .replace(/\\\*\\\*/g, ".*")
    .replace(/\\\*/g, "[^/]*")
    .replace(/\\\?/g, ".");
  return new RegExp(`^${regexBody}$`, "i");
}

async function walkFiles(rootPath, maxDepth = 5, maxResults = 300) {
  const results = [];

  async function visit(currentPath, depth) {
    if (results.length >= maxResults) {
      return;
    }

    let entries = [];
    try {
      entries = await fs.readdir(currentPath, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (results.length >= maxResults) {
        return;
      }
      const fullPath = path.join(currentPath, entry.name);
      if (entry.isDirectory()) {
        if (depth < maxDepth) {
          await visit(fullPath, depth + 1);
        }
        continue;
      }
      results.push(fullPath);
    }
  }

  await visit(rootPath, 0);
  return results;
}

async function globFilesAction(action, workspaceRoot = process.cwd()) {
  const basePath = expandPathInput(action.basePath || ".", workspaceRoot);
  const regex = globToRegExp(action.pattern);
  const maxResults = clampNumber(action.maxResults, 1, 400, 120);
  const files = await walkFiles(basePath, 6, maxResults * 2);
  const matches = files
    .map((filePath) => path.relative(basePath, filePath).replace(/\\/g, "/"))
    .filter((relativePath) => regex.test(relativePath))
    .slice(0, maxResults);

  return matches.length
    ? `Arquivos encontrados em ${basePath}:\n${matches.join("\n")}`
    : `Nenhum arquivo encontrado para ${action.pattern} em ${basePath}.`;
}

async function grepFilesAction(action, workspaceRoot = process.cwd()) {
  const searchRoot = expandPathInput(action.path || ".", workspaceRoot);
  const maxMatches = clampNumber(action.maxMatches, 1, 200, 60);
  const globRegex = action.glob ? globToRegExp(action.glob) : null;
  const files = await walkFiles(searchRoot, 6, 300);
  const query = String(action.pattern || "");
  const matches = [];

  for (const filePath of files) {
    if (matches.length >= maxMatches) {
      break;
    }

    const relativePath = path.relative(searchRoot, filePath).replace(/\\/g, "/");
    if (globRegex && !globRegex.test(relativePath)) {
      continue;
    }

    let content = "";
    try {
      content = await fs.readFile(filePath, "utf8");
    } catch {
      continue;
    }

    const lines = content.split(/\r?\n/);
    for (let index = 0; index < lines.length; index += 1) {
      if (lines[index].includes(query)) {
        matches.push(`${relativePath}:${index + 1}: ${truncateText(lines[index], 240)}`);
      }
      if (matches.length >= maxMatches) {
        break;
      }
    }
  }

  return matches.length
    ? `Ocorrencias de "${query}" em ${searchRoot}:\n${matches.join("\n")}`
    : `Nenhuma ocorrencia de "${query}" em ${searchRoot}.`;
}

async function runCommandAction(action, workspaceRoot = process.cwd(), signal = null) {
  const runner = String(action?.runner || "process").trim().toLowerCase();
  const wait = action?.wait !== false;
  const cwd = action?.cwd ? expandPathInput(action.cwd, workspaceRoot) : workspaceRoot;
  const timeoutMs = clampNumber(action?.timeoutMs, 1000, 300000, 120000);

  if (runner === "powershell") {
    const script = String(action?.command || "").trim();
    if (!script) {
      throw new Error("A acao run_command com runner=powershell precisa de um script.");
    }
    assertNoNativeWindowsPosix({ script, cwd, shell: "powershell" });
    const wrappedScript = wrapPowerShellScript(script);
    if (!wait) {
      await launchDetached(
        "powershell.exe",
        ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", wrappedScript],
        { cwd, windowsHide: true }
      );
      return `Comando PowerShell iniciado: ${script}`;
    }

    const result = await runProcess(
      "powershell.exe",
      ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", wrappedScript],
      { cwd, timeoutMs, signal }
    );
    assertAllowedCommandExit(action, "PowerShell", "powershell", result);
    return formatCommandResult("PowerShell", "powershell", result);
  }

  if (runner === "cmd") {
    const script = String(action?.command || "").trim();
    if (!script) {
      throw new Error("A acao run_command com runner=cmd precisa de um comando.");
    }
    assertNoNativeWindowsPosix({ script, cwd, shell: "cmd" });
    if (!wait) {
      await launchDetached("cmd.exe", ["/d", "/s", "/c", script], { cwd, windowsHide: true });
      return `Comando CMD iniciado: ${script}`;
    }

    const result = await runProcess("cmd.exe", ["/d", "/s", "/c", script], {
      cwd,
      timeoutMs,
      signal
    });
    assertAllowedCommandExit(action, "CMD", "cmd", result);
    return formatCommandResult("CMD", "cmd", result);
  }

  const command = normalizeNativeWindowsProcessCommand(String(action?.command || "").trim());
  if (!command) {
    throw new Error("A acao run_command precisa de um comando.");
  }

  const args = sanitizeArgs(action?.args);
  const shellMode = Boolean(action?.shell);
  assertNoNativeWindowsPosix({ command, args, cwd, shell: shellMode ? "shell" : "process" });
  if (!wait) {
    await launchDetached(command, args, { cwd, shell: shellMode, windowsHide: true });
    return `Processo iniciado: ${command}`;
  }

  const result = await runProcess(command, args, { cwd, shell: shellMode, timeoutMs, signal });
  assertAllowedCommandExit(action, "Processo", "process", result);
  return formatCommandResult("Processo", "process", result);
}

async function runVerificationCommand(action, workspaceRoot = process.cwd(), signal = null) {
  const runner = String(action?.runner || "process").trim().toLowerCase();
  const cwd = action?.cwd ? expandPathInput(action.cwd, workspaceRoot) : workspaceRoot;
  const timeoutMs = clampNumber(action?.timeoutMs, 1000, 300000, 120000);

  if (runner === "powershell") {
    const script = String(action?.command || "").trim();
    if (!script) {
      throw new Error("verify_command com runner=powershell exige um script.");
    }
    assertNoNativeWindowsPosix({ script, cwd, shell: "powershell" });
    return {
      label: "PowerShell",
      runner,
      result: await runProcess(
        "powershell.exe",
        ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", wrapPowerShellScript(script)],
        { cwd, timeoutMs, signal }
      )
    };
  }

  if (runner === "cmd") {
    const script = String(action?.command || "").trim();
    if (!script) {
      throw new Error("verify_command com runner=cmd exige um comando.");
    }
    assertNoNativeWindowsPosix({ script, cwd, shell: "cmd" });
    return {
      label: "CMD",
      runner,
      result: await runProcess("cmd.exe", ["/d", "/s", "/c", script], { cwd, timeoutMs, signal })
    };
  }

  const command = normalizeNativeWindowsProcessCommand(String(action?.command || "").trim());
  if (!command) {
    throw new Error("verify_command exige um comando.");
  }
  const args = sanitizeArgs(action?.args);
  assertNoNativeWindowsPosix({ command, args, cwd, shell: Boolean(action?.shell) ? "shell" : "process" });

  return {
    label: "Processo",
    runner: "process",
    result: await runProcess(command, args, {
      cwd,
      shell: Boolean(action?.shell),
      timeoutMs,
      signal
    })
  };
}

async function verifyCommandAction(action, workspaceRoot = process.cwd(), signal = null) {
  const expectedExitCode = Number.isFinite(Number(action?.expectedExitCode))
    ? Number(action.expectedExitCode)
    : 0;
  const required = Array.isArray(action?.contains)
    ? action.contains.map((entry) => String(entry || "")).filter(Boolean)
    : [];
  const forbidden = Array.isArray(action?.notContains)
    ? action.notContains.map((entry) => String(entry || "")).filter(Boolean)
    : [];
  const { label, runner, result } = await runVerificationCommand(action, workspaceRoot, signal);
  const combined = `${result.stdout || ""}\n${result.stderr || ""}`;
  const missing = required.filter((entry) => !combined.includes(entry));
  const presentForbidden = forbidden.filter((entry) => combined.includes(entry));
  const ok =
    Number(result.code || 0) === expectedExitCode &&
    missing.length === 0 &&
    presentForbidden.length === 0;
  const header = ok ? "COMMAND VERIFICATION PASSED" : "COMMAND VERIFICATION FAILED";
  const details = [
    header,
    `Expected exit code: ${expectedExitCode}`,
    missing.length ? `Missing text:\n${missing.join("\n")}` : null,
    presentForbidden.length ? `Forbidden text found:\n${presentForbidden.join("\n")}` : null,
    formatCommandResult(label, runner, result)
  ].filter(Boolean).join("\n");

  if (!ok) {
    throw new Error(details);
  }
  return details;
}

async function runNpmCommand(args = [], cwd, timeoutMs = 180000, signal = null) {
  const resolved = (await resolveCommandWithWhere("npm", cwd).catch(() => null)) || "npm";
  const ext = path.extname(String(resolved || "")).toLowerCase();
  if ([".cmd", ".bat"].includes(ext)) {
    return await runProcess("cmd.exe", ["/d", "/c", "call", resolved, ...args], {
      cwd,
      timeoutMs,
      signal
    });
  }
  return await runProcess(resolved, args, {
    cwd,
    timeoutMs,
    signal
  });
}

async function projectPrepareViteAction(action, workspaceRoot = process.cwd(), context = {}) {
  const name = String(action?.name || "").trim();
  if (!name) {
    throw new Error("project_prepare_vite exige um nome de projeto.");
  }

  const slug = normalizeProjectSlug(name);
  const baseRoot = workspaceRoot ? path.resolve(workspaceRoot) : path.join(os.homedir(), "DreamServerProjects");
  const projectRoot = action?.path ? expandPathInput(action.path, workspaceRoot) : path.join(baseRoot, slug);
  const rawLocale = String(context?.runtime?.state?.settings?.locale || Intl.DateTimeFormat().resolvedOptions().locale || "en-US")
    .trim()
    .replace("_", "-");
  const htmlLang = /^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/.test(rawLocale) ? rawLocale : "en-US";
  const port = await findAvailablePort(action?.port || 4173);
  const url = `http://127.0.0.1:${port}`;
  const install = action?.install !== false;
  const start = action?.start !== false;
  const overwriteBootstrap = Boolean(action?.overwriteBootstrap);
  await fs.mkdir(projectRoot, { recursive: true });

  const bootstrapFiles = [
    [
      "package.json",
      JSON.stringify(
        {
          name: slug,
          private: true,
          version: "0.0.0",
          type: "module",
          scripts: {
            dev: "vite",
            build: "vite build",
            preview: "vite preview"
          },
          devDependencies: {
            vite: "^8.0.8"
          }
        },
        null,
        2
      ) + "\n"
    ],
    [
      "index.html",
      [
        "<!doctype html>",
        `<html lang="${htmlLang}">`,
        "  <head>",
        '    <meta charset="UTF-8" />',
        '    <meta name="viewport" content="width=device-width, initial-scale=1.0" />',
        `    <title>${name.replace(/[<>]/g, "")}</title>`,
        '    <script type="module" src="/main.js"></script>',
        "  </head>",
        "  <body>",
        '    <div id="app"></div>',
        "  </body>",
        "</html>",
        ""
      ].join("\n")
    ],
    [
      "main.js",
      [
        'import "./style.css";',
        "",
        'const app = document.querySelector("#app");',
        "if (app) {",
        '  app.innerHTML = "";',
        "}",
        ""
      ].join("\n")
    ],
    [
      "style.css",
      [
        ":root {",
        "  color-scheme: dark;",
        "}",
        "",
        "* {",
        "  box-sizing: border-box;",
        "}",
        "",
        "body {",
        "  margin: 0;",
        "  min-width: 320px;",
        "  min-height: 100vh;",
        "}",
        ""
      ].join("\n")
    ]
  ];

  const written = [];
  const preserved = [];
  for (const [relativePath, content] of bootstrapFiles) {
    const target = path.join(projectRoot, relativePath);
    if (!overwriteBootstrap && existsSync(target)) {
      preserved.push(relativePath);
      continue;
    }
    await fs.writeFile(target, content, "utf8");
    written.push(relativePath);
  }

  const output = [
    `Projeto Vite preparado: ${projectRoot}`,
    `URL planejada: ${url}`,
    written.length ? `Arquivos bootstrap escritos: ${written.join(", ")}` : "Arquivos bootstrap preservados.",
    preserved.length ? `Arquivos existentes preservados: ${preserved.join(", ")}` : null
  ].filter(Boolean);

  if (install) {
    const installResult = await runNpmCommand(["install"], projectRoot, clampNumber(action?.installTimeoutMs, 30000, 600000, 300000), context.signal);
    if (Number(installResult.code || 0) !== 0) {
      throw new Error(["npm install falhou.", formatCommandResult("npm", "process", installResult)].join("\n"));
    }
    output.push("Dependencias instaladas.");
  }

  let jobName = "";
  if (start) {
    jobName = normalizeJobName(`vite-${slug}-dev`);
    const existingJob = BACKGROUND_PROCESSES.get(jobName);
    if (existingJob?.status === "running") {
      await backgroundCommandStop({ job: jobName, reason: "restart_vite_project" });
    }
    await backgroundCommandStart(
      {
        job: jobName,
        runner: "process",
        command: "npm",
        args: ["run", "dev", "--", "--host", "127.0.0.1", "--port", String(port), "--strictPort"],
        cwd: projectRoot
      },
      projectRoot,
      context
    );
    const logs = await backgroundCommandLogs(
      {
        job: jobName,
        waitFor: `127.0.0.1:${port}`,
        checkUrl: url,
        failOnPatterns: ["EADDRINUSE", "PARSE_ERROR", "Build failed"],
        timeoutMs: 45000,
        maxChars: 6000
      },
      context.signal
    );
    output.push(`Servidor iniciado: ${jobName}`);
    output.push(logs);
  }

  if (context.runtime?.upsertProjectRecord) {
    context.runtime.upsertProjectRecord({
      name,
      slug,
      path: projectRoot,
      url,
      port,
      job: jobName || "",
      chatId: context.chatId || null,
      runId: context.runId || null,
      lastObjective: context.objective || "",
      expectedFiles: bootstrapFiles.map(([relativePath]) => path.join(projectRoot, relativePath)),
      status: start ? "running" : "created",
      updatedAt: Date.now()
    });
  }

  output.push("Agora escreva o codigo solicitado pelo usuario nos arquivos do projeto e valide com verify_site antes de abrir a URL.");
  return output.join("\n");
}

function defaultTerminalShellName() {
  if (process.platform === "win32") {
    return "cmd";
  }
  const envShell = path.basename(String(process.env.SHELL || "")).toLowerCase();
  return TERMINAL_SHELL_NAMES.includes(envShell) && !["powershell", "pwsh", "cmd"].includes(envShell)
    ? envShell
    : "sh";
}

function findWindowsGitBash() {
  const explicit = String(process.env.HERMES_GIT_BASH_PATH || "").trim();
  if (explicit && existsSync(explicit)) {
    return explicit;
  }
  const candidates = [
    path.join(process.env.ProgramFiles || "C:\\Program Files", "Git", "bin", "bash.exe"),
    path.join(process.env["ProgramFiles(x86)"] || "C:\\Program Files (x86)", "Git", "bin", "bash.exe"),
    path.join(process.env.LOCALAPPDATA || "", "Programs", "Git", "bin", "bash.exe")
  ];
  return candidates.find((candidate) => candidate && existsSync(candidate)) || "";
}

function assertNoNativeWindowsPosix(action = {}) {
  const problem = nativeWindowsPosixProblem(action);
  if (problem) {
    throw new Error(problem);
  }
}

function normalizeNativeWindowsProcessCommand(command) {
  if (process.platform !== "win32") {
    return command;
  }
  const base = commandBaseName(command);
  if (base !== "bash" && base !== "bash.exe") {
    return command;
  }
  const gitBash = findWindowsGitBash();
  if (gitBash) {
    return gitBash;
  }
  if (shouldExposeWslPaths()) {
    return command;
  }
  throw new Error("Bash nao esta configurado para este Windows nativo. Use cmd/PowerShell, instale Git Bash, ou chame wsl.exe explicitamente quando quiser rodar dentro do WSL.");
}

function getTerminalShell(shellName) {
  const parseMarkerExitCode = (line) => {
    const match = String(line || "").match(/:(-?\d*)(?:\D|$)/);
    if (!match) return NaN;
    return match[1] === "" ? 0 : Number(match[1]);
  };
  const normalized = String(shellName || defaultTerminalShellName()).trim().toLowerCase();
  if (normalized === "cmd") {
    return {
      shell: "cmd",
      command: "cmd.exe",
      args: ["/Q", "/K"],
      marker: (id) => `echo __DREAM_DONE_${id}__:%errorlevel%`,
      parseExitCode: parseMarkerExitCode
    };
  }
  if (["bash", "zsh", "sh"].includes(normalized)) {
    if (process.platform === "win32") {
      const gitBash = normalized === "bash" ? findWindowsGitBash() : "";
      if (!gitBash) {
        return {
          shell: "cmd",
          command: "cmd.exe",
          args: ["/Q", "/K"],
          marker: (id) => `echo __DREAM_DONE_${id}__:%errorlevel%`,
          parseExitCode: parseMarkerExitCode
        };
      }
      return {
        shell: "bash",
        command: gitBash,
        args: ["-i"],
        marker: (id) => `(code=$?; printf '__DREAM_DONE_${id}__:%s\\n' "$code")`,
        parseExitCode: parseMarkerExitCode
      };
    }
    return {
      shell: normalized,
      command: normalized,
      args: ["-i"],
      marker: (id) => `(code=$?; printf '__DREAM_DONE_${id}__:%s\\n' "$code")`,
      parseExitCode: parseMarkerExitCode
    };
  }

  const usePwsh = normalized === "pwsh" || process.platform !== "win32";

  return {
    shell: usePwsh ? "pwsh" : "powershell",
    command: usePwsh ? (process.platform === "win32" ? "pwsh.exe" : "pwsh") : "powershell.exe",
    args: usePwsh && process.platform !== "win32"
      ? ["-NoLogo", "-NoProfile", "-NoExit"]
      : ["-NoLogo", "-NoProfile", "-ExecutionPolicy", "Bypass", "-NoExit"],
    marker: (id) => `$dreamExitCode = if ($null -eq $LASTEXITCODE) { 0 } else { $LASTEXITCODE }; Write-Output "__DREAM_DONE_${id}__:$dreamExitCode"`,
    parseExitCode: parseMarkerExitCode
  };
}

function dreamRuntimeRoot() {
  const root = path.resolve(__dirname, "..");
  return root.includes("app.asar")
    ? root.replace("app.asar", "app.asar.unpacked")
    : root;
}

function quoteShellArg(shell, value) {
  const raw = String(value || "");
  if (shell === "powershell" || shell === "pwsh") {
    return `'${raw.replace(/'/g, "''")}'`;
  }
  if (shell === "cmd") {
    return `"${raw.replace(/"/g, '""')}"`;
  }
  return `'${raw.replace(/'/g, "'\"'\"'")}'`;
}

function withHermesCliEnvironment(shell, command) {
  if (shell === "powershell" || shell === "pwsh") {
    return `$env:PYTHONUTF8='1'; $env:PYTHONIOENCODING='utf-8'; ${command}`;
  }
  if (shell === "cmd") {
    return `chcp 65001 >nul&& set PYTHONUTF8=1&& set PYTHONIOENCODING=utf-8&& ${command}`;
  }
  return `PYTHONUTF8=1 PYTHONIOENCODING=utf-8 ${command}`;
}

function hermesPythonCommand() {
  const root = dreamRuntimeRoot();
  const candidates = [
    String(process.env.DREAM_HERMES_PYTHON || "").trim(),
    path.join(root, ".venv-hermes", "Scripts", "python.exe"),
    path.join(root, ".venv-hermes", "bin", "python"),
    path.join(root, ".venv-hermes", "bin", "python3")
  ].filter(Boolean);
  return candidates.find((candidate) => existsSync(candidate)) || (process.platform === "win32" ? "python" : "python3");
}

function buildHermesCliCommand(shell, action = {}) {
  const root = dreamRuntimeRoot();
  const cliPath = path.join(root, "vendor", "hermes-agent", "cli.py");
  const args = [hermesPythonCommand(), cliPath];
  const provider = String(action.provider || "").trim();
  const baseUrl = String(action.baseUrl || "").trim();
  const model = String(action.model || "").trim();
  const apiKey = String(action.apiKey || "").trim();
  if (provider) args.push("--provider", provider);
  if (baseUrl) args.push("--base_url", baseUrl);
  if (model) args.push("--model", model);
  if (apiKey) args.push("--api_key", apiKey);
  return withHermesCliEnvironment(shell, args.map((arg) => quoteShellArg(shell, arg)).join(" "));
}

function decodeChunk(chunk) {
  return Buffer.isBuffer(chunk) ? chunk.toString("utf8") : String(chunk || "");
}

function escapeRegex(value) {
  return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function ensureTerminalSessionAlive(session) {
  if (!session || !session.alive) {
    throw new Error("A sessao de terminal nao esta ativa.");
  }
  if (session.transport === "pty") {
    if (!session.ptyProcess) {
      throw new Error("A sessao PTY nao esta ativa.");
    }
    return;
  }
  if (!session.child || session.child.killed) {
    throw new Error("A sessao de terminal nao esta ativa.");
  }
}

function terminalPid(session) {
  return session?.transport === "pty" ? session.ptyProcess?.pid : session?.child?.pid;
}

async function terminateTerminalProcess(session, reason = "manual") {
  if (!session) {
    return {
      ok: true,
      method: "none",
      reason: "terminal session missing"
    };
  }

  const pid = terminalPid(session);
  try {
    if (session.transport === "pty") {
      session.ptyProcess?.write("exit\r\n");
    } else {
      session.child?.stdin?.write("exit\r\n");
    }
  } catch {}

  let killResult = null;
  try {
    killResult = await killProcessTree(pid);
  } catch (error) {
    killResult = {
      ok: false,
      error: error.message || "Falha ao matar arvore do terminal."
    };
  }

  try {
    if (session.transport === "pty") {
      session.ptyProcess?.kill?.();
    } else if (session.child && !session.child.killed) {
      session.child.kill();
    }
  } catch {}

  session.killResult = killResult;
  session.alive = false;
  session.promptState = "closed";
  session.stopReason = reason;
  session.stoppedAt = Date.now();
  session.currentCommand = null;
  session.currentCommandStartedAt = null;
  session.currentCommandTimeoutMs = null;
  session.currentCommandStallAfterMs = null;
  session.currentChatId = null;
  session.currentRunId = null;
  session.updatedAt = Date.now();
  return killResult;
}

function writeTerminalInput(session, text) {
  ensureTerminalSessionAlive(session);
  if (session.transport === "pty") {
    session.ptyProcess.write(text);
    return;
  }
  session.child.stdin.write(text);
}

function terminalOwnerMatches(session, chatId) {
  if (!chatId) {
    return false;
  }
  return [session?.chatId, session?.currentChatId, session?.lastChatId].some(
    (value) => value && String(value) === String(chatId)
  );
}

function jobOwnerMatches(job, chatId) {
  if (!chatId) {
    return false;
  }
  return [job?.chatId, job?.currentChatId, job?.lastChatId].some(
    (value) => value && String(value) === String(chatId)
  );
}

function runtimeContextMeta(context = {}) {
  return {
    chatId: context.chatId ? String(context.chatId) : null,
    runId: context.runId ? String(context.runId) : null,
    actionKey: context.actionKey ? String(context.actionKey) : null
  };
}

function trimInactiveActivityMaps() {
  const trimMap = (map, maxInactive) => {
    const inactive = [...map.values()]
      .filter((entry) => entry.status !== "running" && !entry.alive)
      .sort((left, right) => (right.updatedAt || 0) - (left.updatedAt || 0));
    for (const entry of inactive.slice(maxInactive)) {
      map.delete(entry.id || entry.name);
    }
  };
  trimMap(BACKGROUND_PROCESSES, 24);
  trimMap(TERMINAL_SESSIONS, 16);
}

function appendLimited(target, field, chunk, maxLength, keepLength) {
  target[field] += decodeChunk(chunk);
  if (target[field].length > maxLength) {
    target[field] = target[field].slice(-keepLength);
  }
}

function stripAnsi(text) {
  return String(text || "")
    // OSC title/control sequences, e.g. ESC ] 0;title BEL.
    .replace(/\x1B\][^\x07]*(?:\x07|\x1B\\)/g, "")
    // DCS/PM/APC strings.
    .replace(/\x1B[P^_][\s\S]*?(?:\x1B\\|\x07)/g, "")
    // CSI sequences, including Windows Terminal private modes such as ESC[?9001h.
    .replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, "")
    // One-byte ESC commands.
    .replace(/\x1B[@-Z\\-_]/g, "")
    // Keep tabs/newlines, remove remaining non-printable control chars.
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "");
}

function detectShellPrompt(session) {
  const tail = stripAnsi(session?.stdout || "")
    .slice(-2400)
    .replace(/\r/g, "");
  const lines = tail.split("\n").filter((line) => line.trim());
  const lastLine = lines.at(-1) || "";
  if (session?.shell === "powershell") {
    return /^PS\s+.+>\s*$/.test(lastLine);
  }
  if (session?.shell === "cmd") {
    return /^[A-Za-z]:\\.*>\s*$/.test(lastLine);
  }
  return /(?:[$#>])\s*$/.test(lastLine);
}

function updateTerminalPromptState(session, now = Date.now()) {
  if (!session) {
    return "closed";
  }
  const lastOutputAt = session.lastOutputAt || session.updatedAt || session.startedAt || now;
  session.outputIdleMs = Math.max(0, now - lastOutputAt);
  if (!session.alive) {
    session.promptState = "closed";
    return session.promptState;
  }
  if (session.currentCommand) {
    if (session.currentCommandStallAfterMs && session.outputIdleMs >= session.currentCommandStallAfterMs) {
      session.promptState = "stalled";
      session.stalledAt ||= now;
      session.stallReason ||= `sem saida ha ${Math.round(session.outputIdleMs / 1000)}s`;
      return session.promptState;
    }
    session.promptState = "running";
    return session.promptState;
  }
  session.stalledAt = null;
  session.stallReason = "";
  session.promptState = detectShellPrompt(session) ? "idle" : "idle";
  return session.promptState;
}

function recordTerminalOutput(session, field, chunk) {
  appendLimited(session, field, chunk, field === "stderr" ? 120000 : 200000, field === "stderr" ? 80000 : 120000);
  const now = Date.now();
  session.lastOutputAt = now;
  session.updatedAt = now;
  updateTerminalPromptState(session, now);
}

function recordJobOutput(job, field, chunk) {
  appendLimited(job, field, chunk, field === "stderr" ? 120000 : 200000, field === "stderr" ? 80000 : 120000);
  const now = Date.now();
  job.lastOutputAt = now;
  job.outputIdleMs = 0;
  job.updatedAt = now;
}

function updateJobRuntime(job, now = Date.now()) {
  if (!job) {
    return null;
  }
  job.runtimeMs = Math.max(0, now - (job.startedAt || now));
  job.outputIdleMs = Math.max(0, now - (job.lastOutputAt || job.startedAt || now));
  return job;
}

async function openTerminalSession(action, workspaceRoot = process.cwd(), context = {}) {
  const sessionName = normalizeSessionName(action?.session);
  const existing = TERMINAL_SESSIONS.get(sessionName);
  if (existing?.alive) {
    const meta = runtimeContextMeta(context);
    if (action?.taskId) {
      existing.taskId = String(action.taskId);
    }
    existing.lastChatId = meta.chatId || existing.lastChatId || null;
    existing.lastRunId = meta.runId || existing.lastRunId || null;
    existing.updatedAt = Date.now();
    return `Sessao de terminal pronta: ${sessionName} (${existing.shell}) em ${existing.cwd}`;
  }

  trimInactiveActivityMaps();
  const aliveSessions = [...TERMINAL_SESSIONS.values()].filter((session) => session.alive);
  if (aliveSessions.length >= MAX_TERMINAL_SESSIONS) {
    throw new Error(
      `Limite de sessoes de terminal atingido (${MAX_TERMINAL_SESSIONS}). Feche uma sessao antiga ou use stop_all_local_activity antes de abrir outra.`
    );
  }

  const shellConfig = getTerminalShell(action?.shell);
  const cwd = action?.cwd ? expandPathInput(action.cwd, workspaceRoot) : workspaceRoot;
  assertNoNativeWindowsPosix({
    script: String(action?.initialCommand || ""),
    cwd,
    shell: shellConfig.shell
  });
  await fs.mkdir(cwd, { recursive: true });
  const meta = runtimeContextMeta(context);
  let child = null;
  let ptyProcess = null;
  let transport = "spawn";
  let ptyFallbackReason = "";

  if (nodePty && !action?.forceSpawn) {
    try {
      ptyProcess = nodePty.spawn(shellConfig.command, shellConfig.args, {
        cwd,
        cols: clampNumber(action?.cols, 40, 240, 120),
        rows: clampNumber(action?.rows, 12, 80, 30),
        env: process.env,
        name: "xterm-256color"
      });
      transport = "pty";
    } catch (error) {
      ptyFallbackReason = error.message || "node-pty falhou ao abrir.";
      ptyProcess = null;
      transport = "spawn";
    }
  } else {
    ptyFallbackReason = "node-pty nao esta instalado; usando terminal spawn.";
  }

  if (!ptyProcess) {
    child = spawn(shellConfig.command, shellConfig.args, {
      cwd,
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"]
    });
    child.stdin.setDefaultEncoding("utf8");
  }

  const session = {
    name: sessionName,
    shell: shellConfig.shell,
    cwd,
    child,
    ptyProcess,
    transport,
    ptyAvailable: Boolean(nodePty),
    ptyFallbackReason,
    alive: true,
    stdout: "",
    stderr: "",
    queue: Promise.resolve(),
    sequence: 0,
    promptState: "opening",
    startedAt: Date.now(),
    lastOutputAt: null,
    outputIdleMs: 0,
    currentCommand: null,
    currentCommandStartedAt: null,
    currentCommandTimeoutMs: null,
    currentCommandStallAfterMs: null,
    stalledAt: null,
    stallReason: "",
    lastMarker: "",
    lastExitCode: null,
    history: [],
    updatedAt: Date.now(),
    startError: "",
    closeCode: null,
    chatId: meta.chatId,
    runId: meta.runId,
    currentChatId: null,
    currentRunId: null,
    lastChatId: meta.chatId,
    lastRunId: meta.runId,
    actionKey: meta.actionKey,
    stopReason: "",
    stoppedAt: null,
    killResult: null
  };
  if (action?.taskId) {
    session.taskId = String(action.taskId);
  }
  const markLinkedTaskClosed = (reason) => {
    if (!session.taskId || typeof context.runtime?.getTaskRecord !== "function") {
      return;
    }
    const task = context.runtime.getTaskRecord(session.taskId);
    if (!task || !["in_progress", "creating_pr"].includes(String(task.status || ""))) {
      return;
    }
    context.runtime.transitionTaskRecord?.(session.taskId, "PROCESS_EXITED", {
      message: `Terminal ${session.name} encerrou: ${reason}`,
      detail: reason,
      terminalSessionId: session.name
    });
  };

  if (transport === "pty") {
    ptyProcess.onData((chunk) => {
      recordTerminalOutput(session, "stdout", chunk);
    });
    ptyProcess.onExit((event) => {
      session.alive = false;
      session.promptState = "closed";
      session.closeCode = Number.isFinite(Number(event?.exitCode)) ? Number(event.exitCode) : null;
      session.updatedAt = Date.now();
      markLinkedTaskClosed(`exit ${session.closeCode ?? "unknown"}`);
    });
  } else {
    child.stdout?.on("data", (chunk) => {
      recordTerminalOutput(session, "stdout", chunk);
    });
    child.stderr?.on("data", (chunk) => {
      recordTerminalOutput(session, "stderr", chunk);
    });
    child.once("close", (code) => {
      session.alive = false;
      session.promptState = "closed";
      session.closeCode = Number.isFinite(Number(code)) ? Number(code) : null;
      session.updatedAt = Date.now();
      markLinkedTaskClosed(`exit ${session.closeCode ?? "unknown"}`);
    });
    child.once("error", (error) => {
      session.alive = false;
      session.promptState = "closed";
      session.startError = String(error?.message || "Falha ao abrir o shell.");
      session.updatedAt = Date.now();
      markLinkedTaskClosed(session.startError);
    });
  }

  TERMINAL_SESSIONS.set(sessionName, session);

  await new Promise((resolve) => setTimeout(resolve, 120));
  if (!session.alive || (child && child.killed)) {
    TERMINAL_SESSIONS.delete(sessionName);
    const reason =
      session.startError ||
      (session.closeCode !== null
        ? `O shell encerrou imediatamente com codigo ${session.closeCode}.`
        : "O shell encerrou imediatamente ao abrir.");
    throw new Error(`Nao consegui abrir a sessao de terminal ${sessionName} em ${cwd}. ${reason}`);
  }

  trimInactiveActivityMaps();
  updateTerminalPromptState(session);
  const initialCommand = action?.hermesCli
    ? buildHermesCliCommand(shellConfig.shell, action)
    : String(action?.initialCommand || "").trim();
  if (initialCommand) {
    writeTerminalInput(session, `${initialCommand}\r\n`);
    session.promptState = "running";
    session.lastOutputAt = Date.now();
    session.updatedAt = Date.now();
    if (action?.hermesCli) {
      session.currentCommand = "Hermes Agent CLI";
      session.currentCommandStartedAt = Date.now();
      session.currentCommandTimeoutMs = null;
      session.currentCommandStallAfterMs = null;
    }
  }
  const modeSuffix =
    transport === "pty" ? " via PTY" : ptyFallbackReason ? ` via spawn (${ptyFallbackReason})` : " via spawn";
  return `Sessao de terminal aberta: ${sessionName} (${shellConfig.shell}${modeSuffix}) em ${cwd}${action?.hermesCli ? " com Hermes Agent CLI" : ""}`;
}

async function markTerminalCommandStopped(session, reason, killOnTimeout = true) {
  session.stopReason = reason;
  session.stoppedAt = Date.now();
  session.promptState = "stalled";
  session.stallReason = reason;
  session.updatedAt = Date.now();
  if (killOnTimeout) {
    await terminateTerminalProcess(session, reason);
  }
  session.updatedAt = Date.now();
}

function formatTerminalTimeoutError(session, effectiveTimeoutMs, stdoutStart, stderrStart) {
  const stdoutText = stripAnsi(session.stdout.slice(stdoutStart)).trim();
  const stderrText = stripAnsi(session.stderr.slice(stderrStart)).trim();
  const lines = [
    `A sessao de terminal excedeu ${Math.round(effectiveTimeoutMs / 1000)}s sem concluir o comando.`,
    `Estado: ${session.promptState || "desconhecido"}`,
    session.outputIdleMs ? `Sem nova saida ha ${Math.round(session.outputIdleMs / 1000)}s.` : null,
    session.killResult ? `Kill tree: ${session.killResult.ok ? "ok" : "falhou/nao necessario"} ${session.killResult.method || ""}` : null,
    stdoutText ? `STDOUT parcial:\n${truncateText(stdoutText, 3000)}` : null,
    stderrText ? `STDERR parcial:\n${truncateText(stderrText, 1800)}` : null
  ].filter(Boolean);
  return lines.join("\n");
}

async function execInTerminalSession(session, command, options = {}, signal = null) {
  ensureTerminalSessionAlive(session);
  const normalizedOptions =
    options && typeof options === "object" && !Array.isArray(options) ? options : { timeoutMs: options };
  const shellConfig = getTerminalShell(session.shell);
  const markerId = `${session.name}-${Date.now()}-${session.sequence += 1}`;
  const markerPrefix = `__DREAM_DONE_${markerId}__`;
  const markerCommand = shellConfig.marker(markerId);
  const stdoutStart = session.stdout.length;
  const stderrStart = session.stderr.length;
  const effectiveTimeoutMs = clampNumber(normalizedOptions?.timeoutMs, 1000, 300000, 120000);
  const defaultStallAfterMs = Math.min(30000, Math.max(5000, Math.floor(effectiveTimeoutMs / 3)));
  const stallAfterMs = clampNumber(normalizedOptions?.stallAfterMs, 1000, effectiveTimeoutMs, defaultStallAfterMs);
  const killOnTimeout = normalizedOptions?.killOnTimeout !== false;
  session.currentCommandTimeoutMs = effectiveTimeoutMs;
  session.currentCommandStallAfterMs = stallAfterMs;
  session.lastMarker = markerPrefix;
  session.promptState = "running";
  session.stalledAt = null;
  session.stallReason = "";
  session.lastOutputAt = Date.now();
  session.outputIdleMs = 0;

  writeTerminalInput(session, `${String(command || "").trim()}\r\n${markerCommand}\r\n`);

  const startedAt = Date.now();
  while (Date.now() - startedAt < effectiveTimeoutMs) {
    if (signal?.aborted) {
      await markTerminalCommandStopped(session, "interrompido pelo usuario", true);
      throw new Error("A execucao foi interrompida pelo usuario.");
    }
    ensureTerminalSessionAlive(session);
    updateTerminalPromptState(session);
    const newStdout = session.stdout.slice(stdoutStart);
    const markerMatches = [...newStdout.matchAll(new RegExp(`${escapeRegex(markerPrefix)}:(-?\\d*)(?=\\r?\\n|$)`, "g"))];
    if (markerMatches.length) {
      const markerMatch = markerMatches.at(-1);
      const markerIndex = markerMatch.index;
      const markerLine = markerMatch[0] || markerPrefix;
      const exitCode = shellConfig.parseExitCode(markerLine);
      const stdoutText = stripAnsi(newStdout.slice(0, markerIndex)).trim();
      const stderrText = stripAnsi(session.stderr.slice(stderrStart)).trim();
      session.promptState = "idle";
      session.stalledAt = null;
      session.stallReason = "";
      session.outputIdleMs = 0;
      return {
        code: Number.isFinite(exitCode) ? exitCode : 0,
        stdout: stdoutText,
        stderr: stderrText,
        durationMs: Date.now() - startedAt,
        marker: markerPrefix
      };
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }

  updateTerminalPromptState(session);
  await markTerminalCommandStopped(session, "timeout de comando", killOnTimeout);
  throw new Error(formatTerminalTimeoutError(session, effectiveTimeoutMs, stdoutStart, stderrStart));
}

async function terminalExecAction(action, workspaceRoot = process.cwd(), signal = null, context = {}) {
  const sessionName = normalizeSessionName(action?.session);
  let session = TERMINAL_SESSIONS.get(sessionName);
  if (!session?.alive) {
    await openTerminalSession(
      {
        session: sessionName,
        shell: action?.shell,
        cwd: action?.cwd,
        taskId: action?.taskId
      },
      workspaceRoot,
      context
    );
    session = TERMINAL_SESSIONS.get(sessionName);
  }

  const command = String(action?.command || "").trim();
  if (!command) {
    throw new Error("terminal_exec exige um comando.");
  }
  assertNoNativeWindowsPosix({
    script: command,
    cwd: session.cwd,
    shell: session.shell
  });

  const run = async () => {
    const meta = runtimeContextMeta(context);
    const startedAt = Date.now();
    session.lastChatId = meta.chatId || session.lastChatId || null;
    session.lastRunId = meta.runId || session.lastRunId || null;
    session.currentChatId = meta.chatId || null;
    session.currentRunId = meta.runId || null;
    session.currentCommand = command;
    session.currentCommandStartedAt = Date.now();
    if (action?.taskId) {
      session.taskId = String(action.taskId);
      context.runtime?.markTaskActivity?.(action.taskId, `terminal_exec: ${command}`, "coding", "tool_start", {
        terminalSessionId: session.name,
        tool: "terminal_exec"
      });
    }
    session.promptState = "running";
    session.stalledAt = null;
    session.stallReason = "";
    session.updatedAt = Date.now();
    try {
      const result = await execInTerminalSession(
        session,
        command,
        {
          timeoutMs: action?.timeoutMs,
          stallAfterMs: action?.stallAfterMs,
          killOnTimeout: action?.killOnTimeout
        },
        signal
      );
      session.lastExitCode = result.code;
      session.history.push({
        at: Date.now(),
        command,
        code: result.code,
        durationMs: result.durationMs || Date.now() - startedAt,
        stdout: truncateText(result.stdout || "", 1800),
        stderr: truncateText(result.stderr || "", 1200)
      });
      if (session.history.length > 16) {
        session.history = session.history.slice(-16);
      }
      assertAllowedCommandExit(action, `Terminal ${session.name}`, session.shell, result);
      if (action?.taskId) {
        context.runtime?.markTaskActivity?.(action.taskId, `terminal_exec concluido (${result.code})`, "coding", "tool_end", {
          terminalSessionId: session.name,
          tool: "terminal_exec",
          detail: [result.stdout, result.stderr].filter(Boolean).join("\n")
        });
      }
      return formatCommandResult(`Terminal ${session.name}`, session.shell, result);
    } catch (error) {
      if (action?.taskId) {
        context.runtime?.markTaskActivity?.(action.taskId, error?.message || "terminal_exec falhou", "coding", "error", {
          terminalSessionId: session.name,
          tool: "terminal_exec"
        });
      }
      session.history.push({
        at: Date.now(),
        command,
        code: null,
        durationMs: Date.now() - startedAt,
        stdout: "",
        stderr: truncateText(error?.message || "Falha ao executar comando.", 1600)
      });
      if (session.history.length > 16) {
        session.history = session.history.slice(-16);
      }
      throw error;
    } finally {
      session.currentCommand = null;
      session.currentCommandStartedAt = null;
      session.currentCommandTimeoutMs = null;
      session.currentCommandStallAfterMs = null;
      session.currentChatId = null;
      session.currentRunId = null;
      updateTerminalPromptState(session);
      session.updatedAt = Date.now();
    }
  };

  session.queue = session.queue.then(run, run);
  return await session.queue;
}

async function terminalCloseAction(action) {
  const sessionName = normalizeSessionName(action?.session);
  const session = TERMINAL_SESSIONS.get(sessionName);
  if (!session) {
    return `Sessao de terminal ja estava fechada: ${sessionName}`;
  }

  await terminateTerminalProcess(session, String(action?.reason || "manual"));
  trimInactiveActivityMaps();
  return `Sessao de terminal fechada: ${sessionName}. Kill tree: ${session.killResult?.ok ? "ok" : "falhou/nao necessario"}`;
}

async function gatewayControlAction(action, context = {}) {
  const command = String(action?.command || action?.operation || "status").trim().toLowerCase();
  if (![
    "start",
    "stop",
    "restart",
    "status",
    "configure",
    "configure_secret",
    "set_secret",
    "capabilities",
    "identity",
    "groups",
    "guilds",
    "channels",
    "chats",
    "recent_messages",
    "pairing_status",
    "approve_pairing",
    "revoke_pairing",
    "clear_pairing",
    "chat",
    "send",
    "edit",
    "send_media",
    "typing"
  ].includes(command)) {
    throw new Error(`Comando de gateway invalido: ${command || "(vazio)"}.`);
  }
  const platform = String(action?.platform || action?.gateway || "").trim().toLowerCase();
  const handler = context.gatewayRuntime?.handleAction || context.gatewayRuntime?.handleChatRequest;
  if (typeof handler !== "function") {
    throw new Error("Gateway runtime indisponivel nesta superficie. Use o bridge desktop ativo do Dream Server.");
  }
  const result = await handler({ ...action, command, platform, timeoutMs: action?.timeoutMs });
  if (typeof result?.formatted === "string" && result.formatted.trim()) {
    return result.formatted;
  }
  const { formatGatewayChatResponse } = require("./hermes/gateway-chat");
  return formatGatewayChatResponse(result);
}

async function createBackgroundRunner(action, workspaceRoot) {
  const runner = String(action?.runner || "process").trim().toLowerCase();
  const cwd = action?.cwd ? expandPathInput(action.cwd, workspaceRoot) : workspaceRoot;
  if (runner === "powershell") {
    const script = String(action?.command || "");
    assertNoNativeWindowsPosix({ script, cwd, shell: "powershell" });
    return {
      runner,
      command: "powershell.exe",
      args: ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", wrapPowerShellScript(script)],
      cwd,
      shell: false
    };
  }
  if (runner === "cmd") {
    const script = String(action?.command || "");
    assertNoNativeWindowsPosix({ script, cwd, shell: "cmd" });
    return {
      runner,
      command: "cmd.exe",
      args: ["/d", "/s", "/c", script],
      cwd,
      shell: false
    };
  }

  const rawCommand = String(action?.command || "").trim();
  const safeArgs = sanitizeArgs(action?.args);
  let resolvedCommand = normalizeNativeWindowsProcessCommand(rawCommand);
  assertNoNativeWindowsPosix({
    command: resolvedCommand,
    args: safeArgs,
    cwd,
    shell: Boolean(action?.shell) ? "shell" : "process"
  });
  const resolvedWithWhere = await resolveCommandWithWhere(resolvedCommand, cwd).catch(() => null);
  if (resolvedWithWhere) {
    resolvedCommand = resolvedWithWhere;
  }

  const resolvedExt = path.extname(String(resolvedCommand || "")).toLowerCase();
  if ([".cmd", ".bat"].includes(resolvedExt)) {
    return {
      runner: "cmd",
      command: "cmd.exe",
      args: ["/d", "/c", "call", resolvedCommand, ...safeArgs],
      cwd,
      shell: false
    };
  }

  return {
    runner,
    command: resolvedCommand,
    args: safeArgs,
    cwd,
    shell: Boolean(action?.shell)
  };
}

function backgroundProcessSnapshot(job) {
  updateJobRuntime(job);
  return {
    id: job.id,
    runner: job.runner,
    command: job.command,
    args: [...job.args],
    cwd: job.cwd,
    shell: Boolean(job.shell),
    pid: job.child?.pid || null,
    status: job.status,
    startedAt: job.startedAt,
    runtimeMs: job.runtimeMs || 0,
    lastOutputAt: job.lastOutputAt || null,
    outputIdleMs: job.outputIdleMs || 0,
    readiness: job.readiness || "",
    stoppedAt: job.stoppedAt || null,
    updatedAt: job.updatedAt,
    exitCode: job.exitCode,
    chatId: job.chatId || null,
    runId: job.runId || null,
    actionKey: job.actionKey || null,
    stopReason: job.stopReason || "",
    killResult: job.killResult || null,
    stdoutTail: truncateText(stripAnsi(job.stdout || ""), 4000),
    stderrTail: truncateText(stripAnsi(job.stderr || ""), 3000)
  };
}

async function backgroundCommandStart(action, workspaceRoot = process.cwd(), context = {}) {
  const jobName = normalizeJobName(action?.job || action?.command);
  const existing = BACKGROUND_PROCESSES.get(jobName);
  if (existing && existing.status === "running") {
    return `Processo em background ja esta rodando: ${jobName} (pid ${existing.child?.pid || "?"}).`;
  }

  const runningJobs = [...BACKGROUND_PROCESSES.values()].filter((job) => job.status === "running");
  if (runningJobs.length >= MAX_BACKGROUND_PROCESSES) {
    throw new Error(
      `Limite de processos em background atingido (${MAX_BACKGROUND_PROCESSES}). Pare jobs antigos antes de iniciar outro.`
    );
  }

  const runner = await createBackgroundRunner(action, workspaceRoot);
  if (!runner.command) {
    throw new Error("background_command_start exige um comando.");
  }
  const meta = runtimeContextMeta(context);

  const child = spawn(runner.command, runner.args, {
    cwd: runner.cwd,
    shell: runner.shell,
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"]
  });

  const job = {
    id: jobName,
    runner: runner.runner,
    command: runner.command,
    args: runner.args,
    cwd: runner.cwd,
    shell: runner.shell,
    child,
    stdout: "",
    stderr: "",
    status: "running",
    startedAt: Date.now(),
    runtimeMs: 0,
    lastOutputAt: null,
    outputIdleMs: 0,
    readiness: "starting",
    updatedAt: Date.now(),
    exitCode: null,
    chatId: meta.chatId,
    runId: meta.runId,
    actionKey: meta.actionKey,
    currentChatId: meta.chatId,
    currentRunId: meta.runId,
    lastChatId: meta.chatId,
    lastRunId: meta.runId,
    stopReason: "",
    stoppedAt: null,
    killResult: null
  };

  child.stdout?.on("data", (chunk) => {
    recordJobOutput(job, "stdout", chunk);
  });
  child.stderr?.on("data", (chunk) => {
    recordJobOutput(job, "stderr", chunk);
  });
  child.once("close", (code) => {
    if (job.status === "running") {
      job.status = "exited";
    }
    job.exitCode = Number.isFinite(Number(code)) ? Number(code) : 0;
    job.readiness = Number(job.exitCode) === 0 ? "exited" : "failed";
    updateJobRuntime(job);
    job.currentChatId = null;
    job.currentRunId = null;
    job.updatedAt = Date.now();
  });
  child.once("error", (error) => {
    job.status = "error";
    job.readiness = "failed";
    job.stderr += `\n${error.message}`;
    updateJobRuntime(job);
    job.currentChatId = null;
    job.currentRunId = null;
    job.updatedAt = Date.now();
  });

  BACKGROUND_PROCESSES.set(jobName, job);
  await new Promise((resolve) => setTimeout(resolve, 180));
  if (job.status === "error" || (!child.pid && job.stderr.trim())) {
    throw new Error(
      [
        `Falha ao iniciar processo em background: ${jobName}.`,
        `Command: ${runner.command} ${runner.args.join(" ")}`.trim(),
        job.stderr.trim() ? `STDERR:\n${truncateText(job.stderr, 3000)}` : null
      ].filter(Boolean).join("\n")
    );
  }
  trimInactiveActivityMaps();
  return `Processo em background iniciado: ${jobName} (pid ${child.pid || "?"}).`;
}

async function probeUrlReady(url, timeoutMs = 2500, signal = null) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const abort = () => controller.abort();
  if (signal?.aborted) {
    abort();
  } else if (signal) {
    signal.addEventListener("abort", abort, { once: true });
  }

  try {
    const response = await fetch(url, {
      method: "GET",
      signal: controller.signal
    });
    return response.ok || response.status < 500;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
    if (signal) {
      signal.removeEventListener("abort", abort);
    }
  }
}

async function backgroundCommandLogs(action, signal = null) {
  const jobName = normalizeJobName(action?.job);
  const job = BACKGROUND_PROCESSES.get(jobName);
  if (!job) {
    throw new Error(`Processo em background nao encontrado: ${jobName}`);
  }

  const waitFor = String(action?.waitFor || "").trim();
  const checkUrl = String(action?.checkUrl || "").trim();
  const failOnPatterns = Array.isArray(action?.failOnPatterns)
    ? action.failOnPatterns.map((entry) => String(entry || "").trim()).filter(Boolean)
    : [];
  const timeoutMs = clampNumber(action?.timeoutMs, 500, 300000, 15000);
  const maxChars = clampNumber(action?.maxChars, 500, 24000, 6000);
  const expectRunning = action?.expectRunning !== false;
  const startedAt = Date.now();
  let matched = !waitFor;

  while (waitFor && Date.now() - startedAt < timeoutMs) {
    if (signal?.aborted) {
      throw new Error("A execucao foi interrompida pelo usuario.");
    }
    updateJobRuntime(job);
    const combined = `${job.stdout}\n${job.stderr}`;
    if (combined.includes(waitFor)) {
      matched = true;
      job.readiness = "ready";
      break;
    }
    if (job.status !== "running") {
      break;
    }
    if (checkUrl) {
      const ready = await probeUrlReady(checkUrl, 1200, signal);
      if (ready) {
        matched = true;
        job.readiness = "ready";
        break;
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 80));
  }

  if (waitFor && !matched) {
    updateJobRuntime(job);
    const combined = `${job.stdout}\n${job.stderr}`.trim();
    if (job.status !== "running") {
      job.readiness = Number(job.exitCode) === 0 ? "exited" : "failed";
      throw new Error(
        [
          `O processo ${jobName} encerrou antes de ficar pronto.`,
          `STATUS: ${job.status}${job.exitCode !== null ? ` (code ${job.exitCode})` : ""}`,
          `Runtime: ${Math.round((job.runtimeMs || 0) / 1000)}s, sem saida ha ${Math.round((job.outputIdleMs || 0) / 1000)}s`,
          combined ? truncateText(combined, maxChars) : "(sem logs relevantes)"
        ].join("\n")
      );
    }
    job.readiness = "waiting";
    throw new Error(
      [
        `O processo ${jobName} nao mostrou o marcador esperado (${waitFor}) nem respondeu em ${Math.round(timeoutMs / 1000)}s.`,
        `Runtime: ${Math.round((job.runtimeMs || 0) / 1000)}s, sem saida ha ${Math.round((job.outputIdleMs || 0) / 1000)}s.`
      ].join("\n")
    );
  }

  if (expectRunning && job.status !== "running") {
    updateJobRuntime(job);
    const combined = `${job.stdout}\n${job.stderr}`.trim();
    const nonZero = job.exitCode === null || Number(job.exitCode) !== 0 || job.status === "error";
    if (nonZero) {
      job.readiness = "failed";
      throw new Error(
        [
          `O processo ${jobName} encerrou antes de permanecer ativo.`,
          `STATUS: ${job.status}${job.exitCode !== null ? ` (code ${job.exitCode})` : ""}`,
          `Runtime: ${Math.round((job.runtimeMs || 0) / 1000)}s, sem saida ha ${Math.round((job.outputIdleMs || 0) / 1000)}s`,
          combined ? truncateText(combined, maxChars) : "(sem logs relevantes)"
        ].join("\n")
      );
    }
  }

  const combinedText = `${job.stdout}\n${job.stderr}`;
  const normalizedCombinedText = combinedText.toLowerCase();
  const matchedFailurePattern = failOnPatterns.find((pattern) => normalizedCombinedText.includes(pattern.toLowerCase()));
  if (matchedFailurePattern) {
    updateJobRuntime(job);
    job.readiness = "failed";
    const details = [`O processo ${jobName} subiu, mas reportou erro de build/execucao (${matchedFailurePattern}).`];
    details.push(`STATUS: ${job.status}${job.exitCode !== null ? ` (code ${job.exitCode})` : ""}`);
    details.push(`Runtime: ${Math.round((job.runtimeMs || 0) / 1000)}s, sem saida ha ${Math.round((job.outputIdleMs || 0) / 1000)}s`);
    if (job.stdout.trim()) {
      details.push(`STDOUT:\n${truncateText(job.stdout, maxChars)}`);
    }
    if (job.stderr.trim()) {
      details.push(`STDERR:\n${truncateText(job.stderr, Math.min(maxChars, 4000))}`);
    }
    throw new Error(details.join("\n"));
  }

  updateJobRuntime(job);
  if (matched) {
    job.readiness = job.status === "running" ? "ready" : job.readiness || "exited";
  }
  const combined = [`STATUS: ${job.status}${job.exitCode !== null ? ` (code ${job.exitCode})` : ""}`];
  combined.push(`Runtime: ${Math.round((job.runtimeMs || 0) / 1000)}s, sem saida ha ${Math.round((job.outputIdleMs || 0) / 1000)}s`);
  if (job.stdout.trim()) {
    combined.push(`STDOUT:\n${truncateText(job.stdout, maxChars)}`);
  }
  if (job.stderr.trim()) {
    combined.push(`STDERR:\n${truncateText(job.stderr, Math.min(maxChars, 4000))}`);
  }
  return combined.join("\n");
}

async function backgroundCommandStop(action) {
  const jobName = normalizeJobName(action?.job);
  const job = BACKGROUND_PROCESSES.get(jobName);
  if (!job) {
    return `Processo em background ja estava ausente: ${jobName}`;
  }

  job.killResult = await killProcessTree(job.child?.pid);
  job.status = "stopped";
  job.readiness = "stopped";
  job.stopReason = String(action?.reason || "manual");
  job.stoppedAt = Date.now();
  updateJobRuntime(job);
  job.currentChatId = null;
  job.currentRunId = null;
  job.updatedAt = Date.now();
  trimInactiveActivityMaps();
  return `Processo em background encerrado: ${jobName}. Kill tree: ${job.killResult?.ok ? "ok" : "falhou/nao necessario"}`;
}

async function killProcessTree(pid) {
  const numericPid = Number(pid);
  if (!Number.isFinite(numericPid) || numericPid <= 0) {
    return {
      ok: false,
      pid: null,
      method: "none",
      reason: "pid ausente"
    };
  }

  if (process.platform === "win32") {
    const result = await runProcess("taskkill.exe", ["/PID", String(numericPid), "/T", "/F"], {
      timeoutMs: 15000,
      killTree: false
    }).catch(() => null);
    return {
      ok: Boolean(result && Number(result.code || 0) === 0),
      pid: numericPid,
      method: "taskkill",
      code: result ? Number(result.code || 0) : null,
      stdout: truncateText(result?.stdout || "", 1200),
      stderr: truncateText(result?.stderr || "", 1200)
    };
  }

  try {
    process.kill(-numericPid, "SIGTERM");
    return {
      ok: true,
      pid: numericPid,
      method: "sigterm-group"
    };
  } catch {
    try {
      process.kill(numericPid, "SIGTERM");
      return {
        ok: true,
        pid: numericPid,
        method: "sigterm"
      };
    } catch {
      return {
        ok: false,
        pid: numericPid,
        method: "sigterm",
        reason: "process.kill falhou"
      };
    }
  }
}

async function stopAllLocalActivityAction() {
  const stoppedJobs = [];
  const closedTerminals = [];

  for (const job of [...BACKGROUND_PROCESSES.values()]) {
    job.killResult = await killProcessTree(job.child?.pid);
    job.status = "stopped";
    job.readiness = "stopped";
    job.stopReason = "stop_all";
    job.stoppedAt = Date.now();
    updateJobRuntime(job);
    job.currentChatId = null;
    job.currentRunId = null;
    job.updatedAt = Date.now();
    stoppedJobs.push(job.id);
  }

  for (const session of [...TERMINAL_SESSIONS.values()]) {
    await terminateTerminalProcess(session, "stop_all");
    closedTerminals.push(session.name);
  }

  trimInactiveActivityMaps();
  return [
    "Atividade local interrompida.",
    `Jobs parados: ${stoppedJobs.length ? stoppedJobs.join(", ") : "(nenhum)"}`,
    `Terminais fechados: ${closedTerminals.length ? closedTerminals.join(", ") : "(nenhum)"}`
  ].join("\n");
}

async function stopLocalActivityForChat(chatId, reason = "chat_stopped") {
  const stoppedJobs = [];
  const closedTerminals = [];

  for (const job of [...BACKGROUND_PROCESSES.values()]) {
    if (job.status === "running" && jobOwnerMatches(job, chatId)) {
      job.killResult = await killProcessTree(job.child?.pid);
      job.status = "stopped";
      job.readiness = "stopped";
      job.stopReason = reason;
      job.stoppedAt = Date.now();
      updateJobRuntime(job);
      job.currentChatId = null;
      job.currentRunId = null;
      job.updatedAt = Date.now();
      stoppedJobs.push(job.id);
    }
  }

  for (const session of [...TERMINAL_SESSIONS.values()]) {
    if (session.alive && terminalOwnerMatches(session, chatId)) {
      await terminateTerminalProcess(session, reason);
      closedTerminals.push(session.name);
    }
  }

  trimInactiveActivityMaps();
  return {
    stoppedJobs,
    closedTerminals,
    summary: [
      `Atividade local do chat interrompida: ${chatId}`,
      `Jobs parados: ${stoppedJobs.length ? stoppedJobs.join(", ") : "(nenhum)"}`,
      `Terminais fechados: ${closedTerminals.length ? closedTerminals.join(", ") : "(nenhum)"}`
    ].join("\n")
  };
}

async function mcpListToolsAction(action, context = {}) {
  const server = String(action?.server || "").trim();
  if (!server) {
    throw new Error("mcp_list_tools exige o nome de um servidor.");
  }
  if (!context.mcpManager) {
    throw new Error("MCP nao esta inicializado neste runtime.");
  }
  const tools = await context.mcpManager.listTools(server);
  return tools.length
    ? `Tools do servidor MCP ${server}:\n${tools
        .map((tool) => `- ${tool.name}: ${tool.description || "sem descricao"}`)
        .join("\n")}`
    : `O servidor MCP ${server} nao retornou tools.`;
}

function normalizeMcpResult(result) {
  if (!result) {
    return "(sem resultado)";
  }
  if (Array.isArray(result.content)) {
    return result.content
      .map((item) => {
        if (item?.type === "text") {
          return item.text || "";
        }
        return JSON.stringify(item);
      })
      .join("\n");
  }
  return typeof result === "string" ? result : JSON.stringify(result, null, 2);
}

async function mcpCallAction(action, context = {}) {
  const server = String(action?.server || "").trim();
  const tool = String(action?.tool || "").trim();
  if (!server || !tool) {
    throw new Error("mcp_call exige server e tool.");
  }
  if (!context.mcpManager) {
    throw new Error("MCP nao esta inicializado neste runtime.");
  }
  const result = await context.mcpManager.callTool(server, tool, action?.arguments || {});
  return `Resultado MCP ${server}:${tool}\n${truncateText(normalizeMcpResult(result), 12000)}`;
}

function buildMobileToolArgs(serial, args = []) {
  const safeArgs = sanitizeArgs(args);
  return serial ? ["-s", String(serial), ...safeArgs] : safeArgs;
}

async function adbCommandAction(action, workspaceRoot = process.cwd(), signal = null) {
  const wait = action?.wait !== false;
  const timeoutMs = clampNumber(action?.timeoutMs, 1000, 300000, 120000);
  const args = buildMobileToolArgs(action?.serial, action?.args);
  if (!args.length) {
    throw new Error("adb_command exige ao menos um argumento.");
  }

  if (!wait) {
    await launchDetached("adb", args, { cwd: workspaceRoot, windowsHide: true });
    return `ADB iniciado: ${args.join(" ")}`;
  }

  const result = await runProcess("adb", args, { cwd: workspaceRoot, timeoutMs, signal });
  return formatCommandResult("ADB", "process", result);
}

function getTerminalSessionSnapshots() {
  return [...TERMINAL_SESSIONS.values()]
    .map((session) => {
      updateTerminalPromptState(session);
      return {
        id: session.name,
        shell: session.shell,
        cwd: session.cwd,
        transport: session.transport || "spawn",
        ptyAvailable: Boolean(session.ptyAvailable),
        ptyFallbackReason: session.ptyFallbackReason || "",
        pid: terminalPid(session) || null,
        alive: Boolean(session.alive),
        promptState: session.promptState || (session.alive ? "idle" : "closed"),
        startedAt: session.startedAt || null,
        lastOutputAt: session.lastOutputAt || null,
        outputIdleMs: session.outputIdleMs || 0,
        updatedAt: session.updatedAt || Date.now(),
        chatId: session.chatId || null,
        runId: session.runId || null,
        currentChatId: session.currentChatId || null,
        currentRunId: session.currentRunId || null,
        stopReason: session.stopReason || "",
        stoppedAt: session.stoppedAt || null,
        closeCode: Number.isFinite(session.closeCode) ? session.closeCode : null,
        killResult: session.killResult || null,
        taskId: session.taskId || null,
        currentCommand: session.currentCommand || null,
        currentCommandStartedAt: session.currentCommandStartedAt || null,
        currentCommandTimeoutMs: session.currentCommandTimeoutMs || null,
        currentCommandStallAfterMs: session.currentCommandStallAfterMs || null,
        stalledAt: session.stalledAt || null,
        stallReason: session.stallReason || "",
        lastMarker: session.lastMarker || "",
        lastExitCode: Number.isFinite(session.lastExitCode) ? session.lastExitCode : null,
        history: Array.isArray(session.history)
          ? session.history.slice(-8).map((entry) => ({
              ...entry,
              stdout: stripAnsi(entry.stdout || ""),
              stderr: stripAnsi(entry.stderr || "")
            }))
          : [],
        stdoutTail: truncateText(stripAnsi(session.stdout || ""), 5000),
        stderrTail: truncateText(stripAnsi(session.stderr || ""), 3000)
      };
    })
    .sort((left, right) => right.updatedAt - left.updatedAt);
}

function getBackgroundProcessSnapshots() {
  return [...BACKGROUND_PROCESSES.values()]
    .map(backgroundProcessSnapshot)
    .sort((left, right) => right.updatedAt - left.updatedAt);
}

async function adbShellAction(action, workspaceRoot = process.cwd(), signal = null) {
  const command = String(action?.command || "").trim();
  if (!command) {
    throw new Error("adb_shell exige um comando.");
  }

  const shellCommand = action?.asRoot
    ? ["shell", "su", "-c", command]
    : ["shell", command];
  return await adbCommandAction(
    {
      serial: action?.serial,
      args: shellCommand,
      timeoutMs: action?.timeoutMs,
      wait: true
    },
    workspaceRoot,
    signal
  );
}

async function fastbootCommandAction(action, workspaceRoot = process.cwd(), signal = null) {
  const args = sanitizeArgs(action?.args);
  if (!args.length) {
    throw new Error("fastboot_command exige ao menos um argumento.");
  }

  const timeoutMs = clampNumber(action?.timeoutMs, 1000, 300000, 120000);
  const result = await runProcess("fastboot", args, { cwd: workspaceRoot, timeoutMs, signal });
  return formatCommandResult("Fastboot", "process", result);
}

function buildVolumePowerShellScript(action) {
  const hasLevel = Number.isFinite(Number(action?.level));
  const hasDelta = Number.isFinite(Number(action?.delta));
  const hasMuted = typeof action?.muted === "boolean";

  if (!hasLevel && !hasDelta && !hasMuted) {
    throw new Error("set_volume exige level, delta ou muted.");
  }

  const targetLevel = hasLevel ? clampNumber(action.level, 0, 100, 50) : null;
  const delta = hasDelta ? clampNumber(action.delta, -100, 100, 0) : 0;
  const muted = hasMuted ? Boolean(action.muted) : null;

  return `
if (-not ("DreamServerAudio.EndpointVolume" -as [type])) {
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
namespace DreamServerAudio {
  [Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IMMDeviceEnumerator {
    int EnumAudioEndpoints(int dataFlow, int dwStateMask, IntPtr devices);
    int GetDefaultAudioEndpoint(int dataFlow, int role, out IMMDevice device);
  }
  [Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IMMDevice {
    int Activate(ref Guid iid, int dwClsCtx, IntPtr activationParams, [MarshalAs(UnmanagedType.Interface)] out IAudioEndpointVolume endpointVolume);
  }
  [Guid("5CDF2C82-841E-4546-9722-0CF74078229A"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IAudioEndpointVolume {
    int RegisterControlChangeNotify(IntPtr notify);
    int UnregisterControlChangeNotify(IntPtr notify);
    int GetChannelCount(out uint channelCount);
    int SetMasterVolumeLevel(float levelDB, Guid eventContext);
    int SetMasterVolumeLevelScalar(float level, Guid eventContext);
    int GetMasterVolumeLevel(out float levelDB);
    int GetMasterVolumeLevelScalar(out float level);
    int SetChannelVolumeLevel(uint channel, float levelDB, Guid eventContext);
    int SetChannelVolumeLevelScalar(uint channel, float level, Guid eventContext);
    int GetChannelVolumeLevel(uint channel, out float levelDB);
    int GetChannelVolumeLevelScalar(uint channel, out float level);
    int SetMute([MarshalAs(UnmanagedType.Bool)] bool mute, Guid eventContext);
    int GetMute(out bool mute);
    int GetVolumeStepInfo(out uint step, out uint stepCount);
    int VolumeStepUp(Guid eventContext);
    int VolumeStepDown(Guid eventContext);
    int QueryHardwareSupport(out uint hardwareSupportMask);
    int GetVolumeRange(out float volumeMin, out float volumeMax, out float volumeIncrement);
  }
  [ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")]
  class MMDeviceEnumeratorComObject {}
  public static class EndpointVolume {
    static IAudioEndpointVolume GetEndpoint() {
      var enumerator = (IMMDeviceEnumerator)(new MMDeviceEnumeratorComObject());
      IMMDevice device;
      Marshal.ThrowExceptionForHR(enumerator.GetDefaultAudioEndpoint(0, 1, out device));
      var iid = typeof(IAudioEndpointVolume).GUID;
      IAudioEndpointVolume endpoint;
      Marshal.ThrowExceptionForHR(device.Activate(ref iid, 23, IntPtr.Zero, out endpoint));
      return endpoint;
    }
    public static int GetLevel() {
      float level;
      Marshal.ThrowExceptionForHR(GetEndpoint().GetMasterVolumeLevelScalar(out level));
      return (int)Math.Round(level * 100.0f);
    }
    public static void SetLevel(int level) {
      int bounded = Math.Max(0, Math.Min(100, level));
      Marshal.ThrowExceptionForHR(GetEndpoint().SetMasterVolumeLevelScalar(bounded / 100.0f, Guid.Empty));
    }
    public static void SetMute(bool mute) {
      Marshal.ThrowExceptionForHR(GetEndpoint().SetMute(mute, Guid.Empty));
    }
  }
}
"@ -Language CSharp
}
$before = [DreamServerAudio.EndpointVolume]::GetLevel()
$target = $before
${hasLevel ? `$target = ${targetLevel}` : ""}
${hasDelta ? `$target = [Math]::Max(0, [Math]::Min(100, $target + (${delta})))` : ""}
[DreamServerAudio.EndpointVolume]::SetLevel([int]$target)
${hasMuted ? `[DreamServerAudio.EndpointVolume]::SetMute($${muted ? "true" : "false"})` : ""}
$after = [DreamServerAudio.EndpointVolume]::GetLevel()
Write-Output ("Volume atualizado: " + $before + " -> " + $after)
`.trim();
}

async function setVolumeAction(action, workspaceRoot = process.cwd(), signal = null) {
  const script = buildVolumePowerShellScript(action);
  const result = await runProcess(
    "powershell.exe",
    ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", wrapPowerShellScript(script)],
    {
      cwd: workspaceRoot,
      timeoutMs: 30000,
      signal
    }
  );

  if (result.code !== 0) {
    return formatCommandResult("Controle de volume", "powershell", result);
  }

  return truncateText(result.stdout || "Volume ajustado.");
}

function buildMediaControlPowerShellScript(actionName) {
  const normalized = String(actionName || "play_pause")
    .trim()
    .toLowerCase()
    .replace(/[-\s]+/g, "_");
  const commandByAction = {
    play: 46,
    pause: 47,
    play_pause: 14,
    toggle: 14,
    next: 11,
    previous: 12,
    stop: 13
  };
  const command = commandByAction[normalized];
  if (!command) {
    throw new Error(`media_control nao suporta a acao: ${actionName}`);
  }

  return `
if (-not ("DreamServerMedia.Control" -as [type])) {
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
namespace DreamServerMedia {
  public static class Control {
    [DllImport("user32.dll", SetLastError = true)]
    private static extern IntPtr SendMessageW(IntPtr hWnd, int Msg, IntPtr wParam, IntPtr lParam);

    public static void Send(int command) {
      IntPtr HWND_BROADCAST = new IntPtr(0xffff);
      int WM_APPCOMMAND = 0x0319;
      IntPtr lParam = new IntPtr(command << 16);
      SendMessageW(HWND_BROADCAST, WM_APPCOMMAND, IntPtr.Zero, lParam);
    }
  }
}
"@ -Language CSharp
}
[DreamServerMedia.Control]::Send(${command})
Write-Output ("Comando de midia enviado: ${normalized}")
`.trim();
}

async function mediaControlAction(action, workspaceRoot = process.cwd(), signal = null) {
  const script = buildMediaControlPowerShellScript(action?.action);
  const result = await runProcess(
    "powershell.exe",
    ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", wrapPowerShellScript(script)],
    {
      cwd: workspaceRoot,
      timeoutMs: 10000,
      signal
    }
  );

  if (result.code !== 0) {
    return formatCommandResult("Controle de midia", "powershell", result);
  }

  return truncateText(result.stdout || "Comando de midia enviado.");
}

function buildSystemQueryPowerShellScript(kind) {
  const normalizedKind = String(kind || "").trim().toLowerCase();

  if (normalizedKind === "wifi_current_password") {
    return `
$interfaceLines = netsh wlan show interfaces
$ssidLine = $interfaceLines | Where-Object { $_ -match '^\\s*SSID\\s*:\\s*(.+)$' -and $_ -notmatch '^\\s*BSSID\\s*:' } | Select-Object -First 1
if (-not $ssidLine) {
  throw "Nenhuma rede Wi-Fi conectada encontrada."
}
$ssid = [regex]::Match([string]$ssidLine, '^\\s*SSID\\s*:\\s*(.+)$').Groups[1].Value.Trim()
$profileLines = netsh wlan show profile name="$ssid" key=clear
$keyLine = $profileLines | Where-Object {
  $_ -match '^\\s*(?:Key Content|Conteudo da Chave|Conteúdo da Chave)\\s*:\\s*(.+)$'
} | Select-Object -First 1
$password = if ($keyLine) {
  [regex]::Match([string]$keyLine, ':\\s*(.+)$').Groups[1].Value.Trim()
} else {
  ""
}
Write-Output ("SSID: " + $ssid)
Write-Output ("Senha: " + ($(if ($password) { $password } else { "(nao encontrada)" })))
`.trim();
  }

  if (normalizedKind === "wifi_current_ssid") {
    return `
$interfaceLines = netsh wlan show interfaces
$ssidLine = $interfaceLines | Where-Object { $_ -match '^\\s*SSID\\s*:\\s*(.+)$' -and $_ -notmatch '^\\s*BSSID\\s*:' } | Select-Object -First 1
if (-not $ssidLine) {
  throw "Nenhuma rede Wi-Fi conectada encontrada."
}
$ssid = [regex]::Match([string]$ssidLine, '^\\s*SSID\\s*:\\s*(.+)$').Groups[1].Value.Trim()
Write-Output ("SSID: " + $ssid)
`.trim();
  }

  if (normalizedKind === "local_ip") {
    return `
$configs = Get-NetIPConfiguration -ErrorAction SilentlyContinue | Where-Object { $_.NetAdapter.Status -eq "Up" -and $_.IPv4Address }
if (-not $configs) {
  throw "Nenhum IP IPv4 ativo encontrado."
}
foreach ($config in $configs) {
  foreach ($entry in $config.IPv4Address) {
    if ($entry.IPAddress -and $entry.IPAddress -ne "127.0.0.1") {
      Write-Output ("IP: " + $entry.IPAddress + " [" + $config.InterfaceAlias + "]")
    }
  }
}
`.trim();
  }

  if (normalizedKind === "hostname") {
    return `Write-Output ("Hostname: " + [System.Environment]::MachineName)`;
  }

  if (normalizedKind === "os_version") {
    return `
$cv = Get-ItemProperty "HKLM:\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion"
Write-Output ("Windows: " + $cv.ProductName)
if ($cv.DisplayVersion) { Write-Output ("Versao: " + $cv.DisplayVersion) }
Write-Output ("Build: " + $cv.CurrentBuild)
`.trim();
  }

  throw new Error(`system_query nao suporta o tipo solicitado: ${kind}`);
}

async function systemQueryAction(action, workspaceRoot = process.cwd(), signal = null) {
  const script = buildSystemQueryPowerShellScript(action?.kind);
  const result = await runProcess(
    "powershell.exe",
    ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", wrapPowerShellScript(script)],
    {
      cwd: workspaceRoot,
      timeoutMs: 30000,
      signal
    }
  );

  if (result.code !== 0) {
    return formatCommandResult("Consulta do sistema", "powershell", result);
  }

  return truncateText(result.stdout || "Consulta local concluida.");
}

async function verifyUrlAction(action) {
  const result = await verifyUrl(action?.url, {
    timeoutMs: action?.timeoutMs
  });
  const text = [
    result.ok ? "VERIFICATION PASSED" : "VERIFICATION FAILED",
    `URL: ${result.url}`,
    `HTTP: status=${result.status || 0} chars=${result.bodyChars || 0}`,
    !result.ok && result.status > 0
      ? "Nota: o servidor respondeu; a porta esta ativa, mas o endpoint retornou erro HTTP."
      : null,
    result.error ? `Erro: ${result.error}` : null,
    result.bodyPreview ? `Preview: ${truncateText(result.bodyPreview, 700)}` : null
  ].filter(Boolean).join("\n");
  if (!result.ok) {
    throw new Error(text);
  }
  return text;
}

async function browserCheckAction(action) {
  const result = await verifyBrowser(action?.url, {
    timeoutMs: action?.timeoutMs
  });
  const text = [
    result.ok ? "BROWSER CHECK PASSED" : "BROWSER CHECK FAILED",
    result.url ? `URL: ${result.url}` : null,
    result.skipped ? `Skipped: ${result.reason}` : null,
    result.status ? `HTTP status: ${result.status}` : null,
    result.metrics ? `Render: text=${result.metrics.textLength} visible=${result.metrics.visibleElements} appChildren=${result.metrics.appChildren}` : null,
    result.blockingErrors?.length ? `Errors:\n${result.blockingErrors.join("\n")}` : null
  ].filter(Boolean).join("\n");
  if (!result.ok) {
    throw new Error(text);
  }
  return text;
}

async function captureControlledBrowserScreenshot(page, url) {
  const dir = path.join(os.tmpdir(), "dream-server-browser-control");
  await fs.mkdir(dir, { recursive: true });
  const safeUrl = String(url || "page")
    .replace(/^https?:\/\//i, "")
    .replace(/[^a-z0-9._-]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  const filePath = path.join(dir, `${Date.now()}-${safeUrl || "page"}.png`);
  await page.screenshot({ path: filePath, fullPage: true });
  return filePath;
}

function firstHttpUrlFromText(text) {
  const match = String(text || "").match(/https?:\/\/[^\s"'<>)]*/i);
  return match ? match[0].replace(/[.,;:]+$/g, "") : "";
}

function inferBrowserControlUrl(action, context = {}) {
  const direct = [
    action?.url,
    action?.targetUrl,
    action?.href,
    action?.currentUrl
  ].map((value) => String(value || "").trim()).find((value) => /^https?:\/\//i.test(value));
  if (direct) {
    return direct;
  }

  const runtime = context.runtime;
  const chatId = context.chatId;
  const chat = runtime?.getChat && chatId ? runtime.getChat(chatId) : null;
  const projects = Array.isArray(runtime?.state?.projects) ? runtime.state.projects : [];
  const chatProjectUrl = projects
    .filter((project) => project.chatId === chatId && project.url)
    .map((project) => String(project.url || "").trim())
    .find((url) => /^https?:\/\//i.test(url));
  if (chatProjectUrl) {
    return chatProjectUrl;
  }

  const uniqueKnownProjectUrls = [...new Set(projects
    .filter((project) => project.status === "verified" && project.url)
    .map((project) => String(project.url || "").trim())
    .filter((url) => /^https?:\/\//i.test(url)))];
  const projectUrl = !chat && uniqueKnownProjectUrls.length === 1 ? uniqueKnownProjectUrls[0] : "";
  if (projectUrl) {
    return projectUrl;
  }

  const localEvents = Array.isArray(chat?.localEvents) ? [...chat.localEvents].reverse() : [];
  for (const event of localEvents) {
    const url = firstHttpUrlFromText(`${event.content || ""}\n${event.summary || ""}`);
    if (url) {
      return url;
    }
  }

  const messages = Array.isArray(chat?.messages) ? [...chat.messages].reverse() : [];
  for (const message of messages) {
    const url = firstHttpUrlFromText(`${message.body || ""}\n${message.content || ""}`);
    if (url) {
      return url;
    }
  }

  return "";
}

const BROWSER_CONTROL_ELEMENT_LIMIT = 24;
const BROWSER_CONTROL_TEXT_LIMIT = 900;
const BROWSER_CONTROL_CONSOLE_LIMIT = 6;

function compactBrowserControlLine(value, limit = 180) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, limit);
}

function defaultAcceptLanguageHeader() {
  const locale = String(Intl.DateTimeFormat().resolvedOptions().locale || "en-US")
    .trim()
    .replace("_", "-");
  const normalized = /^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/.test(locale) ? locale : "en-US";
  const base = normalized.split("-")[0] || "en";
  return base === "en"
    ? `${normalized},en;q=0.9`
    : `${normalized},${base};q=0.9,en-US;q=0.8,en;q=0.7`;
}

function defaultBrowserUserAgent() {
  const platform = process.platform === "win32"
    ? "Windows NT 10.0; Win64; x64"
    : process.platform === "darwin"
      ? "Macintosh; Intel Mac OS X 14_0"
      : "X11; Linux x86_64";
  return `Mozilla/5.0 (${platform}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36 DreamServerDesktop/0.2`;
}

function browserControlStepsFromAction(action = {}) {
  const explicitSteps = Array.isArray(action?.steps) ? action.steps : [];
  if (explicitSteps.length) {
    return explicitSteps;
  }

  const operation = String(action?.command || action?.operation || action?.type || "")
    .trim()
    .toLowerCase();
  const stepTypes = new Set([
    "wait_for_selector",
    "wait_for_text",
    "click",
    "fill",
    "press",
    "scroll",
    "screenshot",
    "chess_state",
    "board_state",
    "chess_wait_turn",
    "wait_chess_turn",
    "chess_move",
    "click_square"
  ]);
  if (!stepTypes.has(operation)) {
    return [];
  }

  const step = {
    type: operation,
    ref: action?.ref ? String(action.ref) : undefined,
    selector: action?.selector ? String(action.selector) : undefined,
    text: typeof action?.text === "string" ? action.text : undefined,
    key: action?.key ? String(action.key) : undefined,
    x: Number.isFinite(Number(action?.x)) ? Number(action.x) : undefined,
    y: Number.isFinite(Number(action?.y)) ? Number(action.y) : undefined,
    direction: action?.direction ? String(action.direction) : undefined,
    deltaX: Number.isFinite(Number(action?.deltaX)) ? Number(action.deltaX) : undefined,
    deltaY: Number.isFinite(Number(action?.deltaY)) ? Number(action.deltaY) : undefined,
    pixels: Number.isFinite(Number(action?.pixels)) ? Number(action.pixels) : undefined,
    timeoutMs: Number.isFinite(Number(action?.timeoutMs)) ? Number(action.timeoutMs) : undefined,
    fromSquare: action?.fromSquare || action?.from_square ? String(action.fromSquare || action.from_square) : undefined,
    toSquare: action?.toSquare || action?.to_square ? String(action.toSquare || action.to_square) : undefined,
    square: action?.square ? String(action.square) : undefined,
    promotion: action?.promotion ? String(action.promotion) : undefined
  };
  return [Object.fromEntries(Object.entries(step).filter(([, value]) => typeof value !== "undefined"))];
}

async function browserSessionStateAction(action = {}, context = {}) {
  const previewHarness = context?.runtime?.previewHarness || context?.previewHarness || null;
  if (typeof previewHarness !== "function") {
    throw new Error("browser_session_state exige a ponte live do Workbench. Nao abra Chrome/Edge/Brave como fallback para HTTP/HTTPS; use o Workbench quando a janela Electron estiver ativa.");
  }

  const result = await previewHarness({
    type: "browser_harness",
    command: "session_state",
    chatId: context.chatId ? String(context.chatId) : "",
    timeoutMs: clampNumber(action?.timeoutMs, 500, 120000, 5000)
  }, action?.timeoutMs || 5000);

  return JSON.stringify({
    source: result?.source || "workbench-preview",
    url: String(result?.url || ""),
    title: String(result?.title || ""),
    textLength: Number(result?.textLength || 0),
    visibleElements: Number(result?.visibleElements || 0),
    textPreview: String(result?.textPreview || ""),
    viewport: result?.viewport || null,
    scroll: result?.scroll || null,
    interactiveElements: Array.isArray(result?.interactiveElements) ? result.interactiveElements : [],
    landmarks: Array.isArray(result?.landmarks) ? result.landmarks : [],
    updatedAt: Number(result?.updatedAt || Date.now())
  });
}

async function browserHarnessAction(action = {}, context = {}) {
  const previewHarness = context?.runtime?.previewHarness || context?.previewHarness || null;
  if (typeof previewHarness !== "function") {
    throw new Error("browser_harness exige a ponte live do Workbench. Nao abra Chrome/Edge/Brave como fallback para HTTP/HTTPS; use o Workbench quando a janela Electron estiver ativa.");
  }

  const commandName = String(action?.command || "").trim().toLowerCase() || (Array.isArray(action?.steps) && action.steps.length ? "sequence" : "page_info");
  const defaultTimeoutMs = commandName === "chess_move" ? 70000 : commandName === "chess_wait_turn" || commandName === "wait_chess_turn" ? 45000 : 10000;
  const timeoutMs = clampNumber(action?.timeoutMs, 500, 120000, defaultTimeoutMs);
  const result = await previewHarness({
    type: "browser_harness",
    command: commandName,
    chatId: context.chatId ? String(context.chatId) : "",
    url: action?.url ? String(action.url) : "",
    ref: action?.ref ? String(action.ref) : "",
    selector: action?.selector ? String(action.selector) : "",
    label: action?.label ? String(action.label) : "",
    accessibleName: action?.accessibleName ? String(action.accessibleName) : "",
    name: action?.name ? String(action.name) : "",
    ariaLabel: action?.ariaLabel ? String(action.ariaLabel) : "",
    title: action?.title ? String(action.title) : "",
    x: Number.isFinite(Number(action?.x)) ? Number(action.x) : null,
    y: Number.isFinite(Number(action?.y)) ? Number(action.y) : null,
    button: action?.button ? String(action.button) : "left",
    clicks: clampNumber(action?.clicks, 1, 4, 1),
    text: action?.text == null ? "" : String(action.text),
    key: action?.key ? String(action.key) : "",
    modifiers: clampNumber(action?.modifiers, 0, 15, 0),
    deltaX: Number.isFinite(Number(action?.deltaX)) ? Number(action.deltaX) : 0,
    deltaY: Number.isFinite(Number(action?.deltaY)) ? Number(action.deltaY) : 0,
    pixels: clampNumber(action?.pixels, 40, 4000, 700),
    full: action?.full === true,
    expression: action?.expression ? String(action.expression) : "",
    fromSquare: action?.fromSquare ? String(action.fromSquare) : "",
    toSquare: action?.toSquare ? String(action.toSquare) : "",
    from_square: action?.from_square ? String(action.from_square) : "",
    to_square: action?.to_square ? String(action.to_square) : "",
    promotion: action?.promotion ? String(action.promotion) : "",
    square: action?.square ? String(action.square) : "",
    screenshot: action?.screenshot === true,
    deviceMode: action?.deviceMode ? String(action.deviceMode) : "",
    timeoutMs,
    steps: Array.isArray(action?.steps) ? action.steps.slice(0, 60) : []
  }, timeoutMs);

  return JSON.stringify(result || {}, null, 2);
}

async function browserControlAction(action, context = {}) {
  const targetUrl = inferBrowserControlUrl(action, context);
  const previewHarness = context?.runtime?.previewHarness || context?.previewHarness || null;
  const preferPreview = action?.usePreview !== false && typeof previewHarness === "function";
  const allowFallback = action?.usePreview === false || action?.allowFallback === true;
  const hasTargetUrl = /^https?:\/\//i.test(targetUrl);
  const normalizedSteps = browserControlStepsFromAction(action);
  if (!hasTargetUrl && !preferPreview) {
    throw new Error("browser_control exige uma URL http/https, um projeto/URL ativo no chat ou o Workbench live para usar a pagina atual.");
  }

  if (preferPreview) {
    const operation = String(action?.command || action?.operation || "").trim().toLowerCase();
    const steps = normalizedSteps.slice(0, 40);
    const command = steps.length
      ? "sequence"
      : hasTargetUrl
        ? "goto"
        : ["page_info", "snapshot", "session_state"].includes(operation)
          ? operation
          : "page_info";
    try {
      const result = await previewHarness({
        type: "browser_harness",
        command,
        chatId: context.chatId ? String(context.chatId) : "",
        url: hasTargetUrl ? targetUrl : "",
        steps,
        timeoutMs: clampNumber(action?.timeoutMs, 2000, 120000, 30000),
        screenshot: action?.screenshot === true,
        deviceMode: action?.deviceMode || null
      }, action?.timeoutMs || 30000);
      return formatPreviewHarnessBrowserResult(targetUrl, result);
    } catch (error) {
      if (!allowFallback) {
        throw new Error(`browser_control no Workbench falhou: ${error.message || error}`);
      }
    }
  }
  if (!hasTargetUrl) {
    throw new Error("browser_control sem URL nao pode cair para navegador externo; a acao precisa do Workbench live ou de uma URL http/https.");
  }

  let playwright = null;
  try {
    playwright = require("playwright-core");
  } catch {
    throw new Error("browser_control exige playwright-core instalado.");
  }

  const executablePath = findBrowserExecutable();
  if (!executablePath) {
    throw new Error("Nenhum navegador Chromium/Edge/Chrome/Brave encontrado para browser_control.");
  }

  const timeoutMs = clampNumber(action?.timeoutMs, 2000, 120000, 30000);
  const steps = normalizedSteps.slice(0, 30);
  const browser = await playwright.chromium.launch({
    executablePath,
    headless: action?.headless !== false
  });

  const consoleMessages = [];
  const pageErrors = [];
  const stepResults = [];
  let screenshotPath = "";
  try {
    const page = await browser.newPage({ viewport: { width: 1365, height: 900 } });
    page.on("console", (message) => {
      if (["error", "warning"].includes(message.type())) {
        consoleMessages.push(`${message.type()}: ${message.text()}`);
      }
    });
    page.on("pageerror", (error) => {
      pageErrors.push(error.message || String(error));
    });

    const response = await page.goto(targetUrl, {
      waitUntil: "domcontentloaded",
      timeout: timeoutMs
    });
    await page.waitForLoadState("networkidle", { timeout: Math.min(timeoutMs, 15000) }).catch(() => {});

    for (const [index, rawStep] of steps.entries()) {
      const type = String(rawStep?.type || "").trim();
      const selector = rawStep?.selector ? String(rawStep.selector) : "";
      const stepTimeout = clampNumber(rawStep?.timeoutMs, 500, timeoutMs, Math.min(timeoutMs, 10000));
      try {
        if (type === "wait_for_selector") {
          if (!selector) throw new Error("wait_for_selector exige selector.");
          await page.waitForSelector(selector, { timeout: stepTimeout });
          stepResults.push(`${index + 1}. wait_for_selector ok: ${selector}`);
          continue;
        }
        if (type === "wait_for_text") {
          const expected = String(rawStep?.text || "").trim();
          if (!expected) throw new Error("wait_for_text exige text.");
          await page.waitForFunction(
            (text) => document.body?.innerText?.includes(text),
            expected,
            { timeout: stepTimeout }
          );
          stepResults.push(`${index + 1}. wait_for_text ok: ${expected}`);
          continue;
        }
        if (type === "click") {
          if (!selector) throw new Error("click exige selector.");
          await page.click(selector, { timeout: stepTimeout });
          stepResults.push(`${index + 1}. click ok: ${selector}`);
          continue;
        }
        if (type === "fill") {
          if (!selector) throw new Error("fill exige selector.");
          await page.fill(selector, String(rawStep?.text || ""), { timeout: stepTimeout });
          stepResults.push(`${index + 1}. fill ok: ${selector}`);
          continue;
        }
        if (type === "press") {
          const key = String(rawStep?.key || "").trim();
          if (!key) throw new Error("press exige key.");
          if (selector) {
            await page.press(selector, key, { timeout: stepTimeout });
          } else {
            await page.keyboard.press(key);
          }
          stepResults.push(`${index + 1}. press ok: ${selector || "page"} ${key}`);
          continue;
        }
        if (type === "scroll") {
          const direction = String(rawStep?.direction || "down").toLowerCase() === "up" ? "up" : "down";
          const pixels = clampNumber(rawStep?.pixels, 80, 4000, 700);
          await page.mouse.wheel(0, direction === "up" ? -pixels : pixels);
          stepResults.push(`${index + 1}. scroll ok: ${direction} ${pixels}px`);
          continue;
        }
        if (type === "screenshot") {
          screenshotPath = await captureControlledBrowserScreenshot(page, targetUrl);
          stepResults.push(`${index + 1}. screenshot ok: ${screenshotPath}`);
          continue;
        }
        throw new Error(`Tipo de passo nao suportado: ${type || "(vazio)"}`);
      } catch (error) {
        throw new Error(`browser_control falhou no passo ${index + 1} (${type}): ${error.message || error}`);
      }
    }

    if (action?.screenshot === true && !screenshotPath) {
      screenshotPath = await captureControlledBrowserScreenshot(page, targetUrl);
    }

    const metrics = await page.evaluate(() => {
      const attrValue = (value) => String(value || "").replace(/\\/g, "\\\\").replace(/"/g, '\\"');
      const isVisible = (element) => {
        const style = window.getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        return style.display !== "none" && style.visibility !== "hidden" && Number(style.opacity || 1) > 0 && rect.width > 0 && rect.height > 0;
      };
      const selectorFor = (element) => {
        const tag = String(element.tagName || "").toLowerCase();
        if (!tag) return "";
        const isUnique = (selector) => {
          try {
            return selector && document.querySelectorAll(selector).length === 1;
          } catch {
            return false;
          }
        };
        const id = element.getAttribute("id");
        if (id && window.CSS?.escape) {
          const selector = `#${window.CSS.escape(id)}`;
          if (isUnique(selector)) return selector;
        }
        const testId = element.getAttribute("data-testid") || element.getAttribute("data-test-id");
        if (testId) {
          const selector = `${tag}[data-testid="${attrValue(testId)}"]`;
          if (isUnique(selector)) return selector;
        }
        const aria = element.getAttribute("aria-label");
        if (aria) {
          const selector = `${tag}[aria-label="${attrValue(aria)}"]`;
          if (isUnique(selector)) return selector;
        }
        const href = element.getAttribute("href");
        if (href) {
          const selector = `${tag}[href="${attrValue(href)}"]`;
          if (isUnique(selector)) return selector;
        }
        const name = element.getAttribute("name");
        if (name) {
          const selector = `${tag}[name="${attrValue(name)}"]`;
          if (isUnique(selector)) return selector;
        }

        const parts = [];
        let node = element;
        while (node && node.nodeType === Node.ELEMENT_NODE && node !== document.body && parts.length < 5) {
          const nodeTag = String(node.tagName || "").toLowerCase();
          const parent = node.parentElement;
          if (!nodeTag || !parent) break;
          const sameTagSiblings = Array.from(parent.children).filter((child) => child.tagName === node.tagName);
          parts.unshift(sameTagSiblings.length > 1 ? `${nodeTag}:nth-of-type(${sameTagSiblings.indexOf(node) + 1})` : nodeTag);
          node = parent;
        }
        return parts.join(" > ");
      };

      const text = document.body?.innerText?.trim() || "";
      const visibleElements = [...document.body.querySelectorAll("*")].filter(isVisible).length;
      const interactiveElements = [...document.body.querySelectorAll("a[href], button, input, textarea, select, [role='button'], [role='link'], [tabindex]:not([tabindex='-1'])")]
        .filter(isVisible)
        .slice(0, 30)
        .map((element) => {
          const tag = String(element.tagName || "").toLowerCase();
          const label = (
            element.innerText ||
            element.getAttribute("aria-label") ||
            element.getAttribute("title") ||
            element.getAttribute("placeholder") ||
            element.getAttribute("value") ||
            element.getAttribute("href") ||
            tag
          ).replace(/\s+/g, " ").trim().slice(0, 180);
          return { tag, selector: selectorFor(element), label };
        })
        .filter((entry) => entry.selector && entry.label);
      return {
        title: document.title || "",
        textLength: text.length,
        textPreview: text.replace(/\s+/g, " ").trim().slice(0, 900),
        interactiveElements,
        visibleElements
      };
    });

    const status = response?.status?.() || 0;
    const blockingErrors = [
      ...consoleMessages.filter(isBlockingBrowserConsoleText),
      ...pageErrors.filter(isBlockingBrowserConsoleText)
    ];
    const lines = [
      blockingErrors.length ? "BROWSER CONTROL COMPLETED WITH ERRORS" : "BROWSER CONTROL PASSED",
      `URL: ${targetUrl}`,
      `HTTP status: ${status}`,
      `Title: ${metrics.title || "(sem titulo)"}`,
      `Render: text=${metrics.textLength} visible=${metrics.visibleElements}`,
      screenshotPath ? `Screenshot: ${screenshotPath}` : null,
      stepResults.length ? `Steps:\n${stepResults.join("\n")}` : null,
      metrics.interactiveElements?.length
        ? `Interactive elements:\n${metrics.interactiveElements
            .map((entry, index) => `@e${index + 1} ${entry.selector} :: ${entry.label}`)
            .join("\n")}`
        : null,
      metrics.textPreview ? `Text preview:\n${metrics.textPreview}` : null,
      consoleMessages.length ? `Console:\n${consoleMessages.slice(-BROWSER_CONTROL_CONSOLE_LIMIT).join("\n")}` : null,
      pageErrors.length ? `Page errors:\n${pageErrors.slice(-BROWSER_CONTROL_CONSOLE_LIMIT).join("\n")}` : null
    ].filter(Boolean);

    if (blockingErrors.length) {
      throw new Error(lines.join("\n"));
    }
    return lines.join("\n");
  } finally {
    await browser.close().catch(() => {});
  }
}

function formatPreviewHarnessBrowserResult(targetUrl, result = {}) {
  const interactive = Array.isArray(result.interactiveElements) ? result.interactiveElements.slice(0, BROWSER_CONTROL_ELEMENT_LIMIT) : [];
  const landmarks = Array.isArray(result.landmarks) ? result.landmarks.slice(0, 10) : [];
  const steps = Array.isArray(result.stepResults) ? result.stepResults.slice(0, 12) : [];
  const consoleMessages = Array.isArray(result.consoleMessages) ? result.consoleMessages : [];
  const pageErrors = Array.isArray(result.pageErrors) ? result.pageErrors : [];
  const url = result.url || targetUrl;
  const lines = [
    "BROWSER CONTROL PASSED (WORKBENCH LIVE)",
    `URL: ${url}`,
    result.title ? `Title: ${result.title}` : null,
    `Render: text=${Number(result.textLength || 0)} visible=${Number(result.visibleElements || 0)}`,
    result.viewport ? `Viewport: ${result.viewport.width}x${result.viewport.height}` : null,
    steps.length ? `Steps:\n${steps.join("\n")}` : null,
    landmarks.length
      ? `Page regions:\n${landmarks
          .map((entry, index) => `@r${index + 1} ${entry.selector || entry.tag || "region"} :: ${compactBrowserControlLine(entry.label || entry.role || "", 90)} rect=${entry.rect?.left ?? entry.x},${entry.rect?.top ?? entry.y},${entry.rect?.width ?? "?"}x${entry.rect?.height ?? "?"}`)
          .join("\n")}`
      : null,
    interactive.length
      ? `Interactive elements:\n${interactive
          .map((entry, index) => `@e${index + 1} ${entry.selector || entry.ref || "(coord)"} :: ${compactBrowserControlLine(entry.label || entry.tag || "element", 100)}`)
          .join("\n")}`
      : null,
    result.textPreview ? `Text preview:\n${String(result.textPreview).slice(0, BROWSER_CONTROL_TEXT_LIMIT)}` : null,
    consoleMessages.length ? `Console:\n${consoleMessages.slice(-BROWSER_CONTROL_CONSOLE_LIMIT).join("\n")}` : null,
    pageErrors.length ? `Page errors:\n${pageErrors.slice(-BROWSER_CONTROL_CONSOLE_LIMIT).join("\n")}` : null
  ].filter(Boolean);

  return lines.join("\n");
}

function isBlockingBrowserConsoleText(entry) {
  const text = String(entry || "");
  if (/failed to load resource/i.test(text) && /\b404\b|not found/i.test(text)) {
    return false;
  }
  return /(parse|syntax|failed to load module|module script|uncaught|vite|build failed|typeerror|referenceerror|failed to resolve|failed to fetch dynamically imported module)/i.test(text);
}

async function verifyFileAction(action, workspaceRoot = process.cwd()) {
  const files = Array.isArray(action?.files)
    ? action.files.map(String).filter(Boolean)
    : action?.path
      ? [String(action.path)]
      : [];
  if (!files.length) {
    throw new Error("verify_file exige path ou files.");
  }

  const fileResult = await verifyFiles(files, workspaceRoot);
  const required = Array.isArray(action?.contains)
    ? action.contains.map((entry) => String(entry || "")).filter(Boolean)
    : [];
  const forbidden = Array.isArray(action?.notContains)
    ? action.notContains.map((entry) => String(entry || "")).filter(Boolean)
    : [];
  const maxChars = clampNumber(action?.maxChars, 200, 40000, 8000);
  let missingText = [];
  let presentForbiddenText = [];

  if (fileResult.ok && (required.length || forbidden.length)) {
    const contents = await Promise.all(
      fileResult.found.map(async (filePath) => ({
        filePath,
        content: truncateText(await fs.readFile(filePath, "utf8"), maxChars)
      }))
    );
    missingText = required.filter((entry) => !contents.some((item) => item.content.includes(entry)));
    presentForbiddenText = forbidden.filter((entry) => contents.some((item) => item.content.includes(entry)));
  }

  const ok = fileResult.ok && missingText.length === 0 && presentForbiddenText.length === 0;
  const lines = [
    ok ? "FILE VERIFICATION PASSED" : "FILE VERIFICATION FAILED",
    `Found: ${fileResult.found.length}`,
    `Missing: ${fileResult.missing.length}`,
    fileResult.missing.length ? fileResult.missing.join("\n") : null,
    missingText.length ? `Missing text: ${missingText.join(", ")}` : null,
    presentForbiddenText.length ? `Forbidden text found: ${presentForbiddenText.join(", ")}` : null
  ].filter(Boolean);

  const text = lines.join("\n");
  if (!ok) {
    throw new Error(text);
  }
  return text;
}

async function verifySiteAction(action, workspaceRoot = process.cwd()) {
  const result = await verifySite(action, workspaceRoot);
  const text = formatVerification(result);
  if (!result.ok) {
    throw new Error(text);
  }
  return text;
}

async function fetchPageText(url) {
  const html = await fetchRawPage(url);
  return htmlToReadableText(html);
}

async function fetchRawPage(url) {
  const response = await fetch(url, {
    headers: {
      "User-Agent": defaultBrowserUserAgent(),
      "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": defaultAcceptLanguageHeader()
    }
  });

  if (!response.ok) {
    throw new Error(`Falha ao buscar ${url}: ${response.status}`);
  }

  return await response.text();
}

function decodeHtmlEntities(value) {
  return String(value || "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, "\"")
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#(\d+);/g, (_, code) => {
      const numeric = Number(code);
      return Number.isFinite(numeric) ? String.fromCharCode(numeric) : "";
    })
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => {
      const numeric = Number.parseInt(code, 16);
      return Number.isFinite(numeric) ? String.fromCharCode(numeric) : "";
    });
}

function htmlToReadableText(html) {
  const withoutScripts = String(html || "")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ");
  return truncateText(
    decodeHtmlEntities(withoutScripts
      .replace(/<[^>]+>/g, " "))
      .replace(/\s+/g, " ")
      .trim(),
    8000
  );
}

function normalizeSearchUrl(rawHref) {
  let href = decodeHtmlEntities(String(rawHref || "").trim());
  if (!href) {
    return "";
  }
  if (href.startsWith("//")) {
    href = `https:${href}`;
  }
  if (href.startsWith("/")) {
    href = `https://duckduckgo.com${href}`;
  }
  try {
    const parsed = new URL(href);
    const uddg = parsed.searchParams.get("uddg");
    if (uddg) {
      href = decodeURIComponent(uddg);
    }
  } catch {}
  try {
    href = decodeURIComponent(href);
  } catch {}
  if (!/^https?:\/\//i.test(href)) {
    return "";
  }
  if (
    /duckduckgo\.com\/(html|lite|l\/|y\.js)/i.test(href) ||
    /bing\.com\/(search|ck\/|aclick)/i.test(href) ||
    /[?&](ad_domain|ad_provider|click_metadata)=/i.test(href)
  ) {
    return "";
  }
  return href;
}

function addSearchResult(results, seen, href, title, maxResults) {
  const url = normalizeSearchUrl(href);
  if (!url || seen.has(url) || results.length >= maxResults) {
    return;
  }
  seen.add(url);
  const cleanTitle = htmlToReadableText(title || url).replace(/\s+/g, " ").trim() || url;
  results.push({ title: truncateText(cleanTitle, 180), url });
}

async function webFetchAction(action) {
  const url = String(action?.url || "").trim();
  if (!/^https?:\/\//i.test(url)) {
    throw new Error("web_fetch exige uma URL http ou https.");
  }
  const text = await fetchPageText(url);
  return `Conteudo resumido de ${url}:\n${text}`;
}

async function webSearchAction(action) {
  const query = String(action?.query || "").trim();
  const maxResults = clampNumber(action?.maxResults, 1, 10, 5);
  if (!query) {
    throw new Error("web_search exige um texto de busca.");
  }

  const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
  const html = await fetchRawPage(url);
  const results = [];
  const seen = new Set();
  const anchorPattern = /<a\b[^>]*class=["'][^"']*result__a[^"']*["'][^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let anchorMatch = null;
  while ((anchorMatch = anchorPattern.exec(html)) && results.length < maxResults) {
    addSearchResult(results, seen, anchorMatch[1], anchorMatch[2], maxResults);
  }

  const linkPattern = /uddg=([^&"'<>]+)/g;
  let match = null;
  while ((match = linkPattern.exec(html)) && results.length < maxResults) {
    addSearchResult(results, seen, match[1], "", maxResults);
  }

  if (!results.length) {
    const fallbackHtml = await fetchRawPage(`https://www.bing.com/search?q=${encodeURIComponent(query)}`).catch(() => "");
    const bingPattern = /<li\b[^>]*class=["'][^"']*b_algo[^"']*["'][\s\S]*?<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
    let bingMatch = null;
    while ((bingMatch = bingPattern.exec(fallbackHtml)) && results.length < maxResults) {
      addSearchResult(results, seen, bingMatch[1], bingMatch[2], maxResults);
    }
  }

  return results.length
    ? `Resultados para "${query}":\n${results.map((entry, index) => `${index + 1}. ${entry.title}\n   ${entry.url}`).join("\n")}`
    : `Nenhum resultado encontrado para "${query}".`;
}

function formatTodoList(todos = []) {
  return todos.length
    ? todos
        .map((todo) => `- [${todo.status}] (${todo.priority}) ${todo.id}: ${todo.text}`)
        .join("\n")
    : "(nenhum todo)";
}

function formatTaskList(tasks = []) {
  return tasks.length
    ? tasks
        .map((task) => `- [${task.status}] ${task.id}: ${task.title}${task.routeId ? ` (${task.routeId})` : ""}`)
        .join("\n")
    : "(nenhuma tarefa)";
}

function formatAgentList(agents = []) {
  return agents.length
    ? agents
        .map((agent) =>
          `- [${agent.status}] ${agent.id}: ${agent.name} -> ${agent.summary || agent.objective}${agent.worktreeBranch ? ` [${agent.worktreeBranch}]` : ""}${agent.worktreePath ? ` @ ${agent.worktreePath}` : ""}`
        )
        .join("\n")
    : "(nenhum subagente)";
}

async function todoWriteAction(action, context = {}) {
  if (!context.runtime) {
    throw new Error("todo_write exige acesso ao runtime.");
  }
  const todos = Array.isArray(action?.todos) ? action.todos : [];
  const mode = String(action?.mode || "append").trim();
  const snapshot = context.runtime.writeTodos({
    mode,
    todos
  });
  return `Todos persistidos:\n${formatTodoList(snapshot)}`;
}

async function todoReadAction(action, context = {}) {
  if (!context.runtime) {
    throw new Error("todo_read exige acesso ao runtime.");
  }
  const todos = context.runtime.listTodos(action?.status);
  return `Todos atuais:\n${formatTodoList(todos)}`;
}

async function taskCreateAction(action, context = {}) {
  if (!context.runtime) {
    throw new Error("task_create exige acesso ao runtime.");
  }
  const task = context.runtime.createTaskRecord({
    title: action?.title,
    objective: action?.objective,
    routeId: action?.routeId,
    status: action?.status,
    workspaceRoot: action?.workspaceRoot
  });
  return `Tarefa criada: ${task.id} - ${task.title}`;
}

async function taskListAction(action, context = {}) {
  if (!context.runtime) {
    throw new Error("task_list exige acesso ao runtime.");
  }
  const tasks = context.runtime.listTaskRecords(action?.status);
  return `Tarefas persistentes:\n${formatTaskList(tasks)}`;
}

async function taskGetAction(action, context = {}) {
  if (!context.runtime) {
    throw new Error("task_get exige acesso ao runtime.");
  }
  const task = context.runtime.getTaskRecord(action?.id);
  if (!task) {
    throw new Error(`Tarefa nao encontrada: ${action?.id}`);
  }
  return JSON.stringify(task, null, 2);
}

async function taskUpdateAction(action, context = {}) {
  if (!context.runtime) {
    throw new Error("task_update exige acesso ao runtime.");
  }
  const status = String(action?.status || "").trim();
  const eventByStatus = {
    queue: "QUEUED",
    planning: "PLANNING_STARTED",
    plan_review: "PLANNING_COMPLETE",
    coding: "CODING_STARTED",
    in_progress: "STARTED",
    qa_review: "QA_STARTED",
    qa_fixing: "QA_FIXING_STARTED",
    ai_review: "AI_REVIEW",
    human_review: "HUMAN_REVIEW",
    creating_pr: "CREATE_PR",
    done: "MARK_DONE",
    pr_created: "PR_CREATED",
    archived: "ARCHIVED",
    error: "ERROR"
  };
  const event = action?.event || eventByStatus[status] || "";
  const current = context.runtime.getTaskRecord(action?.id);
  if (!current) {
    throw new Error(`Tarefa nao encontrada: ${action?.id}`);
  }
  const patch = { ...action };
  if (String(action?.comment || "").trim()) {
    const comment = {
      id: `comment-${Date.now()}-${Math.random().toString(16).slice(2)}`,
      author: String(action?.author || "dashboard"),
      body: String(action.comment).trim(),
      createdAt: Date.now()
    };
    patch.comments = [
      ...(Array.isArray(current.comments) ? current.comments : []),
      comment
    ];
    if (typeof context.runtime._taskLogsWithEntry === "function") {
      patch.logs = context.runtime._taskLogsWithEntry(
        current,
        "validation",
        "comment",
        comment.body,
        { author: comment.author }
      );
    }
  }
  if (String(action?.linkParentId || "").trim() && String(action?.linkChildId || "").trim()) {
    const parentId = String(action.linkParentId).trim();
    const childId = String(action.linkChildId).trim();
    const links = {
      parents: Array.isArray(current.links?.parents) ? [...current.links.parents] : [],
      children: Array.isArray(current.links?.children) ? [...current.links.children] : []
    };
    if (current.id === childId && !links.parents.includes(parentId)) {
      links.parents.push(parentId);
    }
    if (current.id === parentId && !links.children.includes(childId)) {
      links.children.push(childId);
    }
    patch.links = links;
    if (typeof context.runtime._taskLogsWithEntry === "function") {
      patch.logs = context.runtime._taskLogsWithEntry(
        current,
        "planning",
        "link",
        `Link registrado: ${parentId} -> ${childId}`,
        { parentId, childId }
      );
    }
  }
  delete patch.comment;
  delete patch.author;
  delete patch.linkParentId;
  delete patch.linkChildId;
  const task = event && typeof context.runtime.transitionTaskRecord === "function"
    ? context.runtime.transitionTaskRecord(action?.id, event, {
        ...patch,
        message: action?.message || `Task movida para ${status || event}.`
      })
    : context.runtime.updateTaskRecord(action?.id, patch);
  return `Tarefa atualizada: ${task.id} -> ${task.status}`;
}

async function taskDeleteAction(action, context = {}) {
  if (!context.runtime) {
    throw new Error("task_delete exige acesso ao runtime.");
  }
  const task = context.runtime.getTaskRecord(action?.id);
  if (!task) {
    throw new Error(`Tarefa nao encontrada: ${action?.id}`);
  }
  if (["in_progress", "creating_pr"].includes(String(task.status || "")) && !action?.force) {
    throw new Error("Tarefa ativa nao pode ser deletada sem force=true. Pare ou arquive primeiro.");
  }
  if (typeof context.runtime.deleteTaskRecord !== "function") {
    throw new Error("Runtime atual nao possui exclusao de task.");
  }
  const result = await context.runtime.deleteTaskRecord(task.id, {
    force: Boolean(action?.force)
  });
  return `Tarefa deletada: ${result.id}`;
}

async function taskStopAction(action, context = {}) {
  if (!context.runtime) {
    throw new Error("task_stop exige acesso ao runtime.");
  }
  const task = context.runtime.getTaskRecord(action?.id);
  if (!task) {
    throw new Error(`Tarefa nao encontrada: ${action?.id}`);
  }
  if (action?.stopAgent !== false && typeof context.runtime.stopTaskAgents === "function") {
    await context.runtime.stopTaskAgents(task.id).catch(() => null);
  } else if (task.agentId && action?.stopAgent !== false) {
    await context.runtime.stopAgent(task.agentId).catch(() => null);
  }
  const updated = typeof context.runtime.transitionTaskRecord === "function"
    ? context.runtime.transitionTaskRecord(task.id, "USER_STOPPED", {
        reviewReason: "manual_stop",
        message: action?.reason || "Task parada manualmente."
      })
    : context.runtime.updateTaskRecord(task.id, { status: "human_review" });
  return `Tarefa parada: ${updated.id}`;
}

async function taskRecoverAction(action, context = {}) {
  if (!context.runtime) {
    throw new Error("task_recover exige acesso ao runtime.");
  }
  if (typeof context.runtime.recoverTask !== "function") {
    throw new Error("Runtime atual nao possui recuperacao de task.");
  }
  const result = await context.runtime.recoverTask(action?.id, {
    force: Boolean(action?.force),
    autoRestart: action?.autoRestart !== false,
    provider: action?.provider,
    cloudApiKey: context.cloudApiKey || ""
  });
  return result?.restarted
    ? `Tarefa recuperada e reiniciada: ${result.task?.id || action?.id} -> ${result.agent?.id || "agent"}`
    : `Tarefa recuperada sem reiniciar: ${result.task?.id || action?.id} (${result?.reason || "ok"})`;
}

async function taskCleanupWorktreeAction(action, context = {}) {
  if (!context.runtime) {
    throw new Error("task_cleanup_worktree exige acesso ao runtime.");
  }
  if (typeof context.runtime.cleanupTaskWorktree !== "function") {
    throw new Error("Runtime atual nao possui cleanup de worktree.");
  }
  const result = await context.runtime.cleanupTaskWorktree(action?.id, {
    force: Boolean(action?.force)
  });
  if (result?.error) {
    return `Cleanup falhou: ${result.error}`;
  }
  return result?.result || `Cleanup concluido: ${result?.task?.id || action?.id}`;
}

async function taskCreatePrAction(action, context = {}) {
  if (!context.runtime) {
    throw new Error("task_create_pr exige acesso ao runtime.");
  }
  if (typeof context.runtime.createTaskPullRequest !== "function") {
    throw new Error("Runtime atual nao possui fluxo de PR.");
  }
  const result = await context.runtime.createTaskPullRequest(action?.id, {
    title: action?.title,
    body: action?.body,
    draft: action?.draft !== false,
    prUrl: action?.prUrl,
    command: action?.command,
    timeoutMs: action?.timeoutMs
  });
  if (result?.error) {
    return `PR falhou: ${result.error}`;
  }
  return result?.prUrl
    ? `PR criada: ${result.prUrl}`
    : `Fluxo de PR executado para ${result?.task?.id || action?.id}.`;
}

async function taskSchedulerTickAction(action, context = {}) {
  if (!context.runtime) {
    throw new Error("task_scheduler_tick exige acesso ao runtime.");
  }
  if (typeof context.runtime.runTaskSchedulerTick !== "function") {
    throw new Error("Runtime atual nao possui scheduler de Kanban.");
  }
  const result = await context.runtime.runTaskSchedulerTick({
    force: action?.force !== false
  });
  return `Scheduler Kanban: ${JSON.stringify(result)}`;
}

async function taskLogsAction(action, context = {}) {
  if (!context.runtime) {
    throw new Error("task_logs exige acesso ao runtime.");
  }
  const task = context.runtime.getTaskRecord(action?.id);
  if (!task) {
    throw new Error(`Tarefa nao encontrada: ${action?.id}`);
  }
  const phase = String(action?.phase || "").trim();
  const logs = task.logs || {};
  const phases = phase ? [phase] : ["planning", "coding", "validation"];
  const lines = [];
  for (const entryPhase of phases) {
    const entries = Array.isArray(logs[entryPhase]) ? logs[entryPhase] : [];
    lines.push(`[${entryPhase}]`);
    if (!entries.length) {
      lines.push("- sem logs");
      continue;
    }
    lines.push(...entries.slice(-40).map((entry) =>
      `- ${new Date(Number(entry.timestamp || Date.now())).toISOString()} ${entry.type || "info"}: ${entry.content || ""}`
    ));
  }
  return lines.join("\n");
}

async function fileSymbolsAction(action, workspaceRoot = process.cwd()) {
  const targetPath = String(action?.path || "");
  const absolutePath = expandPathInput(targetPath, workspaceRoot);
  let symbols = [];
  try {
    symbols = await fileSymbolsLsp(absolutePath, workspaceRoot);
  } catch {
    symbols = await fileSymbols(targetPath, workspaceRoot);
  }
  return symbols.length
    ? `Simbolos em ${absolutePath}:\n${symbols
        .map((symbol) => `- ${symbol.kind} ${symbol.name} @ ${symbol.line}${symbol.character ? `:${symbol.character}` : ""}${symbol.container ? ` (${symbol.container})` : ""}`)
        .join("\n")}`
    : "Nenhum simbolo encontrado neste arquivo.";
}

async function workspaceSymbolsAction(action, workspaceRoot = process.cwd()) {
  const query = String(action?.query || "").trim();
  const lspState = getLspState(workspaceRoot);
  const hasAnyLsp =
    lspState.available ||
    (Array.isArray(lspState.externalServers) && lspState.externalServers.some((server) => server.available));
  const symbols = hasAnyLsp
    ? await workspaceSymbolsLsp(query, workspaceRoot, {
        maxResults: action?.maxResults
      })
    : await workspaceSymbols(query, workspaceRoot, {
        maxResults: action?.maxResults
      });
  return symbols.length
    ? `Resultados de simbolos${query ? ` para "${query}"` : ""}:\n${symbols
        .map((symbol) => `- ${symbol.kind} ${symbol.name} :: ${path.relative(workspaceRoot, symbol.file)}:${symbol.line}${symbol.character ? `:${symbol.character}` : ""}`)
        .join("\n")}`
    : "Nenhum simbolo encontrado.";
}

async function lspDocumentSymbolsAction(action, workspaceRoot = process.cwd()) {
  const symbols = await fileSymbolsLsp(String(action?.path || ""), workspaceRoot);
  return symbols.length
    ? `Simbolos LSP em ${expandPathInput(action?.path, workspaceRoot)}:\n${symbols
        .map((symbol) => `- ${symbol.kind} ${symbol.name} @ ${symbol.line}:${symbol.character}${symbol.container ? ` (${symbol.container})` : ""}`)
        .join("\n")}`
    : "Nenhum simbolo LSP encontrado neste arquivo.";
}

async function lspWorkspaceSymbolsAction(action, workspaceRoot = process.cwd()) {
  const query = String(action?.query || "").trim();
  const symbols = await workspaceSymbolsLsp(query, workspaceRoot, {
    maxResults: action?.maxResults
  });
  return symbols.length
    ? `Resultados LSP${query ? ` para "${query}"` : ""}:\n${symbols
        .map((symbol) => `- ${symbol.kind} ${symbol.name} :: ${path.relative(workspaceRoot, symbol.file)}:${symbol.line}:${symbol.character}`)
        .join("\n")}`
    : "Nenhum simbolo LSP encontrado.";
}

async function lspDefinitionAction(action, workspaceRoot = process.cwd()) {
  const definitions = await lspDefinition(action, workspaceRoot);
  return definitions.length
    ? `Definicoes encontradas:\n${definitions
        .map((entry) => `- ${entry.kind} ${entry.name} :: ${path.relative(workspaceRoot, entry.file)}:${entry.line}:${entry.character}`)
        .join("\n")}`
    : "Nenhuma definicao encontrada nesta posicao.";
}

async function lspReferencesAction(action, workspaceRoot = process.cwd()) {
  const references = await lspReferences(action, workspaceRoot);
  return references.length
    ? `Referencias encontradas:\n${references
        .map((entry) => `- ${entry.isDefinition ? "[def] " : ""}${path.relative(workspaceRoot, entry.file)}:${entry.line}:${entry.character}${entry.text ? ` :: ${entry.text}` : ""}`)
        .join("\n")}`
    : "Nenhuma referencia encontrada nesta posicao.";
}

async function lspHoverAction(action, workspaceRoot = process.cwd()) {
  const hover = await lspHover(action, workspaceRoot);
  if (!hover) {
    return "Nenhuma informacao de hover encontrada nesta posicao.";
  }
  return [
    `Hover (${hover.kind}):`,
    hover.display || "(sem assinatura)",
    hover.documentation ? `\n${hover.documentation}` : ""
  ].join("\n").trim();
}

async function lspCodeActionsAction(action, workspaceRoot = process.cwd()) {
  const result = await lspCodeActions(action, workspaceRoot);
  const lines = ["Code actions disponiveis:"];

  if (result.fixes.length) {
    lines.push(...result.fixes.map((entry) => `- ${entry.id} :: ${entry.title}`));
  }
  if (result.refactors.length) {
    lines.push(...result.refactors.map((entry) => `- ${entry.id} :: ${entry.title}`));
  }

  return lines.length > 1 ? lines.join("\n") : "Nenhuma code action encontrada nesta posicao.";
}

async function lspApplyCodeActionAction(action, workspaceRoot = process.cwd()) {
  return await lspApplyCodeAction(action, workspaceRoot);
}

async function lspRenameAction(action, workspaceRoot = process.cwd()) {
  const result = await lspRename(action, workspaceRoot);
  return `Rename aplicado: ${result.displayName || "simbolo"} -> ${action.newName}. Arquivos alterados: ${result.changedFiles}. Ocorrencias: ${result.changedLocations}.`;
}

async function gitStatusAction(action, workspaceRoot = process.cwd()) {
  const cwd = action?.cwd ? expandPathInput(action.cwd, workspaceRoot) : workspaceRoot;
  return `Git status em ${await ensureGitWorkspace(cwd)}:\n${await gitStatus(cwd)}`;
}

async function gitCreateBranchAction(action, workspaceRoot = process.cwd()) {
  const cwd = action?.cwd ? expandPathInput(action.cwd, workspaceRoot) : workspaceRoot;
  return await gitCreateBranch(cwd, action?.name, action?.fromRef || "HEAD", Boolean(action?.checkout));
}

async function gitWorktreeAddAction(action, workspaceRoot = process.cwd()) {
  const cwd = action?.cwd ? expandPathInput(action.cwd, workspaceRoot) : workspaceRoot;
  return await gitWorktreeAdd(cwd, action?.path, action?.branch, {
    createBranch: Boolean(action?.createBranch),
    fromRef: action?.fromRef
  });
}

async function gitWorktreeListAction(action, workspaceRoot = process.cwd()) {
  const cwd = action?.cwd ? expandPathInput(action.cwd, workspaceRoot) : workspaceRoot;
  const worktrees = await gitWorktreeList(cwd);
  return worktrees.length
    ? `Worktrees:\n${worktrees
        .map((entry) => `- ${entry.path}${entry.branch ? ` (${entry.branch})` : ""}${entry.detached ? " [detached]" : ""}`)
        .join("\n")}`
    : "Nenhuma worktree encontrada.";
}

async function gitWorktreeRemoveAction(action, workspaceRoot = process.cwd()) {
  const cwd = action?.cwd ? expandPathInput(action.cwd, workspaceRoot) : workspaceRoot;
  return await gitWorktreeRemove(cwd, action?.path, {
    force: Boolean(action?.force)
  });
}

async function agentSpawnAction(action, context = {}) {
  if (!context.runtime) {
    throw new Error("agent_spawn exige acesso ao runtime.");
  }
  const agent = await context.runtime.spawnAgent({
    name: action?.name,
    objective: action?.objective,
    routeId: action?.routeId,
    provider: action?.provider,
    taskId: action?.taskId,
    useGit: action?.useGit,
    useWorktree: action?.useWorktree,
    orchestrate: action?.orchestrate,
    openTerminal: action?.openTerminal,
    branchName: action?.branchName,
    worktreePath: action?.worktreePath,
    cloudApiKey: context.cloudApiKey || ""
  });
  return `Subagente iniciado: ${agent.id} (${agent.name})${agent.worktreePath ? ` em ${agent.worktreePath}` : ""}`;
}

async function agentListAction(action, context = {}) {
  if (!context.runtime) {
    throw new Error("agent_list exige acesso ao runtime.");
  }
  return `Subagentes:\n${formatAgentList(context.runtime.listAgents())}`;
}

async function agentWaitAction(action, context = {}) {
  if (!context.runtime) {
    throw new Error("agent_wait exige acesso ao runtime.");
  }
  const agent = await context.runtime.waitForAgent(action?.id, action?.timeoutMs);
  return `Subagente ${agent.id}: ${agent.status}\n${agent.summary || "(sem resumo)"}`;
}

async function agentResultAction(action, context = {}) {
  if (!context.runtime) {
    throw new Error("agent_result exige acesso ao runtime.");
  }
  const agent = context.runtime.getAgentRecord(action?.id);
  if (!agent) {
    throw new Error(`Subagente nao encontrado: ${action?.id}`);
  }
  return JSON.stringify(agent, null, 2);
}

async function agentStopAction(action, context = {}) {
  if (!context.runtime) {
    throw new Error("agent_stop exige acesso ao runtime.");
  }
  const agent = await context.runtime.stopAgent(action?.id);
  return `Subagente interrompido: ${agent.id}`;
}

async function setPreviewDeviceAction(action, context = {}) {
  const mode = String(action?.mode || "").trim().toLowerCase() === "mobile" ? "mobile" : "desktop";
  const controlPath = String(context.previewControlPath || process.env.DREAM_PREVIEW_CONTROL_PATH || "").trim();
  if (!controlPath) {
    throw new Error("Bridge de preview nao configurado.");
  }

  const payload = {
    mode,
    source: String(action?.source || context.previewControlSource || "tool"),
    updatedAt: Date.now(),
    requestId: crypto.randomUUID()
  };

  await fs.mkdir(path.dirname(controlPath), { recursive: true });
  await fs.writeFile(controlPath, JSON.stringify(payload, null, 2), "utf8");
  return `Workbench configurado em modo ${mode}.`;
}

async function executeTool(action, context = {}) {
  const type = String(action?.type || "").trim();
  const workspaceRoot = context.workspaceRoot || process.cwd();
  const fullAccessMode = Boolean(context.fullAccessMode);

  if (!fullAccessMode && !LIMITED_TOOL_NAMES.has(type)) {
    throw new Error("Esta acao exige acesso total ao PC. Ative essa opcao para executar.");
  }

  const availability = TOOL_REGISTRY.checkAvailability(type, context);
  if (!availability.available) {
    throw new Error(`Tool indisponivel: ${type}. ${availability.reason || "Sem motivo informado."}`);
  }

  if (type === "open_url") {
    const target = resolveOpenUrlTarget(action?.url, workspaceRoot);
    if (target.kind === "file") {
      if (!existsSync(target.value)) {
        throw new Error(`Arquivo nao encontrado para abrir: ${target.value}`);
      }
      await openDesktopTarget(target.value);
      return `Arquivo aberto: ${target.value}`;
    }
    await openDesktopTarget(target.value);
    return `URL aberta: ${target.display}`;
  }

  if (type === "open_path") {
    const target = resolvePathInputForAction(action?.path, workspaceRoot, context);
    if (!existsSync(target)) {
      throw new Error(`Caminho nao encontrado: ${target}`);
    }
    await openDesktopTarget(target);
    return `Caminho aberto: ${target}`;
  }

  if (type === "reveal_path") {
    const target = resolvePathInputForAction(action?.path, workspaceRoot, context);
    if (!existsSync(target)) {
      throw new Error(`Caminho nao encontrado: ${target}`);
    }
    await revealDesktopTarget(target);
    return `Arquivo/pasta revelado no gerenciador de arquivos: ${target}`;
  }

  if (type === "launch_app") {
    const args = sanitizeArgs(action?.args);
    if (action?.path) {
      const target = expandPathInput(action.path, workspaceRoot);
      const launch = await tryLaunchTarget(target, args, {
        cwd: workspaceRoot
      });
      return `Aplicativo aberto: ${target}${launch.pid ? ` (PID ${launch.pid})` : ""}`;
    }
    return await launchAnyApp(action?.app, args, workspaceRoot);
  }

  if (type === "set_preview_device") {
    return await setPreviewDeviceAction(action, context);
  }
  if (type === "browser_session_state") {
    return await browserSessionStateAction(action, context);
  }
  if (type === "browser_harness") {
    return await browserHarnessAction(action, context);
  }
  if (type === "gateway_control") {
    return await gatewayControlAction(action, context);
  }

  if (type === "create_directory") {
    const target = expandPathInput(action?.path, workspaceRoot);
    await fs.mkdir(target, { recursive: true });
    return `Pasta criada: ${target}`;
  }

  if (type === "write_file") return await writeFileAction(action?.path, action?.content, false, workspaceRoot, context.lspManager);
  if (type === "append_file") return await writeFileAction(action?.path, action?.content, true, workspaceRoot, context.lspManager);
  if (type === "file_edit") return await fileEditAction(action, workspaceRoot, context.lspManager);
  if (type === "apply_patch") return await applyPatchAction(action, workspaceRoot, context.lspManager);
  if (type === "file_rollback") return await fileRollbackAction(action, workspaceRoot, context.lspManager);
  if (type === "read_file") return await readFileAction(action?.path, action?.maxChars, workspaceRoot);
  if (type === "list_directory") return await listDirectoryAction(action?.path || ".", action?.depth, workspaceRoot);
  if (type === "glob_files") return await globFilesAction(action, workspaceRoot);
  if (type === "grep_files") return await grepFilesAction(action, workspaceRoot);
  if (type === "file_symbols") return await fileSymbolsAction(action, workspaceRoot);
  if (type === "workspace_symbols") return await workspaceSymbolsAction(action, workspaceRoot);
  if (type === "lsp_document_symbols") return await lspDocumentSymbolsAction(action, workspaceRoot);
  if (type === "lsp_workspace_symbols") return await lspWorkspaceSymbolsAction(action, workspaceRoot);
  if (type === "lsp_definition") return await lspDefinitionAction(action, workspaceRoot);
  if (type === "lsp_references") return await lspReferencesAction(action, workspaceRoot);
  if (type === "lsp_hover") return await lspHoverAction(action, workspaceRoot);
  if (type === "lsp_code_actions") return await lspCodeActionsAction(action, workspaceRoot);
  if (type === "lsp_apply_code_action") return await lspApplyCodeActionAction(action, workspaceRoot);
  if (type === "lsp_rename") return await lspRenameAction(action, workspaceRoot);
  if (type === "run_command") return await runCommandAction(action, workspaceRoot, context.signal);
  if (type === "todo_write") return await todoWriteAction(action, context);
  if (type === "todo_read") return await todoReadAction(action, context);
  if (type === "task_create") return await taskCreateAction(action, context);
  if (type === "task_list") return await taskListAction(action, context);
  if (type === "task_get") return await taskGetAction(action, context);
  if (type === "task_update") return await taskUpdateAction(action, context);
  if (type === "task_stop") return await taskStopAction(action, context);
  if (type === "task_delete") return await taskDeleteAction(action, context);
  if (type === "task_recover") return await taskRecoverAction(action, context);
  if (type === "task_cleanup_worktree") return await taskCleanupWorktreeAction(action, context);
  if (type === "task_create_pr") return await taskCreatePrAction(action, context);
  if (type === "task_scheduler_tick") return await taskSchedulerTickAction(action, context);
  if (type === "task_logs") return await taskLogsAction(action, context);
  if (type === "project_prepare_vite") return await projectPrepareViteAction(action, workspaceRoot, context);
  if (type === "terminal_open") return await openTerminalSession(action, workspaceRoot, context);
  if (type === "terminal_exec") return await terminalExecAction(action, workspaceRoot, context.signal, context);
  if (type === "terminal_close") return await terminalCloseAction(action);
  if (type === "background_command_start") return await backgroundCommandStart(action, workspaceRoot, context);
  if (type === "background_command_logs") return await backgroundCommandLogs(action, context.signal);
  if (type === "background_command_stop") return await backgroundCommandStop(action);
  if (type === "verify_file") return await verifyFileAction(action, workspaceRoot);
  if (type === "verify_url") return await verifyUrlAction(action);
  if (type === "verify_command") return await verifyCommandAction(action, workspaceRoot, context.signal);
  if (type === "verify_site") return await verifySiteAction(action, workspaceRoot);
  if (type === "browser_check") return await browserCheckAction(action);
  if (type === "browser_control") return await browserControlAction(action, context);
  if (type === "verify_browser_console") return await browserCheckAction(action);
  if (type === "stop_all_local_activity") return await stopAllLocalActivityAction();
  if (type === "set_volume") return await setVolumeAction(action, workspaceRoot, context.signal);
  if (type === "media_control") return await mediaControlAction(action, workspaceRoot, context.signal);
  if (type === "system_query") return await systemQueryAction(action, workspaceRoot, context.signal);
  if (type === "adb_command") return await adbCommandAction(action, workspaceRoot, context.signal);
  if (type === "adb_shell") return await adbShellAction(action, workspaceRoot, context.signal);
  if (type === "fastboot_command") return await fastbootCommandAction(action, workspaceRoot, context.signal);
  if (type === "mcp_list_tools") return await mcpListToolsAction(action, context);
  if (type === "mcp_call") return await mcpCallAction(action, context);
  if (type === "git_status") return await gitStatusAction(action, workspaceRoot);
  if (type === "git_create_branch") return await gitCreateBranchAction(action, workspaceRoot);
  if (type === "git_worktree_add") return await gitWorktreeAddAction(action, workspaceRoot);
  if (type === "git_worktree_list") return await gitWorktreeListAction(action, workspaceRoot);
  if (type === "git_worktree_remove") return await gitWorktreeRemoveAction(action, workspaceRoot);
  if (type === "agent_spawn") return await agentSpawnAction(action, context);
  if (type === "agent_list") return await agentListAction(action, context);
  if (type === "agent_wait") return await agentWaitAction(action, context);
  if (type === "agent_result") return await agentResultAction(action, context);
  if (type === "agent_stop") return await agentStopAction(action, context);
  if (type === "web_fetch") return await webFetchAction(action);
  if (type === "web_search") return await webSearchAction(action);

  throw new Error("Tipo de acao local nao suportado.");
}

function compactLocalEventResult(action, result) {
  const type = String(action?.type || "");
  const text = String(result || "");
  if (type !== "browser_control") {
    return result;
  }

  const lines = text.split(/\r?\n/);
  const keep = lines.filter((line) =>
    /^(BROWSER CONTROL|URL:|HTTP status:|Title:|Render:|Viewport:)/.test(line)
  );
  const section = (title, limit, charLimit = 180) => {
    const pattern = new RegExp(
      `${title}:\\n([\\s\\S]*?)(?:\\n(?:Steps:|Page regions:|Interactive elements:|Text preview:|Console:|Page errors:)|$)`
    );
    const match = text.match(pattern);
    if (!match) {
      return "";
    }
    const body = match[1]
      .split(/\r?\n/)
      .map((line) => compactBrowserControlLine(line, charLimit))
      .filter(Boolean)
      .slice(0, limit)
      .join("\n");
    return body ? `${title}:\n${body}` : "";
  };
  const textPreview = text.match(/Text preview:\n([\s\S]*?)(?:\n(?:Console:|Page errors:)|$)/);
  const compact = [
    ...keep,
    section("Steps", 6),
    section("Page regions", 8),
    section("Interactive elements", 12),
    textPreview ? `Text preview:\n${compactBrowserControlLine(textPreview[1], 500)}` : "",
    section("Console", BROWSER_CONTROL_CONSOLE_LIMIT, 220),
    section("Page errors", BROWSER_CONTROL_CONSOLE_LIMIT, 220)
  ].filter(Boolean).join("\n");

  return compact || truncateText(text, 1200);
}

function createLocalEvent(action, actionKey, ok, result, permissionClass = null) {
  const prefix = ok ? "Acao local executada" : "Falha ao executar acao local";
  const displayResult = compactLocalEventResult(action, result);
  return normalizeLocalEvent({
    id: `local-${crypto.randomUUID()}`,
    actionKey,
    action,
    ok,
    result: displayResult,
    permissionClass,
    content: `${prefix}: ${makeActionLabel(action)}. ${displayResult}`
  });
}

module.exports = {
  FALLBACK_TOOL_PROMPT,
  TOOL_MANIFESTS,
  clampNumber,
  createLocalEvent,
  defaultTerminalShellName,
  executeTool,
  expandPathInput,
  extractActionsFromAssistant,
  getBackgroundProcessSnapshots,
  getLspState,
  getOpenAIToolSchemas,
  getSupportedApps,
  getSupportedTools,
  getTerminalShell,
  getTerminalSessionSnapshots,
  getToolRegistry,
  isPermissionAutoAllowed,
  makeActionLabel,
  normalizePathText,
  normalizeToolResult,
  parseActionPayload,
  permissionClassForAction,
  resolveOpenUrlTarget,
  stopLocalActivityForChat,
  truncateText
};
