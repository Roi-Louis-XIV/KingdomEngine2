$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$pidFile = Join-Path $Root "var\services.pid.json"
if (-not (Test-Path -LiteralPath $pidFile)) { Write-Host "Aucun service enregistré."; exit 0 }
$entries = Get-Content -LiteralPath $pidFile -Raw | ConvertFrom-Json
foreach ($entry in @($entries)) {
    $process = Get-Process -Id $entry.Id -ErrorAction SilentlyContinue
    if ($process -and $process.ProcessName -like "python*") { Stop-Process -Id $process.Id }
}
Remove-Item -LiteralPath $pidFile
Write-Host "Services KingdomEngine arrêtés."
