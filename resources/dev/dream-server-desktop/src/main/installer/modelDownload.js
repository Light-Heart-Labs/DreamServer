const crypto = require("crypto");
const fs = require("fs");
const fsp = require("fs/promises");
const https = require("https");
const path = require("path");

function request(url, redirects = 0) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      headers: { "User-Agent": "DreamServerHermesDesktop/0.1" }
    }, (res) => {
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location && redirects < 5) {
        res.resume();
        resolve(request(new URL(res.headers.location, url).toString(), redirects + 1));
        return;
      }
      if (res.statusCode < 200 || res.statusCode >= 300) {
        res.resume();
        reject(new Error(`Download HTTP ${res.statusCode}`));
        return;
      }
      resolve(res);
    });
    req.once("error", reject);
  });
}

async function sha256File(filePath) {
  const hash = crypto.createHash("sha256");
  await new Promise((resolve, reject) => {
    fs.createReadStream(filePath)
      .on("data", (chunk) => hash.update(chunk))
      .once("error", reject)
      .once("end", resolve);
  });
  return hash.digest("hex");
}

async function downloadModel({ tier, modelDir, dryRun = false, onProgress = () => {} }) {
  if (!tier?.ggufFile || !tier?.downloadUrl) {
    return {
      status: "skipped",
      reason: "cloud_or_no_model",
      modelName: tier?.modelName || "",
      ggufFile: tier?.ggufFile || "",
      modelDir,
      modelPath: ""
    };
  }

  await fsp.mkdir(modelDir, { recursive: true });
  const modelPath = path.join(modelDir, tier.ggufFile);
  const partPath = `${modelPath}.part`;

  if (fs.existsSync(modelPath)) {
    onProgress({ status: "ready", percent: 100, bytesDownloaded: 0, totalBytes: 0, modelPath });
    return { status: "ready", modelName: tier.modelName, ggufFile: tier.ggufFile, modelDir, modelPath, alreadyExists: true };
  }

  if (dryRun) {
    onProgress({ status: "dry_run", percent: 100, bytesDownloaded: 0, totalBytes: 0, modelPath });
    return { status: "dry_run", modelName: tier.modelName, ggufFile: tier.ggufFile, modelDir, modelPath, url: tier.downloadUrl };
  }

  const response = await request(tier.downloadUrl);
  const totalBytes = Number(response.headers["content-length"] || 0);
  let bytesDownloaded = 0;
  const file = fs.createWriteStream(partPath);

  await new Promise((resolve, reject) => {
    response.on("data", (chunk) => {
      bytesDownloaded += chunk.length;
      const percent = totalBytes ? Math.round((bytesDownloaded / totalBytes) * 1000) / 10 : 0;
      try {
        onProgress({ status: "downloading", percent, bytesDownloaded, totalBytes, modelPath });
      } catch (error) {
        response.destroy(error);
        file.destroy(error);
        reject(error);
      }
    });
    response.once("error", reject);
    file.once("error", reject);
    file.once("finish", resolve);
    response.pipe(file);
  });

  if (tier.sha256) {
    onProgress({ status: "verifying", percent: 99, bytesDownloaded, totalBytes, modelPath });
    const actual = await sha256File(partPath);
    if (actual.toLowerCase() !== tier.sha256.toLowerCase()) {
      await fsp.rm(partPath, { force: true });
      throw new Error(`Checksum invalido para ${tier.ggufFile}`);
    }
  }

  await fsp.rename(partPath, modelPath);
  onProgress({ status: "ready", percent: 100, bytesDownloaded, totalBytes, modelPath });
  return { status: "ready", modelName: tier.modelName, ggufFile: tier.ggufFile, modelDir, modelPath, bytesDownloaded, totalBytes };
}

module.exports = {
  downloadModel,
  sha256File
};
