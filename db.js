const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const Papa = require('papaparse');
const crypto = require('crypto');

const DB_PATH = process.env.ELECTION_DB_PATH
  ? path.resolve(process.env.ELECTION_DB_PATH)
  : path.join(__dirname, 'data', 'election-dashboard.db');

const CSV_PATH = path.join(__dirname, 'data', 'reference', 'Nigeria_polling_units.csv');
const RESULTS_DIR = process.env.ELECTION_RESULTS_DIR
  ? path.resolve(process.env.ELECTION_RESULTS_DIR)
  : path.join(__dirname, 'data', 'election-results');

let db = null;

function normalizeKey(value) {
  return String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9/]+/gi, ' ')
    .trim()
    .toLowerCase();
}

function getDb() {
  if (db) return db;
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  db = new Database(DB_PATH);
  const journalMode = process.env.SQLITE_JOURNAL_MODE || 'WAL';
  db.pragma(`journal_mode = ${journalMode}`);
  db.pragma('synchronous = NORMAL');
  db.pragma('foreign_keys = ON');
  initSchema(db);
  rebuildFtsIfNeeded(db);
  return db;
}

function initSchema(database) {
  database.exec(`
    CREATE TABLE IF NOT EXISTS polling_units (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      state TEXT NOT NULL,
      lga TEXT NOT NULL,
      ward TEXT,
      polling_unit TEXT,
      code TEXT,
      address TEXT,
      latitude REAL,
      longitude REAL,
      state_norm TEXT NOT NULL,
      lga_norm TEXT NOT NULL,
      ward_norm TEXT,
      search_text TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_pu_state ON polling_units(state_norm);
    CREATE INDEX IF NOT EXISTS idx_pu_lga ON polling_units(state_norm, lga_norm);
    CREATE INDEX IF NOT EXISTS idx_pu_ward ON polling_units(state_norm, lga_norm, ward_norm);
    CREATE INDEX IF NOT EXISTS idx_pu_search ON polling_units(search_text);

    CREATE VIRTUAL TABLE IF NOT EXISTS polling_units_fts USING fts5(
      search_text,
      tokenize='unicode61 remove_diacritics 1'
    );

    CREATE TABLE IF NOT EXISTS election_datasets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      office TEXT NOT NULL,
      year TEXT NOT NULL,
      state TEXT,
      state_key TEXT NOT NULL DEFAULT 'ng',
      level TEXT NOT NULL,
      title TEXT,
      source TEXT,
      source_url TEXT,
      attribution TEXT,
      updated TEXT,
      winner_json TEXT,
      candidates_json TEXT,
      meta_json TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      UNIQUE(office, year, state_key)
    );

    CREATE TABLE IF NOT EXISTS election_units (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      dataset_id INTEGER NOT NULL REFERENCES election_datasets(id) ON DELETE CASCADE,
      unit_name TEXT NOT NULL,
      winner TEXT,
      party TEXT,
      votes_json TEXT,
      UNIQUE(dataset_id, unit_name)
    );
    CREATE INDEX IF NOT EXISTS idx_eu_dataset ON election_units(dataset_id);

    CREATE TABLE IF NOT EXISTS boundary_layers (
      layer TEXT PRIMARY KEY,
      feature_count INTEGER NOT NULL DEFAULT 0,
      source_file TEXT,
      uploaded_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS boundary_state_codes (
      code TEXT PRIMARY KEY,
      state TEXT NOT NULL,
      state_norm TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS boundary_features (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      layer TEXT NOT NULL,
      name TEXT NOT NULL,
      state TEXT,
      lga TEXT,
      ward TEXT,
      state_norm TEXT,
      lga_norm TEXT,
      ward_norm TEXT,
      props_json TEXT,
      geom_json TEXT NOT NULL,
      min_lat REAL,
      max_lat REAL,
      min_lng REAL,
      max_lng REAL
    );
    CREATE INDEX IF NOT EXISTS idx_bf_layer ON boundary_features(layer);
    CREATE INDEX IF NOT EXISTS idx_bf_state ON boundary_features(layer, state_norm);
    CREATE INDEX IF NOT EXISTS idx_bf_lga ON boundary_features(layer, lga_norm);
  `);
}

function rowToPoint(row) {
  const hasCoordinates = Number.isFinite(row.latitude) && Number.isFinite(row.longitude);
  return {
    state: row.state,
    lga: row.lga,
    ward: row.ward || '',
    pollingUnit: row.polling_unit || '',
    code: row.code || '',
    name: row.polling_unit || row.address || '',
    address: row.address || '',
    latitude: row.latitude,
    longitude: row.longitude,
    sourceHasCoordinates: hasCoordinates,
    coordinateStatus: hasCoordinates ? 'source-provided' : 'unavailable',
    geometrySource: hasCoordinates ? 'csv-latlong' : 'unavailable',
  };
}

