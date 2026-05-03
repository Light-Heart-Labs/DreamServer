const fs = require("fs/promises");
const path = require("path");
const crypto = require("crypto");
const { normalizeMessage } = require("../state");
const { extractActionsFromAssistant } = require("../tools");

const MANUS_BASE_URL = "https://api.manus.ai/v2";
const USER_REQUEST_MARKER = "User request:";
const LOCAL_RESULT_MARKER = "Local desktop result:";

function parseTimestamp(timestamp) {
  const numeric = Number(timestamp);
  return Number.isFinite(numeric) ? numeric : Date.now();
}

async function sleep(ms) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function manusRequest(endpoint, options = {}) {
  const response = await fetch(`${MANUS_BASE_URL}/${endpoint}`, {
    method: options.method || "GET",
    headers: {
      "Content-Type": "application/json",
      "x-manus-api-key": options.apiKey
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
    signal: options.signal
  });

  const responseBody = await response.json().catch(() => null);
  if (!response.ok || responseBody?.ok === false) {
    const errorMessage =
      responseBody?.error?.message ||
      responseBody?.message ||
      `Manus request failed with ${response.status}`;
    throw new Error(errorMessage);
  }

  return responseBody;
}

function formatRecentLocalEvents(chat) {
  if (!chat.localEvents.length) {
    return "";
  }

  return chat.localEvents
    .slice(-6)
    .map((event) => `- ${event.content}`)
    .join("\n");
}

function makeAttachmentParts(uploadedAttachments) {
  return uploadedAttachments.map((attachment) => ({
    type: "file",
    file_id: attachment.fileId
  }));
}

function formatMcpPrompt(mcpState) {
  const connected = Array.isArray(mcpState?.connected) ? mcpState.connected : [];
  if (!connected.length) {
    return "";
  }

  return [
    "Connected MCP servers:",
    ...connected.map((server) => `- ${server.name}: ${server.tools.join(", ") || "no tools cached yet"}`),
    "Use mcp_list_tools to inspect servers and mcp_call to invoke server tools."
  ].join("\n");
}

function buildBridgeInstruction(settings, route = null, mcpState = null) {
  const sections = [
    "You are connected to Dream Server Desktop, a Windows shell with structured tools.",
    "When local tools are required, prefer the exact fenced dream-server-action blocks because this provider does not expose native function calling.",
    "When the user asks for a simple direct local action, emit only the needed action block and keep the explanation to one short sentence.",
    "Do not rely on predefined site/project/topic templates. For coding or content generation, author the files from the user's actual request and the observed project state.",
    "When the user asks to build, create or update a frontend, web page, game, HTML/CSS/JS app or visual prototype, treat it as a local coding workflow: create or edit real files with file tools, then open/verify the result in the Workbench preview. Do not answer only with a finished fenced code block.",
    "During coding workflows, prefer visible file operations over dumping source into chat so the Workbench Files and Code panels can show progress as the code is created.",
    "If your response claims that you are performing a local operation, emit the matching action block in that same response. Do not return only a promise to act later.",
    "If the user asks only for code or an explanation, answer normally. If the request requires saving, running, previewing, opening, observing or modifying local state, use action blocks.",
    "Do not turn inspection questions into creation tasks. If the user asks to check/list/verify something, inspect it and report the result instead of scaffolding a new app.",
    "For multi-step coding workflows, keep issuing the next tool calls until the project is actually created, dependencies are installed, the server is running or you are concretely blocked.",
    "For local web app work, choose the smallest appropriate tool sequence for the actual request. project_prepare_vite is available only when a Vite shell is genuinely useful; do not force Vite for every HTML/site request.",
    "For web apps, completion requires verification: server alive, URL responding, expected files present, browser render not blank and no blocking console/build errors. Use verify_file, verify_url, verify_site, browser_check, browser_control or verify_browser_console before final answer.",
    "If verification fails, repair the exact failing file/command, rerun the failed step, verify again, and only then give the final result.",
    "Prefer terminal_open/terminal_exec/terminal_close for shell continuity when project_prepare_vite is not the right fit or when the task needs an interactive shell.",
    "Never stop at terminal_open alone when the task requires shell work. Open the session and immediately continue with terminal_exec or other concrete tools in the same answer.",
    "For questions about the local machine, prefer system_query or a concrete run_command/terminal_exec that returns the requested value immediately instead of only opening a terminal window.",
    "Prefer adb_command, adb_shell and fastboot_command for Android/ADB/fastboot requests.",
    "Use set_volume for system audio changes instead of inventing PowerShell volume commands.",
    "Use media_control for play, pause, next, previous and stop music/media commands instead of opening Spotify, checking spotify:// or inventing unrelated APIs.",
    "Use system_query for concrete local information such as Wi-Fi password, SSID, local IP, hostname and Windows version when those map to the built-in query kinds.",
    "Use browser_control when you need to interact with a page, capture a screenshot, read rendered text, or inspect console/page errors.",
    "Use apply_patch with unified diff for precise code edits when possible. Use file_edit for small anchored edits, and write_file only when creating or intentionally replacing a whole file. If an edit is wrong, use file_rollback with the returned changeId.",
    "Use todo_write/task_* to keep persistent state across longer jobs.",
    "Use git_status, git_create_branch and git_worktree_* for branch/worktree flows.",
    "Use lsp_document_symbols, lsp_workspace_symbols, lsp_definition, lsp_references, lsp_hover, lsp_code_actions, lsp_apply_code_action and lsp_rename for language-aware navigation and edits. JS/TS uses the built-in engine; other languages use external LSP servers when available in PATH.",
    "Use file_symbols and workspace_symbols only as fallback when the language engine is unavailable or the file type is unsupported.",
    "Use agent_spawn and agent_wait when a bounded sub-agent can work independently, and prefer useWorktree=true for repository work when isolation matters.",
    "For self-contained desktop actions such as set_volume, media_control, launch_app, open_url, open_path and a single run_command, emit the needed action block once, then stop.",
    "Do not substitute approximate actions for a system change. If the exact requested local action is not available, say that explicitly instead of opening a related folder or settings page.",
    "When Runtime project memory lists a path or URL, use that exact path/URL for open_path, reveal_path, open_url, file and terminal actions. Never pass a natural-language reference as the path or URL.",
    "Keep natural-language explanation short, then emit the action blocks."
  ];

  if (!settings.fullAccessMode) {
    sections.push(
      "Limited mode: only launch_app, open_url, open_path and reveal_path are allowed."
    );
  } else {
    sections.push(
      "Full mode: create_directory, write_file, append_file, file_edit, apply_patch, file_rollback, read_file, list_directory, glob_files, grep_files, file_symbols, workspace_symbols, lsp_document_symbols, lsp_workspace_symbols, lsp_definition, lsp_references, lsp_hover, lsp_code_actions, lsp_apply_code_action, lsp_rename, todo_write, todo_read, task_create, task_list, task_get, task_update, task_stop, run_command, terminal_open, terminal_exec, terminal_close, background_command_start, background_command_logs, background_command_stop, project_prepare_vite, verify_file, verify_url, verify_command, verify_site, browser_check, browser_control, verify_browser_console, stop_all_local_activity, adb_command, adb_shell, fastboot_command, git_status, git_create_branch, git_worktree_add, git_worktree_list, git_worktree_remove, agent_spawn, agent_list, agent_wait, agent_result, agent_stop, set_volume, media_control and system_query are also allowed."
    );
    sections.push(
      "set_volume example:\n```dream-server-action\n{\"type\":\"set_volume\",\"level\":25}\n```"
    );
  }

  sections.push(
    "Example:\n```dream-server-action\n{\"type\":\"launch_app\",\"app\":\"notepad\"}\n```"
  );

  if (route?.prompt) {
    sections.push(route.prompt);
  }

  const mcpPrompt = formatMcpPrompt(mcpState);
  if (mcpPrompt) {
    sections.push(mcpPrompt);
  }

  return sections.join("\n\n");
}

function buildMessagePayload(text, settings, chat, options = {}) {
  const mode = options.mode || "user";
  const uploadedAttachments = Array.isArray(options.uploadedAttachments)
    ? options.uploadedAttachments
    : [];
  let content = text;

  if (settings.desktopBridgeEnabled) {
    const segments = [buildBridgeInstruction(settings, options.route || null, options.mcpState || null)];
    const localHistory = formatRecentLocalEvents(chat);
    if (localHistory) {
      segments.push(`Recent local desktop results:\n${localHistory}`);
    }
    if (options.projectMemory) {
      segments.push(String(options.projectMemory));
    }
    const marker = mode === "local_result" ? LOCAL_RESULT_MARKER : USER_REQUEST_MARKER;
    segments.push(`${marker}\n${text}`);
    content = segments.join("\n\n");
  }

  const parts = [];
  if (content) {
    parts.push({
      type: "text",
      text: content
    });
  }
  parts.push(...makeAttachmentParts(uploadedAttachments));

  const message = {
    content: parts.length === 1 && parts[0].type === "text" ? parts[0].text : parts
  };

  if (settings.connectorIds.length) {
    message.connectors = settings.connectorIds;
  }
  if (settings.enableSkillIds.length) {
    message.enable_skills = settings.enableSkillIds;
  }
  if (settings.forceSkillIds.length) {
    message.force_skills = settings.forceSkillIds;
  }

  return message;
}

function extractWrappedContent(content) {
  const raw = String(content || "");
  const marker = raw.includes(LOCAL_RESULT_MARKER)
    ? LOCAL_RESULT_MARKER
    : raw.includes(USER_REQUEST_MARKER)
      ? USER_REQUEST_MARKER
      : null;

  if (!marker) {
    return {
      content: raw,
      hidden: false
    };
  }

  const [, tail = ""] = raw.split(marker);
  return {
    content: tail.trim() || raw,
    hidden: marker === LOCAL_RESULT_MARKER
  };
}

function normalizeRemoteMessage(event) {
  if (event.type === "user_message") {
    const wrapped = extractWrappedContent(event.user_message?.content || "");
    return {
      id: String(event.id || crypto.randomUUID()),
      kind: "user",
      content: wrapped.content,
      timestamp: parseTimestamp(event.timestamp),
      hidden: wrapped.hidden,
      attachments: Array.isArray(event.user_message?.attachments)
        ? event.user_message.attachments
        : [],
      actions: []
    };
  }

  if (event.type === "assistant_message") {
    const extracted = extractActionsFromAssistant(String(event.assistant_message?.content || ""));
    return {
      id: String(event.id || crypto.randomUUID()),
      kind: "assistant",
      content: extracted.body,
      timestamp: parseTimestamp(event.timestamp),
      attachments: Array.isArray(event.assistant_message?.attachments)
        ? event.assistant_message.attachments
        : [],
      actions: extracted.actions
    };
  }

  if (event.type === "status_update") {
    return {
      id: String(event.id || crypto.randomUUID()),
      kind: "status",
      status: String(event.status_update?.agent_status || "unknown"),
      brief: event.status_update?.brief ? String(event.status_update.brief) : null,
      description: event.status_update?.description
        ? String(event.status_update.description)
        : null,
      waiting: event.status_update?.status_detail || null,
      content: "",
      timestamp: parseTimestamp(event.timestamp)
    };
  }

  return {
    id: String(event.id || crypto.randomUUID()),
    kind: "system",
    content: JSON.stringify(event, null, 2),
    timestamp: parseTimestamp(event.timestamp),
    actions: []
  };
}

function latestStatusFromMessages(messages) {
  const statusMessages = messages.filter((message) => message.kind === "status");
  return statusMessages[statusMessages.length - 1]?.status || null;
}

async function uploadAttachment(apiKey, attachmentPath) {
  const filename = path.basename(attachmentPath);
  const bytes = await fs.readFile(attachmentPath);
  const createResponse = await manusRequest("file.upload", {
    method: "POST",
    apiKey,
    body: { filename }
  });

  const uploadResponse = await fetch(createResponse.upload_url, {
    method: "PUT",
    headers: {
      "Content-Length": String(bytes.byteLength)
    },
    body: bytes
  });

  if (!uploadResponse.ok) {
    throw new Error(`Falha ao enviar o anexo ${filename}.`);
  }

  let fileInfo = createResponse.file;
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const detailResponse = await manusRequest(
      `file.detail?file_id=${encodeURIComponent(createResponse.file.id)}`,
      { apiKey }
    );
    fileInfo = detailResponse.file;

    if (fileInfo.status === "uploaded") {
      return {
        fileId: fileInfo.id,
        filename: fileInfo.filename,
        contentType: fileInfo.content_type || null,
        size: fileInfo.bytes || null
      };
    }

    if (fileInfo.status === "error") {
      throw new Error(fileInfo.error_message || `Falha ao processar o anexo ${filename}.`);
    }

    await sleep(350);
  }

  throw new Error(`O anexo ${filename} ainda nao ficou pronto para uso na API do Manus.`);
}

