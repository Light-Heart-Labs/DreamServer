#!/bin/bash
# dream-backup.sh - Dream Server Backup Utility
# Part of M11: Update & Lifecycle Management
# Backs up user data and config before updates

set -euo pipefail

# Configuration
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DREAM_DIR="${DREAM_DIR:-$SCRIPT_DIR}"
BACKUP_ROOT="${DREAM_DIR}/.backups"
RETENTION_COUNT="${RETENTION_COUNT:-5}"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Prerequisites check
command -v rsync >/dev/null 2>&1 || { echo -e "${RED}Error: rsync is required but not installed.${NC}" >&2; echo "Install with: apt install rsync (Debian/Ubuntu) or brew install rsync (macOS)" >&2; exit 1; }
command -v jq >/dev/null 2>&1 || { echo -e "${RED}Error: jq is required but not installed.${NC}" >&2; echo "Install with: apt install jq (Debian/Ubuntu) or brew install jq (macOS)" >&2; exit 1; }

# Logging functions
log_info() { echo -e "${BLUE}[INFO]${NC} $*"; }
log_success() { echo -e "${GREEN}[SUCCESS]${NC} $*"; }
log_warn() { echo -e "${YELLOW}[WARN]${NC} $*"; }
log_error() { echo -e "${RED}[ERROR]${NC} $*"; }

# Show usage
usage() {
    cat << EOF
Dream Server Backup Utility

Usage: $(basename "$0") [OPTIONS]

OPTIONS:
    -h, --help              Show this help message
    -o, --output DIR        Custom backup directory (default: .backups/)
    -t, --type TYPE         Backup type: full, user-data, config (default: full)
    -c, --compress          Compress backup to .tar.gz
    -l, --list              List existing backups
    -d, --delete ID         Delete specific backup by ID
    --description DESC      Add description to backup manifest

BACKUP TYPES:
    full        Backup everything (user data + config + cache)
    user-data   Backup only user data volumes (default)
    config      Backup only configuration files

EXAMPLES:
    $(basename "$0")                          # Full backup with default settings
    $(basename "$0") -t user-data -c          # Compressed user data backup
    $(basename "$0") -l                       # List all backups
    $(basename "$0") -d 20260212-071500       # Delete specific backup

EOF
}

