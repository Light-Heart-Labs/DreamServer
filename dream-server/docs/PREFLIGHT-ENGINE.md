# Installer Preflight Engine

The installer runs a capability-aware preflight engine before Docker setup. It validates hard requirements and produces actionable findings (blockers and warnings) and a machine-readable report so installs stay **rock solid** across different hardware and platforms.

## Script

- **Path:** `scripts/preflight-engine.sh`
- **Run from:** dream-server repo root (or pass `--script-dir` to the root).

## Purpose

- Validate hard requirements (platform, memory, disk, GPU, compose overlays).
- Emit **blockers** (must be resolved or acknowledged before continuing) and **warnings** (non-fatal recommendations).
- Write a **machine-readable report JSON** for CI and scripting.
- Support **shell integration** via `--env`: output variable assignments that callers can `eval` to get `PREFLIGHT_BLOCKERS`, `PREFLIGHT_WARNINGS`, `PREFLIGHT_CAN_PROCEED`.

Platform behavior:

- **Linux / WSL** — Treated as primary install targets; full checks.
- **Windows / macOS** — Treated as installer-MVP targets; may produce warnings until full parity (e.g. platform-support warning).

## CLI reference

| Argument | Description |
|----------|-------------|
| `--tier <1-4>` | Tier (e.g. 1=entry, 4=high-end). Affects requirements. |
| `--ram-gb <N>` | RAM in GB. |
| `--disk-gb <N>` | Free disk in GB. |
| `--gpu-backend <amd\|nvidia\|apple\|cpu>` | GPU backend. |
| `--gpu-vram-mb <N>` | GPU VRAM in MB (0 if CPU). |
| `--gpu-name <string>` | Optional GPU name for report. |
| `--platform-id <linux\|windows\|macos\|wsl>` | Platform. |
| `--compose-overlays <file1,file2>` | Comma-separated overlay list. |
| `--script-dir <path>` | Path to dream-server root (for schema/config paths). |
| `--report <path>` | Output report JSON path. |
| `--env` | Emit shell variable assignments for integration (no report file). |

Example:

```bash
scripts/preflight-engine.sh \
  --tier 3 \
  --ram-gb 64 \
  --disk-gb 120 \
  --gpu-backend nvidia \
  --gpu-vram-mb 24576 \
  --gpu-name "RTX 3090" \
  --platform-id linux \
  --compose-overlays docker-compose.base.yml,docker-compose.nvidia.yml \
  --script-dir . \
  --report /tmp/dream-server-preflight-report.json
```

## Report format

The report JSON typically includes:

- **version** — Report schema version.
- **generated_at** — Timestamp.
- **inputs** — Echo of tier, ram-gb, disk-gb, gpu-backend, platform-id, compose_overlays, script_dir.
- **summary** — High-level **blockers** count, **warnings** count, **can_proceed** (boolean).
- **checks** — Array of check objects with **id**, **status** (pass/warn/fail), **message**, **action** (suggested next step).

Consumers (installer phases, CI) can read `summary.blockers`, `summary.warnings`, and `summary.can_proceed` to decide whether to continue or prompt the user.

## Output paths

- **Default report path:** `/tmp/dream-server-preflight-report.json`
- **Override:** Pass `--report /path/to/report.json` or set `PREFLIGHT_REPORT_FILE=/path/to/report.json` when the script supports it.
- **No report (env only):** Use `--env` and redirect or eval; no file is written.

## Shell integration

To get shell variables for use in other scripts:

```bash
eval "$(scripts/preflight-engine.sh --env \
  --tier 2 --ram-gb 16 --disk-gb 80 \
  --gpu-backend nvidia --gpu-vram-mb 8192 \
  --platform-id linux \
  --compose-overlays docker-compose.base.yml,docker-compose.nvidia.yml \
  --script-dir .)"
echo "Blockers: $PREFLIGHT_BLOCKERS"
echo "Warnings: $PREFLIGHT_WARNINGS"
echo "Can proceed: $PREFLIGHT_CAN_PROCEED"
```

The installer and simulation harness use this to drive phase decisions and CI assertions.

## How phases use the report

- **Phase 02 (Detection)** and later phases may read the preflight report or call the engine with detected tier/RAM/disk/GPU to populate blockers and warnings.
- **Phase 04 (Requirements)** uses port checks (and optionally preflight summary) to warn or block when requirements are not met.
- **CI** (e.g. Windows scenario simulation) runs the engine with fixed inputs and validates that the report structure and summary fields exist.
