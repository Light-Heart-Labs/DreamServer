const route = new URL(window.location.href);
const isBrowserView = route.pathname === "/api/sim/browser" || route.searchParams.get("view") === "browser";
document.body.classList.toggle("browser-panel", isBrowserView);

const phone = document.querySelector("#phone");
const appView = document.querySelector("#app-view");
const preview = document.querySelector("#preview");
const targetUrl = document.querySelector("#target-url");
const openUrl = document.querySelector("#open-url");
const capture = document.querySelector("#capture");
const describe = document.querySelector("#describe");
const log = document.querySelector("#log");
const withFrame = document.querySelector("#with-frame");
const rotate = document.querySelector("#rotate");
const deviceName = document.querySelector("#device-name");
const deviceFps = document.querySelector("#device-fps");
const deviceRuntime = document.querySelector("#device-runtime");
const reloadApp = document.querySelector("#reload-app");
const appTitle = document.querySelector("#app-title");
const siriButton = document.querySelector("#siri-button");
const siriSheet = document.querySelector("#siri-sheet");
const controlCenterButton = document.querySelector("#control-center-button");
const battery = document.querySelector("#battery");
const network = document.querySelector("#network");
const locationSelect = document.querySelector("#location");
const lockBattery = document.querySelector("#lock-battery");
const brightness = document.querySelector("#brightness");
const volume = document.querySelector("#volume");
const textInput = document.querySelector("#text-input");
const sendText = document.querySelector("#send-text");
const statusTime = document.querySelector("#status-time");
const lockTime = document.querySelector("#lock-time");
const lockDate = document.querySelector("#lock-date");
const shadeTime = document.querySelector("#shade-time");
const shadeDate = document.querySelector("#shade-date");
const safeToggle = document.querySelector("#safe-toggle");
const scale = document.querySelector("#scale");
const scaleReadout = document.querySelector("#scale-readout");
const captureTray = document.querySelector("#capture-tray");
const captureCount = document.querySelector("#capture-count");
const toast = document.querySelector("#system-toast");
const touchRipple = document.querySelector("#touch-ripple");
const screen = document.querySelector(".screen");
const safariUrlInput = document.querySelector("#safari-url");
const safariBack = document.querySelector("#safari-back");
const safariForward = document.querySelector("#safari-forward");
const safariShare = document.querySelector("#safari-share");
const safariBookmarks = document.querySelector("#safari-bookmarks");
const safariTabs = document.querySelector("#safari-tabs");
const safariTabsSheet = document.querySelector("#safari-tabs-sheet");
const safariNewTab = document.querySelector("#safari-new-tab");
const safariStatus = document.querySelector("#safari-status");
const safariTabTitle = document.querySelector("#safari-tab-title");
const safariTabUrl = document.querySelector("#safari-tab-url");
const safariTabCount = document.querySelector("#safari-tab-count");
const safariPageSettings = document.querySelector("#safari-page-settings");
const scenarioName = document.querySelector("#scenario-name");
const scenarioState = document.querySelector("#scenario-state");
const scenarioCount = document.querySelector("#scenario-count");
const eventCount = document.querySelector("#event-count");
const driverKind = document.querySelector("#driver-kind");
const recordScenario = document.querySelector("#record-scenario");
const stopScenario = document.querySelector("#stop-scenario");
const replayScenario = document.querySelector("#replay-scenario");
const snapshotUi = document.querySelector("#snapshot-ui");
const exportBundle = document.querySelector("#export-bundle");
const clearScenario = document.querySelector("#clear-scenario");
const driverStatus = document.querySelector("#driver-status");
const copyScenario = document.querySelector("#copy-scenario");

const defaultAppUrl = "http://localhost:8420/api/sim/demo-app";

const state = {
  mode: "app",
  lastAppUrl: defaultAppUrl,
  currentAppKind: "native",
  lastModeBeforeControl: "app",
  frame: true,
  orientation: "portrait",
  theme: "light",
  battery: 82,
  volume: 54,
  brightness: 100,
  network: "Wi-Fi",
  location: "Sao Paulo",
  scale: isBrowserView ? 92 : 100,
  safeArea: false,
  captures: [],
  pendingWorkbenchPreview: null,
  safariHistory: [defaultAppUrl],
  safariIndex: 0,
  safariTabs: 1,
  safariLoadedOnce: false,
  runtimeEvents: [],
  lastHierarchy: null,
  lastBundle: null,
  driver: "web-shell",
  scenario: {
    name: "Hermes reproduce path",
    recording: false,
    replaying: false,
    startedAt: 0,
    lastActionAt: 0,
    actions: []
  }
};

const runtimeLimit = 250;

function sleep(ms) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function nowParts() {
  const now = new Date();
  return {
    time: now.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }),
    date: now.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })
  };
}

function writeLog(message, payload) {
  const suffix = payload ? `\n${JSON.stringify(payload, null, 2)}` : "";
  log.textContent = `${new Date().toLocaleTimeString()} ${message}${suffix}`;
}

function pushRuntimeEvent(type, payload = {}) {
  const event = {
    type,
    time: new Date().toISOString(),
    appMode: state.mode,
    url: state.lastAppUrl,
    ...payload
  };
  state.runtimeEvents.unshift(event);
  state.runtimeEvents = state.runtimeEvents.slice(0, runtimeLimit);
  updateScenarioUi();
  return event;
}

function updateScenarioUi() {
  if (!scenarioState) return;
  const scenario = state.scenario;
  const status = scenario.replaying ? "Replaying" : scenario.recording ? "Recording" : "Idle";
  scenarioState.textContent = status;
  scenarioCount.textContent = String(scenario.actions.length);
  eventCount.textContent = String(state.runtimeEvents.length);
  driverKind.textContent = state.driver;
  recordScenario.disabled = scenario.recording || scenario.replaying;
  stopScenario.disabled = !scenario.recording;
  replayScenario.disabled = scenario.recording || scenario.replaying || !scenario.actions.length;
  exportBundle.disabled = scenario.recording || scenario.replaying;
  recordScenario.classList.toggle("recording", scenario.recording);
}

function compactText(value, max = 96) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, max);
}