async function uploadAttachments(apiKey, attachmentPaths = []) {
  const uploaded = [];
  for (const attachmentPath of attachmentPaths) {
    uploaded.push(await uploadAttachment(apiKey, attachmentPath));
  }
  return uploaded;
}

function sameOptimisticMessage(localMessage, remoteMessage) {
  if (localMessage.kind !== "user" || !localMessage.pending || localMessage.hidden) {
    return false;
  }

  return (
    remoteMessage.kind === "user" &&
    !remoteMessage.hidden &&
    remoteMessage.content.trim() === localMessage.content.trim()
  );
}

function mergeOptimisticMessages(existingMessages, remoteMessages) {
  const pendingMessages = existingMessages.filter((message) => message.pending);
  const survivors = pendingMessages.filter(
    (localMessage) => !remoteMessages.some((remoteMessage) => sameOptimisticMessage(localMessage, remoteMessage))
  );

  return [...remoteMessages, ...survivors].sort((left, right) => left.timestamp - right.timestamp);
}

async function listAllTaskMessages(apiKey, taskId) {
  let cursor = null;
  const messages = [];

  for (let page = 0; page < 10; page += 1) {
    const query = new URLSearchParams({
      task_id: taskId,
      order: "asc",
      limit: "100"
    });

    if (cursor) {
      query.set("cursor", cursor);
    }

    const response = await manusRequest(`task.listMessages?${query.toString()}`, { apiKey });
    if (Array.isArray(response.messages)) {
      messages.push(...response.messages);
    }

    if (!response.has_more || !response.next_cursor) {
      break;
    }

    cursor = response.next_cursor;
  }

  return messages;
}

