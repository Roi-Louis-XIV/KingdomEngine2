[CmdletBinding()]
param([switch]$WithVoice)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$Python = Join-Path $Root ".venv\Scripts\python.exe"
if (-not (Test-Path -LiteralPath $Python)) { throw "Lancez d'abord .\install.ps1" }
$env:PYTHONUNBUFFERED = "1"
$Logs = Join-Path $Root "var\logs"
New-Item -ItemType Directory -Path $Logs -Force | Out-Null

$processes = @()
$webProcess = Start-Process -FilePath $Python -ArgumentList "run.py", "web" -WorkingDirectory $Root -WindowStyle Hidden -RedirectStandardOutput (Join-Path $Logs "web.out.log") -RedirectStandardError (Join-Path $Logs "web.err.log") -PassThru
$processes += [pscustomobject]@{ service="web"; Id=$webProcess.Id; ProcessName=$webProcess.ProcessName; StartTime=$webProcess.StartTime }
$coreProcess = Start-Process -FilePath $Python -ArgumentList "run.py", "core" -WorkingDirectory $Root -WindowStyle Hidden -RedirectStandardOutput (Join-Path $Logs "core.out.log") -RedirectStandardError (Join-Path $Logs "core.err.log") -PassThru
$processes += [pscustomobject]@{ service="core"; Id=$coreProcess.Id; ProcessName=$coreProcess.ProcessName; StartTime=$coreProcess.StartTime }
if ($WithVoice) {
    $voiceProcess = Start-Process -FilePath $Python -ArgumentList "run.py", "voice" -WorkingDirectory $Root -WindowStyle Hidden -RedirectStandardOutput (Join-Path $Logs "voice.out.log") -RedirectStandardError (Join-Path $Logs "voice.err.log") -PassThru
    $processes += [pscustomobject]@{ service="voice"; Id=$voiceProcess.Id; ProcessName=$voiceProcess.ProcessName; StartTime=$voiceProcess.StartTime }
}

$pidFile = Join-Path $Root "var\services.pid.json"
New-Item -ItemType Directory -Path (Split-Path $pidFile) -Force | Out-Null
$processes | ConvertTo-Json | Set-Content -LiteralPath $pidFile -Encoding UTF8
Write-Host "KingdomEngine démarré. Studio : http://127.0.0.1:8000" -ForegroundColor Green
Write-Host "Pour arrêter : .\stop-test-server.ps1"
