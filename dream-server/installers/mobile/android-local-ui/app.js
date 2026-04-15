const appShellEl = document.querySelector(".mobile-shell");
const sidebarEl = document.getElementById("sidebar");
const sidebarScrimEl = document.getElementById("sidebarScrim");
const openSidebarButtonEl = document.getElementById("openSidebarButton");
const closeSidebarButtonEl = document.getElementById("closeSidebarButton");
const topbarTitleEl = document.getElementById("topbarTitle");
const runtimePillEl = document.getElementById("runtimePill");
const sessionBadgeEl = document.getElementById("sessionBadge");
const statusTextEl = document.getElementById("statusText");
const latencyHintEl = document.getElementById("latencyHint");
const resetButtonEl = document.getElementById("resetButton");
const messagesEl = document.getElementById("messages");
const formEl = document.getElementById("chatForm");
const inputEl = document.getElementById("messageInput");
const sendButtonEl = document.getElementById("sendButton");
const stopButtonEl = document.getElementById("stopButton");
const attachmentInputEl = document.getElementById("attachmentInput");
const attachmentButtonEl = document.getElementById("attachButton");
const attachmentListEl = document.getElementById("attachmentList");
const goToChatButtonEl = document.getElementById("goToChatButton");
const previewChatButtonEl = document.getElementById("previewChatButton");
const modelsGridEl = document.getElementById("modelsGrid");
const modelsActiveChipEl = document.getElementById("modelsActiveChip");

