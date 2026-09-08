#!/usr/bin/env node
/**
 * Merge INEC-sourced coordinates into data/reference/Nigeria_polling_units.csv
 * by polling-unit delimitation code. Never invents coordinates; only fills blank
 * lat/long when the INEC archive provides a finite Nigeria-bbox pair.
 *
 * Usage:
 *   node scripts/merge-inec-pu-coordinates.js
 *   node scripts/merge-inec-pu-coordinates.js --force   # overwrite existing lat/long
 */
const fs = require('fs');
const path = require('path');
const Papa = require('papaparse');
const { canonicalPuCode } = require('./fetch-inec-pu-coordinates');

const ROOT = path.join(__dirname, '..');
const CSV_PATH = path.join(ROOT, 'data', 'reference', 'Nigeria_polling_units.csv');
const COORDS_PATH = path.join(ROOT, 'data', 'reference', 'inec-pu-coordinates.json');
const META_PATH = path.join(ROOT, 'data', 'reference', 'inec-pu-coordinates.meta.json');
const REPORT_PATH = path.join(ROOT, 'data', 'reference', 'inec-pu-coordinates-merge-report.json');

function hasCoords(row) {
  const lat = Number(row.lat);
  const lng = Number(row.long);
  return Number.isFinite(lat) && Number.isFinite(lng) && String(row.lat).trim() !== '' && String(row.long).trim() !== '';
}

function main() {
  const force = process.argv.includes('--force');
  if (!fs.existsSync(COORDS_PATH)) {
    console.error('Missing coordinate feed. Run: node scripts/fetch-inec-pu-coordinates.js');
    process.exit(1);
  }

  const coords = JSON.parse(fs.readFileSync(COORDS_PATH, 'utf8'));
  const byCode = new Map();
  for (const row of coords) {
    const key = canonicalPuCode(row.code || row.delimitation);
    if (key) byCode.set(key, row);
  }

  const csvText = fs.readFileSync(CSV_PATH, 'utf8');
  const parsed = Papa.parse(csvText, { header: true, skipEmptyLines: true });
  if (parsed.errors?.length) {
    console.warn('CSV parse warnings:', parsed.errors.slice(0, 3));
  }

  const report = {
    mergedAt: new Date().toISOString(),
    force,
    csvRows: parsed.data.length,
    coordFeedRows: coords.length,
    matched: 0,
    filled: 0,
    alreadyHadCoords: 0,
    overwritten: 0,
    unmatchedCsv: 0,
    unmatchedFeed: 0,
  };

  const usedFeed = new Set();
  const rows = parsed.data.map((row) => {
    const key = canonicalPuCode(row.code);
    const hit = key ? byCode.get(key) : null;
    if (!hit) {
      report.unmatchedCsv += 1;
      return row;
    }
    report.matched += 1;
    usedFeed.add(key);
    const existing = hasCoords(row);
    if (existing && !force) {
      report.alreadyHadCoords += 1;
      return row;
    }
    if (existing && force) report.overwritten += 1;
    else report.filled += 1;
    return {
      ...row,
      lat: String(hit.latitude),
      long: String(hit.longitude),
    };
  });

  report.unmatchedFeed = [...byCode.keys()].filter((k) => !usedFeed.has(k)).length;
  report.withCoordinatesAfter = rows.filter((row) => hasCoords(row)).length;
  report.withoutCoordinatesAfter = rows.length - report.withCoordinatesAfter;

  const outCsv = Papa.unparse(rows, {
    columns: parsed.meta.fields,
    quotes: false,
  });
  // Keep a backup of the previous CSV once.
  const backupPath = CSV_PATH.replace(/\.csv$/i, '.pre-coords-backup.csv');
  if (!fs.existsSync(backupPath)) {
    fs.copyFileSync(CSV_PATH, backupPath);
    report.backup = path.relative(ROOT, backupPath);
  }
  fs.writeFileSync(CSV_PATH, outCsv.endsWith('\n') ? outCsv : outCsv + '\n');
  fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2));

  if (fs.existsSync(META_PATH)) {
    const meta = JSON.parse(fs.readFileSync(META_PATH, 'utf8'));
    meta.lastMergedAt = report.mergedAt;
    meta.mergeReport = path.relative(ROOT, REPORT_PATH);
    meta.withCoordinatesAfterMerge = report.withCoordinatesAfter;
    fs.writeFileSync(META_PATH, JSON.stringify(meta, null, 2));
  }

  console.log(JSON.stringify(report, null, 2));
  console.log(`Updated ${path.relative(ROOT, CSV_PATH)}`);
}

if (require.main === module) {
  main();
}

module.exports = { main };
