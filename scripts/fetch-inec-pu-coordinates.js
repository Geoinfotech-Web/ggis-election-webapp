#!/usr/bin/env node
/**
 * Fetch INEC polling-unit coordinates from the attributed civic archive
 * (mykeels/inec-polling-units — retrieved from INEC public polling-unit pages)
 * and normalize to { code, latitude, longitude }.
 *
 * Writes:
 *   data/reference/inec-pu-coordinates.json
 *   data/reference/inec-pu-coordinates.meta.json
 */
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const REF = path.join(ROOT, 'data', 'reference');
const WORK = path.join(REF, '_inec-pu-coords-work');
const OUT_JSON = path.join(REF, 'inec-pu-coordinates.json');
const OUT_META = path.join(REF, 'inec-pu-coordinates.meta.json');
const SOURCE_URL = 'https://github.com/mykeels/inec-polling-units';
const SOURCE_DETAIL =
  'INEC polling-unit delimitation register archive (mykeels/inec-polling-units), retrieved from https://www.inecnigeria.org/elections/polling-units/';

const NG_BBOX = { minLat: 3.8, maxLat: 14.2, minLng: 2.4, maxLng: 15.0 };

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function canonicalPuCode(value) {
  return String(value || '')
    .trim()
    .replace(/\\/g, '/')
    .split('/')
    .map((part) => {
      const t = part.trim();
      if (!/^\d+$/.test(t)) return t.toLowerCase();
      // Keep delimitation style: state/lga/ward often 2 digits, pu often 3.
      const n = String(Number(t));
      if (t.length >= 3) return n.padStart(3, '0');
      return n.padStart(2, '0');
    })
    .filter(Boolean)
    .join('/');
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

function walkUnits(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walkUnits(full, out);
      continue;
    }
    if (entry.name === 'index.json' && /[/\\]units[/\\]index\.json$/i.test(full.replace(/\\/g, '/'))) {
      out.push(full);
    }
  }
  return out;
}

function cloneArchive() {
  ensureDir(REF);
  if (fs.existsSync(WORK)) {
    fs.rmSync(WORK, { recursive: true, force: true });
  }
  console.log('Cloning INEC PU archive (sparse, depth 1)…');
  execSync(
    `git clone --depth 1 --filter=blob:none --sparse "${SOURCE_URL}.git" "${WORK}"`,
    { stdio: 'inherit' }
  );
  execSync('git sparse-checkout set states', { cwd: WORK, stdio: 'inherit' });
}

function extractCoordinates() {
  const statesDir = path.join(WORK, 'states');
  const files = walkUnits(statesDir);
  console.log(`Found ${files.length} ward unit files`);

  const byCode = new Map();
  let scanned = 0;
  let withLocation = 0;
  let inBbox = 0;
  let outOfBbox = 0;
  let missingCode = 0;
  let missingCoords = 0;

  for (const file of files) {
    let rows;
    try {
      rows = JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch {
      continue;
    }
    if (!Array.isArray(rows)) continue;
    for (const unit of rows) {
      scanned += 1;
      const codeRaw = unit.delimitation || unit.code || '';
      const code = canonicalPuCode(codeRaw);
      if (!code) {
        missingCode += 1;
        continue;
      }
      const loc = unit.location || {};
      const lat = Number(loc.latitude ?? loc.lat);
      const lng = Number(loc.longitude ?? loc.lng ?? loc.lon);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
        missingCoords += 1;
        continue;
      }
      withLocation += 1;
      if (!inNigeria(lat, lng)) {
        outOfBbox += 1;
        continue;
      }
      inBbox += 1;
      byCode.set(code, {
        code,
        delimitation: String(codeRaw).trim(),
        latitude: lat,
        longitude: lng,
        name: unit.name || null,
        state: unit.state_name || null,
        lga: unit.local_government_name || null,
        ward: unit.ward_name || null,
        source: SOURCE_URL,
      });
    }
  }

  const records = [...byCode.values()].sort((a, b) => a.code.localeCompare(b.code));
  const meta = {
    fetchedAt: new Date().toISOString(),
    sourceUrl: SOURCE_URL,
    sourceDetail: SOURCE_DETAIL,
    attribution: 'Independent National Electoral Commission (INEC) via public polling-unit pages / civic archive',
    wardUnitFiles: files.length,
    unitsScanned: scanned,
    withLocationField: withLocation,
    acceptedInNigeriaBbox: inBbox,
    uniqueCodesWithCoordinates: records.length,
    droppedOutOfBbox: outOfBbox,
    missingCode,
    missingCoords,
    note:
      'Only finite coordinates inside an approximate Nigeria bounding box are kept. Units without published coordinates remain unavailable.',
  };

  fs.writeFileSync(OUT_JSON, JSON.stringify(records));
  fs.writeFileSync(OUT_META, JSON.stringify(meta, null, 2));
  console.log(JSON.stringify(meta, null, 2));
  console.log(`Wrote ${records.length} coordinate rows → ${path.relative(ROOT, OUT_JSON)}`);
  return meta;
}

function cleanup() {
  if (fs.existsSync(WORK)) {
    try {
      fs.rmSync(WORK, { recursive: true, force: true });
    } catch (err) {
      console.warn('Could not remove work tree:', err.message || err);
    }
  }
}

function main() {
  cloneArchive();
  try {
    extractCoordinates();
  } finally {
    cleanup();
  }
}

if (require.main === module) {
  main();
}

module.exports = { canonicalPuCode, inNigeria, NG_BBOX };
