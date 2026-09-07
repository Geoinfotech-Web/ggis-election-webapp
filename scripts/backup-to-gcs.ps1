param(
  [string]$Bucket = $env:GCS_SOURCE_ARCHIVE_BUCKET,
  [string]$SourceArchive = 'D:\Election Dashboard Data\source-archive',
  [string]$DatabaseBackups = 'D:\Election Dashboard Data\database-backups'
)

$ErrorActionPreference = 'Stop'
if ([string]::IsNullOrWhiteSpace($Bucket)) { throw 'Set GCS_SOURCE_ARCHIVE_BUCKET or pass -Bucket.' }
if ($Bucket -notmatch '^gs://[a-z0-9][a-z0-9._-]+$') { throw 'Bucket must be a gs:// bucket URL without a path.' }
foreach ($path in @($SourceArchive, $DatabaseBackups)) {
  if (-not (Test-Path -LiteralPath $path -PathType Container)) { throw "Directory not found: $path" }
}

gcloud storage rsync --recursive --checksums-only $SourceArchive "$Bucket/source-archive"
if ($LASTEXITCODE -ne 0) { throw 'Source archive backup failed.' }
gcloud storage rsync --recursive --checksums-only $DatabaseBackups "$Bucket/database-backups"
if ($LASTEXITCODE -ne 0) { throw 'Database backup upload failed.' }

Write-Host 'GCS backup completed with checksum comparison.'
