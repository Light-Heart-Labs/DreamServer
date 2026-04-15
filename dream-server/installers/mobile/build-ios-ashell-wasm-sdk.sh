#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
CACHE_DIR="$ROOT_DIR/.cache/ios-wasm"
SDK_INSTALL_DIR="$CACHE_DIR/wasi-sdk-exc-install"

DOCKER_IMAGE="ghcr.io/webassembly/wasi-sdk:wasi-sdk-32"
WASI_SDK_REF="wasi-sdk-32"
SRC_VOL="dreamserver_ios_wasi_sdk_src"
BUILD_VOL="dreamserver_ios_wasi_sdk_build"
OUT_VOL="dreamserver_ios_wasi_sdk_out"
REFRESH_SOURCE=false
DRY_RUN=false

log() {
    printf '[ios-wasi-sdk] %s\n' "$1"
}

fail() {
    printf '[error] %s\n' "$1" >&2
    exit 1
}

usage() {
    cat <<EOF
Build the custom exceptions-enabled wasi-sdk sysroot needed by the iOS / a-Shell runtime.

Usage:
  bash installers/mobile/build-ios-ashell-wasm-sdk.sh

Options:
  --output-dir DIR      Where to export the built sdk (default: $SDK_INSTALL_DIR)
  --docker-image IMG    Override the wasi-sdk Docker image (default: $DOCKER_IMAGE)
  --wasi-sdk-ref REF    Git ref to clone from the official wasi-sdk repo (default: $WASI_SDK_REF)
  --refresh-source      Recreate the Docker source/build/output volumes from scratch
  --dry-run             Print the steps without executing them
  -h, --help            Show this help
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
            --output-dir)
                SDK_INSTALL_DIR="${2:-}"
                shift 2
                ;;
            --docker-image)
                DOCKER_IMAGE="${2:-}"
                shift 2
                ;;
            --wasi-sdk-ref)
                WASI_SDK_REF="${2:-}"
                shift 2
                ;;
            --refresh-source)
                REFRESH_SOURCE=true
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

prepare_output_dir() {
    run_cmd mkdir -p "$SDK_INSTALL_DIR"
}

prepare_volumes() {
    if [ "$REFRESH_SOURCE" = "true" ]; then
        log "Refreshing Docker volumes for the custom wasi-sdk build"
        run_cmd docker volume rm -f "$SRC_VOL" "$BUILD_VOL" "$OUT_VOL"
    fi

    run_cmd docker volume create "$SRC_VOL" >/dev/null
    run_cmd docker volume create "$BUILD_VOL" >/dev/null
    run_cmd docker volume create "$OUT_VOL" >/dev/null
}

seed_source_volume() {
    local marker_cmd='[ -d /src/.git ] && [ -f /src/CppExceptions.md ]'

    if [ "$DRY_RUN" = "true" ]; then
        printf '[dry-run] docker run --rm -v %s:/src %s sh -lc <clone wasi-sdk %s and required submodules>\n' \
            "$SRC_VOL" "$DOCKER_IMAGE" "$WASI_SDK_REF"
        return 0
    fi

    if docker run --rm -v "$SRC_VOL:/src" "$DOCKER_IMAGE" sh -lc "$marker_cmd" >/dev/null 2>&1; then
        log "Reusing cached wasi-sdk source volume $SRC_VOL"
        return 0
    fi

    log "Bootstrapping wasi-sdk source volume $SRC_VOL"
    docker run --rm \
        -v "$SRC_VOL:/src" \
        "$DOCKER_IMAGE" \
        sh -lc "
            apt-get update >/dev/null &&
            apt-get install -y git >/dev/null &&
            rm -rf /src/* /src/.[!.]* /src/..?* 2>/dev/null || true &&
            git clone --branch '$WASI_SDK_REF' --depth 1 https://github.com/WebAssembly/wasi-sdk.git /src &&
            git -C /src submodule update --init src/config &&
            git -C /src submodule update --init --depth 1 src/llvm-project src/wasi-libc &&
            git -C /src/src/wasi-libc submodule update --init --depth 1 tools/wasi-headers/WASI
        "
}

build_sdk() {
    if [ "$DRY_RUN" = "true" ]; then
        printf '[dry-run] docker run --rm -v %s:/src -v %s:/build -v %s:/out %s sh -lc <configure and install wasi-sdk with WASI_SDK_EXCEPTIONS=ON>\n' \
            "$SRC_VOL" "$BUILD_VOL" "$OUT_VOL" "$DOCKER_IMAGE"
        return 0
    fi

    log "Building the custom exceptions-enabled wasi-sdk sysroot"
    docker run --rm \
        -v "$SRC_VOL:/src" \
        -v "$BUILD_VOL:/build" \
        -v "$OUT_VOL:/out" \
        "$DOCKER_IMAGE" \
        sh -lc "
            apt-get update >/dev/null &&
            apt-get install -y libncurses6 python3 ninja-build cargo git >/dev/null &&
            git config --global --add safe.directory /src &&
            rm -rf /build/* /out/* &&
            cmake -G Ninja -B /build -S /src \
                -DCMAKE_INSTALL_PREFIX=/out \
                -DCMAKE_TOOLCHAIN_FILE=/opt/wasi-sdk/share/cmake/wasi-sdk-p1.cmake \
                -DCMAKE_C_COMPILER_WORKS=ON \
                -DCMAKE_CXX_COMPILER_WORKS=ON \
                -DWASI_SDK_EXCEPTIONS=ON \
                -DWASI_SDK_TARGETS=wasm32-wasip1 &&
            cmake --build /build --target install -j2
        "
}

export_sdk() {
    if [ "$DRY_RUN" = "true" ]; then
        printf '[dry-run] docker run --rm -v %s:/from -v %s:/to %s sh -lc cp -a /from/. /to/\n' \
            "$OUT_VOL" "$SDK_INSTALL_DIR" "$DOCKER_IMAGE"
        return 0
    fi

    log "Exporting the built sdk into $SDK_INSTALL_DIR"
    run_cmd rm -rf "$SDK_INSTALL_DIR"
    run_cmd mkdir -p "$SDK_INSTALL_DIR"
    docker run --rm \
        -v "$OUT_VOL:/from" \
        -v "$SDK_INSTALL_DIR:/to" \
        "$DOCKER_IMAGE" \
        sh -lc 'cp -a /from/. /to/'
}

print_summary() {
    echo ""
    log "Custom wasi-sdk exported."
    echo "Path: $SDK_INSTALL_DIR"
    echo "Key files:"
    echo "  $SDK_INSTALL_DIR/share/wasi-sysroot/lib/wasm32-wasip1/libunwind.a"
    echo "  $SDK_INSTALL_DIR/clang-resource-dir/lib/wasm32-unknown-wasip1/libclang_rt.builtins.a"
}

main() {
    parse_args "$@"
    require_cmd docker
    prepare_output_dir
    prepare_volumes
    seed_source_volume
    build_sdk
    export_sdk
    print_summary
}

main "$@"
