/**
 * Map Studio configs — persisted JSON for basemap / layer stack / extent / view assignment.
 *
 * Id format (for Dashboard map widgets and public consumers):
 *   ^[a-z][a-z0-9-]{1,62}$
 * Examples: overview-default, polling-default, live-default
 *
 * Dashboard widget reference:
 *   { "type": "map", "config": { "mapId": "overview-default" } }
 *
 * Public views resolve via assignments.overview | .polling | .live → map id.
 */

const fs = require('fs/promises');
const path = require('path');

const MAP_CONFIGS_PATH = process.env.MAP_CONFIGS_PATH
  ? path.resolve(process.env.MAP_CONFIGS_PATH)
  : path.join(__dirname, '..', 'data', 'map-configs.json');

const VIEW_KEYS = ['overview', 'polling', 'live'];
const BASEMAP_IDS = ['streets', 'hybrid', 'satellite', 'terrain', 'dark', 'light'];
const LAYER_IDS = ['state', 'lga', 'ward', 'polling', 'health'];
const CHOROPLETH_THEMES = ['party-winner', 'turnout', 'none'];
const ID_PATTERN = /^[a-z][a-z0-9-]{1,62}$/;

const DEFAULT_EXTENT = { center: [9.08, 8.68], zoom: 6 };

function emptyStore() {
  return {
    version: 1,
    /**
     * View → map config id. Dashboard widgets use mapId directly; these keys
     * wire the hardcoded Overview / Polling units / Live map stages.
     */
    assignments: {
      overview: 'overview-default',
      polling: 'polling-default',
      live: 'live-default',
    },
    maps: {},
  };
}

function defaultMaps() {
  const now = new Date().toISOString();
  return {
    'overview-default': {
      id: 'overview-default',
      name: 'Overview default',
      description: 'National Overview map (state outlines).',
      published: true,
      basemap: 'streets',
      layerStack: [
        { id: 'state', enabled: true },
        { id: 'lga', enabled: false },
        { id: 'ward', enabled: false },
        { id: 'polling', enabled: false },
        { id: 'health', enabled: false },
      ],
      grid3Fallback: true,
      extent: { ...DEFAULT_EXTENT },
      choroplethTheme: 'party-winner',
      createdAt: now,
      updatedAt: now,
    },
    'polling-default': {
      id: 'polling-default',
      name: 'Polling units default',
      description: 'Polling units map with state + LGA boundaries.',
      published: true,
      basemap: 'streets',
      layerStack: [
        { id: 'state', enabled: true },
        { id: 'lga', enabled: true },
        { id: 'ward', enabled: false },
        { id: 'polling', enabled: false },
        { id: 'health', enabled: false },
      ],
      grid3Fallback: true,
      extent: { ...DEFAULT_EXTENT },
      choroplethTheme: 'none',
      createdAt: now,
      updatedAt: now,
    },
    'live-default': {
      id: 'live-default',
      name: 'Live Results default',
      description: 'Live Results choropleth stage (state fills).',
      published: true,
      basemap: 'streets',
      layerStack: [
        { id: 'state', enabled: true },
        { id: 'lga', enabled: false },
        { id: 'ward', enabled: false },
        { id: 'polling', enabled: false },
        { id: 'health', enabled: false },
      ],
      grid3Fallback: true,
      extent: { ...DEFAULT_EXTENT },
      choroplethTheme: 'party-winner',
      createdAt: now,
      updatedAt: now,
    },
  };
}

function isValidId(id) {
  return ID_PATTERN.test(String(id || ''));
}

function normalizeLayerStack(input) {
  const byId = new Map();
  if (Array.isArray(input)) {
    input.forEach((row, index) => {
      const id = String(row?.id || '').toLowerCase();
      if (!LAYER_IDS.includes(id)) return;
      byId.set(id, {
        id,
        enabled: row.enabled !== false && row.visible !== false,
        order: Number.isFinite(Number(row.order)) ? Number(row.order) : index,
      });
    });
  } else if (input && typeof input === 'object') {
    // Accept legacy { state: true, lga: false, ... } shape
    LAYER_IDS.forEach((id, index) => {
      if (Object.prototype.hasOwnProperty.call(input, id)) {
        byId.set(id, { id, enabled: !!input[id], order: index });
      }
    });
  }

  return LAYER_IDS.map((id, index) => {
    const existing = byId.get(id);
    return existing || { id, enabled: id === 'state', order: index };
  }).sort((a, b) => a.order - b.order)
    .map((row, index) => ({ id: row.id, enabled: !!row.enabled, order: index }));
}

