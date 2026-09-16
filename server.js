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
const { buildAnalysisBundle } = require('./election-analysis');
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
    dir: process.env.ELECTION_RESULTS_DIR || path.join(__dirname, 'data', 'election-results'),
    sourceUrl: process.env.ELECTION_RESULTS_SOURCE_URL || 'https://www.inecnigeria.org/',
    irevUrl: process.env.INEC_IREV_URL || 'https://cvr.inecnigeria.org/',
    datasets: listAvailableDatasets(),
  });
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
      momentumWeight: req.query.momentum != null ? Number(req.query.momentum) : undefined,
      retentionWeight: req.query.retention != null ? Number(req.query.retention) : undefined,
      competitiveCutoff: req.query.cutoff != null ? Number(req.query.cutoff) : undefined,
    };
    const payload = buildAnalysisBundle(filters);
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
};