# List existing backups
list_backups() {
    if [[ ! -d "$BACKUP_ROOT" ]]; then
        log_info "No backups found (backup directory doesn't exist)"
        return 0
    fi

    local backups=()
    while IFS= read -r -d '' backup; do
        backups+=("$backup")
    done < <(find "$BACKUP_ROOT" -maxdepth 1 -type d -name "*-*-*" -print0 2>/dev/null | sort -z -r)

    if [[ ${#backups[@]} -eq 0 ]]; then
        log_info "No backups found"
        return 0
    fi

    echo ""
    echo "Existing Backups:"
    echo "═══════════════════════════════════════════════════════════════════"
    printf "%-20s %-12s %-10s %s\n" "ID" "Type" "Size" "Description"
    echo "───────────────────────────────────────────────────────────────────"

    for backup in "${backups[@]}"; do
        local id
        id=$(basename "$backup")
        local manifest="$backup/manifest.json"
        local backup_type="unknown"
        local description=""
        local size
        size=$(du -sh "$backup" 2>/dev/null | cut -f1)

        if [[ -f "$manifest" ]]; then
            backup_type=$(grep -o '"backup_type": "[^"]*"' "$manifest" 2>/dev/null | cut -d'"' -f4 || echo "unknown")
            description=$(grep -o '"description": "[^"]*"' "$manifest" 2>/dev/null | cut -d'"' -f4 || echo "")
        fi

        printf "%-20s %-12s %-10s %s\n" "$id" "$backup_type" "$size" "$description"
    done
    echo ""
}

# Delete specific backup
delete_backup() {
    local backup_id="$1"
    local backup_dir="$BACKUP_ROOT/$backup_id"

    if [[ ! -d "$backup_dir" ]]; then
        log_error "Backup not found: $backup_id"
        return 1
    fi

    read -rp "Are you sure you want to delete backup $backup_id? [y/N] " confirm
    if [[ "$confirm" =~ ^[Yy]$ ]]; then
        rm -rf "$backup_dir"
        log_success "Deleted backup: $backup_id"
    else
        log_info "Deletion cancelled"
    fi
}

# Create backup manifest
create_manifest() {
    local backup_dir="$1"
    local backup_type="$2"
    local description="${3:-}"
    local version
    version=$(cat "$DREAM_DIR/.version" 2>/dev/null || echo "unknown")

    # Use jq to safely construct JSON (prevents injection via $description)
    local has_user_data="false" has_config="false" has_cache="false"
    [[ "$backup_type" == "full" || "$backup_type" == "user-data" ]] && has_user_data="true"
    [[ "$backup_type" == "full" || "$backup_type" == "config" ]] && has_config="true"
    [[ "$backup_type" == "full" ]] && has_cache="true"

    jq -n \
        --arg mv "1.0" \
        --arg bd "$(date -Iseconds)" \
        --arg bi "$(basename "$backup_dir")" \
        --arg bt "$backup_type" \
        --arg dv "$version" \
        --arg hn "$(hostname)" \
        --arg desc "$description" \
        --argjson ud "$has_user_data" \
        --argjson cfg "$has_config" \
        --argjson ca "$has_cache" \
        '{
          manifest_version: $mv,
          backup_date: $bd,
          backup_id: $bi,
          backup_type: $bt,
          dream_version: $dv,
          hostname: $hn,
          description: $desc,
          contents: { user_data: $ud, config: $cfg, cache: $ca },
          paths: {
            data_open_webui: "data/open-webui",
            data_n8n: "data/n8n",
            data_qdrant: "data/qdrant",
            data_openclaw: "data/openclaw",
            env: ".env",
            compose: "docker-compose.yml",
            config: "config"
          }
        }' > "$backup_dir/manifest.json"
    log_info "Created backup manifest"
}

# Backup user data volumes
backup_user_data() {
    local backup_dir="$1"
    log_info "Backing up user data volumes..."

    local user_data_paths=(
        "data/open-webui"
        "data/n8n"
        "data/qdrant"
        "data/openclaw"
        "data/litellm"
        "data/livekit"
        "data/ollama"
    )

    for path in "${user_data_paths[@]}"; do
        local full_path="$DREAM_DIR/$path"
        if [[ -d "$full_path" ]]; then
            local dest_dir="$backup_dir/$(dirname "$path")"
            mkdir -p "$dest_dir"
            rsync -a --delete "$full_path" "$dest_dir/"
            log_success "Backed up: $path"
        else
            log_warn "Skipped (not found): $path"
        fi
    done
}

# Backup configuration
backup_config() {
    local backup_dir="$1"
    log_info "Backing up configuration..."

    # Essential config files
    local config_files=(
        ".env"
        "docker-compose.yml"
        ".version"
        "dream-preflight.sh"
        "dream-update.sh"
    )

    for file in "${config_files[@]}"; do
        if [[ -f "$DREAM_DIR/$file" ]]; then
            cp "$DREAM_DIR/$file" "$backup_dir/"
            log_success "Backed up: $file"
        else
            log_warn "Skipped (not found): $file"
        fi
    done

    # Config directory
    if [[ -d "$DREAM_DIR/config" ]]; then
        rsync -a --delete "$DREAM_DIR/config" "$backup_dir/"
        log_success "Backed up: config/"
    fi
}

# Backup cache (optional, for full backups)
backup_cache() {
    local backup_dir="$1"
    log_info "Backing up cache (models, etc.)..."

    if [[ -d "$DREAM_DIR/models" ]]; then
        rsync -a --delete "$DREAM_DIR/models" "$backup_dir/"
        log_success "Backed up: models/"
    fi

    # Docker volumes that contain cache data
    local cache_paths=(
        "data/whisper/cache"
        "data/kokoro/cache"
    )

    for path in "${cache_paths[@]}"; do
        if [[ -d "$DREAM_DIR/$path" ]]; then
            local dest_dir="$backup_dir/$(dirname "$path")"
            mkdir -p "$dest_dir"
            rsync -a --delete "$DREAM_DIR/$path" "$dest_dir/"
            log_success "Backed up: $path"
        fi
    done
}

# Apply retention policy - keep only N most recent backups
apply_retention() {
    log_info "Applying retention policy (keeping last $RETENTION_COUNT backups)..."

    local backups=()
    while IFS= read -r -d '' backup; do
        backups+=("$backup")
    done < <(find "$BACKUP_ROOT" -maxdepth 1 -type d -name "*-*-*" -print0 2>/dev/null | sort -z -r)

    local count=${#backups[@]}
    if [[ $count -gt $RETENTION_COUNT ]]; then
        local to_delete=$((count - RETENTION_COUNT))
        log_info "Removing $to_delete old backup(s)..."

        for ((i=RETENTION_COUNT; i<count; i++)); do
            local old_backup="${backups[$i]}"
            log_warn "Removing old backup: $(basename "$old_backup")"
            rm -rf "$old_backup"
        done
    else
        log_info "Retention policy satisfied ($count/$RETENTION_COUNT backups)"
    fi
}

# Compress backup
compress_backup() {
    local backup_dir="$1"
    log_info "Compressing backup..."

    local backup_name
    backup_name=$(basename "$backup_dir")
    local parent_dir
    parent_dir=$(dirname "$backup_dir")

    tar czf "$parent_dir/$backup_name.tar.gz" -C "$parent_dir" "$backup_name"
    local compressed_size
    compressed_size=$(du -sh "$parent_dir/$backup_name.tar.gz" | cut -f1)

    # Remove uncompressed version
    rm -rf "$backup_dir"

    log_success "Compressed backup: $backup_name.tar.gz ($compressed_size)"
}

# Main backup function
do_backup() {
    local backup_type="${1:-user-data}"
    local compress="${2:-false}"
    local description="${3:-}"

    # Generate backup ID
    local backup_id
    backup_id=$(date +%Y%m%d-%H%M%S)
    local backup_dir="$BACKUP_ROOT/$backup_id"

    log_info "Starting $backup_type backup: $backup_id"
    log_info "Backup directory: $backup_dir"

    # Create backup directory
    mkdir -p "$backup_dir"

    # Create manifest
    create_manifest "$backup_dir" "$backup_type" "$description"

    # Perform backup based on type
    case "$backup_type" in
        full)
            backup_user_data "$backup_dir"
            backup_config "$backup_dir"
            backup_cache "$backup_dir"
            ;;
        user-data)
            backup_user_data "$backup_dir"
            ;;
        config)
            backup_config "$backup_dir"
            ;;
        *)
            log_error "Unknown backup type: $backup_type"
            rm -rf "$backup_dir"
            exit 1
            ;;
    esac

    # Compress if requested
    if [[ "$compress" == "true" ]]; then
        compress_backup "$backup_dir"
        backup_dir="$BACKUP_ROOT/$backup_id.tar.gz"
    fi

    # Apply retention policy
    apply_retention

    log_success "Backup complete: $backup_id"
    echo ""
    echo "To restore this backup, run:"
    echo "  dream-restore.sh $backup_id"
}

