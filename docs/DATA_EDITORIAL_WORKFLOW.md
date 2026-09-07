# Data editorial workflow

## Publication lifecycle

`draft → validation_failed | in_review → verified → published`

Any unpublished revision can be quarantined with a reason. Publishing a new verified revision supersedes the prior published revision. Published rows are immutable through the API.

The canonical contest identity is office, jurisdiction code, constituency, actual election date, election type, and phase. Supported offices are president, governor, senate, house, and state assembly. Supported phases are initial, supplementary, and rerun.

## Evidence rule

Every candidate total must cite either:

1. a specific INEC result document, form, or page; or
2. two distinct reputable independent publishers that agree.

Each source records publisher, URL, document type and date, retrieval timestamp, page/form reference, SHA-256, and immutable storage key. Upload the original first with `POST /api/v1/admin/sources`; draft creation re-reads it and checks the checksum.

IReV images are supporting transparency evidence. They do not replace legally declared totals at the required collation level. The declared winner is an explicit editorial field and is never inferred from the highest numeric total.

## Validation

Validation checks JSON shape, actual dates, unique contest components, unique candidates and reporting units, expected reporting-unit count, non-negative integer votes, candidate-vote arithmetic, register/accreditation arithmetic, evidence for each total, exact source checksums, and prohibited modeled methodologies.

The import template is [result-dataset.example.json](../data/templates/result-dataset.example.json). Use normalized UTF-8 JSON for the full workflow. CSV is supported for normalized tabular source preparation, but it must be transformed into the canonical JSON contract before draft submission.

## Protected endpoints

- `POST /api/v1/admin/sources`
- `POST /api/v1/admin/datasets/drafts`
- `POST /api/v1/admin/datasets/:id/validate`
- `POST /api/v1/admin/datasets/:id/submit`
- `POST /api/v1/admin/datasets/:id/review`
- `POST /api/v1/admin/datasets/:id/publish`
- `POST /api/v1/admin/datasets/:id/quarantine`
- `GET /api/v1/admin/datasets`
- `GET /api/v1/admin/audit-events`

Writes require an authenticated secure-cookie session plus the `X-CSRF-Token` returned by `GET /api/admin/me`.

## Public endpoints

- `GET /api/v1/contests`
- `GET /api/v1/contests/:id`
- `GET /api/v1/contests/:id/results`
- `GET /api/v1/datasets/:id/sources`

Legacy result routes carry deprecation headers and return no quarantined result totals.

## PVC and population data

The INEC February 2023 state PVC table sums to 87,209,007 collected cards. INEC's later 2023 General Election Report states 87,394,106 in narrative, a difference of 185,099, while presenting the same state series. Both values and the unresolved discrepancy are returned in `nationalSummary`; neither is silently substituted.

Population values in the legacy file are withheld by public APIs because their product, vintage, and licence are undocumented. They may be enabled only after metadata identifies a dated GRID3/WorldPop product and its licence and an editor changes the population status to `verified`.
