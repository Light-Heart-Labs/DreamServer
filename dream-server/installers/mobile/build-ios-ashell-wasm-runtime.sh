#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
CACHE_DIR="$ROOT_DIR/.cache/ios-wasm"
LLAMA_DIR="$CACHE_DIR/llama.cpp"
SDK_INSTALL_DIR="$CACHE_DIR/wasi-sdk-exc-install"
RUNNER_TEMPLATE_DIR="$ROOT_DIR/installers/mobile/ios-wasm-runner"
RUNNER_DIR="$CACHE_DIR/runner"
BUILD_DIR="$CACHE_DIR/build"
LOG_DIR="$CACHE_DIR/logs"
OUT_DIR="$ROOT_DIR/mobile-runtime/ios-ashell/bin"
OUT_BIN="$OUT_DIR/llama-cli.wasm"
SDK_BUILD_HELPER="$ROOT_DIR/installers/mobile/build-ios-ashell-wasm-sdk.sh"

DOCKER_IMAGE="ghcr.io/webassembly/wasi-sdk:wasi-sdk-32"
LLAMA_REF="a29e4c0b7b23e020107058480dabbe03b7cba6e1"
RECLONE=false
DRY_RUN=false
SKIP_SDK_BOOTSTRAP=false

log() {
    printf '[ios-wasm-build] %s\n' "$1"
}

fail() {
    printf '[error] %s\n' "$1" >&2
    exit 1
}

usage() {
    cat <<EOF
Build the experimental Dream Server iOS / a-Shell wasm runtime.

Usage:
  bash installers/mobile/build-ios-ashell-wasm-runtime.sh

Options:
  --llama-ref REF      Pin llama.cpp to a different git ref
  --sdk-install DIR    Use or export the custom wasi-sdk install at DIR
  --skip-sdk-bootstrap Assume the custom sdk already exists and do not build it
  --docker-image IMG   Override the wasi-sdk image
  --reclone            Delete the cached llama.cpp clone and re-fetch it
  --dry-run            Print what would run without executing it
  -h, --help           Show this help

Output:
  $OUT_BIN
  custom sdk: $SDK_INSTALL_DIR
EOF
}

run_cmd() {
    if [ "$DRY_RUN" = "true" ]; then
        printf '[dry-run]'
        for arg in "$@"; do
            printf ' %s' "$arg"
        done
        printf '\n'
        return 0
    fi

    "$@"
}

parse_args() {
    while [ $# -gt 0 ]; do
        case "$1" in
            --llama-ref)
                LLAMA_REF="${2:-}"
                shift 2
                ;;
            --sdk-install)
                SDK_INSTALL_DIR="${2:-}"
                shift 2
                ;;
            --skip-sdk-bootstrap)
                SKIP_SDK_BOOTSTRAP=true
                shift
                ;;
            --docker-image)
                DOCKER_IMAGE="${2:-}"
                shift 2
                ;;
            --reclone)
                RECLONE=true
                shift
                ;;
            --dry-run)
                DRY_RUN=true
                shift
                ;;
            -h|--help)
                usage
                exit 0
                ;;
            *)
                fail "Unknown option: $1"
                ;;
        esac
    done
}

require_cmd() {
    command -v "$1" >/dev/null 2>&1 || fail "Missing required command: $1"
}

prepare_dirs() {
    run_cmd mkdir -p "$CACHE_DIR" "$RUNNER_DIR" "$BUILD_DIR" "$LOG_DIR" "$OUT_DIR" "$SDK_INSTALL_DIR"
}

prepare_llama_source() {
    if [ "$RECLONE" = "true" ]; then
        run_cmd rm -rf "$LLAMA_DIR"
    fi

    if [ ! -d "$LLAMA_DIR/.git" ]; then
        log "Cloning llama.cpp into $LLAMA_DIR"
        run_cmd git clone --quiet https://github.com/ggml-org/llama.cpp.git "$LLAMA_DIR"
    fi

    log "Checking out llama.cpp ref $LLAMA_REF"
    if [ "$DRY_RUN" = "true" ]; then
        printf '[dry-run] git -C %s fetch --depth 1 origin %s\n' "$LLAMA_DIR" "$LLAMA_REF"
        printf '[dry-run] git -C %s checkout --detach %s\n' "$LLAMA_DIR" "$LLAMA_REF"
        return 0
    fi

    git -C "$LLAMA_DIR" fetch --quiet --depth 1 origin "$LLAMA_REF"
    git -C "$LLAMA_DIR" -c advice.detachedHead=false checkout --quiet --detach "$LLAMA_REF"
}

prepare_runner_template() {
    log "Refreshing the local WASI runner template"
    run_cmd mkdir -p "$RUNNER_DIR"
    run_cmd cp "$RUNNER_TEMPLATE_DIR/CMakeLists.txt" "$RUNNER_DIR/CMakeLists.txt"
    run_cmd cp "$RUNNER_TEMPLATE_DIR/main.cpp" "$RUNNER_DIR/main.cpp"
    run_cmd cp "$RUNNER_TEMPLATE_DIR/__cpp_exception.S" "$RUNNER_DIR/__cpp_exception.S"
    run_cmd cp "$RUNNER_TEMPLATE_DIR/dlfcn_stubs.cpp" "$RUNNER_DIR/dlfcn_stubs.cpp"
}

