# Dream Server Agent Platform

Replatform do app antigo para um runtime compartilhado que agora atende:

- Desktop Electron
- CLI `dream`
- servidor headless gRPC

## Escopo no repositorio

Esta arvore e um snapshot leve de desenvolvimento do desktop. Artefatos gerados
e especificos da maquina ficam fora do Git:

- `node_modules/`
- `.venv-hermes/`
- `bin/llama/`
- modelos locais `.gguf`
- saidas de build Electron

Depois de clonar, recrie dependencias com `npm install` e `npm run setup:hermes`.
Para o runtime llama.cpp gerenciado, coloque um `llama-server` compativel em
`bin/llama` ou configure um endpoint OpenAI-compatible nas Settings. Veja
`PROVENANCE.md` para a politica de vendoring.

## Arquitetura

- `app-main.js`: host do Electron, persistencia local e IPC fino
- `runtime/core.js`: sessoes, eventos, permissao, tools e orquestracao
- `runtime/providers/local.js`: provider OpenAI-compatible local
- `runtime/providers/manus.js`: adapter dedicado para Manus
- `runtime/tools.js`: tools locais, arquivos, comandos e web
- `bin/dream.js`: CLI interativa
- `runtime/grpc-server.js`: servidor gRPC

## Recursos entregues

- runtime compartilhado entre desktop e CLI
- provider local padrao em `http://localhost:11434/v1`
- fallback automatico para `8080` e `4000`
- trust mode: `ask`, `session`, `always`
- tools estruturadas para:
  - apps e caminhos locais
  - leitura e escrita de arquivos
  - comandos locais
  - glob/grep
  - web fetch/search
- renderer Electron orientado por eventos do runtime
- stop nativo por sessao
- anexos no desktop

## Rodar

```bash
git lfs install
git lfs pull
npm install
npm start
```

## CLI

```bash
npm run start:cli
```

## gRPC

```bash
npm run start:grpc
```

Variaveis uteis:

- `MANUS_API_KEY`
- `GRPC_HOST`
- `GRPC_PORT`
- `DREAM_HERMES_PYTHON`

## Setup do Hermes Agent

O Hermes Agent fica vendorizado em `vendor/hermes-agent`, mas a venv Python nao
vai para o Git. Prepare a venv local depois de clonar:

```bash
npm run setup:hermes
```

Em macOS/Linux o app tambem procura `.venv-hermes/bin/python`. Em Windows ele
procura `.venv-hermes/Scripts/python.exe` e roda nativamente, sem exigir WSL.
Para as ferramentas locais do Hermes no Windows, instale Git for Windows
(`bash.exe`) ou configure `HERMES_GIT_BASH_PATH`. Se preferir usar outro
Python, configure `DREAM_HERMES_PYTHON`.

## Build

```bash
npm run dist
```

`npm run dist` usa o alvo padrao do sistema atual. Alvos explicitos:

```bash
npm run dist:win
npm run dist:linux
npm run dist:mac
```

Windows gera NSIS, macOS gera DMG, Linux gera AppImage/deb/rpm. O instalador do
Electron nao baixa Docker, WSL, serviços ou modelos. A primeira abertura usa o
Setup Wizard para detectar hardware, indicar o tier DreamServer e baixar apenas
o modelo confirmado pelo usuario.

## Setup Wizard / Local AI

Na primeira execucao o desktop abre o Setup Wizard. Ele faz:

- scan real de OS, arquitetura, CPU, RAM, disco, GPU, VRAM/unified memory,
  WSL2, Docker, Docker Compose, drivers NVIDIA/AMD/Vulkan/Metal e portas comuns
- recomendacao de modo local/cloud/hybrid, backend e tier/modelo alinhada ao
  `tier-map.sh`, `hardware-classes.json` e `gpu-database.json` do DreamServer
- preflight com status OK/Warning/Required para Docker, WSL2, drivers, RAM,
  disco, portas e limitacoes por sistema
