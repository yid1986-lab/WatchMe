$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
. (Join-Path $PSScriptRoot "android-env.ps1")

Push-Location $root
try {
    .\gradlew.bat assembleDebug testDebugUnitTest lintDebug
} finally {
    Pop-Location
}
