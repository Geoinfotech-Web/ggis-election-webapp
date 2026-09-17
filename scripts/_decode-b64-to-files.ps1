$src = "$env:USERPROFILE\.cursor\projects\c-Users-Geoinfotech-Documents-GIS-Team-Election-Dashboard\agent-tools\e633dbde-bbbd-4a22-afda-147e4ad47998.txt"
$outDir = Join-Path $PSScriptRoot "..\data\reference\stears-open-data"
New-Item -ItemType Directory -Force -Path $outDir | Out-Null
$raw = Get-Content -Raw -Path $src
$start = $raw.IndexOf('[')
$end = $raw.LastIndexOf(']')
$items = $raw.Substring($start, $end - $start + 1) | ConvertFrom-Json
$manifestFiles = @()
foreach ($item in $items) {
  $dest = Join-Path $outDir $item.name
  [IO.File]::WriteAllBytes($dest, [Convert]::FromBase64String($item.b64))
  $len = (Get-Item $dest).Length
  Write-Output "WROTE $($item.name) $len bytes"
  $manifestFiles += [ordered]@{
    filename = $item.name
    url = "https://stears-flourish-data.s3.amazonaws.com/$($item.name)"
    bytes = $len
    downloaded = $true
    status = $item.status
  }
}
$manifest = @{
  generatedAt = (Get-Date).ToUniversalTime().ToString('o')
  attribution = 'Stears Open Data (Flourish datasets hosted on AWS S3)'
  source = 'https://www.stears.co/open-data'
  license = 'See Stears Open Data terms; cite Stears when using these datasets.'
  downloadStatus = 'complete'
  files = $manifestFiles
}
$manifest | ConvertTo-Json -Depth 5 | Set-Content (Join-Path $outDir 'manifest.json') -Encoding UTF8
Write-Output "DONE $($manifestFiles.Count) files"
