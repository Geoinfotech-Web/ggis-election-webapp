const fs = require('fs/promises');
const fsSync = require('fs');
const path = require('path');
const { loadElectionDataset } = require('./db');
const { canonicalLga, matchKey } = require('./lga-normalize');

const PARTY_COLORS = {
  APC: '#2f6fed',
  PDP: '#cf3a4e',
  LP: '#2fa84f',
  NNPP: '#7a53d1',
  ADC: '#d69a34',
  SDP: '#8b5cf6',
  ADP: '#6b7280',
  AAC: '#0ea5a4',
  Accord: '#94a3b8',
  APGA: '#1f9e8a',
  AA: '#64748b',
  APM: '#f59e0b',
  APP: '#14b8a6',
  YPP: '#ec4899',
  ZLP: '#22c55e',
  Others: '#8b939d',
};

const STATE_ALIASES = {
  'federal capital territory': 'FCT',
  'abuja': 'FCT',
  'fct': 'FCT',
  'akwa ibom': 'Akwa Ibom',
  'cross river': 'Cross River',
  'ekiti south west': 'Ekiti South West',
  'ekiti southwest': 'Ekiti South West',
  'ido osi': 'Ido/Osi',
  'ido/osi': 'Ido/Osi',
  'ise orun': 'Ise/Orun',
  'ise/orun': 'Ise/Orun',
  'irepodun ifelodun': 'Irepodun/Ifelodun',
  'irepodun/ifelodun': 'Irepodun/Ifelodun',
  'ayekire': 'Gbonyin',
  'gbonyin': 'Gbonyin',
  'ayekire gbonyin': 'Gbonyin',
  'efun': 'Efon',
  'efon': 'Efon',
  'ado ekiti': 'Ado',
  'ado': 'Ado',
};

const DATA_DIR = process.env.ELECTION_RESULTS_DIR
  ? path.resolve(process.env.ELECTION_RESULTS_DIR)
  : path.join(__dirname, 'data', 'election-results');

const STATIC_INDEX = [
  { office: 'pres', year: '2023', level: 'state', file: 'presidential-2023-states.json' },
  { office: 'pres', year: '2019', level: 'state', file: 'presidential-2019-states.json' },
  { office: 'pres', year: '2015', level: 'state', file: 'presidential-2015-states.json' },
  { office: 'gov', year: '2026', state: 'Ekiti', level: 'lga', file: 'gubernatorial-ekiti-2026-lga.json' },
];

function isPublishableLegacyPayload(payload) {
  // Strict editorial gate only when explicitly enabled.
  if (process.env.QUARANTINE_LEGACY_RESULTS === 'true') {
    const meta = payload?.meta || payload || {};
    if (meta.publicationStatus !== 'published') return false;
    if (meta.lgaMethod === 'pvc-proportional' || meta.modeled === true || meta.synthetic === true) return false;
    if (!Array.isArray(meta.evidence) || meta.evidence.length < 1) return false;
    const electionYear = meta.electionDate ? new Date(meta.electionDate).getUTCFullYear() : Number(meta.year);
    return !meta.year || !Number.isFinite(electionYear) || Number(meta.year) === electionYear;
  }
  // Restored public UI still serves sourced/collated legacy JSON and SQLite datasets.
  return Boolean(payload && (payload.units || payload.candidates || payload.meta || payload.winner));
}

function normalizeKey(value) {
  return String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9/]+/gi, ' ')
    .trim()
    .toLowerCase();
}

function stateSlug(state) {
  return normalizeKey(state).replace(/\s+/g, '-');
}

function canonicalState(name) {
  const key = normalizeKey(name);
  if (STATE_ALIASES[key]) return STATE_ALIASES[key];
  return String(name || '').trim();
}

function decorateUnits(units, level) {
  const decorated = {};
  Object.entries(units || {}).forEach(([name, row]) => {
    const key = level === 'lga' ? canonicalLga(name) : canonicalState(name);
    const party = row.party || 'Others';
    const payload = {
      ...row,
      party,
      color: partyColor(party),
      label: row.winner ? `${row.winner} · ${party}` : party,
      _canonicalKey: key,
    };
    decorated[key] = payload;
    decorated[matchKey(key)] = payload;
  });
  return decorated;
}

