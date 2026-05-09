function formatGatewayChatResponse(result = {}) {
  const command = String(result.command || "");
  const platform = result.platformEntry || result.platform || null;
  const platformLabel = platform?.label || platformName(result.platformId || result.platform || "");
  const platformId = String(result.platformId || platform?.id || result.platform || "").trim().toLowerCase();
  const whatsapp = platformId === "whatsapp";
  const status = result.status || {};
  const diagnostics = result.diagnostics || null;
  const bridgeConnected = isBridgeConnected(diagnostics);
  const lines = [];

  if (result.error) {
    lines.push(`Nao consegui executar o gateway${platformLabel ? ` de ${platformLabel}` : ""}: ${result.error}`);
    appendPlatformState(lines, platform);
    appendLogs(lines, diagnostics);
    return lines.join("\n\n");
  }

  if (command === "stop") {
    lines.push(platformLabel
      ? `Parei o gateway e desabilitei ${platformLabel} nesta configuracao.`
      : "Parei o processo do Hermes Gateway.");
    appendRuntimeState(lines, status);
    return lines.join("\n\n");
  }

  if (command === "configure" || command === "configure_secret" || command === "set_secret") {
    lines.push(platformLabel
      ? `Configuração do gateway ${platformLabel} atualizada.`
      : "Configuração do gateway atualizada.");
    const secrets = Array.isArray(result.configuredSecrets) ? result.configuredSecrets : [];
    const fields = Array.isArray(result.configuredFields) ? result.configuredFields : [];
    if (secrets.length) {
      lines.push(`Segredos salvos: ${secrets.join(", ")}.`);
    }
    if (fields.length) {
      lines.push(`Campos atualizados: ${fields.join(", ")}.`);
    }
    appendRuntimeState(lines, status);
    appendPlatformState(lines, platform);
    appendBridgeState(lines, diagnostics);
    appendLogs(lines, diagnostics);
    return lines.join("\n\n");
  }

  const bridgeOperations = new Set(["capabilities", "identity", "groups", "guilds", "channels", "chats", "recent_messages", "pairing_status", "approve_pairing", "revoke_pairing", "clear_pairing", "chat", "send", "edit", "send_media", "typing"]);
  if (bridgeOperations.has(command)) {
    lines.push(platformLabel ? `Operacao ${command} no gateway ${platformLabel}:` : `Operacao ${command} no gateway:`);
    appendRuntimeState(lines, status);
    appendPlatformState(lines, platform);
    appendBridgeState(lines, diagnostics);
    if (result.operationError || result.groupsError) {
      lines.push(result.operationError || result.groupsError);
      if (whatsapp) {
        appendQrImage(lines, diagnostics);
      }
      if (result.operationResult) {
        appendOperationResult(lines, "capabilities", result.operationResult);
      }
      return lines.join("\n\n");
    }
    appendOperationResult(lines, command, result.operationResult || { groups: result.groups || [] });
    return lines.join("\n\n");
  }

  if (command === "status") {
    lines.push(platformLabel ? `Status real do gateway ${platformLabel}:` : "Status real do Hermes Gateway:");
    appendRuntimeState(lines, status);
    appendPlatformState(lines, platform);
    appendBridgeState(lines, diagnostics);
    if (!bridgeConnected) {
      appendQrImage(lines, diagnostics);
    }
    appendLogs(lines, diagnostics);
    return lines.join("\n\n");
  }

  if (bridgeConnected) {
    if (whatsapp) {
      lines.push("WhatsApp esta pareado e o bridge confirmou conexao ativa.");
    } else {
      lines.push(platformLabel
        ? `${platformLabel} esta conectado e o gateway confirmou estado ativo.`
        : "O gateway esta conectado.");
    }
  } else if (status.running) {
    lines.push(platformLabel
      ? `Iniciei o processo real do Hermes Gateway com ${platformLabel} habilitado.`
      : "Iniciei o processo real do Hermes Gateway.");
  } else if (platform && platform.configured === false) {
    lines.push(platformLabel
      ? `Nao iniciei ${platformLabel} porque a configuracao minima ainda nao esta completa.`
      : "Nao iniciei o Hermes Gateway porque a configuracao minima ainda nao esta completa.");
  } else {
    lines.push(platformLabel
      ? `Tentei iniciar o Hermes Gateway com ${platformLabel} habilitado, mas o processo nao ficou rodando.`
      : "Tentei iniciar o Hermes Gateway, mas o processo nao ficou rodando.");
  }
  appendRuntimeState(lines, status);
  appendPlatformState(lines, platform);
  appendBridgeState(lines, diagnostics);
  if (whatsapp && !bridgeConnected && diagnostics?.qrDetected && diagnostics.logs) {
    appendQrImage(lines, diagnostics);
    lines.push(result.pairingTimedOut
      ? "O QR foi gerado, mas o pareamento ainda nao foi confirmado dentro do tempo de espera. Escaneie a imagem acima; depois peça status ou liste os grupos para eu confirmar pelo bridge."
      : `QR/pareamento retornado pela bridge:\n\n\`\`\`text\n${tailText(diagnostics.logs, 5000)}\n\`\`\``);
  } else if (!bridgeConnected && whatsapp) {
    appendQrImage(lines, diagnostics);
    lines.push(diagnostics?.qrImagePath
      ? "Escaneie a imagem acima pelo WhatsApp. Se expirar, peça para reiniciar o gateway do WhatsApp."
      : diagnostics?.qrExpired
        ? "O QR encontrado ja expirou. Peça para reiniciar o pareamento do WhatsApp para gerar um QR novo."
      : "A bridge do WhatsApp iniciou, mas ainda nao recebi o QR no log. Aguarde alguns segundos e peça status do WhatsApp para eu ler novamente a saida real.");
    appendLogs(lines, diagnostics);
  } else {
    appendLogs(lines, diagnostics);
  }
  return lines.join("\n\n");
}

