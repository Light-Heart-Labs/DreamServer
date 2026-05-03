#!/usr/bin/env node
"use strict";

/**
 * Downloads python-build-standalone install_only archives and extracts them to:
 *
 *   resources/python/<platform-key>/python/...
 *
 * Supported flags:
 *   --platform=<darwin|linux|win32>
 *   --arch=<arm64|x64>[,<arm64|x64>...]
 *   --target=<platform-arch>[,<platform-arch>...]
 *   --all
 *   --force
 */

const https = require("https");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const PYTHON_VERSION = "3.11.12";
const BUILD_DATE = "20250409";
const RELEASE_TAG = BUILD_DATE;
const RELEASE_BASE_URL = `https://github.com/astral-sh/python-build-standalone/releases/download/${RELEASE_TAG}`;
const DOWNLOAD_MAX_ATTEMPTS = 4;
const DOWNLOAD_TIMEOUT_MS = 60_000;
const RETRYABLE_STATUS_CODES = new Set([408, 429, 500, 502, 503, 504]);
const RETRYABLE_ERROR_CODES = new Set([
  "ECONNABORTED",
  "ECONNREFUSED",
  "ECONNRESET",
  "EAI_AGAIN",
  "ENETDOWN",
  "ENETRESET",
  "ENETUNREACH",
  "EPIPE",
  "ETIMEDOUT"
]);

const CONFIGS = {
  "darwin-arm64": {
    filename: `cpython-${PYTHON_VERSION}+${BUILD_DATE}-aarch64-apple-darwin-install_only.tar.gz`,
    verifyBins: [
      path.join("python", "bin", "python3"),
      path.join("python", "bin", "python3.11")
    ]
  },
  "darwin-x64": {
    filename: `cpython-${PYTHON_VERSION}+${BUILD_DATE}-x86_64-apple-darwin-install_only.tar.gz`,
    verifyBins: [
      path.join("python", "bin", "python3"),
      path.join("python", "bin", "python3.11")
    ]
  },
  "linux-x64": {
    filename: `cpython-${PYTHON_VERSION}+${BUILD_DATE}-x86_64-unknown-linux-gnu-install_only.tar.gz`,
    verifyBins: [
      path.join("python", "bin", "python3"),
      path.join("python", "bin", "python3.11")
    ]
  },
  "win32-x64": {
    filename: `cpython-${PYTHON_VERSION}+${BUILD_DATE}-x86_64-pc-windows-msvc-install_only.tar.gz`,
    verifyBins: [
      path.join("python", "python.exe")
    ]
  }
};

function log(message) {
  process.stdout.write(`[download-python] ${message}\n`);
}

function removeIfExists(targetPath) {
  try {
    fs.rmSync(targetPath, { recursive: true, force: true });
  } catch {}
}

function moveDirSync(sourceDir, destDir) {
  try {
    fs.renameSync(sourceDir, destDir);
    return;
  } catch (error) {
    if (!error || error.code !== "EXDEV") {
      throw error;
    }
  }

  fs.cpSync(sourceDir, destDir, { recursive: true });
  fs.rmSync(sourceDir, { recursive: true, force: true });
}

function ensureTarAvailable() {
  const result = spawnSync("tar", ["--version"], { stdio: "ignore", shell: false });
  if (result.status === 0) {
    return;
  }
  throw new Error("Comando `tar` nao encontrado. Instale/ative o tar antes de baixar o Python standalone.");
}

