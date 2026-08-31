const express = require('express');
const cors = require('cors');
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

const { google } = require('googleapis');
const { getFileMetadata, listFilesInFolderTree, searchFiles, readFile, readPopulationData } = require('./drive');
const { buildPollingUnitDashboardData, normalizeLookupKey } = require('./polling-data');
const { runIngest, loadLatestSnapshot, getIngestStatus, hydrateIngestStatus } = require('./inec-ingest');
const { computeNigeriaKpis } = require('./nigeria-kpis');
const { loadChoropleth, listAvailableDatasets, listAvailableGovStates, PARTY_COLORS } = require('./election-results-data');
const {
  ensurePollingUnitsSeeded,
  importPollingUnitsFromCsv,
  queryPollingUnits,
  getPollingDirectoryTree,
  upsertElectionDataset,
  importElectionResultsFromDir,
  ensureElectionResultsSeeded,
  getDbStatus,
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

const boundaryUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 120 * 1024 * 1024, files: 12 },
});

const app = express();
const PORT = process.env.PORT || 3000;
const LOCAL_BASE_URL = 'http://localhost:3000';
const LOCAL_POPULATION_DATA_PATH = path.join(__dirname, 'public', 'data', 'population-pvc-data.json');
const LOCAL_POLLING_UNIT_DATA_PATH = path.join(__dirname, 'public', 'data', 'Nigeria_polling_units.csv');
const ADMIN_SETTINGS_PATH = path.join(__dirname, 'admin-settings.json');
const ADMIN_ACCESS_PATH = path.join(__dirname, 'admin-access.json');
const CREDENTIALS_PATH = path.join(__dirname, 'credentials.json');
const ADMIN_COOKIE_NAME = 'election_admin_session';
const OAUTH_STATE_COOKIE_NAME = 'election_admin_oauth_state';
const PRIMARY_ADMIN_EMAIL = 'geoinfotechgisteam@gmail.com';
const SESSION_TTL_MS = 12 * 60 * 60 * 1000;
const DRIVE_DASHBOARD_FOLDER_NAME = 'Election Dashboard';
const POLLING_UNIT_POINTS_SOURCE_URL =
  'https://github.com/mykeels/inec-polling-units/raw/refs/heads/master/polling-units.csv';
const GOOGLE_GEOCODING_API_KEY = process.env.GOOGLE_MAPS_API_KEY || process.env.GEOCODING_API_KEY || '';
const ENABLE_GOOGLE_GEOCODING =
  ['1', 'true', 'yes', 'on'].includes(String(process.env.GEOCODE_POLLING_UNITS || '').trim().toLowerCase());