function buildLegend(units, candidates) {
  const partyNames = {};
  (candidates || []).forEach((c) => {
    if (c.party && c.name) partyNames[c.party] = c.name;
  });
  const tally = {};
  const seen = new Set();
  Object.values(units || {}).forEach((row) => {
    const dedupe = row._canonicalKey || row.label || JSON.stringify(row.votes || {});
    if (seen.has(dedupe)) return;
    seen.add(dedupe);
    const party = row.party || 'Others';
    if (!tally[party]) {
      tally[party] = {
        party,
        name: partyNames[party] || party,
        color: partyColor(party),
        count: 0,
      };
    }
    tally[party].count += 1;
  });
  return Object.values(tally).sort((a, b) => b.count - a.count);
}

function partyColor(party) {
  return PARTY_COLORS[String(party || '').trim()] || PARTY_COLORS.Others;
}

async function readDataset(relativePath) {
  const fullPath = path.join(DATA_DIR, relativePath);
  const raw = await fs.readFile(fullPath, 'utf8');
  return JSON.parse(raw);
}

function availableGovStates(year) {
  const govDir = path.join(DATA_DIR, 'gubernatorial');
  if (!fsSync.existsSync(govDir)) return [];
  const yearId = String(year || '');
  if (!yearId) {
    return listGovCatalog().states;
  }
  const fromCatalog = listGovCatalog().byState;
  const states = [];
  for (const [state, entries] of Object.entries(fromCatalog)) {
    if (entries.some((e) => e.electionYear === yearId || e.storageYear === yearId)) {
      states.push(state);
    }
  }
  if (states.length) return states.sort((a, b) => a.localeCompare(b));

  const suffix = `-${yearId}.json`;
  for (const file of fsSync.readdirSync(govDir)) {
    if (!file.endsWith(suffix)) continue;
    try {
      const payload = JSON.parse(fsSync.readFileSync(path.join(govDir, file), 'utf8'));
      if (payload.meta?.state && isPublishableLegacyPayload(payload)) states.push(payload.meta.state);
    } catch (e) {
      /* skip */
    }
  }
  return [...new Set(states)].sort((a, b) => a.localeCompare(b));
}

function electionYearOf(meta) {
  const m = meta || {};
  const dated = m.electionDate || m.updated;
  if (dated && /^\d{4}/.test(String(dated))) return String(dated).slice(0, 4);
  return String(m.year || '');
}

function scoreGovEntry(entry) {
  return (entry.collated ? 1000 : 0) + Number(entry.storageYear || 0);
}

function listGovCatalog() {
  const govDir = path.join(DATA_DIR, 'gubernatorial');
  const byState = {};
  if (fsSync.existsSync(govDir)) {
    for (const file of fsSync.readdirSync(govDir)) {
      if (!file.endsWith('.json')) continue;
      const m = file.match(/^(.+)-(\d{4})\.json$/);
      if (!m) continue;
      try {
        const payload = JSON.parse(fsSync.readFileSync(path.join(govDir, file), 'utf8'));
        if (!isPublishableLegacyPayload(payload) || !payload.meta?.state) continue;
        const state = canonicalState(payload.meta.state);
        const storageYear = String(payload.meta.year || m[2]);
        const electionYear = electionYearOf(payload.meta) || storageYear;
        const entry = {
          state,
          electionYear,
          storageYear,
          electionDate: payload.meta.electionDate || payload.meta.updated || null,
          collated: !!payload.meta.collated && payload.meta.lgaMethod !== 'pvc-proportional',
          estimated: payload.meta.lgaMethod === 'pvc-proportional' || payload.meta.modeled === true,
          file: path.join('gubernatorial', file),
          title: payload.meta.title || `${state} Governorship ${electionYear}`,
        };
        if (!byState[state]) byState[state] = [];
        const existingIdx = byState[state].findIndex((e) => e.electionYear === electionYear);
        if (existingIdx < 0) byState[state].push(entry);
        else if (scoreGovEntry(entry) >= scoreGovEntry(byState[state][existingIdx])) {
          byState[state][existingIdx] = entry;
        }
      } catch {
        /* skip */
      }
    }
  }
  for (const state of Object.keys(byState)) {
    byState[state].sort((a, b) => Number(b.electionYear) - Number(a.electionYear));
  }
  const states = Object.keys(byState).sort((a, b) => a.localeCompare(b));
  return { states, byState, count: states.length };
}

