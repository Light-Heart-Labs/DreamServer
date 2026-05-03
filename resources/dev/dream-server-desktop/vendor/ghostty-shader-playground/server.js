const http = require("http");
const fs = require("fs");
const path = require("path");
const WebSocket = require("ws");

const PORT = 3000;
const ROOT_DIR = __dirname;
const PUBLIC_DIR = path.join(ROOT_DIR, "public");
const SHADERS_DIR = path.join(ROOT_DIR, "public", "shaders");

const args = process.argv.slice(2);
const shouldOpenBrowser = args.includes("--open") || args.includes("-o");

const MIME_TYPES = {
  ".html": "text/html",
  ".js": "application/javascript",
  ".glsl": "text/plain",
  ".json": "application/json",
  ".css": "text/css",
  ".ico": "image/x-icon",
  ".png": "image/png",
  ".svg": "image/svg+xml",
};

const server = http.createServer(handleRequest);

function handleRequest(req, res) {
  const safeUrl = req.url.split("?")[0].split("#")[0];
  const urlPath = safeUrl === "/" ? "/index.html" : safeUrl;
  const requestedPath = path.join(PUBLIC_DIR, urlPath);
  const normalizedPath = path.normalize(requestedPath);

  if (req.url === "/shaders-list") {
    return listShaders(res);
  }

  if (!normalizedPath.startsWith(PUBLIC_DIR)) {
    return notFound(res);
  }

  return serveFile(
    normalizedPath,
    MIME_TYPES[path.extname(normalizedPath)] || "application/octet-stream",
    res,
  );
}

function serveFile(filePath, mimeType, res) {
  fs.readFile(filePath, (err, content) => {
    if (err) {
      if (err.code === "ENOENT") {
        return notFound(res);
      }
      console.error(`Error reading file: ${filePath}`, err);
      res.writeHead(500, { "Content-Type": "text/plain" });
      return res.end("Server error");
    }
    res.writeHead(200, { "Content-Type": mimeType });
    res.end(content);
  });
}

function listShaders(res) {
  fs.readdir(SHADERS_DIR, (err, files) => {
    if (err) {
      console.error("Failed to read shaders directory", err);
      res.writeHead(500, { "Content-Type": "application/json" });
      return res.end(
        JSON.stringify({ error: "Unable to read shaders directory" }),
      );
    }

    const shaderFiles = files.filter((f) => f.endsWith(".glsl"));
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(shaderFiles));
  });
}

function notFound(res) {
  res.writeHead(404, { "Content-Type": "text/plain" });
  res.end("Not found");
}

const wss = new WebSocket.Server({ server });

function broadcastReload() {
  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send("reload");
    }
  });
}
function broadcastReloadShader(file) {
  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(file);
    }
  });
}

function watchForChanges() {
  const toWatch = [PUBLIC_DIR];

  for (const p of toWatch) {
    try {
      const stats = fs.lstatSync(p);
      if (stats.isDirectory()) {
        try {
          fs.watch(p, { recursive: true }, (event, filename) => {
            if (!filename) return;
            console.log(`Changed: ${filename}`);
            if (filename.endsWith(".glsl")) {
              broadcastReloadShader(filename);
            } else {
              broadcastReload();
            }
          });
        } catch (recursiveError) {
          watchDirectoryRecursively(p);
        }
      } else {
        fs.watchFile(p, () => {
          console.log(`File changed: ${path.basename(p)}`);
          broadcastReload();
        });
      }
    } catch (err) {
      console.error(`Failed to watch: ${p}`, err);
    }
  }
}

const pending = new Map();

function scheduleReload(filename, isShader) {
  clearTimeout(pending.get(filename));
  const timeout = setTimeout(() => {
    if (isShader) broadcastReloadShader(filename);
    else broadcastReload();
    pending.delete(filename);
  }, 100); // debounce time
  pending.set(filename, timeout);
}
let reloadTimer;

function watchDirectoryRecursively(dirPath, depth = 0) {
  fs.watch(dirPath, (event, filename) => {
    if (!filename) return;
    // ignore changes from tmp files ?
    if (!filename || filename.endsWith("~") || /^\d+$/.test(filename)) return;

    clearTimeout(reloadTimer);
    reloadTimer = setTimeout(() => {
      console.log(`${performance.now() / 1000}[${depth}] Changed: ${filename}`);
      if (filename.endsWith(".glsl")) {
        broadcastReloadShader(filename);
      } else {
        broadcastReload();
      }
    }, 10);
  });

  try {
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory()) {
        const subDirPath = path.join(dirPath, entry.name);
        watchDirectoryRecursively(subDirPath, depth + 1);
      }
    }
  } catch (err) {
    console.error(`Error reading directory ${dirPath}:`, err);
  }
}

watchForChanges();

server.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);

  if (shouldOpenBrowser) {
    const { exec } = require("child_process");
    const url = `http://localhost:${PORT}`;

    const commands = [
      "xdg-open", // Linux
      "open", // macOS
      "start", // Windows
    ];

    let commandIndex = 0;
    const tryOpenBrowser = () => {
      if (commandIndex >= commands.length) {
        console.log(`Please open your browser and navigate to: ${url}`);
        return;
      }

      const command = commands[commandIndex];
      exec(`${command} ${url}`, (error) => {
        if (error) {
          commandIndex++;
          tryOpenBrowser();
        } else {
          console.log(`Browser opened: ${url}`);
        }
      });
    };

    // wait a moment for the server to be ready
    setTimeout(tryOpenBrowser, 500);
  }
});

let isShuttingDown = false;

function gracefulShutdown(signal) {
  if (isShuttingDown) {
    return;
  }

  isShuttingDown = true;
  console.log(`\nReceived ${signal}. Shutting down gracefully...`);

  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.close();
    }
  });

  wss.close(() => {
    console.log("WebSocket server closed");
  });

  server.close(() => {
    console.log("HTTP server closed");
    process.exit(0);
  });

  setTimeout(() => {
    console.log("Force closing server...");
    process.exit(1);
  }, 3000);
}

process.on("SIGINT", () => gracefulShutdown("SIGINT"));
process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
