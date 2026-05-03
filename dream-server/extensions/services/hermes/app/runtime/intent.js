const ROUTES = {
  "android-device": {
    label: "Android",
    prompt:
      "Route: android-device. Prefer adb_command, adb_shell and fastboot_command. Keep commands concrete and state device-side risks before destructive changes."
  },
  "coding-project": {
    label: "Coding",
    prompt:
      "Route: coding-project. Use a plan-execute-observe-verify-repair-final loop. For new Vite/local web apps, use project_prepare_vite for the technical shell, then write the requested code, verify files/server/browser with verify_site/browser_control when needed, and only then open the URL or final response."
  },
  "desktop-quick": {
    label: "Desktop",
    prompt:
      "Route: desktop-quick. Execute only the exact local desktop action requested. Do not substitute nearby actions when the target is unclear."
  },
  "local-diagnostics": {
    label: "System",
    prompt:
      "Route: local-diagnostics. Inspect local ports, processes, URLs and dev servers. Never scaffold or create a project for an inspection question."
  },
  "system-query": {
    label: "System",
    prompt:
      "Route: system-query. Prefer system_query or concrete read-only commands that return the requested machine information immediately."
  },
  "web-research": {
    label: "Web",
    prompt:
      "Route: web-research. Prefer web_search and web_fetch before guessing facts or links. Do not run local desktop commands for web lookup."
  },
  "general-purpose": {
    label: "General",
    prompt:
      "Route: general-purpose. If intent confidence is low, ask or answer normally instead of executing high-impact tools."
  }
};

const TOOL_POLICIES = {
  inspect_localhost: {
    enforceAllowed: true,
    allowedTools: [
      "run_command",
      "terminal_open",
      "terminal_exec",
      "terminal_close",
      "background_command_logs",
      "verify_url",
      "verify_command",
      "system_query",
      "read_file",
      "list_directory",
      "glob_files",
      "grep_files",
      "git_status"
    ],
    blockedTools: [
      "create_directory",
      "project_prepare_vite",
      "write_file",
      "append_file",
      "file_edit",
      "apply_patch",
      "background_command_start",
      "launch_app",
      "open_path",
      "open_url",
      "reveal_path",
      "set_volume",
      "media_control",
      "adb_command",
      "adb_shell",
      "fastboot_command",
      "mcp_call",
      "git_create_branch",
      "git_worktree_add",
      "git_worktree_remove",
      "agent_spawn"
    ]
  },
  system_query: {
    enforceAllowed: true,
    allowedTools: [
      "system_query",
      "run_command",
      "terminal_open",
      "terminal_exec",
      "terminal_close",
      "read_file",
      "list_directory",
      "glob_files",
      "grep_files",
      "verify_command",
      "git_status"
    ],
    blockedTools: [
      "launch_app",
      "open_path",
      "open_url",
      "reveal_path",
      "create_directory",
      "project_prepare_vite",
      "write_file",
      "append_file",
      "file_edit",
      "apply_patch",
      "background_command_start",
      "set_volume",
      "media_control",
      "adb_command",
      "adb_shell",
      "fastboot_command",
      "mcp_call",
      "git_create_branch",
      "git_worktree_add",
      "git_worktree_remove",
      "agent_spawn"
    ]
  },
  web_research: {
    enforceAllowed: true,
    allowedTools: ["web_search", "web_fetch", "open_url", "read_file", "list_directory", "grep_files"],
    blockedTools: [
      "run_command",
      "terminal_open",
      "terminal_exec",
      "background_command_start",
      "project_prepare_vite",
      "create_directory",
      "write_file",
      "append_file",
      "file_edit",
      "apply_patch",
      "set_volume",
      "media_control",
      "adb_command",
      "adb_shell",
      "fastboot_command",
      "mcp_call",
      "git_create_branch",
      "git_worktree_add",
      "git_worktree_remove",
      "agent_spawn"
    ]
  },
  unknown: {
    enforceAllowed: false,
    allowedTools: [],
    blockedTools: [
      "run_command",
      "terminal_open",
      "terminal_exec",
      "background_command_start",
      "project_prepare_vite",
      "create_directory",
      "write_file",
      "append_file",
      "file_edit",
      "apply_patch",
      "set_volume",
      "media_control",
      "adb_command",
      "adb_shell",
      "fastboot_command",
      "mcp_call",
      "git_create_branch",
      "git_worktree_add",
      "git_worktree_remove",
      "agent_spawn"
    ]
  }
};

const PROJECT_SCAFFOLD_PATTERN =
  /\b(npm\s+create|pnpm\s+create|bun\s+create|yarn\s+create|create-vite|vite@latest|npm\s+install|npm\s+run\s+dev|pnpm\s+dev|bun\s+run\s+dev)\b/;

