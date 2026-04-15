#!/bin/bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT_DIR"

echo "[smoke] mobile dispatch and docs"
grep -q "android-termux" installers/common.sh
grep -q "ios-ashell" installers/common.sh
grep -q "mobile/install-mobile.sh" installers/dispatch.sh
grep -q "Android / Termux" docs/MOBILE-SHELL-QUICKSTART.md
grep -q "iOS / a-Shell" docs/MOBILE-SHELL-QUICKSTART.md
grep -q "termux-setup-storage" docs/MOBILE-SHELL-QUICKSTART.md
grep -q "./dream-mobile.sh local" docs/MOBILE-SHELL-QUICKSTART.md
grep -q "IOS-ASHELL-SHORTCUTS.md" docs/MOBILE-SHELL-QUICKSTART.md
grep -q "ios-ashell-install.sh" installers/mobile/install-mobile.sh
grep -q "chat" installers/mobile/ios-ashell-cli.sh
grep -q "status" installers/mobile/ios-ashell-cli.sh
grep -q "export" dream-mobile.sh
grep -q "local" dream-mobile.sh

echo "[smoke] PASS mobile-dispatch"
