# Election Dashboard

Local-first Nigeria election data and GIS application with an evidence-gated editorial workflow. The current historical result files are quarantined and no result becomes public until it passes validation, independent review, and publication.

## Run locally

Docker Desktop is required. The application is bound to localhost; PostgreSQL/PostGIS is not published to the host.

```powershell
docker compose up --build -d
docker compose ps
curl.exe http://localhost:3010/health/ready
```

Compose creates persistent random database and session secrets in a private Docker volume. Set `ADMIN_USERNAME`, `ADMIN_PASSWORD` (or `ADMIN_PASSWORD_HASH`), and `PRIMARY_ADMIN_EMAIL` in an untracked `.env` before using the editor. Optionally create `data/admin-credentials.json` from `admin-credentials.example.json` and keep emails in `admin-access.json`.

## Quality gates

```powershell
npm ci
npm run check
npm run test:integration
npm audit --omit=dev --audit-level=high
```

The integration test requires a dedicated disposable database in `TEST_DATABASE_URL`. It intentionally never falls back to the application database.

## Data policy

- Public result APIs read only `published` PostgreSQL revisions.
- A specific INEC document/page is sufficient evidence; otherwise two independent publishers must support every total.
- A preparer cannot approve their own revision.
- Modeled, PVC-proportional, placeholder, or synthetic election totals fail validation.
- Missing polling-unit coordinates remain missing. The server never invents centroid or jittered locations.
- Runtime spreadsheet ingestion is disabled; use normalized CSV or JSON.

See [docs/DATA_EDITORIAL_WORKFLOW.md](docs/DATA_EDITORIAL_WORKFLOW.md), [docs/OPERATIONS.md](docs/OPERATIONS.md), and [docs/PRODUCTION_READINESS.md](docs/PRODUCTION_READINESS.md).
