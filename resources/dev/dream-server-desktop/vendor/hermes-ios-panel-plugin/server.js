import http from "node:http";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(__dirname, "public");
const bundlesDir = path.join(__dirname, "bundles");
const port = Number(process.env.PORT || 8420);
const execFileAsync = promisify(execFile);

function platformRuntimeLabel() {
  if (process.platform === "darwin") return "macOS Web Bridge";
  if (process.platform === "linux") return "Linux Web Bridge";
  if (process.platform === "win32") return "Windows Web Bridge";
  return `${process.platform} Web Bridge`;
}

const contentTypes = new Map([
  [".html", "text/html; charset=utf-8"],
  [".css", "text/css; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".svg", "image/svg+xml; charset=utf-8"],
  [".png", "image/png"]
]);

const devices = [
  {
    id: "web-shell-iphone-17-pro-max",
    name: "iPhone 17 Pro Max",
    runtime: platformRuntimeLabel(),
    state: "Booted",
    fps: 60,
    width: 430,
    height: 932,
    realIOS: false,
    notes: "Runs as a Codex browser panel on Windows. Real Apple iOS Simulator requires macOS and Xcode."
  }
];

function sendJson(res, payload, status = 200) {
  const body = JSON.stringify(payload, null, 2);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store"
  });
  res.end(body);
}

async function readJsonBody(req, limitBytes = 16 * 1024 * 1024) {
  const chunks = [];
  let total = 0;
  for await (const chunk of req) {
    total += chunk.length;
    if (total > limitBytes) {
      throw new Error("Request body is too large");
    }
    chunks.push(chunk);
  }
  const raw = Buffer.concat(chunks).toString("utf8");
  return raw ? JSON.parse(raw) : {};
}

