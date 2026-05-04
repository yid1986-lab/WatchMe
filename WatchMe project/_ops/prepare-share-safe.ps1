param(
  [string]$Destination = "WatchMe-project-share-safe",
  [switch]$Force
)

$projectRoot = [System.IO.Path]::GetFullPath($PSScriptRoot)
$parentDir = Split-Path -Parent $projectRoot
$targetPath = if ([System.IO.Path]::IsPathRooted($Destination)) {
  [System.IO.Path]::GetFullPath($Destination)
} else {
  [System.IO.Path]::GetFullPath((Join-Path $parentDir $Destination))
}

if ($targetPath.StartsWith($projectRoot, [System.StringComparison]::OrdinalIgnoreCase)) {
  throw "Choose a destination outside the project folder so the share-safe copy does not include itself."
}

if (Test-Path -LiteralPath $targetPath) {
  if (-not $Force) {
    throw "Destination already exists: $targetPath. Re-run with -Force to replace it."
  }

  Remove-Item -LiteralPath $targetPath -Recurse -Force
}

$excludedDirectories = @(
  ".git",
  ".cache",
  ".config",
  ".local",
  ".tmp-tests",
  ".upm",
  ".venv",
  "__pycache__",
  "attached_assets",
  "build",
  "dist",
  "dist-ssr",
  "env",
  "ENV",
  "node_modules",
  "venv"
)

$excludedFilePatterns = @(
  ".env",
  ".env.*",
  "*.db",
  "*.db-shm",
  "*.db-wal",
  "*.log",
  "billing-store.json",
  "dashboard-store.json",
  "pro-install-store.json"
)

function Test-IsExcludedDirectory([System.IO.FileSystemInfo]$Item) {
  if (-not $Item.PSIsContainer) {
    return $false
  }

  return $excludedDirectories -contains $Item.Name
}

function Test-IsExcludedFile([System.IO.FileSystemInfo]$Item) {
  if ($Item.PSIsContainer) {
    return $false
  }

  foreach ($pattern in $excludedFilePatterns) {
    if ($Item.Name -like $pattern) {
      return $true
    }
  }

  return $false
}

function Copy-SafeTree([string]$SourceDir, [string]$DestinationDir) {
  New-Item -ItemType Directory -Force -Path $DestinationDir | Out-Null

  foreach ($item in Get-ChildItem -LiteralPath $SourceDir -Force) {
    if (Test-IsExcludedDirectory $item) {
      continue
    }

    if (Test-IsExcludedFile $item) {
      continue
    }

    $nextDestination = Join-Path $DestinationDir $item.Name

    if ($item.PSIsContainer) {
      Copy-SafeTree -SourceDir $item.FullName -DestinationDir $nextDestination
      continue
    }

    Copy-Item -LiteralPath $item.FullName -Destination $nextDestination -Force
  }
}

Copy-SafeTree -SourceDir $projectRoot -DestinationDir $targetPath

$readme = @"
This is a share-safe copy of the WatchMe project.

Skipped directories:
 - $($excludedDirectories -join "`n - ")

Skipped file patterns:
 - $($excludedFilePatterns -join "`n - ")

Before sharing:
 - Verify local .env files were excluded.
 - Verify database/runtime data files were excluded.
 - Keep .env.example files updated so the recipient still knows which values are required.
"@

Set-Content -LiteralPath (Join-Path $targetPath "SHARE-SAFE-README.txt") -Value $readme -Encoding utf8

Write-Host "Share-safe copy created at: $targetPath"
