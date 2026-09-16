const fs = require('fs');
const path = require('path');
const {
  DATA_DIR,
  listAvailableDatasets,
  isPublishableLegacyPayload,
} = require('../election-results-data');

const OFFICE_LABELS = Object.freeze({
  pres: 'Presidential',
  gov: 'Gubernatorial',
  sen: 'Senatorial',
  reps: 'House of Representatives',
  assembly: 'State Assembly',
});

const CATEGORY_ORDER = [
  'results',
  'candidates',
  'geography',
  'reference',
  'catalogs',
];

function officeLabel(office) {
  const key = String(office || '').toLowerCase();
  return OFFICE_LABELS[key] || String(office || 'Election').replace(/^\w/, (c) => c.toUpperCase());
}

function titleCaseState(slug) {
  return String(slug || '')
    .split('-')
    .filter(Boolean)
    .map((w) => (w.toLowerCase() === 'fct' ? 'FCT' : w.charAt(0).toUpperCase() + w.slice(1)))
    .join(' ');
}

function safeRelPath(rel) {
  const normalized = path.normalize(String(rel || '')).replace(/^([/\\])+/, '').replace(/\\/g, '/');
  if (!normalized || normalized.includes('..')) return null;
  return normalized;
}

function fileExistsUnderData(rel) {
  const safe = safeRelPath(rel);
  if (!safe) return false;
  const full = path.join(DATA_DIR, safe);
  if (!full.startsWith(path.resolve(DATA_DIR))) return false;
  return fs.existsSync(full);
}

function readPublishable(rel) {
  const safe = safeRelPath(rel);
  if (!safe) return null;
  const full = path.join(DATA_DIR, safe);
  if (!full.startsWith(path.resolve(DATA_DIR)) || !fs.existsSync(full)) return null;
  try {
    const payload = JSON.parse(fs.readFileSync(full, 'utf8'));
    if (!isPublishableLegacyPayload(payload)) return null;
    return { rel: safe, payload };
  } catch {
    return null;
  }
}

function scanOfficeFolder(folder, office) {
  const dir = path.join(DATA_DIR, folder);
  if (!fs.existsSync(dir)) return [];
  const rows = [];
  for (const file of fs.readdirSync(dir)) {
    if (!file.endsWith('.json')) continue;
    const m = file.match(/^(.+)-(\d{4})(?:-lga)?\.json$/);
    if (!m) continue;
    const rel = path.join(folder, file).replace(/\\/g, '/');
    const loaded = readPublishable(rel);
    if (!loaded) continue;
    const meta = loaded.payload.meta || {};
    const year = String(meta.year || meta.electionDate?.slice?.(0, 4) || m[2]);
    const state = meta.state || titleCaseState(m[1]);
    const level = meta.level || (/-lga\.json$/i.test(file) ? 'lga' : 'state');
    rows.push({
      office: String(meta.office || office).toLowerCase(),
      year,
      state,
      level,
      file: rel,
      title: meta.title || null,
      updated: meta.updated || meta.electionDate || null,
      source: meta.source || meta.attribution || 'Election archive',
    });
  }
  return rows;
}

function resultDatasetId(row) {
  const parts = ['result', row.office, row.year];
  if (row.state) parts.push(String(row.state).toLowerCase().replace(/\s+/g, '-'));
  if (row.level) parts.push(row.level);
  parts.push(path.basename(row.file, '.json'));
  return parts.join(':').replace(/[^a-z0-9:_-]+/gi, '-');
}