sdk_is_ready() {
    [ -f "$SDK_INSTALL_DIR/share/wasi-sysroot/lib/wasm32-wasip1/libunwind.a" ] &&
    [ -f "$SDK_INSTALL_DIR/clang-resource-dir/lib/wasm32-unknown-wasip1/libclang_rt.builtins.a" ]
}

prepare_sdk_install() {
    if sdk_is_ready; then
        log "Reusing custom wasi-sdk install at $SDK_INSTALL_DIR"
        return 0
    fi

    if [ "$SKIP_SDK_BOOTSTRAP" = "true" ]; then
        fail "Custom wasi-sdk install was requested but $SDK_INSTALL_DIR is missing required files"
    fi

    log "Bootstrapping the custom exceptions-enabled wasi-sdk into $SDK_INSTALL_DIR"
    if [ "$DRY_RUN" = "true" ]; then
        printf '[dry-run] bash %s --output-dir %s --docker-image %s\n' \
            "$SDK_BUILD_HELPER" "$SDK_INSTALL_DIR" "$DOCKER_IMAGE"
        return 0
    fi

    bash "$SDK_BUILD_HELPER" \
        --output-dir "$SDK_INSTALL_DIR" \
        --docker-image "$DOCKER_IMAGE"
}

docker_run_build() {
    local log_file="$LOG_DIR/build.log"

    if [ "$DRY_RUN" = "true" ]; then
        printf '[dry-run] docker run -e DREAM_LLAMA_CPP_SOURCE=/src -v %s:/src -v %s:/sdk -v %s:/runner -v %s:/build %s ...\n' \
            "$LLAMA_DIR" "$SDK_INSTALL_DIR" "$RUNNER_DIR" "$BUILD_DIR" "$DOCKER_IMAGE"
        return 0
    fi

    rm -rf "$BUILD_DIR"
    mkdir -p "$BUILD_DIR"

    docker run --rm \
        -e DREAM_LLAMA_CPP_SOURCE=/src \
        -v "$LLAMA_DIR:/src" \
        -v "$SDK_INSTALL_DIR:/sdk" \
        -v "$RUNNER_DIR:/runner" \
        -v "$BUILD_DIR:/build" \
        "$DOCKER_IMAGE" \
        sh -lc '
            apt-get update >/dev/null &&
            apt-get install -y libncurses6 ninja-build cmake git >/dev/null &&
            git config --global --add safe.directory /src &&
            cmake -S /runner -B /build -G Ninja \
                -DCMAKE_BUILD_TYPE=Release \
                -DCMAKE_TOOLCHAIN_FILE=/opt/wasi-sdk/share/cmake/wasi-sdk-p1.cmake \
                -DCMAKE_SYSROOT=/sdk/share/wasi-sysroot \
                -DCMAKE_FIND_ROOT_PATH=/sdk/share/wasi-sysroot &&
            cmake --build /build --target dream-llama-wasi -j2
        ' >"$log_file" 2>&1 || return 1
}

copy_artifact() {
    if [ "$DRY_RUN" = "true" ]; then
        printf '[dry-run] cp %s %s\n' "$BUILD_DIR/dream-llama-wasi" "$OUT_BIN"
        return 0
    fi

    [ -f "$BUILD_DIR/dream-llama-wasi" ] || fail "Build finished without producing $BUILD_DIR/dream-llama-wasi"
    run_cmd rm -f "$OUT_BIN"
    run_cmd cp "$BUILD_DIR/dream-llama-wasi" "$OUT_BIN"
    log "Copied runtime to $OUT_BIN"
}

print_failure_help() {
    local log_file="$LOG_DIR/build.log"
    echo ""
    echo "Build log:"
    echo "  $log_file"

    if grep -Eq '__cxa_allocate_exception|__wasm_lpad_context|_Unwind_CallPersonality' "$log_file"; then
        echo ""
        echo "Current blocker:"
        echo "  A plain published wasi-sdk image is not enough for the iOS / a-Shell runtime."
        echo "  Dream Server needs the custom exceptions-enabled sysroot built by:"
        echo "    $SDK_BUILD_HELPER"
        echo ""
        echo "Missing symbols seen in this path include:"
        echo "  __cxa_allocate_exception"
        echo "  __cxa_throw"
        echo "  __wasm_lpad_context"
        echo "  _Unwind_CallPersonality"
        echo ""
        echo "See:"
        echo "  $ROOT_DIR/docs/IOS-ASHELL-WASM-RUNTIME.md"
        exit 2
    fi

    exit 1
}

main() {
    parse_args "$@"
    require_cmd docker
    require_cmd git
    prepare_dirs
    prepare_llama_source
    prepare_runner_template
    prepare_sdk_install

    log "Building the experimental wasm runtime with $DOCKER_IMAGE"
    if ! docker_run_build; then
        print_failure_help
    fi

    copy_artifact
    echo ""
    echo "Next step:"
    echo "  Push or copy $OUT_BIN into the repo state that your iPhone will pull."
    echo "  Then re-run 'sh ./install.sh' or 'sh ./dream-mobile.sh status' in a-Shell."
}

main "$@"
