const path = require("path");
const catalog = require(path.join("..", "..", "shared", "model-tiers.json"));

function gb(value) {
  const numeric = Number(value || 0);
  return Number.isFinite(numeric) ? numeric : 0;
}

function tierById(id) {
  const tierId = String(id || "").trim().toUpperCase();
  const normalized = /^T[0-4]$/.test(tierId) ? tierId.slice(1) : tierId;
  return catalog.tiers.find((tier) => tier.id === tierId || tier.dreamTier === tierId || tier.dreamTier === normalized) || null;
}

function rankTier(tier) {
  const id = String(tier?.id || tier || "").toUpperCase();
  if (id === "NV_ULTRA" || id === "SH_LARGE") return 5;
  if (id === "SH_COMPACT") return 3;
  if (id === "ARC") return 2;
  if (id === "ARC_LITE") return 1;
  const match = id.match(/\d+/);
  return match ? Number(match[0]) : 0;
}

function chooseBackend(profile = {}) {
  const vendor = String(profile.gpuVendor || "").toLowerCase();
  const os = String(profile.os || "").toLowerCase();
  const hasDocker = Boolean(profile.dockerAvailable);
  const hasWsl = Boolean(profile.wslAvailable || profile.wsl2Available);
  if (os === "darwin" && profile.arch === "arm64") return "apple";
  if (vendor === "nvidia" && profile.accelerationAvailable !== false) return os === "win32" && hasWsl && hasDocker ? "nvidia+wsl+docker" : "nvidia";
  if (vendor === "amd" && profile.accelerationAvailable !== false) return "amd";
  if (vendor === "intel" && /arc/i.test(profile.gpuModel || "")) return "intel";
  if (vendor === "intel" && profile.vulkanAvailable) return "vulkan";
  if (hasDocker) return "docker-cpu";
  return "cpu";
}

function bestTierForHardware(profile = {}) {
  const ramGB = gb(profile.ramGB);
  const vramGB = gb(profile.vramGB);
  const unifiedMemoryGB = gb(profile.unifiedMemoryGB);
  const vendor = String(profile.gpuVendor || "").toLowerCase();
  const gpuModel = String(profile.gpuModel || "").toLowerCase();
  const os = String(profile.os || "").toLowerCase();
  const arch = String(profile.arch || "").toLowerCase();
  if (os === "darwin" && arch === "arm64") {
    const memory = Math.max(unifiedMemoryGB, ramGB);
    if (memory >= 128) return "T4";
    if (memory >= 64) return "T3";
    if (memory >= 32) return "T2";
    return "T1";
  }
  if (vendor === "nvidia") {
    if (vramGB >= 90) return "NV_ULTRA";
    if (vramGB >= 40) return "T4";
    if (vramGB >= 20) return "T3";
    if (vramGB >= 12) return "T2";
    return "T1";
  }
  if (vendor === "amd") {
    if (unifiedMemoryGB >= 90 || /strix|ryzen ai max|8060s|8050s/.test(gpuModel)) return "SH_LARGE";
    if (unifiedMemoryGB >= 32) return "SH_COMPACT";
    if (vramGB >= 20) return "T3";
    if (vramGB >= 12) return "T2";
    return "T1";
  }
  if (vendor === "intel" && /arc/.test(gpuModel)) return vramGB >= 12 ? "ARC" : "ARC_LITE";
  return ramGB >= 8 ? "T1" : "T0";
}

function supportedMode(profile = {}, tier = null) {
  const ramGB = gb(profile.ramGB);
  const diskFreeGB = gb(profile.diskFreeGB);
  const selectedTier = tier || tierById(bestTierForHardware(profile));
  const canLocal = ramGB >= 8 && diskFreeGB >= Math.max(8, gb(selectedTier?.estimatedSizeGB) + 5);
  const gpuVendor = String(profile.gpuVendor || "").toLowerCase();
  if (!canLocal) return { mode: "cloud", reason: "Pouca RAM ou pouco disco livre para uma pilha local confortavel." };
  if (gpuVendor === "cpu-only" || gpuVendor === "none") return { mode: "hybrid", reason: "CPU-only usa o mesmo fallback do DreamServer; cloud pode ajudar em latencia." };
  return { mode: "local", reason: "Recomendacao alinhada ao tier-map/gpu-database do DreamServer." };
}

function buildRecommendationWarnings(profile = {}, tier = {}, backend = "") {
  const warnings = [];
  if (gb(profile.ramGB) < gb(tier.minRamGB)) warnings.push(`RAM abaixo do ideal para ${tier.id}; considere ${tier.fallbackTier || "cloud"}.`);
  if (gb(profile.diskFreeGB) < gb(tier.estimatedSizeGB) + 10) warnings.push("Espaco livre pode nao cobrir modelo, imagens Docker e logs.");
  if (profile.os === "win32" && profile.dockerAvailable && !profile.wsl2Available) warnings.push("Docker Desktop em Windows deve usar backend WSL2 para a rota DreamServer.");
  if (profile.os === "darwin" && profile.arch !== "arm64") warnings.push("macOS Intel tem suporte local limitado; cloud/hybrid e mais confiavel.");
  return warnings;
}

function recommendModel(profile = {}, overrides = {}) {
  const overrideTier = overrides.tier ? tierById(overrides.tier) : null;
  const selectedTier = overrideTier || tierById(bestTierForHardware(profile)) || tierById("T1");
  const bootstrapTier = tierById(catalog.bootstrapTierId);
  const backend = chooseBackend(profile);
  const mode = overrides.mode && ["local", "cloud", "hybrid"].includes(overrides.mode)
    ? { mode: overrides.mode, reason: "Escolha manual do usuario." }
    : supportedMode(profile, selectedTier);
  return {
    mode: mode.mode,
    modeReason: mode.reason,
    backend,
    tier: selectedTier,
    bootstrapTier,
    bootstrapEnabled: overrides.noBootstrap !== true && selectedTier.id !== bootstrapTier.id,
    fallbackTier: tierById(selectedTier.fallbackTier),
    warnings: buildRecommendationWarnings(profile, selectedTier, backend)
  };
}

module.exports = { catalog, tierById, rankTier, chooseBackend, recommendModel };
