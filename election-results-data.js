const fs = require('fs/promises');
const fsSync = require('fs');
const path = require('path');
const { loadElectionDataset, ensureElectionResultsSeeded, listGovStatesByYear } = require('./db');
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
  { office: 'gov', year: '2026', state: 'Ekiti', level: 'lga', file: 'gubernatorial-ekiti-2026-lga.json' },
];

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
  Object.values(units || {}).forEach((row) => {
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
  try {
    ensureElectionResultsSeeded();
    const states = listGovStatesByYear(String(year || ''));
    if (states.length) return states;
  } catch (e) {
    /* fall through */
  }
  const govDir = path.join(DATA_DIR, 'gubernatorial');
  if (!fsSync.existsSync(govDir)) return ['Ekiti'];
  const suffix = `-${String(year || '')}.json`;
  const states = [];
  for (const file of fsSync.readdirSync(govDir)) {
    if (!file.endsWith(suffix)) continue;
    try {
      const payload = JSON.parse(fsSync.readFileSync(path.join(govDir, file), 'utf8'));
      if (payload.meta?.state) states.push(payload.meta.state);
    } catch (e) {
      /* skip */
    }
  }
  if (states.includes('Ekiti') || fsSync.existsSync(path.join(DATA_DIR, 'gubernatorial-ekiti-2026-lga.json'))) {
    if (String(year) === '2026' && !states.includes('Ekiti')) states.push('Ekiti');
  }
  return [...new Set(states)].sort((a, b) => a.localeCompare(b));
}

async function findGovFile(stateName, yearId) {
  const slug = stateSlug(stateName);
  const rel = path.join('gubernatorial', `${slug}-${yearId}.json`);
  const full = path.join(DATA_DIR, rel);
  if (fsSync.existsSync(full)) return rel;
  return null;
}

function packChoropleth(payload, officeId, yearId, stateName, level) {
  const units = decorateUnits(payload.units, level);
  const legend = buildLegend(units, payload.candidates);
  const key = [officeId, yearId, stateName || 'ng', level].filter(Boolean).join(':');
  return {
    ok: true,
    key,
    office: officeId,
    year: yearId,
    state: stateName || payload.meta?.state || null,
    level,
    title: payload.meta?.title || `${yearId} ${officeId} election`,
    source: payload.meta?.source || process.env.ELECTION_RESULTS_SOURCE_URL || 'INEC declared results',
    sourceUrl: payload.meta?.sourceUrl || process.env.ELECTION_RESULTS_SOURCE_URL || 'https://www.inecnigeria.org/',
    attribution: payload.meta?.attribution || 'Independent National Electoral Commission (INEC)',
    updated: payload.meta?.updated || null,
    winner: payload.winner || null,
    candidates: payload.candidates || null,
    units,
    legend,
    availableStates: officeId === 'gov' ? availableGovStates(yearId) : [],
  };
}

async function loadChoropleth({ office, year, state }) {
  const officeId = String(office || '').toLowerCase();
  const yearId = String(year || '');
  const stateName = state ? canonicalState(state) : null;
  const govStates = officeId === 'gov' ? availableGovStates(yearId) : [];

  try {
    ensureElectionResultsSeeded();
    const fromDb = loadElectionDataset({ office: officeId, year: yearId, state: stateName });
    if (fromDb && fromDb.units && Object.keys(fromDb.units).length) {
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
      const level = payload.meta?.level || 'state';
      return packChoropleth(payload, officeId, yearId, stateName, level);
    }
    const lgaMatch = STATIC_INDEX.find((row) =>
      row.office === 'gov' &&
      String(row.year) === yearId &&
      normalizeKey(row.state) === normalizeKey(stateName)
    );
    if (lgaMatch) {
      const payload = await readDataset(lgaMatch.file);
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
      message: 'Official collated map data not loaded yet for this selection.',
      units: {},
      legend: [],
      availableStates: govStates,
    };
  }

  const payload = await readDataset(match.file);
  return packChoropleth(payload, officeId, yearId, stateName || payload.meta?.state || null, match.level);
}

function listAvailableDatasets() {
  const rows = [...STATIC_INDEX];
  const govDir = path.join(DATA_DIR, 'gubernatorial');
  if (fsSync.existsSync(govDir)) {
    for (const file of fsSync.readdirSync(govDir)) {
      if (!file.endsWith('.json')) continue;
      const m = file.match(/^(.+)-(\d{4})\.json$/);
      if (!m) continue;
      const state = m[1].split('-').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
      rows.push({ office: 'gov', year: m[2], state, level: 'state', file: path.join('gubernatorial', file) });
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
};