function includesAny(source, patterns) {
  return patterns.some((pattern) => pattern.test(source));
}

function clampConfidence(score) {
  return Math.max(0, Math.min(0.99, Number((score / 100).toFixed(2))));
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function normalizeText(text = "") {
  return String(text || "").trim().toLowerCase();
}

function scoreIntent(id, routeId, label, score, reasons, policyId = id) {
  const policy = TOOL_POLICIES[policyId] || {
    enforceAllowed: false,
    allowedTools: [],
    blockedTools: []
  };
  return {
    id,
    routeId,
    label,
    confidence: clampConfidence(score),
    reasons: unique(reasons),
    allowedTools: [...policy.allowedTools],
    blockedTools: [...policy.blockedTools],
    enforceAllowed: Boolean(policy.enforceAllowed)
  };
}

function classifyIntent(text = "") {
  const source = normalizeText(text);
  if (!source) {
    return scoreIntent("unknown", "general-purpose", ROUTES["general-purpose"].label, 0, ["empty"], "unknown");
  }

  const signals = {
    inspectVerb: includesAny(source, [
      /\b(veja|verifique|ver|cheque|confira|consulte|liste|lista|mostre|procure|descubra|qual|quais|see|check|show|list|find|is there|running|rodando|tem algum)\b/
    ]),
    createVerb: includesAny(source, [
      /\b(create|build|make|scaffold|generate|spin up|crie|faca|faça|monte|gere|inicie|construa|desenvolva|instale|rode|rodar|suba|start)\b/
    ]),
    projectArtifact: includesAny(source, [
      /\b(site|website|landing|page|pagina|p[áa]gina|app|aplicativo|dashboard|frontend|projeto|project|blog|portfolio|portf[oó]lio|loja)\b/
    ]),
    localRun: includesAny(source, [
      /\b(localhost|127\.0\.0\.1|localmente|no meu pc|meu pc|dev server|servidor local|porta|port)\b/
    ]),
    localhostTopic: includesAny(source, [
      /\b(localhost|127\.0\.0\.1|porta|port|servidor local|dev server|site local|url local)\b/
    ]),
    explicitScaffold: includesAny(source, [
      /\b(npm create|pnpm create|bun create|yarn create|create-vite|vite@latest|app em vite|projeto em vite)\b/
    ]),
    codeVerb: includesAny(source, [
      /\b(corrija|arrume|conserte|edite|modifique|altere|implemente|refatore|testar|testes|rode testes|debug|lint|build|commit|branch|worktree|fix|edit|modify|implement|refactor)\b/
    ]),
    codeTopic: includesAny(source, [
      /\b(arquivo|codigo|c[oó]digo|repo|repositorio|reposit[oó]rio|projeto|bug|erro|app|site|vite|javascript|typescript|react|css|html|build|teste|testes)\b/
    ]),
    infoVerb: includesAny(source, [
      /\b(qual|quais|me diga|mostre|show|tell me|get|descubra|pesquise|veja|verifique|procure|lookup|consulte)\b/
    ]),
    localInfoTopic: includesAny(source, [
      /\b(wi-?fi|wifi|wlan|ssid|senha|password|chave|ip|hostname|nome do computador|computer name|windows version|vers[aã]o do windows|rede conectad[ao])\b/
    ]),
    desktopVerb: includesAny(source, [
      /\b(open|launch|start|abra|abrir|inicie|iniciar|mude|troque|altere|ajuste|aumente|abaixe|diminu|reduz|mute|unmute|play|tocar|toque|reproduz|reproduzir|pause|pausa|pausar|proxima|próxima|next|previous|anterior)\b/
    ]),
    desktopTopic: includesAny(source, [
      /\b(volume|som|audio|spotify|musica|música|midia|mídia|media|player|faixa|track|discord|chrome|brave|edge|explorer|notepad|cmd|powershell|calculadora|calc|whatsapp|arquivo|pasta|url)\b/
    ]),
    fileVerb: includesAny(source, [
      /\b(crie|criar|create|escreva|grave|salve|edite|modifique|altere|abra|abrir|mostre|liste|delete|apague|remova|mova|renomeie|write|save|edit|open|list|remove|move|rename)\b/
    ]),
    fileTopic: includesAny(source, [
      /\b(arquivo|file|pasta|folder|diretorio|diret[oó]rio|path|caminho|downloads|desktop|documentos|documents|txt|json|js|ts|html|css|md|png|jpg|pdf|csv|c:\\\\|c:\/)\b/
    ]),
    shellVerb: includesAny(source, [
      /\b(rode|rodar|execute|executar|run|comando|command|shell|terminal|powershell|cmd|bash|script)\b/
    ]),
    androidTopic: includesAny(source, [
      /\b(adb|fastboot|bootloader|recovery|apk|root|magisk|android|celular|device)\b/
    ]),
    searchVerb: includesAny(source, [
      /\b(search|pesquise|busque|procure na web|web search|google|na internet|pela net|pesquisar)\b/
    ]),
    webTopic: includesAny(source, [/\b(web|site|url|http|https|internet|github|docs|documentacao|documenta[cç][aã]o)\b/])
  };

  const candidates = [];

  candidates.push(
    scoreIntent(
      "inspect_localhost",
      "local-diagnostics",
      ROUTES["local-diagnostics"].label,
      (signals.localhostTopic ? 45 : 0) +
        (signals.inspectVerb ? 35 : 0) +
        (signals.localRun ? 10 : 0) -
        (signals.createVerb ? 45 : 0),
      [
        signals.localhostTopic && "localhost topic",
        signals.inspectVerb && "inspection verb",
        signals.createVerb && "creation verb penalty"
      ]
    )
  );

  candidates.push(
    scoreIntent(
      "create_project",
      "coding-project",
      ROUTES["coding-project"].label,
      (signals.explicitScaffold ? 55 : 0) +
        (signals.createVerb ? 35 : 0) +
        (signals.projectArtifact ? 30 : 0) +
        (signals.localRun ? 10 : 0) -
        (signals.inspectVerb && !signals.createVerb ? 50 : 0),
      [
        signals.explicitScaffold && "explicit scaffold",
        signals.createVerb && "creation verb",
        signals.projectArtifact && "project artifact",
        signals.inspectVerb && !signals.createVerb && "inspection penalty"
      ],
      "create_project"
    )
  );

  candidates.push(
    scoreIntent(
      "coding_task",
      "coding-project",
      ROUTES["coding-project"].label,
      (signals.codeVerb ? 40 : 0) +
        (signals.codeTopic ? 30 : 0) +
        (signals.projectArtifact && signals.localRun ? 10 : 0) -
        (signals.inspectVerb && signals.localhostTopic ? 40 : 0),
      [
        signals.codeVerb && "coding verb",
        signals.codeTopic && "coding topic",
        signals.inspectVerb && signals.localhostTopic && "localhost inspection penalty"
      ],
      "coding_task"
    )
  );

  candidates.push(
    scoreIntent(
      "system_query",
      "system-query",
      ROUTES["system-query"].label,
      (signals.infoVerb ? 35 : 0) + (signals.localInfoTopic ? 45 : 0) - (signals.createVerb ? 30 : 0),
      [
        signals.infoVerb && "information verb",
        signals.localInfoTopic && "local system topic",
        signals.createVerb && "creation verb penalty"
      ]
    )
  );

  candidates.push(
    scoreIntent(
      "desktop_control",
      "desktop-quick",
      ROUTES["desktop-quick"].label,
      (signals.desktopVerb ? 35 : 0) + (signals.desktopTopic ? 35 : 0) - (signals.inspectVerb ? 15 : 0),
      [
        signals.desktopVerb && "desktop verb",
        signals.desktopTopic && "desktop target",
        signals.inspectVerb && "inspection penalty"
      ],
      "desktop_control"
    )
  );

  candidates.push(
    scoreIntent(
      "file_operation",
      "desktop-quick",
      ROUTES["desktop-quick"].label,
      (signals.fileVerb ? 35 : 0) + (signals.fileTopic ? 35 : 0) - (signals.inspectVerb && signals.localhostTopic ? 35 : 0),
      [
        signals.fileVerb && "file verb",
        signals.fileTopic && "file/path topic",
        signals.inspectVerb && signals.localhostTopic && "localhost inspection penalty"
      ],
      "file_operation"
    )
  );

  candidates.push(
    scoreIntent(
      "shell_command",
      "desktop-quick",
      ROUTES["desktop-quick"].label,
      (signals.shellVerb ? 40 : 0) +
        (/\b(powershell|cmd|bash|terminal|comando|command|script)\b/.test(source) ? 30 : 0) -
        (signals.inspectVerb && signals.localhostTopic ? 25 : 0),
      [
        signals.shellVerb && "shell verb",
        /\b(powershell|cmd|bash|terminal|comando|command|script)\b/.test(source) && "shell target",
        signals.inspectVerb && signals.localhostTopic && "localhost inspection penalty"
      ],
      "shell_command"
    )
  );

  candidates.push(
    scoreIntent(
      "android_device",
      "android-device",
      ROUTES["android-device"].label,
      (signals.androidTopic ? 70 : 0) + (signals.desktopVerb || signals.codeVerb ? 10 : 0),
      [signals.androidTopic && "android topic"],
      "android_device"
    )
  );

  candidates.push(
    scoreIntent(
      "web_research",
      "web-research",
      ROUTES["web-research"].label,
      (signals.searchVerb ? 45 : 0) + (signals.webTopic ? 25 : 0) - (signals.createVerb ? 25 : 0),
      [
        signals.searchVerb && "search verb",
        signals.webTopic && "web topic",
        signals.createVerb && "creation verb penalty"
      ]
    )
  );

  candidates.sort((left, right) => right.confidence - left.confidence);
  const best = candidates[0];
  const second = candidates[1];
  const ambiguous =
    second && best.confidence >= 0.55 && best.confidence - second.confidence < 0.12 && best.routeId !== second.routeId;
  if (!best || best.confidence < 0.55 || ambiguous) {
    const reason = ambiguous
      ? `ambiguous: ${best?.id || "unknown"} vs ${second?.id || "unknown"}`
      : "low confidence";
    return scoreIntent("unknown", "general-purpose", ROUTES["general-purpose"].label, 35, [reason], "unknown");
  }

  return {
    ...best,
    routePrompt: ROUTES[best.routeId]?.prompt || ROUTES["general-purpose"].prompt
  };
}

function getRouteForIntent(intent) {
  const safeIntent = intent || classifyIntent("");
  const route = ROUTES[safeIntent.routeId] || ROUTES["general-purpose"];
  const policyLine =
    safeIntent.id !== "unknown"
      ? ` Intent: ${safeIntent.id}; confidence: ${safeIntent.confidence.toFixed(2)}. Enforce tool policy before execution.`
      : " Intent unclear; avoid high-impact tools unless the user clarifies.";
  return {
    id: safeIntent.routeId || "general-purpose",
    label: route.label,
    prompt: `${route.prompt}${policyLine}`,
    intent: safeIntent
  };
}

function getRoutingCatalog() {
  return [
    ["desktop-quick", "acoes locais diretas no Windows"],
    ["coding-project", "tarefas de codigo, projeto, scaffolding, build e localhost"],
    ["local-diagnostics", "diagnostico de portas, processos e servidores localhost"],
    ["system-query", "consultas concretas sobre estado local da maquina"],
    ["android-device", "ADB, fastboot, APK, root e shell Android"],
    ["web-research", "busca e fetch da web"],
    ["general-purpose", "fallback seguro quando a intencao nao esta clara"]
  ];
}

function actionPayload(action) {
  return JSON.stringify(action || {}).toLowerCase();
}

function actionLooksLikeProjectScaffold(action) {
  return PROJECT_SCAFFOLD_PATTERN.test(actionPayload(action));
}

function validateActionForIntent(action, intentInput) {
  const intent = typeof intentInput === "string" ? classifyIntent(intentInput) : intentInput || classifyIntent("");
  const type = String(action?.type || "").trim().toLowerCase();
  if (!type) {
    return { ok: false, reason: "Acao sem tipo nao pode ser executada." };
  }

  if (intent.blockedTools?.includes(type)) {
    return {
      ok: false,
      reason: `Intent ${intent.id} bloqueou ${type}. Ferramenta fora do escopo do pedido.`
    };
  }

  if (intent.enforceAllowed && !intent.allowedTools?.includes(type)) {
    return {
      ok: false,
      reason: `Intent ${intent.id} permite apenas ferramentas compativeis com essa tarefa. ${type} foi bloqueada.`
    };
  }

  if (intent.id === "unknown" && intent.confidence < 0.55 && intent.blockedTools?.includes(type)) {
    return {
      ok: false,
      reason: "Intencao com baixa confianca bloqueou ferramenta de alto impacto. Especifique melhor o pedido."
    };
  }

  return { ok: true };
}

function validateBatchForIntent(actions = [], intentInput) {
  const intent = typeof intentInput === "string" ? classifyIntent(intentInput) : intentInput || classifyIntent("");
  for (const action of actions) {
    const validation = validateActionForIntent(action, intent);
    if (!validation.ok) {
      return validation;
    }
  }

  if (["inspect_localhost", "system_query"].includes(intent.id)) {
    const createsProject = actions.some((action) => {
      const type = String(action?.type || "").trim().toLowerCase();
      return (
        ["write_file", "append_file", "file_edit", "apply_patch", "create_directory", "background_command_start"].includes(type) ||
        actionLooksLikeProjectScaffold(action)
      );
    });
    if (createsProject) {
      return {
        ok: false,
        reason:
          "A intencao detectada e informativa/diagnostica. Criar, instalar ou iniciar projeto foi bloqueado."
      };
    }
  }

  return { ok: true };
}

module.exports = {
  ROUTES,
  actionLooksLikeProjectScaffold,
  classifyIntent,
  getRouteForIntent,
  getRoutingCatalog,
  validateActionForIntent,
  validateBatchForIntent
};
