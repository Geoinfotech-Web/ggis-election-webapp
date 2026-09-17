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
  // Presidential LGA (Stears + INEC). Year-parameterized path: presidential-{year}-lga.json
  // Phase 0: only 2023 has Stears LGA tallies; 2015/2019 have no parties[].lga.
  { office: 'pres', year: '2023', level: 'lga', file: 'presidential-2023-lga.json' },
  { office: 'gov', year: '2026', state: 'Ekiti', level: 'lga', file: 'gubernatorial-ekiti-2026-lga.json' },
];

/** Years with a presidential LGA archive on disk (extensible when future years are ingested). */
function availablePresLgaYears() {
  const years = [];
  for (const item of STATIC_INDEX) {
    if (item.office !== 'pres' || item.level !== 'lga') continue;
    try {
      const full = path.join(DATA_DIR, item.file);
      if (fsSync.existsSync(full)) years.push(String(item.year));
    } catch {
      /* skip */
    }
  }
  // Also discover presidential-{year}-lga.json not yet listed in STATIC_INDEX.
  try {
    for (const file of fsSync.readdirSync(DATA_DIR)) {
      const m = file.match(/^presidential-(\d{4})-lga\.json$/);
      if (!m) continue;
      if (!years.includes(m[1]) && fsSync.existsSync(path.join(DATA_DIR, file))) {
        years.push(m[1]);
      }
    }
  } catch {
    /* skip */
  }
  return [...new Set(years)].sort();
}

function presLgaFileForYear(yearId) {
  const y = String(yearId || '');
  const indexed = STATIC_INDEX.find(
    (row) => row.office === 'pres' && row.level === 'lga' && String(row.year) === y
  );
  if (indexed) return indexed.file;
  const discovered = `presidential-${y}-lga.json`;
  if (fsSync.existsSync(path.join(DATA_DIR, discovered))) return discovered;
  return null;
}

/**
 * Filter a national presidential LGA pack down to one state's units.
 * Units are stored as `{state}::{lga}` keys with `.state` / `.lga` fields.
 * Attaches `stateUnit` when the matching statewide pack has that state.
 */
function filterPresLgaPayload(payload, stateName, yearId) {
  const state = canonicalState(stateName);
  const units = {};
  Object.entries(payload.units || {}).forEach(([key, row]) => {
    const rowState = canonicalState(row.state || (String(key).includes('::') ? String(key).split('::')[0] : ''));
    if (rowState !== state) return;
    const lgaName = row.lga || (String(key).includes('::') ? String(key).split('::').slice(1).join('::') : key);
    units[lgaName] = {
      winner: row.winner,
      party: row.party,
      votes: row.votes || {},
      ...(row.lgaCode ? { lgaCode: row.lgaCode } : {}),
    };
  });
  let stateUnit = null;
  try {
    const y = String(yearId || payload.meta?.year || '');
    const stateFile = path.join(DATA_DIR, `presidential-${y}-states.json`);
    if (y && fsSync.existsSync(stateFile)) {
      const statePack = JSON.parse(fsSync.readFileSync(stateFile, 'utf8'));
      const hit = statePack.units && (statePack.units[state] || Object.entries(statePack.units).find(([k]) => canonicalState(k) === state)?.[1]);
      if (hit) stateUnit = { winner: hit.winner, party: hit.party, votes: hit.votes || {} };
    }
  } catch {
    /* optional statewide attach */
  }
  // Rebuild candidate list from official statewide votes when available (panel totals).
  let candidates = payload.candidates || null;
  let winner = payload.winner || null;
  if (stateUnit && stateUnit.votes) {
    const entries = Object.entries(stateUnit.votes).map(([party, votes]) => ({
      party,
      name: (payload.candidates || []).find((c) => c.party === party)?.name || party,
      votes: Number(votes) || 0,
    })).sort((a, b) => b.votes - a.votes);
    candidates = entries;
    if (entries.length) {
      winner = { name: stateUnit.winner || entries[0].name, party: stateUnit.party || entries[0].party, votes: entries[0].votes };
    }
  }
  return {
    ...payload,
    meta: {
      ...(payload.meta || {}),
      state,
      level: 'lga',
      title: payload.meta?.title
        ? `${payload.meta.title} · ${state}`
        : `${payload.meta?.year || ''} Presidential · ${state} LGAs`,
    },
    units,
    candidates,
    winner,
    stateUnit,
  };
}

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
    let key;
    if (level === 'lga') key = canonicalLga(name);
    else if (level === 'district') key = String(name || '').trim();
    else key = canonicalState(name);
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