function appendRuntimeState(lines, status = {}) {
  lines.push([
    `Processo gateway: ${status.running ? "rodando" : "parado"}`,
    status.pid ? `PID: ${status.pid}` : "",
    Number.isFinite(status.enabledCount) ? `gateways habilitados: ${status.enabledCount}` : "",
    Number.isFinite(status.configuredCount) ? `gateways prontos: ${status.configuredCount}` : "",
    status.lastError ? `ultimo erro: ${status.lastError}` : ""
  ].filter(Boolean).join("\n"));
}

function appendBridgeState(lines, diagnostics) {
  const health = diagnostics?.bridgeHealth;
  if (!health) {
    return;
  }
  lines.push([
    `Bridge WhatsApp: ${health.reachable ? "respondendo" : "indisponivel"}`,
    health.status ? `estado: ${health.status}` : "",
    Number.isFinite(health.queueLength) ? `fila: ${health.queueLength}` : "",
    Number.isFinite(diagnostics.qrAgeSeconds) && diagnostics.qrDetected ? `QR emitido ha ${diagnostics.qrAgeSeconds}s` : "",
    diagnostics.qrExpired ? "QR expirado: gere um novo QR reiniciando o pareamento." : "",
    diagnostics.qrStale ? "QR antigo ignorado: o bridge nao confirmou que ele ainda esta valido." : "",
    health.error ? `erro do bridge: ${health.error}` : ""
  ].filter(Boolean).join("\n"));
}