function importPollingUnitsFromCsv(csvPath, normalizeRow) {
  const database = getDb();
  const csvText = fs.readFileSync(csvPath, 'utf8');
  const parsed = Papa.parse(csvText, {
    header: true,
    skipEmptyLines: true,
    transformHeader: (header) => String(header || '').trim(),
  });

  const insert = database.prepare(`
    INSERT INTO polling_units (
      state, lga, ward, polling_unit, code, address, latitude, longitude,
      state_norm, lga_norm, ward_norm, search_text
    ) VALUES (
      @state, @lga, @ward, @polling_unit, @code, @address, @latitude, @longitude,
      @state_norm, @lga_norm, @ward_norm, @search_text
    )
  `);

  const tx = database.transaction((rows) => {
    database.exec('CREATE TABLE IF NOT EXISTS reference_imports (name TEXT PRIMARY KEY, fingerprint TEXT NOT NULL)');
    database.exec('DELETE FROM polling_units_fts; DELETE FROM polling_units');
    for (const raw of rows) {
      const point = normalizeRow(raw);
      if (!point.state || !point.lga || !point.code) continue;
      insert.run({
        state: point.state,
        lga: point.lga,
        ward: point.ward || '',
        polling_unit: point.pollingUnit || '',
        code: point.code || '',
        address: point.address || '',
        latitude: Number.isFinite(point.latitude) ? point.latitude : null,
        longitude: Number.isFinite(point.longitude) ? point.longitude : null,
        state_norm: normalizeKey(point.state),
        lga_norm: normalizeKey(point.lga),
        ward_norm: normalizeKey(point.ward || ''),
        search_text: normalizeKey([
          point.pollingUnit, point.name, point.ward, point.lga, point.state, point.code,
        ].join(' ')),
      });
    }
    database.exec(`
      INSERT INTO polling_units_fts(rowid, search_text)
      SELECT id, search_text FROM polling_units
    `);
    database.prepare('INSERT OR REPLACE INTO reference_imports(name, fingerprint) VALUES (?, ?)')
      .run('polling_units', pollingSourceFingerprint(csvText));
  });
  tx(parsed.data || []);
  return database.prepare('SELECT COUNT(*) AS n FROM polling_units').get().n;
}

function pollingSourceFingerprint(csvText) {
  return 'source-coordinates-v3:' + crypto.createHash('sha256').update(csvText).digest('hex');
}

function ensurePollingUnitsSeeded(normalizeRow) {
  const database = getDb();
  if (!fs.existsSync(CSV_PATH)) throw new Error('Canonical polling-unit CSV is missing.');
  database.exec('CREATE TABLE IF NOT EXISTS reference_imports (name TEXT PRIMARY KEY, fingerprint TEXT NOT NULL)');
  const count = database.prepare('SELECT COUNT(*) AS n FROM polling_units').get().n;
  const fingerprint = pollingSourceFingerprint(fs.readFileSync(CSV_PATH, 'utf8'));
  const imported = database.prepare('SELECT fingerprint FROM reference_imports WHERE name = ?').get('polling_units');
  // Upgrade unversioned caches and refresh whenever the canonical source changes.
  if (count > 0 && imported?.fingerprint === fingerprint) return count;
  return importPollingUnitsFromCsv(CSV_PATH, normalizeRow);
}

function rebuildFtsIfNeeded(database) {
  const puCount = database.prepare('SELECT COUNT(*) AS n FROM polling_units').get().n;
  if (!puCount) return;
  let needsRebuild = false;
  try {
    const probe = database.prepare("SELECT rowid FROM polling_units_fts WHERE search_text MATCH 'lagos*' LIMIT 1").all();
    if (!probe.length) needsRebuild = true;
  } catch {
    needsRebuild = true;
  }
  if (!needsRebuild) return;
  database.exec('DROP TABLE IF EXISTS polling_units_fts');
  database.exec(`
    CREATE VIRTUAL TABLE polling_units_fts USING fts5(
      search_text,
      tokenize='unicode61 remove_diacritics 1'
    )
  `);
  database.exec(`
    INSERT INTO polling_units_fts(rowid, search_text)
    SELECT id, search_text FROM polling_units
  `);
}

function ensureFtsPopulated() {
  rebuildFtsIfNeeded(getDb());
}

