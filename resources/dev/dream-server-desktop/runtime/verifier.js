const fs = require("fs/promises");
const { existsSync } = require("fs");
const { spawnSync } = require("child_process");
const os = require("os");
const path = require("path");

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

function resolveCommandOnPath(command) {
  if (!command || process.platform !== "win32") {
    return null;
  }
  const result = spawnSync("where.exe", [command], {
    encoding: "utf8",
    windowsHide: true
  });
  if (result.status !== 0) {
    return null;
  }
  return String(result.stdout || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line && existsSync(line)) || null;
}

function findBrowserExecutable() {
  const localAppData = process.env.LOCALAPPDATA || "";
  const candidates = [
    process.env.DREAM_BROWSER_PATH,
    resolveCommandOnPath("msedge.exe"),
    resolveCommandOnPath("chrome.exe"),
    resolveCommandOnPath("brave.exe"),
    path.join(localAppData, "Microsoft", "Edge", "Application", "msedge.exe"),
    path.join(localAppData, "Google", "Chrome", "Application", "chrome.exe"),
    path.join(localAppData, "BraveSoftware", "Brave-Browser", "Application", "brave.exe"),
    path.join(process.env.ProgramFiles || "", "Microsoft", "Edge", "Application", "msedge.exe"),
    path.join(process.env["ProgramFiles(x86)"] || "", "Microsoft", "Edge", "Application", "msedge.exe"),
    path.join(process.env.ProgramFiles || "", "Google", "Chrome", "Application", "chrome.exe"),
    path.join(process.env["ProgramFiles(x86)"] || "", "Google", "Chrome", "Application", "chrome.exe"),
    path.join(process.env.ProgramFiles || "", "BraveSoftware", "Brave-Browser", "Application", "brave.exe"),
    path.join(process.env["ProgramFiles(x86)"] || "", "BraveSoftware", "Brave-Browser", "Application", "brave.exe")
  ].filter(Boolean);

  return candidates.find((candidate) => existsSync(candidate)) || null;
}

async function verifyFiles(files = [], workspaceRoot = process.cwd()) {
  const required = Array.isArray(files) ? files.map(String).filter(Boolean) : [];
  const missing = [];
  const found = [];
  for (const file of required) {
    const absolutePath = path.isAbsolute(file) ? file : path.resolve(workspaceRoot, file);
    if (existsSync(absolutePath)) {
      found.push(absolutePath);
    } else {
      missing.push(absolutePath);
    }
  }
  return {
    ok: missing.length === 0,
    found,
    missing
  };
}

async function verifyUrl(url, options = {}) {
  const targetUrl = String(url || "").trim();
  if (!/^https?:\/\//i.test(targetUrl)) {
    throw new Error("verify_url exige uma URL http ou https.");
  }

  const timeoutMs = clampNumber(options.timeoutMs, 500, 120000, 10000);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(targetUrl, {
      method: "GET",
      signal: controller.signal
    });
    const text = await response.text().catch(() => "");
    const ok = response.ok;
    return {
      ok,
      url: targetUrl,
      status: response.status,
      contentType: response.headers.get("content-type") || "",
      bodyChars: text.length,
      bodyPreview: truncateText(text.replace(/\s+/g, " ").trim(), 700)
    };
  } catch (error) {
    return {
      ok: false,
      url: targetUrl,
      status: 0,
      contentType: "",
      bodyChars: 0,
      bodyPreview: "",
      error: error?.name === "AbortError"
        ? `Timeout apos ${Math.round(timeoutMs / 1000)}s.`
        : error.message || "Falha ao verificar URL."
    };
  } finally {
    clearTimeout(timer);
  }
}

async function verifyBrowser(url, options = {}) {
  const targetUrl = String(url || "").trim();
  const timeoutMs = clampNumber(options.timeoutMs, 2000, 120000, 20000);
  const expectedText = normalizeExpectedText(options.expectedText);
  let playwright = null;
  try {
    playwright = require("playwright-core");
  } catch {
    return {
      ok: false,
      skipped: true,
      reason: "playwright-core nao esta instalado."
    };
  }

  const executablePath = findBrowserExecutable();
  if (!executablePath) {
    return {
      ok: false,
      skipped: true,
      reason: "Nenhum navegador Chromium/Edge/Chrome/Brave encontrado para verificacao visual."
    };
  }

  const browser = await playwright.chromium.launch({
    executablePath,
    headless: true
  });

  const consoleErrors = [];
  const pageErrors = [];
  let screenshotPath = "";
  try {
    const page = await browser.newPage({
      viewport: { width: 1365, height: 900 }
    });
    page.on("console", (message) => {
      if (["error", "warning"].includes(message.type())) {
        consoleErrors.push(`${message.type()}: ${message.text()}`);
      }
    });
    page.on("pageerror", (error) => {
      pageErrors.push(error.message || String(error));
    });
    const response = await page.goto(targetUrl, {
      waitUntil: "networkidle",
      timeout: timeoutMs
    }).catch((error) => {
      pageErrors.push(error.message || String(error));
      return null;
    });
    await page.waitForTimeout(500).catch(() => {});
    const metrics = await page.evaluate((expected) => {
      const normalize = (value) =>
        String(value || "")
          .normalize("NFD")
          .replace(/[\u0300-\u036f]/g, "")
          .toLowerCase()
          .replace(/\s+/g, " ")
          .trim();
      const app = document.querySelector("#app");
      const text = document.body?.innerText?.trim() || "";
      const searchableText = normalize(text);
      const bodyRect = document.body?.getBoundingClientRect();
      const appRect = app?.getBoundingClientRect?.();
      const visibleElements = [...document.body.querySelectorAll("*")].filter((element) => {
        const style = window.getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        return style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0;
      }).length;
      return {
        title: document.title || "",
        textLength: text.length,
        bodyHeight: Math.round(bodyRect?.height || 0),
        appChildren: app ? app.children.length : null,
        appTextLength: app?.innerText?.trim?.().length || 0,
        appHeight: Math.round(appRect?.height || 0),
        visibleElements,
        missingExpectedText: expected.filter((entry) => !searchableText.includes(normalize(entry)))
      };
    }, expectedText).catch((error) => {
      pageErrors.push(error.message || String(error));
      return {
        title: "",
        textLength: 0,
        bodyHeight: 0,
        appChildren: null,
        appTextLength: 0,
        appHeight: 0,
        visibleElements: 0,
        missingExpectedText: expectedText
      };
    });
    if (options.captureScreenshot !== false) {
      screenshotPath = await captureBrowserScreenshot(page, targetUrl).catch(() => "");
    }
    const status = response?.status?.() || 0;
    const blank =
      metrics.textLength < 12 ||
      metrics.visibleElements < 3 ||
      (metrics.appChildren !== null && metrics.appTextLength < 8);
    const blockingErrors = [
      ...consoleErrors.filter(isBlockingBrowserIssue),
      ...pageErrors.filter(isBlockingBrowserIssue)
    ];
    return {
      ok: status >= 200 && status < 400 && !blank && blockingErrors.length === 0 && metrics.missingExpectedText.length === 0,
      url: targetUrl,
      executablePath,
      status,
      blank,
      metrics,
      screenshotPath,
      consoleErrors: consoleErrors.slice(-12),
      pageErrors: pageErrors.slice(-12),
      blockingErrors: blockingErrors.slice(-12)
    };
  } finally {
    await browser.close().catch(() => {});
  }
}

