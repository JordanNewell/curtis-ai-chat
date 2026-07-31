# Sync freshly-built Curtis AI Chat plugin files into the demo vault.
# Run after `npm run build` from the repo root.
# Idempotent — safe to re-run.

$ErrorActionPreference = "Stop"

$RepoRoot = Split-Path -Parent $PSScriptRoot
$PluginDest = Join-Path $RepoRoot "demo-vault\.obsidian\plugins\curtis-ai-chat"

$Required = @(
  (Join-Path $RepoRoot "main.js"),
  (Join-Path $RepoRoot "manifest.json"),
  (Join-Path $RepoRoot "styles.css")
)

Write-Host "==> Checking build artifacts..."
foreach ($f in $Required) {
  if (-not (Test-Path $f)) {
    Write-Host "ERROR: $f not found. Run 'npm run build' first." -ForegroundColor Red
    exit 1
  }
}

Write-Host "==> Ensuring demo vault plugin dir exists..."
New-Item -ItemType Directory -Force -Path $PluginDest | Out-Null

Write-Host "==> Copying plugin into demo vault..."
foreach ($f in $Required) {
  Copy-Item -Path $f -Destination $PluginDest -Force
  Write-Host "  copied $(Split-Path -Leaf $f)"
}

$SourceMap = Join-Path $RepoRoot "main.js.map"
if (Test-Path $SourceMap) {
  Copy-Item -Path $SourceMap -Destination $PluginDest -Force
  Write-Host "  copied main.js.map"
}

Write-Host ""
Write-Host "==> Done." -ForegroundColor Green
Write-Host ""
Write-Host "Next: open the demo-vault folder in Obsidian."
Write-Host "If already open: Ctrl+P -> 'Reload app without saving' to pick up changes."