const prefersPortuguese = (navigator.language || "").toLowerCase().startsWith("pt");
const ui = prefersPortuguese
  ? {
      app: "Dream Server Mobile",
      dashboard: "Dashboard",
      chat: "Chat",
      overview: "Visao geral + telemetria",
      modelSession: "Sessao do modelo local",
      heroKicker: "ANDROID LOCAL COCKPIT",
      heroTitle: "Dream Server Mobile Lite",
      heroLede:
        "Qwen local no Termux, telemetria real do aparelho, localhost no Chrome e um cockpit inspirado no dashboard do Dream Server desktop.",
      runtimeLive: "Localhost ativo",
      runtimeWarming: "Aquecendo sessao",
      runtimeCold: "Sessao fria",
      openChat: "Abrir chat",
      chatReady: "Pronto.",
      chatThinking: "Dream esta respondendo localmente...",
      chatFailed: "A sessao local falhou.",
      waitingFirstReply: "Aguardando a primeira resposta...",
      welcome:
        "Sessao local Android online. Pergunte qualquer coisa e eu vou transmitir a resposta conforme ela for sendo gerada.",
      placeholder: "Pergunte algo, peça um resumo ou teste uma tarefa local curta...",
      reset: "Resetar sessao",
      assistant: "Dream",
      you: "Voce",
      sidebarSession: "Sessao",
      sidebarDevice: "Aparelho",
      sidebarExports: "Exports",
      sidebarMemory: "Memoria",
      sidebarRuntime: "Android Lite",
      featureChatCopy: "Conversa persistente com o modelo local rodando dentro do Termux.",
      featureDashboardCopy: "Um cockpit localhost mobile mais proximo da linguagem visual do Dream Server real.",
      featureExportCopy: "Arquivos gerados podem ir para o Downloads do Android quando o storage compartilhado estiver ligado.",
      featureBetaCopy: "Versao lite beta: ainda nao e a malha completa do desktop, mas ja inclui uma ponte local de acoes para abrir apps e executar automacoes simples.",
      responsePreviewFallback:
        "A sessao local ainda esta aquecendo. Quando uma resposta chegar, um preview vai aparecer aqui.",
      telemetryTitle: "Telemetria de inferencia",
      chartLatency: "Latencia da resposta",
      chartCpu: "Carga da CPU",
      chartMemory: "Pressao de memoria",
      chartBattery: "Bateria",
      servicesTitle: "Superficie mobile",
      servicesOnline: "Online",
      servicesLimited: "Limitado",
      servicesInactive: "Desktop only",
      chatPanelTitle: "Converse com o Dream localmente",
      models: "Models",
      modelsMeta: "Trocar GGUF local",
      modelsHeroTitle: "Biblioteca de modelos locais",
      modelsHeroLede: "Veja o GGUF atual, teste um preset Android mais forte e troque a sessao local sem recompilar o runtime.",
      modelsCurrent: "Modelo atual",
      modelsActionUse: "Usar modelo",
      modelsActionInstall: "Baixar e usar",
      modelsBusy: "Baixando modelo...",
      attach: "Anexar imagem ou PDF",
      attachOnlyMessage: "[anexos enviados]",
      stop: "Parar",
      stopped: "Geracao interrompida.",
      composerLabel: "Mensagem",
      send: "Enviar",
      resetStatus: "Sessao resetada.",
    }
  : {
      app: "Dream Server Mobile",
      dashboard: "Dashboard",
      chat: "Chat",
      overview: "Overview + telemetry",
      modelSession: "Local model session",
      heroKicker: "ANDROID LOCAL COCKPIT",
      heroTitle: "Dream Server Mobile Lite",
      heroLede:
        "Local Qwen on Termux, real phone telemetry, localhost in Chrome, and a cockpit that borrows the language of the Dream Server desktop dashboard.",
      runtimeLive: "Localhost live",
      runtimeWarming: "Warming session",
      runtimeCold: "Session cold",
      openChat: "Open Chat",
      chatReady: "Ready.",
      chatThinking: "Dream is responding locally...",
      chatFailed: "The local session failed.",
      waitingFirstReply: "Waiting for the first reply...",
      welcome:
        "Local Android session online. Ask anything and I will stream the answer as it is generated.",
      placeholder: "Ask about code, request a summary, or test a quick local task...",
      reset: "Reset session",
      assistant: "Dream",
      you: "You",
      sidebarSession: "Session",
      sidebarDevice: "Device",
      sidebarExports: "Exports",
      sidebarMemory: "Memory",
      sidebarRuntime: "Android Lite",
      featureChatCopy: "Persistent conversation with the model running directly inside Termux.",
      featureDashboardCopy: "A localhost mobile cockpit that feels closer to the real Dream Server dashboard.",
      featureExportCopy: "Generated files can land in Android Downloads when shared storage is linked.",
      featureBetaCopy: "Lite beta scope: still not the full desktop mesh, but it now includes a local action bridge for opening apps and simple device automation.",
      responsePreviewFallback:
        "The local session is still warming up. Once a reply lands, a preview will appear here.",
      telemetryTitle: "Inference telemetry",
      chartLatency: "Reply latency",
      chartCpu: "CPU load",
      chartMemory: "Memory pressure",
      chartBattery: "Battery",
      servicesTitle: "Mobile surface",
      servicesOnline: "Online",
      servicesLimited: "Limited",
      servicesInactive: "Desktop only",
      chatPanelTitle: "Talk to Dream locally",
      models: "Models",
      modelsMeta: "Switch local GGUF",
      modelsHeroTitle: "Local model library",
      modelsHeroLede: "See the current GGUF, try a stronger Android preset, and switch the local session without rebuilding the runtime.",
      modelsCurrent: "Current model",
      modelsActionUse: "Use model",
      modelsActionInstall: "Download and use",
      modelsBusy: "Downloading model...",
      attach: "Attach image or PDF",
      attachOnlyMessage: "[attachments sent]",
      stop: "Stop",
      stopped: "Generation stopped.",
      composerLabel: "Message",
      send: "Send",
      resetStatus: "Session reset.",
    };

const state = {
  activeView: "dashboardView",
  status: null,
  histories: {
    latency: [],
    cpu: [],
    memory: [],
    battery: [],
  },
  lastAssistantPreview: "",
  models: [],
  attachments: [],
  currentController: null,
  stopRequestedByUser: false,
};

function setText(id, value) {
  const el = document.getElementById(id);
  if (el) el.textContent = value ?? "-";
}

function formatPercent(value) {
  if (value == null || Number.isNaN(value)) return "--";
  return `${Math.round(Number(value))}%`;
}

function formatMs(value) {
  if (value == null || Number.isNaN(value)) return "--";
  if (value >= 1000) return `${(value / 1000).toFixed(1)} s`;
  return `${Math.round(value)} ms`;
}

function formatTemp(value) {
  if (value == null || Number.isNaN(value)) return prefersPortuguese ? "sem sensor" : "no sensor";
  return `${Number(value).toFixed(1)} C`;
}

function formatUptime(seconds) {
  if (!seconds) return "--";
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  if (days > 0) return `${days}d ${hours}h ${mins}m`;
  if (hours > 0) return `${hours}h ${mins}m`;
  return `${mins}m`;
}

