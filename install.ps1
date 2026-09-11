[CmdletBinding()]
param(
    [switch]$ProvisionDiscord,
    [switch]$SkipDevTools
)

$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new()
$OutputEncoding = [System.Text.UTF8Encoding]::new()
$ProjectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location -LiteralPath $ProjectRoot

function Find-Python {
    $candidates = @(
        @{ File = "py"; Args = @("-3.12") },
        @{ File = "py"; Args = @("-3.11") },
        @{ File = "python"; Args = @() }
    )
    foreach ($candidate in $candidates) {
        try {
            & $candidate.File @($candidate.Args) -c "import sys; assert sys.version_info >= (3, 11)" 2>$null
            if ($LASTEXITCODE -eq 0) { return $candidate }
        } catch { }
    }
    throw "Python 3.11 ou 3.12 est requis. Installez-le depuis https://www.python.org/downloads/windows/ puis relancez install.ps1."
}

Write-Host "`n🏰 Installation de KingdomEngine 2" -ForegroundColor Magenta
$VenvPython = Join-Path $ProjectRoot ".venv\Scripts\python.exe"
if (-not (Test-Path -LiteralPath $VenvPython)) {
    $Python = Find-Python
    Write-Host "Création de l'environnement Python..."
    & $Python.File @($Python.Args) -m venv .venv
}
try { & $VenvPython -c "import sys; print(sys.version)" | Out-Null }
catch { throw "L'environnement .venv est invalide. Supprimez uniquement .venv puis relancez l'installateur." }

Write-Host "Installation des dépendances..."
& $VenvPython -m pip install --upgrade pip
$Package = if ($SkipDevTools) { "." } else { ".[dev]" }
& $VenvPython -m pip install -e $Package

$EnvPath = Join-Path $ProjectRoot ".env"
if (-not (Test-Path -LiteralPath $EnvPath)) {
    Copy-Item -LiteralPath (Join-Path $ProjectRoot ".env.example") -Destination $EnvPath
    Write-Host "⚠️  Fichier .env créé. Renseignez KINGDOM_CORE_TOKEN et KINGDOM_GUILD_ID." -ForegroundColor Yellow
}

Write-Host "Initialisation de la base..."
& $VenvPython -c "from dotenv import load_dotenv; load_dotenv(); from KingdomData import ContentStore; from seed import DEFINITIONS; from import_v1 import import_v1; s=ContentStore(); s.initialize(); s.seed(DEFINITIONS); import_v1(s); print('Base KingdomData prête.')"

if ($ProvisionDiscord) {
    Write-Host "Provisionnement du serveur Discord..."
    & $VenvPython run.py provision
} else {
    Write-Host "`nInstallation terminée." -ForegroundColor Green
    Write-Host "1. Complétez .env"
    Write-Host "2. Générez le lien d'invitation : .venv\Scripts\python.exe run.py invite-url"
    Write-Host "3. Ouvrez le lien et invitez le bot sur le serveur test"
    Write-Host "4. Lancez : .\install.ps1 -ProvisionDiscord"
}
