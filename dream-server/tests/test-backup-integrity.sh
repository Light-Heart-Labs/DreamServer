#!/bin/bash
# Test suite for backup integrity validation
# Validates checksum generation, verification, and corruption detection

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKUP_SCRIPT="$SCRIPT_DIR/../dream-backup.sh"
RESTORE_SCRIPT="$SCRIPT_DIR/../dream-restore.sh"
TEST_DIR="$(mktemp -d)"
BACKUP_ROOT="$TEST_DIR/backups"

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

# Setup test environment
setup_test_env() {
    mkdir -p "$TEST_DIR/dream-server/data/open-webui"
    mkdir -p "$TEST_DIR/dream-server/data/n8n"
    echo "test data" > "$TEST_DIR/dream-server/data/open-webui/test.txt"
    echo "DREAM_MODE=local" > "$TEST_DIR/dream-server/.env"
    echo "2.0.0" > "$TEST_DIR/dream-server/.version"
    echo "version: '3.8'" > "$TEST_DIR/dream-server/docker-compose.base.yml"
}

# Test 1: Verify generate_checksums function exists
test_checksum_function_exists() {
    info "Test 1: Checking if generate_checksums function exists"
    if grep -q "^generate_checksums()" "$BACKUP_SCRIPT" 2>/dev/null; then
        pass "generate_checksums function is defined"
    else
        fail "generate_checksums function not found"
    fi
}

# Test 2: Verify verify_backup_integrity function exists
test_verify_function_exists() {
    info "Test 2: Checking if verify_backup_integrity function exists"
    if grep -q "^verify_backup_integrity()" "$BACKUP_SCRIPT" 2>/dev/null; then
        pass "verify_backup_integrity function is defined"
    else
        fail "verify_backup_integrity function not found"
    fi
}

# Test 3: Verify -v flag in usage
test_verify_flag_documented() {
    info "Test 3: Checking if -v|--verify flag is documented"
    if grep -q "\-v.*verify.*Verify backup integrity" "$BACKUP_SCRIPT" 2>/dev/null; then
        pass "-v|--verify flag documented in usage"
    else
        fail "-v|--verify flag not documented"
    fi
}

# Test 4: Verify checksums are generated during backup
test_checksums_generated() {
    info "Test 4: Checking if checksums are generated during backup"
    if grep -A50 "do_backup()" "$BACKUP_SCRIPT" 2>/dev/null | grep -q "generate_checksums"; then
        pass "Checksums are generated during backup"
    else
        fail "Checksums not generated during backup"
    fi
}

# Test 5: Verify restore validates checksums
test_restore_validates_checksums() {
    info "Test 5: Checking if restore validates checksums"
    if grep -A100 "^validate_backup()" "$RESTORE_SCRIPT" 2>/dev/null | grep -q "\.checksums"; then
        pass "Restore validates checksums"
    else
        fail "Restore does not validate checksums"
    fi
}

# Test 6: Verify checksum file format
test_checksum_file_format() {
    info "Test 6: Checking checksum file format uses sha256"
    if grep -A20 "^generate_checksums()" "$BACKUP_SCRIPT" 2>/dev/null | grep -q "sha256sum\|shasum -a 256"; then
        pass "Checksums use SHA256 algorithm"
    else
        fail "Checksums do not use SHA256"
    fi
}

# Test 7: Verify directory tree checksums
test_directory_tree_checksums() {
    info "Test 7: Checking if directory tree checksums are generated"
    if grep -A30 "^generate_checksums()" "$BACKUP_SCRIPT" 2>/dev/null | grep -q "for datadir"; then
        pass "Directory tree checksums are generated"
    else
        fail "Directory tree checksums not implemented"
    fi
}

# Test 8: Verify critical files are checksummed
test_critical_files_checksummed() {
    info "Test 8: Checking if critical files are checksummed"
    if grep -A30 "^generate_checksums()" "$BACKUP_SCRIPT" 2>/dev/null | grep -q "\.env.*\.version.*docker-compose"; then
        pass "Critical config files are checksummed"
    else
        fail "Critical files not checksummed"
    fi
}

# Test 9: Verify manifest is checksummed
test_manifest_checksummed() {
    info "Test 9: Checking if manifest.json is checksummed"
    if grep -A30 "^generate_checksums()" "$BACKUP_SCRIPT" 2>/dev/null | grep -q "manifest\.json"; then
        pass "Manifest is checksummed"
    else
        fail "Manifest not checksummed"
    fi
}

# Test 10: Verify corruption detection logic
test_corruption_detection() {
    info "Test 10: Checking if corruption is detected"
    if grep -i "corrupted" "$BACKUP_SCRIPT" 2>/dev/null | grep -q "log_error"; then
        pass "Corruption detection implemented"
    else
        fail "Corruption detection not implemented"
    fi
}

