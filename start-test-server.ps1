[CmdletBinding()]
param([switch]$WithVoice)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$Python = Join-Path $Root ".venv\Scripts\python.exe"
if (-not (Test-Path -LiteralPath $Python)) { throw "Lancez d'abord .\install.ps1" }

$processes = @()
$processes += Start-Process -FilePath $Python -ArgumentList "run.py", "web" -WorkingDirectory $Root -WindowStyle Hidden -PassThru
$processes += Start-Process -FilePath $Python -ArgumentList "run.py", "core" -WorkingDirectory $Root -WindowStyle Hidden -PassThru
if ($WithVoice) { $processes += Start-Process -FilePath $Python -ArgumentList "run.py", "voice" -WorkingDirectory $Root -WindowStyle Hidden -PassThru }

$pidFile = Join-Path $Root "var\services.pid.json"
New-Item -ItemType Directory -Path (Split-Path $pidFile) -Force | Out-Null
$processes | Select-Object Id, ProcessName, StartTime | ConvertTo-Json | Set-Content -LiteralPath $pidFile -Encoding UTF8
Write-Host "KingdomEngine démarré. Studio : http://127.0.0.1:8000" -ForegroundColor Green
Write-Host "Pour arrêter : .\stop-test-server.ps1"