function collectResultRows() {
  const seen = new Set();
  const rows = [];
  const push = (row) => {
    if (!row?.file || !fileExistsUnderData(row.file)) return;
    const loaded = readPublishable(row.file);
    if (!loaded) return;
    const key = loaded.rel;
    if (seen.has(key)) return;
    seen.add(key);
    const meta = loaded.payload.meta || {};
    rows.push({
      office: String(row.office || meta.office || 'pres').toLowerCase(),
      year: String(row.year || meta.year || ''),
      state: row.state || meta.state || null,
      level: row.level || meta.level || 'state',
      file: loaded.rel,
      title: meta.title || row.title || null,
      updated: meta.updated || meta.electionDate || row.updated || null,
      source: meta.source || meta.attribution || row.source || 'Election archive',
    });
  };

  for (const item of listAvailableDatasets()) push(item);
  for (const row of scanOfficeFolder('house', 'reps')) push(row);
  for (const row of scanOfficeFolder('senatorial', 'sen')) push(row);
  for (const row of scanOfficeFolder('official', 'gov')) push(row);
  return rows.sort((a, b) => {
    const oy = String(b.year).localeCompare(String(a.year));
    if (oy) return oy;
    const oo = String(a.office).localeCompare(String(b.office));
    if (oo) return oo;
    return String(a.state || '').localeCompare(String(b.state || ''));
  });
}

function resultCatalogEntries() {
  return collectResultRows().map((row) => {
    const name = row.title
      || [
        officeLabel(row.office),
        row.year,
        row.state,
        row.level && row.level !== 'state' ? `(${row.level})` : null,
      ].filter(Boolean).join(' · ');
    const coverage = [row.state || 'Nigeria', row.level, row.year].filter(Boolean).join(' · ');
    return {
      id: resultDatasetId(row),
      name,
      category: 'results',
      country: 'ng',
      office: row.office,
      year: row.year,
      state: row.state,
      level: row.level,
      type: 'Tabular',
      formats: ['json', 'csv'],
      fmt: 'JSON / CSV',
      coverage,
      source: row.source,
      updated: row.updated || row.year || '—',
      icon: 'how_to_vote',
      public: true,
      kind: 'result-file',
      file: row.file,
    };
  });
}

