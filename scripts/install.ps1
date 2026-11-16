# Install or update Yggdrasil on Windows without opening the Releases page.
#   irm https://raw.githubusercontent.com/Kamil-Nadaf/Yggdrasil/main/scripts/install.ps1 | iex
# Installs to %LOCALAPPDATA%\Yggdrasil and adds a Start Menu shortcut. Your notes are not touched.
$ErrorActionPreference = "Stop"
$repo = "Kamil-Nadaf/Yggdrasil"
Write-Host "→ Finding the latest release"
$rel = Invoke-RestMethod "https://api.github.com/repos/$repo/releases/latest"
$asset = $rel.assets | Where-Object { $_.name -like "*-windows.zip" } | Select-Object -First 1
if (-not $asset) { throw "No Windows file in the latest release." }

$tmp = Join-Path ([IO.Path]::GetTempPath()) "ygg-install"
if (Test-Path $tmp) { Remove-Item $tmp -Recurse -Force }
New-Item -ItemType Directory $tmp | Out-Null
$zip = Join-Path $tmp $asset.name
Write-Host "→ Downloading $($asset.name)"
Invoke-WebRequest $asset.browser_download_url -OutFile $zip
Expand-Archive $zip -DestinationPath $tmp -Force

$dest = Join-Path $env:LOCALAPPDATA "Yggdrasil"
if (Test-Path $dest) { Remove-Item $dest -Recurse -Force }
Move-Item (Join-Path $tmp "Yggdrasil-windows") $dest

$icon = Join-Path $dest "desktop\yggdrasil.ico"
$lnk = Join-Path ([Environment]::GetFolderPath("Programs")) "Yggdrasil.lnk"
$sh = (New-Object -ComObject WScript.Shell).CreateShortcut($lnk)
$sh.TargetPath = Join-Path $dest "Yggdrasil.bat"
$sh.WorkingDirectory = $dest
$sh.WindowStyle = 7
if (Test-Path $icon) { $sh.IconLocation = $icon }
$sh.Save()
Remove-Item $tmp -Recurse -Force
Write-Host "✓ Installed. Open Yggdrasil from the Start Menu."
