#!/usr/bin/env bash
# Regression checks for Fedora/RHEL SELinux bind-mount handling.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

PASS=0
FAIL=0
pass() { echo "[PASS] $1"; PASS=$((PASS + 1)); }
fail() { echo "[FAIL] $1"; FAIL=$((FAIL + 1)); }

check_contains() {
    local file="$1"
    local pattern="$2"
    local label="$3"
    if grep -Fq "$pattern" "$file"; then
        pass "$label"
    else
        fail "$label"
    fi
}

echo "[contract] SELinux bind relabel configuration"
check_contains ".env.schema.json" '"DREAM_BIND_SELINUX"' ".env.schema.json documents DREAM_BIND_SELINUX"
check_contains ".env.example" 'DREAM_BIND_SELINUX=' ".env.example documents DREAM_BIND_SELINUX"
check_contains "installers/phases/06-directories.sh" 'getenforce' "Linux installer detects SELinux state"
check_contains "installers/phases/06-directories.sh" 'DREAM_BIND_SELINUX=${DREAM_BIND_SELINUX}' "Linux installer writes DREAM_BIND_SELINUX"

echo "[contract] first-party relative bind mounts are relabel-aware"
missing_before=$FAIL
mapfile -t compose_files < <(
    {
        find . -maxdepth 1 -name 'docker-compose*.yml' -print
        find extensions/services -maxdepth 2 -name 'compose*.yaml' -print
    } | sort
)

for file in "${compose_files[@]}"; do
    while IFS=: read -r line_no line; do
        [[ -n "$line_no" ]] || continue
        if [[ "$line" != *'DREAM_BIND_SELINUX'* ]]; then
            fail "$file:$line_no relative bind mount missing DREAM_BIND_SELINUX"
        fi
    done < <(grep -nE '^[[:space:]]+-[[:space:]]+\./' "$file" || true)
done
if [[ $FAIL -eq $missing_before ]]; then
    pass "relative bind mounts include DREAM_BIND_SELINUX"
fi

echo "[contract] SELinux relabel is not applied to raw device mounts"
if grep -R --include='compose*.yaml' -nE '(/dev/(dri|kfd|net/tun)|/sys/class/(drm|hwmon)):.*DREAM_BIND_SELINUX' extensions/services docker-compose*.yml >/dev/null 2>&1; then
    fail "raw /dev and /sys mounts must not receive SELinux relabel suffix"
else
    pass "raw /dev and /sys mounts are left untouched"
fi

echo "[contract] Docker Compose renders SELinux relabel option"
if command -v docker >/dev/null 2>&1 && docker compose version >/dev/null 2>&1; then
    if rendered=$(
        WEBUI_SECRET=ci-placeholder DREAM_BIND_SELINUX=,z \
            docker compose -f docker-compose.base.yml -f docker-compose.amd.yml \
            config llama-server dashboard-api dashboard 2>/dev/null
    ) && grep -q 'selinux: z' <<<"$rendered"; then
        pass "Docker Compose renders :z as selinux: z"
    else
        fail "Docker Compose did not render DREAM_BIND_SELINUX=,z as selinux: z"
    fi
else
    echo "[SKIP] docker compose unavailable"
fi

echo ""
echo "SELinux bind mount contracts: $PASS passed, $FAIL failed"
[[ $FAIL -eq 0 ]]