function queryPollingUnits({ state, lga, ward, q, bbox, limit } = {}) {
  const database = getDb();
  ensureFtsPopulated();
  const params = {};
  let sql;
  let max = Number(limit) > 0 ? Number(limit) : 0;

  if (q && !state && !lga && !ward) {
    const term = normalizeKey(q).split(/\s+/).filter(Boolean).join(' ');
    if (!term) return [];
    sql = `
      SELECT p.state, p.lga, p.ward, p.polling_unit, p.code, p.address, p.latitude, p.longitude
      FROM polling_units_fts f
      JOIN polling_units p ON p.id = f.rowid
      WHERE f.search_text MATCH @term
      ORDER BY p.state, p.lga, p.ward, p.polling_unit
      ${max ? `LIMIT ${max}` : 'LIMIT 25'}
    `;
    params.term = term.split(' ').map((t) => `${t}*`).join(' ');
    return database.prepare(sql).all(params).map(rowToPoint);
  }

  const clauses = [];

  if (state) {
    clauses.push('state_norm = @state_norm');
    params.state_norm = normalizeKey(state);
  }
  if (lga) {
    clauses.push('lga_norm = @lga_norm');
    params.lga_norm = normalizeKey(lga);
  }
  if (ward) {
    clauses.push('ward_norm = @ward_norm');
    params.ward_norm = normalizeKey(ward);
  }
  if (q) {
    clauses.push('search_text LIKE @q');
    params.q = `%${normalizeKey(q)}%`;
  }
  if (bbox && Number.isFinite(bbox.west)) {
    clauses.push('longitude BETWEEN @west AND @east AND latitude BETWEEN @south AND @north');
    params.west = bbox.west;
    params.east = bbox.east;
    params.south = bbox.south;
    params.north = bbox.north;
  }

  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  max = Number(limit) > 0 ? Number(limit) : 0;
  sql = `
    SELECT state, lga, ward, polling_unit, code, address, latitude, longitude
    FROM polling_units
    ${where}
    ORDER BY state, lga, ward, polling_unit
    ${max ? `LIMIT ${max}` : ''}
  `;
  return database.prepare(sql).all(params).map(rowToPoint);
}

function getPollingDirectoryTree() {
  const database = getDb();
  const rows = database.prepare(`
    SELECT DISTINCT state, lga, ward
    FROM polling_units
    ORDER BY state, lga, ward
  `).all();

  const tree = {};
  for (const row of rows) {
    if (!row.state || !row.lga) continue;
    if (!tree[row.state]) tree[row.state] = {};
    if (!tree[row.state][row.lga]) tree[row.state][row.lga] = {};
    if (row.ward) tree[row.state][row.lga][row.ward] = true;
  }
  return tree;
}

function upsertElectionDataset(payload) {
  const database = getDb();
  const meta = payload.meta || {};
  const office = String(meta.office || payload.office || '').toLowerCase();
  const year = String(meta.year || payload.year || '');
  const state = meta.state || payload.state || null;
  const stateKey = state ? normalizeKey(state) : 'ng';

  const upsert = database.prepare(`
    INSERT INTO election_datasets (
      office, year, state, state_key, level, title, source, source_url, attribution, updated,
      winner_json, candidates_json, meta_json
    ) VALUES (
      @office, @year, @state, @state_key, @level, @title, @source, @source_url, @attribution, @updated,
      @winner_json, @candidates_json, @meta_json
    )
    ON CONFLICT(office, year, state_key) DO UPDATE SET
      state = excluded.state,
      level = excluded.level,
      title = excluded.title,
      source = excluded.source,
      source_url = excluded.source_url,
      attribution = excluded.attribution,
      updated = excluded.updated,
      winner_json = excluded.winner_json,
      candidates_json = excluded.candidates_json,
      meta_json = excluded.meta_json,
      created_at = datetime('now')
  `);

  const info = upsert.run({
    office,
    year,
    state,
    state_key: stateKey,
    level: meta.level || payload.level || 'state',
    title: meta.title || payload.title || '',
    source: meta.source || payload.source || '',
    source_url: meta.sourceUrl || meta.source_url || '',
    attribution: meta.attribution || payload.attribution || '',
    updated: meta.updated || payload.updated || '',
    winner_json: JSON.stringify(payload.winner || null),
    candidates_json: JSON.stringify(payload.candidates || []),
    meta_json: JSON.stringify(meta),
  });

  const datasetId = database.prepare(`
    SELECT id FROM election_datasets
    WHERE office = ? AND year = ? AND state_key = ?
  `).get(office, year, stateKey).id;

  database.prepare('DELETE FROM election_units WHERE dataset_id = ?').run(datasetId);
  const insertUnit = database.prepare(`
    INSERT INTO election_units (dataset_id, unit_name, winner, party, votes_json)
    VALUES (@dataset_id, @unit_name, @winner, @party, @votes_json)
  `);

  const tx = database.transaction((units) => {
    for (const [unitName, unit] of Object.entries(units || {})) {
      insertUnit.run({
        dataset_id: datasetId,
        unit_name: unitName,
        winner: unit.winner || '',
        party: unit.party || '',
        votes_json: JSON.stringify(unit.votes || {}),
      });
    }
  });
  tx(payload.units || {});

  return { id: datasetId, office, year, state, units: Object.keys(payload.units || {}).length };
}

