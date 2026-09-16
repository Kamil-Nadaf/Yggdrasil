# Build Windows desktop pack (no Docker). Run in PowerShell on Windows.
# Produces: release\Yggdrasil-windows\ with Yggdrasil.bat launcher.
$ErrorActionPreference = "Stop"
$Root = Resolve-Path (Join-Path $PSScriptRoot "..")
$Stamp = Get-Date -Format "yyyyMMdd"
$Out = Join-Path $Root "release"
$Dist = Join-Path $Out "Yggdrasil-windows"
$Frontend = Join-Path $Root "services\assistant\frontend"

Write-Host "→ Building frontend"
Set-Location $Frontend
if (-not (Test-Path "node_modules")) { npm ci }
npx tsc --noEmit
npm run build

Write-Host "→ Assembling $Dist"
if (Test-Path $Dist) { Remove-Item -Recurse -Force $Dist }
New-Item -ItemType Directory -Force -Path "$Dist\app","$Dist\desktop","$Dist\latex","$Dist\feynman","$Dist\venv" | Out-Null

Copy-Item "$Root\desktop\launch.py","$Root\desktop\setup.py","$Root\desktop\splash.html" "$Dist\desktop\"
foreach ($f in @("main.py","gate.py","zotero.py","data_manifest.py","graph_links.py","analysis_tags.py","arxiv_topics.py")) {
  Copy-Item "$Root\services\assistant\$f" "$Dist\app\"
}
New-Item -ItemType Directory -Force -Path "$Dist\app\frontend" | Out-Null
Copy-Item -Recurse "$Frontend\dist" "$Dist\app\frontend\dist"
Copy-Item "$Root\services\latex\latex_service.py" "$Dist\latex\"
if (Test-Path "$Root\services\latex\aastex") { Copy-Item -Recurse "$Root\services\latex\aastex" "$Dist\latex\aastex" }
Copy-Item "$Root\services\assistant\requirements.txt" "$Dist\"

python -m venv "$Dist\venv"
& "$Dist\venv\Scripts\python.exe" -m pip install --upgrade pip
& "$Dist\venv\Scripts\pip.exe" install -r "$Dist\requirements.txt" pywebview

@"
@echo off
set DIR=%~dp0
set YGG_RESOURCES=%DIR%app
set YGG_BUNDLE=%DIR%
set PYTHONUNBUFFERED=1
cd /d "%DIR%desktop"
"%DIR%venv\Scripts\python.exe" launch.py
"@ | Set-Content -Encoding ASCII "$Dist\Yggdrasil.bat"

@"
Yggdrasil (Windows)

Double-click Yggdrasil.bat

First launch asks where to save your notes.
AI: set your API key in Settings (LM Studio / Claude / …). Ollama optional.
"@ | Set-Content -Encoding UTF8 "$Dist\README.txt"

$Zip = Join-Path $Out "Yggdrasil-$Stamp-windows.zip"
if (Test-Path $Zip) { Remove-Item $Zip }
Compress-Archive -Path $Dist -DestinationPath $Zip
Write-Host "Wrote $Dist"
Write-Host "Wrote $Zip"