function parseCsv(value) {
  return String(value || "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function parseArgs(argv) {
  const options = {
    all: false,
    force: false,
    platforms: [],
    arches: [],
    targets: []
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const nextValue = () => {
      index += 1;
      return argv[index];
    };

    if (arg === "--all") {
      options.all = true;
      continue;
    }
    if (arg === "--force") {
      options.force = true;
      continue;
    }
    if (arg.startsWith("--platform=")) {
      options.platforms.push(...parseCsv(arg.slice("--platform=".length)));
      continue;
    }
    if (arg === "--platform") {
      options.platforms.push(...parseCsv(nextValue()));
      continue;
    }
    if (arg.startsWith("--arch=")) {
      options.arches.push(...parseCsv(arg.slice("--arch=".length)));
      continue;
    }
    if (arg === "--arch") {
      options.arches.push(...parseCsv(nextValue()));
      continue;
    }
    if (arg.startsWith("--target=")) {
      options.targets.push(...parseCsv(arg.slice("--target=".length)));
      continue;
    }
    if (arg === "--target") {
      options.targets.push(...parseCsv(nextValue()));
      continue;
    }
    throw new Error(`Flag nao reconhecida: ${arg}`);
  }

  return options;
}

function resolveTargets(options) {
  if (options.all) {
    return Object.keys(CONFIGS);
  }

  if (options.targets.length > 0) {
    return options.targets;
  }

  const platforms = options.platforms.length > 0 ? options.platforms : [process.platform];
  const arches = options.arches.length > 0 ? options.arches : [process.arch];
  const targets = [];

  for (const platformName of platforms) {
    for (const archName of arches) {
      targets.push(`${platformName}-${archName}`);
    }
  }

  return targets;
}

function verifyTarget(target) {
  if (CONFIGS[target]) {
    return;
  }
  throw new Error(
    `Target sem configuracao: ${target}. ` +
    `Suportados: ${Object.keys(CONFIGS).join(", ")}`
  );
}

function expectedPythonPath(destDir, config) {
  return config.verifyBins
    .map((relativePath) => path.join(destDir, relativePath))
    .find((candidate) => fs.existsSync(candidate));
}

function hasRuntimeFile(rootDir, suffixParts) {
  const wanted = path.join(...suffixParts).toLowerCase();
  const stack = [rootDir];
  while (stack.length > 0) {
    const current = stack.pop();
    let entries = [];
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(full);
        continue;
      }
      if (full.toLowerCase().endsWith(wanted)) {
        return true;
      }
    }
  }
  return false;
}

