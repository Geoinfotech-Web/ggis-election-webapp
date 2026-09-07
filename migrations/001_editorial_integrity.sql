CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS postgis;

DO $$ BEGIN
  CREATE TYPE dataset_status AS ENUM (
    'draft', 'validation_failed', 'in_review', 'verified', 'published', 'quarantined', 'superseded'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS schema_migrations (
  version text PRIMARY KEY,
  applied_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS contests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  office text NOT NULL CHECK (office IN ('president', 'governor', 'senate', 'house', 'state_assembly')),
  jurisdiction_code text NOT NULL,
  jurisdiction_name text NOT NULL,
  constituency_name text NOT NULL DEFAULT '',
  election_date date NOT NULL,
  election_type text NOT NULL CHECK (election_type IN ('general', 'off_cycle', 'bye_election')),
  phase text NOT NULL CHECK (phase IN ('initial', 'supplementary', 'rerun')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (office, jurisdiction_code, constituency_name, election_date, phase)
);

CREATE TABLE IF NOT EXISTS dataset_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contest_id uuid NOT NULL REFERENCES contests(id),
  version integer NOT NULL CHECK (version > 0),
  status dataset_status NOT NULL DEFAULT 'draft',
  title text NOT NULL,
  methodology text NOT NULL,
  coverage text NOT NULL CHECK (coverage IN ('legal_declaration', 'lga', 'ward', 'polling_unit')),
  as_of timestamptz NOT NULL,
  declared_winner_ref text,
  payload jsonb NOT NULL,
  validation_report jsonb NOT NULL DEFAULT '{"valid":false,"errors":["Not validated"]}'::jsonb,
  prepared_by text NOT NULL,
  submitted_at timestamptz,
  verified_at timestamptz,
  published_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (contest_id, version)
);

CREATE UNIQUE INDEX IF NOT EXISTS one_published_dataset_per_contest
  ON dataset_versions(contest_id) WHERE status = 'published';
CREATE INDEX IF NOT EXISTS dataset_versions_status_idx ON dataset_versions(status, published_at DESC);

CREATE TABLE IF NOT EXISTS candidates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dataset_version_id uuid NOT NULL REFERENCES dataset_versions(id) ON DELETE CASCADE,
  candidate_ref text NOT NULL,
  name text NOT NULL,
  party text NOT NULL,
  UNIQUE (dataset_version_id, candidate_ref)
);

CREATE TABLE IF NOT EXISTS reporting_units (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dataset_version_id uuid NOT NULL REFERENCES dataset_versions(id) ON DELETE CASCADE,
  unit_ref text NOT NULL,
  name text NOT NULL,
  level text NOT NULL CHECK (level IN ('national', 'state', 'lga', 'ward', 'polling_unit', 'constituency')),
  jurisdiction_code text NOT NULL,
  geometry geometry(Geometry, 4326),
  geometry_source text,
  UNIQUE (dataset_version_id, unit_ref)
);

CREATE TABLE IF NOT EXISTS result_totals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dataset_version_id uuid NOT NULL REFERENCES dataset_versions(id) ON DELETE CASCADE,
  reporting_unit_ref text NOT NULL,
  candidate_ref text NOT NULL,
  votes bigint NOT NULL CHECK (votes >= 0),
  UNIQUE (dataset_version_id, reporting_unit_ref, candidate_ref)
);

CREATE TABLE IF NOT EXISTS vote_summaries (
  dataset_version_id uuid NOT NULL REFERENCES dataset_versions(id) ON DELETE CASCADE,
  reporting_unit_ref text NOT NULL,
  registered_voters bigint CHECK (registered_voters >= 0),
  accredited_voters bigint CHECK (accredited_voters >= 0),
  valid_votes bigint NOT NULL CHECK (valid_votes >= 0),
  rejected_votes bigint CHECK (rejected_votes >= 0),
  PRIMARY KEY (dataset_version_id, reporting_unit_ref)
);

CREATE TABLE IF NOT EXISTS sources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dataset_version_id uuid NOT NULL REFERENCES dataset_versions(id) ON DELETE CASCADE,
  source_ref text NOT NULL,
  publisher text NOT NULL,
  publisher_type text NOT NULL CHECK (publisher_type IN ('inec', 'independent')),
  url text NOT NULL,
  document_type text NOT NULL,
  document_date date NOT NULL,
  retrieved_at timestamptz NOT NULL,
  page_reference text NOT NULL,
  sha256 char(64) NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  storage_key text NOT NULL,
  UNIQUE (dataset_version_id, source_ref)
);

CREATE TABLE IF NOT EXISTS evidence_links (
  dataset_version_id uuid NOT NULL REFERENCES dataset_versions(id) ON DELETE CASCADE,
  result_total_id uuid NOT NULL REFERENCES result_totals(id) ON DELETE CASCADE,
  source_id uuid NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
  PRIMARY KEY (result_total_id, source_id)
);

CREATE TABLE IF NOT EXISTS reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dataset_version_id uuid NOT NULL REFERENCES dataset_versions(id) ON DELETE CASCADE,
  reviewer_email text NOT NULL,
  decision text NOT NULL CHECK (decision IN ('approved', 'rejected')),
  notes text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (dataset_version_id, reviewer_email)
);

CREATE TABLE IF NOT EXISTS audit_events (
  id bigserial PRIMARY KEY,
  actor_email text NOT NULL,
  action text NOT NULL,
  entity_type text NOT NULL,
  entity_id uuid,
  detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS admin_sessions (
  token_hash char(64) PRIMARY KEY,
  email text NOT NULL,
  name text NOT NULL DEFAULT '',
  picture text NOT NULL DEFAULT '',
  csrf_token text NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS admin_sessions_expiry_idx ON admin_sessions(expires_at);
