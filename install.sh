#!/bin/sh
# Dream Server root installer wrapper.
# Delegate to the inner installer using POSIX sh so iOS / a-Shell never falls
# through a bash-only path at the repo root.

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
INNER="$SCRIPT_DIR/dream-server/install.sh"

if [ ! -f "$INNER" ]; then
    echo "Error: dream-server installer not found" >&2
    echo "Expected: $INNER" >&2
    exit 1
fi

exec sh "$INNER" "$@"