function summarizeExportPath(path) {
  if (!path) return "-";
  if (path.includes("/data/data/com.termux/")) return "/data/data/com.termux/...";
  if (path.includes("/storage/emulated/0/Download")) return "/storage/emulated/0/Download/...";
  if (path.includes("/storage/emulated/0/Downloads")) return "/storage/emulated/0/Downloads/...";
  return compactText(path, 36);
}

function compactText(text, limit = 140) {
  if (!text) return ui.responsePreviewFallback;
  const normalized = text.replace(/\s+/g, " ").trim();
  if (normalized.length <= limit) return normalized;
  return `${normalized.slice(0, limit - 1)}…`;
}

function normalizeAssistantText(text) {
  return text
    .replace(/^\s*(assistant>|Assistant:)\s*/i, "")
    .replace(/<\/?think>/gi, "")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/^\s+/, "");
}

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("failed to read file"));
    reader.readAsDataURL(file);
  });
}

function renderAttachments() {
  if (!attachmentListEl) return;
  attachmentListEl.innerHTML = "";

  state.attachments.forEach((item) => {
    const chip = document.createElement("div");
    chip.className = "attachment-chip";
    const label = document.createElement("span");
    label.textContent = item.name;
    const remove = document.createElement("button");
    remove.type = "button";
    remove.textContent = "×";
    remove.setAttribute("aria-label", "Remove attachment");
    remove.addEventListener("click", () => {
      state.attachments = state.attachments.filter((entry) => entry.id !== item.id);
      renderAttachments();
    });
    chip.append(label, remove);
    attachmentListEl.appendChild(chip);
  });
}

function appendMessage(role, body) {
  const wrapper = document.createElement("div");
  wrapper.className = `message ${role}`;

  const roleEl = document.createElement("div");
  roleEl.className = "message-role";
  roleEl.textContent = role === "user" ? ui.you : ui.assistant;

  const bodyEl = document.createElement("div");
  bodyEl.className = "message-body";
  bodyEl.textContent = body;

  wrapper.append(roleEl, bodyEl);
  messagesEl.appendChild(wrapper);
  messagesEl.scrollTop = messagesEl.scrollHeight;
  return bodyEl;
}

function openSidebar() {
  appShellEl.classList.add("sidebar-open");
}

function closeSidebar() {
  appShellEl.classList.remove("sidebar-open");
}

function switchView(viewId) {
  state.activeView = viewId;
  document.querySelectorAll(".view").forEach((el) => {
    el.classList.toggle("is-active", el.id === viewId);
  });
  document.querySelectorAll(".nav-item").forEach((el) => {
    el.classList.toggle("is-active", el.dataset.viewTarget === viewId);
  });
  topbarTitleEl.textContent = viewId === "chatView" ? ui.chat : viewId === "modelsView" ? ui.models : ui.dashboard;
  closeSidebar();
}

function pushHistory(key, value) {
  if (value == null || Number.isNaN(value)) return;
  const list = state.histories[key];
  list.push(Number(value));
  if (list.length > 18) list.shift();
}

function buildChartPath(values, width = 420, height = 170) {
  if (!values.length) return { line: "", area: "", x: 20, y: 130 };
  const paddingX = 20;
  const paddingTop = 18;
  const paddingBottom = 24;
  const usableWidth = width - paddingX * 2;
  const usableHeight = height - paddingTop - paddingBottom;
  const max = Math.max(...values, 1);
  const points = values.map((value, index) => {
    const x = paddingX + (usableWidth / Math.max(values.length - 1, 1)) * index;
    const y = height - paddingBottom - (value / max) * usableHeight;
    return { x, y };
  });

  let line = `M ${points[0].x.toFixed(2)} ${points[0].y.toFixed(2)}`;
  for (let index = 1; index < points.length; index += 1) {
    line += ` L ${points[index].x.toFixed(2)} ${points[index].y.toFixed(2)}`;
  }
  const lastPoint = points[points.length - 1];
  const area = `${line} L ${lastPoint.x.toFixed(2)} ${height - paddingBottom} L ${points[0].x.toFixed(2)} ${height - paddingBottom} Z`;
  return { line, area, x: lastPoint.x, y: lastPoint.y };
}

function renderChart(values, pathId, areaId, dotId) {
  const { line, area, x, y } = buildChartPath(values);
  const pathEl = document.getElementById(pathId);
  const areaEl = document.getElementById(areaId);
  const dotEl = document.getElementById(dotId);
  if (pathEl) pathEl.setAttribute("d", line);
  if (areaEl) areaEl.setAttribute("d", area);
  if (dotEl) {
    dotEl.setAttribute("cx", String(x));
    dotEl.setAttribute("cy", String(y));
  }
}

