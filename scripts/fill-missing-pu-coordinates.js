#!/usr/bin/env node
/**
 * Fill blank lat/long in Nigeria_polling_units.csv using GRID3 / ArcGIS ward
 * polygon centroids (plus a tiny deterministic jitter so stacked units separate).
 *
 * DISABLED BY DEFAULT for the live map: ward centroids are misleading as
 * polling-unit locations. Prefer INEC locator coordinates only
 * (`npm run pu:coords:refresh`). Run this script only for offline analysis.
 *
 * Does not overwrite existing INEC/source coordinates.
 *
 * Writes:
 *   data/reference/Nigeria_polling_units.csv (updated)
 *   data/reference/pu-ward-centroid-fill-report.json
 */
const fs = require('fs');
const path = require('path');
const Papa = require('papaparse');

const ROOT = path.join(__dirname, '..');
const CSV_PATH = path.join(ROOT, 'data', 'reference', 'Nigeria_polling_units.csv');
const REPORT_PATH = path.join(ROOT, 'data', 'reference', 'pu-ward-centroid-fill-report.json');
const WARD_SERVICE =
  'https://services3.arcgis.com/BU6Aadhn6tbBEdyk/arcgis/rest/services/NGA_Ward_Boundaries/FeatureServer/0/query';

const NG_BBOX = { minLat: 3.8, maxLat: 14.2, minLng: 2.4, maxLng: 15.0 };

function normalizeKey(value) {
  return String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/gi, ' ')
    .trim()
    .toLowerCase();
}

function canonicalState(name) {
  const key = normalizeKey(name).replace(/\s+/g, '');
  if (!key) return '';
  if (key === 'fct' || key === 'abuja' || key === 'fctabuja' || key === 'federalcapitalterritory') {
    return 'fct';
  }
  return normalizeKey(name);
}

function aliasKeys(name) {
  const key = normalizeKey(name);
  if (!key) return [];
  const compact = key.replace(/\s+/g, '');
  const groups = [
    ['municipal', 'municipal area council', 'abuja municipal', 'amac'],
    ['fct', 'abuja', 'federal capital territory', 'fct abuja'],
  ];
  for (const group of groups) {
    if (group.some((g) => g === key || g.replace(/\s+/g, '') === compact)) return group.slice();
  }
  return [key];
}