function appendPlatformState(lines, platform) {
  if (!platform) {
    return;
  }
  const missing = Array.isArray(platform.missing) ? platform.missing.filter(Boolean) : [];
  const recommended = Array.isArray(platform.missingRecommended) ? platform.missingRecommended.filter(Boolean) : [];
  const setup = platform.setup && typeof platform.setup === "object" ? platform.setup : null;
  lines.push([
    `${platform.label || platform.id}: ${platform.enabled ? "habilitado" : "desabilitado"}`,
    `configuracao minima: ${platform.configured ? "ok" : "faltando"}`,
    setup?.authMode ? `autenticacao: ${setup.authMode}` : "",
    setup?.connectionMode ? `modo: ${setup.connectionMode}` : "",
    setup ? `usa QR: ${setup.usesQr ? "sim" : "nao"}` : "",
    setup?.usesPairingApproval ? "pairing Hermes: aprovacoes por codigo curto" : "",
    missing.length ? `faltando: ${missing.join(", ")}` : "",
    recommended.length ? `recomendado preencher: ${recommended.join(", ")}` : "",
    platform.homeChannel ? `home channel: ${platform.homeChannel}` : "",
    setup?.summary ? `resumo: ${setup.summary}` : "",
    setup?.nextAction ? `proximo passo: ${setup.nextAction}` : ""
  ].filter(Boolean).join("\n"));
}

function appendLogs(lines, diagnostics) {
  if (!diagnostics) {
    return;
  }
  if (!diagnostics.logs) {
    lines.push("Ainda nao encontrei log especifico desta plataforma.");
    return;
  }
  lines.push(`Ultimo log lido${diagnostics.logPath ? ` (${diagnostics.logPath})` : ""}:\n\n\`\`\`text\n${tailText(diagnostics.logs, 2500)}\n\`\`\``);
}

function appendQrImage(lines, diagnostics) {
  const imagePath = String(diagnostics?.qrImagePath || "").trim();
  if (!imagePath) {
    return;
  }
  if (diagnostics?.qrExpired) {
    return;
  }
  lines.push(`QR Code do WhatsApp:\n\n![QR Code do WhatsApp](${imagePath})`);
}

function appendGroups(lines, groups = []) {
  const items = Array.isArray(groups) ? groups : [];
  if (!items.length) {
    lines.push("O bridge esta conectado, mas nao retornou grupos participantes.");
    return;
  }
  const shown = items.slice(0, 30).map((group, index) => {
    const name = String(group.subject || group.name || group.id || "Grupo sem nome").trim();
    const id = String(group.id || "").trim();
    const participants = Number.isFinite(group.participantCount) ? `, ${group.participantCount} participantes` : "";
    return `${index + 1}. ${name}${participants}${id ? `\n   ID: ${id}` : ""}`;
  });
  const suffix = items.length > shown.length ? `\n\nMostrando ${shown.length} de ${items.length} grupos.` : "";
  lines.push(shown.join("\n") + suffix);
}