const PRES_LGA_CANDIDATE_DISPLAY = {
  APC: 'Bola Ahmed Tinubu',
  PDP: 'Atiku Abubakar',
  LP: 'Peter Obi',
  NNPP: 'Rabiu Musa Kwankwaso',
};

function presLgaDumpPaths() {
  const rawDir = path.join(__dirname, 'scripts', '_wiki_raw');
  const agentDump = path.join(
    process.env.USERPROFILE || '',
    '.cursor',
    'projects',
    'c-Users-Geoinfotech-Documents-GIS-Team-Election-Dashboard',
    'agent-tools',
    '98d628dd-c619-4634-8d47-ceddc7e8948b.txt'
  );
  return {
    rawDir,
    fetchJson: path.join(rawDir, 'stears-pres-lga-fetch.json'),
    checkJson: path.join(rawDir, 'stears-pres-lga-2023-check.json'),
    outJson: path.join(DATA_DIR, 'presidential-2023-lga.json'),
    agentDump,
  };
}

function loadPresLgaDumpFile(file) {
  let text = fsSync.readFileSync(file, 'utf8');
  if (text.startsWith('###')) {
    const idx = text.indexOf('{');
    text = text.slice(idx);
  }
  try {
    return JSON.parse(text);
  } catch (_) {
    /* fall through — agent-tools dumps append markdown after the JSON */
  }
  // Scan for the outermost JSON object, respecting strings/escapes.
  let depth = 0;
  let end = -1;
  let inString = false;
  let escape = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escape) escape = false;
      else if (ch === '\\') escape = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) {
        end = i;
        break;
      }
    }
  }
  if (end < 0) throw new Error('Could not locate JSON object in presidential LGA dump');
  return JSON.parse(text.slice(0, end + 1));
}

function findPresLgaDump() {
  const { fetchJson, agentDump } = presLgaDumpPaths();
  if (fsSync.existsSync(agentDump)) return agentDump;
  if (fsSync.existsSync(fetchJson)) {
    try {
      const parsed = JSON.parse(fsSync.readFileSync(fetchJson, 'utf8'));
      if (parsed && parsed.units && Object.keys(parsed.units).length > 100) return fetchJson;
    } catch (_) {
      /* ignore */
    }
  }
  if (fsSync.existsSync(agentDump)) return agentDump;
  throw new Error('No presidential LGA Stears dump found');
}

/**
 * Build + persist presidential-2023-lga.json (+ check/fetch metadata) from the
 * Stears Playwright dump. Safe to call repeatedly; overwrites outputs.
 */