const NIGERIA_BOUNDS = {
  south: 4.0,
  north: 14.9,
  west: 2.5,
  east: 15.8,
};
const NIGERIA_CENTER = {
  latitude: 9.082,
  longitude: 8.6753,
};
const MAX_WARD_DRIFT_METRES = 100000;
const MAX_LGA_DRIFT_METRES = 250000;
const MAX_STATE_DRIFT_METRES = 600000;
const ADMIN_LOGIN_USER = {
  username: 'admin',
  password: 'admin123',
  name: 'Dashboard Admin',
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
    label: 'Google Sheets',
    mimeTypes: ['application/vnd.google-apps.spreadsheet'],
    extensions: [],
  },
  {
    type: 'table',
    label: 'CSV',
    mimeTypes: ['text/csv', 'text/plain'],
    extensions: ['.csv'],
  },
  {
    type: 'table',
    label: 'Excel',
    mimeTypes: ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
    extensions: ['.xlsx'],
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

app.use(cors());
app.use(express.json({ limit: '1mb' }));

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
  const number = Number(String(value ?? '').replace(/,/g, '').trim());
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

function haversineDistanceMetres(a, b) {
  if (!a || !b) {
    return Number.POSITIVE_INFINITY;
  }

  const toRadians = (value) => (value * Math.PI) / 180;
  const earthRadiusMetres = 6371000;
  const lat1 = toRadians(a.latitude);
  const lat2 = toRadians(b.latitude);
  const deltaLat = toRadians(b.latitude - a.latitude);
  const deltaLng = toRadians(b.longitude - a.longitude);
  const sinLat = Math.sin(deltaLat / 2);
  const sinLng = Math.sin(deltaLng / 2);
  const haversine =
    sinLat * sinLat +
    Math.cos(lat1) * Math.cos(lat2) * sinLng * sinLng;

  return 2 * earthRadiusMetres * Math.asin(Math.min(1, Math.sqrt(haversine)));
}

function getPointKey(point) {
  return [point.state, point.lga, point.ward].map((part) => normalizeLookupKey(part)).join('::');
}

function createCentroidAccumulator() {
  return { latitude: 0, longitude: 0, count: 0 };
}

function addCentroidSample(map, key, latitude, longitude) {
  if (!key || !Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    return;
  }

  let accumulator = map.get(key);
  if (!accumulator) {
    accumulator = createCentroidAccumulator();
    map.set(key, accumulator);
  }

  accumulator.latitude += latitude;
  accumulator.longitude += longitude;
  accumulator.count += 1;
}

function finalizeCentroidMap(map) {
  const finalized = new Map();

  for (const [key, value] of map.entries()) {
    if (!value.count) {
      continue;
    }

    finalized.set(key, {
      latitude: value.latitude / value.count,
      longitude: value.longitude / value.count,
      count: value.count,
    });
  }

  return finalized;
}

function hashToUnitInterval(seed, salt = '') {
  const digest = crypto.createHash('sha1').update(`${seed}::${salt}`).digest();
  const integer = digest.readUInt32BE(0);
  return integer / 0xffffffff;
}

function jitterPoint(point, seed, radiusMetres = 350) {
  const angle = hashToUnitInterval(seed, 'angle') * Math.PI * 2;
  const distance = Math.sqrt(hashToUnitInterval(seed, 'distance')) * radiusMetres;
  const latitudeOffset = (Math.sin(angle) * distance) / 111320;
  const longitudeScale = Math.max(Math.cos((point.latitude * Math.PI) / 180), 0.2);
  const longitudeOffset = (Math.cos(angle) * distance) / (111320 * longitudeScale);

  return {
    latitude: point.latitude + latitudeOffset,
    longitude: point.longitude + longitudeOffset,
  };
}

async function geocodePollingUnitAddress(query) {
  if (!GOOGLE_GEOCODING_API_KEY || !query) {
    return null;
  }

  const url = new URL('https://maps.googleapis.com/maps/api/geocode/json');
  url.searchParams.set('address', query);
  url.searchParams.set('region', 'ng');
  url.searchParams.set('components', 'country:NG');
  url.searchParams.set('key', GOOGLE_GEOCODING_API_KEY);

  const response = await fetch(url);

  if (!response.ok) {
    return null;
  }

  const payload = await response.json();

  if (payload.status !== 'OK' || !Array.isArray(payload.results) || !payload.results[0]) {
    return null;
  }

  const location = payload.results[0]?.geometry?.location;

  if (!location) {
    return null;
  }

  const latitude = Number(location.lat);
  const longitude = Number(location.lng);

  if (!isWithinNigeriaBounds(latitude, longitude)) {
    return null;
  }

  return {
    latitude,
    longitude,
    formattedAddress: payload.results[0].formatted_address || '',
    placeId: payload.results[0].place_id || '',
  };
}

function buildPollingUnitAddressQuery(row) {
  return [row.name, row.ward, row.lga, row.state, 'Nigeria']
    .map((part) => String(part || '').trim())
    .filter(Boolean)
    .join(', ');
}

function getFieldValue(row, candidates = []) {
  const normalizedCandidates = candidates.map((candidate) => normalizeLookupKey(candidate));

  for (const [key, value] of Object.entries(row || {})) {
    const normalizedKey = normalizeLookupKey(key);

    if (normalizedCandidates.includes(normalizedKey)) {
      return value;
    }
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
    const coordinateText = getFieldValue(row, ['coordinates', 'coordinate', 'geo', 'location', 'point']);
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
      getFieldValue(row, ['pu_code', 'polling_unit_code', 'pollingunitcode', 'code']) || ''
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
  const wardCentroids = new Map();
  const lgaCentroids = new Map();
  const stateCentroids = new Map();

  for (const point of points) {
    if (!isWithinNigeriaBounds(point.latitude, point.longitude)) {
      continue;
    }

    addCentroidSample(wardCentroids, `${getPointKey(point)}::ward`, point.latitude, point.longitude);
    addCentroidSample(lgaCentroids, `${normalizeLookupKey(point.state)}::${normalizeLookupKey(point.lga)}::lga`, point.latitude, point.longitude);
    addCentroidSample(stateCentroids, `${normalizeLookupKey(point.state)}::state`, point.latitude, point.longitude);
  }

  const finalizedWardCentroids = finalizeCentroidMap(wardCentroids);
  const finalizedLgaCentroids = finalizeCentroidMap(lgaCentroids);
  const finalizedStateCentroids = finalizeCentroidMap(stateCentroids);

  const resolvedPoints = [];

  for (const point of points) {
    const sourceLatitude = point.latitude;
    const sourceLongitude = point.longitude;
    const sourceIsValid = isWithinNigeriaBounds(sourceLatitude, sourceLongitude);
    const wardKey = `${getPointKey(point)}::ward`;
    const lgaKey = `${normalizeLookupKey(point.state)}::${normalizeLookupKey(point.lga)}::lga`;
    const stateKey = `${normalizeLookupKey(point.state)}::state`;
    const wardCentroid = finalizedWardCentroids.get(wardKey) || null;
    const lgaCentroid = finalizedLgaCentroids.get(lgaKey) || null;
    const stateCentroid = finalizedStateCentroids.get(stateKey) || null;

    let geometrySource = 'source';
    let latitude = sourceLatitude;
    let longitude = sourceLongitude;

    if (point.overrideCoordinates) {
      resolvedPoints.push({
        ...point,
        sourceLatitude,
        sourceLongitude,
        latitude,
        longitude,
        geometrySource: point.geometrySource || 'csv-latlong',
        sourceCoordinatesAvailable: true,
      });
      continue;
    }

    const sourceLooksSuspicious = (() => {
      if (!sourceIsValid) {
        return true;
      }

      if (wardCentroid && point.sourceHasCoordinates) {
        const wardDistance = haversineDistanceMetres(
          { latitude: sourceLatitude, longitude: sourceLongitude },
          wardCentroid
        );
        if (wardDistance > MAX_WARD_DRIFT_METRES) {
          return true;
        }
      }

      if (lgaCentroid && point.sourceHasCoordinates) {
        const lgaDistance = haversineDistanceMetres(
          { latitude: sourceLatitude, longitude: sourceLongitude },
          lgaCentroid
        );
        if (lgaDistance > MAX_LGA_DRIFT_METRES) {
          return true;
        }
      }

      if (stateCentroid && point.sourceHasCoordinates) {
        const stateDistance = haversineDistanceMetres(
          { latitude: sourceLatitude, longitude: sourceLongitude },
          stateCentroid
        );
        if (stateDistance > MAX_STATE_DRIFT_METRES) {
          return true;
        }
      }

      return false;
    })();

    if (sourceLooksSuspicious) {
      const geocodedPoint = ENABLE_GOOGLE_GEOCODING
        ? await geocodePollingUnitAddress(point.addressQuery)
        : null;

      if (geocodedPoint) {
        latitude = geocodedPoint.latitude;
        longitude = geocodedPoint.longitude;
        geometrySource = 'google-geocode';
      } else {
        const fallbackCentroid =
          wardCentroid ||
          lgaCentroid ||
          stateCentroid ||
          NIGERIA_CENTER;

        const jitterSeed = point.code || point.addressQuery || `${point.state}::${point.lga}::${point.ward}::${point.name}`;
        const jitterRadiusMetres = wardCentroid ? 120 : lgaCentroid ? 300 : stateCentroid ? 700 : 1200;
        const jittered = jitterPoint(fallbackCentroid, jitterSeed, jitterRadiusMetres);

        latitude = jittered.latitude;
        longitude = jittered.longitude;
        geometrySource = wardCentroid
          ? 'ward-centroid'
          : lgaCentroid
            ? 'lga-centroid'
            : stateCentroid
              ? 'state-centroid'
              : 'country-centre';
      }
    }

    resolvedPoints.push({
      ...point,
      sourceLatitude,
      sourceLongitude,
      latitude,
      longitude,
      geometrySource,
      sourceCoordinatesAvailable: sourceIsValid,
    });
  }

  return resolvedPoints;
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

async function getCredentialsConfig() {
  const credentials = await readJsonFile(CREDENTIALS_PATH, {});
  const config = credentials.web || credentials.installed;

  if (!config?.client_id || !config?.client_secret) {
    throw new Error('credentials.json is missing Google OAuth client details.');
  }

  return config;
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
  return process.env.ADMIN_SESSION_SECRET || process.env.SESSION_SECRET || 'geoinfotech-election-dashboard-local-session';
}

function signValue(value) {
  return crypto.createHmac('sha256', getSessionSecret()).update(value).digest('base64url');
}

function createSessionCookie(admin) {
  const payload = Buffer.from(
    JSON.stringify({
      email: admin.email,
      name: admin.name || '',
      picture: admin.picture || '',
      exp: Date.now() + SESSION_TTL_MS,
    })
  ).toString('base64url');

  return `${payload}.${signValue(payload)}`;
}

function readSession(req) {
  const sessionCookie = parseCookies(req)[ADMIN_COOKIE_NAME];

  if (!sessionCookie) {
    return null;
  }

  const [payload, signature] = sessionCookie.split('.');

  if (!payload || !signature || signature !== signValue(payload)) {
    return null;
  }

  try {
    const session = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    return session.exp > Date.now() ? session : null;
  } catch {
    return null;
  }
}

function createAdminToken(admin) {
  const payload = Buffer.from(
    JSON.stringify({
      username: admin.username,
      name: admin.name || '',
      exp: Date.now() + SESSION_TTL_MS,
    })
  ).toString('base64url');

  return `${payload}.${signValue(payload)}`;
}

function readAdminToken(req) {
  const authHeader = req.get('authorization') || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';

  if (!token) {
    return null;
  }

  const [payload, signature] = token.split('.');

  if (!payload || !signature || signature !== signValue(payload)) {
    return null;
  }

  try {
    const session = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    return session.exp > Date.now() ? session : null;
  } catch {
    return null;
  }
}

function setCookie(res, name, value, maxAgeMs) {
  const maxAge = Math.floor(maxAgeMs / 1000);
  appendCookie(
    res,
    `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}`
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
  const access = await readJsonFile(ADMIN_ACCESS_PATH, { admins: [PRIMARY_ADMIN_EMAIL] });
  const admins = new Set([
    PRIMARY_ADMIN_EMAIL,
    ...(Array.isArray(access.admins) ? access.admins : []),
  ]);

  return { admins: [...admins].map((email) => email.toLowerCase()).sort() };
}

async function isAllowedAdmin(email) {
  const access = await getAdminAccess();
  return access.admins.includes((email || '').toLowerCase());
}

async function requireAdminApi(req, res, next) {
  const oauthSession = readSession(req);
  if (oauthSession && (await isAllowedAdmin(oauthSession.email))) {
    req.admin = oauthSession;
    return next();
  }

  const tokenSession = readAdminToken(req);
  if (tokenSession) {
    req.admin = {
      email: tokenSession.username,
      name: tokenSession.name || tokenSession.username,
      username: tokenSession.username,
    };
    return next();
  }

  return res.status(401).json({ error: 'Admin access required.' });
}

async function requirePrimaryAdminApi(req, res, next) {
  await requireAdminApi(req, res, () => {
    if ((req.admin.email || '').toLowerCase() !== PRIMARY_ADMIN_EMAIL) {
      return res.status(403).json({ error: 'Only the primary admin can manage admin access.' });
    }

    return next();
  });
}

async function requireAdminPage(req, res, next) {
  const session = readSession(req);

  if (!session || !(await isAllowedAdmin(session.email))) {
    return res.redirect('/admin-login.html');
  }

  req.admin = session;
  return next();
}

function getBaseUrl(req) {
  return process.env.BASE_URL || LOCAL_BASE_URL;
}

function getRedirectUri(req) {
  return `${getBaseUrl(req)}/auth/google/callback`;
}

function createOAuthClient(req) {
  return getCredentialsConfig().then(
    (config) => new google.auth.OAuth2(config.client_id, config.client_secret, getRedirectUri(req))
  );
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
        "mimeType = 'application/vnd.google-apps.spreadsheet'",
        "mimeType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'",
      ].join(' or ') +
      ")",
  ]
    .filter(Boolean)
    .join(' and ');
}

function isSupportedPopulationFile(file) {
  return [
    'application/json',
    'application/vnd.google-apps.spreadsheet',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
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

app.get('/auth/google', async (req, res) => {
  try {
    const oauth2Client = await createOAuthClient(req);
    const state = crypto.randomBytes(24).toString('base64url');
    setCookie(res, OAUTH_STATE_COOKIE_NAME, state, 10 * 60 * 1000);

    const url = oauth2Client.generateAuthUrl({
      access_type: 'online',
      prompt: 'select_account',
      scope: ['openid', 'email', 'profile'],
      state,
    });

    return res.redirect(url);
  } catch (error) {
    console.error('Error starting admin Google login:', error.message || error);
    return res.status(500).send('Unable to start Google sign-in.');
  }
});

app.get('/auth/google/callback', async (req, res) => {
  const expectedState = parseCookies(req)[OAUTH_STATE_COOKIE_NAME];

  if (!req.query.state || req.query.state !== expectedState) {
    return res.status(400).send('Invalid admin login state.');
  }

  try {
    const oauth2Client = await createOAuthClient(req);
    const { tokens } = await oauth2Client.getToken(String(req.query.code || ''));
    oauth2Client.setCredentials(tokens);

    const oauth2 = google.oauth2({ auth: oauth2Client, version: 'v2' });
    const profile = await oauth2.userinfo.get();
    const email = (profile.data.email || '').toLowerCase();

    if (!email || !(await isAllowedAdmin(email))) {
      clearCookie(res, OAUTH_STATE_COOKIE_NAME);
      return res.status(403).send('This Google account is not allowed to access the admin page.');
    }

    setCookie(
      res,
      ADMIN_COOKIE_NAME,
      createSessionCookie({
        email,
        name: profile.data.name,
        picture: profile.data.picture,
      }),
      SESSION_TTL_MS
    );
    clearCookie(res, OAUTH_STATE_COOKIE_NAME);
    return res.redirect('/admin.html');
  } catch (error) {
    console.error('Error completing admin Google login:', error.message || error);
    return res.status(500).send('Unable to complete Google sign-in.');
  }
});

app.post('/auth/logout', (req, res) => {
  clearCookie(res, ADMIN_COOKIE_NAME);
  return res.json({ ok: true });
});

app.post('/api/admin/login', (req, res) => {
  const username = String(req.body.username || '').trim();
  const password = String(req.body.password || '');

  if (username !== ADMIN_LOGIN_USER.username || password !== ADMIN_LOGIN_USER.password) {
    return res.status(401).json({ success: false, error: 'Invalid username or password.' });
  }

  return res.json({
    success: true,
    token: createAdminToken(ADMIN_LOGIN_USER),
    admin: {
      username: ADMIN_LOGIN_USER.username,
      name: ADMIN_LOGIN_USER.name,
    },
  });
});

app.get('/api/admin/verify', (req, res) => {
  const session = readAdminToken(req);

  if (!session) {
    return res.status(401).json({ success: false, error: 'Admin login required.' });
  }

  return res.json({
    success: true,
    admin: {
      username: session.username,
      name: session.name,
    },
  });
});

app.get('/admin.html', requireAdminPage, (req, res) => {
  return res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

app.get('/api/admin/me', requireAdminApi, (req, res) => {
  return res.json({
    email: req.admin.email,
    name: req.admin.name,
    isPrimary: (req.admin.email || '').toLowerCase() === PRIMARY_ADMIN_EMAIL,
  });
});

app.get('/api/admin/access', requirePrimaryAdminApi, async (req, res) => {
  const access = await getAdminAccess();
  return res.json(access);
});

app.post('/api/admin/access', requirePrimaryAdminApi, async (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase();

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ error: 'Enter a valid email address.' });
  }

  const access = await getAdminAccess();
  const admins = [...new Set([...access.admins, email])].sort();
  await writeJsonFile(ADMIN_ACCESS_PATH, { admins });
  return res.json({ admins });
});

app.delete('/api/admin/access/:email', requirePrimaryAdminApi, async (req, res) => {
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

app.post('/api/admin/population-source', requireAdminApi, async (req, res) => {
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

app.get('/api/admin/drive/search', requireAdminApi, async (req, res) => {
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
  try {
    const files = await getDashboardDriveDataFiles();
    return res.json(files);
  } catch (error) {
    console.error('Error handling /api/admin/drive/files:', error.message || error);
    return res.status(500).json({ error: 'Failed to list Google Drive files.' });
  }
});

app.use('/admin', express.static(path.join(__dirname, 'admin'), {
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

app.get('/api/population-data', async (req, res) => {
  try {
    const { fileId, mimeType } = await getPopulationSource(req);

    if (fileId) {
      try {
        const data = await readPopulationData(fileId, mimeType);
        return res.json(data);
      } catch (driveError) {
        console.warn('Population Drive source unavailable; falling back to local JSON.', driveError.message || driveError);
      }
    }

    const localData = await fs.readFile(LOCAL_POPULATION_DATA_PATH, 'utf8');
    return res.type('json').send(localData);
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

const EKITI_2026_RESULT = {
  election: 'Ekiti State Governorship Election 2026',
  state: 'Ekiti',
  electionDate: '2026-06-20',
  declaredDate: '2026-06-21',
  winner: { name: 'Biodun Oyebanji', party: 'APC', votes: 319224 },
  candidates: [
    { name: 'Biodun Oyebanji', party: 'APC', votes: 319224 },
    { name: 'Oluwole Oluyede', party: 'PDP', votes: 40543 },
    { name: 'Oluwadare Bejide', party: 'ADC', votes: 12872 },
    { name: 'Ayodeji Ojo', party: 'ADP', votes: 1269 },
    { name: 'Oyebanji Olajuyin', party: 'LP', votes: 276 },
    { name: 'Akande Oluwasegun', party: 'AAC', votes: 195 },
    { name: 'Alade Isaac', party: 'SDP', votes: 179 },
    { name: 'Opeyemi Falegan', party: 'Accord', votes: 56 },
    { name: 'Omotosho Mathew', party: 'AA', votes: 126 },
    { name: 'Anifowoshe Olanrewaju', party: 'APM', votes: 59 },
    { name: 'Bidemi Awogbemi', party: 'APP', votes: 61 },
    { name: 'Blessing Abegunde', party: 'NNPP', votes: 35 },
    { name: 'Osinkolu Olusegun Ayodele', party: 'YPP', votes: 98 },
    { name: 'Victor Adetunji', party: 'ZLP', votes: 113 },
  ],
  totals: { accreditedVoters: 384940, validVotes: 375777, rejectedVotes: 6332, lgAsWon: 16 },
  sources: [
    {
      publisher: 'Channels Television',
      title: 'INEC Declares APC’s Oyebanji Winner Of Ekiti Gov Election',
      url: 'https://www.channelstv.com/2026/06/21/inec-declares-apcs-oyebanji-winner-of-ekiti-gov-election/amp/',
    },
    {
      publisher: 'Premium Times',
      title: 'INEC declares APC’s Oyebanji winner of Ekiti governorship election',
      url: 'https://www.premiumtimesng.com/regional/ssouth-west/889497-its-official-inec-declares-apcs-oyebanji-winner-of-ekiti-governorship-election.html',
    },
    {
      publisher: 'Peoples Gazette',
      title: 'How candidates performed in Ekiti governorship election',
      url: 'https://gazettengr.com/ekitidecides2026-how-candidates-performed-in-ekiti-governorship-election/',
    },
  ],
};

const NIGERIA_2023_PRES = {
  election: '2023 Presidential Election',
  state: 'Nigeria',
  electionDate: '2023-02-25',
  declaredDate: '2023-03-01',
  winner: { name: 'Bola Ahmed Tinubu', party: 'APC', votes: 8707945 },
  candidates: [
    { name: 'Bola Ahmed Tinubu', party: 'APC', votes: 8707945, share: 36.61 },
    { name: 'Atiku Abubakar', party: 'PDP', votes: 6989844, share: 29.07 },
    { name: 'Peter Obi', party: 'LP', votes: 6101549, share: 25.4 },
    { name: 'Rabiu Kwankwaso', party: 'NNPP', votes: 1496633, share: 6.23 },
  ],
  totals: { accreditedVoters: 24894112, validVotes: 24025580, rejectedVotes: 865172, turnout: 26.72 },
  sources: [{ publisher: 'INEC', title: 'Independent National Electoral Commission', url: 'https://www.inecnigeria.org/' }],
};

// Archived results are curated election records. Headlines can surface useful
// coverage, but NewsAPI is not an authoritative vote-count database.
const ELECTION_RESULT_ARCHIVE = {
  nigeria: [NIGERIA_2023_PRES],
  ekiti: [
    EKITI_2026_RESULT,
    {
      election: 'Ekiti State Governorship Election 2022', state: 'Ekiti', electionDate: '2022-06-18', declaredDate: '2022-06-19',
      winner: { name: 'Biodun Oyebanji', party: 'APC', votes: 187057 },
      candidates: [{ name: 'Biodun Oyebanji', party: 'APC', votes: 187057 }, { name: 'Segun Oni', party: 'SDP', votes: 82211 }, { name: 'Bisi Kolawole', party: 'PDP', votes: 67457 }],
      totals: { accreditedVoters: 363438, validVotes: 338130, rejectedVotes: 4453, lgAsWon: 15 },
      sources: [{ publisher: 'INEC', title: 'Independent National Electoral Commission', url: 'https://www.inecnigeria.org/' }],
    },
    {
      election: 'Ekiti State Governorship Election 2018', state: 'Ekiti', electionDate: '2018-07-14', declaredDate: '2018-07-15',
      winner: { name: 'Kayode Fayemi', party: 'APC', votes: 197459 },
      candidates: [{ name: 'Kayode Fayemi', party: 'APC', votes: 197459 }, { name: 'Olusola Eleka', party: 'PDP', votes: 178121 }],
      totals: { accreditedVoters: 328172, validVotes: 321037, rejectedVotes: 7729, lgAsWon: 12 },
      sources: [{ publisher: 'INEC', title: 'Independent National Electoral Commission', url: 'https://www.inecnigeria.org/' }],
    },
    {
      election: 'Ekiti State Governorship Election 2014', state: 'Ekiti', electionDate: '2014-06-21', declaredDate: '2014-06-22',
      winner: { name: 'Ayodele Fayose', party: 'PDP', votes: 203090 },
      candidates: [{ name: 'Ayodele Fayose', party: 'PDP', votes: 203090 }, { name: 'Kayode Fayemi', party: 'APC', votes: 120433 }],
      totals: { accreditedVoters: 360455, validVotes: 323909, rejectedVotes: 7507, lgAsWon: 16 },
      sources: [{ publisher: 'INEC', title: 'Independent National Electoral Commission', url: 'https://www.inecnigeria.org/' }],
    },
  ],
};

const BBC_AFRICA_RSS_URL = 'https://feeds.bbci.co.uk/news/world/africa/rss.xml';
const NEWS_API_KEY = process.env.NEWS_API_KEY || '';

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

async function fetchBbcAfricaNews() {
  const response = await fetch(BBC_AFRICA_RSS_URL, {
    headers: { 'User-Agent': 'Nigeria-Election-GIS-Dashboard/1.0' },
    signal: AbortSignal.timeout(8000),
  });
  if (!response.ok) throw new Error(`BBC RSS returned ${response.status}`);
  return parseBbcRss(await response.text()).slice(0, 4);
}

async function fetchNewsApiElectionNews(state = 'Ekiti') {
  if (!NEWS_API_KEY) return [];
  const url = new URL('https://newsapi.org/v2/everything');
  url.searchParams.set('q', `${state} Nigeria election`);
  url.searchParams.set('language', 'en');
  url.searchParams.set('sortBy', 'publishedAt');
  url.searchParams.set('pageSize', '8');
  url.searchParams.set('apiKey', NEWS_API_KEY);
  const response = await fetch(url, { signal: AbortSignal.timeout(8000) });
  if (!response.ok) throw new Error(`NewsAPI returned ${response.status}`);
  const data = await response.json();
  if (data.status !== 'ok') throw new Error(data.message || 'NewsAPI returned no result.');
  return (data.articles || []).map((article) => ({
    title: article.title,
    url: article.url,
    source: article.source?.name || 'NewsAPI',
    publishedAt: article.publishedAt,
  })).filter((article) => article.title && article.url);
}

async function getElectionResultResponse(state) {
  const stateName = toDisplayCase(state || 'Ekiti');
  const archive = ELECTION_RESULT_ARCHIVE[normalizeLookupKey(stateName)] || [];
  let bbcNews = [];
  let newsApiNews = [];
  let gdeltNews = [];
  const query = encodeURIComponent(`${stateName} Nigeria election result`);
  const [newsApiResult, bbcResult, gdeltResult] = await Promise.allSettled([
    fetchNewsApiElectionNews(stateName),
    fetchBbcAfricaNews(),
    fetch(`https://api.gdeltproject.org/api/v2/doc/doc?query=${query}&mode=artlist&format=json&maxrecords=6&sort=datedesc`, { signal: AbortSignal.timeout(8000) }),
  ]);

  if (newsApiResult.status === 'fulfilled') newsApiNews = newsApiResult.value;
  else console.warn('NewsAPI election refresh unavailable:', newsApiResult.reason?.message || newsApiResult.reason);

  if (bbcResult.status === 'fulfilled') bbcNews = bbcResult.value;
  else console.warn('BBC Africa news refresh unavailable:', bbcResult.reason?.message || bbcResult.reason);

  if (gdeltResult.status === 'fulfilled' && gdeltResult.value.ok) {
    const data = await gdeltResult.value.json();
    gdeltNews = (data.articles || []).map((article) => ({ title: article.title, url: article.url, source: article.domain, publishedAt: article.seendate }));
  } else if (gdeltResult.status === 'rejected') {
    console.warn('GDELT election news refresh unavailable:', gdeltResult.reason?.message || gdeltResult.reason);
  }

  const news = [...newsApiNews, ...bbcNews, ...gdeltNews]
    .filter((article, index, all) => article.url && all.findIndex((item) => item.url === article.url) === index)
    .slice(0, 8);

  if (!news.length) {
    news.push(...(archive[0]?.sources || []).map((source) => ({ title: source.title, url: source.url, source: source.publisher, publishedAt: archive[0].declaredDate })));
  }

  return { state: stateName, latest: archive[0] || null, history: archive.slice(1), news, newsApi: 'NewsAPI + BBC News Africa RSS + GDELT 2.1 DOC API' };
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
    const year = String(req.query.year || '2026');
    const states = listAvailableGovStates(year);
    res.setHeader('Cache-Control', 'public, max-age=300');
    return res.json({ year, states, count: states.length });
  } catch (error) {
    return res.status(500).json({ error: 'Unable to list governorship states.' });
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

// Preserve the original endpoint for existing bookmarks and integrations.
app.get('/api/election-results/ekiti', async (req, res) => {
  const payload = await getElectionResultResponse('Ekiti');
  res.setHeader('Cache-Control', 'public, max-age=900');
  return res.json({ ...payload.latest, history: payload.history, news: payload.news, newsApi: payload.newsApi });
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
        name: 'mykeels/inec-polling-units',
        url: POLLING_UNIT_POINTS_SOURCE_URL,
        counts: sourceCounts,
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

app.post('/api/admin/boundaries/upload', requireAdminApi, boundaryUpload.array('files', 12), async (req, res) => {
  try {
    const files = (req.files || []).map((file) => ({
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

app.delete('/api/admin/boundaries/:layer', requireAdminApi, (req, res) => {
  try {
    const result = deleteBoundaryLayer(String(req.params.layer || '').toLowerCase());
    return res.json({ ok: true, ...result, layers: listBoundaryLayers() });
  } catch (error) {
    return res.status(400).json({ error: error.message || 'Unable to delete boundary layer.' });
  }
});

app.post('/api/admin/db/reimport-polling-units', requireAdminApi, (_req, res) => {
  try {
    pollingTreeCache = null;
    pollingTreePromise = null;
    const count = importPollingUnitsFromCsv(CSV_PATH, normalizePollingUnitPointRow);
    res.json({ ok: true, pollingUnits: count });
  } catch (error) {
    res.status(500).json({ error: error.message || 'Reimport failed.' });
  }
});

app.post('/api/admin/db/reimport-election-results', requireAdminApi, (_req, res) => {
  try {
    const count = importElectionResultsFromDir(true);
    res.json({ ok: true, datasets: count });
  } catch (error) {
    res.status(500).json({ error: error.message || 'Reimport failed.' });
  }
});

app.post('/api/admin/db/upload-election-results', requireAdminApi, (req, res) => {
  try {
    const payload = req.body;
    if (!payload || !payload.units || !payload.meta) {
      return res.status(400).json({ error: 'Body must include meta and units.' });
    }
    const saved = upsertElectionDataset(payload);
    res.json({ ok: true, ...saved });
  } catch (error) {
    res.status(500).json({ error: error.message || 'Upload failed.' });
  }
});

app.post('/api/admin/inec-ingest', requireAdminApi, async (_req, res) => {
  try {
    const result = await runIngest();
    return res.json({ ok: true, status: result.status });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message || String(error) });
  }
});

app.get('/api/elections', (_req, res) => {
  const rows = [];
  for (const [key, list] of Object.entries(ELECTION_RESULT_ARCHIVE)) {
    for (const item of list || []) {
      rows.push({
        key,
        name: item.election,
        type: /presidential/i.test(item.election) ? 'Presidential' : 'Gubernatorial',
        date: (item.electionDate || '').slice(0, 4),
        detail: item.state,
        status: 'Result',
        winner: item.winner,
      });
    }
  }
  rows.push({
    key: 'nigeria-2027',
    name: '2027 General Election',
    type: 'Presidential',
    date: '2027',
    detail: 'Nigeria · scheduled',
    status: 'Upcoming',
    winner: null,
  });
  return res.json({ elections: rows });
});

app.listen(PORT, () => {
  console.log(`Server listening on http://localhost:${PORT}`);
  try {
    const puCount = ensurePollingUnitsSeeded(normalizePollingUnitPointRow);
    const dsCount = ensureElectionResultsSeeded();
    console.log(`Database ready: ${puCount} polling units, ${dsCount} election datasets`);
  } catch (error) {
    console.warn('Database seed skipped:', error.message || error);
  }
  hydrateIngestStatus().catch(() => {});
  runIngest().catch((error) => console.warn('Startup INEC ingest skipped:', error.message || error));
  const sixHours = 6 * 60 * 60 * 1000;
  setInterval(() => {
    runIngest().catch((error) => console.warn('Scheduled INEC ingest failed:', error.message || error));
  }, sixHours);
});
