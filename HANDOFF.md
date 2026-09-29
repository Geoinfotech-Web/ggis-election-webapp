# Election Dashboard handoff

The running product is the Nigeria SPA on port **3010**, with local username/password admin. Result maps read JSON under `data/election-results/` and SQLite. Postgres holds admin sessions and the editorial `/api/v1` workflow. Architecture and routes are in [docs/TECHNICAL.md](docs/TECHNICAL.md).

## Start locally

```powershell
docker compose up --build -d
docker compose ps
Invoke-RestMethod http://127.0.0.1:3010/health/live
Invoke-RestMethod http://127.0.0.1:3010/health/ready
```

The app is published only at `http://127.0.0.1:3010`. PostGIS is not exposed on the host. Compose writes persistent random database and session secrets into the `local-secrets` volume. It does not invent an editor password.

These host directories must already exist (`create_host_path: false` in `docker-compose.yml`):

- `C:\Users\Geoinfotech\Documents\GIS Team\Election Dashboard Data\source-archive`
- `C:\Users\Geoinfotech\Documents\GIS Team\Election Dashboard Data\database-backups`

`docs/OPERATIONS.md` still names `D:\Election Dashboard Data\...` for those folders. The Compose file is the mount that actually runs.

`/health/ready` stays 503 until Postgres migrations and the legacy SQLite seed finish. Admin login stays 503 until that readiness check passes.

Optional checks:

```powershell
npm run check
npm run test:integration
```

Integration tests need `TEST_DATABASE_URL` pointing at a disposable database. They refuse `DATABASE_URL` and `EDITORIAL_DATABASE_URL`.

`npm start` without Compose uses `PORT` or **3000**, and `HOST` or `127.0.0.1`. Production still requires a session secret, an editorial database URL, and `BASE_URL`.

## Environment

Copy `.env.example` to `.env`. Do not commit `.env`.

| Variable | Role |
| --- | --- |
| `ADMIN_USERNAME` | Login name. Default `admin` if unset. |
| `ADMIN_PASSWORD` | Plain password used to bootstrap `data/admin-credentials.json` when that file is missing. |
| `ADMIN_PASSWORD_HASH` | scrypt hash from `node scripts/hash-admin-password.js`. Used when `ADMIN_PASSWORD` is empty. |
| `PRIMARY_ADMIN_EMAIL` | Session identity and the only account that can manage `/api/admin/access`. |
| `ADMIN_NAME` | Display name for the env bootstrap user. |
| `ADMIN_EMAIL` | Fallback only when `PRIMARY_ADMIN_EMAIL` is unset. |

On boot, if `data/admin-credentials.json` is missing and the password env is set, the server hashes it into that file when the path is writable, otherwise keeps the user in memory. It also adds the credential emails to the allow-list. You can instead copy `admin-credentials.example.json` to `data/admin-credentials.json` and `admin-access.example.json` to `admin-access.json`.

Sign in at `/admin-login.html`. Google OAuth is not used. `/auth/google` redirects to the local login page. Optional Drive browse still needs separate `credentials.json` and `token.json`; population data falls back to `data/reference/population-pvc-data.json`.

## What not to commit

Ignored on purpose (see `.gitignore`):

- `.env`
- `credentials.json`, `client_secret_*.json`, `token.json`
- `admin-settings.json`, `admin-access.json`, `admin-credentials.json`, `data/admin-credentials.json`
- `data/election-dashboard.db` and its `-shm` / `-wal` files
- `data/live-submissions/**` (except `.gitkeep`)
- `source-archive/`, `backups/`, INEC HTML snapshots under `data/inec/`
- large polling-unit coordinate work files under `data/reference/`

Also leave untracked research scrapes alone (`scripts/_wiki_raw/`, one-off `_commit*` scripts). Do not add passwords, session secrets, or database dumps.

## Known limits

**Governorship years.** The public catalog (`listGovCatalog` in `election-results-data.js`) keeps a year only when `meta.collated` is true and the pack is not `lgaMethod: pvc-proportional`, `modeled`, or `synthetic`. File names are storage years; the picker uses the election calendar year (`electionDate`, else `updated`).

From the JSON currently in `data/election-results/gubernatorial/` (36 states, no FCT race):

- **2023 only:** 29 states
- **Other verified years:** Anambra 2021; Edo 2020; Ondo 2020; Osun 2022 and 2018; Ekiti 2022, 2018, and 2014; Bayelsa 2023 and 2019; Kogi 2023 and 2019

The map drops an estimated governorship choropleth and shows “No verified LGA collation” instead. The estimated-LGA toggle is off for governorship.

**PVC and population.** PVC-proportional LGA vote splits are hidden from the public governorship catalog and map. `GET /api/population-data` sets `population` to null while `metadata.population.status` is not `verified` (the file is `quarantined`). The PVC register fields are still returned. `voterRegister.status` is `in_review` because the February 2023 state series (87,209,007 collected) and the later report narrative (87,394,106) disagree by 185,099. Both figures stay in `nationalSummary`.

**Boundaries.** State and LGA outlines are local GRID3-derived layers (`/api/boundaries/state` and `/lga`, plus `public/data/boundaries/adm0.zip`, `adm1.zip`, `adm2.zip`). Stears House and State Assembly constituency GeoJSON is not in the repo. See [docs/STEARS_BOUNDARIES_LICENCE.md](docs/STEARS_BOUNDARIES_LICENCE.md). Senate and House maps are state seat choropleths, not constituency polygons.

**Coordinates.** Polling units without an INEC locator stay unmapped. The server does not invent centroids.

**Editorial API.** `/api/v1/contests` reads published Postgres revisions. Nothing is published by default. The SPA still uses `/api/election-results/*` against the JSON/SQLite archive. Set `QUARANTINE_LEGACY_RESULTS=true` only if that archive should be hidden.

## Pages studio

After login, open `/admin/pages.html`. Draft, publish, and revert are `PUT /api/admin/pages/:country`, `POST .../publish`, and `POST .../revert`. The public app reads `GET /api/page-content/:country`. Country codes include `global`, `ng`, and the coming-soon scopes in `src/page-content-store.js`.