function ensurePresLga2023Artifacts() {
  const paths = presLgaDumpPaths();
  const dumpPath = findPresLgaDump();
  const dump = loadPresLgaDumpFile(dumpPath);
  const displayName = (party, stearsName) =>
    PRES_LGA_CANDIDATE_DISPLAY[party] || stearsName || party;

  fsSync.mkdirSync(paths.rawDir, { recursive: true });
  fsSync.mkdirSync(DATA_DIR, { recursive: true });

  // Compact fetch metadata (omit huge units blob when writing metadata copy)
  const { units: dumpUnits, ...metaOnly } = dump;
  fsSync.writeFileSync(
    paths.fetchJson,
    JSON.stringify({
      ...metaOnly,
      unitsOmitted: true,
      totalUnitKeys: Object.keys(dumpUnits || {}).length,
    }) + '\n'
  );

  const units = {};
  for (const [key, row] of Object.entries(dumpUnits || {})) {
    const party = row.party;
    units[key] = {
      winner: displayName(party, row.winner),
      party,
      votes: row.votes || {},
      lga: row.lga,
      state: row.state,
      stateCode: row.stateCode,
      ...(row.lgaCode ? { lgaCode: row.lgaCode } : {}),
    };
  }

  // Merge Benue/Nasarawa re-fetch patch (initial batch missed flat-row / nav failure).
  const patchPath = path.join(paths.rawDir, 'stears-pres-lga-2023-be-na-patch.json');
  if (fsSync.existsSync(patchPath)) {
    try {
      const patch = JSON.parse(fsSync.readFileSync(patchPath, 'utf8'));
      for (const st of Object.values(patch.states || {})) {
        Object.assign(units, st.units || {});
        if (dump.lgaByStateSums && st.sums && st.units) {
          const stateName = Object.values(st.units)[0]?.state;
          if (stateName) dump.lgaByStateSums[stateName] = st.sums;
        }
        if (Array.isArray(dump.fetchLog) && st.code) {
          const idx = dump.fetchLog.findIndex((f) => f.code === st.code || f.state === Object.values(st.units || {})[0]?.state);
          const entry = {
            state: Object.values(st.units || {})[0]?.state,
            code: st.code,
            lgaCount: st.lgaCount || Object.keys(st.units || {}).length,
            statusCode: 200,
            patched: true,
          };
          if (idx >= 0) dump.fetchLog[idx] = { ...dump.fetchLog[idx], ...entry };
          else dump.fetchLog.push(entry);
        }
      }
      dump.statesWithLga = new Set([
        ...(dump.fetchLog || []).filter((f) => (f.lgaCount || 0) > 0).map((f) => f.state),
        ...Object.keys(dump.lgaByStateSums || {}).filter((s) => Object.keys(dump.lgaByStateSums[s] || {}).length),
      ]).size;
      dump.totalLgas = Object.keys(units).length;
    } catch (err) {
      console.warn('pres LGA BE/NA patch merge skipped:', err.message || err);
    }
  }

  const candidates = (dump.candidates || []).map((c) => ({
    name: displayName(c.party, c.name),
    party: c.party,
    votes: c.votes,
  }));

  const out = {
    meta: {
      office: 'pres',
      year: '2023',
      level: 'lga',
      title: '2023 Presidential Election — LGA results',
      source: 'Stears Elections (INEC collation)',
      sourceUrl: dump.hubUrl || 'https://www.stears.co/elections/2023/president/',
      sourceDetail:
        'LGA party vote tallies extracted from Stears Elections state pages (__NEXT_DATA__.props.pageProps.parties). Underlying official source: INEC. Coverage may be partial where Stears publishes subset LGA rows.',
      attribution: 'Stears; Independent National Electoral Commission (INEC)',
      updated: new Date().toISOString().slice(0, 10),
      collated: true,
      unitKey: 'state::lga',
      coverage: {
        states: dump.statesWithLga,
        lgas: dump.totalLgas,
        year: '2023',
        statesFetched: dump.statesFetched,
      },
      evidence: [
        { label: 'Stears presidential hub', url: 'https://www.stears.co/elections/2023/president/' },
        { label: 'INEC', url: 'https://www.inecnigeria.org/' },
      ],
    },
    winner: candidates[0]
      ? { name: candidates[0].name, party: candidates[0].party, votes: candidates[0].votes }
      : null,
    candidates,
    units,
  };

  fsSync.writeFileSync(paths.outJson, JSON.stringify(out, null, 2) + '\n');

  // Aggregate check vs state declared file
  const statePath = path.join(DATA_DIR, 'presidential-2023-states.json');
  const mismatches = [];
  const matched = [];
  const MAJOR = ['APC', 'LP', 'NNPP', 'PDP'];
  if (fsSync.existsSync(statePath)) {
    const statePayload = JSON.parse(fsSync.readFileSync(statePath, 'utf8'));
    for (const [state, declared] of Object.entries(statePayload.units || {})) {
      const sums = dump.lgaByStateSums?.[state] || {};
      const hasAny = Object.keys(sums).length > 0;
      if (!hasAny) {
        mismatches.push({ state, kind: 'missing-state', detail: 'No LGA pack' });
        continue;
      }
      const diffs = [];
      for (const party of new Set([
        ...MAJOR,
        ...Object.keys(declared.votes || {}),
        ...Object.keys(sums),
      ])) {
        const a = Number(declared.votes?.[party] || 0);
        const b = Number(sums[party] || 0);
        if (a !== b) diffs.push({ party, stateFile: a, lgaSum: b, delta: b - a });
      }
      const lgaCount = (dump.fetchLog || []).find((f) => f.state === state)?.lgaCount || null;
      if (diffs.length) mismatches.push({ state, kind: 'vote-mismatch', lgaCount, diffs });
      else matched.push({ state, lgaCount });
    }
  }

  fsSync.writeFileSync(
    paths.checkJson,
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        year: '2023',
        sourceUrl: dump.hubUrl,
        statesFetched: dump.statesFetched,
        statesWithLga: dump.statesWithLga,
        totalLgas: dump.totalLgas,
        matchedStates: matched.length,
        mismatchStates: mismatches.length,
        note:
          'Stears state pages often expose a partial LGA set; LGA sums are therefore frequently below INEC state declared totals. Do not treat mismatches as ingest bugs without checking Stears coverage.',
        mismatches,
        matched,
        fetchLog: dump.fetchLog,
      },
      null,
      2
    ) + '\n'
  );

  return out;
}

