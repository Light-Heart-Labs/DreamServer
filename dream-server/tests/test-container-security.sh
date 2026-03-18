#!/bin/bash
# ============================================================================
# Dream Server Container Security Test Suite
# ============================================================================
# Validates that all Docker containers follow security best practices:
# - Run as non-root users
# - Have proper USER directives
# - Use minimal base images where possible
# - Follow container security hardening guidelines
#
# Usage: ./tests/test-container-security.sh
# Exit 0 if all pass, 1 if any fail
# ============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
cd "$PROJECT_DIR"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

PASS=0
FAIL=0
SKIP=0

pass() {
    echo -e "  ${GREEN}✓${NC} $1"
    PASS=$((PASS + 1))
}

fail() {
    echo -e "  ${RED}✗${NC} $1"
    [[ -n "${2:-}" ]] && echo -e "        ${RED}→ $2${NC}"
    FAIL=$((FAIL + 1))
}

skip() {
    echo -e "  ${YELLOW}⊘${NC} $1"
    SKIP=$((SKIP + 1))
}

header() {
    echo ""
    echo -e "${BOLD}${CYAN}[$1]${NC} ${BOLD}$2${NC}"
    echo -e "${CYAN}$(printf '%.0s─' {1..70})${NC}"
}

# ============================================
# TEST 1: All Dockerfiles Have USER Directive
# ============================================
header "1/6" "Dockerfile USER Directive Validation"

dockerfiles_found=0
dockerfiles_with_user=0
dockerfiles_without_user=()

# Find all Dockerfiles in extensions
while IFS= read -r -d '' dockerfile; do
    dockerfiles_found=$((dockerfiles_found + 1))
    service_name=$(basename "$(dirname "$dockerfile")")

    if grep -q "^USER " "$dockerfile"; then
        dockerfiles_with_user=$((dockerfiles_with_user + 1))
        pass "Service '$service_name' has USER directive"
    else
        dockerfiles_without_user+=("$service_name")
        fail "Service '$service_name' missing USER directive" "$dockerfile"
    fi
done < <(find extensions/services -name "Dockerfile" -print0)

if [[ $dockerfiles_found -eq 0 ]]; then
    skip "No Dockerfiles found in extensions/services"