- deteccao de DreamServer GitHub ja existente no PC e reaproveitamento da pasta
  local de modelos quando encontrada
- download seguro do GGUF indicado, com progresso em tempo real, arquivo `.part`
  e validacao SHA-256 quando o DreamServer fornece checksum
- configuracao do app em `providerMode=local`, `hermesProvider=custom`,
  endpoint OpenAI-compatible `http://127.0.0.1:11434/v1` e modelo recomendado
- persistencia em `userData/install-state.json`, logs em
  `userData/install-logs/` e modelos em `userData/models/` quando o DreamServer
  local nao existe

O app nao instala a stack completa do DreamServer. Ele usa a base de tiers do
DreamServer v2.3.2 como referencia tecnica e so baixa o modelo local escolhido.
Os wrappers em `scripts/dream/` ficam disponiveis para dry-run/status manual,
mas o fluxo principal do desktop evita rodar `install.sh`/`install.ps1` sem uma
acao explicita.

### Requisitos por OS

- Windows: PowerShell, WSL2 e Docker Desktop sao detectados. Ausencia de Docker
  nao bloqueia download de modelo, mas limita uso de uma stack DreamServer via
  container. NVIDIA usa `nvidia-smi` quando disponivel.
- Linux: Docker Engine/Compose, distro com `apt`, `dnf`, `pacman` ou `zypper`
  sao detectados para diagnostico, systemd quando aplicavel e NVIDIA Container
  Toolkit para GPU em containers.
- macOS: Apple Silicon usa memoria unificada para tier local. Intel Mac recebe
  aviso de limitacao e tende a cloud/hybrid.

### Modos

- Local: baixa o modelo recomendado pelo tier de hardware e configura a rota
  custom/local do app.
- Cloud/API: evita downloads pesados e usa provider externo configurado no app.
- Hybrid: usa modelo local quando disponivel e mantem fallback cloud/API.
- Bootstrap: a tabela inclui o tier leve do DreamServer, mas o fluxo atual baixa
  o modelo principal confirmado pelo usuario.

Depois do setup, abra `Settings > Local > System / Local AI > Models` para ver
download, arquivo GGUF, endpoint, DreamServer detectado, logs, diagnostico e
pasta de dados.

## Validação

```bash
npm run test:installer
npm run test:runtime
```

Os testes de instalador cobrem selecao de tier/modelo e preflight para Windows
sem WSL/Docker, cloud mode, pouca RAM e porta ocupada. Use o botao `Dry-run` do
wizard para validar o plano de download sem baixar modelos grandes.

## Troubleshooting

- Docker ausente/parado: abra Docker Desktop ou instale Docker Engine/Compose e
  rode o preflight novamente.
- Windows sem WSL2: ative WSL2 e o backend WSL2 no Docker Desktop; o app nao
  força essa instalacao automaticamente.
- Driver NVIDIA: se `nvidia-smi` falhar, atualize o driver. No Linux, Secure
  Boot pode impedir o modulo NVIDIA.
- Pouco disco: libere espaco antes de baixar modelos. O wizard mostra tamanho
  estimado por tier.
- Falha no meio: use `Retry`; o estado e logs ficam em `install-state.json` e
  `install-logs/`.

Modelos `.gguf`, `.venv-hermes` e binarios de `bin/llama` nao ficam no Git
porque sao grandes e variam por maquina.
Para usar llama.cpp local em macOS/Linux, substitua por um `llama-server`
compativel em `bin/llama` ou rode um servidor OpenAI-compatible externo e
configure a URL no app.

## Snapshot completo

Este repositorio preserva o snapshot fonte/runtime leve do Dream Server,
incluindo:

- `vendor/hermes-agent`
- `vendor/browser-harness-upstream`
- `vendor/hermes-ios-panel-plugin`

O executavel compilado, `node_modules`, `.venv-hermes`, `bin/llama`, modelos e
demais saidas de build continuam fora do Git.
