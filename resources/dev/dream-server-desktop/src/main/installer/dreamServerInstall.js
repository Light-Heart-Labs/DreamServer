const fs = require("fs/promises");
const fsNative = require("fs");
const os = require("os");
const path = require("path");
const { execText } = require("./systemDetection");
const { catalog } = require("./modelTier");

function candidateDreamRoots(userDataPath) {
  const home = os.homedir();
  const localAppData = process.env.LOCALAPPDATA || path.join(home, "AppData", "Local");
  return [
    path.join(userDataPath, "dreamserver", "DreamServer", "dream-server"),
    path.join(localAppData, "DreamServerHermesDesktop", "dreamserver", "DreamServer", "dream-server"),
    path.join(home, "dream-server"),
    path.join(home, "DreamServer", "dream-server"),
    process.env.DREAM_DIR || "",
    process.env.DREAMSERVER_DIR || ""
  ].filter(Boolean);
}

async function gitCommit(root) {
  if (!root) return "";
  return await execText("git", ["-C", path.resolve(root, ".."), "rev-parse", "HEAD"], { timeoutMs: 2000 });
}

async function detectDreamServer(userDataPath) {
  for (const root of candidateDreamRoots(userDataPath)) {
    const resolved = path.resolve(root);
    if (!fsNative.existsSync(path.join(resolved, "installers", "lib", "tier-map.sh")) && !fsNative.existsSync(path.join(resolved, "docker-compose.base.yml"))) {
      continue;
    }
    const commit = await gitCommit(resolved);
    const modelDir = path.join(resolved, "data", "models");
    return {
      installed: true,
      root: resolved,
      modelDir,
      version: catalog.dreamServer.tag,
      expectedCommit: catalog.dreamServer.commit,
      commit,
      pinned: commit ? commit === catalog.dreamServer.commit : null,
      source: "detected"
    };
  }
  return {
    installed: false,
    root: "",
    modelDir: path.join(userDataPath, "models"),
    version: catalog.dreamServer.tag,
    expectedCommit: catalog.dreamServer.commit,
    commit: "",
    pinned: false,
    source: "desktop"
  };
}

async function ensureModelDir(dreamServer) {
  const modelDir = dreamServer?.modelDir || path.join(os.homedir(), ".dream-server", "models");
  await fs.mkdir(modelDir, { recursive: true });
  return modelDir;
}

module.exports = {
  detectDreamServer,
  ensureModelDir
};
