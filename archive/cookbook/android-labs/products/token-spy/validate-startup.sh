#!/bin/bash
# Token Spy Startup Validation Script
# Checks for common configuration issues before starting containers

set -e

echo "=== Token Spy Startup Validation ==="
echo ""

# Check for placeholder POSTGRES_PASSWORD
if grep -q "your_strong_password_here" .env 2>/dev/null || \
   grep -q "CHANGE_ME_TO_A_STRONG_PASSWORD" .env 2>/dev/null || \
   grep -q "^POSTGRES_PASSWORD=$" .env 2>/dev/null; then
    echo "❌ ERROR: POSTGRES_PASSWORD not set or using placeholder!"
    echo "   Please edit .env and set a strong password:"
    echo "   POSTGRES_PASSWORD=your_strong_password_here"
    exit 1
fi

# Check for placeholder DEFAULT_API_KEY (for demo purposes)
if grep -q "^DEFAULT_API_KEY=$" .env 2>/dev/null && \
   grep -q "not-needed" .env 2>/dev/null; then
    echo "⚠️  WARNING: DEFAULT_API_KEY is empty"
    echo "   This is OK for testing, but add your API key for production use."
fi

echo "✅ Validation passed!"
echo ""
echo "To start Token Spy:"
echo "  docker compose up -d"
echo ""
echo "To view logs:"
echo "  docker compose logs -f"
echo ""
