$PreviewSessionToken = $null
if ($args.Count -gt 0) {
    $PreviewSessionToken = $args[0]
}

$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
. (Join-Path $PSScriptRoot "android-env.ps1")

$adb = Join-Path $env:ANDROID_HOME "platform-tools\adb.exe"
$emulator = Join-Path $env:ANDROID_HOME "emulator\emulator.exe"
$avdName = "WatchMe_Pixel_8_API_34"

Push-Location $root
try {
    .\gradlew.bat assembleDebug

    $running = & $adb devices | Select-String -Pattern "^emulator-\d+\s+device$" | Select-Object -First 1
    if (-not $running) {
        Start-Process -FilePath $emulator -ArgumentList @(
            "-avd", $avdName,
            "-no-snapshot",
            "-no-boot-anim",
            "-gpu", "swiftshader_indirect",
            "-no-audio"
        ) | Out-Null
    }

    & $adb wait-for-device
    $booted = $false
    for ($i = 0; $i -lt 120; $i++) {
        $boot = (& $adb shell getprop sys.boot_completed 2>$null).Trim()
        if ($boot -eq "1") {
            $booted = $true
            break
        }
        Start-Sleep -Seconds 5
    }

    if (-not $booted) {
        throw "Emulator did not finish booting within the timeout."
    }

    & $adb install -r "app\build\outputs\apk\debug\app-debug.apk"

    $startArgs = @(
        "shell",
        "am",
        "start",
        "-S",
        "-n",
        "com.watchme.app/.MainActivity"
    )
    if ($PreviewSessionToken) {
        $startArgs += @("--es", "preview_session_token", $PreviewSessionToken)
    }
    & $adb @startArgs
} finally {
    Pop-Location
}