function presLgaPayloadNeedsRebuild(payload) {
  if (!payload || !payload.units) return true;
  if (payload.units.__MORE__ || payload.units.__PLACEHOLDER__) return true;
  if (payload.meta && payload.meta._buildFromDump) return true;
  return Object.keys(payload.units).length < 300;
}

async function readDataset(relativePath) {
  const fullPath = path.join(DATA_DIR, relativePath);
  if (relativePath === 'presidential-2023-lga.json') {
    try {
      if (!fsSync.existsSync(fullPath) || presLgaPayloadNeedsRebuild(JSON.parse(fsSync.readFileSync(fullPath, 'utf8')))) {
        return ensurePresLga2023Artifacts();
      }
    } catch (_) {
      return ensurePresLga2023Artifacts();
    }
  }
  const raw = await fs.readFile(fullPath, 'utf8');
  return JSON.parse(raw);
}

// Best-effort: materialize LGA artifacts as soon as this module loads (covers wedged-shell recovery).
try {
  const outPath = path.join(DATA_DIR, 'presidential-2023-lga.json');
  let needs = !fsSync.existsSync(outPath);
  if (!needs) {
    try {
      needs = presLgaPayloadNeedsRebuild(JSON.parse(fsSync.readFileSync(outPath, 'utf8')));
    } catch (_) {
      needs = true;
    }
  }
  if (needs) ensurePresLga2023Artifacts();
} catch (err) {
  console.warn('ensurePresLga2023Artifacts deferred:', err.message || err);
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

function availablePresLgaStates(yearId) {
  const file = presLgaFileForYear(yearId);
  if (!file) return [];
  try {
    if (file === 'presidential-2023-lga.json') {
      try {
        const existing = fsSync.existsSync(path.join(DATA_DIR, file))
          ? JSON.parse(fsSync.readFileSync(path.join(DATA_DIR, file), 'utf8'))
          : null;
        if (presLgaPayloadNeedsRebuild(existing)) ensurePresLga2023Artifacts();
      } catch (_) {
        try { ensurePresLga2023Artifacts(); } catch { /* leave empty */ }
      }
    }
    const payload = JSON.parse(fsSync.readFileSync(path.join(DATA_DIR, file), 'utf8'));
    if (!isPublishableLegacyPayload(payload)) return [];
    const states = new Set();
    Object.values(payload.units || {}).forEach((row) => {
      if (row?.state && row.state !== 'x') states.add(canonicalState(row.state));
    });
    return [...states].sort((a, b) => a.localeCompare(b));
  } catch {
    return [];
  }
}

function packChoropleth(payload, officeId, yearId, stateName, level) {
  const units = decorateUnits(payload.units, level);
  const legend = buildLegend(units, payload.candidates);
  const electionYear = electionYearOf(payload.meta) || String(yearId);
  const storageYear = String(payload.meta?.year || yearId);
  const key = [officeId, electionYear, stateName || 'ng', level].filter(Boolean).join(':');
  const integrity = deriveResultIntegrity(payload.meta, level);
  let availableStates = [];
  if (officeId === 'gov') availableStates = availableGovStates(electionYear);
  else if (officeId === 'pres' && availablePresLgaYears().includes(String(electionYear))) {
    availableStates = availablePresLgaStates(electionYear);
  } else if (NASS_OFFICES[officeId]) {
    availableStates = availableNassStates(officeId, electionYear);
  }
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
    // Geographic level only — do not put a truthy string on `coverage` (reserved for gov-coverage mapMode).
    coverageLevel: payload.meta?.level || level,
    attribution: payload.meta?.attribution || null,
    updated: payload.meta?.updated || null,
    electionDate: integrity.electionDate,
    collated: integrity.collated,
    estimated: integrity.estimated,
    lgaMethod: integrity.lgaMethod,
    winner: payload.winner || null,
    candidates: payload.candidates || null,
    stateUnit: payload.stateUnit || null,
    seats: payload.seats || null,
    seatTotal: payload.seatTotal != null ? payload.seatTotal : null,
    chamber: payload.chamber || null,
    units,
    legend,
    availableStates,
  };
}

