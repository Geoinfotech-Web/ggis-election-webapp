# Technical reference

How the Election Dashboard is wired today. Routes below are the handlers in `server.js`. Query names match those handlers.

## Architecture

```
Browser
  public/index.html          SPA (DCLogic in one HTML file)
  public/js/eid-*.js         maps, analysis, page content, data explorer
  public/vendor/leaflet      Leaflet 1.9
        |
        v
server.js (Express 5)
  static public/ and /admin/
  JSON + SQLite result and polling-unit APIs
  Postgres sessions + /api/v1 editorial workflow
```

| Piece | Path | Role |
| --- | --- | --- |
| SPA | `public/index.html` | Welcome + app shell. Default `section` is Overview, default `basemap` is `streets`. |
| Map client | `public/js/eid-maps.js` | Leaflet, basemap ids, GRID3 and local boundary overlays, choropleth paint. |
| Analysis client | `public/js/eid-analysis.js` | Analysis sub-tabs and charts. |
| Page content client | `public/js/eid-page-content.js` | Loads `GET /api/page-content/:country` and falls back to built-in nav. |
| Data explorer | `public/js/eid-data-explorer.js` | Data page catalog and downloads. |
| HTTP server | `server.js` | Routes, cookies, static files, population redaction. |
| Results | `election-results-data.js` | Choropleth, governorship catalog, party colours, publishable JSON. |
| Analysis | `election-analysis.js` | `buildAnalysisBundle`, `sliceAnalysisPayload`. |
| SQLite | `db.js` | Polling units, seeded election datasets, live submissions. Default `data/election-dashboard.db`. |
| Boundaries | `boundaries-data.js` | Local state / LGA / ward GeoJSON in SQLite. |
| Catalog | `src/data-catalog.js` | Public dataset list and download builder. |
| Auth | `src/admin-auth.js` | Username, scrypt password, allow-list. |
| Sessions | `src/editorial-store.js` | Postgres `admin_sessions` (token hash, CSRF, expiry). |
| Pages | `src/page-content-store.js` | `data/page-content.json`. |
| Maps studio | `src/map-configs-store.js` | `data/map-configs.json`. |
| Dashboards | `src/dashboard-layouts.js` | Overview and Live layouts. |
| Editorial rules | `src/result-validation.js` | Used by `/api/v1` draft/publish, not by the public JSON maps. |

`express.static` serves `public/` at `/`. `/admin/*` is served only after a valid admin cookie (`requireAdminPage`), otherwise the browser is redirected to `/admin-login.html`.

Docker (`docker-compose.yml`) runs PostGIS 16, the Node app, a one-shot secrets init, and a daily `pg_dump` loop. The app container listens on `3010` and is published as `127.0.0.1:3010:3010`. Host bind mounts cover `public/`, `data/election-results/`, `data/reference/`, `src/`, `server.js`, and `election-results-data.js` / `election-analysis.js`, so those edits show up without an image rebuild. SQLite lives in the `legacy-db` volume at `/app/data/db/election-dashboard.db`.

`PORT` defaults to `3000` and `HOST` to `127.0.0.1` when Node is started outside Compose.

## Data on disk

`ELECTION_RESULTS_DIR` defaults to `data/election-results/`.

| Location | Contents |
| --- | --- |
| `presidential-2015-states.json`, `presidential-2019-states.json`, `presidential-2023-states.json` | State presidential totals. Listed in `STATIC_INDEX`. |
| `presidential-2023-lga.json` | Presidential LGA tallies. 2015 and 2019 have no LGA pack in `STATIC_INDEX`. |
| `gubernatorial/{state}-{storageYear}.json` | Governorship packs. Public years are the verified subset (see below). |
| `house/`, `senatorial/` | House and Senate archives used for state seat choropleths. |
| `official/` | Extra governorship LGA files scanned by the data catalog. |
| `data/reference/population-pvc-data.json` | Population and PVC register. Public population counts are withheld. |
| `data/reference/Nigeria_polling_units.csv` | Polling-unit register seeded into SQLite. |

