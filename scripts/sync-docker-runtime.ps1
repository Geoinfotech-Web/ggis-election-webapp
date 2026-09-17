# Sync latest host runtime files into the Election Dashboard app container
# (fallback when a full rebuild is slow/hung). Prefer: docker compose up -d app
# after bind mounts are present in docker-compose.yml.

$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root

$Status = Join-Path $Root '.docker-sync-status.txt'
function Log([string]$msg) {
  $line = "$(Get-Date -Format o)  $msg"
  Add-Content -Path $Status -Value $line
  Write-Host $line
}

Set-Content -Path $Status -Value "sync-docker-runtime start $(Get-Date -Format o)"

$cid = (docker compose ps -q app 2>$null | Select-Object -First 1)
if (-not $cid) {
  $cid = (docker ps -q --filter "publish=3010" | Select-Object -First 1)
}
if (-not $cid) {
  Log 'ERROR: no app container found on compose service app / port 3010'
  exit 1
}
Log "container=$cid"

$pairs = @(
  @{ Src = 'public'; Dst = '/app/public' },
  @{ Src = 'data/election-results'; Dst = '/app/data/election-results' },
  @{ Src = 'data/reference'; Dst = '/app/data/reference' },
  @{ Src = 'src'; Dst = '/app/src' },
  @{ Src = 'server.js'; Dst = '/app/server.js' },
  @{ Src = 'election-results-data.js'; Dst = '/app/election-results-data.js' },
  @{ Src = 'election-analysis.js'; Dst = '/app/election-analysis.js' }
)

foreach ($p in $pairs) {
  $src = Join-Path $Root $p.Src
  if (-not (Test-Path $src)) {
    Log "SKIP missing $($p.Src)"
    continue
  }
  Log "docker cp $($p.Src) -> $($p.Dst)"
  docker cp $src "${cid}:$($p.Dst)"
}

Log 'Recreating app to pick up compose bind mounts (preferred) or restart after cp'
docker compose up -d app
if ($LASTEXITCODE -ne 0) {
  Log 'compose up failed; restarting container after cp'
  docker restart $cid | Out-Null
}

Start-Sleep -Seconds 3
try {
  $js = Invoke-WebRequest -Uri 'http://127.0.0.1:3010/js/eid-data-explorer.js' -UseBasicParsing -TimeoutSec 15
  $hasGroup = $js.Content -match 'groupByCategory'
  Log "eid-data-explorer.js bytes=$($js.RawContentLength) groupByCategory=$hasGroup"
  $cat = Invoke-WebRequest -Uri 'http://127.0.0.1:3010/api/data-catalog' -UseBasicParsing -TimeoutSec 30
  $hasStears = $cat.Content -match 'stears-open-data'
  Log "data-catalog stears-open-data=$hasStears"
} catch {
  Log "VERIFY ERROR: $($_.Exception.Message)"
}

Log 'done'