const NASS_OFFICES = {
  sen: { folder: 'senatorial', label: 'Senatorial', chamber: 'Senate', majorityOf: 109 },
  reps: { folder: 'house', label: 'House of Representatives', chamber: 'House of Reps', majorityOf: 360 },
  assembly: { folder: 'assembly', label: 'State House of Assembly', chamber: 'State Assembly', majorityOf: null },
};

function nassDir(officeId) {
  const conf = NASS_OFFICES[officeId];
  if (!conf) return null;
  return path.join(DATA_DIR, conf.folder);
}

function seatCandidateVotes(seat) {
  return (seat.candidates || [])
    .map((c) => ({
      name: c.name || c.party || '—',
      party: c.party || 'Others',
      votes: c.votes == null || c.votes === '' ? null : Number(c.votes),
      outcome: c.outcome || null,
    }))
    .filter((c) => c.party);
}

function seatHasCollatedVotes(seat) {
  return seatCandidateVotes(seat).some((c) => c.votes != null && Number.isFinite(c.votes) && c.votes > 0);
}

function seatPartyVotes(seat) {
  const votes = {};
  seatCandidateVotes(seat).forEach((c) => {
    if (c.votes == null || !Number.isFinite(c.votes) || c.votes <= 0) return;
    votes[c.party] = (votes[c.party] || 0) + c.votes;
  });
  return votes;
}

function loadNassYearPayloads(officeId, yearId) {
  const dir = nassDir(officeId);
  const year = String(yearId || '');
  if (!dir || !year || !fsSync.existsSync(dir)) return [];
  const rows = [];
  for (const file of fsSync.readdirSync(dir)) {
    if (!file.endsWith('.json')) continue;
    const m = file.match(/-(\d{4})\.json$/);
    if (!m || m[1] !== year) continue;
    try {
      const payload = JSON.parse(fsSync.readFileSync(path.join(dir, file), 'utf8'));
      if (!isPublishableLegacyPayload(payload)) continue;
      // Filename year is authoritative; meta may omit electionDate on older scaffolds.
      rows.push({ file, payload });
    } catch {
      /* skip */
    }
  }
  return rows;
}

function availableNassStates(officeId, yearId) {
  return loadNassYearPayloads(officeId, yearId)
    .map(({ payload }) => canonicalState(payload.meta?.state || ''))
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b));
}

function availableNassYears(officeId) {
  const dir = nassDir(officeId);
  if (!dir || !fsSync.existsSync(dir)) return [];
  const years = new Set();
  for (const file of fsSync.readdirSync(dir)) {
    const m = file.match(/-(\d{4})\.json$/);
    if (m) years.add(m[1]);
  }
  return [...years].sort((a, b) => Number(b) - Number(a));
}

/**
 * Build a national state choropleth (plurality of seat wins) or a single-state
 * district pack for Senate / House / Assembly archives under data/election-results/.
 */
