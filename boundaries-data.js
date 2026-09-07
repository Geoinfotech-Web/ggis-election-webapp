const fs = require('fs');
const path = require('path');
const JSZip = require('jszip');
const { getDb, normalizeKey } = require('./db');

const BOUNDARIES_DIR = process.env.BOUNDARIES_DIR
  ? path.resolve(process.env.BOUNDARIES_DIR)
  : path.join(__dirname, 'data', 'boundaries');

const VALID_LAYERS = new Set(['state', 'lga', 'ward']);

const STATE_CODE_ALIASES = {
  FC: 'FCT',
};

function canonicalStateName(name) {
  const trimmed = String(name || '').trim();
  if (!trimmed) return '';
  if (/^fct$/i.test(trimmed) || /^abuja$/i.test(trimmed)) return 'FCT';
  return trimmed.replace(/\b\w/g, (c) => c.toUpperCase()).replace(/\bFct\b/, 'FCT');
}

function computeBbox(geometry) {
  let minLat = 90;
  let maxLat = -90;
  let minLng = 180;
  let maxLng = -180;

  function walk(coords) {
    if (!coords || !coords.length) return;
    if (typeof coords[0] === 'number') {
      const lng = coords[0];
      const lat = coords[1];
      if (lat < minLat) minLat = lat;
      if (lat > maxLat) maxLat = lat;
      if (lng < minLng) minLng = lng;
      if (lng > maxLng) maxLng = lng;
      return;
    }
    coords.forEach(walk);
  }

  if (geometry && geometry.coordinates) walk(geometry.coordinates);
  if (minLat > maxLat) return null;
  return { min_lat: minLat, max_lat: maxLat, min_lng: minLng, max_lng: maxLng };
}

function detectLayer(featureCount, hint, filename) {
  const h = String(hint || '').toLowerCase();
  if (VALID_LAYERS.has(h)) return h;
  const name = String(filename || '').toLowerCase();
  if (/state/.test(name)) return 'state';
  if (/lga|local.?gov/.test(name)) return 'lga';
  if (/ward/.test(name)) return 'ward';
  if (featureCount <= 40) return 'state';
  if (featureCount <= 900) return 'lga';
  return 'ward';
}

async function parseUploadBuffer(buffer, originalName, companionFiles) {
  const shp = (await import('shpjs')).default;
  const lower = String(originalName || '').toLowerCase();

  if (lower.endsWith('.geojson') || (lower.endsWith('.json') && !lower.endsWith('.dbf'))) {
    const text = Buffer.isBuffer(buffer) ? buffer.toString('utf8') : String(buffer);
    const parsed = JSON.parse(text);
    if (parsed.type === 'Feature') return { type: 'FeatureCollection', features: [parsed] };
    if (parsed.type === 'FeatureCollection') return parsed;
    throw new Error('JSON must be a GeoJSON Feature or FeatureCollection.');
  }

  if (lower.endsWith('.zip')) {
    const archive = await JSZip.loadAsync(buffer, { checkCRC32: true });
    const entries = Object.values(archive.files);
    if (entries.length > 50) throw new Error('Boundary archive contains too many files.');
    const expandedBytes = entries.reduce((sum, entry) => sum + Number(entry._data?.uncompressedSize || 0), 0);
    if (expandedBytes > 200 * 1024 * 1024) throw new Error('Boundary archive expands beyond the 200 MB safety limit.');
    if (entries.some((entry) => /(^|[\\/])\.\.([\\/]|$)/.test(entry.name))) {
      throw new Error('Boundary archive contains an unsafe path.');
    }
    return shp(buffer);
  }

  if (companionFiles && companionFiles.shp && companionFiles.dbf) {
    return shp({
      shp: companionFiles.shp,
      dbf: companionFiles.dbf,
      shx: companionFiles.shx,
      prj: companionFiles.prj,
      cpg: companionFiles.cpg,
    });
  }

  throw new Error('Upload a .zip shapefile, .geojson, or a full .shp set (.shp + .dbf + .shx).');
}

function resolveStateFromCode(database, code) {
  if (!code) return '';
  const key = String(code).trim().toUpperCase();
  const aliased = STATE_CODE_ALIASES[key] || key;
  const row = database.prepare(`
    SELECT state FROM boundary_state_codes WHERE code = ?
  `).get(aliased);
  return row ? row.state : '';
}