A governorship pack is public when `isVerifiedGovMeta` is true: `meta.collated === true` and the pack is not `lgaMethod === 'pvc-proportional'`, `modeled`, or `synthetic`. `listGovCatalog` keeps one entry per state and election calendar year (duplicate fingerprints prefer the verified pack whose storage year is closest to the election year). `GET /api/election-results/choropleth` for `office=gov` returns `{ ok: false, message: 'No verified LGA collation for this state and year.' }` when that filter fails.

`QUARANTINE_LEGACY_RESULTS=true` is off by default. When set, `isPublishableLegacyPayload` also requires `publicationStatus: published` and evidence, and startup quarantines legacy SQLite election rows.

## Map stack

Leaflet is loaded from `public/vendor/leaflet/leaflet.js`. Basemap ids in `public/js/eid-maps.js` and `src/map-configs-store.js`:

| Id | Tiles |
| --- | --- |
| `streets` | Google `lyrs=m`. SPA default (`state.basemap` in `public/index.html`). Overview map config default. |
| `osm` | `https://{s}.tile.openstreetmap.fr/osmfr/{z}/{x}/{y}.png` (OpenStreetMap France). Polling-units map config default. |
| `hybrid` | Google `lyrs=y` |
| `satellite` | Google `lyrs=s` |
| `terrain` | Google `lyrs=p` |
| `dark`, `light` | CARTO `dark_all` / `light_all` |

Overlay layer ids: `state`, `lga`, `ward`, `polling`, `health`.

Boundary load order in `eid-maps.js` `loadLayer`:

1. Local GeoJSON from `GET /api/boundaries/:layer` (`state`, `lga`, `ward`). State outlines prefer the full local layer.
2. Same-origin GRID3 proxy `GET /api/grid3/:layer` (`state`, `lga`, `ward`, `health`).
3. Direct GRID3 ArcGIS FeatureServer query (URLs also returned by `GET /api/grid3-config`).

Polling points come from `GET /api/polling-unit-points`. Local boundary rows are GRID3-derived admin polygons seeded into SQLite (`npm run seed:boundaries` reads shapefiles via `scripts/seed-boundaries.js`). They are not Stears constituency polygons.

Choropleth styling uses `party-winner` or `turnout` (`choroplethTheme` on a map config). Party colours: `GET /api/party-colors` and the `PARTY_COLORS` map in `election-results-data.js`.

Public map configs: `GET /api/maps/views` (assignments for `overview`, `polling`, `live`) and `GET /api/maps/:id`.

## Analysis

`GET /api/election-results/analysis` calls `buildAnalysisBundle` and then `sliceAnalysisPayload`.

Query parameters:

| Param | Default | Meaning |
| --- | --- | --- |
| `office` | `pres` | `pres`, `gov`, `sen`, `reps` (whatever the archive loader accepts). |
| `year` or `election` | empty | Focus year. |
| `compare` | empty | Comparison year. |
| `party` | `all` | Party filter. |
| `region` | `all` | Geopolitical zone. |
| `state` | `all` | State filter. |
| `momentum` | bundle default | Momentum weight. |
| `retention` | bundle default | Retention weight. |
| `cutoff` | bundle default | Competitive cutoff. |
| `part` | full payload | `overview`, `geography`, `turnout`, `trends`, `demographics`, `quality`, `shell`, `full`. |

The bundle is cached in process for 5 minutes. Governorship series inside the bundle use `listGovCatalog`, so estimated LGA years are already excluded. National presidential turnout constants for 2015, 2019, and 2023 live in `election-analysis.js` (`NATIONAL_TURNOUT`).

Analysis sub-tab ids match `part`: overview, geography, turnout, trends, demographics, quality. The Pages studio can hide or relabel them per country.

## Data catalog

`GET /api/data-catalog` returns `publicCatalogForClient(buildDataCatalog())`. Categories: `results`, `candidates`, `geography`, `reference`, `catalogs`.

