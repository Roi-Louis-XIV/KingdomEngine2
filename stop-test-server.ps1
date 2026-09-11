$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$pidFile = Join-Path $Root "var\services.pid.json"

function Stop-KingdomProcessTree([int]$processId) {
    $children = Get-CimInstance Win32_Process -Filter "ParentProcessId=$processId" -ErrorAction SilentlyContinue
    foreach ($child in @($children)) { Stop-KingdomProcessTree ([int]$child.ProcessId) }
    $process = Get-Process -Id $processId -ErrorAction SilentlyContinue
    if ($process -and ($process.ProcessName -like "python*" -or $process.ProcessName -eq "ffmpeg")) {
        Stop-Process -Id $processId -Force -ErrorAction SilentlyContinue
    }
}

$runtimePidFiles = @(
    (Join-Path $Root "var\core.pid"),
    (Join-Path $Root "var\voice.pid")
)
foreach ($runtimePidFile in $runtimePidFiles) {
    if (Test-Path -LiteralPath $runtimePidFile) {
        $runtimePid = Get-Content -LiteralPath $runtimePidFile -Raw
        if ($runtimePid -match '^\s*\d+\s*$') { Stop-KingdomProcessTree ([int]$runtimePid) }
        Remove-Item -LiteralPath $runtimePidFile -Force -ErrorAction SilentlyContinue
    }
}

if (Test-Path -LiteralPath $pidFile) {
    $entries = Get-Content -LiteralPath $pidFile -Raw | ConvertFrom-Json
    foreach ($entry in @($entries)) {
        Stop-KingdomProcessTree ([int]$entry.Id)
    }
    Remove-Item -LiteralPath $pidFile
}
Write-Host "Services KingdomEngine arrêtés."
