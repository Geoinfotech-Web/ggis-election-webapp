# Production readiness status

Status as of 2026-09-07: implementation remains incomplete. The local application, PostgreSQL, and backup service are running through Docker Compose, with the web application bound to `127.0.0.1:3010` and the required D: archive drive mounted.

The served UI now reproduces the Global Overview design system's global scope, filter rail, KPI row, two-tier map controls, and Live/Upcoming/Recent side panels. It uses attributed Esri World Dark Gray Canvas and World Imagery basemaps, plus a configuration-driven country registry and local Nigeria state boundaries. It deliberately replaces the design prototype's synthetic election feed with verified empty states and hides polling-unit points whose coordinates are unavailable. Country detail, deeper contest and administrative drill-down, and the protected editorial interface remain incomplete.

The polling-cache migration fingerprints the canonical CSV and replaces obsolete caches transactionally. It has run successfully in the application container and the live API now reports 176,846 records, one source-provided coordinate pair, and 176,845 unavailable coordinates. Blank coordinate cells and number pairs embedded in address text have regression coverage and are not interpreted as coordinates.

## Implemented

- localhost-only Compose publishing and no host Postgres port
- generated persistent local secrets, required production configuration, non-root container
- Google OAuth-only admin sessions, allow-list, CSRF, session revocation, preparer/approver separation
- Helmet/CSP, same-origin CORS, rate limits, request limits, upload filename/signature/archive limits
- PostgreSQL 16/PostGIS provenance, version, review, audit, source, contest, result, and geography schema
- evidence/checksum/arithmetic/date/duplicate/methodology validation
- immutable publication lifecycle and versioned public API
- legacy election data excluded from public result APIs
- missing polling-unit coordinates kept null; unsourced population withheld
- runtime XLSX ingestion and `xlsx` dependency removed
- readiness/liveness endpoints, migrations-before-listen, unit/integration tests, CI
- duplicate subtree archived externally and removed from version control
- local database backup restored successfully into a disposable database on 2026-09-04 (`0` contests, `0` datasets, `1` applied migration)

## Launch blockers

- Rebuild the selected 2015-present president, governor, senate, house, and state assembly corpus from declaration-level evidence. Current public result count is intentionally zero.
- Obtain and archive each original source; achieve 100% evidence links and two-person review.
- Resolve or formally annotate the 185,099 INEC PVC national-total discrepancy.
- Identify population product, vintage, methodology, and licence before exposing population estimates.
- Configure Google OAuth and two named editor accounts.
- Configure a versioned GCS bucket and test cloud restore/PITR; only the local dump/restore path has been exercised.
- Rehearse migration rollback, run security tests beyond the included regression suite, and complete representative map/API load tests.
- Keep the D: source archive connected while the local stack is running; add an explicit startup warning or degraded mode for archive-drive loss.
- Complete contest detail, state/LGA drill-down, and the protected editorial workflow interface. The current overview map is an accurate reference layer, not a result choropleth.
- Resolve the two remaining moderate dependency advisories involving uuid/gaxios. The online audit succeeded on 2026-09-07; compatible dependency updates removed four other reported advisories. Offline audit results are not a launch gate.

Do not enable public DNS until every blocker above has an accountable owner and recorded acceptance evidence.