function loadNassChoropleth(officeId, yearId, stateName) {
  const conf = NASS_OFFICES[officeId];
  if (!conf) return null;
  const year = String(yearId || '');
  const rows = loadNassYearPayloads(officeId, year);
  if (!rows.length) {
    return {
      ok: false,
      office: officeId,
      year,
      state: stateName || null,
      level: stateName ? 'district' : 'state',
      message: officeId === 'assembly'
        ? 'State House of Assembly results are not archived yet. Stears does not publish assembly election pages for ingest.'
        : `No ${conf.label} archive for ${year}.`,
      units: {},
      legend: [],
      availableStates: [],
    };
  }

  const byState = {};
  let collatedAny = false;
  let source = null;
  let sourceUrl = null;
  let sourceDetail = null;
  let attribution = null;
  let updated = null;
  let electionDate = null;

  for (const { payload } of rows) {
    const state = canonicalState(payload.meta?.state || '');
    if (!state) continue;
    if (!byState[state]) byState[state] = { seats: [], collated: false };
    const seats = Array.isArray(payload.seats) ? payload.seats : [];
    seats.forEach((seat) => {
      const party = seat.winner?.party || seat.candidates?.[0]?.party || 'Others';
      const winner = seat.winner?.name || seat.candidates?.[0]?.name || party;
      const votes = seatPartyVotes(seat);
      const hasVotes = seatHasCollatedVotes(seat);
      if (hasVotes) {
        collatedAny = true;
        byState[state].collated = true;
      }
      byState[state].seats.push({
        district: seat.district || seat.constituency || 'Seat',
        winner,
        party,
        votes,
        hasVotes,
        candidates: seatCandidateVotes(seat),
      });
    });
    if (payload.meta?.collated) {
      collatedAny = true;
      byState[state].collated = true;
    }
    source = source || payload.meta?.source || null;
    sourceUrl = sourceUrl || payload.meta?.sourceUrl || null;
    sourceDetail = sourceDetail || payload.meta?.sourceDetail || payload.meta?.note || null;
    attribution = attribution || payload.meta?.attribution || null;
    updated = updated || payload.meta?.updated || null;
    electionDate = electionDate || payload.meta?.electionDate || null;
  }

  const availableStates = Object.keys(byState).sort((a, b) => a.localeCompare(b));
  if (stateName) {
    const state = canonicalState(stateName);
    const bucket = byState[state];
    if (!bucket || !bucket.seats.length) {
      return {
        ok: false,
        office: officeId,
        year,
        state,
        level: 'district',
        message: `No ${conf.label} seats archived for ${state} in ${year}.`,
        units: {},
        legend: [],
        availableStates,
      };
    }
    const units = {};
    const partySeatTally = {};
    bucket.seats.forEach((seat) => {
      partySeatTally[seat.party] = (partySeatTally[seat.party] || 0) + 1;
      units[seat.district] = {
        winner: seat.winner,
        party: seat.party,
        votes: seat.votes,
        hasVotes: seat.hasVotes,
        candidates: seat.candidates,
        district: seat.district,
        state,
      };
    });
    const candidates = Object.entries(partySeatTally)
      .map(([party, seats]) => ({ party, name: party, votes: seats, seats }))
      .sort((a, b) => b.votes - a.votes);
    const lead = candidates[0] || null;
    return packChoropleth(
      {
        meta: {
          office: officeId,
          year,
          state,
          level: 'district',
          title: `${state} ${conf.label} ${year}`,
          source: source || 'Stears Elections + INEC',
          sourceUrl,
          sourceDetail:
            sourceDetail ||
            `${conf.label} district winners and collated constituency votes where Stears published tallies.`,
          attribution: attribution || 'Stears Elections; Independent National Electoral Commission (INEC)',
          updated,
          electionDate,
          collated: !!bucket.collated || collatedAny,
        },
        winner: lead ? { name: lead.name, party: lead.party, votes: lead.votes } : null,
        candidates,
        units,
        seats: bucket.seats,
        seatTotal: bucket.seats.length,
        chamber: conf.chamber,
      },
      officeId,
      year,
      state,
      'district'
    );
  }

  // National: colour each state by plurality of seat wins; votes object = seat counts.
  const units = {};
  const nationalPartySeats = {};
  let seatTotal = 0;
  Object.entries(byState).forEach(([state, bucket]) => {
    const seatWins = {};
    let voteSums = {};
    let hasVoteSums = false;
    bucket.seats.forEach((seat) => {
      seatWins[seat.party] = (seatWins[seat.party] || 0) + 1;
      nationalPartySeats[seat.party] = (nationalPartySeats[seat.party] || 0) + 1;
      seatTotal += 1;
      if (seat.hasVotes) {
        hasVoteSums = true;
        Object.entries(seat.votes || {}).forEach(([party, n]) => {
          voteSums[party] = (voteSums[party] || 0) + Number(n || 0);
        });
      }
    });
    const ranked = Object.entries(seatWins).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    const topParty = ranked[0]?.[0] || 'Others';
    const topSeats = ranked[0]?.[1] || 0;
    units[state] = {
      winner: `${topParty} · ${topSeats}/${bucket.seats.length} seats`,
      party: topParty,
      votes: seatWins,
      seatWins,
      seats: bucket.seats,
      seatCount: bucket.seats.length,
      collated: !!bucket.collated,
      voteSums: hasVoteSums ? voteSums : null,
    };
  });

  const candidates = Object.entries(nationalPartySeats)
    .map(([party, seats]) => ({ party, name: party, votes: seats, seats }))
    .sort((a, b) => b.votes - a.votes);
  const lead = candidates[0] || null;
  const majorityOf = conf.majorityOf || seatTotal;

  return packChoropleth(
    {
      meta: {
        office: officeId,
        year,
        level: 'state',
        title: `${year} ${conf.label} Election`,
        source: source || 'Stears Elections + INEC',
        sourceUrl,
        sourceDetail:
          sourceDetail ||
          `State fills = plurality of ${conf.label.toLowerCase()} seat wins. Click a state for district winners and constituency votes when collated.`,
        attribution: attribution || 'Stears Elections; Independent National Electoral Commission (INEC)',
        updated,
        electionDate,
        collated: collatedAny,
      },
      winner: lead ? { name: lead.name, party: lead.party, votes: lead.votes } : null,
      candidates,
      units,
      seats: null,
      seatTotal,
      chamber: conf.chamber,
      majorityOf,
    },
    officeId,
    year,
    null,
    'state'
  );
}

