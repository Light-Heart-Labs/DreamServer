# Dream Doctor

Diagnostics command for DreamServer installation and runtime health checks.

## Usage

### Via dream-cli (Recommended)

```bash
# Run diagnostics with operator-friendly output
dream doctor

# Get raw JSON report
dream doctor --json

# Save report to custom location
dream doctor --report /path/to/report.json
```

### Direct Script Invocation

```bash
scripts/dream-doctor.sh
scripts/dream-doctor.sh /tmp/custom-dream-doctor.json
```

## Output

### Operator-Friendly Mode (default)

Displays color-coded diagnostics:
- ✓ Green: Passing checks
- ⚠ Yellow: Warnings
- ✗ Red: Failures/blockers

Example output:
```
━━━ Dream Server Diagnostics ━━━

Runtime Environment:
  ✓ Docker CLI
  ✓ Docker Daemon
  ✓ Docker Compose
  ✗ Dashboard HTTP
  ✗ WebUI HTTP

Preflight Checks:
  ✓ RAM: 16GB available
  ⚠ Disk: 50GB available (recommended: 100GB)
  ✓ GPU: NVIDIA RTX 4090 detected

Summary:
  ⚠ 1 warning(s) found

Suggested Fixes:
  1. Free up disk space or add external storage
```

### JSON Mode

Raw machine-readable report for automation:
```bash
dream doctor --json > report.json
```

## Report Contents

- **capability_profile**: Hardware detection snapshot
- **preflight**: Blocker/warning analysis
- **runtime**: Docker/Compose/UI reachability checks
- **summary**: Aggregate status (blockers, warnings, runtime_ready)
- **autofix_hints**: Prioritized remediation actions

## Exit Codes

- `0`: All checks passed (or warnings only)
- `1`: Blockers found or runtime failures detected

Use in scripts:
```bash
if dream doctor; then
    echo "System healthy"
else
    echo "Issues detected, check output"
fi
```

## Integration

The doctor command integrates with:
- `scripts/build-capability-profile.sh` - Hardware detection
- `scripts/preflight-engine.sh` - Requirement validation
- Service registry - Port resolution

## Default Report Path

`/tmp/dream-doctor-report.json`