function staticCatalogEntries() {
  const popPath = path.join(__dirname, '..', 'data', 'reference', 'population-pvc-data.json');
  let popUpdated = 'Local file';
  try {
    if (fs.existsSync(popPath)) {
      popUpdated = new Date(fs.statSync(popPath).mtime).toISOString().slice(0, 10);
    }
  } catch { /* ignore */ }

  return [
    {
      id: 'candidates:presidential',
      name: 'Presidential candidates',
      category: 'candidates',
      country: 'ng',
      office: 'pres',
      year: null,
      type: 'Tabular',
      formats: ['json', 'csv'],
      fmt: 'JSON / CSV',
      coverage: '2015–2023 ballots + profiles',
      source: 'INEC candidate lists / Wikipedia enrichment',
      updated: 'Catalog',
      icon: 'person',
      public: true,
      kind: 'static-json',
      href: '/data/presidential-candidates.json',
      csvShape: 'candidates-presidential',
    },
    {
      id: 'candidates:gubernatorial',
      name: 'Gubernatorial candidates',
      category: 'candidates',
      country: 'ng',
      office: 'gov',
      year: null,
      type: 'Tabular',
      formats: ['json', 'csv'],
      fmt: 'JSON / CSV',
      coverage: 'State governorship races',
      source: 'Curated candidate catalog',
      updated: 'Catalog',
      icon: 'person',
      public: true,
      kind: 'static-json',
      href: '/data/gubernatorial-candidates.json',
      csvShape: 'candidates-generic',
    },
    {
      id: 'candidates:senatorial',
      name: 'Senatorial candidates',
      category: 'candidates',
      country: 'ng',
      office: 'sen',
      year: null,
      type: 'Tabular',
      formats: ['json', 'csv'],
      fmt: 'JSON / CSV',
      coverage: 'State senatorial districts',
      source: 'Curated candidate catalog',
      updated: 'Catalog',
      icon: 'person',
      public: true,
      kind: 'static-json',
      href: '/data/senatorial-candidates.json',
      csvShape: 'candidates-generic',
    },
    {
      id: 'candidates:reps',
      name: 'House of Representatives candidates',
      category: 'candidates',
      country: 'ng',
      office: 'reps',
      year: null,
      type: 'Tabular',
      formats: ['json', 'csv'],
      fmt: 'JSON / CSV',
      coverage: 'Federal constituencies',
      source: 'Curated candidate catalog',
      updated: 'Catalog',
      icon: 'person',
      public: true,
      kind: 'static-json',
      href: '/data/reps-candidates.json',
      csvShape: 'candidates-generic',
    },
    {
      id: 'reference:population-pvc',
      name: 'Population / PVC register',
      category: 'reference',
      country: 'ng',
      office: null,
      year: null,
      type: 'Tabular',
      formats: ['json', 'csv'],
      fmt: 'JSON / CSV',
      coverage: 'States + LGAs (population may be withheld)',
      source: 'population-pvc-data.json',
      updated: popUpdated,
      icon: 'bar_chart',
      public: true,
      kind: 'api-json',
      href: '/api/population-data',
      csvShape: 'population',
      notes: 'Raw population counts are withheld until product/licence verification; voter-register fields remain available.',
    },
    {
      id: 'reference:summary',
      name: 'Reference data summary',
      category: 'reference',
      country: 'ng',
      office: null,
      year: null,
      type: 'Status',
      formats: ['json'],
      fmt: 'JSON',
      coverage: 'Voter register + PU coordinate coverage',
      source: '/api/v1/reference-summary',
      updated: 'Live',
      icon: 'fact_check',
      public: true,
      kind: 'api-json',
      href: '/api/v1/reference-summary',
    },
    {
      id: 'reference:party-colors',
      name: 'Party colour palette',
      category: 'reference',
      country: 'ng',
      office: null,
      year: null,
      type: 'Tabular',
      formats: ['json', 'csv'],
      fmt: 'JSON / CSV',
      coverage: 'Tracked parties',
      source: 'Dashboard palette',
      updated: 'Static',
      icon: 'palette',
      public: true,
      kind: 'api-json',
      href: '/api/party-colors',
      csvShape: 'party-colors',
    },
    {
      id: 'geography:countries',
      name: 'Country registry',
      category: 'geography',
      country: 'global',
      office: null,
      year: null,
      type: 'Tabular',
      formats: ['json'],
      fmt: 'JSON',
      coverage: 'Tracked countries',
      source: '/data/countries.json',
      updated: 'Catalog',
      icon: 'public',
      public: true,
      kind: 'static-json',
      href: '/data/countries.json',
    },
    {
      id: 'geography:boundaries-status',
      name: 'Boundary layers status',
      category: 'geography',
      country: 'ng',
      office: null,
      year: null,
      type: 'Status',
      formats: ['json'],
      fmt: 'JSON',
      coverage: 'State / LGA / ward availability',
      source: '/api/boundaries/status',
      updated: 'Live',
      icon: 'map',
      public: true,
      kind: 'api-json',
      href: '/api/boundaries/status',
    },
    {
      id: 'geography:boundaries-state',
      name: 'State boundaries (GeoJSON)',
      category: 'geography',
      country: 'ng',
      office: null,
      year: null,
      type: 'Vector',
      formats: ['json'],
      fmt: 'GeoJSON',
      coverage: '37 states + FCT',
      source: 'Uploaded boundary store',
      updated: 'Live',
      icon: 'map',
      public: true,
      kind: 'api-json',
      href: '/api/boundaries/state',
    },
    {
      id: 'geography:boundaries-lga',
      name: 'LGA boundaries (GeoJSON)',
      category: 'geography',
      country: 'ng',
      office: null,
      year: null,
      type: 'Vector',
      formats: ['json'],
      fmt: 'GeoJSON',
      coverage: 'Local government areas',
      source: 'Uploaded boundary store',
      updated: 'Live',
      icon: 'map',
      public: true,
      kind: 'api-json',
      href: '/api/boundaries/lga',
    },
    {
      id: 'geography:adm0-zip',
      name: 'ADM0 boundary package',
      category: 'geography',
      country: 'ng',
      office: null,
      year: null,
      type: 'Vector',
      formats: ['zip'],
      fmt: 'ZIP / SHP',
      coverage: 'Country outline',
      source: '/data/boundaries/adm0.zip',
      updated: 'Static',
      icon: 'folder_zip',
      public: true,
      kind: 'static-file',
      href: '/data/boundaries/adm0.zip',
    },
    {
      id: 'geography:adm1-zip',
      name: 'ADM1 boundary package',
      category: 'geography',
      country: 'ng',
      office: null,
      year: null,
      type: 'Vector',
      formats: ['zip'],
      fmt: 'ZIP / SHP',
      coverage: 'States',
      source: '/data/boundaries/adm1.zip',
      updated: 'Static',
      icon: 'folder_zip',
      public: true,
      kind: 'static-file',
      href: '/data/boundaries/adm1.zip',
    },
    {
      id: 'geography:adm2-zip',
      name: 'ADM2 boundary package',
      category: 'geography',
      country: 'ng',
      office: null,
      year: null,
      type: 'Vector',
      formats: ['zip'],
      fmt: 'ZIP / SHP',
      coverage: 'LGAs',
      source: '/data/boundaries/adm2.zip',
      updated: 'Static',
      icon: 'folder_zip',
      public: true,
      kind: 'static-file',
      href: '/data/boundaries/adm2.zip',
    },
    {
      id: 'geography:polling-units-geojson',
      name: 'Polling units (GeoJSON)',
      category: 'geography',
      country: 'ng',
      office: null,
      year: null,
      type: 'Points',
      formats: ['json'],
      fmt: 'GeoJSON',
      coverage: 'INEC polling-unit points',
      source: 'Nigeria_polling_units.csv',
      updated: popUpdated,
      icon: 'where_to_vote',
      public: true,
      kind: 'api-json',
      href: '/api/polling-units.geojson',
      notes: 'Large download — prefer filtered /api/polling-unit-points?bbox=… for map extracts.',
    },
    {
      id: 'geography:grid3-config',
      name: 'GRID3 layer configuration',
      category: 'geography',
      country: 'ng',
      office: null,
      year: null,
      type: 'Config',
      formats: ['json'],
      fmt: 'JSON',
      coverage: 'States, LGAs, wards, health',
      source: 'ArcGIS FeatureServers',
      updated: 'Live',
      icon: 'layers',
      public: true,
      kind: 'api-json',
      href: '/api/grid3-config',
    },
    {
      id: 'catalogs:gov',
      name: 'Governorship result catalog',
      category: 'catalogs',
      country: 'ng',
      office: 'gov',
      year: null,
      type: 'Tabular',
      formats: ['json'],
      fmt: 'JSON',
      coverage: 'All states · available years',
      source: '/api/election-results/gov-catalog',
      updated: 'Live',
      icon: 'database',
      public: true,
      kind: 'api-json',
      href: '/api/election-results/gov-catalog',
    },
    {
      id: 'catalogs:result-index',
      name: 'Result dataset index',
      category: 'catalogs',
      country: 'ng',
      office: null,
      year: null,
      type: 'Tabular',
      formats: ['json'],
      fmt: 'JSON',
      coverage: 'Publishable map/result datasets',
      source: '/api/election-results/datasets',
      updated: 'Live',
      icon: 'list_alt',
      public: true,
      kind: 'api-json',
      href: '/api/election-results/datasets',
    },
    {
      id: 'catalogs:analysis-pres-2023',
      name: 'Analysis bundle (Presidential 2023)',
      category: 'catalogs',
      country: 'ng',
      office: 'pres',
      year: '2023',
      type: 'Analytics',
      formats: ['json'],
      fmt: 'JSON',
      coverage: 'National analysis metrics',
      source: '/api/election-results/analysis',
      updated: 'Live',
      icon: 'insights',
      public: true,
      kind: 'api-json',
      href: '/api/election-results/analysis?office=pres&year=2023',
    },
    {
      id: 'catalogs:page-content-ng',
      name: 'Published page content (Nigeria)',
      category: 'catalogs',
      country: 'ng',
      office: null,
      year: null,
      type: 'Config',
      formats: ['json'],
      fmt: 'JSON',
      coverage: 'Nav, widgets, data sources',
      source: '/api/page-content/ng',
      updated: 'Published',
      icon: 'article',
      public: true,
      kind: 'api-json',
      href: '/api/page-content/ng',
    },
    {
      id: 'catalogs:dashboards-overview',
      name: 'Published Overview dashboard',
      category: 'catalogs',
      country: 'ng',
      office: null,
      year: null,
      type: 'Config',
      formats: ['json'],
      fmt: 'JSON',
      coverage: 'KPI / widget layout',
      source: '/api/dashboards/overview',
      updated: 'Published',
      icon: 'dashboard',
      public: true,
      kind: 'api-json',
      href: '/api/dashboards/overview',
    },
    {
      id: 'catalogs:maps-views',
      name: 'Published map views',
      category: 'catalogs',
      country: 'ng',
      office: null,
      year: null,
      type: 'Config',
      formats: ['json'],
      fmt: 'JSON',
      coverage: 'Basemap / layers / extents',
      source: '/api/maps/views',
      updated: 'Published',
      icon: 'map',
      public: true,
      kind: 'api-json',
      href: '/api/maps/views',
    },
    {
      id: 'reference:live-submissions-approved',
      name: 'Approved citizen live submissions',
      category: 'reference',
      country: 'ng',
      office: null,
      year: null,
      type: 'Tabular',
      formats: ['json', 'csv'],
      fmt: 'JSON / CSV',
      coverage: 'Approved EC8A submissions only',
      source: '/api/live-submissions?status=approved',
      updated: 'Live',
      icon: 'verified',
      public: true,
      kind: 'api-json',
      href: '/api/live-submissions?status=approved',
      csvShape: 'live-submissions',
      notes: 'Pending and rejected submissions stay admin-gated.',
    },
  ];
}