function diffAssistantText(previousMessages, nextMessages) {
  const previousMap = new Map(
    previousMessages
      .filter((entry) => entry.kind === "assistant")
      .map((entry) => [entry.id, String(entry.content || "")])
  );
  const deltas = [];

  for (const entry of nextMessages) {
    if (entry.kind !== "assistant") {
      continue;
    }
    const previous = previousMap.get(entry.id) || "";
    if (entry.content.startsWith(previous) && entry.content.length > previous.length) {
      deltas.push({
        messageId: entry.id,
        delta: entry.content.slice(previous.length)
      });
    }
  }

  return deltas;
}

async function syncTaskMessagesIntoChat(apiKey, chat) {
  const responseMessages = await listAllTaskMessages(apiKey, chat.taskId);
  const remoteMessages = responseMessages.map(normalizeRemoteMessage);
  const mergedMessages = mergeOptimisticMessages(chat.messages, remoteMessages);
  const latestStatus = latestStatusFromMessages(mergedMessages);
  const deltas = diffAssistantText(chat.messages, mergedMessages);

  chat.messages = mergedMessages.map((entry) => normalizeMessage(entry));
  chat.status = latestStatus || chat.status || "idle";
  chat.updatedAt = Date.now();

  return {
    deltas,
    status: chat.status
  };
}