function appendOperationResult(lines, command, data = {}) {
  if (command === "pairing_status") {
    appendPairingStatus(lines, data);
    return;
  }
  if (command === "approve_pairing") {
    appendPairingApproval(lines, data);
    return;
  }
  if (command === "revoke_pairing") {
    lines.push(data.revoked
      ? `Usuario ${data.userId || ""} removido da lista aprovada.`
      : `Usuario ${data.userId || ""} nao estava aprovado.`);
    appendPairingStatus(lines, data);
    return;
  }
  if (command === "clear_pairing") {
    lines.push(`Pendencias removidas: ${Number.isFinite(data.clearedPending) ? data.clearedPending : 0}.`);
    appendPairingStatus(lines, data);
    return;
  }
  if (command === "capabilities") {
    const operations = Array.isArray(data.operations) ? data.operations : [];
    const lifecycleOperations = Array.isArray(data.lifecycleOperations) ? data.lifecycleOperations : [];
    const setup = data.setup && typeof data.setup === "object" ? data.setup : null;
    if (setup) {
      lines.push([
        `Setup de ${data.label || setup.label || data.platform || "gateway"}:`,
        setup.authMode ? `autenticacao: ${setup.authMode}` : "",
        setup.connectionMode ? `modo: ${setup.connectionMode}` : "",
        `usa QR: ${setup.usesQr ? "sim" : "nao"}`,
        setup.usesPairingApproval ? "pairing Hermes: aprovacoes por codigo curto" : "",
        setup.summary || "",
        setup.nextAction ? `proximo passo: ${setup.nextAction}` : ""
      ].filter(Boolean).join("\n"));
    }
    if (lifecycleOperations.length) {
      lines.push(`Controle disponivel:\n${formatGatewayOperations(lifecycleOperations)}`);
    }
    lines.push(operations.length
      ? `Operacoes diretas expostas:\n${formatGatewayOperations(operations)}`
      : "Operacoes diretas expostas: nenhuma neste Electron para esta plataforma.");
    if (data.unsupportedNote) {
      lines.push(data.unsupportedNote);
    }
    return;
  }
  if (command === "groups") {
    appendGroups(lines, data.groups || []);
    return;
  }
  if (command === "guilds") {
    appendGuilds(lines, data.guilds || []);
    return;
  }
  if (command === "channels") {
    appendChats(lines, data.channels || []);
    return;
  }
  if (command === "chats") {
    appendChats(lines, data.chats || []);
    return;
  }
  if (command === "recent_messages") {
    appendRecentMessages(lines, data.messages || []);
    return;
  }
  if (command === "chat") {
    lines.push([
      `Nome: ${data.name || data.id || "desconhecido"}`,
      `Tipo: ${data.isGroup ? "grupo" : "conversa direta"}`,
      Array.isArray(data.participants) ? `participantes: ${data.participants.length}` : ""
    ].filter(Boolean).join("\n"));
    return;
  }
  if (command === "identity") {
    lines.push(`Resultado:\n\n\`\`\`json\n${JSON.stringify(data, null, 2)}\n\`\`\``);
    return;
  }
  if (command === "send" || command === "edit" || command === "send_media" || command === "typing") {
    lines.push(data.success === false
      ? `Falhou: ${data.error || "sem detalhe"}`
      : `Concluido${data.messageId ? `\nmessageId: ${data.messageId}` : ""}`);
    return;
  }
  lines.push(`Resultado:\n\n\`\`\`json\n${JSON.stringify(data, null, 2)}\n\`\`\``);
}

function formatGatewayOperations(operations = []) {
  return operations.map((operation) => {
    const required = Array.isArray(operation.required) && operation.required.length
      ? ` | exige: ${operation.required.join(", ")}`
      : "";
    const note = operation.note ? ` | ${operation.note}` : "";
    return `- ${operation.command}: ${operation.method || ""} ${operation.endpoint || ""}${operation.requiresConnection ? " | conectado" : ""}${required}${note}`;
  }).join("\n");
}

function appendPairingApproval(lines, data = {}) {
  const approved = data.approved || {};
  const platform = platformName(data.platform || "");
  lines.push([
    `Codigo aprovado para ${platform || "gateway"}.`,
    approved.user_id ? `Usuario autorizado: ${approved.user_id}` : "",
    approved.user_name ? `Nome: ${approved.user_name}` : "",
    "Agora envie /start ou uma nova mensagem ao bot para o gateway continuar a conversa."
  ].filter(Boolean).join("\n"));
  appendPairingStatus(lines, data);
}

function appendPairingStatus(lines, data = {}) {
  const platform = String(data.platform || "").toLowerCase();
  if (platform === "telegram") {
    lines.push("Nota: Telegram nao usa QR code. O token vem do BotFather; codigos curtos de 8 caracteres sao aprovacoes do Hermes para liberar um usuario.");
  } else if (platform === "discord") {
    lines.push("Nota: Discord nao usa QR code. A conexao usa bot token, convite/permissoes do bot e aprovacao Hermes quando a politica exigir.");
  }
  const pending = Array.isArray(data.pending) ? data.pending : [];
  const approved = Array.isArray(data.approvedUsers) ? data.approvedUsers : [];
  lines.push([
    `Pendencias: ${pending.length}`,
    pending.length
      ? pending.slice(0, 10).map((entry, index) => `${index + 1}. ${entry.code || "(sem codigo)"} - ${entry.user_name || entry.user_id || "usuario"} (${entry.age_minutes || 0} min)`).join("\n")
      : "",
    `Usuarios aprovados: ${approved.length}`,
    approved.length
      ? approved.slice(0, 10).map((entry, index) => `${index + 1}. ${entry.user_name || entry.user_id || "usuario"}${entry.user_id ? `\n   ID: ${entry.user_id}` : ""}`).join("\n")
      : ""
  ].filter(Boolean).join("\n"));
}