function withDownloadUrls(entry) {
  const formats = Array.isArray(entry.formats) ? entry.formats : ['json'];
  const downloads = {};
  for (const fmt of formats) {
    if (fmt === 'zip' && entry.href) {
      downloads.zip = entry.href;
      continue;
    }
    if ((entry.kind === 'static-file' || entry.kind === 'static-json' || entry.kind === 'api-json')
      && fmt === 'json' && entry.href && !entry.csvShape) {
      downloads.json = entry.href;
      continue;
    }
    downloads[fmt] = `/api/data-catalog/download?id=${encodeURIComponent(entry.id)}&format=${encodeURIComponent(fmt)}`;
  }
  if (!downloads.json && entry.href && formats.includes('json')) {
    downloads.json = `/api/data-catalog/download?id=${encodeURIComponent(entry.id)}&format=json`;
  }
  return { ...entry, downloads };
}

let _catalogCache = null;
let _catalogCacheAt = 0;
const CATALOG_CACHE_MS = 60_000;

function buildDataCatalog({ force } = {}) {
  const now = Date.now();
  if (!force && _catalogCache && (now - _catalogCacheAt) < CATALOG_CACHE_MS) {
    return _catalogCache;
  }
  const datasets = [
    ...staticCatalogEntries(),
    ...resultCatalogEntries(),
  ].map(withDownloadUrls);

  const offices = [...new Set(datasets.map((d) => d.office).filter(Boolean))].sort();
  const years = [...new Set(datasets.map((d) => d.year).filter(Boolean))].sort((a, b) => String(b).localeCompare(String(a)));
  const categories = CATEGORY_ORDER.filter((c) => datasets.some((d) => d.category === c));

  _catalogCache = {
    ok: true,
    generatedAt: new Date().toISOString(),
    count: datasets.length,
    offices,
    years,
    categories,
    officeLabels: OFFICE_LABELS,
    datasets,
    gated: [
      {
        name: 'Editorial draft / quarantine datasets',
        reason: 'Require admin authentication via /api/v1/admin/datasets',
      },
      {
        name: 'Drive source files & INEC ingest controls',
        reason: 'Admin-only operational endpoints',
      },
      {
        name: 'Pending / rejected live submissions',
        reason: 'Moderation workflow; public export is approved-only',
      },
      {
        name: 'Unverified population counts',
        reason: 'Withheld in public population API until product/licence status is verified',
      },
    ],
  };
  _catalogCacheAt = now;
  return _catalogCache;
}

