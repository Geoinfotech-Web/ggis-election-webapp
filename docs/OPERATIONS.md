# Operations runbook

## Local services

`docker compose up --build -d` starts PostGIS, the non-root Node application, and a daily local database backup job. The application listens on `127.0.0.1:3010`; PostGIS has no host port.

Source originals are mounted from `D:\Election Dashboard Data\source-archive`. Database dumps are written to `D:\Election Dashboard Data\database-backups` and retained locally for 30 days. Create both directories before first use.

Liveness is `/health/live`. Readiness is `/health/ready` and remains 503 until migrations, PostgreSQL, and legacy reference-data initialization finish.

## Editor setup

Set local admin credentials in `.env`:

- `ADMIN_USERNAME` (default `admin`)
- `ADMIN_PASSWORD` or `ADMIN_PASSWORD_HASH` (generate a hash with `node scripts/hash-admin-password.js`)
- `PRIMARY_ADMIN_EMAIL` (session identity and Access manager)

On first boot without `data/admin-credentials.json`, the server hashes `ADMIN_PASSWORD` into that file when writable (otherwise keeps it in memory for the process) and ensures the primary email is on the allow-list. You can also copy `admin-credentials.example.json` to `data/admin-credentials.json` and `admin-access.example.json` to `admin-access.json`. Two different editor identities are still required to prepare and approve editorial revisions.

Google OAuth is no longer used for admin sign-in. Optional server-side Drive browse still needs separate `credentials.json` + `token.json` on the host; otherwise use local population data.

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
