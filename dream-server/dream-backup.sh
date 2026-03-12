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
    -v, --verify ID         Verify backup integrity using checksums
    --description DESC      Add description to backup manifest

BACKUP TYPES:
    full        Backup everything (user data + config + cache)
    user-data   Backup only user data volumes (default)
    config      Backup only configuration files

EXAMPLES:
    $(basename "$0")                          # Full backup with default settings
    $(basename "$0") -t user-data -c          # Compressed user data backup
    $(basename "$0") -l                       # List all backups
    $(basename "$0") -v 20260212-071500       # Verify backup integrity
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
    done < <(find "$BACKUP_ROOT" -maxdepth 1 \( -type d -o -name "*.tar.gz" \) -name "*-*-*" -print0 2>/dev/null | sort -z -r)

    if [[ ${#backups[@]} -eq 0 ]]; then
        log_info "No backups found"
        return 0
    fi

    echo ""
    echo "Existing Backups:"
    echo "═══════════════════════════════════════════════════════════════════"
    printf "%-20s %-12s %-10s %-10s %s\n" "ID" "Type" "Size" "Est.Size" "Description"
    echo "───────────────────────────────────────────────────────────────────"

    for backup in "${backups[@]}"; do
        local id
        id=$(basename "$backup")
        local backup_type="unknown"
        local description=""
        local size
        size=$(du -sh "$backup" 2>/dev/null | cut -f1)
        local est_size=""

        if [[ "$backup" == *.tar.gz ]]; then
            # Compressed archive — extract manifest from inside the tar
            local manifest_data
            local archive_name="${id%.tar.gz}"
            if manifest_data=$(tar xzf "$backup" -O "${archive_name}/manifest.json" 2>/dev/null); then
                backup_type=$(echo "$manifest_data" | grep -o '"backup_type": "[^"]*"' 2>/dev/null | cut -d'"' -f4 || echo "compressed")
                description=$(echo "$manifest_data" | grep -o '"description": "[^"]*"' 2>/dev/null | cut -d'"' -f4 || echo "")
                local est_bytes
                est_bytes=$(echo "$manifest_data" | grep -o '"estimated_size_bytes": "[^"]*"' 2>/dev/null | cut -d'"' -f4 || echo "0")
                if [[ "$est_bytes" != "0" && -n "$est_bytes" ]]; then
                    if command -v numfmt &>/dev/null; then
                        est_size=$(numfmt --to=iec-i --suffix=B "$est_bytes" 2>/dev/null || echo "")
                    fi
                fi
            else
                backup_type="compressed"
            fi
        elif [[ -f "$backup/manifest.json" ]]; then
            backup_type=$(grep -o '"backup_type": "[^"]*"' "$backup/manifest.json" 2>/dev/null | cut -d'"' -f4 || echo "unknown")
            description=$(grep -o '"description": "[^"]*"' "$backup/manifest.json" 2>/dev/null | cut -d'"' -f4 || echo "")
            local est_bytes
            est_bytes=$(grep -o '"estimated_size_bytes": "[^"]*"' "$backup/manifest.json" 2>/dev/null | cut -d'"' -f4 || echo "0")
            if [[ "$est_bytes" != "0" && -n "$est_bytes" ]]; then
                if command -v numfmt &>/dev/null; then
                    est_size=$(numfmt --to=iec-i --suffix=B "$est_bytes" 2>/dev/null || echo "")
                fi
            fi
        fi

        printf "%-20s %-12s %-10s %-10s %s\n" "$id" "$backup_type" "$size" "${est_size:--}" "$description"
    done
    echo ""
}

# Delete specific backup
delete_backup() {
    local backup_id="$1"

    # Reject path traversal attempts
    if [[ "$backup_id" == *..* || "$backup_id" == */* || "$backup_id" == *\\* ]]; then
        log_error "Invalid backup ID: $backup_id"
        return 1
    fi

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

# Get size of file or directory in bytes (cross-platform)
get_size_bytes() {
    local path="$1"
    if [[ -f "$path" ]]; then
        # File: use stat (cross-platform)
        stat -c %s "$path" 2>/dev/null || stat -f %z "$path" 2>/dev/null || echo 0
    elif [[ -d "$path" ]]; then
        # Directory: use du -k (portable) and convert to bytes
        local size_kb
        size_kb=$(du -sk "$path" 2>/dev/null | cut -f1 || echo 0)
        echo $((size_kb * 1024))
    else
        echo 0
    fi
}

# Estimate backup size before starting
estimate_backup_size() {
    local backup_type="$1"
    log_info "Estimating backup size..."

    local total_size=0
    local paths_to_check=()

    # Determine what to check based on backup type
    case "$backup_type" in
        full)
            paths_to_check+=(
                "data/open-webui" "data/n8n" "data/qdrant" "data/openclaw"
                "data/litellm" "data/livekit" "data/ollama"
                ".env" ".version" "docker-compose*.y*ml" "config"
                "models"
            )
            ;;
        user-data)
            paths_to_check+=(
                "data/open-webui" "data/n8n" "data/qdrant" "data/openclaw"
                "data/litellm" "data/livekit" "data/ollama"
            )
            ;;
        config)
            paths_to_check+=(
                ".env" ".version" "docker-compose*.y*ml" "config"
            )
            ;;
    esac

    # Calculate size
    for path in "${paths_to_check[@]}"; do
        if [[ "$path" == *"*"* ]]; then
            # Glob pattern
            for file in "$DREAM_DIR"/$path; do
                [[ -e "$file" ]] && total_size=$((total_size + $(get_size_bytes "$file")))
            done
        else
            local full_path="$DREAM_DIR/$path"
            if [[ -e "$full_path" ]]; then
                total_size=$((total_size + $(get_size_bytes "$full_path")))
            fi
        fi
    done

    # Convert to human readable
    local size_human
    if command -v numfmt &>/dev/null; then
        size_human=$(numfmt --to=iec-i --suffix=B $total_size 2>/dev/null || echo "${total_size} bytes")
    else
        # Fallback for systems without numfmt
        if [[ $total_size -gt 1073741824 ]]; then
            size_human="$(( total_size / 1073741824 ))GiB"
        elif [[ $total_size -gt 1048576 ]]; then
            size_human="$(( total_size / 1048576 ))MiB"
        elif [[ $total_size -gt 1024 ]]; then
            size_human="$(( total_size / 1024 ))KiB"
        else
            size_human="${total_size}B"
        fi
    fi

    log_info "Estimated backup size: $size_human"

    # Check available space
    local backup_parent
    backup_parent=$(dirname "$BACKUP_ROOT")
    local available_space
    available_space=$(df -B1 "$backup_parent" 2>/dev/null | tail -1 | awk '{print $4}')

    if [[ -n "$available_space" && $available_space -lt $total_size ]]; then
        log_error "Insufficient disk space!"
        log_error "Required: $size_human"
        local avail_human
        if command -v numfmt &>/dev/null; then
            avail_human=$(numfmt --to=iec-i --suffix=B $available_space 2>/dev/null)
        else
            avail_human="$(( available_space / 1048576 ))MiB"
        fi
        log_error "Available: $avail_human"
        return 1
    fi

    echo "$total_size"
}

# Create backup manifest
create_manifest() {
    local backup_dir="$1"
    local backup_type="$2"
    local description="${3:-}"
    local estimated_size="${4:-0}"
    local version
    version=$(cat "$DREAM_DIR/.version" 2>/dev/null || echo "unknown")

    # Use jq to safely construct JSON (prevents injection via $description)
    local has_user_data="false" has_config="false" has_cache="false"
    [[ "$backup_type" == "full" || "$backup_type" == "user-data" ]] && has_user_data="true"
    [[ "$backup_type" == "full" || "$backup_type" == "config" ]] && has_config="true"
    [[ "$backup_type" == "full" ]] && has_cache="true"

    jq -n \
        --arg mv "1.0" \
        --arg bd "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" \
        --arg bi "$(basename "$backup_dir")" \
        --arg bt "$backup_type" \
        --arg dv "$version" \
        --arg hn "$(hostname)" \
        --arg desc "$description" \
        --arg size "$estimated_size" \
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
          estimated_size_bytes: $size,
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

    local failed_paths=()
    local success_count=0

    for path in "${user_data_paths[@]}"; do
        local full_path="$DREAM_DIR/$path"
        if [[ -d "$full_path" ]]; then
            local dest_dir="$backup_dir/$(dirname "$path")"
            mkdir -p "$dest_dir"
            if rsync -a --delete "$full_path" "$dest_dir/" 2>/dev/null; then
                log_success "Backed up: $path"
                ((success_count++))
            else
                log_error "Failed to backup: $path"
                failed_paths+=("$path")
            fi
        else
            log_warn "Skipped (not found): $path"
        fi
    done

    # Record failures in a status file
    if [[ ${#failed_paths[@]} -gt 0 ]]; then
        local status_file="$backup_dir/.backup_status"
        echo "partial_failure=true" > "$status_file"
        echo "failed_paths=${failed_paths[*]}" >> "$status_file"
        echo "success_count=$success_count" >> "$status_file"
        echo "total_paths=${#user_data_paths[@]}" >> "$status_file"
        log_warn "Backup completed with failures: ${#failed_paths[@]} paths failed"
    fi
}

# Backup configuration
backup_config() {
    local backup_dir="$1"
    log_info "Backing up configuration..."

    local failed_files=()
    local success_count=0

    # Essential config files: discover compose overlays + dotfiles dynamically
    for file in "$DREAM_DIR"/.env "$DREAM_DIR"/.version "$DREAM_DIR"/docker-compose*.y*ml "$DREAM_DIR"/dream-preflight.sh "$DREAM_DIR"/dream-update.sh; do
        if [[ -f "$file" ]]; then
            if cp "$file" "$backup_dir/" 2>/dev/null; then
                log_success "Backed up: $(basename "$file")"
                ((success_count++))
            else
                log_error "Failed to backup: $(basename "$file")"
                failed_files+=("$(basename "$file")")
            fi
        fi
    done

    # Config directory
    if [[ -d "$DREAM_DIR/config" ]]; then
        if rsync -a --delete "$DREAM_DIR/config" "$backup_dir/" 2>/dev/null; then
            log_success "Backed up: config/"
            ((success_count++))
        else
            log_error "Failed to backup: config/"
            failed_files+=("config/")
        fi
    fi

    # Record config backup failures
    if [[ ${#failed_files[@]} -gt 0 ]]; then
        local status_file="$backup_dir/.backup_status"
        echo "config_partial_failure=true" >> "$status_file"
        echo "config_failed_files=${failed_files[*]}" >> "$status_file"
        log_warn "Config backup completed with failures: ${#failed_files[@]} files failed"
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
    done < <(find "$BACKUP_ROOT" -maxdepth 1 \( -type d -o -name "*.tar.gz" \) -name "*-*-*" -print0 2>/dev/null | sort -z -r)

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

# Generate checksums for backup integrity validation
generate_checksums() {
    local backup_dir="$1"
    log_info "Generating integrity checksums..."

    local checksums_file="$backup_dir/.checksums"
    : > "$checksums_file"

    # Checksum critical config files
    for file in "$backup_dir"/.env "$backup_dir"/.version "$backup_dir"/docker-compose*.y*ml; do
        if [[ -f "$file" ]]; then
            local relpath
            relpath=$(basename "$file")
            if command -v sha256sum &>/dev/null; then
                (cd "$backup_dir" && sha256sum "$relpath" >> .checksums 2>/dev/null) || true
            elif command -v shasum &>/dev/null; then
                (cd "$backup_dir" && shasum -a 256 "$relpath" >> .checksums 2>/dev/null) || true
            fi
        fi
    done

    # Checksum manifest
    if [[ -f "$backup_dir/manifest.json" ]]; then
        if command -v sha256sum &>/dev/null; then
            (cd "$backup_dir" && sha256sum manifest.json >> .checksums 2>/dev/null) || true
        elif command -v shasum &>/dev/null; then
            (cd "$backup_dir" && shasum -a 256 manifest.json >> .checksums 2>/dev/null) || true
        fi
    fi

    # Generate directory tree checksums for data dirs (faster than per-file)
    for datadir in "$backup_dir"/data/*; do
        if [[ -d "$datadir" ]]; then
            local dirname
            dirname=$(basename "$datadir")
            local tree_hash
            if command -v sha256sum &>/dev/null; then
                tree_hash=$(find "$datadir" -type f -exec sha256sum {} \; 2>/dev/null | sort | sha256sum | cut -d' ' -f1)
            elif command -v shasum &>/dev/null; then
                tree_hash=$(find "$datadir" -type f -exec shasum -a 256 {} \; 2>/dev/null | sort | shasum -a 256 | cut -d' ' -f1)
            fi
            if [[ -n "$tree_hash" ]]; then
                echo "$tree_hash  data/$dirname/" >> "$checksums_file"
            fi
        fi
    done

    local checksum_count
    checksum_count=$(wc -l < "$checksums_file" 2>/dev/null || echo 0)
    log_success "Generated $checksum_count integrity checksums"
}

# Verify backup integrity
verify_backup_integrity() {
    local backup_id="$1"
    local backup_dir="$BACKUP_ROOT/$backup_id"

    # Handle compressed backups
    if [[ ! -d "$backup_dir" && -f "$BACKUP_ROOT/$backup_id.tar.gz" ]]; then
        log_error "Cannot verify compressed backup. Extract first with: tar xzf $backup_id.tar.gz"
        return 1
    fi

    if [[ ! -d "$backup_dir" ]]; then
        log_error "Backup not found: $backup_id"
        return 1
    fi

    local checksums_file="$backup_dir/.checksums"
    if [[ ! -f "$checksums_file" ]]; then
        log_warn "No checksums found in backup (created before integrity feature)"
        return 0
    fi

    # Verify checksum tool availability
    if ! command -v sha256sum &>/dev/null && ! command -v shasum &>/dev/null; then
        log_error "No checksum tool available (sha256sum or shasum required)"
        return 1
    fi

    log_info "Verifying backup integrity: $backup_id"
    echo ""

    local total=0 passed=0 failed=0
    while IFS= read -r line; do
        ((total++))
        local expected_hash
        expected_hash=$(echo "$line" | awk '{print $1}')
        local filepath
        filepath=$(echo "$line" | awk '{$1=""; print $0}' | sed 's/^[[:space:]]*//')

        if [[ "$filepath" == data/*/ ]]; then
            # Directory tree checksum
            local datadir="$backup_dir/$filepath"
            local actual_hash
            if command -v sha256sum &>/dev/null; then
                actual_hash=$(find "$datadir" -type f -exec sha256sum {} \; 2>/dev/null | sort | sha256sum | cut -d' ' -f1)
            elif command -v shasum &>/dev/null; then
                actual_hash=$(find "$datadir" -type f -exec shasum -a 256 {} \; 2>/dev/null | sort | shasum -a 256 | cut -d' ' -f1)
            fi
        else
            # File checksum
            local fullpath="$backup_dir/$filepath"
            if [[ ! -f "$fullpath" ]]; then
                log_error "Missing: $filepath"
                ((failed++))
                continue
            fi
            local actual_hash
            if command -v sha256sum &>/dev/null; then
                actual_hash=$(sha256sum "$fullpath" 2>/dev/null | cut -d' ' -f1)
            elif command -v shasum &>/dev/null; then
                actual_hash=$(shasum -a 256 "$fullpath" 2>/dev/null | cut -d' ' -f1)
            fi
        fi

        if [[ "$actual_hash" == "$expected_hash" ]]; then
            echo "  ✓ $filepath"
            ((passed++))
        else
            log_error "Corrupted: $filepath"
            ((failed++))
        fi
    done < "$checksums_file"

    echo ""
    if [[ $failed -eq 0 ]]; then
        log_success "Integrity check passed: $passed/$total files verified"
        return 0
    else
        log_error "Integrity check failed: $failed/$total files corrupted"
        return 1
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

    # Estimate backup size and check disk space
    local estimated_size
    if ! estimated_size=$(estimate_backup_size "$backup_type"); then
        error "Backup cancelled due to insufficient disk space"
        exit 1
    fi

    # Generate backup ID
    local backup_id
    backup_id=$(date +%Y%m%d-%H%M%S)
    local backup_dir="$BACKUP_ROOT/$backup_id"

    log_info "Starting $backup_type backup: $backup_id"
    log_info "Backup directory: $backup_dir"

    # Create backup directory
    mkdir -p "$backup_dir"

    # Create manifest with size estimate
    create_manifest "$backup_dir" "$backup_type" "$description" "$estimated_size"

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

    # Generate integrity checksums
    generate_checksums "$backup_dir"

    # Check for partial failures and warn user
    if [[ -f "$backup_dir/.backup_status" ]]; then
        echo ""
        log_warn "⚠️  Backup completed with some failures"
        log_warn "Review .backup_status file for details"
        if grep -q "partial_failure=true" "$backup_dir/.backup_status"; then
            local failed_count
            failed_count=$(grep "failed_paths=" "$backup_dir/.backup_status" | cut -d= -f2 | wc -w)
            log_warn "Failed to backup $failed_count data directories"
        fi
        if grep -q "config_partial_failure=true" "$backup_dir/.backup_status"; then
            log_warn "Some config files failed to backup"
        fi
        echo ""
    fi

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
    local verify_id=""

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
            -v|--verify)
                verify_id="$2"
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

    # Verify mode
    if [[ -n "$verify_id" ]]; then
        verify_backup_integrity "$verify_id"
        exit $?
    fi

    # Check if running in Dream Server directory
    local has_compose=false
    for f in "$DREAM_DIR"/docker-compose*.y*ml; do
        [[ -f "$f" ]] && has_compose=true && break
    done
    if [[ "$has_compose" == "false" && ! -d "$DREAM_DIR/data" ]]; then
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