function normalizeFeature(layer, feature, database) {
  const props = { ...(feature.properties || {}) };
  let state = pickProp(props, ['statename', 'state_name', 'state', 'STATE', 'State']);
  let lga = pickProp(props, ['lganame', 'lga_name', 'lga', 'LGA']);
  let ward = pickProp(props, ['wardname', 'ward_name', 'ward', 'WARD']);

  if (!state && props.state_code) {
    state = resolveStateFromCode(database, props.state_code);
  }

  state = canonicalStateName(state);
  lga = String(lga || '').trim();
  ward = String(ward || '').trim();

  if (layer === 'state') {
    state = canonicalStateName(state || pickProp(props, ['name', 'NAME']));
    lga = '';
    ward = '';
  } else if (layer === 'lga') {
    lga = lga || pickProp(props, ['name', 'NAME']);
    ward = '';
  } else if (layer === 'ward') {
    ward = ward || pickProp(props, ['name', 'NAME']);
  }

  const name = layer === 'state' ? state : layer === 'lga' ? lga : ward || state || 'Unknown';

  const mapProps = {
    ...props,
    statename: state,
    state,
    lganame: lga,
    lga,
    wardname: ward,
    ward,
  };

  return {
    name,
    state,
    lga,
    ward,
    state_norm: state ? normalizeKey(state) : '',
    lga_norm: lga ? normalizeKey(lga) : '',
    ward_norm: ward ? normalizeKey(ward) : '',
    props: mapProps,
    geometry: feature.geometry,
  };
}

function pickProp(props, keys) {
  for (const key of keys) {
    const value = props[key];
    if (value != null && String(value).trim()) return String(value).trim();
  }
  return '';
}