async function createOrSendTurn(options) {
  const {
    apiKey,
    chat,
    settings,
    text,
    attachmentPaths = [],
    route,
    mcpState,
    projectMemory,
    signal
  } = options;

  const uploadedAttachments = await uploadAttachments(apiKey, attachmentPaths);
  const message = buildMessagePayload(text, settings, chat, {
    mode: "user",
    uploadedAttachments,
    route,
    mcpState,
    projectMemory
  });

  if (chat.taskId) {
    await manusRequest("task.sendMessage", {
      method: "POST",
      apiKey,
      signal,
      body: {
        task_id: chat.taskId,
        message
      }
    });
    return {
      taskId: chat.taskId,
      taskUrl: chat.taskUrl || null
    };
  }

  const response = await manusRequest("task.create", {
    method: "POST",
    apiKey,
    signal,
    body: {
      message,
      locale: settings.locale,
      interactive_mode: settings.interactiveMode,
      agent_profile: settings.agentProfile
    }
  });

  chat.taskId = response.task_id;
  chat.taskUrl = response.task_url || null;

  return {
    taskId: chat.taskId,
    taskUrl: chat.taskUrl
  };
}

async function sendManusTurn(options) {
  const {
    apiKey,
    chat,
    settings,
    text,
    attachmentPaths = [],
    route,
    mcpState,
    projectMemory,
    signal,
    onAssistantDelta
  } = options;

  await createOrSendTurn({
    apiKey,
    chat,
    settings,
    text,
    attachmentPaths,
    route,
    mcpState,
    projectMemory,
    signal
  });

  const start = Date.now();
  const maxWaitMs = 180000;
  while (!signal?.aborted) {
    const syncResult = await syncTaskMessagesIntoChat(apiKey, chat);
    if (typeof onAssistantDelta === "function") {
      syncResult.deltas.forEach((entry) => onAssistantDelta(entry.delta, entry.messageId));
    }

    const running = String(syncResult.status || "").toLowerCase() === "running";
    if (!running) {
      return {
        taskId: chat.taskId,
        taskUrl: chat.taskUrl,
        status: chat.status
      };
    }

    if (Date.now() - start > maxWaitMs) {
      throw new Error("O Manus nao concluiu a resposta dentro do tempo limite configurado.");
    }

    await sleep(650);
  }

  throw new Error("A execucao foi interrompida.");
}

async function sendLocalExecutionResult(apiKey, settings, chat, summaryText) {
  await manusRequest("task.sendMessage", {
    method: "POST",
    apiKey,
    body: {
      task_id: chat.taskId,
      message: buildMessagePayload(summaryText, settings, chat, {
        mode: "local_result"
      })
    }
  });
}

module.exports = {
  manusRequest,
  sendLocalExecutionResult,
  sendManusTurn,
  syncTaskMessagesIntoChat
};
