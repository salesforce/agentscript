#!/usr/bin/env bash
# Build linux-x64 prebuilds using Docker (required for CI).
# Run: pnpm run prebuild:linux-x64
# Requires Docker. Produces packages/parser-tree-sitter/prebuilds/linux-x64/
# Commit the new prebuilds/linux-x64/ folder after running.

set -e
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
cd "$REPO_ROOT"

echo "Building linux-x64 prebuilds in Docker..."
docker run --rm --platform linux/amd64 \
  -e CI=true \
  -v "$REPO_ROOT:/build" \
  -w /build \
  node:22 \
  bash -c '
    set -e
    npm install -g pnpm@10.28.0 >/dev/null 2>&1
    # Install tree-sitter CLI (required by "generate" step in prebuild).
    curl -fsSL -o /tmp/tree-sitter.gz \
      "https://github.com/tree-sitter/tree-sitter/releases/download/v0.25.10/tree-sitter-linux-x64.gz"
    gunzip -c /tmp/tree-sitter.gz > /usr/local/bin/tree-sitter
    chmod +x /usr/local/bin/tree-sitter
    cd /build
    pnpm install --frozen-lockfile=false
    cd /build/packages/parser-tree-sitter && pnpm run prebuild
  '

echo ""
echo "Done. Prebuilds at packages/parser-tree-sitter/prebuilds/linux-x64/"
ls -la packages/parser-tree-sitter/prebuilds/linux-x64/
