# Developer & CI Scripts

> **Looking for server runtime scripts?** Those live in [`dream-server/scripts/`](../dream-server/scripts/) and are deployed to target machines.

This directory contains **CI/CD and release-validation scripts only**. They are never needed on target machines and are not included in the installer.

## Scripts

| Script | Called From | Purpose |
|---|---|---|
| `check-compatibility.sh` | [test-linux.yml](../.github/workflows/test-linux.yml) | Validates `manifest.json` contracts: compose files, workflow catalog, extension schema, and support-matrix consistency. Requires `jq`. |
| `check-release-claims.sh` | [test-linux.yml](../.github/workflows/test-linux.yml) | Verifies release claims match documentation: ensures `manifest.json` platform support flags are consistent with `docs/SUPPORT-MATRIX.md` and `docs/PLATFORM-TRUTH-TABLE.md`. Requires `jq`. |
| `release-gate.sh` | Manual (maintainers) | Full pre-release validation gate. Runs shell linting, compatibility checks, contract tests, smoke tests, and installer simulation in sequence. One-command "is this release ready?" check. |
| `simulate-installers.sh` | [test-linux.yml](../.github/workflows/test-linux.yml), `Makefile` | Runs dry-run simulations of Linux, macOS, and Windows installers, generates JSON/Markdown summary artifacts under `dream-server/artifacts/installer-sim/`. |
| `validate-sim-summary.py` | [test-linux.yml](../.github/workflows/test-linux.yml) | Validates the JSON output from `simulate-installers.sh` to ensure all expected fields are present and simulation results are well-formed. |

## How They Relate

```
Makefile (repo root)
├── make gate ──→ release-gate.sh
│   ├── check-compatibility.sh
│   ├── check-release-claims.sh
│   ├── smoke tests (dream-server/tests/smoke/)
│   ├── contract tests (dream-server/tests/contracts/)
│   └── simulate-installers.sh
│       └── validate-sim-summary.py
├── make simulate ──→ simulate-installers.sh
└── make lint / test / smoke ──→ dream-server/tests/
```

## Running Locally

```bash
# Full release gate (requires jq, python3)
make gate

# Just installer simulation
make simulate

# Individual checks
bash scripts/check-compatibility.sh    # from dream-server/ working dir
bash scripts/check-release-claims.sh   # from dream-server/ working dir
```