function importElectionResultsFromDir(force = false) {
  if (!fs.existsSync(RESULTS_DIR)) return 0;
  const files = [];

  function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith('.json')) files.push(full);
    }
  }

  walk(RESULTS_DIR);

  if (force) {
    getDb().exec('DELETE FROM election_units');
    getDb().exec('DELETE FROM election_datasets');
  }

  let count = 0;
  for (const file of files) {
    const payload = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (payload.meta && payload.units) {
      upsertElectionDataset(payload);
      count += 1;
    }
  }
  return count;
}

function listGovStatesByYear(year) {
  const database = getDb();
  return database.prepare(`
    SELECT DISTINCT state FROM election_datasets
    WHERE office = 'gov' AND year = ? AND state IS NOT NULL AND state != ''
    ORDER BY state COLLATE NOCASE
  `).all(String(year)).map((row) => row.state);
}

function listGovYears() {
  const database = getDb();
  return database.prepare(`
    SELECT DISTINCT year FROM election_datasets
    WHERE office = 'gov'
    ORDER BY year DESC
  `).all().map((row) => row.year);
}

function ensureElectionResultsSeeded() {
  const database = getDb();
  const count = database.prepare('SELECT COUNT(*) AS n FROM election_datasets').get().n;
  if (count > 0) return count;
  return importElectionResultsFromDir();
}

function quarantineLegacyElectionResults() {
  const database = getDb();
  return database.prepare('DELETE FROM election_datasets').run().changes;
}

function getDbStatus() {
  const database = getDb();
  return {
    path: DB_PATH,
    pollingUnits: database.prepare('SELECT COUNT(*) AS n FROM polling_units').get().n,
    pollingUnitsWithCoordinates: database.prepare('SELECT COUNT(*) AS n FROM polling_units WHERE latitude IS NOT NULL AND longitude IS NOT NULL').get().n,
    electionDatasets: database.prepare('SELECT COUNT(*) AS n FROM election_datasets').get().n,
    electionUnits: database.prepare('SELECT COUNT(*) AS n FROM election_units').get().n,
  };
}

function listLgasByState(stateName) {
  const database = getDb();
  const stateKey = normalizeKey(stateName);
  return database.prepare(`
    SELECT DISTINCT lga FROM polling_units
    WHERE state_norm = ?
    ORDER BY lga COLLATE NOCASE
  `).all(stateKey).map((row) => row.lga);
}

function loadElectionDataset({ office, year, state }) {
  const database = getDb();
  const officeId = String(office || '').toLowerCase();
  const yearId = String(year || '');
  const stateKey = state ? normalizeKey(state) : 'ng';
  const row = database.prepare(`
    SELECT * FROM election_datasets
    WHERE office = ? AND year = ? AND state_key = ?
  `).get(officeId, yearId, stateKey);
  if (!row) return null;

  const unitsRows = database.prepare(`
    SELECT unit_name, winner, party, votes_json
    FROM election_units WHERE dataset_id = ?
  `).all(row.id);

  const units = {};
  for (const unit of unitsRows) {
    units[unit.unit_name] = {
      winner: unit.winner,
      party: unit.party,
      votes: JSON.parse(unit.votes_json || '{}'),
    };
  }

  return {
    meta: JSON.parse(row.meta_json || '{}'),
    winner: JSON.parse(row.winner_json || 'null'),
    candidates: JSON.parse(row.candidates_json || '[]'),
    units,
    level: row.level,
    title: row.title,
    source: row.source,
    sourceUrl: row.source_url,
    attribution: row.attribution,
    updated: row.updated,
  };
}

module.exports = {
  getDb,
  normalizeKey,
  ensurePollingUnitsSeeded,
  importPollingUnitsFromCsv,
  queryPollingUnits,
  getPollingDirectoryTree,
  upsertElectionDataset,
  importElectionResultsFromDir,
  ensureElectionResultsSeeded,
  quarantineLegacyElectionResults,
  loadElectionDataset,
  listLgasByState,
  listGovStatesByYear,
  listGovYears,
  getDbStatus,
  DB_PATH,
  CSV_PATH,
};
