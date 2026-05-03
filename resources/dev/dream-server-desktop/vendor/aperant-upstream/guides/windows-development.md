# Windows Development Guide

This guide covers Windows-specific considerations when developing Auto Claude.

## Setup

Auto Claude downloads prebuilt native binaries for `node-pty` on Windows automatically. If prebuilts are not available for your Electron version, you will need Visual Studio Build Tools:

1. Download [Visual Studio Build Tools 2022](https://visualstudio.microsoft.com/visual-cpp-build-tools/)
2. Select the "Desktop development with C++" workload
3. In "Individual Components", add "MSVC v143 - VS 2022 C++ x64/x86 Spectre-mitigated libs"
4. Restart your terminal and run `npm install` again inside `apps/desktop/`

## Line Endings

Windows uses CRLF (`\r\n`) line endings while macOS/Linux use LF (`\n`). This can cause git diffs to show every line changed.

Configure git to handle line endings:

```bash
git config --global core.autocrlf true
```

The project's `.gitattributes` handles this automatically for tracked files.

## Path Separators

TypeScript code should use `path.join()` or `path.posix.join()` rather than hardcoded forward or back slashes. The platform abstraction layer in `apps/desktop/src/main/platform/` provides cross-platform helpers — always use those instead of `process.platform` directly.

## Shell Commands

The Bash tool in the AI agent layer validates commands against the allowlist defined in `apps/desktop/src/main/ai/security/`. On Windows, `.cmd` and `.bat` files require `shell: true` — the platform module's `requiresShell()` helper handles this automatically.

## Testing Windows Compatibility

CI runs all three platforms (Ubuntu, Windows, macOS) on every PR. To test locally on Windows:

```bash
cd apps/desktop

# Run unit tests
npm test

# Run type checking
npm run typecheck

# Run linter
npm run lint
```

## Common Issues

### Permission errors when deleting files

Windows file locking is stricter than Unix. Ensure streams and file handles are properly closed before attempting to delete or overwrite files.

### Long path names

Windows has a 260-character path limit by default. Enable long paths:

1. Open Group Policy Editor (`gpedit.msc`)
2. Navigate to: Local Computer Policy > Computer Configuration > Administrative Templates > System > Filesystem
3. Enable "Enable Win32 long paths"

Or use WSL2 to avoid the issue entirely.

### Case-insensitive filesystem

Windows filesystems are case-insensitive. Be consistent with casing in import paths — a mismatch that works on Windows will fail on Linux CI.

## Resources

- [Node.js on Windows](https://nodejs.org/en/download/)
- [Git for Windows](https://gitforwindows.org/)
- [WSL2 Documentation](https://docs.microsoft.com/en-us/windows/wsl/)

## Related

- [CONTRIBUTING.md](../CONTRIBUTING.md) - General contribution guidelines
