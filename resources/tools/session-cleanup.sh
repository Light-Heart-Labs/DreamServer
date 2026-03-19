#!/bin/bash
# ═══════════════════════════════════════════════════════════════
# Lighthouse AI - Session Cleanup Script
# https://github.com/Light-Heart-Labs/Lighthouse-AI
#
# Prevents context overflow crashes by automatically managing
# session file lifecycle. When a session file exceeds the size
# threshold, it's deleted and its reference removed from
# sessions.json, forcing the gateway to create a fresh session.
#
# The agent doesn't notice — it just gets a clean context window.
# ═══════════════════════════════════════════════════════════════

set -euo pipefail

# ── Configuration ──────────────────────────────────────────────
# These are overwritten by install.sh from config.yaml
OPENCLAW_DIR="${OPENCLAW_DIR:-$HOME/.openclaw}"
SESSIONS_DIR="${SESSIONS_DIR:-$OPENCLAW_DIR/agents/main/sessions}"
SESSIONS_JSON="$SESSIONS_DIR/sessions.json"
MAX_SIZE="${MAX_SIZE:-256000}"

# ── Preflight ──────────────────────────────────────────────────
if [ ! -f "$SESSIONS_JSON" ]; then
    echo "[$(date)] No sessions.json found at $SESSIONS_JSON, skipping"
    exit 0
fi

if [ ! -d "$SESSIONS_DIR" ]; then
    echo "[$(date)] Sessions directory not found at $SESSIONS_DIR, skipping"
    exit 0
fi

# ── Extract active session IDs ─────────────────────────────────
ACTIVE_IDS=$(grep -oP '"sessionId":\s*"\K[^"]+' "$SESSIONS_JSON" 2>/dev/null || true)

echo "[$(date)] Session cleanup starting"
echo "[$(date)] Sessions dir: $SESSIONS_DIR"
echo "[$(date)] Max size threshold: $MAX_SIZE bytes"
echo "[$(date)] Active sessions found: $(echo "$ACTIVE_IDS" | wc -w)"

# ── Clean up debris ────────────────────────────────────────────
DELETED_COUNT=$(find "$SESSIONS_DIR" -name '*.deleted.*' -delete -print 2>/dev/null | wc -l)
BAK_COUNT=$(find "$SESSIONS_DIR" -name '*.bak*' -not -name '*.bak-cleanup' -delete -print 2>/dev/null | wc -l)
if [ "$DELETED_COUNT" -gt 0 ] || [ "$BAK_COUNT" -gt 0 ]; then
    echo "[$(date)] Cleaned up $DELETED_COUNT .deleted files, $BAK_COUNT .bak files"
fi

# ── Process session files ──────────────────────────────────────
WIPE_IDS=""
REMOVED_INACTIVE=0
REMOVED_BLOATED=0

for f in "$SESSIONS_DIR"/*.jsonl; do
    [ -f "$f" ] || continue
    BASENAME=$(basename "$f" .jsonl)

    # Check if this session is active
    IS_ACTIVE=false
    for ID in $ACTIVE_IDS; do
        if [ "$BASENAME" = "$ID" ]; then
            IS_ACTIVE=true
            break
        fi
    done

    if [ "$IS_ACTIVE" = false ]; then
        SIZE=$(du -h "$f" | cut -f1)
        echo "[$(date)] Removing inactive session: $BASENAME ($SIZE)"
        rm -f "$f"
        REMOVED_INACTIVE=$((REMOVED_INACTIVE + 1))
    else
        SIZE_BYTES=$(stat -c%s "$f" 2>/dev/null || echo 0)
        if [ "$SIZE_BYTES" -gt "$MAX_SIZE" ]; then
            SIZE=$(du -h "$f" | cut -f1)
            echo "[$(date)] Session $BASENAME is bloated ($SIZE > $(numfmt --to=iec $MAX_SIZE 2>/dev/null || echo "${MAX_SIZE}B")), deleting to force fresh session"
            rm -f "$f"
            WIPE_IDS="$WIPE_IDS $BASENAME"
            REMOVED_BLOATED=$((REMOVED_BLOATED + 1))
        fi
    fi
done

# ── Remove wiped session references from sessions.json ─────────
if [ -n "$WIPE_IDS" ]; then
    echo "[$(date)] Clearing session references from sessions.json for:$WIPE_IDS"
    cp "$SESSIONS_JSON" "$SESSIONS_JSON.bak-cleanup"

    for ID in $WIPE_IDS; do
        python3 -c "
import json, sys
with open('$SESSIONS_JSON', 'r') as f:
    data = json.load(f)
to_remove = [k for k, v in data.items() if isinstance(v, dict) and v.get('sessionId') == '$ID']
for k in to_remove:
    del data[k]
    print(f'  Removed session key: {k}', file=sys.stderr)
with open('$SESSIONS_JSON', 'w') as f:
    json.dump(data, f, indent=2)
" 2>&1
    done

    # Clean up the backup
    rm -f "$SESSIONS_JSON.bak-cleanup"
fi

# ── Summary ────────────────────────────────────────────────────
echo "[$(date)] Cleanup complete: removed $REMOVED_INACTIVE inactive, $REMOVED_BLOATED bloated"
REMAINING=$(ls "$SESSIONS_DIR"/*.jsonl 2>/dev/null | wc -l)
echo "[$(date)] Remaining session files: $REMAINING"
if [ "$REMAINING" -gt 0 ]; then
    ls -lhS "$SESSIONS_DIR"/*.jsonl 2>/dev/null | while read -r line; do
        echo "  $line"
    done
fi
