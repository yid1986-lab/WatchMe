$ErrorActionPreference = "Stop"

$javaHomes = Get-ChildItem "C:\Program Files\Microsoft" -Directory -Filter "jdk-17*" -ErrorAction SilentlyContinue |
    Sort-Object Name -Descending

if (-not $javaHomes) {
    throw "Java 17 was not found under C:\Program Files\Microsoft. Install Microsoft.OpenJDK.17 first."
}

$sdkRoot = Join-Path $env:LOCALAPPDATA "Android\Sdk"
if (-not (Test-Path $sdkRoot)) {
    throw "Android SDK was not found at $sdkRoot."
}

$env:JAVA_HOME = $javaHomes[0].FullName
$env:ANDROID_HOME = $sdkRoot
$env:ANDROID_SDK_ROOT = $sdkRoot

$toolPaths = @(
    (Join-Path $env:JAVA_HOME "bin"),
    (Join-Path $sdkRoot "cmdline-tools\latest\bin"),
    (Join-Path $sdkRoot "platform-tools"),
    (Join-Path $sdkRoot "emulator")
)

$env:Path = ($toolPaths -join ";") + ";$env:Path"
