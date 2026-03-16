#!/bin/bash
# ============================================================================
# Dream Server Installer — Path Utilities
# ============================================================================
# Part of: installers/lib/
# Purpose: Cross-platform path resolution and validation
#
# Expects: (nothing — can be sourced independently)
# Provides: resolve_install_dir(), validate_install_path(), normalize_path()
#
# Modder notes:
#   Add platform-specific path handling here.
# ============================================================================

# Normalize a path (resolve symlinks, remove trailing slashes, make absolute)
normalize_path() {
    local path="$1"
    
    # Handle empty path
    if [[ -z "$path" ]]; then
        echo ""
        return 1
    fi
    
    # Expand tilde to HOME
    path="${path/#\~/$HOME}"
    
    # Make absolute if relative
    if [[ "$path" != /* ]]; then
        path="$(pwd)/$path"
    fi
    
    # Resolve symlinks and normalize (remove .., ., //)
    if command -v realpath &>/dev/null; then
        # GNU realpath (Linux)
        realpath -m "$path" 2>/dev/null || echo "$path"
    elif command -v grealpath &>/dev/null; then
        # GNU realpath via Homebrew (macOS)
        grealpath -m "$path" 2>/dev/null || echo "$path"
    else
        # Fallback: manual normalization (works on macOS/BSD)
        python3 -c "import os; print(os.path.abspath('$path'))" 2>/dev/null || echo "$path"
    fi
}

# Resolve installation directory with precedence:
# 1. INSTALL_DIR env var (if set)
# 2. DREAM_HOME env var (if set) - legacy macOS
# 3. DS_INSTALL_DIR env var (if set) - legacy macOS
# 4. Default: $HOME/dream-server
resolve_install_dir() {
    local resolved=""
    
    # Check precedence order
    if [[ -n "${INSTALL_DIR:-}" ]]; then
        resolved="$INSTALL_DIR"
    elif [[ -n "${DREAM_HOME:-}" ]]; then
        resolved="$DREAM_HOME"
    elif [[ -n "${DS_INSTALL_DIR:-}" ]]; then
        resolved="$DS_INSTALL_DIR"
    else
        resolved="$HOME/dream-server"
    fi
    
    # Normalize the path
    normalize_path "$resolved"
}

# Validate installation path (check writability, space, etc.)
validate_install_path() {
    local path="$1"
    local required_gb="${2:-20}"
    
    # Check if path is empty
    if [[ -z "$path" ]]; then
        echo "ERROR: Installation path is empty" >&2
        return 1
    fi
    
    # Check if parent directory exists and is writable
    local parent_dir
    parent_dir="$(dirname "$path")"
    
    if [[ ! -d "$parent_dir" ]]; then
        echo "ERROR: Parent directory does not exist: $parent_dir" >&2
        return 1
    fi
    
    if [[ ! -w "$parent_dir" ]]; then
        echo "ERROR: Parent directory is not writable: $parent_dir" >&2
        return 1
    fi
    
    # Check available disk space
    local avail_gb
    if command -v df &>/dev/null; then
        avail_gb=$(df -BG "$parent_dir" 2>/dev/null | tail -1 | awk '{print $4}' | tr -d 'G' || echo "0")
        if [[ "$avail_gb" -lt "$required_gb" ]]; then
            echo "WARNING: Low disk space. Available: ${avail_gb}GB, Required: ${required_gb}GB" >&2
            return 2  # Warning, not fatal
        fi
    fi
    
    return 0
}

# Get platform-specific default install directory
get_default_install_dir() {
    case "$(uname -s)" in
        Darwin)
            # macOS: prefer ~/Applications for user installs
            if [[ -w "$HOME/Applications" ]] || [[ ! -e "$HOME/Applications" ]]; then
                echo "$HOME/Applications/dream-server"
            else
                echo "$HOME/dream-server"
            fi
            ;;
        Linux|*)
            # Linux/other: use home directory
            echo "$HOME/dream-server"
            ;;
    esac
}