function saveUploadArchive(files, label) {
  fs.mkdirSync(path.join(BOUNDARIES_DIR, 'uploads'), { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const safeLabel = path.basename(String(label || 'boundary')).replace(/[^a-zA-Z0-9._-]+/g, '-').slice(0, 100);
  const dir = path.join(BOUNDARIES_DIR, 'uploads', `${stamp}-${safeLabel}`);
  fs.mkdirSync(dir, { recursive: true });
  for (const file of files) {
    const safeName = path.basename(String(file.originalname || 'upload.bin')).replace(/[^a-zA-Z0-9._-]+/g, '-');
    fs.writeFileSync(path.join(dir, safeName), file.buffer, { flag: 'wx' });
  }
  return dir;
}

function importGeoJson(layer, geojson, sourceFile) {
  if (!VALID_LAYERS.has(layer)) throw new Error('Invalid boundary layer.');
  const features = (geojson.features || []).filter((f) => f && f.geometry);
  if (!features.length) throw new Error('No features found in upload.');

  const database = getDb();
  const insertFeature = database.prepare(`
    INSERT INTO boundary_features (
      layer, name, state, lga, ward, state_norm, lga_norm, ward_norm,
      props_json, geom_json, min_lat, max_lat, min_lng, max_lng
    ) VALUES (
      @layer, @name, @state, @lga, @ward, @state_norm, @lga_norm, @ward_norm,
      @props_json, @geom_json, @min_lat, @max_lat, @min_lng, @max_lng
    )
  `);

  const tx = database.transaction((rows) => {
    database.prepare('DELETE FROM boundary_features WHERE layer = ?').run(layer);
    database.prepare(`
      INSERT INTO boundary_layers (layer, feature_count, source_file, uploaded_at)
      VALUES (?, ?, ?, datetime('now'))
      ON CONFLICT(layer) DO UPDATE SET
        feature_count = excluded.feature_count,
        source_file = excluded.source_file,
        uploaded_at = datetime('now')
    `).run(layer, rows.length, sourceFile || '');

    if (layer === 'state') {
      database.prepare('DELETE FROM boundary_state_codes').run();
      const insertCode = database.prepare(`
        INSERT INTO boundary_state_codes (code, state, state_norm)
        VALUES (?, ?, ?)
      `);
      for (const row of rows) {
        const code = String(row.props.state_code || row.props.STATE_CODE || '').trim().toUpperCase();
        if (code && row.state) insertCode.run(code, row.state, row.state_norm);
      }
    }

    for (const row of rows) {
      const bbox = computeBbox(row.geometry);
      insertFeature.run({
        layer,
        name: row.name,
        state: row.state || null,
        lga: row.lga || null,
        ward: row.ward || null,
        state_norm: row.state_norm || null,
        lga_norm: row.lga_norm || null,
        ward_norm: row.ward_norm || null,
        props_json: JSON.stringify(row.props),
        geom_json: JSON.stringify(row.geometry),
        min_lat: bbox ? bbox.min_lat : null,
        max_lat: bbox ? bbox.max_lat : null,
        min_lng: bbox ? bbox.min_lng : null,
        max_lng: bbox ? bbox.max_lng : null,
      });
    }
  });

  const normalized = features.map((feature) => normalizeFeature(layer, feature, database));
  tx(normalized);
  return { layer, featureCount: normalized.length, sourceFile: sourceFile || '' };
}

async function importUploadFiles(files, layerHint) {
  if (!files || !files.length) throw new Error('No files uploaded.');

  const byBase = new Map();
  for (const file of files) {
    const ext = path.extname(file.originalname).toLowerCase();
    const base = path.basename(file.originalname, ext).toLowerCase();
    if (!byBase.has(base)) byBase.set(base, {});
    const entry = byBase.get(base);
    if (ext === '.shp') entry.shp = file.buffer;
    else if (ext === '.dbf') entry.dbf = file.buffer;
    else if (ext === '.shx') entry.shx = file.buffer;
    else if (ext === '.prj') entry.prj = file.buffer;
    else if (ext === '.cpg') entry.cpg = file.buffer;
    else if (ext === '.zip' || ext === '.geojson' || ext === '.json') entry.single = file;
  }

  let geojson;
  let sourceLabel;
  const zipOrJson = files.find((f) => /\.(zip|geojson|json)$/i.test(f.originalname));
  if (zipOrJson) {
    geojson = await parseUploadBuffer(zipOrJson.buffer, zipOrJson.originalname);
    sourceLabel = zipOrJson.originalname;
    saveUploadArchive([zipOrJson], path.basename(sourceLabel, path.extname(sourceLabel)));
  } else {
    const bundle = [...byBase.values()].find((b) => b.shp && b.dbf) || null;
    if (!bundle) throw new Error('Provide a .zip shapefile or a complete .shp + .dbf (+ .shx) set.');
    geojson = await parseUploadBuffer(bundle.shp, 'upload.shp', bundle);
    sourceLabel = files.map((f) => f.originalname).join(', ');
    saveUploadArchive(files, 'shapefile-set');
  }

  if (Array.isArray(geojson)) geojson = geojson[0];
  const layer = detectLayer((geojson.features || []).length, layerHint, sourceLabel);
  return importGeoJson(layer, geojson, sourceLabel);
}

function listBoundaryLayers() {
  const database = getDb();
  return database.prepare(`
    SELECT layer, feature_count, source_file, uploaded_at
    FROM boundary_layers
    ORDER BY layer
  `).all();
}

function hasBoundaryLayer(layer) {
  const database = getDb();
  const row = database.prepare('SELECT feature_count FROM boundary_layers WHERE layer = ?').get(layer);
  return !!(row && row.feature_count > 0);
}

function queryBoundariesGeoJson({ layer, bbox, state, lga, ward, limit = 1500 }) {
  if (!VALID_LAYERS.has(layer)) return { type: 'FeatureCollection', features: [] };
  if (!hasBoundaryLayer(layer)) return { type: 'FeatureCollection', features: [] };

  const database = getDb();
  const clauses = ['layer = ?'];
  const params = [layer];

  if (bbox) {
    const [west, south, east, north] = bbox.split(',').map(Number);
    if ([west, south, east, north].every(Number.isFinite)) {
      clauses.push('max_lat >= ? AND min_lat <= ? AND max_lng >= ? AND min_lng <= ?');
      params.push(south, north, west, east);
    }
  }

  if (state) {
    clauses.push('state_norm = ?');
    params.push(normalizeKey(state));
  }
  if (lga) {
    clauses.push('lga_norm = ?');
    params.push(normalizeKey(lga));
  }
  if (ward) {
    clauses.push('ward_norm = ?');
    params.push(normalizeKey(ward));
  }

  const rows = database.prepare(`
    SELECT props_json, geom_json
    FROM boundary_features
    WHERE ${clauses.join(' AND ')}
    ORDER BY name COLLATE NOCASE
    LIMIT ?
  `).all(...params, Math.min(Number(limit) || 1500, 5000));

  return {
    type: 'FeatureCollection',
    source: 'local',
    features: rows.map((row) => ({
      type: 'Feature',
      properties: JSON.parse(row.props_json || '{}'),
      geometry: JSON.parse(row.geom_json),
    })),
  };
}

function deleteBoundaryLayer(layer) {
  if (!VALID_LAYERS.has(layer)) throw new Error('Invalid boundary layer.');
  const database = getDb();
  database.prepare('DELETE FROM boundary_features WHERE layer = ?').run(layer);
  database.prepare('DELETE FROM boundary_layers WHERE layer = ?').run(layer);
  if (layer === 'state') database.prepare('DELETE FROM boundary_state_codes').run();
  return { layer, deleted: true };
}

module.exports = {
  BOUNDARIES_DIR,
  importUploadFiles,
  importGeoJson,
  listBoundaryLayers,
  hasBoundaryLayer,
  queryBoundariesGeoJson,
  deleteBoundaryLayer,
  parseUploadBuffer,
  detectLayer,
};
