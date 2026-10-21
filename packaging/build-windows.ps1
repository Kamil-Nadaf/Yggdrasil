# Build Windows desktop pack (no Docker). Run in PowerShell on Windows.
# Produces: release\Yggdrasil-windows\ with Yggdrasil.bat launcher.
#
# Paths are built with chained two-arg Join-Path calls (not "\"-embedded
# strings) so this also runs as a local sanity check under pwsh on macOS/Linux
# without corrupting paths — real Windows wheels/venv still require building
# on actual Windows for the final distributable (no cross-compiling).
$ErrorActionPreference = "Stop"

function JP {
  param([Parameter(Mandatory)][string]$Base, [Parameter(Mandatory)][string[]]$Parts)
  $result = $Base
  foreach ($part in $Parts) { $result = Join-Path $result $part }
  return $result
}

$IsWindowsHost = ($PSVersionTable.PSVersion.Major -lt 6) -or $IsWindows
$VenvBinDir = if ($IsWindowsHost) { "Scripts" } else { "bin" }
$VenvPythonName = if ($IsWindowsHost) { "python.exe" } else { "python" }

$Root = Resolve-Path (Join-Path $PSScriptRoot "..")
$Stamp = Get-Date -Format "yyyyMMdd"
$Out = Join-Path $Root "release"
$Dist = Join-Path $Out "Yggdrasil-windows"
$Frontend = JP $Root @("services", "assistant", "frontend")
$AssistantSrc = JP $Root @("services", "assistant")
$DesktopSrc = JP $Root @("desktop")
$LatexSrc = JP $Root @("services", "latex")
$DistApp = Join-Path $Dist "app"
$DistDesktop = Join-Path $Dist "desktop"
$DistLatex = Join-Path $Dist "latex"

if (-not $IsWindowsHost) {
  Write-Host "→ Not running on Windows: this is a local sanity check only (paths/assembly), not a real Windows build. Run this script on an actual Windows machine to produce the distributable zip."
}

Write-Host "→ Building frontend"
Set-Location $Frontend
if (-not (Test-Path "node_modules")) { npm ci }
npx tsc --noEmit
npm run build

Write-Host "→ Assembling $Dist"
if (Test-Path $Dist) { Remove-Item -Recurse -Force $Dist }
New-Item -ItemType Directory -Force -Path $DistApp, $DistDesktop, $DistLatex, (Join-Path $Dist "feynman") | Out-Null

Copy-Item (JP $DesktopSrc @("launch.py")), (JP $DesktopSrc @("setup.py")), (JP $DesktopSrc @("splash.html")), (JP $DesktopSrc @("yggdrasil-logo.png")) $DistDesktop
foreach ($f in @("main.py", "gate.py", "zotero.py", "data_manifest.py", "graph_links.py", "analysis_tags.py", "arxiv_topics.py", "task_statuses.py", "goals.py", "mcp_server.py")) {
  Copy-Item (Join-Path $AssistantSrc $f) $DistApp
}
$DistFrontendDir = Join-Path $DistApp "frontend"
New-Item -ItemType Directory -Force -Path $DistFrontendDir | Out-Null
Copy-Item -Recurse (Join-Path $Frontend "dist") (Join-Path $DistFrontendDir "dist")
Copy-Item (JP $LatexSrc @("latex_service.py")) $DistLatex
$AastexSrc = JP $LatexSrc @("aastex")
if (Test-Path $AastexSrc) { Copy-Item -Recurse $AastexSrc (Join-Path $DistLatex "aastex") }
$PostersSrc = JP $LatexSrc @("posters")
if (Test-Path $PostersSrc) { Copy-Item -Recurse $PostersSrc (Join-Path $DistLatex "posters") }
Copy-Item (JP $AssistantSrc @("requirements.txt")) (Join-Path $Dist "requirements.txt")
Copy-Item (Join-Path $Root "LICENSE") (Join-Path $Dist "LICENSE")

Write-Host "→ Bundling a relocatable standalone Python 3.12 (python-build-standalone)"
# A venv (or `uv venv`) records the build machine's absolute Python path, so it
# only works where it was built. The standalone distribution is self-contained
# and can be unzipped anywhere, so we install packages straight into it.
$PyVer = "3.12.5"
$PyDate = "20240814"
$PyUrl = "https://github.com/indygreg/python-build-standalone/releases/download/$PyDate/cpython-$PyVer+$PyDate-x86_64-pc-windows-msvc-install_only.tar.gz"
$PyTgz = Join-Path ([System.IO.Path]::GetTempPath()) "ygg-python-windows.tar.gz"
if (-not (Test-Path $PyTgz)) {
  Invoke-WebRequest -Uri $PyUrl -OutFile $PyTgz
}
tar -xzf $PyTgz -C $Dist          # creates $Dist\python\
if ($LASTEXITCODE -ne 0) { throw "Failed to extract standalone Python" }
$VenvPython = JP $Dist @("python", "python.exe")
if (-not (Test-Path $VenvPython)) { throw "Standalone Python missing: $VenvPython" }
& $VenvPython -m pip install --upgrade pip --quiet
& $VenvPython -m pip install -r (Join-Path $Dist "requirements.txt") pywebview --quiet
if ($LASTEXITCODE -ne 0) { throw "pip install failed" }
# Sanity check: the bundled interpreter can import the key packages.
& $VenvPython -c "import fastapi, uvicorn, webview; print('bundle imports OK')"
if ($LASTEXITCODE -ne 0) { throw "Bundled Python cannot import its dependencies" }

@"
@echo off
set DIR=%~dp0
set YGG_RESOURCES=%DIR%app
set YGG_BUNDLE=%DIR%
set PYTHONUNBUFFERED=1
cd /d "%DIR%desktop"
"%DIR%python\python.exe" launch.py
"@ | Set-Content -Encoding ASCII (Join-Path $Dist "Yggdrasil.bat")

@"
Yggdrasil (Windows)

© 2026 Kamil Nadaf — MIT License (see LICENSE)

Double-click Yggdrasil.bat

First launch asks where to save your notes.
AI: set your API key in Settings (LM Studio / Claude / …). Ollama optional.

Known v0 limitation: automatic LaTeX (TinyTeX) install is not wired up on
Windows yet. Everything else (Dashboard, Notes, Tasks, Search, Graph, Daily
Archive) works without it. To use the LaTeX Editor, install a LaTeX
distribution yourself (e.g. MiKTeX: https://miktex.org/download) and make
sure pdflatex/latexmk are on your PATH before opening Yggdrasil.
"@ | Set-Content -Encoding UTF8 (Join-Path $Dist "README.txt")

$Zip = Join-Path $Out "Yggdrasil-$Stamp-windows.zip"
if (Test-Path $Zip) { Remove-Item $Zip }
Compress-Archive -Path $Dist -DestinationPath $Zip
Write-Host "Wrote $Dist"
Write-Host "Wrote $Zip"