function appendChats(lines, chats = []) {
  const items = Array.isArray(chats) ? chats : [];
  if (!items.length) {
    lines.push("Nenhuma conversa conhecida retornada pelo bridge.");
    return;
  }
  const shown = items.slice(0, 40).map((chat, index) => {
    const name = String(chat.name || chat.subject || chat.id || "Conversa sem nome").trim();
    const id = String(chat.id || "").trim();
    const kind = chat.isGroup ? "grupo" : "DM";
    const participants = Number.isFinite(chat.participantCount) ? `, ${chat.participantCount} participantes` : "";
    return `${index + 1}. ${name} (${kind}${participants})${id ? `\n   ID: ${id}` : ""}`;
  });
  const suffix = items.length > shown.length ? `\n\nMostrando ${shown.length} de ${items.length} conversas.` : "";
  lines.push(shown.join("\n") + suffix);
}

function appendGuilds(lines, guilds = []) {
  const items = Array.isArray(guilds) ? guilds : [];
  if (!items.length) {
    lines.push("Nenhum servidor retornado pelo gateway.");
    return;
  }
  const shown = items.slice(0, 40).map((guild, index) => {
    const name = String(guild.name || guild.id || "Servidor sem nome").trim();
    const id = String(guild.id || "").trim();
    return `${index + 1}. ${name}${id ? `\n   ID: ${id}` : ""}`;
  });
  const suffix = items.length > shown.length ? `\n\nMostrando ${shown.length} de ${items.length} servidores.` : "";
  lines.push(shown.join("\n") + suffix);
}

function appendRecentMessages(lines, messages = []) {
  const items = Array.isArray(messages) ? messages : [];
  if (!items.length) {
    lines.push("Nenhuma mensagem recente retida pelo bridge.");
    return;
  }
  const shown = items.slice(-20).map((message, index) => {
    const chat = String(message.chatName || message.chatId || "conversa").trim();
    const sender = String(message.senderName || message.senderId || "remetente").trim();
    const body = tailText(message.body || "", 500);
    return `${index + 1}. ${chat} - ${sender}: ${body || "[midia/sem texto]"}`;
  });
  lines.push(shown.join("\n"));
}

function isBridgeConnected(diagnostics) {
  return Boolean(
    diagnostics?.connectedDetected ||
    String(diagnostics?.bridgeHealth?.status || "").toLowerCase() === "connected"
  );
}

function platformName(id) {
  const names = {
    whatsapp: "WhatsApp",
    telegram: "Telegram",
    discord: "Discord",
    slack: "Slack",
    matrix: "Matrix",
    mattermost: "Mattermost",
    signal: "Signal",
    email: "Email",
    sms: "SMS/Twilio",
    webhook: "Webhook",
    api_server: "API Server",
    homeassistant: "Home Assistant",
    dingtalk: "DingTalk",
    feishu: "Feishu",
    wecom: "WeCom",
    weixin: "Weixin",
    bluebubbles: "BlueBubbles",
    qqbot: "QQ Bot",
    yuanbao: "Yuanbao"
  };
  return names[String(id || "")] || String(id || "");
}

function tailText(text, maxChars) {
  const normalized = String(text || "").replace(/\r/g, "").trim();
  const limit = Math.max(500, Number(maxChars || 2500));
  return normalized.length > limit ? normalized.slice(-limit) : normalized;
}

module.exports = {
  formatGatewayChatResponse
};
