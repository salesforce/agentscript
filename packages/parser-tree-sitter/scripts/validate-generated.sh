#!/usr/bin/env bash
set -euo pipefail

# Validate that the committed tree-sitter generated files were produced by the
# pinned tree-sitter CLI and match what `tree-sitter generate` emits today.
#
# `tree-sitter generate` writes src/parser.c, src/grammar.json,
# src/node-types.json and src/tree_sitter/*.h. The helper headers
# (array.h, alloc.h, parser.h) are copied from the CLI itself, so a different CLI
# version silently rewrites them even when grammar.js is untouched. We pin the
# CLI because the production runtime image is not compatible with 0.26+.
#
# The single source of truth for the pin is the repo-root mise.toml. Three checks:
#   1. The CLI on PATH must be exactly that version (blocks other versions).
#   2. Regenerating from grammar.js with that CLI, in a throwaway copy, must
#      reproduce the committed generated files byte-for-byte. Any diff means a
#      generated file was hand-edited, grammar.js changed without regenerating,
#      or the output was generated with another CLI version and committed.
#   3. The other places that spell out the version (CI workflow, CI setup
#      script, docs build script) must equal the pin, so they cannot drift.
#
# It does NOT check that the compiled parser (WASM / native addon) is up to
# date; those are build artifacts, not committed sources.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PKG_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
REPO_ROOT="$(cd "${PKG_DIR}/../.." && pwd)"
MISE_FILE="${REPO_ROOT}/mise.toml"

# Generated files that `tree-sitter generate` writes, relative to the package.
GENERATED_PATHS=(src/parser.c src/grammar.json src/node-types.json src/tree_sitter)

if [[ ! -f "${MISE_FILE}" ]]; then
  echo "ERROR: ${MISE_FILE} not found — cannot read the pinned tree-sitter version."
  exit 1
fi

EXPECTED="$(sed -n "s/^tree-sitter[[:space:]]*=[[:space:]]*[\"']\([^\"']*\)[\"'].*\$/\1/p" "${MISE_FILE}")"
if [[ ! "${EXPECTED}" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo "ERROR: mise.toml must pin tree-sitter to an exact x.y.z version (found: '${EXPECTED}')."
  exit 1
fi

# Gate 1: the CLI on PATH must be the pinned version.
if ! command -v tree-sitter >/dev/null 2>&1; then
  ACTUAL="(not installed)"
else
  ACTUAL="$(tree-sitter --version | awk '{print $2}')"
fi
if [[ "${ACTUAL}" != "${EXPECTED}" ]]; then
  cat <<EOF

❌ tree-sitter CLI version mismatch: expected ${EXPECTED}, found ${ACTUAL}.

Generated parser files must be produced by exactly ${EXPECTED} (pinned in
mise.toml). Other versions rewrite src/tree_sitter/*.h and parser.c, and 0.26+
is not compatible with the production runtime image.

To fix, install the pinned CLI and re-run:
  mise install
  # or: cargo install tree-sitter-cli@${EXPECTED} --locked
EOF
  exit 1
fi
echo "==> OK: tree-sitter CLI is ${EXPECTED}"

# Gate 2: regenerate in a throwaway copy so the work tree is never touched.
TMP_ROOT="$(mktemp -d)"
trap 'rm -rf "${TMP_ROOT}"' EXIT

mkdir "${TMP_ROOT}/pkg"
cp -R "${PKG_DIR}/grammar.js" "${PKG_DIR}/tree-sitter.json" "${PKG_DIR}/package.json" \
  "${PKG_DIR}/src" "${TMP_ROOT}/pkg/"
(cd "${TMP_ROOT}/pkg" && tree-sitter generate >/dev/null)

echo "==> Validating committed generated files against a fresh \`tree-sitter generate\`"
FAILED=0
for path in "${GENERATED_PATHS[@]}"; do
  if ! diff -ru "${PKG_DIR}/${path}" "${TMP_ROOT}/pkg/${path}" >"${TMP_ROOT}/diff.txt"; then
    FAILED=1
    CHANGED="$(grep -c '^[+-][^+-]' "${TMP_ROOT}/diff.txt" || true)"
    echo "--- ${path}: differs (${CHANGED} changed line(s))"
    head -n 40 "${TMP_ROOT}/diff.txt"
  fi
done

if [[ "${FAILED}" -ne 0 ]]; then
  cat <<EOF

❌ Committed generated files do NOT match \`tree-sitter generate\` (CLI ${EXPECTED}).

The diffs above are between what's checked in (left) and a fresh generation
(right).

Likely causes:
  - grammar.js changed but the generated files were not regenerated,
  - a generated file was hand-edited, or
  - the files were generated with a different tree-sitter CLI version.

To fix, regenerate with the pinned CLI and commit the result:
  cd packages/parser-tree-sitter && tree-sitter generate
EOF
  exit 1
fi
echo "==> OK: committed generated files match tree-sitter ${EXPECTED}"

# Check 3: other places that spell out the version must equal the pin. Files
# that are not present in this checkout (e.g. internal-only scripts) are skipped.
check_pin() {
  local file="$1" pattern="$2" found
  [[ -f "${REPO_ROOT}/${file}" ]] || return 0
  found="$(sed -n "${pattern}" "${REPO_ROOT}/${file}" | head -n 1)"
  if [[ "${found}" != "${EXPECTED}" ]]; then
    echo "❌ ${file} pins tree-sitter '${found:-<none found>}', but mise.toml pins ${EXPECTED}."
    echo "   Update it to ${EXPECTED} so all pins stay in sync."
    return 1
  fi
}
PINS_OK=0
check_pin .github/workflows/ci.yml "s/^[[:space:]]*TREE_SITTER_VERSION:[[:space:]]*['\"]\{0,1\}\([0-9.]*\).*/\1/p" || PINS_OK=1
check_pin scripts/ci-setup.sh 's/^TREE_SITTER_VERSION="${TREE_SITTER_VERSION:-\([0-9.]*\)}"/\1/p' || PINS_OK=1
check_pin scripts/strata-docs-build.sh 's/.*tree-sitter-cli@\([0-9][0-9.]*\).*/\1/p' || PINS_OK=1
if [[ "${PINS_OK}" -ne 0 ]]; then
  exit 1
fi
echo "==> OK: all tree-sitter version pins agree (${EXPECTED})"
