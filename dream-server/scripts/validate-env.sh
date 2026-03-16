#!/bin/bash
# Validate .env against .env.schema.json

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
INSTALL_DIR="${INSTALL_DIR:-$(dirname "$SCRIPT_DIR")}"

usage() {
    echo "Usage: $0 [ENV_FILE] [SCHEMA_FILE]"
    echo "       $0 --help"
    echo ""
    echo "Validates .env against a JSON schema (required keys, types, unknown keys)."
    echo ""
    echo "Arguments:"
    echo "  ENV_FILE     Path to .env (default: INSTALL_DIR/.env)"
    echo "  SCHEMA_FILE  Path to .env.schema.json (default: INSTALL_DIR/.env.schema.json)"
    echo ""
    echo "Exit codes: 0 = valid, 1 = missing file / jq, 2 = validation failed"
    echo "Requires: jq"
}
case "${1:-}" in
    -h|--help) usage; exit 0 ;;
esac

ENV_FILE="${1:-${INSTALL_DIR}/.env}"
SCHEMA_FILE="${2:-${INSTALL_DIR}/.env.schema.json}"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

log_info() { echo -e "${BLUE}[INFO]${NC} $1"; }
log_success() { echo -e "${GREEN}[SUCCESS]${NC} $1"; }
log_warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
log_error() { echo -e "${RED}[ERROR]${NC} $1"; }

if [[ ! -f "$ENV_FILE" ]]; then
    log_error "Env file not found: $ENV_FILE"
    exit 1
fi

if [[ ! -f "$SCHEMA_FILE" ]]; then
    log_error "Schema file not found: $SCHEMA_FILE"
    exit 1
fi

if ! command -v jq >/dev/null 2>&1; then
    log_error "jq is required for schema validation (sudo apt install jq)"
    exit 1
fi

declare -A ENV_MAP
while IFS= read -r line; do
    [[ -z "$line" || "$line" =~ ^[[:space:]]*# ]] && continue
    if [[ "$line" =~ ^([A-Za-z_][A-Za-z0-9_]*)=(.*)$ ]]; then
        key="${BASH_REMATCH[1]}"
        value="${BASH_REMATCH[2]}"
        ENV_MAP["$key"]="$value"
    fi
done < "$ENV_FILE"

missing=()
unknown=()
type_errors=()

mapfile -t required_keys < <(jq -r '.required[]?' "$SCHEMA_FILE")
for key in "${required_keys[@]}"; do
    val="${ENV_MAP[$key]-}"
    if [[ -z "$val" ]]; then
        missing+=("$key")
    fi
done

mapfile -t schema_keys < <(jq -r '.properties | keys[]' "$SCHEMA_FILE")
declare -A SCHEMA_KEY_SET
for key in "${schema_keys[@]}"; do
    SCHEMA_KEY_SET["$key"]=1
done

for key in "${!ENV_MAP[@]}"; do
    if [[ -z "${SCHEMA_KEY_SET[$key]-}" ]]; then
        unknown+=("$key")
    fi
done

for key in "${schema_keys[@]}"; do
    val="${ENV_MAP[$key]-}"
    [[ -z "$val" ]] && continue

    expected_type="$(jq -r --arg k "$key" '.properties[$k].type // "string"' "$SCHEMA_FILE")"
    case "$expected_type" in
        integer)
            if [[ ! "$val" =~ ^-?[0-9]+$ ]]; then
                type_errors+=("$key (expected integer, got '$val')")
            fi
            ;;
        number)
            if [[ ! "$val" =~ ^-?[0-9]+([.][0-9]+)?$ ]]; then
                type_errors+=("$key (expected number, got '$val')")
            fi
            ;;
        boolean)
            if [[ "$val" != "true" && "$val" != "false" ]]; then
                type_errors+=("$key (expected boolean true/false, got '$val')")
            fi
            ;;
    esac
done

if (( ${#missing[@]} > 0 )); then
    log_error "Missing required keys:"
    for key in "${missing[@]}"; do
        echo "  - $key"
    done
fi

if (( ${#unknown[@]} > 0 )); then
    log_error "Unknown keys not defined in schema:"
    for key in "${unknown[@]}"; do
        echo "  - $key"
    done
fi

if (( ${#type_errors[@]} > 0 )); then
    log_error "Type validation errors:"
    for err in "${type_errors[@]}"; do
        echo "  - $err"
    done
fi

if (( ${#missing[@]} > 0 || ${#unknown[@]} > 0 || ${#type_errors[@]} > 0 )); then
    echo ""
    log_info "Fix .env using .env.example as reference, then re-run:"
    echo "  ./scripts/validate-env.sh"
    exit 2
fi

log_success ".env matches schema: $SCHEMA_FILE"
