#!/bin/bash
# Round-trip integration test for backup and restore
# Tests complete backup → restore → verify cycle

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKUP_SCRIPT="$SCRIPT_DIR/../dream-backup.sh"
RESTORE_SCRIPT="$SCRIPT_DIR/../dream-restore.sh"
TEST_DIR="$(mktemp -d)"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

# Test counters
PASSED=0
FAILED=0

# Cleanup on exit
cleanup() {
    rm -rf "$TEST_DIR"
}
trap cleanup EXIT

# Test helpers
pass() {
    echo -e "${GREEN}✓${NC} $1"
    ((PASSED++))
}

fail() {
    echo -e "${RED}✗${NC} $1"
    ((FAILED++))
}

info() {
    echo -e "${BLUE}ℹ${NC} $1"
}

# Check prerequisites
check_prerequisites() {
    local missing=()
    command -v rsync &>/dev/null || missing+=("rsync")
    command -v jq &>/dev/null || missing+=("jq")
    command -v sha256sum &>/dev/null || command -v shasum &>/dev/null || missing+=("sha256sum/shasum")

    if [[ ${#missing[@]} -gt 0 ]]; then
        echo -e "${YELLOW}⚠${NC} Missing prerequisites: ${missing[*]}"
        echo "Skipping round-trip tests"
        exit 0
    fi
}

# Setup test environment with realistic data
setup_test_env() {
    local dream_dir="$TEST_DIR/dream-server"
    mkdir -p "$dream_dir"

    # Create realistic directory structure
    mkdir -p "$dream_dir/data/open-webui/uploads"
    mkdir -p "$dream_dir/data/n8n/workflows"
    mkdir -p "$dream_dir/data/qdrant/storage"
    mkdir -p "$dream_dir/config"

    # Create test data files
    echo "User uploaded file" > "$dream_dir/data/open-webui/uploads/test.txt"
    echo '{"workflow": "test"}' > "$dream_dir/data/n8n/workflows/workflow1.json"
    echo "vector data" > "$dream_dir/data/qdrant/storage/vectors.dat"

    # Create config files
    cat > "$dream_dir/.env" <<EOF
DREAM_MODE=local
LLM_MODEL=qwen2.5:3b
TIER=2
GPU_BACKEND=nvidia
LLAMA_SERVER_PORT=8080
EOF

    echo "2.0.0" > "$dream_dir/.version"

    cat > "$dream_dir/docker-compose.base.yml" <<EOF
version: '3.8'
services:
  llama-server:
    image: ghcr.io/ggerganov/llama.cpp:server
    ports:
      - "8080:8080"
EOF

    cat > "$dream_dir/config/custom.conf" <<EOF
# Custom configuration
setting1=value1
setting2=value2
EOF

    echo "$dream_dir"
}

# Test 1: Full backup and restore cycle
test_full_backup_restore() {
    info "Test 1: Full backup and restore cycle"

    local dream_dir
    dream_dir=$(setup_test_env)
    local backup_root="$TEST_DIR/backups"

    export DREAM_DIR="$dream_dir"
    export BACKUP_ROOT="$backup_root"
    export RETENTION_COUNT=10

    # Create backup
    if ! "$BACKUP_SCRIPT" -t full >/dev/null 2>&1; then
        fail "Backup creation failed"
        return
    fi

    local backup_id
    backup_id=$(ls -t "$backup_root" 2>/dev/null | head -1)

    if [[ -z "$backup_id" ]]; then
        fail "No backup created"
        return
    fi

    # Verify backup integrity
    if ! "$BACKUP_SCRIPT" -v "$backup_id" >/dev/null 2>&1; then
        fail "Backup integrity check failed"
        return
    fi

    # Modify original data
    echo "modified" > "$dream_dir/data/open-webui/uploads/test.txt"
    rm -f "$dream_dir/.env"

    # Restore backup
    if ! echo "y" | "$RESTORE_SCRIPT" "$backup_id" >/dev/null 2>&1; then
        fail "Restore failed"
        return
    fi

    # Verify restored data
    if [[ ! -f "$dream_dir/.env" ]]; then
        fail "Config file not restored"
        return
    fi

    local content
    content=$(cat "$dream_dir/data/open-webui/uploads/test.txt")
    if [[ "$content" == "User uploaded file" ]]; then
        pass "Full backup and restore cycle successful"
    else
        fail "Restored data does not match original"
    fi
}

# Test 2: Config-only backup and restore
test_config_only_backup_restore() {
    info "Test 2: Config-only backup and restore"

    local dream_dir
    dream_dir=$(setup_test_env)
    local backup_root="$TEST_DIR/backups-config"

    export DREAM_DIR="$dream_dir"
    export BACKUP_ROOT="$backup_root"
    export RETENTION_COUNT=10

    # Create config backup
    if ! "$BACKUP_SCRIPT" -t config >/dev/null 2>&1; then
        fail "Config backup creation failed"
        return
    fi

    local backup_id
    backup_id=$(ls -t "$backup_root" 2>/dev/null | head -1)

    # Verify backup contains config but not data
    if [[ ! -f "$backup_root/$backup_id/.env" ]]; then
        fail "Config not backed up"
        return
    fi

    if [[ -d "$backup_root/$backup_id/data/open-webui" ]]; then
        fail "User data incorrectly included in config backup"
        return
    fi

    # Modify and restore
    rm -f "$dream_dir/.env"
    if ! echo "y" | "$RESTORE_SCRIPT" --config-only "$backup_id" >/dev/null 2>&1; then
        fail "Config restore failed"
        return
    fi

    if [[ -f "$dream_dir/.env" ]]; then
        pass "Config-only backup and restore successful"
    else
        fail "Config not restored"
    fi
}

# Test 3: User-data-only backup and restore
test_user_data_only_backup_restore() {
    info "Test 3: User-data-only backup and restore"

    local dream_dir
    dream_dir=$(setup_test_env)
    local backup_root="$TEST_DIR/backups-data"

    export DREAM_DIR="$dream_dir"
    export BACKUP_ROOT="$backup_root"
    export RETENTION_COUNT=10

    # Create user-data backup
    if ! "$BACKUP_SCRIPT" -t user-data >/dev/null 2>&1; then
        fail "User-data backup creation failed"
        return
    fi

    local backup_id
    backup_id=$(ls -t "$backup_root" 2>/dev/null | head -1)

    # Verify backup contains data but minimal config
    if [[ ! -d "$backup_root/$backup_id/data/open-webui" ]]; then
        fail "User data not backed up"
        return
    fi

    # Modify and restore
    rm -rf "$dream_dir/data/open-webui"
    if ! echo "y" | "$RESTORE_SCRIPT" --data-only "$backup_id" >/dev/null 2>&1; then
        fail "Data restore failed"
        return
    fi

    if [[ -f "$dream_dir/data/open-webui/uploads/test.txt" ]]; then
        pass "User-data-only backup and restore successful"
    else
        fail "User data not restored"
    fi
}

# Test 4: Compressed backup and restore
test_compressed_backup_restore() {
    info "Test 4: Compressed backup and restore"

    local dream_dir
    dream_dir=$(setup_test_env)
    local backup_root="$TEST_DIR/backups-compressed"

    export DREAM_DIR="$dream_dir"
    export BACKUP_ROOT="$backup_root"
    export RETENTION_COUNT=10

    # Create compressed backup
    if ! "$BACKUP_SCRIPT" -t config -c >/dev/null 2>&1; then
        fail "Compressed backup creation failed"
        return
    fi

    local backup_archive
    backup_archive=$(ls -t "$backup_root"/*.tar.gz 2>/dev/null | head -1)

    if [[ -z "$backup_archive" ]]; then
        fail "No compressed backup created"
        return
    fi

    # Extract and verify
    local backup_id
    backup_id=$(basename "$backup_archive" .tar.gz)

    # Restore from compressed backup
    rm -f "$dream_dir/.env"
    if ! echo "y" | "$RESTORE_SCRIPT" "$backup_id" >/dev/null 2>&1; then
        fail "Restore from compressed backup failed"
        return
    fi

    if [[ -f "$dream_dir/.env" ]]; then
        pass "Compressed backup and restore successful"
    else
        fail "Config not restored from compressed backup"
    fi
}

# Test 5: Dry-run restore
test_dry_run_restore() {
    info "Test 5: Dry-run restore preview"

    local dream_dir
    dream_dir=$(setup_test_env)
    local backup_root="$TEST_DIR/backups-dryrun"

    export DREAM_DIR="$dream_dir"
    export BACKUP_ROOT="$backup_root"
    export RETENTION_COUNT=10

    # Create backup
    if ! "$BACKUP_SCRIPT" -t full >/dev/null 2>&1; then
        fail "Backup creation failed"
        return
    fi

    local backup_id
    backup_id=$(ls -t "$backup_root" 2>/dev/null | head -1)

    # Modify data
    local original_content
    original_content=$(cat "$dream_dir/data/open-webui/uploads/test.txt")
    echo "modified" > "$dream_dir/data/open-webui/uploads/test.txt"

    # Dry-run restore (should not modify files)
    if ! "$RESTORE_SCRIPT" -d "$backup_id" >/dev/null 2>&1; then
        fail "Dry-run restore failed"
        return
    fi

    # Verify data was NOT restored
    local current_content
    current_content=$(cat "$dream_dir/data/open-webui/uploads/test.txt")
    if [[ "$current_content" == "modified" ]]; then
        pass "Dry-run restore does not modify files"
    else
        fail "Dry-run restore incorrectly modified files"
    fi
}

# Test 6: Backup integrity after corruption
test_integrity_after_corruption() {
    info "Test 6: Integrity validation detects corruption"

    local dream_dir
    dream_dir=$(setup_test_env)
    local backup_root="$TEST_DIR/backups-integrity"

    export DREAM_DIR="$dream_dir"
    export BACKUP_ROOT="$backup_root"
    export RETENTION_COUNT=10

    # Create backup
    if ! "$BACKUP_SCRIPT" -t config >/dev/null 2>&1; then
        fail "Backup creation failed"
        return
    fi

    local backup_id
    backup_id=$(ls -t "$backup_root" 2>/dev/null | head -1)

    # Corrupt a file
    echo "CORRUPTED" >> "$backup_root/$backup_id/.env"

    # Verify should fail
    if "$BACKUP_SCRIPT" -v "$backup_id" >/dev/null 2>&1; then
        fail "Integrity check did not detect corruption"
        return
    fi

    # Restore should fail or warn
    if echo "y" | "$RESTORE_SCRIPT" "$backup_id" >/dev/null 2>&1; then
        fail "Restore succeeded despite corruption"
        return
    fi

    pass "Integrity validation detects corruption and prevents restore"
}

# Run all tests
echo ""
echo -e "${BLUE}━━━ Round-Trip Backup/Restore Integration Tests ━━━${NC}"
echo ""

check_prerequisites

test_full_backup_restore
test_config_only_backup_restore
test_user_data_only_backup_restore
test_compressed_backup_restore
test_dry_run_restore
test_integrity_after_corruption

# Summary
echo ""
echo -e "${BLUE}━━━ Test Summary ━━━${NC}"
echo ""
echo -e "  ${GREEN}Passed:${NC} $PASSED"
if [[ $FAILED -gt 0 ]]; then
    echo -e "  ${RED}Failed:${NC} $FAILED"
fi
echo ""

if [[ $FAILED -eq 0 ]]; then
    echo -e "${GREEN}✓ All round-trip tests passed${NC}"
    exit 0
else
    echo -e "${RED}✗ Some tests failed${NC}"
    exit 1
fi