# Main entry point
main() {
    local backup_type="user-data"
    local compress="false"
    local description=""
    local list_mode="false"
    local delete_id=""

    # Parse arguments
    while [[ $# -gt 0 ]]; do
        case "$1" in
            -h|--help)
                usage
                exit 0
                ;;
            -o|--output)
                BACKUP_ROOT="$2"
                shift 2
                ;;
            -t|--type)
                backup_type="$2"
                shift 2
                ;;
            -c|--compress)
                compress="true"
                shift
                ;;
            -l|--list)
                list_mode="true"
                shift
                ;;
            -d|--delete)
                delete_id="$2"
                shift 2
                ;;
            --description)
                description="$2"
                shift 2
                ;;
            *)
                log_error "Unknown option: $1"
                usage
                exit 1
                ;;
        esac
    done

    # List mode
    if [[ "$list_mode" == "true" ]]; then
        list_backups
        exit 0
    fi

    # Delete mode
    if [[ -n "$delete_id" ]]; then
        delete_backup "$delete_id"
        exit 0
    fi

    # Check if running in Dream Server directory
    if [[ ! -f "$DREAM_DIR/docker-compose.yml" && ! -d "$DREAM_DIR/data" ]]; then
        log_warn "This doesn't appear to be a Dream Server directory"
        log_warn "Expected: docker-compose.yml or data/ directory"
        read -rp "Continue anyway? [y/N] " confirm
        if [[ ! "$confirm" =~ ^[Yy]$ ]]; then
            exit 1
        fi
    fi

    # Create backup root
    mkdir -p "$BACKUP_ROOT"

    # Perform backup
    do_backup "$backup_type" "$compress" "$description"
}

main "$@"
