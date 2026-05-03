#!/usr/bin/env node

const fs = require("fs/promises");
const { existsSync } = require("fs");
const os = require("os");
const path = require("path");
const readline = require("readline/promises");
const { stdin, stdout } = require("process");

function loadRuntimeModule(moduleName) {
  const candidates = [
    path.join(__dirname, "..", "runtime", moduleName),
    path.join(
      __dirname.replace(`${path.sep}app.asar.unpacked${path.sep}`, `${path.sep}app.asar${path.sep}`),
      "..",
      "runtime",
      moduleName
    ),
    process.resourcesPath ? path.join(process.resourcesPath, "app.asar", "runtime", moduleName) : ""
  ].filter(Boolean);

  let lastError = null;
  for (const candidate of candidates) {
    try {
      return require(candidate);
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError || new Error(`Unable to load runtime module: ${moduleName}`);
}

const { DreamRuntime } = loadRuntimeModule("core");
const { createDefaultState } = loadRuntimeModule("state");

const STORE_DIR = path.join(os.homedir(), ".dream-server");
const STORE_FILE = path.join(STORE_DIR, "cli-state.json");

async function loadCliState() {
  if (!existsSync(STORE_FILE)) {
    return createDefaultState();
  }

  try {
    const raw = await fs.readFile(STORE_FILE, "utf8");
    return JSON.parse(raw);
  } catch {
    return createDefaultState();
  }
}

async function persistCliState(runtime) {
  await fs.mkdir(STORE_DIR, { recursive: true });
  await fs.writeFile(STORE_FILE, JSON.stringify(runtime.getSnapshot(), null, 2), "utf8");
}

async function main() {
  const runtime = new DreamRuntime({
    initialState: await loadCliState(),
    workspaceRoot: process.cwd()
  });
  if (!runtime.state.selectedChatId) {
    runtime.createChat(runtime.state.settings.providerMode);
  }

  const rl = readline.createInterface({
    input: stdin,
    output: stdout
  });

  runtime.subscribe(async ({ chatId, event }) => {
    if (event.type === "text_delta") {
      stdout.write(event.delta || "");
      return;
    }

    if (event.type === "message_final") {
      stdout.write("\n");
      return;
    }

    if (event.type === "permission_request") {
      const answer = await rl.question(
        `\nPermitir ${event.action?.type || "acao"} [${event.permissionClass}]? (y/N) `
      );
      if (/^y(es)?$/i.test(answer.trim())) {
        await runtime.runSuggestedAction({
          chatId,
          actionKey: event.requestId,
          cloudApiKey: process.env.MANUS_API_KEY || process.env.MANUS_API_KEY_CLOUD || ""
        });
      } else {
        console.log("Negado.");
      }
      return;
    }

    if (event.type === "tool_call_started") {
      console.log(`\n[tool] ${event.action?.type || event.actionKey}`);
      return;
    }

    if (event.type === "tool_call_finished") {
      console.log(`[tool:${event.ok ? "ok" : "erro"}] ${event.result || ""}`);
      return;
    }

    if (event.type === "error") {
      console.log(`\n[erro] ${event.message}`);
      return;
    }

    if (event.type === "task_state_changed") {
      console.log(`\n[estado] ${event.status}`);
    }
  });

  console.log("Dream CLI. Use /help para ver os comandos. Ctrl+C para sair.");
  while (true) {
    const input = await rl.question("> ");
    const trimmed = input.trim();
    if (!trimmed) {
      continue;
    }
    if (trimmed === "/exit") {
      break;
    }

    const chatId = runtime.state.selectedChatId || runtime.createChat().selectedChatId;
    await runtime.sendMessage({
      chatId,
      text: trimmed,
      cloudApiKey: process.env.MANUS_API_KEY || process.env.MANUS_API_KEY_CLOUD || ""
    });
    await persistCliState(runtime);
  }

  await persistCliState(runtime);
  rl.close();
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
