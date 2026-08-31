# Election Dashboard — Handoff Document

**Project:** Nigeria Election GIS Dashboard  
**Organization:** Geoinfotech GIS Team  
**Last updated:** 31 August 2026  
**App URL (Docker):** http://localhost:3010

---

## 1. Purpose

A web-based election intelligence dashboard for Nigeria. It combines:

- Interactive maps (state → LGA → ward → polling unit drill-down)
- Official and seeded election result choropleths
- Polling unit register (176k+ units)
- Population / PVC statistics
- Admin tools for data upload, boundary management, and INEC ingest

The main user-facing app is a single-page dashboard at `/` (`public/index.html`). A separate admin console handles database and shapefile operations.

---

## 2. Quick start

### Prerequisites

- Node.js 22+ (required for `better-sqlite3` stability)
- Docker Desktop (optional but recommended for team use)
- Copy `.env.example` → `.env` and fill optional keys

### Local (host Node)

```powershell
cd "C:\Users\Geoinfotech\Documents\GIS Team\Election Dashboard"
npm install
npm start
```

Open http://localhost:3010

### Docker (recommended)

```powershell
docker compose up --build -d
```

| Item | Value |
|------|-------|
| Container | `election-dashboard-app` |
| Port | `3010` |
| SQLite volume | `election-db` (Docker named volume) |
| DB path inside container | `/app/data/db/election-dashboard.db` |

**Important:** Host and Docker use **separate SQLite databases**. Seeding on the host does not update the Docker DB unless you run seed commands inside the container (or reimport via API).

---

## 3. Architecture overview

```
┌─────────────────────────────────────────────────────────────┐
│  Browser                                                     │
│  public/index.html  +  public/js/eid-maps.js  +  eid-app.js │
└──────────────────────────┬──────────────────────────────────┘
                           │ REST
┌──────────────────────────▼──────────────────────────────────┐
│  server.js (Express 5, Node 22)                              │
│  ├── election-results-data.js   (choropleth, gov discovery)  │
│  ├── boundaries-data.js         (shapefile → SQLite)         │
│  ├── db.js                      (SQLite schema + queries)    │
│  ├── polling-data.js            (CSV polling units)          │
│  └── lga-normalize.js           (LGA name alias matching)    │
└──────────────────────────┬──────────────────────────────────┘
                           │
         ┌─────────────────┼─────────────────┐
         ▼                 ▼                 ▼
   SQLite DB        JSON datasets      Boundary uploads
   (election-db)    election-results/  data/boundaries/
                    governorship/      Shapefiles/
```

### Map boundary source priority

1. **Local SQLite boundaries** — `/api/boundaries/{state|lga|ward}` (uploaded or seeded shapefiles)
2. **GRID3 ArcGIS fallback** — `/api/grid3/{layer}` when local data is missing

### Election choropleth flow

1. UI selects office + year + state → `GET /api/election-results/choropleth`
2. Server loads dataset from SQLite (or JSON fallback)
3. `election-results-data.js` decorates units with party colours
4. `eid-maps.js` applies fill colours to GeoJSON features using LGA name matching

---

## 4. Two admin systems (do not confuse them)

There are **two separate admin entry points**:

| Entry | Auth | Purpose |
|-------|------|---------|
| `/admin/index.html` | Username/password (`admin` / `admin123`) | DB stats, boundary upload, election reimport, INEC ingest |
| `/admin-login.html` → `/admin.html` | Google OAuth | Google Drive population sources, OAuth-managed settings |

The main dashboard **Admin** button (header) links to `/admin/index.html`.

After username/password login, a Bearer token is stored in `sessionStorage` as `admin_token`. The in-app Admin panel upload uses this token for `/api/admin/boundaries/upload`.

**Change default credentials** in `server.js` (`ADMIN_LOGIN_USER`) before any production deployment.

---

## 5. Key files and directories