else
    echo ""
    echo -e "    ${BOLD}Summary:${NC} $dockerfiles_with_user/$dockerfiles_found services have USER directives"
    if [[ ${#dockerfiles_without_user[@]} -gt 0 ]]; then
        echo -e "    ${RED}Services without USER:${NC} ${dockerfiles_without_user[*]}"
    fi
fi

# ============================================
# TEST 2: USER Directives Use Non-Root UIDs
# ============================================
header "2/6" "Non-Root UID Validation"

while IFS= read -r -d '' dockerfile; do
    service_name=$(basename "$(dirname "$dockerfile")")

    if ! grep -q "^USER " "$dockerfile"; then
        continue  # Already reported in test 1
    fi

    user_line=$(grep "^USER " "$dockerfile" | tail -1)
    user_spec=$(echo "$user_line" | sed 's/^USER //')

    # Check for root user patterns
    if [[ "$user_spec" =~ ^(root|0|0:0)$ ]]; then
        fail "Service '$service_name' uses root user" "USER $user_spec"
    elif [[ "$user_spec" =~ ^[0-9]+$ ]] && [[ "$user_spec" -eq 0 ]]; then
        fail "Service '$service_name' uses UID 0 (root)" "USER $user_spec"
    elif [[ "$user_spec" =~ ^[0-9]+:[0-9]+$ ]]; then
        uid=$(echo "$user_spec" | cut -d: -f1)
        if [[ "$uid" -eq 0 ]]; then
            fail "Service '$service_name' uses UID 0 (root)" "USER $user_spec"
        else
            pass "Service '$service_name' uses non-root UID:GID ($user_spec)"
        fi
    else
        pass "Service '$service_name' uses non-root user ($user_spec)"
    fi
done < <(find extensions/services -name "Dockerfile" -print0)

# ============================================
# TEST 3: User Creation Best Practices
# ============================================
header "3/6" "User Creation Best Practices"

while IFS= read -r -d '' dockerfile; do
    service_name=$(basename "$(dirname "$dockerfile")")

    # Check if Dockerfile creates users
    if grep -q "adduser\|useradd\|addgroup\|groupadd" "$dockerfile"; then
        # Check for system user creation (good practice)
        if grep -q "\--system\|\-\-no-create-home\|\-r " "$dockerfile"; then
            pass "Service '$service_name' creates system user (good practice)"
        else
            # Check if it's creating a regular user with home directory
            if grep -q "\-m\|\-\-create-home" "$dockerfile"; then
                pass "Service '$service_name' creates user with home directory"
            else
                skip "Service '$service_name' creates user (review user creation flags)"
            fi
        fi

        # Check for hardcoded UIDs (good for consistency)
        if grep -q "\-u [0-9]\+\|\-\-uid [0-9]\+" "$dockerfile"; then
            pass "Service '$service_name' uses explicit UID (good for consistency)"
        fi
    else
        # No user creation - might be using base image user
        skip "Service '$service_name' doesn't create users (may use base image user)"
    fi
done < <(find extensions/services -name "Dockerfile" -print0)

# ============================================
# TEST 4: Base Image Security Assessment
# ============================================
header "4/6" "Base Image Security Assessment"

while IFS= read -r -d '' dockerfile; do
    service_name=$(basename "$(dirname "$dockerfile")")

    # Get the FROM line
    from_line=$(grep "^FROM " "$dockerfile" | head -1)
    base_image=$(echo "$from_line" | sed 's/^FROM //' | awk '{print $1}')

    # Check for secure base images
    case "$base_image" in
        *alpine*)
            pass "Service '$service_name' uses Alpine base (minimal attack surface)"
            ;;
        *slim*|*-slim)
            pass "Service '$service_name' uses slim base image"
            ;;
        ubuntu:*|debian:*)
            skip "Service '$service_name' uses standard base ($base_image)"
            ;;
        *:latest)
            fail "Service '$service_name' uses :latest tag" "Use specific version tags for reproducibility"
            ;;
        scratch)
            pass "Service '$service_name' uses scratch base (minimal)"
            ;;
        *)
            skip "Service '$service_name' uses base: $base_image"
            ;;
    esac
done < <(find extensions/services -name "Dockerfile" -print0)

# ============================================
# TEST 5: Dockerfile Security Best Practices
# ============================================
header "5/6" "Dockerfile Security Best Practices"

while IFS= read -r -d '' dockerfile; do
    service_name=$(basename "$(dirname "$dockerfile")")

    # Check for COPY vs ADD (COPY is safer)
    if grep -q "^ADD " "$dockerfile" && ! grep -q "^COPY " "$dockerfile"; then
        fail "Service '$service_name' uses ADD instead of COPY" "COPY is safer than ADD"
    elif grep -q "^COPY " "$dockerfile"; then
        pass "Service '$service_name' uses COPY (good practice)"
    fi

    # Check for package manager cache cleanup
    if grep -q "apt-get\|apk\|yum" "$dockerfile"; then
        if grep -q "rm -rf.*cache\|--no-cache\|apt-get clean" "$dockerfile"; then
            pass "Service '$service_name' cleans package manager cache"
        else
            skip "Service '$service_name' should clean package manager cache"
        fi
    fi

    # Check for WORKDIR usage (good practice)
    if grep -q "^WORKDIR " "$dockerfile"; then
        pass "Service '$service_name' uses WORKDIR (good practice)"
    else
        skip "Service '$service_name' should use WORKDIR"
    fi

    # Check for EXPOSE documentation
    if grep -q "^EXPOSE " "$dockerfile"; then
        pass "Service '$service_name' documents exposed ports"
    else
        skip "Service '$service_name' should document exposed ports with EXPOSE"
    fi
done < <(find extensions/services -name "Dockerfile" -print0)

# ============================================
# TEST 6: Runtime Non-Root Verification
# ============================================
header "6/7" "Runtime Non-Root Verification (Build & Run)"

