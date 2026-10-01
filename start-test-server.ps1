[CmdletBinding()]
param(
    [switch]$WithoutVoice,
    [switch]$WithVoice # Compatibilité avec les anciennes commandes ; Voice est désormais lancé par défaut.
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$Python = Join-Path $Root ".venv\Scripts\python.exe"
if (-not (Test-Path -LiteralPath $Python)) { throw "Lancez d'abord .\install.ps1" }
$env:PYTHONUNBUFFERED = "1"
$Logs = Join-Path $Root "var\logs"
New-Item -ItemType Directory -Path $Logs -Force | Out-Null

$pidFile = Join-Path $Root "var\services.pid.json"
New-Item -ItemType Directory -Path (Split-Path $pidFile) -Force | Out-Null
$processes = @()
if (Test-Path -LiteralPath $pidFile) {
    try {
        $registered = @(Get-Content -LiteralPath $pidFile -Raw | ConvertFrom-Json)
        $processes = @($registered | Where-Object { Get-Process -Id ([int]$_.Id) -ErrorAction SilentlyContinue })
    } catch { $processes = @() }
}

function Start-KingdomService([string]$service) {
    $existing = $processes | Where-Object { $_.service -eq $service } | Select-Object -First 1
    if ($existing) {
        Write-Host "$service est déjà lancé (PID $($existing.Id))." -ForegroundColor DarkYellow
        return
    }
    $process = Start-Process -FilePath $Python -ArgumentList "run.py", $service -WorkingDirectory $Root -WindowStyle Hidden -RedirectStandardOutput (Join-Path $Logs "$service.out.log") -RedirectStandardError (Join-Path $Logs "$service.err.log") -PassThru
    $script:processes += [pscustomobject]@{ service=$service; Id=$process.Id; ProcessName=$process.ProcessName; StartTime=$process.StartTime }
    Write-Host "$service démarré (PID $($process.Id))." -ForegroundColor Green
}

Start-KingdomService "web"
Start-KingdomService "core"
if (-not $WithoutVoice) { Start-KingdomService "voice" }

$processes | ConvertTo-Json | Set-Content -LiteralPath $pidFile -Encoding UTF8
Write-Host "KingdomEngine est prêt. Studio : http://127.0.0.1:8000" -ForegroundColor Green
Write-Host "Pour arrêter : .\stop-test-server.ps1"