function buildServices(snapshot) {
  const session = snapshot.session || {};
  const exportsInfo = snapshot.exports || {};
  const battery = snapshot.battery || {};
  const gpu = snapshot.gpu || {};
  const automation = snapshot.automation || {};

  return {
    online: [
      {
        title: prefersPortuguese ? "AI Chat" : "AI Chat",
        detail: session.ready
          ? `${session.turns || 0} ${prefersPortuguese ? "turnos na sessao local" : "turns in the local session"}`
          : prefersPortuguese
            ? "Sessao em aquecimento no Termux"
            : "Session warming inside Termux",
      },
      {
        title: prefersPortuguese ? "Dashboard Local" : "Local Dashboard",
        detail: snapshot.local_url || "http://127.0.0.1:8765",
      },
    ],
    limited: [
      {
        title: prefersPortuguese ? "Action Bridge" : "Action Bridge",
        detail: automation.summary
          || (prefersPortuguese
            ? "Automacao local pronta para abrir apps e executar acoes simples."
            : "Local automation is ready for app launching and simple actions."),
      },
      {
        title: prefersPortuguese ? "Exports" : "Exports",
        detail: summarizeExportPath(exportsInfo.dir || exportsInfo.dir_short || ""),
      },
      {
        title: prefersPortuguese ? "GPU Telemetry" : "GPU Telemetry",
        detail: gpu.available
          ? `${gpu.busy_percent != null ? `${gpu.busy_percent}%` : gpu.status} • ${gpu.label || "Adreno"}`
          : prefersPortuguese
            ? "Kernel Android nao expoe todos os contadores"
            : "Android kernel does not expose all counters",
      },
      {
        title: prefersPortuguese ? "Battery API" : "Battery API",
        detail: battery.available
          ? `${battery.status || "ready"} • ${battery.source || "sysfs"}`
          : prefersPortuguese
            ? "Sensor ou permissao indisponivel"
            : "Sensor or permission unavailable",
      },
    ],
    inactive: [
      {
        title: prefersPortuguese ? "Voice Assistant" : "Voice Assistant",
        detail: prefersPortuguese ? "Fora do escopo da versao mobile lite" : "Out of scope for the mobile lite build",
      },
      {
        title: prefersPortuguese ? "Full Control Center" : "Full Control Center",
        detail: prefersPortuguese ? "A interface mobile espelha a linguagem visual, nao o stack inteiro" : "The mobile UI mirrors the look, not the full stack",
      },
    ],
  };
}

function renderServiceList(targetId, items) {
  const root = document.getElementById(targetId);
  if (!root) return;
  root.innerHTML = "";
  items.forEach((item) => {
    const card = document.createElement("div");
    card.className = "service-item";

    const title = document.createElement("strong");
    title.textContent = item.title;

    const detail = document.createElement("span");
    detail.textContent = item.detail;

    card.append(title, detail);
    root.appendChild(card);
  });
}

function renderModels() {
  if (!modelsGridEl) return;
  modelsGridEl.innerHTML = "";

  (state.models || []).forEach((model) => {
    const card = document.createElement("article");
    card.className = "model-card";

    const head = document.createElement("div");
    head.className = "model-head";

    const titleWrap = document.createElement("div");
    const title = document.createElement("h3");
    title.className = "model-name";
    title.textContent = model.name;
    const repo = document.createElement("p");
    repo.className = "model-repo";
    repo.textContent = model.repo;
    titleWrap.append(title, repo);

    const pills = document.createElement("div");
    pills.className = "model-pills";
    if (model.active) {
      const activePill = document.createElement("span");
      activePill.className = "model-pill model-pill--active";
      activePill.textContent = prefersPortuguese ? "ativo" : "active";
      pills.appendChild(activePill);
    }
    if (model.installed) {
      const installedPill = document.createElement("span");
      installedPill.className = "model-pill model-pill--installed";
      installedPill.textContent = prefersPortuguese ? "baixado" : "downloaded";
      pills.appendChild(installedPill);
    }
    const sizePill = document.createElement("span");
    sizePill.className = "model-pill";
    sizePill.textContent = `${model.size_mb} MB`;
    pills.appendChild(sizePill);

    head.append(titleWrap, pills);

    const summary = document.createElement("p");
    summary.className = "model-summary";
    summary.textContent = model.summary;

    const actions = document.createElement("div");
    actions.className = "model-actions";
    const action = document.createElement("button");
    action.className = "model-action";
    action.disabled = !!model.active;
    action.textContent = model.installed ? ui.modelsActionUse : ui.modelsActionInstall;
    action.addEventListener("click", async () => {
      action.disabled = true;
      action.textContent = ui.modelsBusy;
      try {
        await selectModel(model.id);
        statusTextEl.textContent = prefersPortuguese ? "Modelo trocado com sucesso." : "Model switched successfully.";
      } catch (error) {
        statusTextEl.textContent = `${prefersPortuguese ? "Erro de modelo" : "Model error"}: ${error.message}`;
      } finally {
        renderModels();
      }
    });
    actions.append(action);

    card.append(head, summary, actions);
    modelsGridEl.appendChild(card);
  });
}

