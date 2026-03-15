# Dream Doctor

`scripts/dream-doctor.sh` generates a machine-readable diagnostics report for installer and runtime readiness.

## Usage

```bash
scripts/dream-doctor.sh
scripts/dream-doctor.sh /tmp/custom-dream-doctor.json
```

## Report Contents

- capability profile snapshot
- preflight blocker/warning analysis
- runtime checks (docker/compose/UI reachability)
- `autofix_hints` list with prioritized next actions

Default report path:

- `/tmp/dream-doctor-report.json`