function findCatalogEntry(id) {
  const catalog = buildDataCatalog();
  return catalog.datasets.find((d) => d.id === id) || null;
}

function csvEscape(value) {
  if (value == null) return '';
  const s = String(value);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function rowsToCsv(rows) {
  if (!rows.length) return '';
  const keys = [...rows.reduce((set, row) => {
    Object.keys(row).forEach((k) => set.add(k));
    return set;
  }, new Set())];
  const lines = [keys.join(',')];
  for (const row of rows) {
    lines.push(keys.map((k) => csvEscape(row[k])).join(','));
  }
  return `${lines.join('\n')}\n`;
}

function resultPayloadToRows(payload) {
  const meta = payload?.meta || {};
  const rows = [];
  if (payload?.units && typeof payload.units === 'object') {
    for (const [unit, row] of Object.entries(payload.units)) {
      const votes = row?.votes && typeof row.votes === 'object' ? row.votes : {};
      const base = {
        unit,
        winner: row?.winner || '',
        party: row?.party || '',
        office: meta.office || '',
        year: meta.year || '',
        state: meta.state || '',
        level: meta.level || '',
      };
      const partyKeys = Object.keys(votes);
      if (partyKeys.length) {
        for (const party of partyKeys) {
          rows.push({ ...base, vote_party: party, votes: votes[party] });
        }
      } else {
        rows.push({ ...base, vote_party: '', votes: '' });
      }
    }
    return rows;
  }
  if (Array.isArray(payload?.seats)) {
    for (const seat of payload.seats) {
      const winner = seat.winner || {};
      const cands = Array.isArray(seat.candidates) && seat.candidates.length
        ? seat.candidates
        : [{ name: winner.name, party: winner.party, votes: null, outcome: 'Won' }];
      for (const cand of cands) {
        rows.push({
          district: seat.district || '',
          candidate: cand.name || '',
          party: cand.party || '',
          votes: cand.votes == null ? '' : cand.votes,
          outcome: cand.outcome || '',
          office: meta.office || '',
          year: meta.year || '',
          state: meta.state || '',
        });
      }
    }
    return rows;
  }
  if (Array.isArray(payload?.candidates)) {
    return payload.candidates.map((c) => ({
      name: c.name || '',
      party: c.party || '',
      votes: c.votes == null ? '' : c.votes,
      office: meta.office || '',
      year: meta.year || '',
      state: meta.state || '',
    }));
  }
  return [{ note: 'No tabular rows in this payload' }];
}

function flattenCandidateCatalog(data, shape) {
  const rows = [];
  if (shape === 'candidates-presidential') {
    const ballots = data?.ballots || {};
    for (const [year, list] of Object.entries(ballots)) {
      for (const row of list || []) {
        rows.push({
          year,
          party: row.party || '',
          name: row.name || '',
          runningMate: row.runningMate || '',
          outcome: row.outcome || '',
          votes: row.votes == null ? '' : row.votes,
          share: row.share == null ? '' : row.share,
          profileId: row.profileId || '',
        });
      }
    }
    return rows;
  }
  // Generic: try common shapes
  if (Array.isArray(data)) {
    return data.map((row) => ({ ...row }));
  }
  if (data?.ballots && typeof data.ballots === 'object') {
    for (const [year, list] of Object.entries(data.ballots)) {
      if (Array.isArray(list)) {
        for (const row of list) rows.push({ year, ...row });
      } else if (list && typeof list === 'object') {
        for (const [state, items] of Object.entries(list)) {
          for (const row of items || []) rows.push({ year, state, ...row });
        }
      }
    }
    return rows;
  }
  if (data?.byState && typeof data.byState === 'object') {
    for (const [state, list] of Object.entries(data.byState)) {
      for (const row of list || []) rows.push({ state, ...row });
    }
    return rows;
  }
  if (data?.candidates && Array.isArray(data.candidates)) {
    return data.candidates.map((row) => ({ ...row }));
  }
  if (data?.profiles && typeof data.profiles === 'object') {
    return Object.entries(data.profiles).map(([id, row]) => ({ profileId: id, ...row }));
  }
  return [{ note: 'Catalog has no flat tabular view; use JSON download' }];
}

function flattenApiPayload(entry, data) {
  const shape = entry.csvShape;
  if (shape === 'population') {
    const states = (data?.statePopulation || []).map((row) => ({ level: 'state', ...row }));
    const lgas = (data?.lgaPopulation || []).map((row) => ({ level: 'lga', ...row }));
    return [...states, ...lgas];
  }
  if (shape === 'party-colors') {
    return Object.entries(data || {}).map(([party, color]) => ({ party, color }));
  }
  if (shape === 'live-submissions') {
    return (data?.submissions || []).map((row) => ({
      id: row.id,
      status: row.status,
      state: row.state,
      lga: row.lga,
      ward: row.ward,
      pu: row.pu,
      pu_code: row.pu_code,
      lat: row.lat,
      lng: row.lng,
      submitted_at: row.created_at || row.submitted_at || '',
    }));
  }
  if (shape === 'candidates-presidential' || shape === 'candidates-generic') {
    return flattenCandidateCatalog(data, shape);
  }
  return [{ note: 'CSV not available for this dataset; use JSON' }];
}

async function loadEntryPayload(entry, fetchJson) {
  if (entry.kind === 'result-file') {
    const loaded = readPublishable(entry.file);
    if (!loaded) {
      const err = new Error('Dataset unavailable or not published.');
      err.status = 404;
      throw err;
    }
    return loaded.payload;
  }
  if (entry.kind === 'static-json' || entry.kind === 'static-file') {
    const rel = String(entry.href || '').replace(/^\//, '');
    const full = path.join(__dirname, '..', 'public', rel);
    if (!full.startsWith(path.resolve(path.join(__dirname, '..', 'public')))) {
      const err = new Error('Invalid dataset path.');
      err.status = 400;
      throw err;
    }
    if (entry.kind === 'static-file') {
      return { __filePath: full, __fileName: path.basename(full) };
    }
    return JSON.parse(fs.readFileSync(full, 'utf8'));
  }
  if (entry.kind === 'api-json') {
    if (typeof fetchJson !== 'function') {
      const err = new Error('API dataset loader unavailable.');
      err.status = 500;
      throw err;
    }
    return fetchJson(entry.href);
  }
  const err = new Error('Unknown dataset kind.');
  err.status = 400;
  throw err;
}

async function buildDownload(entry, format, fetchJson) {
  const fmt = String(format || 'json').toLowerCase();
  if (fmt === 'zip' && entry.href) {
    return { redirect: entry.href };
  }

  const payload = await loadEntryPayload(entry, fetchJson);
  if (payload?.__filePath) {
    return {
      filePath: payload.__filePath,
      fileName: payload.__fileName,
      contentType: 'application/octet-stream',
    };
  }

  const baseName = String(entry.id || 'dataset').replace(/[^a-z0-9._-]+/gi, '_');
  if (fmt === 'csv') {
    let rows;
    if (entry.kind === 'result-file') rows = resultPayloadToRows(payload);
    else rows = flattenApiPayload(entry, payload);
    return {
      body: rowsToCsv(rows),
      contentType: 'text/csv; charset=utf-8',
      fileName: `${baseName}.csv`,
    };
  }

  return {
    body: `${JSON.stringify(payload, null, 2)}\n`,
    contentType: 'application/json; charset=utf-8',
    fileName: `${baseName}.json`,
  };
}

function publicCatalogForClient(catalog) {
  return {
    ...catalog,
    datasets: (catalog.datasets || []).map((d) => ({
      id: d.id,
      name: d.name,
      category: d.category,
      country: d.country,
      office: d.office,
      year: d.year,
      state: d.state,
      level: d.level,
      type: d.type,
      formats: d.formats,
      fmt: d.fmt,
      coverage: d.coverage,
      source: d.source,
      updated: d.updated,
      icon: d.icon,
      public: d.public,
      notes: d.notes || null,
      downloads: d.downloads,
      href: d.downloads?.json || d.href || null,
    })),
  };
}

module.exports = {
  OFFICE_LABELS,
  buildDataCatalog,
  publicCatalogForClient,
  findCatalogEntry,
  buildDownload,
  collectResultRows,
};