Result rows are JSON files that pass `isPublishableLegacyPayload`. Governorship files under `gubernatorial/` are included only when `isVerifiedGovMeta` is true. House, Senate, and `official/` JSON are listed when publishable.

`GET /api/data-catalog/download?id={catalogId}&format=json|csv`

- `id` is required (400 if missing).
- Unknown or non-public ids return 404.
- Static ZIP/CSV entries redirect or send the file.
- JSON/CSV for API-backed entries are built in process (`buildDownload`). Population downloads call `preparePublicPopulationData`, so withheld population counts stay withheld.

Examples of stable ids (full list is the `id` fields in `src/data-catalog.js`): `candidates:presidential`, `reference:population-pvc`, `reference:party-colors`, `geography:boundaries-state`, `geography:adm1-zip`, `catalogs:gov`, `catalogs:analysis-pres-2023`.

`GET /api/election-results/datasets` is a shorter index (`office`, `year`, `state`, `level`, `file`) plus `catalogUrl: /api/data-catalog`.

## Main public APIs

Health:

- `GET /health/live` → `{ ok: true }`
- `GET /health/ready` → 200 when the process is initialized and, in production, when Postgres is ready; otherwise 503

Results and maps:

- `GET /api/election-results?state=` — state result payload (news + archive). Sends a `Deprecation` header; successor link is `/api/v1/contests`.
- `GET /api/election-results/ekiti` — same helper for Ekiti.
- `GET /api/election-results/gov-states?year=` → `{ year, states, count }`
- `GET /api/election-results/gov-catalog` → `{ states, byState, count }`
- `GET /api/election-results/choropleth?office=&year=&state=`
- `GET /api/party-colors`
- `GET /api/nigeria-kpis?state=&lga=&ward=&pu=&year=`

Polling units:

- `GET /api/polling-directory?state=&lga=` → state names, then LGAs, then wards
- `GET /api/polling-unit-points?state=&lga=&ward=&q=&bbox=&limit=&enrich=`
- `GET /api/polling-units.geojson`
- `GET /api/polling-units-data`
- `GET /api/geocode?q=` — Nominatim, Nigeria only, minimum 3 characters
- `GET /api/route?fromLat=&fromLng=&toLat=&toLng=` — OSRM driving route

Reference:

- `GET /api/population-data` — local JSON, or a configured Drive file with local fallback. Population numbers are null unless `metadata.population.status === 'verified'`.
- `GET /api/population-data/status`
- `GET /api/v1/reference-summary` — voter-register summary plus polling-unit coordinate coverage
- `GET /api/boundaries/status`
- `GET /api/boundaries/:layer` — `state`, `lga`, or `ward`. Query: `bbox`, `state`, `lga`, `ward`, `limit`
- `GET /api/grid3-config`
- `GET /api/grid3/:layer` — `state`, `lga`, `ward`, `health`. Query: `bbox`, `max` (capped at 2000)

Citizen sheets:

- `GET /api/live-submissions?status=` — omitted `status` is treated as `all` and returns every row. The filter is an exact SQL match. Stored values are `Pending review`, `Approved`, and `Rejected`. The catalog href passes `status=approved`, which does not match `Approved`.
- `POST /api/live-submissions` — multipart image plus `lat`, `lng`, `pu`, `state` (and optional `lga`, `ward`, `pu_code`, `accuracy`, `note`). New rows are stored as `Pending review`. This route is public.

Published CMS:

- `GET /api/page-content/:country`
- `GET /api/dashboards/:page` — `overview` or `live`
- `GET /api/maps/views`
- `GET /api/maps/:id`

Editorial (Postgres, empty until a revision is published):

- `GET /api/v1/contests`
- `GET /api/v1/contests/:id`
- `GET /api/v1/contests/:id/results`
- `GET /api/v1/datasets/:id/sources`
- `GET /api/elections` — same published contests, with a `Deprecation` header

These return 503 when `EDITORIAL_DATABASE_URL` is not configured.