function resolveGovEntry(stateName, yearId) {
  const state = canonicalState(stateName);
  const year = String(yearId || '');
  const entries = listGovCatalog().byState[state] || [];
  return entries.find((e) => e.electionYear === year || e.storageYear === year) || null;
}

async function findGovFile(stateName, yearId) {
  const resolved = resolveGovEntry(stateName, yearId);
  if (resolved?.file) {
    const full = path.join(DATA_DIR, resolved.file);
    if (fsSync.existsSync(full)) return resolved.file;
  }
  const slug = stateSlug(stateName);
  const rel = path.join('gubernatorial', `${slug}-${yearId}.json`);
  const full = path.join(DATA_DIR, rel);
  if (fsSync.existsSync(full)) return rel;
  return null;
}

function deriveResultIntegrity(meta, level) {
  const m = meta || {};
  const estimated = m.lgaMethod === 'pvc-proportional' || m.modeled === true || m.synthetic === true;
  const collated = m.collated === true || (!estimated && level === 'lga');
  let lgaMethod = null;
  if (level === 'lga') {
    lgaMethod = estimated ? 'pvc-proportional' : 'official-collation';
  } else if (level === 'state') {
    lgaMethod = 'state-declared';
  }
  return {
    collated: !!collated && !estimated,
    estimated: !!estimated,
    lgaMethod,
    sourceDetail: m.sourceDetail || m.source || null,
    electionDate: m.electionDate || m.updated || null,
  };
}

function packChoropleth(payload, officeId, yearId, stateName, level) {
  const units = decorateUnits(payload.units, level);
  const legend = buildLegend(units, payload.candidates);
  const electionYear = electionYearOf(payload.meta) || String(yearId);
  const storageYear = String(payload.meta?.year || yearId);
  const key = [officeId, electionYear, stateName || 'ng', level].filter(Boolean).join(':');
  const integrity = deriveResultIntegrity(payload.meta, level);
  return {
    ok: true,
    status: 'published',
    key,
    office: officeId,
    year: electionYear,
    storageYear,
    electionYear,
    state: stateName || payload.meta?.state || null,
    level,
    title: payload.meta?.title || `${electionYear} ${officeId} election`,
    source: payload.meta?.source || 'Verified publication',
    sourceUrl: payload.meta?.sourceUrl || null,
    sourceDetail: integrity.sourceDetail,
    sourceReferences: payload.meta?.evidence || [],
    methodology: payload.meta?.methodology || 'Legal declaration totals',
    coverage: payload.meta?.level || level,
    attribution: payload.meta?.attribution || null,
    updated: payload.meta?.updated || null,
    electionDate: integrity.electionDate,
    collated: integrity.collated,
    estimated: integrity.estimated,
    lgaMethod: integrity.lgaMethod,
    winner: payload.winner || null,
    candidates: payload.candidates || null,
    units,
    legend,
    availableStates: officeId === 'gov' ? availableGovStates(electionYear) : [],
  };
}

