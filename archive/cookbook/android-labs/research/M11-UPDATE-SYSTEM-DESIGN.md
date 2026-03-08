# M11: Dream Server Update System — Comprehensive Design

**Version:** 1.0  
**Date:** 2026-02-13  
**Status:** Design Document  
**Author:** Android-17 (M11 Subagent)

---

## Executive Summary

This document provides a complete design for Dream Server's update mechanism, enabling users to safely upgrade from any version to any newer version without data loss or manual configuration editing. The system supports automatic rollback on failure and preserves all user customizations.

**Core Question Answered:** *How does a user go from v1.0 to v1.1 without losing data or config?*

> They run `./dream-update.sh update`. The system backs up their config, pulls the new version, runs migrations to merge new defaults with their customizations, validates services start correctly, and either completes successfully or automatically restores their working state.

---

## Table of Contents

1. [Version Tracking](#1-version-tracking)
2. [Update Check Mechanism](#2-update-check-mechanism)
3. [Backup Strategy](#3-backup-strategy)
4. [Config Migration](#4-config-migration)
5. [Rollback Mechanism](#5-rollback-mechanism)
6. [Data Preservation](#6-data-preservation)
7. [Changelog Display](#7-changelog-display)
8. [Complete Update Script](#8-complete-update-script-pseudo-code)
9. [User Journey: v1.0 → v1.1](#9-user-journey-v10--v11)

---

## 1. Version Tracking

### 1.1 Semantic Versioning Format

Dream Server follows [Semantic Versioning 2.0.0](https://semver.org/):

```
MAJOR.MINOR.PATCH[-PRERELEASE][+BUILD]

v1.2.3-beta+20260213
│ │ │   │       │
│ │ │   │       └── Build metadata (ignored in comparison)
│ │ │   └────────── Pre-release (optional, sorts before release)
│ │ └────────────── PATCH: Backward-compatible bug fixes
│ └──────────────── MINOR: Backward-compatible new features
└────────────────── MAJOR: Breaking changes (migration required)
```

### 1.2 Version File (`.version`)

Located at the repository root, this file is the single source of truth for installed version:

```json
{
  "version": "1.0.0",
  "installed_at": "2026-02-13T10:30:00Z",
  "updated_at": "2026-02-13T10:30:00Z",
  "update_channel": "stable",
  "install_id": "f7a8b9c0-1234-5678-90ab-cdef12345678"
}
```

**Fields:**

| Field | Type | Purpose |
|-------|------|---------|
| `version` | string | Current semantic version (without 'v' prefix internally) |
| `installed_at` | ISO 8601 | Original install timestamp |
| `updated_at` | ISO 8601 | Last successful update timestamp |
| `update_channel` | enum | `stable`, `beta`, `nightly` |
| `install_id` | UUID | Anonymous telemetry ID (opt-in) |

### 1.3 Version Manifest (`releases.json`)

Published to GitHub releases and optionally a custom CDN:

```json
{
  "latest": {
    "stable": "1.1.0",
    "beta": "1.2.0-beta.1",
    "nightly": "1.2.0-nightly.20260213"
  },
  "releases": [
    {
      "version": "1.1.0",
      "channel": "stable",
      "released_at": "2026-02-15T00:00:00Z",
      "min_upgrade_from": "0.9.0",
      "sha256": "abc123...",
      "changelog_url": "https://github.com/.../releases/tag/v1.1.0",
      "breaking_changes": false,
      "requires_migration": true,
      "migration_files": ["migrate-1.0-to-1.1.sh"],
      "size_bytes": 15240000,
      "download_url": "https://github.com/.../archive/refs/tags/v1.1.0.tar.gz"
    },
    {
      "version": "1.0.0",
      "channel": "stable",
      "released_at": "2026-02-01T00:00:00Z",
      "min_upgrade_from": null,
      "breaking_changes": false,
      "requires_migration": false
    }
  ],
  "deprecation_notices": [
    {
      "version": "0.9.0",
      "message": "Version 0.9.x is no longer supported. Please upgrade to 1.x.",
      "severity": "warning"
    }
  ]
}
```

### 1.4 Version Comparison Algorithm

```bash
# Semantic version comparison (bash implementation)
# Returns: 0 if equal, 1 if v1 > v2, 2 if v1 < v2

semver_compare() {
    local v1="${1#v}"  # Strip 'v' prefix
    local v2="${2#v}"
    
    # Extract pre-release (anything after -)
    local v1_pre="" v2_pre=""
    if [[ "$v1" == *"-"* ]]; then
        v1_pre="${v1#*-}"
        v1="${v1%%-*}"
    fi
    if [[ "$v2" == *"-"* ]]; then
        v2_pre="${v2#*-}"
        v2="${v2%%-*}"
    fi
    
    # Compare MAJOR.MINOR.PATCH
    IFS='.' read -ra V1 <<< "$v1"
    IFS='.' read -ra V2 <<< "$v2"
    
    for i in 0 1 2; do
        local n1="${V1[$i]:-0}"
        local n2="${V2[$i]:-0}"
        if (( n1 > n2 )); then return 1; fi
        if (( n1 < n2 )); then return 2; fi
    done
    
    # Pre-release: empty > non-empty (1.0.0 > 1.0.0-beta)
    if [[ -z "$v1_pre" && -n "$v2_pre" ]]; then return 1; fi
    if [[ -n "$v1_pre" && -z "$v2_pre" ]]; then return 2; fi
    if [[ "$v1_pre" > "$v2_pre" ]]; then return 1; fi
    if [[ "$v1_pre" < "$v2_pre" ]]; then return 2; fi
    
    return 0  # Equal
}
```

---

## 2. Update Check Mechanism

### 2.1 Primary: GitHub Releases API

**Rationale:** GitHub releases are already used for distribution, require no additional infrastructure, and support authenticated requests for higher rate limits.

```bash
GITHUB_REPO="Lightheartdevs/Android-Labs"
GITHUB_API="https://api.github.com/repos/${GITHUB_REPO}/releases/latest"

check_github_update() {
    local auth_header=""
    if [[ -n "$GITHUB_TOKEN" ]]; then
        auth_header="-H 'Authorization: token $GITHUB_TOKEN'"
    fi
    
    local response
    response=$(curl -sf $auth_header "$GITHUB_API" 2>/dev/null)
    
    if [[ $? -ne 0 ]]; then
        echo "ERROR: Failed to fetch releases" >&2
        return 1
    fi
    
    local latest_version
    latest_version=$(echo "$response" | jq -r '.tag_name // empty')
    
    if [[ -z "$latest_version" ]]; then
        echo "ERROR: Could not parse version from response" >&2
        return 1
    fi
    
    echo "$latest_version"
}
```

### 2.2 Fallback: Custom Endpoint

For air-gapped or enterprise deployments:

```yaml
# .env configuration
UPDATE_SOURCE=custom          # Options: github, custom, disabled
UPDATE_ENDPOINT=https://updates.internal.company.com/dream-server/releases.json
UPDATE_CHECK_INTERVAL=86400   # Seconds (24h)
```

```bash
check_custom_update() {
    local endpoint="${UPDATE_ENDPOINT:-}"
    local channel="${UPDATE_CHANNEL:-stable}"
    
    if [[ -z "$endpoint" ]]; then
        echo "ERROR: UPDATE_ENDPOINT not configured" >&2
        return 1
    fi
    
    local response
    response=$(curl -sf "$endpoint" 2>/dev/null)
    
    if [[ $? -ne 0 ]]; then
        echo "ERROR: Failed to fetch from custom endpoint" >&2
        return 1
    fi
    
    local latest_version
    latest_version=$(echo "$response" | jq -r ".latest.${channel} // empty")
    
    echo "$latest_version"
}
```

### 2.3 Update Check Caching

To avoid rate limits and reduce latency:

```bash
CACHE_FILE=".update-cache.json"
CACHE_TTL=3600  # 1 hour

get_cached_version() {
    if [[ ! -f "$CACHE_FILE" ]]; then
        return 1
    fi
    
    local cache_time
    cache_time=$(jq -r '.cached_at // 0' "$CACHE_FILE")
    local now=$(date +%s)
    
    if (( now - cache_time > CACHE_TTL )); then
        return 1  # Cache expired
    fi
    
    jq -r '.latest_version' "$CACHE_FILE"
}

update_cache() {
    local version="$1"
    cat > "$CACHE_FILE" << EOF
{
    "latest_version": "$version",
    "cached_at": $(date +%s),
    "checked_from": "$(hostname)"
}
EOF
}
```

### 2.4 Rate Limiting Handling

```bash
check_rate_limit() {
    local response
    response=$(curl -sf "https://api.github.com/rate_limit" 2>/dev/null)
    
    local remaining
    remaining=$(echo "$response" | jq '.resources.core.remaining')
    
    if (( remaining < 5 )); then
        local reset_time
        reset_time=$(echo "$response" | jq '.resources.core.reset')
        local wait_seconds=$(( reset_time - $(date +%s) ))
        
        echo "WARN: GitHub rate limit low ($remaining remaining)" >&2
        echo "WARN: Resets in $wait_seconds seconds" >&2
        echo "HINT: Set GITHUB_TOKEN for higher limits (5000/hr)" >&2
        return 1
    fi
    
    return 0
}
```

---

## 3. Backup Strategy

### 3.1 What to Backup

| Category | Files/Paths | Backup Method | Restore Priority |
|----------|-------------|---------------|------------------|
| **Config (Critical)** | `.env`, `.env.*` | Copy | P1 - Required |
| **Compose Files** | `docker-compose*.yml` | Copy | P1 - Required |
| **Version State** | `.version` | Copy | P1 - Required |
| **Custom Configs** | `config/**` | Recursive copy | P2 - Important |
| **SSL Certificates** | `certs/**` | Recursive copy | P2 - Important |
| **Volume Metadata** | Volume list JSON | Generate | P3 - Reference |
| **Container State** | Container list JSON | Generate | P3 - Reference |

### 3.2 What NOT to Backup (Automatically)

| Category | Reason | Manual Backup Available |
|----------|--------|------------------------|
| Docker Volumes | Too large (models, databases) | `dream-backup.sh volumes` |
| Log Files | Not needed for recovery | Archive separately |
| Cache Files | Regenerated automatically | No |

### 3.3 Backup Directory Structure

```
.backups/
├── pre-update-v1.1.0-20260213-103000/
│   ├── metadata.json
│   ├── config/
│   │   ├── .env
│   │   ├── .env.local
│   │   └── docker-compose.override.yml
│   ├── compose/
│   │   ├── docker-compose.yml
│   │   └── docker-compose.gpu.yml
│   ├── version/
│   │   └── .version
│   ├── custom/
│   │   └── config/
│   │       └── litellm/
│   │           └── config.yaml
│   └── state/
│       ├── volumes.json
│       └── containers.json
├── manual-before-experiment-20260213-090000/
│   └── ...
└── latest -> pre-update-v1.1.0-20260213-103000/
```

### 3.4 Backup Metadata Format

```json
{
    "backup_id": "pre-update-v1.1.0-20260213-103000",
    "backup_type": "pre-update",
    "created_at": "2026-02-13T10:30:00Z",
    "hostname": "dream-server-01",
    "from_version": "1.0.0",
    "to_version": "1.1.0",
    "files_count": 12,
    "total_size_bytes": 45678,
    "volumes_referenced": [
        "dream-vllm-cache",
        "dream-postgres-data",
        "dream-n8n-data"
    ],
    "containers_running": [
        "dream-vllm",
        "dream-whisper",
        "dream-dashboard"
    ],
    "checksum": "sha256:abc123..."
}
```

### 3.5 Backup Implementation

```bash
BACKUP_DIR=".backups"
MAX_BACKUPS=10  # Retain last N backups

create_backup() {
    local backup_name="$1"
    local backup_type="${2:-manual}"
    local target_version="${3:-}"
    
    local timestamp=$(date +%Y%m%d-%H%M%S)
    local backup_id="${backup_name}-${timestamp}"
    local backup_path="${BACKUP_DIR}/${backup_id}"
    
    echo "Creating backup: $backup_id"
    
    mkdir -p "$backup_path"/{config,compose,version,custom,state}
    
    # Critical configs
    cp -f .env* "$backup_path/config/" 2>/dev/null || true
    
    # Compose files
    cp -f docker-compose*.yml "$backup_path/compose/" 2>/dev/null || true
    
    # Version file
    cp -f .version "$backup_path/version/" 2>/dev/null || true
    
    # Custom configs (if exist)
    if [[ -d "config" ]]; then
        cp -r config "$backup_path/custom/"
    fi
    
    # SSL certs (if exist)
    if [[ -d "certs" ]]; then
        cp -r certs "$backup_path/custom/"
    fi
    
    # Capture running state
    docker volume ls --format json > "$backup_path/state/volumes.json" 2>/dev/null || echo "[]" > "$backup_path/state/volumes.json"
    docker ps --format json > "$backup_path/state/containers.json" 2>/dev/null || echo "[]" > "$backup_path/state/containers.json"
    
    # Generate metadata
    local current_version
    current_version=$(jq -r '.version' .version 2>/dev/null || echo "unknown")
    local file_count
    file_count=$(find "$backup_path" -type f | wc -l)
    local total_size
    total_size=$(du -sb "$backup_path" | cut -f1)
    
    cat > "$backup_path/metadata.json" << EOF
{
    "backup_id": "$backup_id",
    "backup_type": "$backup_type",
    "created_at": "$(date -Iseconds)",
    "hostname": "$(hostname)",
    "from_version": "$current_version",
    "to_version": "$target_version",
    "files_count": $file_count,
    "total_size_bytes": $total_size
}
EOF
    
    # Update symlink
    ln -sfn "$backup_id" "${BACKUP_DIR}/latest"
    
    # Cleanup old backups
    cleanup_old_backups
    
    echo "Backup complete: $backup_path"
    echo "$backup_path"
}

cleanup_old_backups() {
    local backups
    backups=($(ls -1dt "${BACKUP_DIR}"/*/ 2>/dev/null | grep -v "^${BACKUP_DIR}/latest"))
    
    local count=${#backups[@]}
    if (( count > MAX_BACKUPS )); then
        local to_delete=$(( count - MAX_BACKUPS ))
        echo "Cleaning up $to_delete old backup(s)..."
        
        for (( i = count - to_delete; i < count; i++ )); do
            echo "  Removing: ${backups[$i]}"
            rm -rf "${backups[$i]}"
        done
    fi
}
```

### 3.6 Restore Implementation

```bash
restore_backup() {
    local backup_id="$1"
    local backup_path="${BACKUP_DIR}/${backup_id}"
    
    if [[ ! -d "$backup_path" ]]; then
        echo "ERROR: Backup not found: $backup_id" >&2
        return 1
    fi
    
    echo "Restoring from backup: $backup_id"
    
    # Stop services first
    docker compose down 2>/dev/null || true
    
    # Restore configs
    if [[ -d "$backup_path/config" ]]; then
        cp -f "$backup_path/config/"* . 2>/dev/null || true
    fi
    
    # Restore compose files
    if [[ -d "$backup_path/compose" ]]; then
        cp -f "$backup_path/compose/"* . 2>/dev/null || true
    fi
    
    # Restore version file
    if [[ -f "$backup_path/version/.version" ]]; then
        cp -f "$backup_path/version/.version" .
    fi
    
    # Restore custom configs
    if [[ -d "$backup_path/custom/config" ]]; then
        cp -r "$backup_path/custom/config" .
    fi
    
    # Restart services
    docker compose up -d
    
    echo "Restore complete. Services restarting..."
}

list_backups() {
    echo "Available backups:"
    echo ""
    
    for backup in $(ls -1dt "${BACKUP_DIR}"/*/ 2>/dev/null | grep -v "latest"); do
        local name=$(basename "$backup")
        local meta="$backup/metadata.json"
        
        if [[ -f "$meta" ]]; then
            local created=$(jq -r '.created_at' "$meta")
            local from_ver=$(jq -r '.from_version' "$meta")
            local type=$(jq -r '.backup_type' "$meta")
            printf "  %-40s %s (v%s, %s)\n" "$name" "$created" "$from_ver" "$type"
        else
            printf "  %-40s (no metadata)\n" "$name"
        fi
    done
}
```

---

## 4. Config Migration

### 4.1 Migration Philosophy

**Principle:** Additive changes are automatic; breaking changes require explicit migration scripts.

| Change Type | Handling | User Action Required |
|-------------|----------|---------------------|
| New env var with default | Add to .env.example, inject during update | None |
| Changed default value | Keep user's value, note in changelog | Optional |
| Renamed env var | Migration script transforms | None |
| Removed env var | Migration script removes + warns | None |
| New required env var | Migration script prompts or defaults | Possibly |
| Schema change (compose) | Migration script transforms | None |

### 4.2 Migration File Structure

```
migrations/
├── README.md
├── v1.0.0-to-v1.1.0.sh
├── v1.1.0-to-v1.2.0.sh
├── v1.2.0-to-v2.0.0.sh      # Major version = more complex
└── common/
    ├── env-merge.sh          # Reusable env merging
    └── compose-transform.sh  # Compose file transforms
```

### 4.3 Migration Script Template

```bash
#!/bin/bash
# migrations/v1.0.0-to-v1.1.0.sh
# 
# Migration: Dream Server v1.0.0 → v1.1.0
# Author: Release Manager
# Date: 2026-02-15
#
# Changes:
#   - NEW: DREAM_CACHE_TTL env var (default: 3600)
#   - NEW: monitoring-stack services
#   - CHANGED: VLLM_MODEL default → Qwen2.5-72B
#   - DEPRECATED: LEGACY_API_MODE (removed)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
source "${SCRIPT_DIR}/common/env-merge.sh" 2>/dev/null || true

echo "[MIGRATE] v1.0.0 → v1.1.0 starting..."

# -----------------------------------------------------------------------------
# ENV MIGRATIONS
# -----------------------------------------------------------------------------

# Add new env var with default (idempotent)
if ! grep -q "^DREAM_CACHE_TTL=" .env 2>/dev/null; then
    echo "" >> .env
    echo "# Cache TTL in seconds (added v1.1.0)" >> .env
    echo "DREAM_CACHE_TTL=3600" >> .env
    echo "[MIGRATE]   Added DREAM_CACHE_TTL=3600"
fi

# Add new section for monitoring
if ! grep -q "^# Monitoring" .env 2>/dev/null; then
    cat >> .env << 'EOF'

# Monitoring (added v1.1.0)
PROMETHEUS_RETENTION=15d
GRAFANA_ADMIN_PASSWORD=changeme
EOF
    echo "[MIGRATE]   Added monitoring configuration"
fi

# Remove deprecated var
if grep -q "^LEGACY_API_MODE=" .env 2>/dev/null; then
    sed -i '/^LEGACY_API_MODE=/d' .env
    sed -i '/^# Enable legacy API/d' .env  # Remove comment too
    echo "[MIGRATE]   Removed deprecated LEGACY_API_MODE"
fi

# -----------------------------------------------------------------------------
# COMPOSE MIGRATIONS
# -----------------------------------------------------------------------------

# Check if user has override file
if [[ -f "docker-compose.override.yml" ]]; then
    echo "[MIGRATE]   User override detected, preserving..."
    
    # If old format, transform
    if grep -q "version: '3" docker-compose.override.yml; then
        # Remove deprecated version field (Compose V2)
        sed -i '/^version:/d' docker-compose.override.yml
        echo "[MIGRATE]   Removed deprecated 'version' field from override"
    fi
fi

# -----------------------------------------------------------------------------
# DATA MIGRATIONS
# -----------------------------------------------------------------------------

# No data migrations for this version

# -----------------------------------------------------------------------------
# VALIDATION
# -----------------------------------------------------------------------------

# Verify critical vars exist
required_vars=("VLLM_MODEL" "DREAM_CACHE_TTL")
for var in "${required_vars[@]}"; do
    if ! grep -q "^${var}=" .env 2>/dev/null; then
        echo "[ERROR] Required variable missing after migration: $var" >&2
        exit 1
    fi
done

echo "[MIGRATE] v1.0.0 → v1.1.0 complete ✓"
exit 0
```

### 4.4 Env Merge Strategy

For merging new defaults with user customizations:

```bash
# common/env-merge.sh

# Merge .env.example changes into .env
# Preserves user values, adds new keys with defaults
merge_env_example() {
    local example=".env.example"
    local target=".env"
    
    if [[ ! -f "$example" ]]; then
        return 0
    fi
    
    # Read all keys from example
    while IFS='=' read -r key value; do
        # Skip comments and empty lines
        [[ "$key" =~ ^#.*$ || -z "$key" ]] && continue
        
        # Strip leading/trailing whitespace
        key=$(echo "$key" | xargs)
        
        # If key not in target, add it
        if ! grep -q "^${key}=" "$target" 2>/dev/null; then
            echo "${key}=${value}" >> "$target"
            echo "[ENV-MERGE] Added: ${key}"
        fi
    done < "$example"
}

# Get value or default
get_env_or_default() {
    local key="$1"
    local default="$2"
    
    local value
    value=$(grep "^${key}=" .env 2>/dev/null | cut -d'=' -f2-)
    
    echo "${value:-$default}"
}
```

### 4.5 Migration Chain Execution

```bash
run_migrations() {
    local from_version="$1"
    local to_version="$2"
    
    echo "Running migrations: v${from_version} → v${to_version}"
    
    # Find all applicable migrations
    local migrations=()
    local current="$from_version"
    
    for script in migrations/v*.sh; do
        [[ ! -f "$script" ]] && continue
        
        # Extract versions from filename: v1.0.0-to-v1.1.0.sh
        local filename=$(basename "$script")
        local script_from script_to
        
        if [[ "$filename" =~ ^v([0-9.]+)-to-v([0-9.]+)\.sh$ ]]; then
            script_from="${BASH_REMATCH[1]}"
            script_to="${BASH_REMATCH[2]}"
            
            # Check if this migration applies
            semver_compare "$current" "$script_from"
            local cmp_from=$?
            
            semver_compare "$script_to" "$to_version"
            local cmp_to=$?
            
            # Include if: current <= script_from AND script_to <= to_version
            if [[ $cmp_from -eq 0 || $cmp_from -eq 2 ]] && \
               [[ $cmp_to -eq 0 || $cmp_to -eq 2 ]]; then
                migrations+=("$script")
            fi
        fi
    done
    
    # Sort migrations by version (filename sort works for semver)
    IFS=$'\n' migrations=($(sort <<< "${migrations[*]}"))
    unset IFS
    
    if [[ ${#migrations[@]} -eq 0 ]]; then
        echo "No migrations needed"
        return 0
    fi
    
    echo "Found ${#migrations[@]} migration(s) to run:"
    for m in "${migrations[@]}"; do
        echo "  - $(basename "$m")"
    done
    echo ""
    
    # Execute in order
    for script in "${migrations[@]}"; do
        echo "Executing: $(basename "$script")"
        
        if ! bash "$script"; then
            echo "ERROR: Migration failed: $script" >&2
            return 1
        fi
        
        echo ""
    done
    
    echo "All migrations complete"
    return 0
}
```

---

## 5. Rollback Mechanism

### 5.1 Rollback Triggers

| Trigger | Automatic | Manual Command |
|---------|-----------|----------------|
| Health check fails | ✅ Yes | N/A |
| Migration script fails | ✅ Yes | N/A |
| User requests | No | `dream-update.sh rollback` |
| Container won't start | ✅ Yes | N/A |
| Dashboard unreachable | ✅ Yes (configurable) | N/A |

### 5.2 Health Check Suite

```bash
HEALTH_TIMEOUT=60  # Seconds to wait for services

run_health_checks() {
    echo "Running health checks..."
    local failed=0
    
    # Wait for containers to start
    sleep 5
    
    # Check 1: Critical containers running
    local required_containers=("dream-vllm" "dream-dashboard")
    for container in "${required_containers[@]}"; do
        if ! docker ps --format '{{.Names}}' | grep -q "^${container}$"; then
            echo "  FAIL: Container not running: $container"
            (( failed++ ))
        else
            echo "  OK: Container running: $container"
        fi
    done
    
    # Check 2: Dashboard responding
    local dashboard_url="http://localhost:${DASHBOARD_PORT:-3000}/health"
    local attempts=0
    local max_attempts=$(( HEALTH_TIMEOUT / 5 ))
    
    while (( attempts < max_attempts )); do
        if curl -sf "$dashboard_url" > /dev/null 2>&1; then
            echo "  OK: Dashboard health check passed"
            break
        fi
        (( attempts++ ))
        sleep 5
    done
    
    if (( attempts >= max_attempts )); then
        echo "  FAIL: Dashboard not responding after ${HEALTH_TIMEOUT}s"
        (( failed++ ))
    fi
    
    # Check 3: vLLM inference test (optional)
    if [[ "${HEALTH_CHECK_INFERENCE:-false}" == "true" ]]; then
        local vllm_url="http://localhost:${VLLM_PORT:-8000}/v1/models"
        if curl -sf "$vllm_url" > /dev/null 2>&1; then
            echo "  OK: vLLM responding"
        else
            echo "  WARN: vLLM not yet responding (may still be loading model)"
        fi
    fi
    
    # Check 4: Run dream-test.sh if available
    if [[ -x "scripts/dream-test.sh" ]]; then
        echo "  Running dream-test.sh..."
        if scripts/dream-test.sh --quick 2>&1 | while read -r line; do
            echo "    $line"
        done; then
            echo "  OK: dream-test.sh passed"
        else
            echo "  FAIL: dream-test.sh failed"
            (( failed++ ))
        fi
    fi
    
    if (( failed > 0 )); then
        echo ""
        echo "Health check FAILED ($failed check(s))"
        return 1
    fi
    
    echo ""
    echo "All health checks PASSED"
    return 0
}
```

### 5.3 Automatic Rollback Flow

```bash
perform_update_with_rollback() {
    local target_version="$1"
    local current_version
    current_version=$(jq -r '.version' .version)
    
    # Phase 1: Create backup
    echo "Phase 1/4: Creating backup..."
    local backup_path
    backup_path=$(create_backup "pre-update-v${target_version}" "pre-update" "$target_version")
    
    if [[ -z "$backup_path" ]]; then
        echo "ERROR: Backup creation failed, aborting update" >&2
        return 1
    fi
    
    # Phase 2: Pull new code
    echo "Phase 2/4: Pulling update..."
    if ! git pull origin main; then
        echo "ERROR: Git pull failed" >&2
        echo "Backup available at: $backup_path"
        return 1
    fi
    
    # Phase 3: Run migrations
    echo "Phase 3/4: Running migrations..."
    if ! run_migrations "$current_version" "$target_version"; then
        echo "ERROR: Migration failed, initiating rollback..." >&2
        restore_backup "$(basename "$backup_path")"
        docker compose up -d
        echo "Rollback complete. System restored to v${current_version}"
        return 1
    fi
    
    # Phase 4: Restart and health check
    echo "Phase 4/4: Restarting services..."
    docker compose down
    docker compose pull  # Get new images if any
    docker compose up -d
    
    echo "Waiting for services to start..."
    if ! run_health_checks; then
        echo "ERROR: Health checks failed, initiating rollback..." >&2
        restore_backup "$(basename "$backup_path")"
        docker compose up -d
        
        # Verify rollback worked
        sleep 10
        if run_health_checks; then
            echo "Rollback successful. System restored to v${current_version}"
        else
            echo "CRITICAL: Rollback health check also failed!" >&2
            echo "Manual intervention required." >&2
            echo "Backup location: $backup_path" >&2
        fi
        return 1
    fi
    
    # Update version file
    jq --arg v "$target_version" --arg t "$(date -Iseconds)" \
        '.version = $v | .updated_at = $t' .version > .version.tmp
    mv .version.tmp .version
    
    echo ""
    echo "════════════════════════════════════════"
    echo "  Update complete: v${current_version} → v${target_version}"
    echo "════════════════════════════════════════"
    
    return 0
}
```

### 5.4 Manual Rollback

```bash
cmd_rollback() {
    local backup_id="$1"
    
    if [[ -z "$backup_id" ]]; then
        list_backups
        echo ""
        echo "Usage: dream-update.sh rollback <backup-id>"
        return 1
    fi
    
    echo "Rolling back to: $backup_id"
    echo ""
    echo "WARNING: This will:"
    echo "  1. Stop all Dream Server services"
    echo "  2. Restore configuration from backup"
    echo "  3. Restart services"
    echo ""
    echo "Data volumes will NOT be affected."
    echo ""
    
    read -p "Continue? [y/N] " confirm
    if [[ "$confirm" != "y" && "$confirm" != "Y" ]]; then
        echo "Cancelled."
        return 0
    fi
    
    restore_backup "$backup_id"
    
    echo ""
    echo "Verifying services..."
    sleep 10
    
    if run_health_checks; then
        echo "Rollback complete. System operational."
    else
        echo "WARNING: Some services may not be healthy."
        echo "Check logs: docker compose logs"
    fi
}
```

---

## 6. Data Preservation

### 6.1 Volume Management Strategy

Dream Server uses named Docker volumes for all persistent data:

| Volume Name | Contents | Backup Strategy | Critical |
|-------------|----------|-----------------|----------|
| `dream-vllm-cache` | Model cache | Regenerated | No |
| `dream-postgres-data` | Database | Snapshot | Yes |
| `dream-n8n-data` | Workflows | Snapshot | Yes |
| `dream-qdrant-data` | Vector store | Snapshot | Yes |
| `dream-grafana-data` | Dashboards | Snapshot | Medium |
| `dream-models` | Downloaded models | Preserve | Yes (slow to redownload) |

### 6.2 Volume Preservation During Update

**Volumes persist automatically.** Docker Compose recreates containers but preserves named volumes:

```yaml
# docker-compose.yml
services:
  postgres:
    volumes:
      - dream-postgres-data:/var/lib/postgresql/data

volumes:
  dream-postgres-data:
    # Named volume persists across container recreation
```

### 6.3 Explicit Volume Backup (Optional)

For users who want full data backup:

```bash
backup_volumes() {
    local backup_dir="$1"
    local volumes=("dream-postgres-data" "dream-n8n-data" "dream-qdrant-data")
    
    echo "Backing up Docker volumes..."
    mkdir -p "$backup_dir/volumes"
    
    for vol in "${volumes[@]}"; do
        if docker volume inspect "$vol" > /dev/null 2>&1; then
            echo "  Backing up: $vol"
            docker run --rm \
                -v "${vol}:/source:ro" \
                -v "$(pwd)/${backup_dir}/volumes:/backup" \
                alpine tar czf "/backup/${vol}.tar.gz" -C /source .
        fi
    done
}

restore_volumes() {
    local backup_dir="$1"
    
    echo "Restoring Docker volumes..."
    
    for archive in "$backup_dir"/volumes/*.tar.gz; do
        [[ ! -f "$archive" ]] && continue
        
        local vol=$(basename "$archive" .tar.gz)
        echo "  Restoring: $vol"
        
        # Create volume if not exists
        docker volume create "$vol" 2>/dev/null || true
        
        docker run --rm \
            -v "${vol}:/target" \
            -v "$(pwd)/${archive}:/backup.tar.gz:ro" \
            alpine sh -c "cd /target && tar xzf /backup.tar.gz"
    done
}
```

### 6.4 Database Migration Safety

For PostgreSQL schema changes:

```bash
# migrations/v1.0.0-to-v1.1.0.sh (database section)

migrate_database() {
    echo "[MIGRATE] Checking database migrations..."
    
    # Run migration SQL if container is running
    if docker ps --format '{{.Names}}' | grep -q "dream-postgres"; then
        echo "[MIGRATE]   Applying database migrations..."
        
        docker exec dream-postgres psql -U dream -d dream -c "
            -- Idempotent migration
            DO \$\$
            BEGIN
                IF NOT EXISTS (
                    SELECT 1 FROM information_schema.columns
                    WHERE table_name = 'settings' AND column_name = 'cache_ttl'
                ) THEN
                    ALTER TABLE settings ADD COLUMN cache_ttl INTEGER DEFAULT 3600;
                END IF;
            END
            \$\$;
        "
        
        echo "[MIGRATE]   Database migration complete"
    else
        echo "[MIGRATE]   Database not running, skipping SQL migrations"
        echo "[MIGRATE]   Will be applied on next startup"
    fi
}
```

---

## 7. Changelog Display

### 7.1 Changelog Format (CHANGELOG.md)

Following [Keep a Changelog](https://keepachangelog.com/):

```markdown
# Changelog

All notable changes to Dream Server will be documented in this file.

## [Unreleased]

### Added
- Dark mode for dashboard

## [1.1.0] - 2026-02-15

### Added
- **Monitoring Stack:** Prometheus + Grafana for system metrics
- **Auto-update:** One-click updates from dashboard
- **Voice Agent Templates:** Pre-built conversation flows

### Changed
- Default model upgraded to Qwen2.5-72B
- Improved startup time by 40%

### Fixed
- Fixed memory leak in long-running voice sessions (#142)
- Resolved port conflict when monitoring enabled (#156)

### Security
- Updated base images to latest security patches

### Deprecated
- `LEGACY_API_MODE` env var removed (use standard API)

## [1.0.0] - 2026-02-01

### Added
- Initial release
- vLLM inference with OpenAI-compatible API
- Voice pipeline (Whisper + TTS)
- Web dashboard
- Hardware auto-detection
```

### 7.2 Dashboard Integration

**API Endpoint:**

```python
# dashboard-api/main.py

@app.get("/api/version")
async def get_version():
    current = read_version_file()
    latest = get_cached_latest_version()
    
    return {
        "current": current["version"],
        "latest": latest,
        "update_available": semver_compare(latest, current["version"]) > 0,
        "changelog_url": f"https://github.com/{REPO}/releases/tag/v{latest}",
        "last_checked": get_cache_timestamp()
    }

@app.get("/api/changelog")
async def get_changelog(version: str = None):
    """Fetch changelog for specific version or current"""
    if version:
        return fetch_github_release_notes(version)
    else:
        return parse_local_changelog()
```

**Frontend Component:**

```jsx
// UpdateBanner.jsx
function UpdateBanner() {
    const { current, latest, updateAvailable } = useVersion();
    const [showChangelog, setShowChangelog] = useState(false);
    
    if (!updateAvailable) return null;
    
    return (
        <div className="update-banner">
            <div className="update-info">
                <span className="icon">🚀</span>
                <span>Update available: v{current} → v{latest}</span>
            </div>
            
            <div className="update-actions">
                <button onClick={() => setShowChangelog(!showChangelog)}>
                    View Changes
                </button>
                <button onClick={triggerUpdate} className="primary">
                    Update Now
                </button>
            </div>
            
            {showChangelog && (
                <ChangelogModal 
                    from={current} 
                    to={latest} 
                    onClose={() => setShowChangelog(false)} 
                />
            )}
        </div>
    );
}
```

### 7.3 Changelog in CLI

```bash
cmd_changelog() {
    local version="${1:-}"
    
    if [[ -n "$version" ]]; then
        # Fetch specific version from GitHub
        local url="https://api.github.com/repos/${GITHUB_REPO}/releases/tags/v${version}"
        local response
        response=$(curl -sf "$url" 2>/dev/null)
        
        if [[ $? -eq 0 ]]; then
            echo "$response" | jq -r '.body'
        else
            echo "Could not fetch changelog for v${version}"
        fi
    else
        # Show local CHANGELOG.md
        if [[ -f "CHANGELOG.md" ]]; then
            # Show most recent entry
            sed -n '/^## \[/,/^## \[/p' CHANGELOG.md | head -n -1
        else
            echo "No local changelog found"
        fi
    fi
}
```

---

## 8. Complete Update Script (Pseudo-code)

```bash
#!/bin/bash
# scripts/dream-update.sh
# Dream Server Update Manager
#
# Commands:
#   check     - Check for available updates
#   status    - Show current version and update status
#   backup    - Create manual backup
#   update    - Perform update with auto-rollback
#   rollback  - Restore from backup
#   changelog - Show version changelog

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
INSTALL_DIR="${SCRIPT_DIR}/.."
cd "$INSTALL_DIR"

# Configuration
GITHUB_REPO="${GITHUB_REPO:-Lightheartdevs/Android-Labs}"
BACKUP_DIR="${BACKUP_DIR:-.backups}"
MAX_BACKUPS="${MAX_BACKUPS:-10}"
UPDATE_CHANNEL="${UPDATE_CHANNEL:-stable}"
HEALTH_TIMEOUT="${HEALTH_TIMEOUT:-120}"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

#==============================================================================
# HELPER FUNCTIONS
#==============================================================================

log_info()  { echo -e "${BLUE}[INFO]${NC} $*"; }
log_ok()    { echo -e "${GREEN}[OK]${NC} $*"; }
log_warn()  { echo -e "${YELLOW}[WARN]${NC} $*"; }
log_error() { echo -e "${RED}[ERROR]${NC} $*" >&2; }

get_current_version() {
    if [[ -f ".version" ]]; then
        jq -r '.version // "0.0.0"' .version
    else
        echo "0.0.0"
    fi
}

# [Include all functions from previous sections]
# - semver_compare()
# - check_github_update()
# - check_custom_update()
# - create_backup()
# - restore_backup()
# - list_backups()
# - run_migrations()
# - run_health_checks()
# - perform_update_with_rollback()

#==============================================================================
# COMMANDS
#==============================================================================

cmd_check() {
    log_info "Checking for updates..."
    
    local current
    current=$(get_current_version)
    
    local latest
    if [[ "${UPDATE_SOURCE:-github}" == "custom" ]]; then
        latest=$(check_custom_update) || return 1
    else
        latest=$(check_github_update) || return 1
    fi
    
    latest="${latest#v}"  # Strip v prefix
    
    semver_compare "$latest" "$current"
    local cmp=$?
    
    echo ""
    echo "  Current version: v${current}"
    echo "  Latest version:  v${latest}"
    echo ""
    
    if [[ $cmp -eq 1 ]]; then
        log_ok "Update available: v${current} → v${latest}"
        echo ""
        echo "Run 'dream-update.sh update' to upgrade"
        return 2  # Special exit code for "update available"
    else
        log_ok "Already up to date"
        return 0
    fi
}

cmd_status() {
    echo ""
    echo "========================================"
    echo "  Dream Server Update Status"
    echo "========================================"
    echo ""
    
    local current
    current=$(get_current_version)
    echo "  Current version:  v${current}"
    
    if [[ -f ".version" ]]; then
        local installed_at updated_at
        installed_at=$(jq -r '.installed_at // "unknown"' .version)
        updated_at=$(jq -r '.updated_at // "unknown"' .version)
        echo "  Installed:        ${installed_at}"
        echo "  Last updated:     ${updated_at}"
    fi
    
    echo "  Update channel:   ${UPDATE_CHANNEL}"
    echo "  Install path:     ${INSTALL_DIR}"
    echo "  Backup path:      ${BACKUP_DIR}"
    echo ""
    
    # Check for updates
    local latest
    latest=$(check_github_update 2>/dev/null) || latest="(check failed)"
    latest="${latest#v}"
    
    echo "  Latest available: v${latest}"
    
    semver_compare "$latest" "$current" 2>/dev/null
    if [[ $? -eq 1 ]]; then
        echo ""
        echo -e "  ${GREEN}→ Update available!${NC}"
        echo "    Run: ./dream-update.sh update"
    fi
    
    echo ""
    echo "  Recent backups:"
    
    if [[ -d "$BACKUP_DIR" ]]; then
        local count=0
        for backup in $(ls -1t "$BACKUP_DIR" 2>/dev/null | head -5); do
            [[ "$backup" == "latest" ]] && continue
            echo "    • $backup"
            (( count++ ))
        done
        [[ $count -eq 0 ]] && echo "    (none)"
    else
        echo "    (none)"
    fi
    
    echo ""
}

cmd_backup() {
    local name="${1:-manual}"
    
    log_info "Creating backup..."
    local backup_path
    backup_path=$(create_backup "$name" "manual")
    
    if [[ -n "$backup_path" ]]; then
        log_ok "Backup created: $(basename "$backup_path")"
    else
        log_error "Backup failed"
        return 1
    fi
}

cmd_update() {
    log_info "Starting update process..."
    echo ""
    
    # Check for updates
    local current
    current=$(get_current_version)
    
    local latest
    latest=$(check_github_update) || {
        log_error "Could not check for updates"
        return 1
    }
    latest="${latest#v}"
    
    # Compare versions
    semver_compare "$latest" "$current"
    local cmp=$?
    
    if [[ $cmp -eq 0 ]]; then
        log_ok "Already at latest version (v${current})"
        return 0
    fi
    
    if [[ $cmp -eq 2 ]]; then
        log_error "Current version (v${current}) is newer than latest (v${latest})"
        log_warn "Are you running a development build?"
        return 1
    fi
    
    # Show what will happen
    echo "========================================"
    echo "  Update: v${current} → v${latest}"
    echo "========================================"
    echo ""
    
    # Determine if major/minor/patch
    local update_type="patch"
    IFS='.' read -ra CURR <<< "$current"
    IFS='.' read -ra NEXT <<< "$latest"
    
    if [[ "${CURR[0]}" != "${NEXT[0]}" ]]; then
        update_type="major"
        log_warn "MAJOR version update - may contain breaking changes!"
    elif [[ "${CURR[1]}" != "${NEXT[1]}" ]]; then
        update_type="minor"
    fi
    
    echo "  Update type: ${update_type}"
    echo ""
    echo "  This will:"
    echo "    1. Create backup of current configuration"
    echo "    2. Pull latest code from GitHub"
    echo "    3. Run configuration migrations"
    echo "    4. Restart services"
    echo "    5. Verify health checks"
    echo ""
    echo "  If anything fails, automatic rollback will restore your system."
    echo ""
    
    # Require confirmation for major/minor
    if [[ "$update_type" != "patch" ]]; then
        read -p "Continue with update? [y/N] " confirm
        if [[ "$confirm" != "y" && "$confirm" != "Y" ]]; then
            echo "Update cancelled."
            return 0
        fi
    fi
    
    # Perform update
    if perform_update_with_rollback "$latest"; then
        return 0
    else
        return 1
    fi
}

cmd_rollback() {
    local backup_id="$1"
    
    if [[ -z "$backup_id" ]]; then
        echo "Available backups:"
        echo ""
        list_backups
        echo ""
        echo "Usage: dream-update.sh rollback <backup-id>"
        return 1
    fi
    
    # Perform rollback
    # [implementation from section 5.4]
}

cmd_changelog() {
    local version="${1:-}"
    # [implementation from section 7.3]
}

cmd_health() {
    run_health_checks
}

#==============================================================================
# MAIN
#==============================================================================

usage() {
    echo "Dream Server Update Manager"
    echo ""
    echo "Usage: dream-update.sh <command> [options]"
    echo ""
    echo "Commands:"
    echo "  check         Check for available updates"
    echo "  status        Show current version and update status"
    echo "  backup [name] Create manual backup"
    echo "  update        Perform update (with auto-rollback)"
    echo "  rollback [id] Restore from backup"
    echo "  changelog [v] Show changelog (optional: specific version)"
    echo "  health        Run health checks"
    echo ""
    echo "Environment:"
    echo "  GITHUB_TOKEN      GitHub API token (higher rate limits)"
    echo "  UPDATE_CHANNEL    stable|beta|nightly (default: stable)"
    echo "  UPDATE_SOURCE     github|custom (default: github)"
    echo "  UPDATE_ENDPOINT   Custom update server URL"
    echo ""
}

main() {
    local command="${1:-help}"
    shift || true
    
    case "$command" in
        check)     cmd_check "$@" ;;
        status)    cmd_status "$@" ;;
        backup)    cmd_backup "$@" ;;
        update)    cmd_update "$@" ;;
        rollback)  cmd_rollback "$@" ;;
        changelog) cmd_changelog "$@" ;;
        health)    cmd_health "$@" ;;
        help|--help|-h) usage ;;
        *)
            log_error "Unknown command: $command"
            usage
            exit 1
            ;;
    esac
}

main "$@"
```

---

## 9. User Journey: v1.0 → v1.1

### The Complete Flow

**Starting State:**
- User has Dream Server v1.0.0 installed
- Custom `.env` with `VLLM_MODEL=Qwen2.5-32B`
- Voice pipeline configured
- n8n workflows saved
- 6 months of usage data in PostgreSQL

**Step 1: User Checks for Updates**

```bash
$ ./scripts/dream-update.sh check

[INFO] Checking for updates...

  Current version: v1.0.0
  Latest version:  v1.1.0

[OK] Update available: v1.0.0 → v1.1.0

Run 'dream-update.sh update' to upgrade
```

**Step 2: User Reviews Status**

```bash
$ ./scripts/dream-update.sh status

========================================
  Dream Server Update Status
========================================

  Current version:  v1.0.0
  Installed:        2025-08-15T10:30:00Z
  Last updated:     2025-08-15T10:30:00Z
  Update channel:   stable
  Install path:     /home/user/dream-server
  Backup path:      .backups

  Latest available: v1.1.0

  → Update available!
    Run: ./dream-update.sh update

  Recent backups:
    (none)
```

**Step 3: User Initiates Update**

```bash
$ ./scripts/dream-update.sh update

[INFO] Starting update process...

========================================
  Update: v1.0.0 → v1.1.0
========================================

  Update type: minor

  This will:
    1. Create backup of current configuration
    2. Pull latest code from GitHub
    3. Run configuration migrations
    4. Restart services
    5. Verify health checks

  If anything fails, automatic rollback will restore your system.

Continue with update? [y/N] y

Phase 1/4: Creating backup...
Creating backup: pre-update-v1.1.0-20260213-103000
[OK] Backup complete

Phase 2/4: Pulling update...
remote: Enumerating objects: 42, done.
remote: Counting objects: 100% (42/42), done.
Updating abc1234..def5678
Fast-forward
 docker-compose.yml | 15 +++++++++++++++
 .env.example       | 8 ++++++++
 migrations/v1.0.0-to-v1.1.0.sh | 45 +++
 ...

Phase 3/4: Running migrations...
Running migrations: v1.0.0 → v1.1.0
Found 1 migration(s) to run:
  - v1.0.0-to-v1.1.0.sh

Executing: v1.0.0-to-v1.1.0.sh
[MIGRATE] v1.0.0 → v1.1.0 starting...
[MIGRATE]   Added DREAM_CACHE_TTL=3600
[MIGRATE]   Added monitoring configuration
[MIGRATE]   Preserving user's VLLM_MODEL=Qwen2.5-32B
[MIGRATE] v1.0.0 → v1.1.0 complete ✓

Phase 4/4: Restarting services...
[+] Pulling images...
[+] Starting containers...

Waiting for services to start...
Running health checks...
  OK: Container running: dream-vllm
  OK: Container running: dream-dashboard
  OK: Dashboard health check passed
  OK: vLLM responding

All health checks PASSED

════════════════════════════════════════
  Update complete: v1.0.0 → v1.1.0
════════════════════════════════════════
```

**What Was Preserved:**

| Data/Config | Action | Result |
|-------------|--------|--------|
| `.env` custom values | Merged | `VLLM_MODEL=Qwen2.5-32B` kept |
| New env vars | Added with defaults | `DREAM_CACHE_TTL=3600` added |
| Docker volumes | Untouched | All data intact |
| PostgreSQL data | Untouched | 6 months of history safe |
| n8n workflows | Untouched | All automations work |
| Voice config | Untouched | Voice pipeline unchanged |
| Custom certs | Untouched | SSL still works |

**If Something Went Wrong:**

```bash
Phase 4/4: Restarting services...
...
Running health checks...
  OK: Container running: dream-vllm
  FAIL: Container not running: dream-dashboard

Health check FAILED (1 check(s))

[ERROR] Health checks failed, initiating rollback...
Restoring from backup: pre-update-v1.1.0-20260213-103000
...
Verifying rollback...
  OK: Container running: dream-vllm
  OK: Container running: dream-dashboard
  OK: Dashboard health check passed

Rollback successful. System restored to v1.0.0
```

---

## Summary

The Dream Server update system provides:

1. **Zero-downtime awareness** — Check for updates without stopping services
2. **Automatic backups** — Every update creates a restore point
3. **Smart migrations** — Config changes are merged, not replaced
4. **Data preservation** — Docker volumes never touched during updates
5. **Automatic rollback** — Failed updates restore automatically
6. **Manual control** — Users can rollback anytime with a single command

The user's journey from v1.0 to v1.1 is a single command that either succeeds completely or restores their working system — they can never be left in a broken state.
