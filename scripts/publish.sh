#!/usr/bin/env bash
# Publish dna packages to npm in dependency order.
#
# Usage:
#   scripts/publish.sh            # full publish
#   scripts/publish.sh --dry-run  # no upload, just resolve the would-publish tarball
#
# pnpm rewrites `workspace:*` deps to the package's current version on publish,
# so the order below matters: deps published first, dependents second.

set -euo pipefail
cd "$(dirname "$0")/.."

DRY=""
if [[ "${1:-}" == "--dry-run" ]]; then
  DRY="--dry-run"
fi

echo "==> building all packages"
pnpm -r build

PKGS=(
  "@invariance/dna-schemas"
  "@invariance/dna-core"
  "@invariance/dna-llm"
  "@invariance/dna-mcp"
  "@invariance/dna"
)

for pkg in "${PKGS[@]}"; do
  echo ""
  echo "==> publishing $pkg $DRY"
  pnpm -F "$pkg" publish --access public --no-git-checks $DRY
done

echo ""
echo "done. install with: npx @invariance/dna wizard"