function formatRuntimeValue(value) {
  if (typeof value === "string") return value;
  if (value instanceof Error) return `${value.name}: ${value.message}`;
  if (value instanceof Element) return `<${value.tagName.toLowerCase()} ${selectorFor(value)}>`;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function elementLabel(element) {
  if (!element) return "";
  if (element.getAttribute?.("aria-label")) return compactText(element.getAttribute("aria-label"));
  if (element.getAttribute?.("alt")) return compactText(element.getAttribute("alt"));
  if (element.getAttribute?.("title")) return compactText(element.getAttribute("title"));
  if ("value" in element && element.value) return compactText(element.value);
  return compactText(element.innerText || element.textContent || element.name || element.id || element.tagName);
}

function selectorFor(element, root = document) {
  if (!element || element === root || element === document || element === document.documentElement) return "";
  if (element.id) return `#${CSS.escape(element.id)}`;

  const stableAttributes = ["data-open-mode", "data-app", "data-gesture", "data-control", "data-key", "aria-label", "name"];
  for (const attribute of stableAttributes) {
    const value = element.getAttribute?.(attribute);
    if (value) {
      const selector = `${element.tagName.toLowerCase()}[${attribute}="${CSS.escape(value)}"]`;
      try {
        if (root.querySelectorAll(selector).length === 1) return selector;
      } catch {}
    }
  }

  const parts = [];
  let current = element;
  while (current && current !== root && current.nodeType === Node.ELEMENT_NODE && parts.length < 5) {
    let part = current.tagName.toLowerCase();
    const className = [...current.classList || []].find((name) => !/^active|on|layer$/i.test(name));
    if (className) part += `.${CSS.escape(className)}`;
    const parent = current.parentElement;
    if (parent) {
      const siblings = [...parent.children].filter((child) => child.tagName === current.tagName);
      if (siblings.length > 1) part += `:nth-of-type(${siblings.indexOf(current) + 1})`;
    }
    parts.unshift(part);
    current = parent;
  }
  return parts.join(" > ");
}

function relativeBox(element, base = screen) {
  const rect = element.getBoundingClientRect();
  const baseRect = element.ownerDocument === document && base?.getBoundingClientRect
    ? base.getBoundingClientRect()
    : { left: 0, top: 0 };
  return {
    x: Math.round(rect.left - baseRect.left),
    y: Math.round(rect.top - baseRect.top),
    width: Math.round(rect.width),
    height: Math.round(rect.height)
  };
}

function shouldIgnoreScenarioEvent(target) {
  return Boolean(target?.closest?.(".scenario-panel"));
}

function recordScenarioAction(type, payload = {}) {
  const scenario = state.scenario;
  if (!scenario.recording || scenario.replaying) return;
  const now = performance.now();
  const action = {
    id: `a${String(scenario.actions.length + 1).padStart(3, "0")}`,
    type,
    delay: Math.round(Math.max(0, now - (scenario.lastActionAt || scenario.startedAt))),
    at: Math.round(now - scenario.startedAt),
    mode: state.mode,
    url: state.lastAppUrl,
    ...payload
  };
  scenario.lastActionAt = now;
  scenario.actions.push(action);
  updateScenarioUi();
}

function beginScenario() {
  state.scenario.name = scenarioName.value.trim() || "Hermes reproduce path";
  state.scenario.recording = true;
  state.scenario.replaying = false;
  state.scenario.startedAt = performance.now();
  state.scenario.lastActionAt = state.scenario.startedAt;
  state.scenario.actions = [];
  state.runtimeEvents = [];
  pushRuntimeEvent("scenario:start", { name: state.scenario.name });
  updateScenarioUi();
  showToast("Recording scenario");
}

function finishScenario() {
  if (!state.scenario.recording) return;
  state.scenario.recording = false;
  pushRuntimeEvent("scenario:stop", { actions: state.scenario.actions.length });
  updateScenarioUi();
  showToast("Scenario stopped");
}

function clearScenarioState() {
  state.scenario.recording = false;
  state.scenario.replaying = false;
  state.scenario.actions = [];
  state.runtimeEvents = [];
  state.lastHierarchy = null;
  updateScenarioUi();
  writeLog("scenario cleared");
}

function installRuntimeProbes(targetWindow = window, source = "panel") {
  try {
    if (targetWindow.__iosPanelRuntimeProbes) return;
    Object.defineProperty(targetWindow, "__iosPanelRuntimeProbes", { value: true });

    ["log", "warn", "error"].forEach((level) => {
      const original = targetWindow.console?.[level];
      if (typeof original !== "function") return;
      targetWindow.console[level] = (...args) => {
        pushRuntimeEvent(`console:${level}`, {
          source,
          message: args.map(formatRuntimeValue).join(" ").slice(0, 600)
        });
        return original.apply(targetWindow.console, args);
      };
    });

    const originalFetch = targetWindow.fetch?.bind(targetWindow);
    if (originalFetch) {
      targetWindow.fetch = async (...args) => {
        const requestUrl = String(args[0]?.url || args[0]);
        const started = performance.now();
        try {
          const response = await originalFetch(...args);
          pushRuntimeEvent("network:fetch", {
            source,
            url: requestUrl,
            status: response.status,
            durationMs: Math.round(performance.now() - started)
          });
          return response;
        } catch (error) {
          pushRuntimeEvent("network:fetch-error", {
            source,
            url: requestUrl,
            error: String(error)
          });
          throw error;
        }
      };
    }

    const OriginalXhr = targetWindow.XMLHttpRequest;
    if (OriginalXhr) {
      targetWindow.XMLHttpRequest = function InstrumentedXMLHttpRequest() {
        const xhr = new OriginalXhr();
        let requestUrl = "";
        let started = 0;
        const originalOpen = xhr.open;
        xhr.open = function open(method, url, ...rest) {
          requestUrl = String(url);
          return originalOpen.call(xhr, method, url, ...rest);
        };
        const originalSend = xhr.send;
        xhr.send = function send(...args) {
          started = performance.now();
          xhr.addEventListener("loadend", () => {
            pushRuntimeEvent("network:xhr", {
              source,
              url: requestUrl,
              status: xhr.status,
              durationMs: Math.round(performance.now() - started)
            });
          }, { once: true });
          return originalSend.apply(xhr, args);
        };
        return xhr;
      };
    }

    targetWindow.addEventListener("error", (event) => {
      pushRuntimeEvent("runtime:error", {
        source,
        message: event.message,
        filename: event.filename,
        lineno: event.lineno,
        colno: event.colno
      });
    });

    targetWindow.addEventListener("unhandledrejection", (event) => {
      pushRuntimeEvent("runtime:unhandledrejection", {
        source,
        message: String(event.reason)
      });
    });
  } catch (error) {
    pushRuntimeEvent("runtime:probe-failed", { source, error: String(error) });
  }
}

function showToast(message) {
  toast.textContent = message;
  toast.classList.add("active");
  window.clearTimeout(showToast.timer);
  showToast.timer = window.setTimeout(() => toast.classList.remove("active"), 1500);
}

function showSafariStatus(message) {
  safariStatus.textContent = message;
  safariStatus.classList.add("active");
  window.clearTimeout(showSafariStatus.timer);
  showSafariStatus.timer = window.setTimeout(() => safariStatus.classList.remove("active"), 1600);
}

function showTouch(x = 190, y = 410) {
  touchRipple.style.left = `${x}px`;
  touchRipple.style.top = `${y}px`;
  touchRipple.classList.remove("active");
  void touchRipple.offsetWidth;
  touchRipple.classList.add("active");
}

function setMode(mode, options = {}) {
  state.mode = mode;
  phone.dataset.mode = mode;
  if (!options.silent && options.toast) {
    const label = {
      home: "Home",
      control: "Control Center",
      notifications: "Notification Center",
      lock: "Lock Screen",
      app: "App"
    }[mode] || mode;
    showToast(label);
  }
  writeLog("mode changed", {
    mode,
    url: preview.src,
    orientation: state.orientation,
    theme: state.theme
  });
}

function normalizeSafariUrl(value) {
  const raw = value.trim();
  if (!raw) return state.lastAppUrl;
  if (raw.startsWith("/")) {
    return new URL(raw, window.location.origin).href;
  }
  if (/^https?:\/\//i.test(raw)) {
    return raw;
  }
  if (/^[\w.-]+:\d+(?:[/?#]|$)/i.test(raw)) {
    return `http://${raw}`;
  }
  if (/^(localhost|127(?:\.\d{1,3}){3}|0\.0\.0\.0|\d{1,3}(?:\.\d{1,3}){3}|\[::1\])(?:[/?#]|$)/i.test(raw)) {
    return `http://${raw}`;
  }
  if (/^[a-z][a-z\d+.-]*:/i.test(raw)) {
    return raw;
  }
  if (raw.includes(" ") || !raw.includes(".")) {
    return `https://www.google.com/search?q=${encodeURIComponent(raw)}`;
  }
  return `https://${raw}`;
}

function isLocalSafariHost(hostname) {
  return hostname === "localhost"
    || hostname === "127.0.0.1"
    || hostname === "0.0.0.0"
    || hostname === "::1"
    || /^192\.168\./.test(hostname)
    || /^10\./.test(hostname)
    || /^172\.(1[6-9]|2\d|3[0-1])\./.test(hostname);
}

function shouldProxySafariUrl(url, appKind = state.currentAppKind) {
  if (appKind !== "safari") return false;
  try {
    const parsed = new URL(url, window.location.origin);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return false;
    if (parsed.origin === window.location.origin) return false;
    return true;
  } catch {
    return false;
  }
}

function safariFrameUrl(url, appKind = state.currentAppKind) {
  if (!shouldProxySafariUrl(url, appKind)) return url;
  return `${window.location.origin}/api/sim/proxy?url=${encodeURIComponent(url)}`;
}

function displaySafariUrl(url) {
  try {
    const parsed = new URL(url, window.location.origin);
    const path = parsed.pathname === "/" ? "" : parsed.pathname;
    return `${parsed.host}${path}${parsed.search}`;
  } catch {
    return url;
  }
}

function setSafariHistory(url, push = true) {
  if (push) {
    const current = state.safariHistory[state.safariIndex];
    if (current !== url) {
      state.safariHistory = state.safariHistory.slice(0, state.safariIndex + 1);
      state.safariHistory.push(url);
      state.safariIndex = state.safariHistory.length - 1;
    }
  }

  safariBack.disabled = state.safariIndex <= 0;
  safariForward.disabled = state.safariIndex >= state.safariHistory.length - 1;
}

function syncSafariChrome(url, title = "Hi Dream server preview") {
  safariUrlInput.value = displaySafariUrl(url);
  safariTabTitle.textContent = title;
  safariTabUrl.textContent = displaySafariUrl(url);
  safariTabCount.textContent = String(state.safariTabs);
  targetUrl.value = url;
}

function navigateSafari(url, options = {}) {
  const normalized = normalizeSafariUrl(url);
  state.currentAppKind = options.appKind || state.currentAppKind || "native";
  appView.dataset.appKind = state.currentAppKind;
  state.lastAppUrl = normalized;
  localStorage.setItem("codex-ios-panel-url", normalized);
  preview.src = safariFrameUrl(normalized, state.currentAppKind);
  setSafariHistory(normalized, options.push !== false);
  syncSafariChrome(normalized, options.title || "Hi Dream server preview");
  setMode("app", options);
  if (!options.silent) {
    showTouch(190, 112);
    showSafariStatus("Loading");
  }
}

function openWorkbenchPreview(payload = {}) {
  state.pendingWorkbenchPreview = payload;
  const previewKind = String(payload.previewKind || "url");
  const title = payload.title || "Dream mobile preview";

  if (previewKind === "inline-html") {
    const html = String(payload.html || "");
    const dataUrl = `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
    navigateSafari(dataUrl, {
      title,
      appKind: "safari",
      silent: true,
      push: false
    });
    writeLog("workbench inline preview loaded", { title, bytes: html.length });
    return;
  }

  if (payload.url) {
    navigateSafari(String(payload.url), {
      title,
      appKind: "safari",
      silent: true,
      push: false
    });
    writeLog("workbench url preview loaded", { title, url: payload.url });
  }
}

function setTheme(theme, options = {}) {
  state.theme = theme;
  phone.dataset.theme = theme;
  document.querySelectorAll("button[data-theme]").forEach((button) => {
    button.classList.toggle("active", button.dataset.theme === theme);
  });
  writeLog("theme changed", { theme });
  if (!options.silent) {
    showToast(`${theme} appearance`);
  }
}

function setBattery(value) {
  state.battery = Number(value);
  document.documentElement.style.setProperty("--battery-fill", `${state.battery}%`);
  lockBattery.textContent = `${state.battery}%`;
}

function setScale(value) {
  state.scale = Number(value);
  document.documentElement.style.setProperty("--phone-scale", String(state.scale / 100));
  scaleReadout.textContent = `${state.scale}%`;
  if (scale.value !== String(state.scale)) {
    scale.value = String(state.scale);
  }
}

function fitBrowserPanel() {
  if (!isBrowserView) return;
  const frame = state.orientation === "landscape"
    ? { width: 826, height: 382 }
    : { width: 382, height: 826 };
  const maxWidth = Math.max(220, window.innerWidth - 20);
  const maxHeight = Math.max(260, window.innerHeight - 24);
  const next = Math.floor(Math.min(100, (maxWidth / frame.width) * 100, (maxHeight / frame.height) * 100));
  setScale(Math.max(30, next));
}

function renderCaptures() {
  captureCount.textContent = `${state.captures.length} shot${state.captures.length === 1 ? "" : "s"}`;
  captureTray.innerHTML = "";
  if (!state.captures.length) {
    const empty = document.createElement("div");
    empty.className = "capture-empty";
    empty.textContent = "No captures yet";
    captureTray.append(empty);
    return;
  }

  state.captures.slice(0, 4).forEach((item) => {
    const card = document.createElement("div");
    card.className = "capture-card";
    card.innerHTML = `<strong>${item.mode}</strong><span>${item.time}</span>`;
    captureTray.append(card);
  });
}

function setOrientation(next, options = {}) {
  state.orientation = next;
  phone.classList.toggle("landscape", next === "landscape");
  phone.classList.toggle("portrait", next === "portrait");
  rotate.textContent = next === "landscape" ? "Portrait" : "Rotate";
  writeLog("orientation changed", { orientation: next });
  if (!options.silent) {
    showToast(next);
  }
  fitBrowserPanel();
}

function openApp(url, title = "Safari", options = {}) {
  if (appTitle) {
    appTitle.textContent = title;
  }
  const appKind = options.appKind || (title.toLowerCase() === "safari" ? "safari" : "native");
  navigateSafari(url, { ...options, title, appKind });
}

function toggleSiri(show = !siriSheet.classList.contains("active")) {
  siriSheet.classList.toggle("active", show);
  writeLog(show ? "siri opened" : "siri dismissed");
  if (show) {
    window.setTimeout(() => siriSheet.classList.remove("active"), 2400);
  }
}

function snapshot() {
  return {
    device: deviceName.textContent,
    mode: state.mode,
    url: preview.src,
    frame: state.frame,
    orientation: state.orientation,
    theme: state.theme,
    battery: state.battery,
    network: state.network,
    location: state.location,
    volume: state.volume,
    brightness: state.brightness
  };
}

function inferRole(element) {
  const explicit = element.getAttribute?.("role");
  if (explicit) return explicit;
  const tag = element.tagName?.toLowerCase();
  if (tag === "button") return "button";
  if (tag === "a") return "link";
  if (tag === "input") {
    const type = element.type || "text";
    if (type === "range") return "slider";
    if (type === "checkbox") return "checkbox";
    return "textbox";
  }
  if (tag === "select") return "combobox";
  if (tag === "iframe") return "webview";
  if (/^h[1-6]$/.test(tag)) return "heading";
  if (tag === "section") return "region";
  if (tag === "article") return "group";
  if (tag === "img") return "image";
  return tag || "node";
}

function isVisibleElement(element) {
  if (!(element instanceof Element)) return false;
  const style = getComputedStyle(element);
  const rect = element.getBoundingClientRect();
  return style.display !== "none"
    && style.visibility !== "hidden"
    && Number(style.opacity) > 0.01
    && rect.width > 0
    && rect.height > 0;
}

function isMeaningfulElement(element) {
  if (!(element instanceof Element) || !isVisibleElement(element)) return false;
  const tag = element.tagName.toLowerCase();
  return Boolean(
    element.id
    || element.getAttribute("aria-label")
    || element.getAttribute("role")
    || element.matches("button, a, input, select, textarea, iframe, section, article, [data-open-mode], [data-app], [data-gesture], [data-control]")
    || /^h[1-6]$/.test(tag)
    || compactText(element.textContent, 40)
  );
}

function buildHierarchy(root, options = {}) {
  const maxDepth = options.maxDepth ?? 6;
  const maxNodes = options.maxNodes ?? 220;
  const base = options.base || screen;
  let count = 0;

  function visit(element, depth) {
    if (!(element instanceof Element) || count >= maxNodes || depth > maxDepth || !isVisibleElement(element)) return null;
    const children = [...element.children]
      .map((child) => visit(child, depth + 1))
      .filter(Boolean);
    if (!isMeaningfulElement(element) && !children.length && depth > 0) return null;

    count += 1;
    const node = {
      role: inferRole(element),
      tag: element.tagName.toLowerCase(),
      selector: selectorFor(element, element.ownerDocument),
      label: elementLabel(element),
      box: relativeBox(element, base)
    };
    if (element.id) node.id = element.id;
    if (element.className && typeof element.className === "string") node.class = compactText(element.className, 80);
    if ("value" in element && element.value) node.value = String(element.value).slice(0, 160);
    if (element.disabled) node.disabled = true;
    if (element.checked !== undefined && element.type === "checkbox") node.checked = element.checked;
    if (children.length) node.children = children;
    return node;
  }

  return visit(root, 0);
}

function currentViewHierarchy(query = "") {
  const root = buildHierarchy(phone, { maxDepth: 8, maxNodes: 260, base: screen });
  const hierarchy = {
    createdAt: new Date().toISOString(),
    query: query || null,
    driver: state.driver,
    state: snapshot(),
    tree: root,
    preview: {
      accessible: false,
      url: state.lastAppUrl,
      title: safariTabTitle.textContent
    }
  };

  try {
    const doc = preview.contentDocument;
    if (doc?.body) {
      hierarchy.preview.accessible = true;
      hierarchy.preview.tree = buildHierarchy(doc.body, {
        maxDepth: 7,
        maxNodes: 180,
        base: preview
      });
    }
  } catch (error) {
    hierarchy.preview.error = String(error);
  }

  if (query) {
    const needle = query.toLowerCase();
    const matches = [];
    const walk = (node, scope = "phone") => {
      if (!node) return;
      const haystack = [node.role, node.tag, node.id, node.class, node.selector, node.label, node.value].filter(Boolean).join(" ").toLowerCase();
      if (haystack.includes(needle)) {
        matches.push({ scope, role: node.role, label: node.label, selector: node.selector, box: node.box });
      }
      node.children?.forEach((child) => walk(child, scope));
    };
    walk(hierarchy.tree, "phone");
    walk(hierarchy.preview.tree, "preview");
    hierarchy.matches = matches.slice(0, 40);
  }

  state.lastHierarchy = hierarchy;
  return hierarchy;
}

function setElementValue(element, value) {
  if (!element) return;
  element.focus?.();
  if ("value" in element) {
    element.value = value;
  }
  element.dispatchEvent(new Event("input", { bubbles: true }));
  element.dispatchEvent(new Event("change", { bubbles: true }));
}

function clickElement(element) {
  if (!element) return false;
  element.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, cancelable: true, view: element.ownerDocument.defaultView }));
  element.dispatchEvent(new MouseEvent("pointerup", { bubbles: true, cancelable: true, view: element.ownerDocument.defaultView }));
  element.click?.();
  return true;
}

function findReplayTarget(action) {
  if (action.target === "preview") {
    try {
      const doc = preview.contentDocument;
      if (!doc) return null;
      if (action.selector) {
        const selected = doc.querySelector(action.selector);
        if (selected) return selected;
      }
      if (action.x !== undefined && action.y !== undefined) {
        return doc.elementFromPoint(action.x, action.y);
      }
    } catch {
      return null;
    }
  }

  if (action.selector) {
    const selected = document.querySelector(action.selector);
    if (selected) return selected;
  }

  if (action.x !== undefined && action.y !== undefined) {
    const rect = screen.getBoundingClientRect();
    return document.elementFromPoint(rect.left + action.x, rect.top + action.y);
  }

  return null;
}

async function performReplayAction(action) {
  if (action.type === "mode") {
    setMode(action.modeName || action.mode || "home");
    return;
  }
  if (action.type === "navigate") {
    openApp(action.url, action.title || "Safari", { appKind: action.appKind || "safari" });
    await sleep(650);
    return;
  }

  const target = findReplayTarget(action);

  if (action.type === "tap") {
    clickElement(target);
    return;
  }

  if (action.type === "input") {
    setElementValue(target, action.value || "");
    return;
  }

  if (action.type === "key") {
    const doc = target?.ownerDocument || document;
    const active = target || doc.activeElement;
    active?.dispatchEvent(new KeyboardEvent("keydown", { key: action.key, bubbles: true, cancelable: true }));
    return;
  }

  if (action.type === "scroll") {
    if (action.target === "preview") {
      try {
        preview.contentWindow.scrollTo(action.scrollX || 0, action.scrollY || 0);
      } catch {}
      return;
    }
    screen.scrollTo?.(action.scrollX || 0, action.scrollY || 0);
  }
}

async function runScenarioReplay() {
  if (!state.scenario.actions.length || state.scenario.replaying) return;
  finishScenario();
  state.scenario.replaying = true;
  pushRuntimeEvent("scenario:replay-start", { actions: state.scenario.actions.length });
  updateScenarioUi();
  try {
    for (const action of state.scenario.actions) {
      await sleep(Math.min(action.delay || 0, 1500));
      await performReplayAction(action);
    }
    pushRuntimeEvent("scenario:replay-finished", { actions: state.scenario.actions.length });
    showToast("Replay finished");
  } catch (error) {
    pushRuntimeEvent("scenario:replay-error", { error: String(error) });
    showToast("Replay failed");
  } finally {
    state.scenario.replaying = false;
    updateScenarioUi();
  }
}

function clonePhoneForCapture() {
  const clone = phone.cloneNode(true);
  clone.style.transform = "none";
  clone.style.setProperty("--phone-scale", "1");
  const clonedIframe = clone.querySelector("#preview");
  if (clonedIframe) {
    const replacement = document.createElement("div");
    replacement.className = "captured-preview";
    replacement.style.cssText = "width:100%;height:100%;overflow:hidden;background:#fff;";
    try {
      const doc = preview.contentDocument;
      const title = doc?.title || safariTabTitle.textContent || "Safari";
      replacement.innerHTML = `<div style="font:16px -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;padding:24px;color:#1d1d1f;background:#fff;min-height:100%;"><strong>${title}</strong><p style="margin:8px 0 0;color:#555;">${displaySafariUrl(state.lastAppUrl)}</p><hr style="border:0;border-top:1px solid #eee;margin:18px 0;">${doc?.body?.innerHTML?.slice(0, 12_000) || ""}</div>`;
    } catch {
      replacement.innerHTML = `<div style="font:16px -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;padding:24px;color:#1d1d1f;background:#fff;min-height:100%;"><strong>${safariTabTitle.textContent || "Safari"}</strong><p>${displaySafariUrl(state.lastAppUrl)}</p></div>`;
    }
    clonedIframe.replaceWith(replacement);
  }
  clone.querySelectorAll("script").forEach((script) => script.remove());
  return clone;
}

async function capturePhoneImage() {
  try {
    const css = await fetch("/assets/styles.css", { cache: "no-store" }).then((response) => response.text());
    const rect = phone.getBoundingClientRect();
    const clone = clonePhoneForCapture();
    const html = `<style>${css}</style><div xmlns="http://www.w3.org/1999/xhtml" style="width:${Math.ceil(rect.width)}px;height:${Math.ceil(rect.height)}px;display:grid;place-items:start center;background:transparent;">${clone.outerHTML}</div>`;
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${Math.ceil(rect.width)}" height="${Math.ceil(rect.height)}"><foreignObject width="100%" height="100%">${html}</foreignObject></svg>`;
    const image = new Image();
    const url = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
    await new Promise((resolve, reject) => {
      image.onload = resolve;
      image.onerror = reject;
      image.src = url;
    });
    const canvas = document.createElement("canvas");
    canvas.width = Math.ceil(rect.width);
    canvas.height = Math.ceil(rect.height);
    const context = canvas.getContext("2d");
    context.drawImage(image, 0, 0);
    return canvas.toDataURL("image/png");
  } catch (error) {
    pushRuntimeEvent("capture:image-failed", { error: String(error) });
    return null;
  }
}

async function scenarioBundlePayload() {
  const hierarchy = currentViewHierarchy(document.querySelector("#inspect-query").value.trim());
  const screenshotDataUrl = await capturePhoneImage();
  return {
    version: 1,
    name: scenarioName.value.trim() || state.scenario.name || "Hermes reproduce path",
    createdAt: new Date().toISOString(),
    driver: state.driver,
    platform: navigator.platform,
    userAgent: navigator.userAgent,
    state: snapshot(),
    scenario: {
      name: state.scenario.name,
      actions: state.scenario.actions
    },
    hierarchy,
    runtimeEvents: state.runtimeEvents,
    screenshotDataUrl
  };
}

function downloadJson(filename, payload) {
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  link.click();
  URL.revokeObjectURL(link.href);
}

async function exportScenarioBundle() {
  finishScenario();
  pushRuntimeEvent("bundle:create-requested", { actions: state.scenario.actions.length });
  const payload = await scenarioBundlePayload();
  try {
    const response = await fetch("/api/sim/bundles", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    const result = await response.json();
    state.lastBundle = result;
    pushRuntimeEvent("bundle:created", result);
    writeLog("bundle created", result);
    showToast("Bundle exported");
  } catch (error) {
    pushRuntimeEvent("bundle:local-download", { error: String(error) });
    downloadJson("scenario-bundle.json", payload);
    writeLog("bundle downloaded locally", { error: String(error) });
  }
}

async function refreshDevices() {
  const response = await fetch("/api/sim/devices", { cache: "no-store" });
  const data = await response.json();
  const device = data.devices?.[0];
  if (device) {
    deviceName.textContent = device.name;
    deviceFps.textContent = String(device.fps);
    deviceRuntime.textContent = device.runtime;
  }
  writeLog("devices ready", data);
}

function syncClock() {
  const parts = nowParts();
  statusTime.textContent = parts.time;
  lockTime.textContent = parts.time;
  lockDate.textContent = parts.date;
  shadeTime.textContent = parts.time;
  shadeDate.textContent = parts.date;
}

function recordDomTap(event) {
  if (shouldIgnoreScenarioEvent(event.target) || event.target.closest?.(".screen")) return;
  const selector = selectorFor(event.target);
  recordScenarioAction("tap", {
    target: "panel",
    selector,
    label: elementLabel(event.target),
    box: relativeBox(event.target)
  });
}

function recordDomInput(event) {
  if (shouldIgnoreScenarioEvent(event.target)) return;
  if (!event.target.matches?.("input, textarea, select")) return;
  recordScenarioAction("input", {
    target: "panel",
    selector: selectorFor(event.target),
    label: elementLabel(event.target),
    value: event.target.type === "checkbox" ? event.target.checked : event.target.value
  });
}

function recordDomKey(event) {
  if (shouldIgnoreScenarioEvent(event.target)) return;
  if (!["Enter", "Escape", "Tab", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(event.key)) return;
  recordScenarioAction("key", {
    target: event.target.closest?.(".screen") ? "screen" : "panel",
    selector: selectorFor(event.target),
    key: event.key
  });
}

function attachPreviewInstrumentation() {
  try {
    const doc = preview.contentDocument;
    const win = preview.contentWindow;
    if (!doc?.body || !win || doc.__iosPanelInstrumentation) return;
    Object.defineProperty(doc, "__iosPanelInstrumentation", { value: true });
    installRuntimeProbes(win, "preview");

    doc.addEventListener("click", (event) => {
      if (shouldIgnoreScenarioEvent(event.target)) return;
      recordScenarioAction("tap", {
        target: "preview",
        selector: selectorFor(event.target, doc),
        label: elementLabel(event.target),
        x: Math.round(event.clientX),
        y: Math.round(event.clientY)
      });
    }, true);

    doc.addEventListener("input", (event) => {
      if (!event.target.matches?.("input, textarea, select")) return;
      recordScenarioAction("input", {
        target: "preview",
        selector: selectorFor(event.target, doc),
        label: elementLabel(event.target),
        value: event.target.type === "checkbox" ? event.target.checked : event.target.value
      });
    }, true);

    doc.addEventListener("keydown", (event) => {
      if (!["Enter", "Escape", "Tab", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(event.key)) return;
      recordScenarioAction("key", {
        target: "preview",
        selector: selectorFor(event.target, doc),
        key: event.key
      });
    }, true);

    let scrollTimer = 0;
    win.addEventListener("scroll", () => {
      window.clearTimeout(scrollTimer);
      scrollTimer = window.setTimeout(() => {
        recordScenarioAction("scroll", {
          target: "preview",
          scrollX: Math.round(win.scrollX),
          scrollY: Math.round(win.scrollY)
        });
      }, 120);
    }, { passive: true });
  } catch (error) {
    pushRuntimeEvent("preview:instrumentation-unavailable", { error: String(error) });
  }
}

document.querySelectorAll("[data-open-mode]").forEach((control) => {
  control.addEventListener("click", () => {
    const mode = control.dataset.openMode;
    const url = control.dataset.url;
    if (control.dataset.appKind === "safari") {
      const safariUrl = state.lastAppUrl || url || defaultAppUrl;
      openApp(safariUrl, control.dataset.app || "Safari", {
        appKind: "safari"
      });
      return;
    }
    if (url) {
      openApp(url, control.dataset.app || control.textContent.trim() || "Safari", {
        appKind: control.dataset.appKind || "native"
      });
      return;
    }
    showTouch();
    setMode(mode);
  });
});

document.querySelectorAll("[data-app]").forEach((control) => {
  control.addEventListener("click", () => {
    const app = control.dataset.app;
    if (String(app).toLowerCase() === "safari") {
      openApp(state.lastAppUrl || defaultAppUrl, "Safari", { appKind: "safari" });
      return;
    }
    if (appTitle) {
      appTitle.textContent = app;
    }
    writeLog("app opened", { app, mode: "placeholder" });
    showTouch();
    state.currentAppKind = "native";
    appView.dataset.appKind = "native";
    safariTabsSheet.classList.remove("active");
    setMode("app");
  });
});

document.querySelectorAll("button[data-theme]").forEach((button) => {
  button.addEventListener("click", () => setTheme(button.dataset.theme));
});

document.querySelectorAll("[data-control]").forEach((button) => {
  button.addEventListener("click", () => {
    const action = button.dataset.control;
    if (action === "volume-up") {
      volume.value = String(Math.min(100, Number(volume.value) + 10));
    }
    if (action === "volume-down") {
      volume.value = String(Math.max(0, Number(volume.value) - 10));
    }
    state.volume = Number(volume.value);
    writeLog("hardware control", { action, volume: state.volume });
    showToast(`${action}: ${state.volume}`);
  });
});

document.querySelectorAll("[data-gesture]").forEach((button) => {
  button.addEventListener("click", () => {
    const gesture = button.dataset.gesture;
    if (gesture === "swipe-home" || gesture === "up") {
      showTouch(190, 760);
      setMode("home");
      return;
    }
    if (gesture === "pull-notifications" || gesture === "down") {
      showTouch(190, 56);
      setMode("notifications");
      return;
    }
    if (gesture === "pull-control") {
      showTouch(318, 56);
      state.lastModeBeforeControl = state.mode === "control" ? state.lastModeBeforeControl : state.mode;
      setMode("control");
      return;
    }
    if (gesture === "edge") {
      showTouch(42, 410);
      setMode("switcher");
      return;
    }
    showTouch();
    writeLog("gesture sent", { gesture, target: state.mode });
  });
});

document.querySelectorAll("[data-top-gesture]").forEach((zone) => {
  zone.addEventListener("pointerdown", (event) => {
    zone.setPointerCapture(event.pointerId);
  });

  zone.addEventListener("pointerup", () => {
    const gesture = zone.dataset.topGesture;
    if (gesture === "control") {
      state.lastModeBeforeControl = state.mode === "control" ? state.lastModeBeforeControl : state.mode;
      showTouch(318, 48);
      setMode("control");
      return;
    }
    showTouch(120, 48);
    setMode("notifications");
  });
});

let screenDrag = null;

screen.addEventListener("pointerdown", (event) => {
  const rect = screen.getBoundingClientRect();
  screenDrag = {
    x: event.clientX - rect.left,
    y: event.clientY - rect.top,
    time: performance.now()
  };
});

screen.addEventListener("pointerup", (event) => {
  if (!screenDrag) return;
  const rect = screen.getBoundingClientRect();
  const x = event.clientX - rect.left;
  const y = event.clientY - rect.top;
  const dx = x - screenDrag.x;
  const dy = y - screenDrag.y;
  const wasTopPull = screenDrag.y < 86 && dy > 48 && Math.abs(dx) < 120;
  const isTap = Math.hypot(dx, dy) < 9;
  if (wasTopPull) {
    const rightEdge = screen.clientWidth * 0.62;
    showTouch(screenDrag.x, screenDrag.y);
    if (screenDrag.x > rightEdge) {
      state.lastModeBeforeControl = state.mode === "control" ? state.lastModeBeforeControl : state.mode;
      setMode("control");
    } else {
      setMode("notifications");
    }
  }
  if (isTap) {
    const target = document.elementFromPoint(event.clientX, event.clientY);
    recordScenarioAction("tap", {
      target: "screen",
      selector: selectorFor(target),
      label: elementLabel(target),
      x: Math.round(x),
      y: Math.round(y)
    });
  } else {
    recordScenarioAction("scroll", {
      target: "screen",
      x: Math.round(screenDrag.x),
      y: Math.round(screenDrag.y),
      deltaX: Math.round(dx),
      deltaY: Math.round(dy)
    });
  }
  screenDrag = null;
});

screen.addEventListener("pointercancel", () => {
  screenDrag = null;
});

withFrame.addEventListener("change", () => {
  state.frame = withFrame.checked;
  phone.classList.toggle("with-frame", state.frame);
  writeLog("frame changed", { frame: state.frame });
  showToast(state.frame ? "Frame on" : "Frame off");
});

rotate.addEventListener("click", () => {
  setOrientation(state.orientation === "portrait" ? "landscape" : "portrait");
});

openUrl.addEventListener("click", () => {
  const value = targetUrl.value.trim();
  if (!value) return;
  openApp(value, "Safari");
});

targetUrl.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    openUrl.click();
  }
});

reloadApp.addEventListener("click", () => {
  preview.src = safariFrameUrl(state.lastAppUrl);
  writeLog("safari reloaded", { url: state.lastAppUrl });
  showSafariStatus("Reloaded");
});

safariUrlInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    event.preventDefault();
    navigateSafari(safariUrlInput.value, { title: "Safari" });
    safariUrlInput.blur();
  }
});

safariUrlInput.addEventListener("focus", () => {
  safariUrlInput.select();
});

safariBack.addEventListener("click", () => {
  if (state.safariIndex <= 0) return;
  state.safariIndex -= 1;
  const url = state.safariHistory[state.safariIndex];
  state.lastAppUrl = url;
  preview.src = safariFrameUrl(url);
  setSafariHistory(url, false);
  syncSafariChrome(url, "Safari");
  showSafariStatus("Back");
});

safariForward.addEventListener("click", () => {
  if (state.safariIndex >= state.safariHistory.length - 1) return;
  state.safariIndex += 1;
  const url = state.safariHistory[state.safariIndex];
  state.lastAppUrl = url;
  preview.src = safariFrameUrl(url);
  setSafariHistory(url, false);
  syncSafariChrome(url, "Safari");
  showSafariStatus("Forward");
});

safariShare.addEventListener("click", () => {
  showSafariStatus("Share sheet");
  writeLog("safari share", { url: state.lastAppUrl });
});

safariBookmarks.addEventListener("click", () => {
  showSafariStatus("Bookmarks");
  writeLog("safari bookmarks", { url: state.lastAppUrl });
});

safariTabs.addEventListener("click", () => {
  safariTabsSheet.classList.toggle("active");
});

safariNewTab.addEventListener("click", () => {
  state.safariTabs += 1;
  safariTabsSheet.classList.remove("active");
  navigateSafari("http://localhost:8420/api/sim/demo-app", { title: "Start Page" });
});

safariPageSettings.addEventListener("click", () => {
  showSafariStatus("Reader, zoom, website settings");
});

window.addEventListener("message", (event) => {
  const data = event.data || {};
  if (data.type === "dream-workbench-preview") {
    openWorkbenchPreview(data);
    return;
  }
  if (event.origin !== window.location.origin) return;
  if (data.type !== "ios-panel:proxy-loaded" || !data.url) return;
  const normalized = normalizeSafariUrl(data.url);
  state.lastAppUrl = normalized;
  localStorage.setItem("codex-ios-panel-url", normalized);
  setSafariHistory(normalized, true);
  syncSafariChrome(normalized, data.title || "Safari");
  writeLog("safari proxy loaded", { url: normalized, title: data.title || "Safari" });
});

preview.addEventListener("load", () => {
  let title = "Safari";
  try {
    title = preview.contentDocument?.title || title;
  } catch {
    title = "Website";
  }
  attachPreviewInstrumentation();
  syncSafariChrome(state.lastAppUrl, title);
  writeLog("safari loaded", { url: state.lastAppUrl, title });
  showSafariStatus("Loaded");
});

capture.addEventListener("click", () => {
  const item = {
    mode: state.mode,
    time: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
    snapshot: snapshot()
  };
  state.captures.unshift(item);
  state.captures = state.captures.slice(0, 8);
  renderCaptures();
  showToast("Captured");
  writeLog("capture requested", {
    target: "Codex browser panel",
    snapshot: item.snapshot
  });
});

describe.addEventListener("click", () => {
  const query = document.querySelector("#inspect-query").value.trim();
  const hierarchy = currentViewHierarchy(query);
  pushRuntimeEvent("hierarchy:describe", {
    query: query || null,
    matches: hierarchy.matches?.length || 0,
    previewAccessible: hierarchy.preview.accessible
  });
  writeLog("ui hierarchy", hierarchy);
});

siriButton.addEventListener("click", () => toggleSiri(true));

controlCenterButton.addEventListener("click", () => {
  if (state.mode !== "control") {
    state.lastModeBeforeControl = state.mode;
    setMode("control");
  } else {
    setMode(state.lastModeBeforeControl || "home");
  }
});

battery.addEventListener("input", () => {
  setBattery(battery.value);
  showToast(`Battery ${battery.value}%`);
});

network.addEventListener("change", () => {
  state.network = network.value;
  writeLog("network changed", { network: state.network });
});

locationSelect.addEventListener("change", () => {
  state.location = locationSelect.value;
  writeLog("location changed", { location: state.location });
});

brightness.addEventListener("input", () => {
  state.brightness = Number(brightness.value);
  document.querySelector(".screen").style.filter = `brightness(${state.brightness}%)`;
  showToast(`Brightness ${state.brightness}%`);
});

volume.addEventListener("input", () => {
  state.volume = Number(volume.value);
  showToast(`Volume ${state.volume}%`);
});

sendText.addEventListener("click", () => {
  writeLog("text sent", {
    text: textInput.value,
    target: state.mode
  });
  showToast("Text sent");
  textInput.value = "";
});

document.querySelectorAll("[data-key]").forEach((button) => {
  button.addEventListener("click", () => {
    showTouch();
    writeLog("key sent", { key: button.dataset.key, target: state.mode });
  });
});

document.querySelectorAll(".cc-connect, .cc-action, .cc-portrait, .cc-mirror, .cc-focus, .cc-media button").forEach((button) => {
  button.addEventListener("click", () => {
    button.classList.toggle("on");
    showToast(button.textContent.trim());
  });
});

safeToggle.addEventListener("change", () => {
  state.safeArea = safeToggle.checked;
  phone.classList.toggle("safe-visible", state.safeArea);
  writeLog("safe area changed", { enabled: state.safeArea });
});

scale.addEventListener("input", () => {
  setScale(scale.value);
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    setMode("home");
  }
});

document.addEventListener("click", recordDomTap, true);
document.addEventListener("input", recordDomInput, true);
document.addEventListener("keydown", recordDomKey, true);

recordScenario.addEventListener("click", beginScenario);
stopScenario.addEventListener("click", finishScenario);
replayScenario.addEventListener("click", runScenarioReplay);
clearScenario.addEventListener("click", clearScenarioState);

snapshotUi.addEventListener("click", () => {
  const query = document.querySelector("#inspect-query").value.trim();
  const hierarchy = currentViewHierarchy(query);
  pushRuntimeEvent("hierarchy:snapshot", {
    query: query || null,
    phoneNodes: hierarchy.tree ? 1 : 0,
    previewAccessible: hierarchy.preview.accessible
  });
  writeLog("view hierarchy snapshot", hierarchy);
});

exportBundle.addEventListener("click", () => {
  exportScenarioBundle();
});

copyScenario.addEventListener("click", async () => {
  const payload = {
    name: scenarioName.value.trim() || state.scenario.name,
    actions: state.scenario.actions,
    runtimeEvents: state.runtimeEvents,
    hierarchy: state.lastHierarchy
  };
  const text = JSON.stringify(payload, null, 2);
  try {
    await navigator.clipboard.writeText(text);
    showToast("Scenario copied");
  } catch {
    downloadJson("scenario.json", payload);
    showToast("Scenario downloaded");
  }
});

driverStatus.addEventListener("click", async () => {
  try {
    const response = await fetch("/api/sim/drivers/real-ios", { cache: "no-store" });
    const driver = await response.json();
    pushRuntimeEvent("driver:status", driver);
    writeLog("driver status", driver);
  } catch (error) {
    writeLog("driver status failed", { error: String(error) });
  }
});

setBattery(state.battery);
setScale(state.scale);
fitBrowserPanel();
renderCaptures();
installRuntimeProbes(window, "panel");
setTheme(state.theme, { silent: true });
setOrientation(state.orientation, { silent: true });
if (isBrowserView) {
  syncSafariChrome(state.lastAppUrl, "Safari");
  state.currentAppKind = "safari";
  appView.dataset.appKind = "safari";
  setMode("home", { silent: true });
} else {
  openApp(state.lastAppUrl, "Hi Dream server", { silent: true, appKind: "native" });
}
syncClock();
updateScenarioUi();
setInterval(syncClock, 30_000);
window.addEventListener("resize", fitBrowserPanel);
refreshDevices().catch((error) => {
  writeLog("device probe failed", { error: String(error) });
});
