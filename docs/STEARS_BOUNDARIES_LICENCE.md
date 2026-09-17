# Stears constituency boundaries — licence decision

**Decision: do-not-bundle** (link-only reference; no GeoJSON/shapefile download into this repo or deploy artifact)

**Date:** 2026-09-17  
**Plan todo:** `boundaries-licence` (Phase 4)

## Source reviewed

Article: [Where is my constituency? Stears' journey to mapping Nigeria's boundaries](https://www.stears.co/article/where-is-my-constituency-stears-journey-to-mapping-nigerias-boundaries/) (Hannah Kates, 12 Jun 2023)

Relevant Stears terms (article, “Using the data responsibly”):

- Datasets cover **House of Representatives** and **State Houses of Assembly** constituency polygons (built from GRID3 ward/LGA blocks; some approximated).
- Released as open data for **civic-minded** projects.
- Explicit restriction: **“This data is intended for non-commercial usage only.”**
- Download is offered at the bottom of that article (not mirrored here).

Stears Open Data / site legal copy also restricts reproduction/redistribution without written permission. Plan compliance already excludes commercial Stears PE/deals products and requires licence confirmation before any constituency boundary layer.

## How this product is positioned

| Signal | Finding |
|--------|---------|
| Org / repo | `Geoinfotech-Web/Election-Dashboard` |
| Vendor | [Geoinfotech](https://geoinfotech.ng/) — commercial GIS / web-mapping / dashboard services for clients |
| Product family | GGIS-style webapps (same design system as other Geoinfotech products) |
| Repo docs | Local-first editorial election app with planned cloud deploy (`HANDOFF.md`, `docs/PRODUCTION_READINESS.md`) |
| Licence posture in-repo | Strict about documenting licences before exposing datasets (e.g. population withheld until product/vintage/licence verified) |

Even if the dashboard’s *subject matter* is civic (elections transparency), the **deploy context** is a commercial GIS vendor product / client-facing GGIS application. That conflicts with Stears’ **non-commercial only** boundary grant. We do not have a written Stears commercial licence.

## Verdict

| Option | Allowed? |
|--------|----------|
| Bundle Stears HoR / SHA GeoJSON into `public/data/boundaries/` or SQLite seed | **No** |
| Ship Stears polygons in Docker/cloud images | **No** |
| Link users to the Stears article / their own download for personal non-commercial use | **Yes** (attribution via link) |
| Use Stears **election result** figures (separate from this boundary dataset) under normal citation rules | Out of scope of this file; see Stears Elections ingest plan — cite Stears + INEC; do not treat this boundary licence as covering results |

**Attribution required if linking:** credit Stears (and note approximations + non-commercial terms) when pointing to their constituency maps or article.

**No download performed** for this decision. Hypothetical bundle path if a future written commercial licence were obtained: e.g. `public/data/boundaries/stears-hor.geojson` and `stears-sha.geojson` (or zip), imported via `boundaries-data.js` / `npm run seed:boundaries` — **not authorized today**.

## Recommended alternative for maps

1. **Keep using bundled admin boundaries already in-repo:** `public/data/boundaries/adm0.zip`, `adm1.zip`, `adm2.zip` (state / LGA), seeded from GRID3-derived shapefiles (`scripts/seed-boundaries.js`).
2. **Choropleth / drill-down** for presidential and gubernatorial results at **state and LGA** (adm1 / adm2) — no Stears constituency polygons required.
3. For **House / Senate / State Assembly** geography: map at **LGA or state** until an INEC- or GRID3-compatible constituency layer with a clear commercial-friendly licence is available, or obtain a **written Stears commercial licence**.
4. Optional UX: external “About boundaries” note linking the Stears article for readers who want constituency polygons under Stears’ own non-commercial terms — **do not** host the files.

## Revisit triggers

Re-open bundling only if one of the following is true and recorded here:

- Stears grants written permission for commercial / client-deploy use of these GeoJSON/shapefiles; or
- Stears republishes the same layers under a licence that clearly allows this product’s commercial deploy (e.g. CC BY / ODbL without NC); or
- This application is permanently re-scoped as a non-commercial civic-only project with no commercial Geoinfotech packaging or paid client delivery.