async function refreshModels() {
  const response = await fetch("/api/models", { cache: "no-store" });
  const payload = await response.json();
  if (!payload.ok) {
    throw new Error(payload.error || "failed to load models");
  }
  state.models = payload.models || [];
  renderModels();
}

async function selectModel(modelId) {
  const response = await fetch("/api/models/select", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model_id: modelId }),
  });
  const payload = await response.json();
  if (!payload.ok) {
    throw new Error(payload.error || "failed to switch model");
  }
  state.models = payload.models || [];
  renderModels();
  await refreshStatus();
}

function updateStaticCopy() {
  document.documentElement.lang = prefersPortuguese ? "pt-BR" : "en";
  setText("brandKicker", prefersPortuguese ? "LOCAL AI // TERMUX" : "LOCAL AI // TERMUX");
  setText("brandSubtitle", prefersPortuguese ? "Mobile Lite Beta" : "Mobile Lite Beta");
  setText("navDashboardLabel", ui.dashboard);
  setText("navDashboardMeta", ui.overview);
  setText("navChatLabel", ui.chat);
  setText("navChatMeta", ui.modelSession);
  setText("navModelsLabel", ui.models);
  setText("navModelsMeta", ui.modelsMeta);
  setText("topbarEyebrow", ui.app);
  setText("heroKicker", ui.heroKicker);
  setText("heroTitle", ui.heroTitle);
  setText("heroLede", ui.heroLede);
  goToChatButtonEl.textContent = ui.openChat;
  previewChatButtonEl.textContent = ui.openChat;
  setText("featureChatCopy", ui.featureChatCopy);
  setText("featureDashboardCopy", ui.featureDashboardCopy);
  setText("featureExportCopy", ui.featureExportCopy);
  setText("featureBetaCopy", ui.featureBetaCopy);
  setText("modelsHeroTitle", ui.modelsHeroTitle);
  setText("modelsHeroLede", ui.modelsHeroLede);
  setText("modelsActiveChip", ui.modelsCurrent);
  if (attachmentButtonEl) attachmentButtonEl.textContent = ui.attach;
  if (stopButtonEl) stopButtonEl.textContent = ui.stop;
  setText("telemetryTitle", ui.telemetryTitle);
  setText("chartLatencyLabel", ui.chartLatency);
  setText("chartCpuLabel", ui.chartCpu);
  setText("chartMemoryLabel", ui.chartMemory);
  setText("chartBatteryLabel", ui.chartBattery);
  setText("servicesTitle", ui.servicesTitle);
  setText("servicesOnlineTitle", ui.servicesOnline);
  setText("servicesLimitedTitle", ui.servicesLimited);
  setText("servicesInactiveTitle", ui.servicesInactive);
  setText("chatPanelTitle", ui.chatPanelTitle);
  setText("assistantLabel", ui.assistant);
  setText("welcomeMessage", ui.welcome);
  setText("composerLabel", ui.composerLabel);
  inputEl.placeholder = ui.placeholder;
  sendButtonEl.textContent = ui.send;
  resetButtonEl.textContent = ui.reset;
  setText("sidebarSessionLabel", ui.sidebarSession);
  setText("sidebarDeviceLabel", ui.sidebarDevice);
  setText("sidebarExportLabel", ui.sidebarExports);
  setText("sidebarMemoryLabel", ui.sidebarMemory);
  setText("sidebarRuntimeLabel", ui.sidebarRuntime);
  setText("responsePreview", ui.responsePreviewFallback);
  setText("statusText", ui.chatReady);
  setText("latencyHint", ui.waitingFirstReply);
}

