#!/bin/bash
# ============================================================================
# Dream Server — Codebase Statistics
# ============================================================================
# Outputs line counts and file counts for the Dream Server codebase.
# Used for documentation and contributor metrics.
# ============================================================================

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$ROOT"

echo "Dream Server — Codebase Statistics"
echo "===================================="
echo ""

# Count lines by language (excluding node_modules, .git, venv)
count_lines() {
    local ext="$1"
    local name="$2"
    local total
    total=$(find . -type f -name "*.$ext" \
        ! -path "./.git/*" \
        ! -path "./node_modules/*" \
        ! -path "./venv/*" \
        ! -path "./__pycache__/*" \
        ! -path "*/__pycache__/*" \
        2>/dev/null | xargs wc -l 2>/dev/null | tail -1 | awk '{print $1}')
    printf "  %-12s %'d lines\n" "$name:" "${total:-0}"
}

# Count files by language
count_files() {
    local ext="$1"
    local name="$2"
    local n
    n=$(find . -type f -name "*.$ext" \
        ! -path "./.git/*" \
        ! -path "./node_modules/*" \
        ! -path "./venv/*" \
        ! -path "./__pycache__/*" \
        ! -path "*/__pycache__/*" \
        2>/dev/null | wc -l)
    printf "  %-12s %'d files\n" "$name:" "${n:-0}"
}

echo "Lines of code:"
count_lines "py" "Python"
count_lines "sh" "Bash"
count_lines "js" "JavaScript"
count_lines "jsx" "JSX"
count_lines "ts" "TypeScript"
count_lines "tsx" "TSX"
count_lines "yaml" "YAML"
count_lines "yml" "YAML"
echo ""

echo "File counts:"
count_files "py" "Python"
count_files "sh" "Bash"
count_files "js" "JavaScript"
count_files "jsx" "JSX"
count_files "yaml" "YAML"
count_files "yml" "YAML"
echo ""

# Total (approximate - may double-count yaml/yml)
TOTAL_LINES=$(find . -type f \( -name "*.py" -o -name "*.sh" -o -name "*.js" -o -name "*.jsx" \) \
    ! -path "./.git/*" ! -path "./node_modules/*" ! -path "./venv/*" \
    2>/dev/null | xargs wc -l 2>/dev/null | tail -1 | awk '{print $1}')
TOTAL_FILES=$(find . -type f \( -name "*.py" -o -name "*.sh" -o -name "*.js" -o -name "*.jsx" \) \
    ! -path "./.git/*" ! -path "./node_modules/*" ! -path "./venv/*" \
    2>/dev/null | wc -l)

echo "Total (py+sh+js+jsx): ${TOTAL_LINES:-0} lines, ${TOTAL_FILES:-0} files"
echo ""