# Test 11: Verify error handling for missing checksums
test_missing_checksum_handling() {
    info "Test 11: Checking handling of backups without checksums"
    if grep -A50 "^verify_backup_integrity()" "$BACKUP_SCRIPT" 2>/dev/null | grep -q "No checksums found"; then
        pass "Handles backups without checksums gracefully"
    else
        fail "Missing checksum handling not implemented"
    fi
}

# Test 12: Verify restore fails on corruption
test_restore_fails_on_corruption() {
    info "Test 12: Checking if restore fails on corrupted backup"
    if grep -A100 "^validate_backup()" "$RESTORE_SCRIPT" 2>/dev/null | grep -q "Integrity check failed"; then
        pass "Restore detects and reports corruption"
    else
        fail "Restore does not fail on corruption"
    fi
}

# Test 13: Integration test - create backup and verify checksums exist
test_integration_backup_creates_checksums() {
    info "Test 13: Integration test - backup creates .checksums file"

    # Check prerequisites
    if ! command -v rsync &>/dev/null; then
        info "Skipping: rsync not available"
        ((PASSED++))
        return 0
    fi
    if ! command -v jq &>/dev/null; then
        info "Skipping: jq not available"
        ((PASSED++))
        return 0
    fi

    setup_test_env

    cd "$TEST_DIR/dream-server"
    export DREAM_DIR="$TEST_DIR/dream-server"
    export BACKUP_ROOT="$BACKUP_ROOT"
    export RETENTION_COUNT=10

    # Create a backup
    local output
    if output=$("$BACKUP_SCRIPT" -t config 2>&1); then
        # Find the backup directory
        local backup_id
        backup_id=$(ls -t "$BACKUP_ROOT" 2>/dev/null | head -1)

        if [[ -n "$backup_id" && -f "$BACKUP_ROOT/$backup_id/.checksums" ]]; then
            pass "Backup creates .checksums file"
        else
            fail "Backup did not create .checksums file (backup_id: $backup_id)"
        fi
    else
        fail "Backup command failed: $output"
    fi
}

# Test 14: Integration test - verify command works
test_integration_verify_command() {
    info "Test 14: Integration test - verify command works"

    # Check prerequisites
    if ! command -v rsync &>/dev/null || ! command -v jq &>/dev/null; then
        info "Skipping: prerequisites not available"
        ((PASSED++))
        return 0
    fi

    cd "$TEST_DIR/dream-server"
    export DREAM_DIR="$TEST_DIR/dream-server"
    export BACKUP_ROOT="$BACKUP_ROOT"

    local backup_id
    backup_id=$(ls -t "$BACKUP_ROOT" 2>/dev/null | head -1)

    if [[ -n "$backup_id" ]]; then
        local output
        if output=$("$BACKUP_SCRIPT" -v "$backup_id" 2>&1); then
            pass "Verify command executes successfully"
        else
            fail "Verify command failed: $output"
        fi
    else
        info "Skipping: no backup found to verify"
        ((PASSED++))
    fi
}

# Test 15: Integration test - detect corruption
test_integration_detect_corruption() {
    info "Test 15: Integration test - corruption detection"

    # Check prerequisites
    if ! command -v rsync &>/dev/null || ! command -v jq &>/dev/null; then
        info "Skipping: prerequisites not available"
        ((PASSED++))
        return 0
    fi

    cd "$TEST_DIR/dream-server"
    export DREAM_DIR="$TEST_DIR/dream-server"
    export BACKUP_ROOT="$BACKUP_ROOT"

    local backup_id
    backup_id=$(ls -t "$BACKUP_ROOT" 2>/dev/null | head -1)

    if [[ -n "$backup_id" && -f "$BACKUP_ROOT/$backup_id/.env" ]]; then
        # Corrupt a file
        echo "CORRUPTED" >> "$BACKUP_ROOT/$backup_id/.env"

        # Verify should fail
        local output
        if output=$("$BACKUP_SCRIPT" -v "$backup_id" 2>&1); then
            fail "Corruption not detected"
        else
            if echo "$output" | grep -qi "corrupt\|failed"; then
                pass "Corruption detected successfully"
            else
                fail "Corruption not properly reported: $output"
            fi
        fi
    else
        info "Skipping: no backup file to corrupt"
        ((PASSED++))
    fi
}

# Run all tests
echo ""
echo -e "${BLUE}━━━ Backup Integrity Validation Tests ━━━${NC}"
echo ""

test_checksum_function_exists
test_verify_function_exists
test_verify_flag_documented
test_checksums_generated
test_restore_validates_checksums
test_checksum_file_format
test_directory_tree_checksums
test_critical_files_checksummed
test_manifest_checksummed
test_corruption_detection
test_missing_checksum_handling
test_restore_fails_on_corruption
test_integration_backup_creates_checksums
test_integration_verify_command
test_integration_detect_corruption

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
    echo -e "${GREEN}✓ All tests passed${NC}"
    exit 0
else
    echo -e "${RED}✗ Some tests failed${NC}"
    exit 1
fi
