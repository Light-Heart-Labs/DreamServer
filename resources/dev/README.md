# DreamServer Dev

**Active development builds — not yet in production.**

Everything here is being built, tested, and iterated on by the Light Heart Labs team. These are real tools we're actively using internally, shared early so builders can see what's coming, fork experimental branches, and test alternate builds without needing access to private repos.

> **Status:** Pre-production. Interfaces may change. Use at your own risk, but we think you'll want to.

---

## What's In Development

### [`normie-installer/`](normie-installer/) — One-Click Install for Everyone

The goal: anyone can install DreamServer, regardless of technical skill.

**The problem we're solving:** DreamServer currently requires Docker knowledge, terminal comfort, and manual configuration. That limits adoption to developers. The normie installer handles all prerequisites automatically — Docker Desktop, WSL2, GPU drivers — then hands off to the existing installer.

| File | Platform | What It Does |
|------|----------|-------------|
| `dreamserver-install.sh` | Linux | Bash one-liner: detects distro, installs Docker, configures GPU passthrough, runs installer |
| `dreamserver-setup.ps1` | Windows | PowerShell: checks Windows build, installs WSL2 + Docker Desktop, handles UAC elevation |
| `dreamserver-setup.bat` | Windows | Double-click wrapper that launches the PowerShell installer with proper execution policy |
| `DreamServer-Install.command` | macOS | Double-click `.command` file, handles Homebrew + Docker Desktop + Apple Silicon detection |
| `macos/dreamserver.rb` | macOS | Homebrew Cask formula — `brew install --cask dreamserver` |
| `windows/dreamserver-setup.nsi` | Windows | NSIS installer script for building a proper `.exe` setup wizard |

**Architecture:** Two-layer design.
- **Layer 1** (these files): Platform-specific prerequisite handlers. They get Docker running.
- **Layer 2** (existing `dream-server/install.sh`): The actual DreamServer installer. Platform-agnostic, assumes Docker exists.

**CI/CD** (`ci/`): GitHub Actions workflows for linting the installer scripts, building the Windows `.exe`, and publishing the bootstrap Docker image.

### [`bootstrap/`](bootstrap/) — Docker Bootstrap Environment

A lightweight Docker image containing everything needed to run the DreamServer installer (git, python, jq, yq, Docker CLI). For environments where installing dependencies directly isn't practical.

| File | Purpose |
|------|---------|
| `Dockerfile` | Multi-stage build, Alpine-based, ~50MB final image |
| `entrypoint.sh` | Clones repo, runs installer inside container with host Docker socket |
| `.dockerignore` | Build context exclusions |

### [`download-page/`](download-page/) — Landing Page

Static HTML download page for `dreamserver.dev/download` (or equivalent). Auto-detects visitor's OS and shows the right installation command. Single-file, no dependencies, deploys anywhere.

### [`dream-server-desktop/`](dream-server-desktop/) — Electron Desktop Shell

Source-first Electron desktop build for Dream Server DESKTOP. It includes the
renderer, shared local runtime, Hermes Agent vendor source, CLI/gRPC entrypoints,
and cross-platform packaging scripts for Windows, Linux, and macOS.

Generated artifacts stay out of Git: `node_modules`, Electron `dist/` output,
Python virtual environments, downloaded standalone Python runtimes, GGUF models,
and machine-specific llama.cpp binaries.

### [`extensions-library/`](extensions-library/) — 33 Service Extensions

**The next wave of DreamServer services.** 17 extensions are already in production — these 33 are being tested for the next release.

Each extension is a self-contained directory with a `manifest.yaml`, `compose.yaml`, and optional Dockerfiles and workflows. Drop any of them into your DreamServer's `extensions/services/` directory.

| Category | Services |
|----------|----------|
| **LLM & Chat** | Ollama, LocalAI, Text Generation WebUI, Jan, LibreChat |
| **Voice & Audio** | Bark TTS, XTTS, Piper, RVC, AudioCraft |
| **Image Gen** | ComfyUI, Fooocus, InvokeAI, Forge |
| **AI Dev & Agents** | Aider, Continue, CrewAI, Open Interpreter, Jupyter |
| **Vector DBs** | ChromaDB, Milvus, Weaviate |
| **Workflow Automation** | Flowise, Langflow, Dify |
| **Self-Hosted Apps** | Immich, Paperless-ngx, Frigate, Gitea, Baserow, SillyTavern |
| **Data & ML** | Label Studio, AnythingLLM, Privacy Shield |

Also includes: 24 pre-built workflows, a JSON Schema for manifest validation, and 5 templates for building your own extensions.

See [`extensions-library/README.md`](extensions-library/README.md) for the full catalog, usage instructions, and how to build your own.

---

## How to Use These

**Want to test the normie installer on Windows?**
```powershell
# From this repo
.\resources\dev\normie-installer\dreamserver-setup.bat
```

**Want to test on macOS?**
```bash
# Double-click or:
chmod +x resources/dev/normie-installer/DreamServer-Install.command
open resources/dev/normie-installer/DreamServer-Install.command
```

**Want to test on Linux?**
```bash
bash resources/dev/normie-installer/dreamserver-install.sh
```

**Want to build the bootstrap image?**
```bash
docker build -t dreamserver-bootstrap resources/dev/bootstrap/
```

---

## Contributing

Found a bug in the installer? OS-specific edge case? Open an issue or PR. These tools are being hardened through real-world testing — your environment is probably different from ours, and that's valuable.

## Roadmap

**Normie Installer**
- [ ] Windows `.exe` installer via NSIS build pipeline
- [ ] Homebrew tap for macOS (`brew install dreamserver`)
- [ ] Auto-update mechanism
- [ ] Offline/air-gapped installation mode
- [ ] ARM64 Linux support (Raspberry Pi, Jetson)

**Extensions Library**
- [ ] Graduate next batch of services to production
- [ ] AMD ROCm support for more GPU services
- [ ] Apple Silicon (MPS) support for image generation
- [ ] Extension dependency resolution in `dream enable`
- [ ] One-command extension marketplace: `dream install <service>`