async function readBodyBuffer(req, limitBytes = 16 * 1024 * 1024) {
  const chunks = [];
  let total = 0;
  for await (const chunk of req) {
    total += chunk.length;
    if (total > limitBytes) {
      throw new Error("Request body is too large");
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

function safeId(value) {
  const slug = String(value || "scenario")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 46) || "scenario";
  return `${new Date().toISOString().replace(/[:.]/g, "-")}-${slug}`;
}

async function saveScenarioBundle(payload) {
  const id = safeId(payload.name);
  const dir = path.join(bundlesDir, id);
  await mkdir(dir, { recursive: true });

  const artifacts = {
    bundle: "bundle.json",
    scenario: "scenario.json",
    hierarchy: "hierarchy.json",
    runtimeEvents: "runtime-events.json",
    visualHtml: "visual.html"
  };

  const screenshotDataUrl = payload.screenshotDataUrl;
  const bundle = { ...payload, screenshotDataUrl: undefined, artifacts };

  if (typeof screenshotDataUrl === "string" && screenshotDataUrl.startsWith("data:image/png;base64,")) {
    artifacts.screenshot = "screen.png";
    const base64 = screenshotDataUrl.slice("data:image/png;base64,".length);
    await writeFile(path.join(dir, artifacts.screenshot), Buffer.from(base64, "base64"));
  }

  if (!artifacts.screenshot) {
    const rendered = await renderScenarioScreenshot(payload, dir);
    if (rendered.ok) {
      artifacts.screenshot = rendered.file;
      artifacts.screenshotSource = rendered.source;
    } else {
      artifacts.screenshotError = rendered.error;
    }
  }

  const visualHtml = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(payload.name || "Scenario Bundle")}</title>
  <style>
    body { margin: 0; color: #17191f; background: #f5f7fb; font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    main { max-width: 980px; margin: 0 auto; padding: 28px; display: grid; gap: 18px; }
    section { border: 1px solid #dde3ef; border-radius: 12px; background: #fff; padding: 16px; }
    h1, h2 { margin: 0; }
    pre { overflow: auto; padding: 14px; border-radius: 10px; background: #171b23; color: #f2f6f8; }
    img { max-width: 420px; border-radius: 28px; border: 1px solid #dce2ee; }
  </style>
</head>
<body>
  <main>
    <h1>${escapeHtml(payload.name || "Scenario Bundle")}</h1>
    <section><h2>State</h2><pre>${escapeHtml(JSON.stringify(payload.state || {}, null, 2))}</pre></section>
    ${artifacts.screenshot ? `<section><h2>Screenshot</h2><img src="./${artifacts.screenshot}" alt="Captured phone screen" /></section>` : ""}
    <section><h2>Actions</h2><pre>${escapeHtml(JSON.stringify(payload.scenario?.actions || [], null, 2))}</pre></section>
    <section><h2>Runtime Events</h2><pre>${escapeHtml(JSON.stringify(payload.runtimeEvents || [], null, 2))}</pre></section>
  </main>
</body>
</html>`;

  await Promise.all([
    writeFile(path.join(dir, artifacts.bundle), JSON.stringify(bundle, null, 2)),
    writeFile(path.join(dir, artifacts.scenario), JSON.stringify(payload.scenario || {}, null, 2)),
    writeFile(path.join(dir, artifacts.hierarchy), JSON.stringify(payload.hierarchy || {}, null, 2)),
    writeFile(path.join(dir, artifacts.runtimeEvents), JSON.stringify(payload.runtimeEvents || [], null, 2)),
    writeFile(path.join(dir, artifacts.visualHtml), visualHtml)
  ]);

  return {
    ok: true,
    id,
    dir,
    artifacts,
    files: Object.values(artifacts).map((file) => path.join(dir, file))
  };
}

async function replayRecordedAction(page, action) {
  const delay = Math.min(Number(action.delay || 0), 900);
  if (delay) await page.waitForTimeout(delay);

  if (action.type === "input") {
    const locator = action.target === "preview"
      ? page.frameLocator("#preview").locator(action.selector).first()
      : page.locator(action.selector).first();
    await locator.fill(String(action.value || ""), { timeout: 1800 });
    return;
  }

  if (action.type === "key") {
    await page.keyboard.press(action.key || "Enter");
    return;
  }

  if (action.type === "scroll") {
    if (action.target === "preview") {
      await page.frameLocator("#preview").locator("body").evaluate((body, next) => {
        body.ownerDocument.defaultView.scrollTo(next.scrollX || 0, next.scrollY || 0);
      }, action).catch(() => {});
      return;
    }
    await page.locator(".screen").evaluate((element, next) => {
      element.scrollTo(next.scrollX || 0, next.scrollY || 0);
    }, action).catch(() => {});
    return;
  }

  if (action.type === "tap") {
    if (action.selector) {
      try {
        const locator = action.target === "preview"
          ? page.frameLocator("#preview").locator(action.selector).first()
          : page.locator(action.selector).first();
        await locator.click({ force: true, timeout: 1800 });
        return;
      } catch {}
    }
    if (action.x !== undefined && action.y !== undefined) {
      const box = await page.locator(".screen").boundingBox();
      if (box) {
        await page.mouse.click(box.x + Number(action.x), box.y + Number(action.y));
      }
    }
  }
}

async function renderScenarioScreenshot(payload, dir) {
  let browser;
  try {
    const { chromium } = await import("playwright");
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 1360, height: 980 }, deviceScaleFactor: 1 });
    await page.goto(`http://127.0.0.1:${port}/api/sim/ui`, { waitUntil: "domcontentloaded", timeout: 45_000 });
    await page.waitForSelector("#phone", { timeout: 45_000 });

    for (const action of payload.scenario?.actions || []) {
      await replayRecordedAction(page, action);
    }

    await page.waitForTimeout(900);
    await page.locator("#phone").screenshot({ path: path.join(dir, "screen.png") });
    await browser.close();
    return { ok: true, file: "screen.png", source: "server-playwright-replay" };
  } catch (error) {
    if (browser) {
      await browser.close().catch(() => {});
    }
    return { ok: false, error: String(error) };
  }
}

function xcodeBuildMcpConfig() {
  return {
    mcpServers: {
      xcodebuildmcp: {
        command: "npx",
        args: ["-y", "xcodebuildmcp@latest", "mcp"],
        env: {
          XCODEBUILDMCP_ENABLED_WORKFLOWS: "simulator,ui-automation,debugging,logging"
        }
      }
    }
  };
}

async function realIosDriverStatus() {
  const base = {
    ok: true,
    driver: "real-ios",
    platform: process.platform,
    mcpConfig: xcodeBuildMcpConfig(),
    expectedTools: [
      "list_sims",
      "session-set-defaults",
      "build_run_sim",
      "launch_app_sim",
      "describe_ui",
      "screenshot",
      "tap",
      "type_text",
      "gesture",
      "start_sim_log_cap",
      "stop_sim_log_cap"
    ]
  };

  if (process.platform !== "darwin") {
    return {
      ...base,
      available: false,
      mode: "remote-macos-required",
      reason: "Real Apple iOS Simulator requires macOS with Xcode. This host can run the portable web-shell driver and can delegate real-iOS work to a remote macOS runner."
    };
  }

  try {
    const { stdout } = await execFileAsync("xcrun", ["simctl", "list", "devices", "booted", "-j"], { timeout: 10_000 });
    const parsed = JSON.parse(stdout);
    const booted = Object.values(parsed.devices || {}).flat().filter((device) => device.state === "Booted");
    return {
      ...base,
      available: true,
      mode: "local-macos-xcode",
      bootedSimulators: booted
    };
  } catch (error) {
    return {
      ...base,
      available: false,
      mode: "macos-xcode-not-ready",
      reason: String(error)
    };
  }
}

async function sendFile(res, filename) {
  const safePath = path.normalize(filename).replace(/^(\.\.[/\\])+/, "");
  const resolved = path.join(publicDir, safePath);

  if (!resolved.startsWith(publicDir)) {
    res.writeHead(403, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Forbidden");
    return;
  }

  try {
    const body = await readFile(resolved);
    const ext = path.extname(resolved);
    res.writeHead(200, {
      "Content-Type": contentTypes.get(ext) || "application/octet-stream",
      "Cache-Control": "no-store"
    });
    res.end(body);
  } catch {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Not found");
  }
}

function demoApp(res) {
  res.writeHead(200, {
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "no-store"
  });
  res.end(`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <style>
    * { box-sizing: border-box; }
    body {
      margin: 0;
      min-height: 100vh;
      color: #17191f;
      background: #fbf7ef;
      font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }
    main {
      min-height: 100vh;
      display: grid;
      grid-template-rows: auto auto 1fr auto;
      gap: 16px;
      padding: 62px 20px 22px;
    }
    header {
      display: flex;
      align-items: center;
      justify-content: space-between;
    }
    h1 { margin: 0; font-size: 29px; letter-spacing: 0; }
    .avatar {
      width: 38px;
      height: 38px;
      border-radius: 14px;
      background: linear-gradient(180deg, #cf415f, #9f2039);
      color: #fff8ef;
      display: grid;
      place-items: center;
      font-weight: 900;
    }
    .search {
      height: 42px;
      display: flex;
      align-items: center;
      padding: 0 14px;
      border-radius: 14px;
      background: #efe5d4;
      color: #6a5f50;
      font-size: 14px;
      font-weight: 700;
    }
    .hero {
      display: grid;
      align-content: end;
      min-height: 188px;
      padding: 18px;
      border-radius: 26px;
      background:
        radial-gradient(circle at 82% 14%, rgba(255, 255, 255, .82), transparent 21%),
        linear-gradient(135deg, #b8314b, #e4a041);
      color: #fff8ed;
      box-shadow: 0 16px 40px rgba(141, 76, 37, .2);
    }
    .hero h2 {
      margin: 0;
      font-size: 25px;
      line-height: 1.05;
    }
    .hero p,
    p { margin: 7px 0 0; line-height: 1.4; }
    .hero p { color: rgba(255, 248, 237, .82); }
    .list {
      display: grid;
      gap: 10px;
    }
    .item {
      display: grid;
      grid-template-columns: 54px 1fr auto;
      align-items: center;
      gap: 12px;
      padding: 10px;
      border: 1px solid #eadfce;
      border-radius: 18px;
      background: #fffdf8;
    }
    .thumb {
      width: 54px;
      height: 54px;
      border-radius: 15px;
      background: linear-gradient(135deg, #f0bf68, #b7314c);
    }
    .item strong {
      display: block;
      font-size: 15px;
    }
    .item span {
      color: #716a60;
      font-size: 13px;
    }
    button {
      height: 44px;
      border: 0;
      border-radius: 14px;
      color: #fff8ed;
      background: #1f5b82;
      font: inherit;
      font-weight: 800;
      padding: 0 16px;
    }
    nav {
      display: flex;
      align-items: center;
      justify-content: space-around;
      gap: 8px;
      min-height: 48px;
      border-radius: 18px;
      background: #fffdf8;
      color: #716a60;
      font-size: 13px;
      font-weight: 800;
      box-shadow: 0 10px 28px rgba(64, 52, 33, .08);
    }
    @media (max-height: 430px) {
      main {
        grid-template-columns: 1fr 1.1fr;
        grid-template-rows: auto auto 1fr;
        gap: 12px 16px;
        padding: 58px 28px 18px;
      }
      header,
      .search {
        grid-column: 1;
      }
      .hero {
        grid-column: 1;
        min-height: 130px;
      }
      .list {
        grid-column: 2;
        grid-row: 1 / span 3;
        align-content: center;
      }
      nav {
        display: none;
      }
    }
  </style>
</head>
<body>
  <main>
    <header>
      <h1>Bakery</h1>
      <div class="avatar">B</div>
    </header>
    <div class="search">Search croissants, coffee, cakes</div>
    <section class="hero">
      <h2>Morning batch is ready.</h2>
      <p>Fresh pastries, warm bread, and espresso for pickup.</p>
    </section>
    <section class="list">
      <article class="item">
        <div class="thumb"></div>
        <div><strong>Butter croissant</strong><span>Golden, flaky, baked now</span></div>
        <button onclick="this.textContent='Added'">Add</button>
      </article>
      <article class="item">
        <div class="thumb"></div>
        <div><strong>Flat white</strong><span>Double shot, steamed milk</span></div>
        <button onclick="this.textContent='Added'">Add</button>
      </article>
    </section>
    <nav><span>Today</span><span>Orders</span><span>Account</span></nav>
  </main>
</body>
</html>`);
}

function isSkippableBrowserUrl(value) {
  return /^(#|data:|blob:|javascript:|mailto:|tel:|sms:|about:)/i.test(value.trim());
}

function escapeAttribute(value, quote) {
  const escaped = value.replace(/&/g, "&amp;");
  return quote === "'"
    ? escaped.replace(/'/g, "&#39;")
    : escaped.replace(/"/g, "&quot;");
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function stripHtml(value) {
  return String(value)
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}

function requestOrigin(req) {
  const forwardedProto = String(req.headers["x-forwarded-proto"] || "").split(",")[0].trim();
  const proto = forwardedProto || "http";
  const host = req.headers.host || `127.0.0.1:${port}`;
  return `${proto}://${host}`;
}

function proxyPath(value, baseUrl, proxyOrigin = "") {
  const raw = value.trim();
  if (!raw || isSkippableBrowserUrl(raw)) return value;

  try {
    const resolved = new URL(raw, baseUrl);
    if (resolved.protocol !== "http:" && resolved.protocol !== "https:") {
      return value;
    }
    if (proxyOrigin) {
      const localProxy = new URL(proxyOrigin);
      if (resolved.origin === localProxy.origin && resolved.pathname === "/api/sim/proxy") {
        return resolved.href;
      }
    }
    return `${proxyOrigin}/api/sim/proxy?url=${encodeURIComponent(resolved.href)}`;
  } catch {
    return value;
  }
}

function decodeDuckDuckGoUrl(value) {
  const normalized = value.startsWith("//") ? `https:${value}` : value;
  try {
    const parsed = new URL(normalized);
    const target = parsed.searchParams.get("uddg");
    return target || normalized;
  } catch {
    return normalized;
  }
}

function parseDuckDuckGoResults(html) {
  const results = [];
  const anchorPattern = /<a[^>]+class="result__a"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  const matches = [...html.matchAll(anchorPattern)];

  matches.slice(0, 10).forEach((match, index) => {
    const blockStart = match.index || 0;
    const blockEnd = matches[index + 1]?.index || html.length;
    const block = html.slice(blockStart, blockEnd);
    const snippetMatch = block.match(/<a[^>]+class="result__snippet"[^>]*>([\s\S]*?)<\/a>|<div[^>]+class="result__snippet"[^>]*>([\s\S]*?)<\/div>/i);
    const url = decodeDuckDuckGoUrl(stripHtml(match[1]));
    const title = stripHtml(match[2]);
    const snippet = stripHtml(snippetMatch?.[1] || snippetMatch?.[2] || "");
    if (url && title) {
      results.push({ url, title, snippet });
    }
  });

  return results;
}

async function sendGoogleSearchFallback(res, targetUrl, proxyOrigin) {
  const query = targetUrl.searchParams.get("q") || "";
  const ddgUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
  let results = [];

  try {
    const upstream = await fetch(ddgUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1",
        "Accept-Language": "pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7"
      }
    });
    results = parseDuckDuckGoResults(await upstream.text());
  } catch {
    results = [];
  }

  const resultMarkup = results.length
    ? results.map((result) => {
        const resultUrl = proxyPath(result.url, targetUrl.href, proxyOrigin);
        let host = result.url;
        try {
          host = new URL(result.url).host;
        } catch {}
        return `<article class="result">
          <a class="result-host" href="${escapeAttribute(resultUrl, "\"")}">${escapeHtml(host)}</a>
          <a class="result-title" href="${escapeAttribute(resultUrl, "\"")}">${escapeHtml(result.title)}</a>
          <p>${escapeHtml(result.snippet || "Open this result in Safari.")}</p>
        </article>`;
      }).join("")
    : `<article class="empty"><strong>No results rendered</strong><p>Try another search or open the site URL directly.</p></article>`;

  const html = `<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(query || "Google Search")}</title>
  <style>
    * { box-sizing: border-box; }
    body {
      margin: 0;
      min-height: 100vh;
      color: #202124;
      background: #fff;
      font: 15px/1.42 -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
    }
    header {
      position: sticky;
      top: 0;
      z-index: 2;
      padding: 16px 16px 10px;
      background: rgba(255, 255, 255, .94);
      border-bottom: 1px solid #eef0f3;
      backdrop-filter: blur(18px);
    }
    .brand {
      margin: 0 0 12px;
      font-size: 31px;
      font-weight: 760;
      letter-spacing: -.03em;
      text-align: center;
    }
    .brand span:nth-child(1) { color: #4285f4; }
    .brand span:nth-child(2) { color: #ea4335; }
    .brand span:nth-child(3) { color: #fbbc05; }
    .brand span:nth-child(4) { color: #4285f4; }
    .brand span:nth-child(5) { color: #34a853; }
    .brand span:nth-child(6) { color: #ea4335; }
    form {
      display: grid;
      grid-template-columns: 1fr auto;
      gap: 8px;
      min-height: 44px;
      padding: 4px;
      border: 1px solid #dadce0;
      border-radius: 999px;
      background: #fff;
      box-shadow: 0 1px 8px rgba(60, 64, 67, .12);
    }
    input {
      min-width: 0;
      border: 0;
      outline: 0;
      padding: 0 12px;
      font: inherit;
      background: transparent;
    }
    button {
      border: 0;
      border-radius: 999px;
      padding: 0 14px;
      color: #fff;
      background: #1a73e8;
      font: inherit;
      font-weight: 700;
    }
    .tabs {
      display: flex;
      gap: 18px;
      padding: 12px 4px 0;
      color: #5f6368;
      font-size: 12px;
      font-weight: 700;
      text-transform: uppercase;
    }
    .tabs strong { color: #1a73e8; }
    main {
      display: grid;
      gap: 16px;
      padding: 16px 18px 96px;
    }
    .result {
      display: grid;
      gap: 3px;
      padding-bottom: 16px;
      border-bottom: 1px solid #eef0f3;
    }
    .result-host {
      color: #3c4043;
      font-size: 12px;
      text-decoration: none;
    }
    .result-title {
      color: #1558d6;
      font-size: 18px;
      line-height: 1.18;
      font-weight: 500;
      text-decoration: none;
    }
    .result p,
    .empty p {
      margin: 2px 0 0;
      color: #4d5156;
      font-size: 13px;
    }
    .empty {
      padding: 20px;
      border-radius: 18px;
      background: #f8fafd;
      text-align: center;
    }
  </style>
  ${proxyBootstrap(targetUrl.href, proxyOrigin)}
</head>
<body>
  <header>
    <h1 class="brand"><span>G</span><span>o</span><span>o</span><span>g</span><span>l</span><span>e</span></h1>
    <form action="https://www.google.com/search" method="get">
      <input name="q" value="${escapeAttribute(query, "\"")}" autocomplete="off" />
      <button>Search</button>
    </form>
    <nav class="tabs"><strong>Tudo</strong><span>Imagens</span><span>Vídeos</span><span>Notícias</span></nav>
  </header>
  <main>${resultMarkup}</main>
</body>
</html>`;

  res.writeHead(200, {
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "no-store"
  });
  res.end(html);
}

function rewriteSrcset(value, baseUrl, proxyOrigin) {
  return value
    .split(",")
    .map((candidate) => {
      const parts = candidate.trim().split(/\s+/).filter(Boolean);
      if (!parts.length) return "";
      const nextUrl = proxyPath(parts[0], baseUrl, proxyOrigin);
      return [nextUrl, ...parts.slice(1)].join(" ");
    })
    .join(", ");
}

function rewriteCss(css, baseUrl, proxyOrigin) {
  return css
    .replace(/url\((['"]?)(?!data:|blob:|#)([^'")]+)\1\)/gi, (_match, quote, value) => {
      return `url(${quote}${proxyPath(value, baseUrl, proxyOrigin)}${quote})`;
    })
    .replace(/@import\s+(?:url\()?(['"])([^'"]+)\1\)?/gi, (_match, quote, value) => {
      return `@import ${quote}${proxyPath(value, baseUrl, proxyOrigin)}${quote}`;
    });
}

function shouldRewriteModuleSpecifier(value) {
  const trimmed = value.trim();
  return trimmed.startsWith(".")
    || trimmed.startsWith("/")
    || /^assets\/.+\.(?:js|css)$/i.test(trimmed);
}

function rewriteJs(js, baseUrl, proxyOrigin) {
  const rewriteSpecifier = (value) => shouldRewriteModuleSpecifier(value) ? proxyPath(value, baseUrl, proxyOrigin) : value;
  return js
    .replace(/(\bfrom\s*)(["'])([^"']+)\2/g, (_match, prefix, quote, value) => {
      return `${prefix}${quote}${escapeAttribute(rewriteSpecifier(value), quote)}${quote}`;
    })
    .replace(/(\bimport\s*\(\s*)(["'])([^"']+)\2(\s*\))/g, (_match, prefix, quote, value, suffix) => {
      return `${prefix}${quote}${escapeAttribute(rewriteSpecifier(value), quote)}${quote}${suffix}`;
    })
    .replace(/(\bm\.f\s*\|\|\s*\(m\.f\s*=\s*\[\s*)((?:"[^"]+"\s*,?\s*)+)(\]\s*\))/g, (_match, prefix, list, suffix) => {
      const rewritten = list.replace(/"([^"]+)"/g, (_item, value) => `"${escapeAttribute(rewriteSpecifier(value), "\"")}"`);
      return `${prefix}${rewritten}${suffix}`;
    });
}

function proxyBootstrap(finalUrl, proxyOrigin) {
  const payload = JSON.stringify(finalUrl).replace(/</g, "\\u003c");
  const originPayload = JSON.stringify(proxyOrigin).replace(/</g, "\\u003c");
  return `<script>
(() => {
  const actualUrl = ${payload};
  const proxyOrigin = ${originPayload};
  const toProxy = (value) => {
    try {
      const next = new URL(value, actualUrl);
      if (next.protocol !== "http:" && next.protocol !== "https:") return value;
      if (next.origin === proxyOrigin && next.pathname === "/api/sim/proxy") return next.href;
      return proxyOrigin + "/api/sim/proxy?url=" + encodeURIComponent(next.href);
    } catch {
      return value;
    }
  };
  const originalFetch = window.fetch && window.fetch.bind(window);
  if (originalFetch) {
    window.fetch = (input, init) => {
      if (input instanceof Request) {
        return originalFetch(new Request(toProxy(input.url), input), init);
      }
      return originalFetch(toProxy(String(input)), init);
    };
  }
  const OriginalXHR = window.XMLHttpRequest;
  if (OriginalXHR) {
    window.XMLHttpRequest = function ProxiedXMLHttpRequest() {
      const xhr = new OriginalXHR();
      const originalOpen = xhr.open;
      xhr.open = function open(method, url, ...rest) {
        return originalOpen.call(xhr, method, toProxy(String(url)), ...rest);
      };
      return xhr;
    };
  }
  const notify = () => {
    try {
      parent.postMessage({
        type: "ios-panel:proxy-loaded",
        url: actualUrl,
        title: document.title || "Safari"
      }, location.origin);
    } catch {}
  };
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", notify, { once: true });
  } else {
    notify();
  }
  document.addEventListener("click", (event) => {
    const link = event.target.closest && event.target.closest("a[href]");
    if (!link || link.target === "_blank" || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const href = link.getAttribute("href");
    if (!href || /^(#|data:|blob:|javascript:|mailto:|tel:|sms:|about:)/i.test(href)) return;
    event.preventDefault();
    location.href = toProxy(href);
  }, true);
  document.addEventListener("submit", (event) => {
    const form = event.target;
    if (!(form instanceof HTMLFormElement)) return;
    const method = (form.method || "get").toLowerCase();
    if (method !== "get") return;
    event.preventDefault();
    const action = form.getAttribute("action") || actualUrl;
    const next = new URL(action, actualUrl);
    const params = new URLSearchParams(new FormData(form));
    params.forEach((value, key) => next.searchParams.set(key, value));
    location.href = toProxy(next.href);
  }, true);
})();
</script>`;
}

function rewriteHtml(html, baseUrl, proxyOrigin) {
  const rewritten = html
    .replace(/<meta[^>]+http-equiv=["']?content-security-policy["']?[^>]*>/gi, "")
    .replace(/<base\b[^>]*>/gi, "")
    .replace(/\s(?:integrity|nonce)=("[^"]*"|'[^']*')/gi, "")
    .replace(/\b(href|src|action|poster)=("[^"]*"|'[^']*')/gi, (match, attribute, quoted) => {
      const quote = quoted.startsWith("'") ? "'" : "\"";
      const value = quoted.slice(1, -1);
      const next = proxyPath(value, baseUrl, proxyOrigin);
      if (next === value) return match;
      return `${attribute}=${quote}${escapeAttribute(next, quote)}${quote}`;
    })
    .replace(/\bsrcset=("[^"]*"|'[^']*')/gi, (match, quoted) => {
      const quote = quoted.startsWith("'") ? "'" : "\"";
      const value = quoted.slice(1, -1);
      const next = rewriteSrcset(value, baseUrl, proxyOrigin);
      return `srcset=${quote}${escapeAttribute(next, quote)}${quote}`;
    });

  const bootstrap = proxyBootstrap(baseUrl, proxyOrigin);
  if (/<\/head>/i.test(rewritten)) {
    return rewritten.replace(/<\/head>/i, `${bootstrap}</head>`);
  }
  if (/<body[^>]*>/i.test(rewritten)) {
    return rewritten.replace(/<body[^>]*>/i, (bodyTag) => `${bodyTag}${bootstrap}`);
  }
  return `${bootstrap}${rewritten}`;
}

async function sendProxy(req, res, target) {
  const proxyOrigin = requestOrigin(req);
  let targetUrl;
  try {
    targetUrl = new URL(target);
    if (targetUrl.protocol !== "http:" && targetUrl.protocol !== "https:") {
      throw new Error("Only http and https URLs are supported");
    }
  } catch {
    res.writeHead(400, { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" });
    res.end("Invalid proxy URL");
    return;
  }

  if (/^www\.google\./i.test(targetUrl.hostname) && targetUrl.pathname === "/search") {
    await sendGoogleSearchFallback(res, targetUrl, proxyOrigin);
    return;
  }

  try {
    const requestHeaders = {
      "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1",
      "Accept": req.headers.accept || "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/png,image/svg+xml,text/css,*/*;q=0.8",
      "Accept-Language": req.headers["accept-language"] || "pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7"
    };
    if (req.headers["content-type"]) {
      requestHeaders["Content-Type"] = req.headers["content-type"];
    }
    const method = req.method || "GET";
    const body = method === "GET" || method === "HEAD"
      ? undefined
      : await readBodyBuffer(req);
    const upstream = await fetch(targetUrl, {
      method,
      body,
      redirect: "follow",
      headers: requestHeaders
    });
    const finalUrl = upstream.url || targetUrl.href;
    const contentType = upstream.headers.get("content-type") || "application/octet-stream";
    const headers = {
      "Content-Type": contentType,
      "Cache-Control": "no-store",
      "Access-Control-Allow-Origin": "*",
      "Cross-Origin-Resource-Policy": "cross-origin"
    };

    if (contentType.includes("text/html") || contentType.includes("application/xhtml+xml")) {
      headers["Content-Type"] = "text/html; charset=utf-8";
      const html = await upstream.text();
      res.writeHead(upstream.status, headers);
      res.end(rewriteHtml(html, finalUrl, proxyOrigin));
      return;
    }

    if (contentType.includes("text/css")) {
      const css = await upstream.text();
      res.writeHead(upstream.status, headers);
      res.end(rewriteCss(css, finalUrl, proxyOrigin));
      return;
    }

    if (/(?:javascript|ecmascript|text\/jscript)/i.test(contentType) || finalUrl.endsWith(".js") || finalUrl.endsWith(".mjs")) {
      headers["Content-Type"] = "text/javascript; charset=utf-8";
      const js = await upstream.text();
      res.writeHead(upstream.status, headers);
      res.end(rewriteJs(js, finalUrl, proxyOrigin));
      return;
    }

    const responseBody = Buffer.from(await upstream.arrayBuffer());
    res.writeHead(upstream.status, headers);
    res.end(responseBody);
  } catch (error) {
    res.writeHead(502, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
    res.end(`<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"><style>body{font-family:system-ui,sans-serif;margin:0;display:grid;place-items:center;min-height:100vh;background:#f7f8fb;color:#17191f}.box{max-width:280px;text-align:center;padding:24px}h1{font-size:20px}</style></head><body><main class="box"><h1>Safari could not open the page</h1><p>${String(error).replace(/[<>&]/g, "")}</p></main></body></html>`);
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);

  if (url.pathname === "/" || url.pathname === "/api/sim/ui" || url.pathname === "/api/sim/browser") {
    await sendFile(res, "index.html");
    return;
  }

  if (url.pathname === "/api/sim/devices") {
    sendJson(res, {
      ok: true,
      platform: process.platform,
      service: "codex-ios-panel",
      realIOSAvailable: process.platform === "darwin",
      devices
    });
    return;
  }

  if (url.pathname === "/api/sim/health") {
    sendJson(res, {
      ok: true,
      service: "codex-ios-panel",
      platform: process.platform,
      ui: `http://localhost:${port}/api/sim/ui`,
      browser: `http://localhost:${port}/api/sim/browser`,
      devices: `http://localhost:${port}/api/sim/devices`,
      capabilities: `http://localhost:${port}/api/sim/capabilities`,
      realIosDriver: `http://localhost:${port}/api/sim/drivers/real-ios`,
      bundles: `http://localhost:${port}/api/sim/bundles`
    });
    return;
  }

  if (url.pathname === "/api/sim/capabilities") {
    const isMac = process.platform === "darwin";
    sendJson(res, {
      ok: true,
      service: "codex-ios-panel",
      platform: process.platform,
      runtime: isMac ? "web-shell-with-optional-xcode-driver" : "web-shell",
      crossPlatform: true,
      webShell: {
        available: true,
        os: ["darwin", "linux", "win32"],
        features: [
          "phone-frame",
          "springboard",
          "safari-shell",
          "external-site-proxy",
          "google-search-fallback",
          "scenario-recorder",
          "scenario-replayer",
          "view-hierarchy-snapshot",
          "console-and-network-events",
          "scenario-bundles",
          "notification-center",
          "control-center",
          "screenshots-through-browser-automation"
        ]
      },
      realIOS: {
        available: false,
        reason: isMac
          ? "Install and wire an Xcode/XcodeBuildMCP driver to launch the real iOS Simulator."
          : "Apple iOS Simulator is only available on macOS with Xcode. Windows and Linux can use this web shell or connect to a remote macOS driver."
      }
    });
    return;
  }

  if (url.pathname === "/api/sim/drivers/real-ios") {
    sendJson(res, await realIosDriverStatus());
    return;
  }

  if (url.pathname === "/api/sim/bundles") {
    if (req.method !== "POST") {
      sendJson(res, { ok: false, error: "POST required" }, 405);
      return;
    }
    try {
      const payload = await readJsonBody(req);
      sendJson(res, await saveScenarioBundle(payload));
    } catch (error) {
      sendJson(res, { ok: false, error: String(error) }, 400);
    }
    return;
  }

  if (url.pathname === "/api/sim/demo-app") {
    await sendFile(res, "demo-app.html");
    return;
  }

  if (url.pathname === "/api/sim/proxy") {
    await sendProxy(req, res, url.searchParams.get("url") || "");
    return;
  }

  if (url.pathname.startsWith("/assets/")) {
    await sendFile(res, decodeURIComponent(url.pathname.slice("/assets/".length)));
    return;
  }

  res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
  res.end("Not found");
});

server.listen(port, "127.0.0.1", () => {
  console.log(`Codex iOS panel listening at http://localhost:${port}/api/sim/ui`);
});