async function captureBrowserScreenshot(page, url) {
  const dir = path.join(os.tmpdir(), "dream-server-browser-checks");
  await fs.mkdir(dir, { recursive: true });
  const safeUrl = String(url || "page")
    .replace(/^https?:\/\//i, "")
    .replace(/[^a-z0-9._-]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  const filePath = path.join(dir, `${Date.now()}-${safeUrl || "page"}.png`);
  await page.screenshot({
    path: filePath,
    fullPage: true
  });
  return filePath;
}

function normalizeExpectedText(value) {
  if (Array.isArray(value)) {
    return value.map((entry) => String(entry || "").trim()).filter(Boolean);
  }
  const single = String(value || "").trim();
  return single ? [single] : [];
}

function isBlockingBrowserIssue(entry) {
  const text = String(entry || "");
  if (/failed to load resource/i.test(text) && /\b404\b|not found/i.test(text)) {
    return false;
  }
  return /(parse|syntax|failed to load module|module script|uncaught|vite|build failed|typeerror|referenceerror|failed to resolve|failed to fetch dynamically imported module)/i.test(
    text
  );
}

async function verifySite(options = {}, workspaceRoot = process.cwd()) {
  const url = String(options.url || "").trim();
  const expectedFiles = Array.isArray(options.expectedFiles) ? options.expectedFiles : [];
  const http = url ? await verifyUrl(url, { timeoutMs: options.timeoutMs }) : { ok: false, error: "URL ausente." };
  const files = await verifyFiles(expectedFiles, workspaceRoot);
  const browser = url
    ? await verifyBrowser(url, {
        timeoutMs: options.timeoutMs,
        expectedText: options.expectedText
      })
    : { ok: false, skipped: true, reason: "URL ausente." };

  const browserRequired = options.browserRequired !== false;
  const browserOk = browser.skipped && !browserRequired ? true : browser.ok;
  const ok = http.ok && files.ok && browserOk;
  return {
    ok,
    url,
    http,
    files,
    browser
  };
}

function formatVerification(result) {
  const lines = [result.ok ? "VERIFICATION PASSED" : "VERIFICATION FAILED"];
  if (result.url) {
    lines.push(`URL: ${result.url}`);
  }
  if (result.http) {
    lines.push(`HTTP: ${result.http.ok ? "ok" : "fail"} status=${result.http.status || 0} chars=${result.http.bodyChars || 0}`);
    if (result.http.error) {
      lines.push(`HTTP error: ${result.http.error}`);
    }
  }
  if (result.files) {
    lines.push(`Files: ${result.files.ok ? "ok" : "fail"} found=${result.files.found.length} missing=${result.files.missing.length}`);
    if (result.files.missing.length) {
      lines.push(`Missing:\n${result.files.missing.join("\n")}`);
    }
  }
  if (result.browser) {
    if (result.browser.skipped) {
      lines.push(`Browser: skipped - ${result.browser.reason}`);
    } else {
      lines.push(
        `Browser: ${result.browser.ok ? "ok" : "fail"} status=${result.browser.status || 0} blank=${Boolean(result.browser.blank)} text=${result.browser.metrics?.textLength || 0}`
      );
      if (result.browser.blockingErrors?.length) {
        lines.push(`Browser errors:\n${result.browser.blockingErrors.join("\n")}`);
      }
      if (result.browser.screenshotPath) {
        lines.push(`Screenshot: ${result.browser.screenshotPath}`);
      }
      if (result.browser.metrics?.missingExpectedText?.length) {
        lines.push(`Missing expected text:\n${result.browser.metrics.missingExpectedText.join("\n")}`);
      }
    }
  }
  return lines.join("\n");
}

module.exports = {
  findBrowserExecutable,
  formatVerification,
  verifyBrowser,
  verifyFiles,
  verifySite,
  verifyUrl
};
