# Election Dashboard

Nigeria election map and data app. The public UI is a single-page app in `public/index.html`, served by Node (`server.js`) with result files under `data/election-results/` and polling units in SQLite. Docker publishes the app on `http://127.0.0.1:3010`.

## Public app

Open `http://127.0.0.1:3010`. Nigeria is the live country. The default navigation is Overview, Polling units, Live Results, Candidates, Parties, Analysis, Data, and About. Labels and visibility can be changed in the admin Pages studio and are stored in `data/page-content.json`.

- **Overview** — national map, result choropleth, and KPIs.
- **Polling units** — State → LGA → Ward search, nearby units, and map layers.
- **Parties** — INEC party list, history, and flag bearers.
- **Analysis** — swing, geography, turnout, trends, demographics, and data quality. Built by `GET /api/election-results/analysis`.
- **Data** — catalog of publishable datasets with JSON/CSV (and some file) downloads via `GET /api/data-catalog` and `GET /api/data-catalog/download`.

Governorship maps and the year picker use verified LGA collation only (`meta.collated` and not a PVC-proportional or modeled split). Estimated packs stay on disk and are left out of `/api/election-results/gov-catalog`. Most states currently expose 2023 only; off-cycle states differ. See [HANDOFF.md](HANDOFF.md).

The default basemap is Google Streets (`streets`). OpenStreetMap is the `osm` id and uses OpenStreetMap France tiles. Other ids: `hybrid`, `satellite`, `terrain`, `dark`, `light`.

## Run locally

Docker Desktop is required for the Compose stack. The app port is bound to localhost. PostgreSQL/PostGIS has no host port.

```powershell
docker compose up --build -d
docker compose ps
curl.exe http://localhost:3010/health/ready
```

Before first use, create the host folders that Compose bind-mounts (it will not create them):

- `C:\Users\Geoinfotech\Documents\GIS Team\Election Dashboard Data\source-archive`
- `C:\Users\Geoinfotech\Documents\GIS Team\Election Dashboard Data\database-backups`

Compose stores random database and session secrets in a private Docker volume. Copy `.env.example` to an untracked `.env` and set:

- `ADMIN_USERNAME`
- `ADMIN_PASSWORD` or `ADMIN_PASSWORD_HASH` (`node scripts/hash-admin-password.js`)
- `PRIMARY_ADMIN_EMAIL`

Sign in at `http://127.0.0.1:3010/admin-login.html`. Google sign-in is removed: `/auth/google` redirects to that page, and `/auth/google/callback` returns 410.

Admin sessions need the editorial Postgres database. Login returns 503 until `/health/ready` is ok.

`npm start` listens on `PORT` (default `3000`) at `127.0.0.1`. Production mode still requires `ADMIN_SESSION_SECRET`, `EDITORIAL_DATABASE_URL` (or the Compose host/password files), and `BASE_URL`.

## Admin

`/admin/` is cookie-gated. Pages studio is `/admin/pages.html` (nav, analysis sub-tabs, widgets). Related studios: Dashboards, Maps, Content, Moderation, Access.

Writes send `X-CSRF-Token` from `GET /api/admin/me`. The session cookie is `election_admin_session` (HttpOnly, 12 hours).

## Checks

```powershell
npm ci
npm run check
npm run test:integration
```

`npm run test:integration` needs a disposable database in `TEST_DATABASE_URL`. It does not use `DATABASE_URL` or `EDITORIAL_DATABASE_URL`.

## Docs

- [HANDOFF.md](HANDOFF.md) — runbook for the next person
- [docs/TECHNICAL.md](docs/TECHNICAL.md) — architecture and APIs
- [docs/DATA_EDITORIAL_WORKFLOW.md](docs/DATA_EDITORIAL_WORKFLOW.md) — Postgres publication workflow (`/api/v1`)
- [docs/OPERATIONS.md](docs/OPERATIONS.md) — backups and cloud target
- [docs/STEARS_BOUNDARIES_LICENCE.md](docs/STEARS_BOUNDARIES_LICENCE.md) — constituency polygons are not bundled
