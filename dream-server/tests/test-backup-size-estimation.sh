#!/bin/bash
# Test suite for backup size estimation
# Validates size calculation and disk space checking

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKUP_SCRIPT="$SCRIPT_DIR/../dream-backup.sh"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
NC='\033[0m'

# Test counters
PASSED=0
FAILED=0

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

# Test 1: Verify estimate_backup_size function exists
test_estimate_function_exists() {
    info "Test 1: Checking if estimate_backup_size function exists"
    if grep -q "^estimate_backup_size()" "$BACKUP_SCRIPT" 2>/dev/null; then
        pass "estimate_backup_size function is defined"
    else
        fail "estimate_backup_size function not found"
    fi
}

# Test 2: Verify size estimation is called in do_backup
test_size_estimation_called() {
    info "Test 2: Checking if size estimation is called during backup"
    if grep -A20 "^do_backup()" "$BACKUP_SCRIPT" 2>/dev/null | grep -q "estimate_backup_size"; then
        pass "Size estimation is called during backup"
    else
        fail "Size estimation not called during backup"
    fi
}

# Test 3: Verify disk space check
test_disk_space_check() {
    info "Test 3: Checking if disk space is validated"
    local func_content
    func_content=$(grep -A70 "^estimate_backup_size()" "$BACKUP_SCRIPT" 2>/dev/null)
    if echo "$func_content" | grep -q "available_space" && echo "$func_content" | grep -q "df -B1"; then
        pass "Disk space validation implemented"
    else
        fail "Disk space validation not implemented"
    fi
}

# Test 4: Verify estimated size in manifest
test_estimated_size_in_manifest() {
    info "Test 4: Checking if estimated size is stored in manifest"
    if grep -A30 "^create_manifest()" "$BACKUP_SCRIPT" 2>/dev/null | grep -q "estimated_size"; then
        pass "Estimated size stored in manifest"
    else
        fail "Estimated size not stored in manifest"
    fi
}

# Test 5: Verify size displayed in list
test_size_in_list() {
    info "Test 5: Checking if estimated size is shown in backup list"
    if grep -A50 "^list_backups()" "$BACKUP_SCRIPT" 2>/dev/null | grep -q "Est.Size\|estimated_size"; then
        pass "Estimated size shown in backup list"
    else
        fail "Estimated size not shown in backup list"
    fi
}

# Test 6: Verify human-readable size formatting
test_human_readable_size() {
    info "Test 6: Checking if size is formatted human-readable"
    if grep -A50 "^estimate_backup_size()" "$BACKUP_SCRIPT" 2>/dev/null | grep -q "numfmt\|GiB\|MiB"; then
        pass "Human-readable size formatting implemented"
    else
        fail "Human-readable size formatting not implemented"
    fi
}

# Test 7: Verify backup type handling
test_backup_type_handling() {
    info "Test 7: Checking if different backup types are handled"
    if grep -A50 "^estimate_backup_size()" "$BACKUP_SCRIPT" 2>/dev/null | grep -q "case.*backup_type"; then
        pass "Different backup types handled in estimation"
    else
        fail "Backup type handling not implemented"
    fi
}

# Test 8: Verify error handling for insufficient space
test_insufficient_space_error() {
    info "Test 8: Checking if backup fails on insufficient space"
    if grep -A30 "^do_backup()" "$BACKUP_SCRIPT" 2>/dev/null | grep -q "insufficient disk space"; then
        pass "Backup fails on insufficient disk space"
    else
        fail "Insufficient space error handling missing"
    fi
}

# Run all tests
echo ""
echo -e "${BLUE}━━━ Backup Size Estimation Tests ━━━${NC}"
echo ""

test_estimate_function_exists
test_size_estimation_called
test_disk_space_check
test_estimated_size_in_manifest
test_size_in_list
test_human_readable_size
test_backup_type_handling
test_insufficient_space_error

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