async function loadChoropleth({ office, year, state }) {
  const officeId = String(office || '').toLowerCase();
  const yearId = String(year || '');
  const stateName = state ? canonicalState(state) : null;
  const resolvedGov = officeId === 'gov' && stateName ? resolveGovEntry(stateName, yearId) : null;
  const storageYearId = resolvedGov?.storageYear || yearId;
  const govStates = officeId === 'gov' ? availableGovStates(yearId) : [];

  try {
    const fromDb = loadElectionDataset({ office: officeId, year: storageYearId, state: stateName })
      || (storageYearId !== yearId ? loadElectionDataset({ office: officeId, year: yearId, state: stateName }) : null);
    if (fromDb && isPublishableLegacyPayload(fromDb.meta) && fromDb.units && Object.keys(fromDb.units).length) {
      const level = fromDb.level || (officeId === 'gov' ? 'state' : 'state');
      return packChoropleth(
        {
          meta: fromDb.meta,
          winner: fromDb.winner,
          candidates: fromDb.candidates,
          units: fromDb.units,
        },
        officeId,
        yearId,
        stateName || fromDb.meta?.state || null,
        level
      );
    }
  } catch (error) {
    console.warn('Election DB read failed, falling back to JSON files:', error.message || error);
  }

  if (officeId === 'gov' && stateName) {
    const govFile = await findGovFile(stateName, yearId);
    if (govFile) {
      const payload = await readDataset(govFile);
      if (!isPublishableLegacyPayload(payload)) {
        return {
          ok: false, office: officeId, year: yearId, state: stateName, level: payload.meta?.level || 'state',
          message: 'This legacy dataset is quarantined pending source verification.', units: {}, legend: [], availableStates: govStates,
        };
      }
      const level = payload.meta?.level || 'state';
      return packChoropleth(payload, officeId, yearId, stateName, level);
    }
    const lgaMatch = STATIC_INDEX.find((row) =>
      row.office === 'gov' &&
      (String(row.year) === yearId || String(row.year) === storageYearId) &&
      normalizeKey(row.state) === normalizeKey(stateName)
    );
    if (lgaMatch) {
      const payload = await readDataset(lgaMatch.file);
      if (!isPublishableLegacyPayload(payload)) {
        return {
          ok: false, office: officeId, year: yearId, state: stateName, level: lgaMatch.level,
          message: 'This legacy dataset is quarantined pending source verification.', units: {}, legend: [], availableStates: govStates,
        };
      }
      return packChoropleth(payload, officeId, yearId, stateName, lgaMatch.level);
    }
  }

  const match = STATIC_INDEX.find((row) => {
    if (row.office !== officeId || String(row.year) !== yearId) return false;
    if (row.state && stateName) return normalizeKey(row.state) === normalizeKey(stateName);
    if (row.state) return false;
    return !stateName;
  });

  if (!match) {
    return {
      ok: false,
      office: officeId,
      year: yearId,
      state: stateName,
      level: officeId === 'gov' ? 'state' : 'state',
      message: 'No verified, published result is available for this selection.',
      units: {},
      legend: [],
      availableStates: govStates,
    };
  }

  const payload = await readDataset(match.file);
  if (!isPublishableLegacyPayload(payload)) {
    return {
      ok: false, office: officeId, year: yearId, state: stateName, level: match.level,
      message: 'This legacy dataset is quarantined pending source verification.', units: {}, legend: [], availableStates: govStates,
    };
  }
  return packChoropleth(payload, officeId, yearId, stateName || payload.meta?.state || null, match.level);
}

function listAvailableDatasets() {
  const rows = [];
  for (const item of STATIC_INDEX) {
    try {
      const payload = JSON.parse(fsSync.readFileSync(path.join(DATA_DIR, item.file), 'utf8'));
      if (isPublishableLegacyPayload(payload)) rows.push(item);
    } catch { /* unavailable or quarantined */ }
  }
  const govDir = path.join(DATA_DIR, 'gubernatorial');
  if (fsSync.existsSync(govDir)) {
    for (const file of fsSync.readdirSync(govDir)) {
      if (!file.endsWith('.json')) continue;
      const m = file.match(/^(.+)-(\d{4})\.json$/);
      if (!m) continue;
      const state = m[1].split('-').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
      try {
        const payload = JSON.parse(fsSync.readFileSync(path.join(govDir, file), 'utf8'));
        if (isPublishableLegacyPayload(payload)) {
          rows.push({ office: 'gov', year: m[2], state, level: 'state', file: path.join('gubernatorial', file) });
        }
      } catch { /* unavailable or quarantined */ }
    }
  }
  return rows;
}

function listAvailableGovStates(year) {
  return availableGovStates(year);
}

module.exports = {
  PARTY_COLORS,
  DATA_DIR,
  normalizeKey,
  canonicalState,
  canonicalLga,
  partyColor,
  loadChoropleth,
  listAvailableDatasets,
  listAvailableGovStates,
  listGovCatalog,
  electionYearOf,
  resolveGovEntry,
  isPublishableLegacyPayload,
  deriveResultIntegrity,
};
