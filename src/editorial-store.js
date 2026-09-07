const crypto = require('crypto');
const fs = require('fs/promises');
const path = require('path');
const { Pool } = require('pg');
const { validateResultDataset } = require('./result-validation');
const { getEditorialDatabaseUrl } = require('./config');
const { verifySource } = require('./storage');

const databaseUrl = getEditorialDatabaseUrl();
let pool;
let initialized = false;

function isEnabled() {
  return Boolean(databaseUrl);
}

function getPool() {
  if (!isEnabled()) return null;
  if (!pool) {
    pool = new Pool({
      connectionString: databaseUrl,
      max: Number(process.env.PG_POOL_MAX || 10),
      connectionTimeoutMillis: 5000,
      idleTimeoutMillis: 30000,
      ssl: process.env.PG_SSL === 'true' ? { rejectUnauthorized: process.env.PG_SSL_REJECT_UNAUTHORIZED !== 'false' } : false,
    });
  }
  return pool;
}

async function initializeEditorialStore() {
  if (!isEnabled()) return { enabled: false, ready: false };
  const sql = await fs.readFile(path.join(__dirname, '..', 'migrations', '001_editorial_integrity.sql'), 'utf8');
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    await client.query(sql);
    await client.query(
      `INSERT INTO schema_migrations(version) VALUES ($1) ON CONFLICT (version) DO NOTHING`,
      ['001_editorial_integrity']
    );
    await client.query(`DELETE FROM admin_sessions WHERE expires_at <= now()`);
    await client.query('COMMIT');
    initialized = true;
    return { enabled: true, ready: true };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function readiness() {
  if (!isEnabled()) return { enabled: false, ready: false };
  try {
    const result = await getPool().query(`SELECT 1 AS ok`);
    return { enabled: true, ready: initialized && result.rows[0].ok === 1 };
  } catch (error) {
    return { enabled: true, ready: false, error: error.message };
  }
}

function tokenHash(token) {
  return crypto.createHash('sha256').update(String(token || '')).digest('hex');
}

async function createAdminSession(admin, ttlMs) {
  if (!initialized) throw new Error('Editorial database is not ready.');
  const token = crypto.randomBytes(32).toString('base64url');
  const csrfToken = crypto.randomBytes(24).toString('base64url');
  await getPool().query(
    `INSERT INTO admin_sessions(token_hash, email, name, picture, csrf_token, expires_at)
     VALUES ($1, $2, $3, $4, $5, now() + ($6 * interval '1 millisecond'))`,
    [tokenHash(token), admin.email.toLowerCase(), admin.name || '', admin.picture || '', csrfToken, ttlMs]
  );
  return { token, csrfToken };
}

async function getAdminSession(token) {
  if (!token || !initialized) return null;
  const result = await getPool().query(
    `SELECT email, name, picture, csrf_token AS "csrfToken", expires_at AS "expiresAt"
     FROM admin_sessions WHERE token_hash = $1 AND expires_at > now()`,
    [tokenHash(token)]
  );
  return result.rows[0] || null;
}

async function deleteAdminSession(token) {
  if (!token || !initialized) return;
  await getPool().query(`DELETE FROM admin_sessions WHERE token_hash = $1`, [tokenHash(token)]);
}

async function audit(client, actor, action, entityType, entityId, detail = {}) {
  await client.query(
    `INSERT INTO audit_events(actor_email, action, entity_type, entity_id, detail)
     VALUES ($1, $2, $3, $4, $5::jsonb)`,
    [actor, action, entityType, entityId, JSON.stringify(detail)]
  );
}

async function createDraft(payload, actor) {
  if (!initialized) throw new Error('Editorial database is not ready.');
  const report = validateResultDataset(payload);
  if (!payload || typeof payload !== 'object' || !payload.contest || !payload.dataset ||
      !Array.isArray(payload.candidates) || !Array.isArray(payload.reportingUnits) ||
      !Array.isArray(payload.summaries) || !Array.isArray(payload.results) || !Array.isArray(payload.sources)) {
    throw new Error(`Invalid dataset structure: ${report.errors.join('; ')}`);
  }
  for (const source of payload.sources) {
    await verifySource(source.storageKey, source.sha256);
  }
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const contest = payload.contest;
    const contestResult = await client.query(
      `INSERT INTO contests(office, jurisdiction_code, jurisdiction_name, constituency_name, election_date, election_type, phase)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT (office, jurisdiction_code, constituency_name, election_date, phase)
       DO UPDATE SET jurisdiction_name=excluded.jurisdiction_name, election_type=excluded.election_type
       RETURNING id`,
      [contest.office, contest.jurisdictionCode, contest.jurisdictionName, contest.constituencyName || '', contest.electionDate, contest.electionType, contest.phase]
    );
    const contestId = contestResult.rows[0].id;
    const versionResult = await client.query(`SELECT COALESCE(MAX(version),0)+1 AS version FROM dataset_versions WHERE contest_id=$1`, [contestId]);
    const version = Number(versionResult.rows[0].version);
    const dataset = payload.dataset;
    const datasetResult = await client.query(
      `INSERT INTO dataset_versions(contest_id, version, status, title, methodology, coverage, as_of,
         declared_winner_ref, payload, validation_report, prepared_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10::jsonb,$11) RETURNING id, status`,
      [contestId, version, report.valid ? 'draft' : 'validation_failed', dataset.title, dataset.methodology,
        dataset.coverage, dataset.asOf, dataset.declaredWinnerRef, JSON.stringify(payload), JSON.stringify(report), actor]
    );
    const datasetId = datasetResult.rows[0].id;

    for (const candidate of payload.candidates) {
      await client.query(
        `INSERT INTO candidates(dataset_version_id,candidate_ref,name,party) VALUES ($1,$2,$3,$4)`,
        [datasetId, candidate.ref, candidate.name, candidate.party]
      );
    }
    for (const unit of payload.reportingUnits) {
      await client.query(
        `INSERT INTO reporting_units(dataset_version_id,unit_ref,name,level,jurisdiction_code,geometry_source)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [datasetId, unit.ref, unit.name, unit.level, unit.jurisdictionCode, unit.geometrySource || null]
      );
    }
    const sourceIds = new Map();
    for (const source of payload.sources) {
      const sourceResult = await client.query(
        `INSERT INTO sources(dataset_version_id,source_ref,publisher,publisher_type,url,document_type,
           document_date,retrieved_at,page_reference,sha256,storage_key)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id`,
        [datasetId, source.ref, source.publisher, source.publisherType, source.url, source.documentType,
          source.documentDate, source.retrievedAt, source.pageReference, source.sha256, source.storageKey]
      );
      sourceIds.set(source.ref, sourceResult.rows[0].id);
    }
    for (const total of payload.results) {
      const totalResult = await client.query(
        `INSERT INTO result_totals(dataset_version_id,reporting_unit_ref,candidate_ref,votes)
         VALUES ($1,$2,$3,$4) RETURNING id`,
        [datasetId, total.reportingUnitRef, total.candidateRef, total.votes]
      );
      for (const sourceRef of total.sourceRefs) {
        const sourceId = sourceIds.get(sourceRef);
        if (sourceId) {
          await client.query(
            `INSERT INTO evidence_links(dataset_version_id,result_total_id,source_id) VALUES ($1,$2,$3)`,
            [datasetId, totalResult.rows[0].id, sourceId]
          );
        }
      }
    }
    for (const summary of payload.summaries) {
      await client.query(
        `INSERT INTO vote_summaries(dataset_version_id,reporting_unit_ref,registered_voters,accredited_voters,valid_votes,rejected_votes)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [datasetId, summary.reportingUnitRef, summary.registeredVoters ?? null,
          summary.accreditedVoters ?? null, summary.validVotes, summary.rejectedVotes ?? null]
      );
    }
    await audit(client, actor, 'dataset.created', 'dataset_version', datasetId, { contestId, version, valid: report.valid });
    await client.query('COMMIT');
    return { id: datasetId, contestId, version, status: datasetResult.rows[0].status, validation: report };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function getDatasetForAdmin(id) {
  const result = await getPool().query(
    `SELECT dv.*, c.office, c.jurisdiction_code, c.jurisdiction_name, c.constituency_name,
       c.election_date, c.election_type, c.phase
     FROM dataset_versions dv JOIN contests c ON c.id=dv.contest_id WHERE dv.id=$1`, [id]
  );
  return result.rows[0] || null;
}

async function validateDraft(id, actor) {
  const dataset = await getDatasetForAdmin(id);
  if (!dataset) return null;
  if (!['draft', 'validation_failed'].includes(dataset.status)) throw new Error('Only draft datasets can be validated.');
  const report = validateResultDataset(dataset.payload);
  await getPool().query(
    `UPDATE dataset_versions SET validation_report=$2::jsonb, status=$3 WHERE id=$1`,
    [id, JSON.stringify(report), report.valid ? 'draft' : 'validation_failed']
  );
  await getPool().query(
    `INSERT INTO audit_events(actor_email,action,entity_type,entity_id,detail) VALUES ($1,'dataset.validated','dataset_version',$2,$3::jsonb)`,
    [actor, id, JSON.stringify(report)]
  );
  return report;
}

async function submitDraft(id, actor) {
  const report = await validateDraft(id, actor);
  if (!report) return null;
  if (!report.valid) return { status: 'validation_failed', validation: report };
  const result = await getPool().query(
    `UPDATE dataset_versions SET status='in_review', submitted_at=now()
     WHERE id=$1 AND status='draft' RETURNING id,status`, [id]
  );
  if (!result.rowCount) throw new Error('Dataset cannot be submitted from its current state.');
  await getPool().query(
    `INSERT INTO audit_events(actor_email,action,entity_type,entity_id) VALUES ($1,'dataset.submitted','dataset_version',$2)`, [actor, id]
  );
  return { ...result.rows[0], validation: report };
}

async function reviewDataset(id, actor, decision, notes = '') {
  const dataset = await getDatasetForAdmin(id);
  if (!dataset) return null;
  if (dataset.status !== 'in_review') throw new Error('Dataset is not awaiting review.');
  if (dataset.prepared_by.toLowerCase() === actor.toLowerCase()) throw new Error('The preparer cannot approve or reject their own dataset.');
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `INSERT INTO reviews(dataset_version_id,reviewer_email,decision,notes) VALUES ($1,$2,$3,$4)
       ON CONFLICT(dataset_version_id,reviewer_email) DO UPDATE SET decision=excluded.decision,notes=excluded.notes,created_at=now()`,
      [id, actor, decision, notes]
    );
    await client.query(
      `UPDATE dataset_versions SET status=$2::dataset_status,
       verified_at=CASE WHEN $2::dataset_status='verified'::dataset_status THEN now() ELSE NULL END WHERE id=$1`,
      [id, decision === 'approved' ? 'verified' : 'validation_failed']
    );
    await audit(client, actor, `dataset.${decision}`, 'dataset_version', id, { notes });
    await client.query('COMMIT');
    return { id, status: decision === 'approved' ? 'verified' : 'validation_failed' };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function publishDataset(id, actor) {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const locked = await client.query(`SELECT * FROM dataset_versions WHERE id=$1 FOR UPDATE`, [id]);
    const dataset = locked.rows[0];
    if (!dataset) { await client.query('ROLLBACK'); return null; }
    if (dataset.status !== 'verified') throw new Error('Only verified datasets can be published.');
    const approval = await client.query(
      `SELECT 1 FROM reviews WHERE dataset_version_id=$1 AND decision='approved' AND lower(reviewer_email)<>lower($2)`,
      [id, dataset.prepared_by]
    );
    if (!approval.rowCount) throw new Error('A separate reviewer approval is required.');
    await client.query(`UPDATE dataset_versions SET status='superseded' WHERE contest_id=$1 AND status='published'`, [dataset.contest_id]);
    await client.query(`UPDATE dataset_versions SET status='published', published_at=now() WHERE id=$1`, [id]);
    await audit(client, actor, 'dataset.published', 'dataset_version', id, { version: dataset.version });
    await client.query('COMMIT');
    return { id, status: 'published' };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function quarantineDataset(id, actor, reason) {
  if (!String(reason || '').trim()) throw new Error('A quarantine reason is required.');
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const result = await client.query(
      `UPDATE dataset_versions SET status='quarantined' WHERE id=$1 AND status<>'published' RETURNING id,status`, [id]
    );
    if (!result.rowCount) throw new Error('Published datasets must be superseded by a verified revision; they cannot be directly quarantined.');
    await audit(client, actor, 'dataset.quarantined', 'dataset_version', id, { reason });
    await client.query('COMMIT');
    return result.rows[0];
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function listEditorialQueue() {
  const result = await getPool().query(
    `SELECT dv.id,dv.version,dv.status,dv.title,dv.prepared_by AS "preparedBy",dv.created_at AS "createdAt",
      c.office,c.jurisdiction_name AS "jurisdictionName",c.constituency_name AS "constituencyName",c.election_date AS "electionDate"
     FROM dataset_versions dv JOIN contests c ON c.id=dv.contest_id
     WHERE dv.status IN ('draft','validation_failed','in_review','verified','quarantined')
     ORDER BY dv.created_at DESC LIMIT 500`
  );
  return result.rows;
}

async function listAuditEvents(limit = 200) {
  const result = await getPool().query(
    `SELECT id::text,actor_email AS "actorEmail",action,entity_type AS "entityType",entity_id AS "entityId",detail,created_at AS "createdAt"
     FROM audit_events ORDER BY id DESC LIMIT $1`, [Math.max(1, Math.min(Number(limit) || 200, 1000))]
  );
  return result.rows;
}

async function listPublishedContests(filters = {}) {
  const values = [];
  const where = [`dv.status='published'`];
  if (filters.office) { values.push(filters.office); where.push(`c.office=$${values.length}`); }
  if (filters.from) { values.push(filters.from); where.push(`c.election_date >= $${values.length}`); }
  if (filters.to) { values.push(filters.to); where.push(`c.election_date <= $${values.length}`); }
  const result = await getPool().query(
    `SELECT c.id,c.office,c.jurisdiction_code AS "jurisdictionCode",c.jurisdiction_name AS "jurisdictionName",
       c.constituency_name AS "constituencyName",c.election_date AS "electionDate",c.election_type AS "electionType",
       c.phase,dv.id AS "datasetId",dv.version,dv.title,dv.methodology,dv.coverage,dv.as_of AS "asOf",dv.published_at AS "lastReviewedAt"
     FROM contests c JOIN dataset_versions dv ON dv.contest_id=c.id WHERE ${where.join(' AND ')}
     ORDER BY c.election_date DESC,c.office,c.jurisdiction_name,c.constituency_name LIMIT 1000`, values
  );
  return result.rows.map((row) => ({ ...row, status: 'published', sourceReferences: `/api/v1/datasets/${row.datasetId}/sources` }));
}

async function getPublishedContest(id) {
  const result = await getPool().query(
    `SELECT c.id,c.office,c.jurisdiction_code AS "jurisdictionCode",c.jurisdiction_name AS "jurisdictionName",
      c.constituency_name AS "constituencyName",c.election_date AS "electionDate",c.election_type AS "electionType",c.phase,
      dv.id AS "datasetId",dv.version,dv.title,dv.methodology,dv.coverage,dv.as_of AS "asOf",
      dv.declared_winner_ref AS "declaredWinnerRef",dv.published_at AS "lastReviewedAt"
     FROM contests c JOIN dataset_versions dv ON dv.contest_id=c.id AND dv.status='published' WHERE c.id=$1`, [id]
  );
  return result.rows[0] ? {
    ...result.rows[0], status: 'published',
    sourceReferences: `/api/v1/datasets/${result.rows[0].datasetId}/sources`,
  } : null;
}

async function getPublishedResults(contestId) {
  const contest = await getPublishedContest(contestId);
  if (!contest) return null;
  const result = await getPool().query(
    `SELECT rt.reporting_unit_ref AS "reportingUnitRef",ru.name AS "reportingUnitName",ru.level,
       rt.candidate_ref AS "candidateRef",ca.name AS "candidateName",ca.party,rt.votes::text,
       COALESCE(json_agg(s.source_ref ORDER BY s.source_ref) FILTER (WHERE s.id IS NOT NULL),'[]') AS "sourceRefs"
     FROM result_totals rt
     JOIN candidates ca ON ca.dataset_version_id=rt.dataset_version_id AND ca.candidate_ref=rt.candidate_ref
     JOIN reporting_units ru ON ru.dataset_version_id=rt.dataset_version_id AND ru.unit_ref=rt.reporting_unit_ref
     LEFT JOIN evidence_links el ON el.result_total_id=rt.id
     LEFT JOIN sources s ON s.id=el.source_id
     WHERE rt.dataset_version_id=$1
     GROUP BY rt.id,ru.name,ru.level,ca.name,ca.party ORDER BY ru.name,rt.votes DESC`, [contest.datasetId]
  );
  return {
    contestId,
    datasetId: contest.datasetId,
    status: 'published',
    asOf: contest.asOf,
    version: contest.version,
    methodology: contest.methodology,
    coverage: contest.coverage,
    declaredWinnerRef: contest.declaredWinnerRef,
    sourceReferences: `/api/v1/datasets/${contest.datasetId}/sources`,
    lastReviewedAt: contest.lastReviewedAt,
    results: result.rows,
  };
}

async function getPublishedSources(datasetId) {
  const result = await getPool().query(
    `SELECT s.source_ref AS "ref",s.publisher,s.publisher_type AS "publisherType",s.url,
       s.document_type AS "documentType",s.document_date AS "documentDate",s.retrieved_at AS "retrievedAt",
       s.page_reference AS "pageReference",s.sha256,s.storage_key AS "storageKey"
     FROM sources s JOIN dataset_versions dv ON dv.id=s.dataset_version_id
     WHERE s.dataset_version_id=$1 AND dv.status='published' ORDER BY s.publisher,s.source_ref`, [datasetId]
  );
  return result.rows;
}

async function resetTestData() {
  if (process.env.NODE_ENV !== 'test') throw new Error('Test reset is only available when NODE_ENV=test.');
  await getPool().query('TRUNCATE contests, admin_sessions, audit_events CASCADE');
}

async function close() {
  if (pool) await pool.end();
  pool = null;
  initialized = false;
}

module.exports = {
  isEnabled, initializeEditorialStore, readiness, createAdminSession, getAdminSession, deleteAdminSession,
  createDraft, getDatasetForAdmin, validateDraft, submitDraft, reviewDataset, publishDataset,
  quarantineDataset, listEditorialQueue, listAuditEvents,
  listPublishedContests, getPublishedContest, getPublishedResults, getPublishedSources,
  resetTestData, close,
};
