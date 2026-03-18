#!/bin/bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT_DIR"

echo "[smoke] WSL dispatch logic"
grep -q "linux|wsl" installers/dispatch.sh

echo "[smoke] PASS wsl-logic"
