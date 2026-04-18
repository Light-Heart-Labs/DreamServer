#!/bin/sh

# Root wrapper for Dream Server mobile preview.
# On iOS / a-Shell, jump straight to the dedicated CLI to avoid extra wrapper
# layers and shell-specific quirks.

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
CONFIG_FILE="$SCRIPT_DIR/dream-server/.dream-mobile.env"
IOS_CONTAINER_PATTERN='^(/private)?/var/mobile/Containers/Data/Application/'
IOS_CLI="$SCRIPT_DIR/dream-server/installers/mobile/ios-ashell-cli.sh"
INNER="$SCRIPT_DIR/dream-server/dream-mobile.sh"

if [ -f "$CONFIG_FILE" ] && grep -q 'DREAM_MOBILE_PLATFORM="ios-ashell"' "$CONFIG_FILE" 2>/dev/null; then
    exec sh "$IOS_CLI" "$@"
fi

if [ "${TERM_PROGRAM:-}" = "a-Shell" ] || [ "${TERM_PROGRAM:-}" = "a-Shell mini" ] || [ -n "${ASHELL:-}" ]; then
    exec sh "$IOS_CLI" "$@"
fi

if printf '%s\n' "$SCRIPT_DIR" | grep -Eq "$IOS_CONTAINER_PATTERN"; then
    exec sh "$IOS_CLI" "$@"
fi

if printf '%s\n' "${HOME:-}" | grep -Eq "$IOS_CONTAINER_PATTERN"; then
    exec sh "$IOS_CLI" "$@"
fi

if [ "$(uname -s 2>/dev/null || echo unknown)" = "Darwin" ] && [ -d /private/var/mobile/Containers/Data/Application ]; then
    exec sh "$IOS_CLI" "$@"
fi

if [ ! -f "$INNER" ]; then
    echo "Dream Server mobile wrapper not found: $INNER" >&2
    exit 1
fi

exec sh "$INNER" "$@"