`GET /api/inec-ingest/status` reports the INEC discovery ingest. Discovery itself runs only when `ENABLE_INEC_DISCOVERY=true` (Compose sets it to `false`).

## Admin auth

Local login only.

1. `POST /api/admin/login` with JSON `{ username, password }` (a legacy `email` field is accepted as the username). Rate limit: 10 attempts per 15 minutes.
2. `src/admin-auth.js` checks env bootstrap or `data/admin-credentials.json` (scrypt). The email must be on the allow-list (`admin-access.json`, plus in-memory adds).
3. `editorialStore.createAdminSession` inserts a row and returns a token plus `csrfToken`.
4. The response sets cookie `election_admin_session` (`Path=/; HttpOnly; SameSite=Lax`, 12 hours). `Secure` is added only when `COOKIE_SECURE=true`.

`GET /api/admin/me` returns `{ email, name, isPrimary, csrfToken }`. `isPrimary` is true when the session email equals `PRIMARY_ADMIN_EMAIL`.

`requireAdminApi` accepts the cookie only. `requireAdminWrite` also requires header `X-CSRF-Token` equal to the session CSRF token (403 otherwise). `POST /auth/logout` is a write: it deletes the session row and clears the cookie.

`/auth/google` → 302 `/admin-login.html`. `/auth/google/callback` → 410.

Primary-only routes: `GET/POST /api/admin/access`, `DELETE /api/admin/access/:email`. The primary email cannot be removed.

### Pages studio

UI: `admin/pages.html`, `admin/page-studio.js`. Store: `src/page-content-store.js`.

| Method | Path | Auth |
| --- | --- | --- |
| GET | `/api/admin/pages` | session |
| GET | `/api/admin/pages/:country` | session |
| PUT | `/api/admin/pages/:country` | session + CSRF. Body `bundle` or the body itself. Saves a draft. |
| POST | `/api/admin/pages/:country/publish` | session + CSRF |
| POST | `/api/admin/pages/:country/revert` | session + CSRF |

Country codes: `global`, `ng`, `us`, `gb`, `gh`, `ke`, `in`, `de`, `fr`, `br`, `za`.

Default nav ids: `Overview`, `Map` (label “Polling units”), `Live Results`, `Candidates`, `Parties`, `Analysis`, `Data`, `About`.

### Other admin routes

All of these need a session. Mutations need CSRF.

- Maps: `GET/POST /api/admin/maps`, `GET/PUT/DELETE /api/admin/maps/:id`, `PUT /api/admin/maps/assignments`
- Dashboards: `GET /api/admin/dashboards`, `GET/PUT /api/admin/dashboards/:page`, `POST .../publish`, `POST .../revert` (`page` is `overview` or `live`)
- Candidates: `GET /api/admin/candidates`, `GET/PUT /api/admin/candidates/:catalog`
- Boundaries: `POST /api/admin/boundaries/upload`, `DELETE /api/admin/boundaries/:layer`
- SQLite: `GET /api/admin/db/status`, `POST /api/admin/db/reimport-polling-units`, `POST /api/admin/db/reimport-election-results`
- Live review: `PATCH /api/live-submissions/:id` with `{ status, note }`
- Population source: `GET/POST /api/admin/population-source`
- Editorial drafts: `/api/v1/admin/datasets...` and `/api/v1/admin/sources` (see `docs/DATA_EDITORIAL_WORKFLOW.md`)

Drive search (`/api/admin/drive/*`, `/api/drive/search`, `/api/drive/read`) returns 503 unless server-side Drive credentials exist. Admin login does not configure Drive.

## Security notes that affect operators

- Helmet CSP allows `'unsafe-inline'` and `'unsafe-eval'` because the SPA compiles in the browser, and allows Google, ArcGIS, OSM-related image hosts, NewsAPI, GDELT, and BBC connect targets.
- CORS allows `CORS_ORIGINS` or `BASE_URL`. Credentials are included.
- Login and `/api/admin` are rate-limited.
- In production, startup throws if the session secret is shorter than 32 characters, the editorial database URL is missing, or `BASE_URL` is unset.