function updateStatus(snapshot) {
  state.status = snapshot;
  const { model, cpu, gpu, battery, memory, storage, exports: exportsInfo, local_url: localUrl, device, session, uptime_s: uptimeS } = snapshot;

  pushHistory("latency", session?.last_latency_ms ?? null);
  pushHistory("cpu", cpu?.usage_percent ?? null);
  pushHistory("memory", memory?.used_percent ?? null);
  pushHistory("battery", Number(battery?.level));

  renderChart(state.histories.latency, "latencyPath", "latencyArea", "latencyDot");
  renderChart(state.histories.memory, "memoryPath", "memoryArea", "memoryDot");

  const deviceLabel = [device?.manufacturer, device?.model].filter(Boolean).join(" ");
  const androidLabel = device?.android ? `Android ${device.android}` : "Android";
  const exportLabel = summarizeExportPath(exportsInfo?.dir || exportsInfo?.dir_short || "");
  const uptimeValue = uptimeS || (session?.started_at ? Math.max(1, Math.round((Date.now() / 1000) - session.started_at)) : null);
  const sessionLabel = session?.ready
    ? prefersPortuguese
      ? `Sessao pronta • ${session.turns || 0} turnos`
      : `Session ready • ${session.turns || 0} turns`
    : session?.warming
      ? prefersPortuguese ? "Aquecendo sessao" : "Warming session"
      : prefersPortuguese ? "Sessao fria" : "Session cold";

  topbarTitleEl.textContent = state.activeView === "chatView" ? ui.chat : state.activeView === "modelsView" ? ui.models : ui.dashboard;
  runtimePillEl.textContent = session?.ready ? ui.runtimeLive : session?.warming ? ui.runtimeWarming : ui.runtimeCold;
  sessionBadgeEl.textContent = sessionLabel;
  setText("sidebarSession", sessionLabel);
  setText("sidebarDevice", `${deviceLabel || "Android"} • ${androidLabel}`);
  setText("sidebarExport", exportLabel);
  setText("sidebarModelName", model?.name || "Qwen mobile");
  setText("deviceChip", `${deviceLabel || "Android"} • ${androidLabel}`);
  setText("localUrlChip", localUrl || "http://127.0.0.1:8765");
  setText("runtimePill", session?.ready ? ui.runtimeLive : ui.runtimeWarming);
  setText("featureChatStatus", session?.ready ? "READY" : "WARMING");
  setText("featureExportStatus", exportsInfo?.dir && exportsInfo?.dir.includes("/downloads") ? "READY" : "FALLBACK");

  const cpuSummary = cpu?.usage_percent != null ? `${cpu.usage_percent.toFixed(1)}%` : "--";
  const cpuMeta = [
    cpu?.cores ? `${cpu.cores} ${prefersPortuguese ? "nucleos" : "cores"}` : null,
    cpu?.load_1 != null ? `${prefersPortuguese ? "load" : "load"} ${cpu.load_1}/${cpu.load_5}` : null,
    cpu?.temp_c != null ? `${cpu.temp_c.toFixed(1)} C` : null,
  ].filter(Boolean).join(" • ");

  setText("cpuCardValue", cpuSummary);
  setText("cpuCardMeta", cpuMeta || (prefersPortuguese ? "Telemetria da CPU indisponivel" : "CPU telemetry unavailable"));
  setText("cpuUsageValue", cpuSummary);
  setText("cpuValue", cpuSummary);
  setText("chartTempChip", cpu?.temp_c != null ? `CPU ${cpu.temp_c.toFixed(1)} C` : "CPU --");

  const gpuValue = gpu?.available
    ? gpu?.busy_percent != null
      ? `${gpu.busy_percent}%`
      : gpu?.freq || "live"
    : prefersPortuguese
      ? "Limitado"
      : "Limited";
  const gpuMeta = gpu?.available
    ? [gpu.label, gpu.freq || gpu.status, gpu.max_freq ? `/ ${gpu.max_freq}` : null].filter(Boolean).join(" • ")
    : prefersPortuguese
      ? "O kernel do Android nao expoe frequencia/ocupacao completas da GPU"
      : "The Android kernel is not exposing full GPU frequency/busy counters";

  setText("gpuCardValue", gpuValue);
  setText("gpuCardMeta", gpuMeta);

  const batteryValue = battery?.available && battery?.level != null ? `${battery.level}%` : "--";
  const batteryMeta = battery?.available
    ? [battery.status || (prefersPortuguese ? "desconhecido" : "unknown"), battery.temp_c != null ? `${battery.temp_c.toFixed(1)} C` : null, battery.health || null]
        .filter(Boolean)
        .join(" • ")
    : prefersPortuguese
      ? "Bateria indisponivel ou sem permissao"
      : "Battery unavailable or missing permission";

  setText("batteryCardValue", batteryValue);
  setText("batteryCardMeta", batteryMeta);
  setText("batteryValue", batteryValue);

  const memoryValue = memory?.available ? `${memory.used_gb} / ${memory.total_gb} GB` : "--";
  const memoryMeta = memory?.available
    ? `${memory.used_percent}% ${prefersPortuguese ? "ocupado" : "used"}`
    : prefersPortuguese
      ? "Sem leitura de memoria"
      : "No memory telemetry";

  setText("memoryCardValue", memoryValue);
  setText("memoryCardMeta", memoryMeta);
  setText("memoryValue", memoryMeta);
  setText("sidebarMemoryValue", memory?.available ? `${memory.used_percent}%` : "--");
  const sidebarFill = document.getElementById("sidebarMemoryFill");
  if (sidebarFill) sidebarFill.style.width = `${Math.min(memory?.used_percent || 0, 100)}%`;

  setText("storageMeta", storage?.available ? `${storage.export_free_gb} GB ${prefersPortuguese ? "livres" : "free"}` : "--");
  setText("uptimeCardValue", formatUptime(uptimeValue));
  setText(
    "uptimeCardMeta",
    uptimeS
      ? (device?.chip ? `${device.chip}` : androidLabel)
      : (prefersPortuguese ? "fallback da sessao local" : "local session fallback"),
  );
  setText("modelCardValue", model?.name || "--");
  setText("modelCardMeta", model?.path_short || model?.path || "--");
  setText("modelName", model?.name || "--");
  setText("modelCardLabel", prefersPortuguese ? "Modelo" : "Model");
  setText("chartContextChip", `Context ${model?.context ?? "--"}`);
  setText("modelsActiveChip", `${ui.modelsCurrent}: ${model?.name || "--"}`);
  setText("chatMetaContext", `Context ${model?.context ?? "--"}`);
  setText("chatMetaTurns", `${prefersPortuguese ? "Turnos" : "Turns"} ${session?.turns ?? 0}`);
  setText("chatMetaLatency", `${prefersPortuguese ? "Ultima" : "Last"} ${formatMs(session?.last_latency_ms)}`);

  const services = buildServices(snapshot);
  renderServiceList("servicesOnline", services.online);
  renderServiceList("servicesLimited", services.limited);
  renderServiceList("servicesInactive", services.inactive);

  if (session?.last_reply_chars) {
    setText(
      "responsePreview",
      state.lastAssistantPreview || ui.responsePreviewFallback,
    );
  }
}