function layersObjectFromStack(stack) {
  const out = { state: false, lga: false, ward: false, polling: false, health: false };
  (stack || []).forEach((row) => {
    if (row && LAYER_IDS.includes(row.id)) out[row.id] = !!row.enabled;
  });
  return out;
}

function normalizeExtent(input) {
  const centerIn = Array.isArray(input?.center) ? input.center : DEFAULT_EXTENT.center;
  const lat = Number(centerIn[0]);
  const lng = Number(centerIn[1]);
  const zoom = Number(input?.zoom);
  return {
    center: [
      Number.isFinite(lat) ? lat : DEFAULT_EXTENT.center[0],
      Number.isFinite(lng) ? lng : DEFAULT_EXTENT.center[1],
    ],
    zoom: Number.isFinite(zoom) ? Math.min(18, Math.max(1, zoom)) : DEFAULT_EXTENT.zoom,
  };
}

function normalizeMap(raw, idHint) {
  const id = String(raw?.id || idHint || '').trim().toLowerCase();
  if (!isValidId(id)) {
    const err = new Error('Invalid map id. Use a slug like overview-default (a-z, 0-9, hyphen; 2–63 chars).');
    err.status = 400;
    throw err;
  }
  const basemap = String(raw?.basemap || 'streets').toLowerCase();
  if (!BASEMAP_IDS.includes(basemap)) {
    const err = new Error(`Unknown basemap. Allowed: ${BASEMAP_IDS.join(', ')}`);
    err.status = 400;
    throw err;
  }
  const theme = String(raw?.choroplethTheme || 'party-winner').toLowerCase();
  if (!CHOROPLETH_THEMES.includes(theme)) {
    const err = new Error(`Unknown choropleth theme. Allowed: ${CHOROPLETH_THEMES.join(', ')}`);
    err.status = 400;
    throw err;
  }
  const now = new Date().toISOString();
  return {
    id,
    name: String(raw?.name || id).trim().slice(0, 120) || id,
    description: String(raw?.description || '').trim().slice(0, 500),
    published: raw?.published !== false,
    basemap,
    layerStack: normalizeLayerStack(raw?.layerStack || raw?.layers),
    grid3Fallback: raw?.grid3Fallback !== false,
    extent: normalizeExtent(raw?.extent),
    choroplethTheme: theme,
    createdAt: raw?.createdAt || now,
    updatedAt: raw?.updatedAt || now,
  };
}

function publicMapPayload(map) {
  if (!map || !map.published) return null;
  return {
    id: map.id,
    name: map.name,
    description: map.description,
    basemap: map.basemap,
    layerStack: map.layerStack,
    layers: layersObjectFromStack(map.layerStack),
    grid3Fallback: map.grid3Fallback !== false,
    extent: map.extent,
    choroplethTheme: map.choroplethTheme,
    updatedAt: map.updatedAt,
  };
}

async function readStore() {
  try {
    const contents = await fs.readFile(MAP_CONFIGS_PATH, 'utf8');
    const parsed = JSON.parse(contents);
    const store = emptyStore();
    store.version = Number(parsed.version) || 1;
    if (parsed.assignments && typeof parsed.assignments === 'object') {
      VIEW_KEYS.forEach((key) => {
        const id = String(parsed.assignments[key] || '').trim().toLowerCase();
        store.assignments[key] = isValidId(id) ? id : store.assignments[key];
      });
    }
    const mapsIn = parsed.maps && typeof parsed.maps === 'object' ? parsed.maps : {};
    Object.keys(mapsIn).forEach((key) => {
      try {
        const map = normalizeMap(mapsIn[key], key);
        store.maps[map.id] = map;
      } catch {
        /* skip invalid entries */
      }
    });
    if (!Object.keys(store.maps).length) {
      store.maps = defaultMaps();
    }
    return store;
  } catch (error) {
    if (error.code === 'ENOENT') {
      const store = emptyStore();
      store.maps = defaultMaps();
      await writeStore(store);
      return store;
    }
    throw error;
  }
}