| Path | Role |
|------|------|
| `server.js` | Express app, all API routes, auth middleware |
| `db.js` | SQLite schema: polling units, election datasets, boundary layers |
| `election-results-data.js` | Choropleth builder, gov state discovery, party colours |
| `boundaries-data.js` | Shapefile/GeoJSON parse, import, query by bbox/state/LGA |
| `lga-normalize.js` | LGA name aliases (shapefile ↔ election data matching) |
| `public/index.html` | Main SPA dashboard (elections, map, admin panel) |
| `public/js/eid-maps.js` | Leaflet map, layers, choropleth styling |
| `public/js/eid-app.js` | Welcome/overview shell (links to admin) |
| `admin/dashboard.html` | Username/password admin console |
| `admin/upload.html` | Boundary shapefile upload UI |
| `data/election-results/` | Presidential + gubernatorial JSON source files |
| `data/election-results/gubernatorial/` | Per-state gov files: `{state-slug}-{year}.json` |
| `data/governorship-history.json` | Real candidate names for 2014/2018 seeding |
| `data/boundaries/uploads/` | Archived uploaded shapefile zips |
| `Shapefiles/` | Repo shapefiles (state + LGA, read-only in Docker) |
| `scripts/seed-governorship-results.js` | Generate LGA-level gov JSON for all states |
| `scripts/seed-boundaries.js` | Import repo Shapefiles into SQLite |
| `docker-compose.yml` | Docker service + bind mounts |
| `Dockerfile` | Node 22 slim + native build deps for sqlite3 |

---

## 6. Data model (SQLite)

### Tables (main)

- **`polling_units`** — ~176,846 rows from `public/data/Nigeria_polling_units.csv`
- **`election_datasets`** — metadata per office/year/state
- **`election_units`** — LGA or state-level result rows linked to datasets
- **`boundary_layers`** — imported shapefile layer metadata (state, lga, ward)
- **`boundary_features`** — GeoJSON geometry + properties per feature
- **`boundary_state_codes`** — state_code → state_name mapping for LGA imports

### Current seeded counts (as of handoff)

- **145** election datasets
- **3,109** election units (LGA-level governorship)
- **37** state boundaries, **774** LGA boundaries (from repo Shapefiles)
- Ward boundaries: uploaded via admin (user successfully uploaded wards shapefile)

---

## 7. NPM scripts

```powershell
npm start                  # Run server (port from .env or 3010)
npm run build:sourced-gov   # Build all 36×4 states from sourced statewide totals + PVC LGA splits
npm run seed:gov            # Alias for build:sourced-gov (replaces legacy synthetic seed)
npm run generate:gov-official   # Write verified LGA datasets to data/election-results/official/
npm run import:gov-official     # Generate official files + copy to gubernatorial/ + history + SQLite
npm run expand:gov-history      # Fill 2014 (incumbents) and 2022 (2023 winners) in governorship-history.json
npm run seed:boundaries    # Import repo Shapefiles/ into SQLite
npm run inec:ingest        # Poll INEC public pages (standalone script)
```

### Docker equivalents

```powershell
docker exec election-dashboard-app npm run import:gov-official
docker exec election-dashboard-app node scripts/seed-governorship-results.js
docker exec election-dashboard-app node scripts/seed-boundaries.js
```

---

## 8. API reference (summary)

### Public

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/election-results/choropleth?office=&year=&state=` | Map + panel result data |
| GET | `/api/election-results/gov-states?year=` | States with gov data for a year |
| GET | `/api/boundaries/status` | Local boundary layer counts |
| GET | `/api/boundaries/{state\|lga\|ward}?state=&lga=&bbox=` | GeoJSON boundaries |
| GET | `/api/polling-directory?state=&lga=&ward=` | PU directory tree |
| GET | `/api/polling-units.geojson?...` | PU points as GeoJSON |
| GET | `/api/population-data` | Population / PVC / governors JSON |
| GET | `/api/grid3/{layer}` | GRID3 ArcGIS proxy |
| GET | `/api/inec-ingest/status` | INEC scrape job status |

### Admin (Bearer token or OAuth cookie)

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/admin/login` | Username/password → token |
| GET | `/api/admin/verify` | Validate token |
| GET | `/api/admin/db/status` | DB counts + boundary layers |
| POST | `/api/admin/boundaries/upload` | Multipart shapefile import |
| DELETE | `/api/admin/boundaries/:layer` | Remove a boundary layer |
| POST | `/api/admin/db/reimport-election-results` | Re-read JSON → SQLite |
| POST | `/api/admin/db/reimport-polling-units` | Re-read CSV → SQLite |
| POST | `/api/admin/inec-ingest` | Trigger INEC page scrape |