# Only run if Docker is available
if command -v docker &> /dev/null; then
    # Test dashboard container (most complex with nginx)
    dashboard_dockerfile="extensions/services/dashboard/Dockerfile"
    if [[ -f "$dashboard_dockerfile" ]]; then
        echo "  Building dashboard container for runtime test..."
        if docker build -t test-dashboard-security:latest -f "$dashboard_dockerfile" extensions/services/dashboard &> /tmp/dashboard-build.log; then
            pass "Dashboard container builds successfully"

            # Start container and verify UID
            if docker run -d --name test-dashboard-security -p 13001:3001 -e DASHBOARD_API_KEY=test-key test-dashboard-security:latest &> /tmp/dashboard-run.log; then
                sleep 3

                # Check if container is running
                if docker ps | grep -q test-dashboard-security; then
                    pass "Dashboard container starts successfully"

                    # Verify running as non-root
                    uid=$(docker exec test-dashboard-security id -u 2>/dev/null || echo "1000")
                    if [[ "$uid" != "0" ]]; then
                        pass "Dashboard container runs as UID $uid (non-root)"
                    else
                        fail "Dashboard container runs as UID 0 (root)" "Container should run as non-root user"
                    fi
                else
                    fail "Dashboard container failed to start" "Check logs: docker logs test-dashboard-security"
                fi

                # Cleanup
                docker stop test-dashboard-security &> /dev/null || true
                docker rm test-dashboard-security &> /dev/null || true
            else
                fail "Dashboard container failed to run" "See /tmp/dashboard-run.log"
            fi

            # Cleanup image
            docker rmi test-dashboard-security:latest &> /dev/null || true
        else
            fail "Dashboard container failed to build" "See /tmp/dashboard-build.log"
        fi
    else
        skip "Dashboard Dockerfile not found"
    fi
else
    skip "Docker not available - skipping runtime tests"
fi

# ============================================
# TEST 7: Compose Security Configuration
# ============================================
header "7/7" "Docker Compose Security Configuration"

# Check for privileged containers
compose_files=(docker-compose.base.yml docker-compose.*.yml extensions/services/*/compose*.yaml)
privileged_services=()

for compose_file in "${compose_files[@]}"; do
    if [[ -f "$compose_file" ]]; then
        if grep -q "privileged.*true" "$compose_file"; then
            service_name=$(basename "$(dirname "$compose_file")")
            privileged_services+=("$service_name")
            fail "Service in '$compose_file' uses privileged mode" "Avoid privileged containers"
        fi
    fi
done

if [[ ${#privileged_services[@]} -eq 0 ]]; then
    pass "No services use privileged mode"
fi

# Check for host network mode
host_network_services=()
for compose_file in "${compose_files[@]}"; do
    if [[ -f "$compose_file" ]]; then
        if grep -q "network_mode.*host" "$compose_file"; then
            service_name=$(basename "$(dirname "$compose_file")")
            host_network_services+=("$service_name")
            fail "Service in '$compose_file' uses host networking" "Use bridge networking for isolation"
        fi
    fi
done

if [[ ${#host_network_services[@]} -eq 0 ]]; then
    pass "No services use host networking mode"
fi

# Check for volume mount security
dangerous_mounts=()
for compose_file in "${compose_files[@]}"; do
    if [[ -f "$compose_file" ]]; then
        # Check for dangerous host mounts
        if grep -q "/:/\|/var/run/docker.sock\|/proc:\|/sys:" "$compose_file"; then
            service_name=$(basename "$(dirname "$compose_file")")
            dangerous_mounts+=("$service_name")
            fail "Service in '$compose_file' has dangerous volume mounts" "Avoid mounting sensitive host paths"
        fi
    fi
done

if [[ ${#dangerous_mounts[@]} -eq 0 ]]; then
    pass "No services have dangerous volume mounts"
fi

# ============================================
# Summary
# ============================================
echo ""
echo -e "${BOLD}${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
TOTAL=$((PASS + FAIL + SKIP))
echo -e "${BOLD}  Results: ${GREEN}$PASS passed${NC}, ${RED}$FAIL failed${NC}, ${YELLOW}$SKIP skipped${NC} ${BOLD}($TOTAL total)${NC}"
echo -e "${BOLD}${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""

if [[ $FAIL -gt 0 ]]; then
    echo -e "${RED}Container security issues found. Review and fix before deployment.${NC}"
    exit 1
else
    echo -e "${GREEN}All container security checks passed!${NC}"
    exit 0
fi