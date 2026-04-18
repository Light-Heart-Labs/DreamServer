#!/usr/bin/env bats

load '../bats/bats-support/load'
load '../bats/bats-assert/load'

setup() {
    unset DREAM_PLATFORM_OVERRIDE TERMUX_VERSION PREFIX TERM_PROGRAM ASHELL SHORTCUTS
    source "$BATS_TEST_DIRNAME/../../installers/common.sh"
    source "$BATS_TEST_DIRNAME/../../installers/dispatch.sh"
}

@test "detect_platform: recognizes Termux" {
    export TERMUX_VERSION="0.118.3"
    export PREFIX="/data/data/com.termux/files/usr"

    run detect_platform
    assert_success
    assert_output "android-termux"
}

@test "detect_platform: recognizes a-Shell via TERM_PROGRAM" {
    export OSTYPE="darwin24"
    export TERM_PROGRAM="a-Shell"

    run detect_platform
    assert_success
    assert_output "ios-ashell"
}

@test "detect_platform: supports explicit override" {
    export DREAM_PLATFORM_OVERRIDE="android-termux"

    run detect_platform
    assert_success
    assert_output "android-termux"
}

@test "resolve_installer_target: routes Termux to the mobile installer" {
    export DREAM_PLATFORM_OVERRIDE="android-termux"

    run resolve_installer_target
    assert_success
    assert_output --partial "/installers/mobile/install-mobile.sh"
}

@test "resolve_installer_target: routes a-Shell to the mobile installer" {
    export DREAM_PLATFORM_OVERRIDE="ios-ashell"

    run resolve_installer_target
    assert_success
    assert_output --partial "/installers/mobile/install-mobile.sh"
}

@test "resolve_installer_target: keeps desktop Linux on install-core" {
    export DREAM_PLATFORM_OVERRIDE="linux"

    run resolve_installer_target
    assert_success
    assert_output --partial "/install-core.sh"
}