---

## 9. Governorship election data

### Years available in UI

`2026`, `2022`, `2018`, `2014` — for all 36 states (+ Ekiti 2026 has real LGA data)

### Data quality notes

| Year | Quality |
|------|---------|
| **All years** | 36 states × 4 dashboard years with INEC-declared statewide totals and source citations |
| **Statewide sources** | `scripts/data/governorship-statewide-{2014,2018,2022,2026}.js` — THISDAYLIVE, BBC, Channels TV, Punch, Wikipedia, INEC |
| **Official LGA collated** | `meta.collated: true` — Ekiti 2014/2018/2022, Osun 2018 (real per-LGA INEC returns) |
| **Other LGA splits** | `meta.lgaMethod: 'pvc-proportional'` — statewide totals allocated by LGA population weights (2023 PVC cycle) |

### Sourced governorship build workflow

1. Edit statewide source data in `scripts/data/governorship-statewide-*.js` (or add LGA rows to `generate-official-governorship.js`)
2. Run `npm run import:gov-official` — refreshes collated LGA datasets (Ekiti, Osun)
3. Run `npm run build:sourced-gov` — builds all other state/year files + syncs `governorship-history.json` + SQLite
4. Hard-refresh browser (Ctrl+F5)

Legacy synthetic seed: `scripts/seed-governorship-results.js` (deprecated; use `build:sourced-gov`).

### Regenerating after history edits

1. Edit `data/governorship-history.json` (or run `npm run expand:gov-history` for bulk 2014/2022 fill)
2. Run `npm run seed:gov` (host) or `docker exec ... node scripts/seed-governorship-results.js`
3. Hard-refresh browser (Ctrl+F5)

### LGA name matching

Shapefile LGA names often differ from polling-unit register names (e.g. `Shomolu` vs `Somolu`, `Ibeju Lekki` vs `Ibeju/Lekki`). Aliases live in `lga-normalize.js` and are mirrored in `eid-maps.js`. If an LGA appears grey on the choropleth, add an alias there and re-test.

---

## 10. Boundary upload workflow

1. Sign in at http://localhost:3010/admin/index.html
2. Go to **Upload boundaries** or use in-app Admin → Upload datasets
3. Upload `.zip` shapefile or full `.shp` + `.dbf` + `.shx` set
4. **Import state boundaries before LGA** (LGA import needs state codes)
5. Optional layer hint: `state`, `lga`, or `ward` (auto-detect if omitted)

Uploaded files are archived under `data/boundaries/uploads/` and features are stored in SQLite.

---

## 11. Docker volume mounts

```yaml
./data/election-results     → JSON datasets (shared host/container)
./data/boundaries           → upload archive
./data/governorship-history.json
./Shapefiles                → read-only seed source
./public                    → live UI edits without rebuild
./admin                     → live admin UI edits without rebuild
./scripts                   → live seed script changes
./lga-normalize.js          → live alias updates
./election-results-data.js  → live choropleth logic updates
election-db (named volume)  → SQLite (NOT on host filesystem)
```

Rebuild image when `package.json` dependencies change:

```powershell
docker compose up --build -d
```

---

## 12. Environment variables

See `.env.example`. Key variables:

| Variable | Default | Notes |
|----------|---------|-------|
| `PORT` | `3010` | HTTP port |
| `ELECTION_DB_PATH` | `./data/election-dashboard.db` | Overridden in Docker |
| `ELECTION_RESULTS_DIR` | `./data/election-results` | |
| `BOUNDARIES_DIR` | `./data/boundaries` | |
| `SQLITE_JOURNAL_MODE` | `DELETE` | Set in Docker to avoid WAL issues on Windows mounts |
| `NEWS_API_KEY` | — | Optional; 401 in logs if missing (non-fatal) |
| `GOOGLE_MAPS_API_KEY` | — | Optional geocoding |

