# Launch Yggdrasil via Docker Compose on Windows.
$ErrorActionPreference = "Stop"
$Root = Resolve-Path (Join-Path $PSScriptRoot "..")
Set-Location $Root

if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
  Write-Host "Docker is not installed. Install Docker Desktop, then run this again:"
  Write-Host "  https://www.docker.com/products/docker-desktop/"
  exit 1
}

try {
  docker info | Out-Null
} catch {
  Write-Host "Docker is installed but not running. Open Docker Desktop and wait until it is ready."
  exit 1
}

if (-not (Test-Path ".env")) {
  Copy-Item ".env.example" ".env"
  $vault = Join-Path $Root "vault"
  (Get-Content ".env") -replace '^VAULT_HOST_PATH=.*', "VAULT_HOST_PATH=$vault" | Set-Content ".env"
  Write-Host "Created .env (vault → $vault)"
}

$vaultLine = (Get-Content ".env" | Where-Object { $_ -match '^VAULT_HOST_PATH=' } | Select-Object -First 1)
$env:VAULT_HOST_PATH = if ($vaultLine) { $vaultLine.Split("=", 2)[1].Trim('"').Trim("'") } else { Join-Path $Root "vault" }
New-Item -ItemType Directory -Force -Path $env:VAULT_HOST_PATH | Out-Null
bash scripts/init-vault.sh
if ($LASTEXITCODE -ne 0) {
  # Git Bash may be missing; create the vault folders in PowerShell.
  @(
    "00-Inbox", "10-Papers", "20-Concepts", "30-Questions",
    "40-Synthesis", "50-Projects", "60-Meta", "70-LaTeX", "80-Tasks"
  ) | ForEach-Object { New-Item -ItemType Directory -Force -Path (Join-Path $env:VAULT_HOST_PATH $_) | Out-Null }
}

Write-Host "Starting Yggdrasil (first run builds images — this can take a while)…"
docker compose up -d --build

Write-Host "Waiting for http://localhost:8000 …"
for ($i = 0; $i -lt 90; $i++) {
  try {
    Invoke-WebRequest -UseBasicParsing -Uri "http://localhost:8000" -TimeoutSec 2 | Out-Null
    break
  } catch {
    Start-Sleep -Seconds 2
  }
}

Start-Process "http://localhost:8000"
Write-Host "Yggdrasil is running at http://localhost:8000"
Write-Host "Stop with:  cd `"$Root`" ; docker compose down"
