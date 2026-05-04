param(
  [string]$Root = (Get-Location).Path,
  [switch]$FailOnFindings
)

$ErrorActionPreference = "Stop"

$rootPath = (Resolve-Path -LiteralPath $Root).Path

$dirNames = @(
  "node_modules",
  ".cache",
  ".local",
  ".tmp-tests",
  "attached_assets",
  "build",
  "dist",
  "dist-ssr"
)

$fileNames = @(
  ".env",
  "billing-store.json",
  "dashboard-store.json",
  "pro-install-store.json"
)

$filePatterns = @(
  ".env.*",
  "*.db",
  "*.db-shm",
  "*.db-wal",
  "*.log"
)

$findings = New-Object System.Collections.Generic.List[string]

function Scan-Directory([string]$Path) {
  Get-ChildItem -LiteralPath $Path -Force | ForEach-Object {
    $fullPath = $_.FullName
    $name = $_.Name

    if ($_.PSIsContainer) {
      if ($dirNames -contains $name) {
        $findings.Add($fullPath)
        return
      }

      Scan-Directory $fullPath
      return
    }

    if ($fileNames -contains $name) {
      $findings.Add($fullPath)
      return
    }

    if ($name -eq ".env.example" -or $name -like ".env.*.example") {
      return
    }

    foreach ($pattern in $filePatterns) {
      if ($name -like $pattern) {
        $findings.Add($fullPath)
        break
      }
    }
  }
}

Scan-Directory $rootPath

$findings = $findings | Sort-Object -Unique

if (-not $findings -or $findings.Count -eq 0) {
  Write-Host "Share safety check passed. No blocked secret/local-state patterns were found under $rootPath"
  exit 0
}

Write-Host "Share safety check found files or directories that should not be shared:"
$findings | ForEach-Object { Write-Host " - $_" }

if ($FailOnFindings) {
  exit 1
}
