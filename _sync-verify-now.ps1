$ErrorActionPreference = 'Continue'
$Root = 'C:\Users\Geoinfotech\Documents\GIS Team\Election Dashboard'
$Status = Join-Path $Root '.docker-sync-status.txt'
$Log = [System.Collections.Generic.List[string]]::new()
function Log([string]$m) { $Log.Add("[$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')] $m") | Out-Null }
function Save { ($Log -join "`r`n") | Set-Content -Path $Status -Encoding UTF8 }

Log 'START _sync-verify-now.ps1'
Set-Location $Root

$docker = 'docker'
try {
  $null = & $docker version --format '{{.Client.Version}}' 2>&1
  if ($LASTEXITCODE -ne 0) { throw 'docker cli failed' }
} catch {
  Log "BLOCKER: docker unavailable: $_"
  Save; exit 1
}

$container = $null
$ps = & $docker ps --format '{{.Names}}|{{.Ports}}' 2>&1
Log "docker ps:`n$ps"
foreach ($line in @($ps)) {
  if ($line -match '3010') { $container = ($line -split '\|')[0]; break }
}
if (-not $container) {
  foreach ($line in @($ps)) {
    if ($line -match 'election-dashboard.*app') { $container = ($line -split '\|')[0]; break }
  }
}
Log "container=$container"

$method = 'none'
if ($container) {
  Log 'Trying docker cp for 3 files'
  & $docker cp 'public\index.html' "${container}:/app/public/index.html" 2>&1 | ForEach-Object { Log "cp index: $_" }
  & $docker cp 'public\js\eid-maps.js' "${container}:/app/public/js/eid-maps.js" 2>&1 | ForEach-Object { Log "cp maps: $_" }
  & $docker cp 'election-results-data.js' "${container}:/app/election-results-data.js" 2>&1 | ForEach-Object { Log "cp data: $_" }
  $rs = & $docker restart $container 2>&1
  Log "restart: $rs"
  $method = 'docker-cp-restart'
} else {
  Log 'No container; trying compose up -d app'
  $up = & $docker compose up -d app 2>&1
  Log "compose up:`n$up"
  if ($LASTEXITCODE -eq 0) { $method = 'compose-up' } else { Log 'BLOCKER: compose up failed' }
}

Start-Sleep -Seconds 5

try {
  $h = (Invoke-WebRequest -UseBasicParsing -TimeoutSec 20 'http://127.0.0.1:3010/').Content
  $m = (Invoke-WebRequest -UseBasicParsing -TimeoutSec 20 'http://127.0.0.1:3010/js/eid-maps.js').Content
  $homeOk = $h.Contains('isGovCoverageTheme')
  $mapsOk = $m.Contains('theme.coverage === true')
  Log "VERIFY homeLen=$($h.Length) isGovCoverageTheme=$homeOk"
  Log "VERIFY mapsLen=$($m.Length) coverageTrue=$mapsOk"
  Log "RESULT fix_served=$($homeOk -and $mapsOk) method=$method"
} catch {
  Log "VERIFY ERROR: $_"
  Log 'RESULT fix_served=false'
}

Log 'DONE'
Save
exit 0