async function refreshStatus() {
  const response = await fetch("/api/status", { cache: "no-store" });
  const payload = await response.json();
  if (!payload.ok) {
    throw new Error(payload.error || "failed to load status");
  }
  updateStatus(payload.status);
}

async function streamMessage(message, assistantBodyEl) {
  state.currentController = new AbortController();
  const response = await fetch("/api/chat-stream", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    signal: state.currentController.signal,
    body: JSON.stringify({
      message,
      locale: navigator.language || "",
      attachments: state.attachments.map((item) => ({
        name: item.name,
        type: item.type,
        data_base64: item.dataBase64,
      })),
    }),
  });

  if (!response.ok || !response.body) {
    const fallback = await response.text();
    throw new Error(fallback || "local chat failed");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let accumulated = "";

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";

    for (const line of lines) {
      if (!line.trim()) continue;
      const event = JSON.parse(line);
      if (event.type === "chunk") {
        accumulated += event.text || "";
        assistantBodyEl.textContent = normalizeAssistantText(accumulated);
        messagesEl.scrollTop = messagesEl.scrollHeight;
      } else if (event.type === "tool") {
        const summary = event.summary
          || (prefersPortuguese ? "Executando acao local..." : "Running local action...");
        statusTextEl.textContent = summary;
        if (!accumulated) {
          assistantBodyEl.textContent = summary;
        }
      } else if (event.type === "done") {
        latencyHintEl.textContent = `${prefersPortuguese ? "Ultima resposta" : "Last reply"}: ${formatMs(event.latency_ms)}`;
      } else if (event.type === "stopped") {
        throw new DOMException("stopped", "AbortError");
      } else if (event.type === "error") {
        throw new Error(event.error || "local chat failed");
      }
    }
  }

  return normalizeAssistantText(accumulated).trim();
}

