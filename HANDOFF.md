# Election Dashboard handoff

This repository now defaults to a fail-closed, localhost-only editorial application. Legacy election files remain available for research and migration work, but they are quarantined from public APIs because most contain modelled LGA allocations or incomplete provenance.

## Start locally

```powershell
docker compose up --build -d
```

The application is published only at `http://127.0.0.1:3010`. PostgreSQL/PostGIS is not exposed on the host. The Compose secret initializer creates persistent random local database and session secrets; it does not create an editor identity.

Useful checks:

```powershell
npm run check
docker compose ps
Invoke-RestMethod http://127.0.0.1:3010/health/live
Invoke-RestMethod http://127.0.0.1:3010/health/ready
```

Integration tests require a dedicated disposable database through `TEST_DATABASE_URL`. They intentionally refuse to use `DATABASE_URL` or `EDITORIAL_DATABASE_URL` so test fixtures cannot enter the application database.

## Publication workflow

The canonical workflow and evidence requirements are documented in `docs/DATA_EDITORIAL_WORKFLOW.md`. The supported public surface is `/api/v1/*`; the old result endpoints return only verified published data or an explicit quarantined/deprecated response.

Admin sign-in uses local username/password (see `docs/OPERATIONS.md`). Configure `ADMIN_USERNAME` / `ADMIN_PASSWORD` or `admin-credentials.json` plus the editor allow-list. A preparer cannot approve their own dataset.

Source originals are immutable. Local development stores them under `D:\Election Dashboard Data\source-archive`; Cloud deployments use the Google Cloud Storage adapter. Large source files, generated INEC snapshots, databases, uploads, and spreadsheet binaries are ignored by Git.

## Current data status

- No election contest is published by default.
- All legacy PVC-proportional and placeholder election result files are excluded from public results.
- Polling-unit records without coordinates remain without coordinates; the application does not create centroid or jitter locations.
- Population values are withheld until a dated product/version/licence is verified.
- The 2023 PVC material retains both conflicting INEC national totals and marks the series `in_review`; see `docs/PRODUCTION_READINESS.md`.

## Before public launch

Complete the blockers in `docs/PRODUCTION_READINESS.md`: name at least two editor accounts, ingest and independently approve the selected 2015-present declaration-level corpus, attach immutable source evidence, configure and test cloud backup/PITR, rehearse migration rollback, and complete staging security/performance acceptance.