function verifyPythonStdlib(stagedRoot, target, pythonPath) {
  const requiredFiles = [
    ["encodings", "cp437.py"],
    ["zipfile.py"],
    ["venv", "__init__.py"],
    ["ensurepip", "__init__.py"]
  ];
  const missing = requiredFiles
    .filter((suffix) => !hasRuntimeFile(stagedRoot, suffix))
    .map((suffix) => suffix.join("/"));
  if (missing.length > 0) {
    throw new Error(
      `Python standalone incompleto para ${target}; faltando: ${missing.join(", ")}. ` +
      "Isso quebraria zipfile/pip/venv no app empacotado."
    );
  }

  if (target !== `${process.platform}-${process.arch}`) {
    return;
  }

  const result = spawnSync(
    pythonPath,
    [
      "-c",
      "import encodings.cp437, zipfile, venv, ensurepip; print('python-runtime-ok')"
    ],
    {
      cwd: stagedRoot,
      stdio: "pipe",
      shell: false,
      timeout: 10000
    }
  );
  if (result.status !== 0) {
    const detail = String(result.stderr || result.stdout || "").trim();
    throw new Error(
      `Python standalone falhou no smoke test para ${target}: ${detail || `exit ${result.status}`}`
    );
  }
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryableHttpStatus(statusCode) {
  return RETRYABLE_STATUS_CODES.has(statusCode);
}

function isRetryableDownloadError(error) {
  return Boolean(error && RETRYABLE_ERROR_CODES.has(error.code));
}

function createHttpError(statusCode, url) {
  const error = new Error(`HTTP ${statusCode} ao baixar ${url}`);
  error.statusCode = statusCode;
  return error;
}

function downloadOnce(url, dest, redirects = 0) {
  return new Promise((resolve, reject) => {
    if (redirects > 5) {
      reject(new Error("Muitos redirects ao baixar o Python standalone."));
      return;
    }

    removeIfExists(dest);
    const file = fs.createWriteStream(dest);
    let received = 0;
    let total = 0;
    let lastReportedPct = -1;

    const request = https.get(
      url,
      { headers: { "User-Agent": "dream-server-desktop/1.0" } },
      (response) => {
        if ([301, 302, 307, 308].includes(response.statusCode)) {
          file.destroy();
          removeIfExists(dest);
          response.resume();
          downloadOnce(response.headers.location, dest, redirects + 1).then(resolve, reject);
          return;
        }

        if (response.statusCode !== 200) {
          file.destroy();
          removeIfExists(dest);
          response.resume();
          reject(createHttpError(response.statusCode, url));
          return;
        }

        total = Number.parseInt(response.headers["content-length"] || "0", 10);
        response.on("data", (chunk) => {
          received += chunk.length;
          if (total <= 0) {
            return;
          }
          const pct = Math.floor((received / total) * 100);
          if (pct !== lastReportedPct && pct % 10 === 0) {
            lastReportedPct = pct;
            log(`  ${pct}% (${Math.round(received / 1024 / 1024)} MB)`);
          }
        });

        response.pipe(file);
        file.on("finish", () => file.close(resolve));
        file.on("error", (error) => {
          removeIfExists(dest);
          reject(error);
        });
      }
    );

    request.setTimeout(DOWNLOAD_TIMEOUT_MS, () => {
      request.destroy(Object.assign(new Error(`Timeout ao baixar ${url}`), { code: "ETIMEDOUT" }));
    });

    request.on("error", (error) => {
      file.destroy();
      removeIfExists(dest);
      reject(error);
    });
  });
}

async function download(url, dest) {
  let lastError = null;

  for (let attempt = 1; attempt <= DOWNLOAD_MAX_ATTEMPTS; attempt += 1) {
    try {
      await downloadOnce(url, dest);
      return;
    } catch (error) {
      lastError = error;
      const retryable =
        isRetryableHttpStatus(error && error.statusCode) ||
        isRetryableDownloadError(error);

      if (!retryable || attempt >= DOWNLOAD_MAX_ATTEMPTS) {
        throw error;
      }

      const waitMs = attempt * 2_000;
      const detail = error && error.message ? error.message : "erro temporario";
      log(`Falha transitoria (${detail}). Tentando novamente em ${waitMs / 1000}s...`);
      await delay(waitMs);
    }
  }

  throw lastError || new Error(`Falha ao baixar ${url}`);
}

function extract(archivePath, destDir) {
  fs.mkdirSync(destDir, { recursive: true });
  const result = spawnSync("tar", ["-xzf", archivePath, "-C", destDir], {
    stdio: "inherit",
    shell: false
  });
  if (result.status !== 0) {
    throw new Error(`Falha ao extrair ${path.basename(archivePath)} com tar.`);
  }
}

async function downloadTarget(projectRoot, target, options) {
  verifyTarget(target);
  const config = CONFIGS[target];
  const destDir = path.join(projectRoot, "resources", "python", target);
  const currentPython = expectedPythonPath(destDir, config);

  if (currentPython && !options.force) {
    log(`Python ja presente para ${target} em ${currentPython} — pulando.`);
    return;
  }

  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "dream-python-"));
  const archivePath = path.join(tmpRoot, config.filename);
  const stagingDir = path.join(tmpRoot, "extract");
  const url = `${RELEASE_BASE_URL}/${config.filename}`;

  log(`Target    : ${target}`);
  log(`Version   : ${PYTHON_VERSION}`);
  log(`Filename  : ${config.filename}`);
  log(`Dest      : ${destDir}`);
  log("Downloading from GitHub releases...");

  try {
    await download(url, archivePath);
    log("Download complete. Extracting...");
    extract(archivePath, stagingDir);

    const stagedPython = expectedPythonPath(stagingDir, config);
    if (!stagedPython) {
      throw new Error(
        `Python nao encontrado em ${target} apos a extracao.\n` +
        `Verifique a estrutura do arquivo ${config.filename}.`
      );
    }
    verifyPythonStdlib(stagingDir, target, stagedPython);

    removeIfExists(destDir);
    fs.mkdirSync(path.dirname(destDir), { recursive: true });
    moveDirSync(stagingDir, destDir);

    if (process.platform !== "win32") {
      try {
        fs.chmodSync(path.join(destDir, path.relative(stagingDir, stagedPython)), 0o755);
      } catch {}
    }

    log(`Python ${PYTHON_VERSION} pronto para ${target}.`);
  } finally {
    removeIfExists(tmpRoot);
  }
}

async function main() {
  ensureTarAvailable();

  const options = parseArgs(process.argv.slice(2));
  const targets = resolveTargets(options);

  if (targets.length === 0) {
    throw new Error("Nenhum target resolvido para download.");
  }

  const uniqueTargets = [...new Set(targets)];
  uniqueTargets.forEach(verifyTarget);

  const projectRoot = path.resolve(__dirname, "..");
  for (const target of uniqueTargets) {
    await downloadTarget(projectRoot, target, options);
  }
}

main().catch((error) => {
  process.stderr.write(`[download-python] ERROR: ${error.message}\n`);
  process.exit(1);
});