async function writeStore(store) {
  await fs.mkdir(path.dirname(MAP_CONFIGS_PATH), { recursive: true });
  const payload = {
    version: store.version || 1,
    idFormat: '^[a-z][a-z0-9-]{1,62}$',
    dashboardWidgetHint: { type: 'map', config: { mapId: '<map-config-id>' } },
    assignments: store.assignments,
    maps: store.maps,
  };
  await fs.writeFile(MAP_CONFIGS_PATH, JSON.stringify(payload, null, 2));
}

async function listMaps() {
  const store = await readStore();
  const maps = Object.values(store.maps).sort((a, b) => a.name.localeCompare(b.name));
  return { assignments: store.assignments, maps, basemapIds: BASEMAP_IDS, layerIds: LAYER_IDS, viewKeys: VIEW_KEYS, choroplethThemes: CHOROPLETH_THEMES };
}

async function getMap(id) {
  const store = await readStore();
  const map = store.maps[String(id || '').toLowerCase()];
  return map || null;
}

async function createMap(body) {
  const store = await readStore();
  const map = normalizeMap(body);
  if (store.maps[map.id]) {
    const err = new Error(`Map config "${map.id}" already exists.`);
    err.status = 409;
    throw err;
  }
  const now = new Date().toISOString();
  map.createdAt = now;
  map.updatedAt = now;
  store.maps[map.id] = map;
  await writeStore(store);
  return map;
}

async function updateMap(id, body) {
  const store = await readStore();
  const key = String(id || '').toLowerCase();
  const existing = store.maps[key];
  if (!existing) {
    const err = new Error('Map config not found.');
    err.status = 404;
    throw err;
  }
  const merged = normalizeMap({ ...existing, ...body, id: key }, key);
  merged.createdAt = existing.createdAt;
  merged.updatedAt = new Date().toISOString();
  store.maps[key] = merged;
  await writeStore(store);
  return merged;
}

async function deleteMap(id) {
  const store = await readStore();
  const key = String(id || '').toLowerCase();
  if (!store.maps[key]) {
    const err = new Error('Map config not found.');
    err.status = 404;
    throw err;
  }
  delete store.maps[key];
  VIEW_KEYS.forEach((view) => {
    if (store.assignments[view] === key) store.assignments[view] = null;
  });
  await writeStore(store);
  return { ok: true, id: key, assignments: store.assignments };
}

async function setAssignments(assignments) {
  const store = await readStore();
  const next = { ...store.assignments };
  VIEW_KEYS.forEach((view) => {
    if (!Object.prototype.hasOwnProperty.call(assignments || {}, view)) return;
    const raw = assignments[view];
    if (raw == null || raw === '') {
      next[view] = null;
      return;
    }
    const id = String(raw).trim().toLowerCase();
    if (!isValidId(id)) {
      const err = new Error(`Invalid assignment id for ${view}.`);
      err.status = 400;
      throw err;
    }
    if (!store.maps[id]) {
      const err = new Error(`Cannot assign unknown map "${id}" to ${view}.`);
      err.status = 400;
      throw err;
    }
    next[view] = id;
  });
  store.assignments = next;
  await writeStore(store);
  return store.assignments;
}

async function getPublishedMap(id) {
  const map = await getMap(id);
  return publicMapPayload(map);
}

async function getPublishedViews() {
  const store = await readStore();
  const views = {};
  VIEW_KEYS.forEach((view) => {
    const id = store.assignments[view];
    const map = id ? store.maps[id] : null;
    views[view] = publicMapPayload(map);
  });
  return { views, assignments: store.assignments };
}

module.exports = {
  MAP_CONFIGS_PATH,
  VIEW_KEYS,
  BASEMAP_IDS,
  LAYER_IDS,
  CHOROPLETH_THEMES,
  ID_PATTERN,
  isValidId,
  layersObjectFromStack,
  listMaps,
  getMap,
  createMap,
  updateMap,
  deleteMap,
  setAssignments,
  getPublishedMap,
  getPublishedViews,
  publicMapPayload,
};
