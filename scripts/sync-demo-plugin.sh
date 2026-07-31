#!/usr/bin/env bash
# Sync freshly-built Curtis AI Chat plugin files into the demo vault.
# Run after `npm run build` from the repo root.
# Idempotent — safe to re-run.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PLUGIN_DEST="$REPO_ROOT/demo-vault/.obsidian/plugins/curtis-ai-chat"

# Source files (built artifacts from repo root)
declare -a REQUIRED=(
  "$REPO_ROOT/main.js"
  "$REPO_ROOT/manifest.json"
  "$REPO_ROOT/styles.css"
)

echo "==> Checking build artifacts..."
for f in "${REQUIRED[@]}"; do
  if [[ ! -f "$f" ]]; then
    echo "ERROR: $f not found. Run 'npm run build' first."
    exit 1
  fi
done

echo "==> Ensuring demo vault plugin dir exists..."
mkdir -p "$PLUGIN_DEST"

echo "==> Copying plugin into demo vault..."
for f in "${REQUIRED[@]}"; do
  cp -v "$f" "$PLUGIN_DEST/"
done

# Copy source map if present (helpful for stack traces during debugging)
if [[ -f "$REPO_ROOT/main.js.map" ]]; then
  cp -v "$REPO_ROOT/main.js.map" "$PLUGIN_DEST/"
fi

echo "==> Done."
echo ""
echo "Next: open the demo-vault folder in Obsidian."
echo "If already open: Ctrl/Cmd+P → 'Reload app without saving' to pick up changes."
