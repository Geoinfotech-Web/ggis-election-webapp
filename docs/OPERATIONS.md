# Operations runbook

## Local services

`docker compose up --build -d` starts PostGIS, the non-root Node application, and a daily local database backup job. The application listens on `127.0.0.1:3010`; PostGIS has no host port.

Source originals are mounted from `D:\Election Dashboard Data\source-archive`. Database dumps are written to `D:\Election Dashboard Data\database-backups` and retained locally for 30 days. Create both directories before first use.

Liveness is `/health/live`. Readiness is `/health/ready` and remains 503 until migrations, PostgreSQL, and legacy reference-data initialization finish.

## Editor setup

Create an OAuth web client with callback `http://localhost:3010/auth/google/callback`. Put the client ID and secret in the untracked `.env`. Create an untracked `admin-access.json` from `admin-access.example.json` and replace the placeholder with the second real editor. Two different emails are required to prepare and approve.

## Backup and restore rehearsal

Run `scripts/backup-to-gcs.ps1` after authenticating `gcloud` and setting `GCS_SOURCE_ARCHIVE_BUCKET`. It synchronizes immutable sources and database dumps to versioned bucket prefixes.

Quarterly restore drill:

1. Stop the app service, leaving PostGIS running.
2. Select a dump in `D:\Election Dashboard Data\database-backups`.
3. Create a disposable restore database.
4. Run `pg_restore --clean --if-exists --no-owner` into the disposable database.
5. run the integration suite and compare published counts/checksums.
6. Drop only the disposable database after recording the drill.

Never test restoration over the live editorial database.

The local path was last exercised on 2026-09-04 using `election-dashboard-20260904T094038Z.dump`; it restored to a disposable database with `0` contests, `0` dataset versions, and `1` migration. This validates mechanics only, not cloud backup or point-in-time recovery.

## Google Cloud target

Use the same image and SQL migration on Cloud Run and Cloud SQL for PostgreSQL/PostGIS. Put OAuth/session/database secrets in Secret Manager, originals in a versioned Cloud Storage bucket, and use point-in-time recovery plus daily backups. Keep the service private through staging; public DNS is a separate launch gate after the historical corpus is complete.

Set `SOURCE_STORAGE=gcs` and `GCS_SOURCE_ARCHIVE_BUCKET` to select the Cloud Storage adapter. Application Default Credentials or the Cloud Run service account must have create/read access; bucket object versioning and retention are configured outside the application.

Before public exposure, set `COOKIE_SECURE=true`, an HTTPS `BASE_URL`, same-origin `CORS_ORIGINS`, Cloud Logging/Monitoring alerts, and a restore-tested backup policy. Target 99.9% monthly availability only after those controls and representative load tests pass.