---

## 13. Known limitations and gotchas

1. **Two SQLite databases** — host `data/election-dashboard.db` vs Docker volume `election-db`. Always seed/reimport in the environment you are running.

2. **Mixed LGA result quality** — Statewide totals are sourced for all 36 states × 4 years. Four elections have official INEC LGA collated totals; others use PVC-proportional LGA allocation (documented in `meta.lgaMethod`).

3. **2014/2018 not universal election years** — Nigeria uses staggered governorship cycles; the app shows all states for those years using incumbent/historical names, not necessarily an election held that year in every state.

4. **Duplicate project folder** — A nested `Election Dashboard/` directory exists with older copies of some files. The **repo root** is the active codebase.

5. **Default admin password** — `admin` / `admin123` is hardcoded; change before production.

6. **NewsAPI / GDELT errors on startup** — stderr messages about 401/timeout are expected without API keys; server still runs.

7. **`admin/editor.html`** — Empty placeholder; not implemented.

8. **Git** — Most files were untracked at handoff time; consider initial commit and `.gitignore` review (exclude `.env`, `*.db`, large shapefiles if needed).

---

## 14. Troubleshooting

| Symptom | Likely cause | Fix |
|---------|--------------|-----|
| Blank admin page after login | Was empty `dashboard.html` (fixed) | Ensure latest `admin/dashboard.html` is deployed |
| Container crash-loop (exit 139) | Node 20 + sqlite3 | Use Node 22 in Dockerfile (already set) |
| SQLite disk I/O error on Docker | WAL on Windows bind mount | DB moved to named volume `election-db` |
| Gov dropdown 404 | Old server process | Restart container / `docker compose up -d` |
| LGAs grey on map | Name mismatch | Add alias in `lga-normalize.js`, refresh |
| Party names not candidate names | Old seed data | Run `npm run seed:gov` with latest scripts |
| Upload fails 401 | Not signed in | Login at `/admin/index.html` first |
| Changes not in Docker | Stale image | `docker compose up --build -d` |

---

## 15. Recommended next steps

- [ ] Replace default admin credentials; move to env vars
- [ ] Import more official INEC LGA collated results (replace PVC-proportional splits where LGA data exists)
- [ ] Auto-generate LGA alias map from shapefile vs polling-unit diff script
- [ ] Wire `admin/editor.html` or remove dead routes
- [ ] Initial git commit; exclude secrets and large binaries
- [ ] Production deployment guide (HTTPS, reverse proxy, persistent backups of `election-db`)
- [ ] README sync — update governorship seed docs (now LGA-level, not state-level)

---

## 16. Session changelog (Aug 2026)

Work completed in the development session leading to this handoff:

- Docker dev environment (Node 22, named DB volume, compose mounts)
- LGA-level governorship seeding (36 states × 4 years)
- Dynamic gov state API + map choropleth at LGA level
- Per-candidate expandable won-LGA lists in UI
- Admin boundary upload → SQLite → map (state/LGA/ward)
- Admin console built (`dashboard.html`, `upload.html`) and linked from main app
- Official INEC LGA import pipeline (`generate-official-governorship.js`, `import-official-governorship.js`, `meta.collated` guard in seed)
- Expanded `governorship-history.json` — 36 states × 2014, 35 × 2018, 36 × 2022 with real candidate names
- Official datasets: Ekiti 2014/2018/2022, Osun 2018 (78 LGA-level collated units total)
- LGA name alias normalization for shapefile ↔ election data matching
- Ward shapefile upload verified working by user

---

## 17. Contacts and credentials

| Item | Value |
|------|-------|
| Primary Google admin | `geoinfotechgisteam@gmail.com` (OAuth admin console) |
| Username admin | `admin` / `admin123` (change before production) |
| Admin login | http://localhost:3010/admin/index.html |
| Google admin | http://localhost:3010/admin-login.html |

---

*For questions about map behaviour start with `public/js/eid-maps.js` and `election-results-data.js`. For data pipeline questions start with `db.js`, `scripts/seed-governorship-results.js`, and `boundaries-data.js`.*