function stripTrailingCode(name) {
  return normalizeKey(name)
    .replace(/\b(?:\d+|i|ii|iii|iv|v|a|b|c)\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function namesMatch(a, b) {
  const left = normalizeKey(a);
  const right = normalizeKey(b);
  if (!left || !right) return false;
  if (left === right) return true;
  const la = aliasKeys(left);
  const ra = aliasKeys(right);
  if (la.some((x) => ra.includes(x))) return true;
  const lb = stripTrailingCode(left);
  const rb = stripTrailingCode(right);
  if (lb && rb && lb === rb) return true;
  const lt = left.split(/\s+/).filter(Boolean);
  const rt = right.split(/\s+/).filter(Boolean);
  if (lt.length === 1 && rt.includes(left)) return true;
  if (rt.length === 1 && lt.includes(right)) return true;
  return false;
}

function hasCoords(row) {
  const lat = Number(row.lat);
  const lng = Number(row.long);
  return (
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    String(row.lat || '').trim() !== '' &&
    String(row.long || '').trim() !== ''
  );
}

function inNigeria(lat, lng) {
  return (
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    lat >= NG_BBOX.minLat &&
    lat <= NG_BBOX.maxLat &&
    lng >= NG_BBOX.minLng &&
    lng <= NG_BBOX.maxLng &&
    !(lat === 0 && lng === 0)
  );
}

function centroidOfGeometry(geometry) {
  if (!geometry) return null;
  let minLat = 90;
  let maxLat = -90;
  let minLng = 180;
  let maxLng = -180;
  let n = 0;
  function walk(coords) {
    if (!coords || !coords.length) return;
    if (typeof coords[0] === 'number') {
      const lng = coords[0];
      const lat = coords[1];
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
      minLat = Math.min(minLat, lat);
      maxLat = Math.max(maxLat, lat);
      minLng = Math.min(minLng, lng);
      maxLng = Math.max(maxLng, lng);
      n += 1;
      return;
    }
    coords.forEach(walk);
  }
  if (geometry.type === 'Polygon' || geometry.type === 'MultiPolygon') {
    walk(geometry.coordinates);
  } else if (geometry.rings) {
    walk(geometry.rings);
  } else if (geometry.coordinates) {
    walk(geometry.coordinates);
  }
  if (!n || minLat > maxLat) return null;
  return { lat: (minLat + maxLat) / 2, lng: (minLng + maxLng) / 2 };
}

function hashCode(str) {
  let h = 2166136261;
  const s = String(str || '');
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function jitter(lat, lng, code) {
  const h = hashCode(code);
  const dLat = ((h % 97) - 48) * 0.000045; // ~5 m steps, ±~2.2 km max
  const dLng = ((((h / 97) | 0) % 97) - 48) * 0.000045;
  return { lat: lat + dLat, lng: lng + dLng };
}

async function fetchJson(url) {
  const res = await fetch(url, {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(120000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.json();
}

async function fetchWardsForState(stateName) {
  const features = [];
  let offset = 0;
  const pageSize = 1000;
  const where = `UPPER(statename)='${String(stateName || '').replace(/'/g, "''").toUpperCase()}'`;
  for (;;) {
    const params = new URLSearchParams({
      f: 'geojson',
      where,
      outFields: 'statename,lganame,wardname',
      returnGeometry: 'true',
      outSR: '4326',
      resultRecordCount: String(pageSize),
      resultOffset: String(offset),
    });
    const url = `${WARD_SERVICE}?${params.toString()}`;
    const data = await fetchJson(url);
    const batch = data.features || [];
    features.push(...batch);
    if (batch.length < pageSize) break;
    offset += pageSize;
  }
  return features;
}

async function fetchAllWards(states) {
  const features = [];
  const list = [...states].filter(Boolean).sort();
  for (const state of list) {
    process.stdout.write(`Fetching wards for ${state}… `);
    try {
      const batch = await fetchWardsForState(state);
      console.log(`+${batch.length}`);
      features.push(...batch);
    } catch (err) {
      console.log(`ERR ${err.message || err}`);
    }
  }
  return features;
}

function indexWardCentroids(features) {
  const byState = new Map();
  let accepted = 0;
  let rejected = 0;
  for (const feat of features) {
    const props = feat.properties || {};
    const state = canonicalState(props.statename || props.state);
    const lga = normalizeKey(props.lganame || props.lga);
    const ward = normalizeKey(props.wardname || props.ward);
    const c = centroidOfGeometry(feat.geometry);
    if (!state || !lga || !ward || !c || !inNigeria(c.lat, c.lng)) {
      rejected += 1;
      continue;
    }
    if (!byState.has(state)) byState.set(state, []);
    byState.get(state).push({ state, lga, ward, lat: c.lat, lng: c.lng });
    accepted += 1;
  }
  return { byState, accepted, rejected };
}

function lookupCentroid(index, state, lga, ward) {
  const st = canonicalState(state);
  const rows = index.byState.get(st) || [];
  if (!rows.length) return null;
  const wardHits = rows.filter((r) => namesMatch(r.ward, ward));
  const lgaAndWard = wardHits.filter((r) => namesMatch(r.lga, lga));
  if (lgaAndWard.length) return lgaAndWard[0];
  if (wardHits.length) return wardHits[0];
  const lgaHits = rows.filter((r) => namesMatch(r.lga, lga));
  if (lgaHits.length) return lgaHits[0];
  return null;
}

async function main() {
  if (!fs.existsSync(CSV_PATH)) {
    console.error('Missing CSV:', CSV_PATH);
    process.exit(1);
  }

  const parsed = Papa.parse(fs.readFileSync(CSV_PATH, 'utf8'), {
    header: true,
    skipEmptyLines: true,
  });

  // ArcGIS stores FCT as "Fct" / UPPER FCT; use CSV states + aliases.
  const stateSet = new Set();
  for (const row of parsed.data) {
    const st = String(row.state || '').trim();
    if (!st) continue;
    if (/fct|abuja/i.test(st)) stateSet.add('FCT');
    else stateSet.add(st.toUpperCase());
  }
  // Ensure ArcGIS-known spellings for states that use different CSV names.
  stateSet.add('FCT');

  const features = await fetchAllWards(stateSet);
  const index = indexWardCentroids(features);
  console.log(`Ward centroids accepted=${index.accepted} rejected=${index.rejected}`);

  const report = {
    filledAt: new Date().toISOString(),
    method: 'grid3-ward-centroid+jitter',
    source: WARD_SERVICE,
    wardFeatures: features.length,
    wardCentroidsAccepted: index.accepted,
    csvRows: parsed.data.length,
    alreadyHadCoords: 0,
    filled: 0,
    unmatched: 0,
    byStateFilled: {},
  };

  const rows = parsed.data.map((row) => {
    if (hasCoords(row)) {
      report.alreadyHadCoords += 1;
      return row;
    }
    const hit = lookupCentroid(index, row.state, row.lga, row.ward);
    if (!hit) {
      report.unmatched += 1;
      return row;
    }
    const point = jitter(hit.lat, hit.lng, row.code || `${row.state}|${row.lga}|${row.ward}|${row.name}`);
    report.filled += 1;
    const st = canonicalState(row.state) || normalizeKey(row.state) || 'unknown';
    report.byStateFilled[st] = (report.byStateFilled[st] || 0) + 1;
    return {
      ...row,
      lat: String(point.lat),
      long: String(point.lng),
    };
  });

    report.withCoordinatesAfter = rows.filter((r) => hasCoords(r)).length;
  report.withoutCoordinatesAfter = rows.length - report.withCoordinatesAfter;
  // Preserve cumulative estimate count across re-runs (alreadyHad includes prior fills).
  let inecBaseline = 117699;
  try {
    const meta = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'reference', 'inec-pu-coordinates.meta.json'), 'utf8'));
    if (Number(meta.withCoordinatesAfterMerge) > 0) inecBaseline = Number(meta.withCoordinatesAfterMerge);
  } catch (_) {}
  report.inecBaseline = inecBaseline;
  report.estimatedFilled = Math.max(0, report.withCoordinatesAfter - inecBaseline);
  report.filled = report.estimatedFilled;

  const backupPath = CSV_PATH.replace(/\.csv$/i, '.pre-centroid-fill-backup.csv');
  if (!fs.existsSync(backupPath)) {
    fs.copyFileSync(CSV_PATH, backupPath);
    report.backup = path.relative(ROOT, backupPath);
  }

  const outCsv = Papa.unparse(rows, {
    columns: parsed.meta.fields,
    quotes: false,
  });
  fs.writeFileSync(CSV_PATH, outCsv.endsWith('\n') ? outCsv : `${outCsv}\n`);
  fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  console.log(`Updated ${path.relative(ROOT, CSV_PATH)}`);
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

module.exports = { main };
