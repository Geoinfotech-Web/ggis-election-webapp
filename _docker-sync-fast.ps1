# Election Dashboard fast Docker sync script
# Prefer: recreate app with bind mounts from docker-compose.yml
# Fallback: docker cp host files into running container

$ErrorActionPreference = 'Continue'
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$StatusFile = Join-Path $Root '.docker-sync-status.txt'
$Log = [System.Collections.Generic.List[string]]::new()

function Log([string]$msg) {
  $line = "[{0}] {1}" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $msg
  $Log.Add($line) | Out-Null
  Write-Host $line
}

function Save-Status {
  ($Log -join "`r`n") | Set-Content -Path $StatusFile -Encoding UTF8
}

Log "START docker sync from $Root"
Set-Location $Root

# Kill stuck docker CLI clients (not Docker Desktop service)
try {
  Get-Process docker -ErrorAction SilentlyContinue | Where-Object {
    $_.Path -like '*Docker*' -or $_.ProcessName -eq 'docker'
  } | ForEach-Object {
    Log "Stopping hung docker PID $($_.Id)"
    Stop-Process -Id $_.Id -Force -ErrorAction SilentlyContinue
  }
} catch {
  Log "Process cleanup note: $_"
}

$docker = $null
foreach ($cand in @(
  'docker',
  'C:\Program Files\Docker\Docker\resources\bin\docker.exe',
  'C:\Program Files\Docker\Docker\resources\docker.exe'
)) {
  try {
    if ($cand -eq 'docker') {
      $v = & docker version --format '{{.Client.Version}}' 2>&1
      if ($LASTEXITCODE -eq 0) { $docker = 'docker'; break }
    } elseif (Test-Path $cand) {
      $v = & $cand version --format '{{.Client.Version}}' 2>&1
      if ($LASTEXITCODE -eq 0) { $docker = $cand; break }
    }
  } catch { }
}
if (-not $docker) {
  Log "BLOCKER: Docker CLI not responding / not found"
  Save-Status
  exit 1
}
Log "Using Docker CLI: $docker"

$psOut = & $docker ps --format "{{.Names}}|{{.Image}}|{{.Status}}|{{.Ports}}" 2>&1
Log "docker ps:`n$psOut"

$container = $null
$lines = @($psOut | Where-Object { $_ -match 'election' -or $_ -match ':3010' })
if ($lines.Count -gt 0) {
  $container = ($lines[0] -split '\|')[0]
}
if (-not $container) {
  # try compose ps
  $cps = & $docker compose ps --format json 2>&1
  Log "compose ps: $cps"
  if ($cps -match 'election-dashboard-app') {
    $container = 'election-dashboard-app-1'
  }
}
Log "Container candidate: $container"

$method = 'none'
$recreate = $false

# Compose already has bind mounts — recreate is the durable fix
Log "Recreating app service to apply bind mounts (docker compose up -d app)"
$up = & $docker compose up -d app 2>&1
Log "compose up output:`n$up"
if ($LASTEXITCODE -eq 0) {
  $method = 'compose-recreate-bind-mounts'
  $recreate = $true
} else {
  Log "compose up failed (exit $LASTEXITCODE); trying docker cp fast path"
  if (-not $container) {
    Log "BLOCKER: no container name for docker cp"
    Save-Status
    exit 2
  }

  $copies = @(
    @{ Src = 'public'; Dst = '/app/public' },
    @{ Src = 'data/election-results'; Dst = '/app/data/election-results' },
    @{ Src = 'data/reference/stears-open-data'; Dst = '/app/data/reference/stears-open-data' },
    @{ Src = 'public/data/stears-open-data'; Dst = '/app/public/data/stears-open-data' },
    @{ Src = 'election-results-data.js'; Dst = '/app/election-results-data.js' },
    @{ Src = 'election-analysis.js'; Dst = '/app/election-analysis.js' },
    @{ Src = 'src/data-catalog.js'; Dst = '/app/src/data-catalog.js' },
    @{ Src = 'server.js'; Dst = '/app/server.js' }
  )

  foreach ($c in $copies) {
    $srcPath = Join-Path $Root $c.Src
    if (-not (Test-Path $srcPath)) {
      Log "SKIP missing: $($c.Src)"
      continue
    }
    Log "docker cp $($c.Src) -> ${container}:$($c.Dst)"
    $cpOut = & $docker cp $srcPath "${container}:$($c.Dst)" 2>&1
    Log "  result: $cpOut (exit $LASTEXITCODE)"
  }

  Log "Restarting container $container"
  $rs = & $docker restart $container 2>&1
  Log "restart: $rs"
  $method = 'docker-cp-restart'
}

Start-Sleep -Seconds 4

# Refresh container name after recreate
$ps2 = & $docker ps --format "{{.Names}}|{{.Ports}}" 2>&1
$container2 = $null
foreach ($line in $ps2) {
  if ($line -match '3010') {
    $container2 = ($line -split '\|')[0]
    break
  }
}
if ($container2) { $container = $container2 }
Log "Active container: $container"

# Verify endpoints
function Check-Url([string]$url, [string]$needle) {
  try {
    $resp = Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 30
    $body = $resp.Content
    $has = if ($needle) { $body -match [regex]::Escape($needle) } else { $true }
    return @{ status = [int]$resp.StatusCode; hasNeedle = [bool]$has; len = $body.Length }
  } catch {
    return @{ status = 0; hasNeedle = $false; len = 0; error = "$_" }
  }
}

$js = Check-Url 'http://127.0.0.1:3010/js/eid-data-explorer.js' 'groupByCategory'
$cat = Check-Url 'http://127.0.0.1:3010/api/data-catalog' 'stears-open-data'
$home = Check-Url 'http://127.0.0.1:3010/' $null

Log "VERIFY /js/eid-data-explorer.js => status=$($js.status) has groupByCategory=$($js.hasNeedle) len=$($js.len)"
Log "VERIFY /api/data-catalog => status=$($cat.status) has stears-open-data=$($cat.hasNeedle) len=$($cat.len)"
Log "VERIFY / => status=$($home.status) len=$($home.len)"
Log "METHOD=$method CONTAINER=$container"
Log "DONE"
Save-Status
exit 0
