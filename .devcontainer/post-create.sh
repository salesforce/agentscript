#!/bin/bash
# Copyright (c) 2026, Salesforce, Inc.
# All rights reserved.
# SPDX-License-Identifier: Apache-2.0
# For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0

set -e

echo "AgentScript DevContainer Post-Create Setup"
echo "=============================================="
echo ""

# Colors for output
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Install Node.js dependencies
echo -e "${BLUE}Installing Node.js dependencies...${NC}"
COREPACK_ENABLE_DOWNLOAD_PROMPT=0 pnpm install

# Initialize Husky git hooks
echo -e "${BLUE}Setting up Git hooks with Husky...${NC}"
pnpm run prepare || echo -e "${YELLOW}Husky setup skipped (git may not be initialized)${NC}"

# Ensure hooks are executable
if [ -d ".husky" ]; then
    chmod +x .husky/*
fi

# Install Python packages directly (no venv needed in container)
echo -e "${BLUE}Installing Python packages...${NC}"
cd packages/parser-tree-sitter
pip3 install --break-system-packages -e . || echo -e "${YELLOW}Python package installation skipped${NC}"
cd ../..

# Build tree-sitter parser (if grammar exists)
echo -e "${BLUE}Checking tree-sitter grammar...${NC}"
if [ -f "packages/parser-tree-sitter/grammar.js" ]; then
    cd packages/parser-tree-sitter
    tree-sitter generate || echo -e "${YELLOW}Grammar not ready yet${NC}"
    cd ../..
else
    echo -e "${YELLOW}grammar.js not found - skipping tree-sitter generation${NC}"
fi

# Build all packages
echo -e "${BLUE}Building packages...${NC}"
pnpm run build || echo -e "${YELLOW}Some packages may not be ready to build yet${NC}"

# Make CI scripts executable
echo -e "${BLUE}Making scripts executable...${NC}"
chmod +x ci/*.sh 2>/dev/null || true

echo ""
echo -e "${GREEN}DevContainer setup complete!${NC}"
echo ""
echo "Quick Start:"
echo "  pnpm test                 # Run all tests"
echo "  pnpm ui:dev               # Start development UI mode"
echo "  pnpm run validate-plugins # Validate dialect structure"
echo ""
