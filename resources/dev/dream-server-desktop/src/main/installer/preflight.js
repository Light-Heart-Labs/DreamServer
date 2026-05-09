const { recommendModel } = require("./modelTier");

function requirement(id, label, status, detail, options = {}) {
  return { id, label, status, detail, autoFix: Boolean(options.autoFix), manualAction: options.manualAction || "", docsUrl: options.docsUrl || "" };
}
function ok(id, label, detail) { return requirement(id, label, "ok", detail); }
function warn(id, label, detail, options = {}) { return requirement(id, label, "warning", detail, options); }
function required(id, label, detail, options = {}) { return requirement(id, label, "required", detail, options); }

function buildPreflight(profile = {}, options = {}) {
  const recommendation = recommendModel(profile, options);
  const requirements = [];
  const mode = options.mode || recommendation.mode;
  const tier = recommendation.tier;
  const occupiedPorts = (profile.ports || []).filter((entry) => entry.occupied);

  requirements.push(profile.ramGB >= 8 ? ok("ram", "Memoria RAM", `${profile.ramGB} GB detectados.`) : required("ram", "Memoria RAM", `${profile.ramGB || 0} GB detectados; minimo realista e 8 GB.`, { manualAction: "Use modo cloud/API ou rode em uma maquina com mais memoria." }));

  const neededDisk = Math.max(12, Number(tier?.estimatedSizeGB || 0) + 10);
  requirements.push(profile.diskFreeGB >= neededDisk ? ok("disk", "Espaco em disco", `${profile.diskFreeGB} GB livres; estimado ${neededDisk} GB.`) : required("disk", "Espaco em disco", `${profile.diskFreeGB || 0} GB livres; estimado ${neededDisk} GB para modelo e servicos.`, { manualAction: "Libere espaco ou escolha cloud/API antes de baixar modelos." }));

  if (mode === "cloud") {
    requirements.push(ok("cloud-mode", "Modo cloud/API", "Instalacao local pesada sera ignorada."));
  } else if (profile.dockerAvailable) {
    requirements.push(ok("docker", "Docker", `Docker ${profile.dockerVersion || ""} esta rodando; endpoint DreamServer pode ser usado se a stack estiver ativa.`.trim()));
    requirements.push(profile.dockerComposeAvailable ? ok("compose", "Docker Compose", `Compose ${profile.dockerComposeVersion || ""} disponivel.`.trim()) : warn("compose", "Docker Compose", "docker compose nao esta disponivel; download do modelo continua possivel."));
  } else {
    requirements.push(warn("docker", "Docker", "Docker nao esta rodando. O app ainda pode baixar o modelo indicado; iniciar a stack local fica para depois.", { manualAction: "Abra Docker Desktop se quiser usar a stack DreamServer via container." }));
  }

  if (profile.os === "win32" && mode !== "cloud") {
    requirements.push(profile.powershellAvailable ? ok("powershell", "PowerShell", "PowerShell disponivel para wrapper Windows.") : required("powershell", "PowerShell", "PowerShell nao foi encontrado.", { manualAction: "Repare a instalacao do Windows PowerShell ou instale PowerShell 7." }));
    requirements.push(profile.wsl2Available ? ok("wsl2", "WSL2", "WSL2 detectado para rota Docker/WSL.") : warn("wsl2", "WSL2", "WSL2 nao foi detectado; download do modelo funciona, mas Docker Desktop com DreamServer pode exigir WSL2.", { manualAction: "Ative WSL2 antes de subir a stack DreamServer no Windows." }));
  }

  if (profile.os === "linux" && mode !== "cloud") {
    requirements.push(profile.packageManager ? ok("package-manager", "Gerenciador de pacotes", `${profile.packageManager} detectado.`) : warn("package-manager", "Gerenciador de pacotes", "apt/dnf/pacman/zypper nao foram detectados.", { manualAction: "Use modo dry-run e instale dependencias manualmente." }));
    requirements.push(profile.systemd ? ok("systemd", "systemd", "systemd detectado.") : warn("systemd", "systemd", "systemd nao detectado; alguns servicos/auto-resume podem ficar limitados."));
    if (profile.gpuVendor === "nvidia") {
      requirements.push(profile.nvidiaContainerToolkitAvailable ? ok("nvidia-container-toolkit", "NVIDIA Container Toolkit", "Toolkit disponivel para GPU passthrough.") : warn("nvidia-container-toolkit", "NVIDIA Container Toolkit", "Toolkit nao detectado; Docker pode nao enxergar a GPU.", { manualAction: "Instale nvidia-container-toolkit seguindo a documentacao da NVIDIA." }));
    }
  }

  if (profile.os === "darwin") {
    if (profile.arch === "arm64") requirements.push(ok("apple-silicon", "Apple Silicon", "Metal local disponivel para llama-server nativo."));
    else if (mode !== "cloud") requirements.push(warn("mac-intel", "macOS Intel", "Rota local tem desempenho e suporte limitados.", { manualAction: "Prefira modo cloud/API ou hybrid com modelo pequeno CPU-only." }));
  }

  if (profile.gpuVendor === "nvidia") {
    requirements.push(profile.nvidiaSmiAvailable ? ok("nvidia-smi", "NVIDIA driver", `${profile.gpuModel || "GPU NVIDIA"} com ${profile.vramGB || 0} GB VRAM.`) : warn("nvidia-smi", "NVIDIA driver", "GPU NVIDIA sugerida, mas nvidia-smi nao respondeu.", { manualAction: "Atualize/reinstale driver NVIDIA. Secure Boot pode bloquear o modulo no Linux." }));
  } else if (profile.gpuVendor === "amd") {
    requirements.push(profile.rocmAvailable || profile.vulkanAvailable ? ok("amd-runtime", "AMD runtime", profile.rocmAvailable ? "ROCm detectado." : "Vulkan detectado.") : warn("amd-runtime", "AMD runtime", "ROCm/Vulkan nao detectados; fallback CPU/Docker pode ser usado."));
  } else if (profile.gpuVendor === "none") {
    requirements.push(warn("cpu-only", "GPU", "Nenhuma GPU acelerada detectada; recomenda-se hybrid/cloud ou modelo pequeno."));
  }

  for (const entry of occupiedPorts) {
    requirements.push(warn(`port-${entry.port}`, `Porta ${entry.port}`, "Porta ja esta ocupada; o instalador deve remapear ou voce deve liberar.", { manualAction: "Feche o processo que usa a porta ou configure outra porta no .env do DreamServer." }));
  }

  const hasRequired = requirements.some((entry) => entry.status === "required");
  const hasWarnings = requirements.some((entry) => entry.status === "warning");
  return { ok: !hasRequired, status: hasRequired ? "blocked" : (hasWarnings ? "warning" : "ok"), recommendation, requirements };
}

module.exports = { buildPreflight };