async function loadChoropleth({ office, year, state }) {
  const officeId = String(office || '').toLowerCase();
  const yearId = String(year || '');
  const stateName = state ? canonicalState(state) : null;
  const resolvedGov = officeId === 'gov' && stateName ? resolveGovEntry(stateName, yearId) : null;
  const storageYearId = resolvedGov?.storageYear || yearId;
  const govStates = officeId === 'gov' ? availableGovStates(yearId) : [];

  // Senate / House / Assembly — seat archives (Stears Phase 2+), not SQLite choropleth rows.
  if (NASS_OFFICES[officeId]) {
    return loadNassChoropleth(officeId, yearId, stateName);
  }

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

  // Presidential LGA drill: when a state is selected and an LGA pack exists for the year.
  if (officeId === 'pres' && stateName) {
    const lgaFile = presLgaFileForYear(yearId);
    const lgaStates = lgaFile ? availablePresLgaStates(yearId) : [];
    if (lgaFile) {
      const national = await readDataset(lgaFile);
      if (!isPublishableLegacyPayload(national)) {
        return {
          ok: false, office: officeId, year: yearId, state: stateName, level: 'lga',
          message: 'This legacy dataset is quarantined pending source verification.', units: {}, legend: [], availableStates: lgaStates,
        };
      }
      const filtered = filterPresLgaPayload(national, stateName, yearId);
      if (!Object.keys(filtered.units || {}).length) {
        return {
          ok: false, office: officeId, year: yearId, state: stateName, level: 'lga',
          message: `No presidential LGA tallies for ${stateName} in ${yearId}.`, units: {}, legend: [], availableStates: lgaStates,
        };
      }
      return packChoropleth(filtered, officeId, yearId, stateName, 'lga');
    }
  }

  const match = STATIC_INDEX.find((row) => {
    if (row.office !== officeId || String(row.year) !== yearId) return false;
    if (row.level === 'lga') return false; // LGA packs handled above when state is set
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
      if (item.file === 'presidential-2023-lga.json') {
        try {
          const existing = fsSync.existsSync(path.join(DATA_DIR, item.file))
            ? JSON.parse(fsSync.readFileSync(path.join(DATA_DIR, item.file), 'utf8'))
            : null;
          if (presLgaPayloadNeedsRebuild(existing)) ensurePresLga2023Artifacts();
        } catch (_) {
          try { ensurePresLga2023Artifacts(); } catch { /* leave unavailable */ }
        }
      }
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
  STATIC_INDEX,
  NASS_OFFICES,
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
  availablePresLgaYears,
  availablePresLgaStates,
  availableNassStates,
  availableNassYears,
  loadNassChoropleth,
  presLgaFileForYear,
  filterPresLgaPayload,
  ensurePresLga2023Artifacts,
};