async function stopCurrentChat() {
  if (!state.currentController) return;
  state.stopRequestedByUser = true;
  try {
    await fetch("/api/chat-stop", { method: "POST" });
  } catch {
    // Best effort.
  }
  state.currentController.abort();
}

attachmentButtonEl.addEventListener("click", () => {
  attachmentInputEl.click();
});

attachmentInputEl.addEventListener("change", async (event) => {
  const files = Array.from(event.target.files || []);
  if (!files.length) return;

  const accepted = files.slice(0, 3).filter((file) => {
    return file.type.startsWith("image/") || file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
  });

  for (const file of accepted) {
    const dataBase64 = await fileToDataUrl(file);
    state.attachments.push({
      id: `${file.name}-${file.size}-${Date.now()}-${Math.random()}`,
      name: file.name,
      type: file.type || (file.name.toLowerCase().endsWith(".pdf") ? "application/pdf" : "application/octet-stream"),
      dataBase64,
    });
  }

  attachmentInputEl.value = "";
  renderAttachments();
});

stopButtonEl.addEventListener("click", async () => {
  await stopCurrentChat();
});

formEl.addEventListener("submit", async (event) => {
  event.preventDefault();
  const message = inputEl.value.trim();
  if (!message && !state.attachments.length) return;

  appendMessage("user", message || ui.attachOnlyMessage);
  inputEl.value = "";
  inputEl.focus();

  const assistantBodyEl = appendMessage("assistant", "");
  assistantBodyEl.classList.add("is-streaming");
  state.stopRequestedByUser = false;
  sendButtonEl.disabled = true;
  stopButtonEl.disabled = false;
  statusTextEl.textContent = ui.chatThinking;

  try {
    const reply = await streamMessage(message, assistantBodyEl);
    assistantBodyEl.classList.remove("is-streaming");
    assistantBodyEl.textContent = reply || (prefersPortuguese ? "(sem resposta visivel)" : "(no visible response)");
    state.lastAssistantPreview = compactText(reply);
    setText("responsePreview", state.lastAssistantPreview);
    statusTextEl.textContent = ui.chatReady;
    state.attachments = [];
    renderAttachments();
    await refreshStatus();
    } catch (error) {
      assistantBodyEl.classList.remove("is-streaming");
      if (error?.name === "AbortError" || state.stopRequestedByUser) {
        assistantBodyEl.textContent = assistantBodyEl.textContent || ui.stopped;
        statusTextEl.textContent = ui.stopped;
      } else {
        if (assistantBodyEl.textContent.trim()) {
          assistantBodyEl.textContent = `${assistantBodyEl.textContent.trim()}\n\n${prefersPortuguese ? "[interrompido localmente]" : "[stopped locally]"} ${error.message}`;
        } else {
          assistantBodyEl.textContent = `${prefersPortuguese ? "Erro local" : "Local error"}: ${error.message}`;
        }
        statusTextEl.textContent = ui.chatFailed;
      }
  } finally {
    state.currentController = null;
    state.stopRequestedByUser = false;
    sendButtonEl.disabled = false;
    stopButtonEl.disabled = true;
  }
});

resetButtonEl.addEventListener("click", async () => {
  resetButtonEl.disabled = true;
  try {
    await fetch("/api/reset", { method: "POST" });
    messagesEl.innerHTML = "";
    appendMessage("assistant", ui.welcome);
    statusTextEl.textContent = ui.resetStatus;
    latencyHintEl.textContent = ui.waitingFirstReply;
    state.lastAssistantPreview = "";
    state.attachments = [];
    renderAttachments();
    setText("responsePreview", ui.responsePreviewFallback);
    await refreshStatus();
  } finally {
    resetButtonEl.disabled = false;
  }
});

document.querySelectorAll("[data-view-target]").forEach((button) => {
  button.addEventListener("click", () => switchView(button.dataset.viewTarget));
});

goToChatButtonEl.addEventListener("click", () => switchView("chatView"));
previewChatButtonEl.addEventListener("click", () => switchView("chatView"));
openSidebarButtonEl.addEventListener("click", openSidebar);
closeSidebarButtonEl.addEventListener("click", closeSidebar);
sidebarScrimEl.addEventListener("click", closeSidebar);

updateStaticCopy();
renderAttachments();
stopButtonEl.disabled = true;
refreshStatus().catch((error) => {
  statusTextEl.textContent = error.message;
});
refreshModels().catch(() => {});
setInterval(() => {
  refreshStatus().catch(() => {});
}, 4000);
