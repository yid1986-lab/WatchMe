# Run guild + creator count report (WatchMe V2 Postgres only).
# Usage: from repo root in PowerShell:
#   .\scripts\run-guild-creator-report.ps1
#
# Reads DATABASE_URL from .env in the repo root if present, unless already set in the shell.

$ErrorActionPreference = "Stop"
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = Split-Path -Parent $scriptDir

Set-Location $repoRoot

if (-not $env:DATABASE_URL) {
  $envFile = Join-Path $repoRoot ".env"
  if (Test-Path $envFile) {
    Get-Content $envFile -Encoding UTF8 | ForEach-Object {
      $line = $_.Trim()
      if ($line -match "^\s*#" -or $line -eq "") { return }
      if ($line -match "^DATABASE_URL\s*=\s*(.*)$") {
        $val = $matches[1].Trim()
        if (
          ($val.StartsWith('"') -and $val.EndsWith('"')) -or
          ($val.StartsWith("'") -and $val.EndsWith("'"))
        ) {
          $val = $val.Substring(1, $val.Length - 2)
        }
        $env:DATABASE_URL = $val
      }
    }
  }
}

if (-not $env:DATABASE_URL) {
  Write-Host "DATABASE_URL is not set." -ForegroundColor Red
  Write-Host ""
  Write-Host "Fix one of these:" -ForegroundColor Yellow
  Write-Host "  1. Create $repoRoot\.env with a line: DATABASE_URL=postgres://user:pass@host:5432/watchme_v2"
  Write-Host '  2. Or in this shell: $env:DATABASE_URL = "postgres://..."'
  Write-Host ""
  exit 1
}

$pgMod = Join-Path $repoRoot "node_modules\pg\package.json"
if (-not (Test-Path $pgMod)) {
  Write-Host "Dependencies missing (no node_modules\pg)." -ForegroundColor Red
  Write-Host "From this folder run: npm install" -ForegroundColor Yellow
  Write-Host "  cd `"$repoRoot`""
  exit 1
}

$nodeCmd = Get-Command node -ErrorAction SilentlyContinue
if (-not $nodeCmd) {
  Write-Host "node is not on PATH. Install Node.js LTS and reopen PowerShell." -ForegroundColor Red
  exit 1
}

$js = Join-Path $scriptDir "guild-creator-report.js"
& node $js
exit $LASTEXITCODE
