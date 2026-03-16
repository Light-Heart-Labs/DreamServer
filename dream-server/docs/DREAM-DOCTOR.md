# Dream Doctor

`scripts/dream-doctor.sh` generates a machine-readable diagnostics report for installer and runtime readiness. Use it to verify that a machine is ready for install or to troubleshoot an existing install.

## Usage

```bash
# Default: write report to /tmp/dream-doctor-report.json
scripts/dream-doctor.sh

# Custom output path
scripts/dream-doctor.sh /tmp/custom-dream-doctor.json

# From install directory (after install)
cd ~/dream-server && ./scripts/dream-doctor.sh
```

Run from the **dream-server repo root** (or a path where `lib/service-registry.sh` and `scripts/build-capability-profile.sh` exist). The script sources the service registry and safe-env helpers, then builds a capability profile and preflight-style checks.

## Exit codes

| Code | Meaning |
|------|---------|
| 0 | Report generated successfully. |
| 1 | Error (e.g. missing script dependency, build-capability-profile failed). |

Exit codes are intended for scripting and CI; the report path is always the first argument or the default below.

## Report path

- **Default:** `/tmp/dream-doctor-report.json`
- **Override:** Pass the output file path as the first argument.

## Report contents

The JSON report includes:

- **capability profile snapshot** — Hardware class, backend, tier, compose overlays (from `scripts/build-capability-profile.sh`).
- **preflight-style analysis** — Blockers and warnings derived from capability and environment (similar to what the installer preflight engine produces).
- **runtime checks** — Docker and compose availability, and when possible UI/API reachability (dashboard, webui ports from the service registry).
- **autofix_hints** — Array of suggested next actions (e.g. install Docker, free disk, fix port conflict). Consumers can use this to drive troubleshooting UIs or docs.

Exact field names and structure may evolve; see the script and any schema or CI that consumes the report.

## CI and automation

CI jobs (e.g. installer simulation) often run `scripts/dream-doctor.sh` and then validate or archive the report. The report is machine-readable so downstream steps can assert on blockers, warnings, or specific hints without parsing log text.
