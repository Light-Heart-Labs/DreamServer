#!/usr/bin/env bats
# ============================================================================
# BATS tests for installers/lib/path-utils.sh
# ============================================================================
# Tests: normalize_path(), resolve_install_dir(), validate_install_path(),
#        get_default_install_dir()

load '../bats/bats-support/load'
load '../bats/bats-assert/load'

setup() {
    # Source the library under test
    source "$BATS_TEST_DIRNAME/../../installers/lib/path-utils.sh"
    # Ensure resolve_install_dir sees a clean env; each test sets its own.
    unset INSTALL_DIR DREAM_HOME DS_INSTALL_DIR DREAM_SCRIPT_HINT
}

teardown() {
    unset INSTALL_DIR DREAM_HOME DS_INSTALL_DIR DREAM_SCRIPT_HINT
}

# ── normalize_path ──────────────────────────────────────────────────────────

@test "normalize_path: empty input returns error" {
    run normalize_path ""
    assert_failure 1
    assert_output ""
}

@test "normalize_path: absolute path passes through" {
    run normalize_path "/usr/local/bin"
    assert_success
    assert_output "/usr/local/bin"
}

@test "normalize_path: relative path becomes absolute" {
    run normalize_path "some/relative/path"
    assert_success
    # Should start with /
    [[ "$output" == /* ]]
    # Should end with the relative path
    [[ "$output" == *"some/relative/path" ]]
}

@test "normalize_path: tilde expands to HOME" {
    run normalize_path "~/my-project"
    assert_success
    assert_output "$HOME/my-project"
}

@test "normalize_path: removes trailing components via realpath" {
    # Test with a path that has .. in it
    run normalize_path "/tmp/foo/../bar"
    assert_success
    assert_output "/tmp/bar"
}

# ── resolve_install_dir ─────────────────────────────────────────────────────

@test "resolve_install_dir: INSTALL_DIR takes highest precedence" {
    export INSTALL_DIR="/opt/custom-dream"
    export DREAM_HOME="/opt/legacy-dream"
    export DS_INSTALL_DIR="/opt/ds-dream"
    run resolve_install_dir
    assert_success
    assert_output "/opt/custom-dream"
    unset INSTALL_DIR DREAM_HOME DS_INSTALL_DIR
}

@test "resolve_install_dir: DREAM_HOME used when INSTALL_DIR unset" {
    unset INSTALL_DIR
    export DREAM_HOME="/opt/legacy-dream"
    export DS_INSTALL_DIR="/opt/ds-dream"
    run resolve_install_dir
    assert_success
    assert_output "/opt/legacy-dream"
    unset DREAM_HOME DS_INSTALL_DIR
}

@test "resolve_install_dir: DS_INSTALL_DIR used when others unset" {
    unset INSTALL_DIR
    unset DREAM_HOME
    export DS_INSTALL_DIR="/opt/ds-dream"
    run resolve_install_dir
    assert_success
    assert_output "/opt/ds-dream"
    unset DS_INSTALL_DIR
}

@test "resolve_install_dir: defaults to HOME/dream-server" {
    unset INSTALL_DIR
    unset DREAM_HOME
    unset DS_INSTALL_DIR
    run resolve_install_dir
    assert_success
    assert_output "$HOME/dream-server"
}

@test "resolve_install_dir: DREAM_SCRIPT_HINT used when sentinel .env present" {
    export DREAM_SCRIPT_HINT="$BATS_TEST_TMPDIR/dream-install-hint"
    mkdir -p "$DREAM_SCRIPT_HINT"
    touch "$DREAM_SCRIPT_HINT/.env"
    run resolve_install_dir
    assert_success
    assert_output "$DREAM_SCRIPT_HINT"
}

@test "resolve_install_dir: DREAM_SCRIPT_HINT falls through when sentinel .env absent" {
    export DREAM_SCRIPT_HINT="$BATS_TEST_TMPDIR/dream-install-no-sentinel"
    mkdir -p "$DREAM_SCRIPT_HINT"
    # No .env file created — hint must be rejected and fall through to default.
    run resolve_install_dir
    assert_success
    assert_output "$HOME/dream-server"
}

# ── validate_install_path ───────────────────────────────────────────────────

@test "validate_install_path: empty path returns error" {
    run validate_install_path ""
    assert_failure 1
    assert_output --partial "ERROR: Installation path is empty"
}

@test "validate_install_path: nonexistent parent returns error" {
    run validate_install_path "/nonexistent/parent/dir/dream-server"
    assert_failure 1
    assert_output --partial "ERROR: Parent directory does not exist"
}

@test "validate_install_path: valid writable path returns 0 or 2 (disk warning)" {
    run validate_install_path "$BATS_TEST_TMPDIR/dream-server"
    # Returns 0 (ok) or 2 (low disk warning) — both are valid (not error)
    [[ "$status" -eq 0 || "$status" -eq 2 ]]
}

@test "validate_install_path: non-writable parent returns error" {
    local readonly_dir="$BATS_TEST_TMPDIR/readonly-parent"
    mkdir -p "$readonly_dir"
    chmod 555 "$readonly_dir"

    run validate_install_path "$readonly_dir/dream-server"
    assert_failure 1
    assert_output --partial "ERROR: Parent directory is not writable"

    # Restore permissions for cleanup
    chmod 755 "$readonly_dir"
}

# ── get_default_install_dir ─────────────────────────────────────────────────

@test "get_default_install_dir: returns HOME/dream-server" {
    run get_default_install_dir
    assert_success
    assert_output "$HOME/dream-server"
}
