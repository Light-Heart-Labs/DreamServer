#!/usr/bin/env bash
# Build real llama.cpp images (first run: ~5-10 min), launch rpc workers
# + llama controller, then run integration tests against live endpoints.
#
# Usage:
#   ./run.sh                # full suite
#   ./run.sh test_completion_returns_tokens_across_rpc_workers  # subset
set -euo pipefail

cd "$(dirname "$0")"

COMPOSE="docker compose -f docker-compose.integration.yml"

cleanup() {
    $COMPOSE down --remove-orphans --volumes 2>/dev/null || true
}
trap cleanup EXIT

$COMPOSE build
$COMPOSE up -d rpc1 rpc2 llama
$COMPOSE run --rm test-runner /app/run-tests.sh "$@"
rc=$?

cleanup
trap - EXIT
exit $rc
