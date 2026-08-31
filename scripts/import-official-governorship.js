#!/usr/bin/env node
/**
 * Import official INEC LGA-collated governorship JSON into the active dataset tree + SQLite.
 *
 * Reads:  data/election-results/official/*.json
 * Writes: data/election-results/gubernatorial/{state-slug}-{year}.json
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const OFFICIAL_DIR = path.join(ROOT, 'data', 'election-results', 'official');
const OUT_DIR = path.join(ROOT, 'data', 'election-results', 'gubernatorial');

function slugify(state) {
  return String(state).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function loadOfficialFiles() {
  if (!fs.existsSync(OFFICIAL_DIR)) return [];
  return fs.readdirSync(OFFICIAL_DIR)
    .filter((file) => file.endsWith('.json'))
    .map((file) => {
      const fullPath = path.join(OFFICIAL_DIR, file);
      const payload = JSON.parse(fs.readFileSync(fullPath, 'utf8'));
      return { file, fullPath, payload };
    })
    .filter((row) => row.payload?.meta?.state && row.payload?.units);
}

function syncHistoryFromOfficial(entries) {
  const historyPath = path.join(ROOT, 'data', 'governorship-history.json');
  const history = fs.existsSync(historyPath)
    ? JSON.parse(fs.readFileSync(historyPath, 'utf8'))
    : {};

  for (const { payload } of entries) {
    const year = String(payload.meta.year);
    const state = payload.meta.state;
    if (!history[year]) history[year] = {};
    history[year][state] = {
      candidates: (payload.candidates || []).map((c) => ({
        name: c.name,
        party: c.party,
        votes: Number(c.votes || 0),
      })),
      source: payload.meta.sourceDetail || payload.meta.source,
      collated: true,
    };
  }

  fs.writeFileSync(historyPath, JSON.stringify(history, null, 2));
  return historyPath;
}

function main() {
  const entries = loadOfficialFiles();
  if (!entries.length) {
    console.error(`No official datasets found in ${OFFICIAL_DIR}`);
    console.error('Run: node scripts/generate-official-governorship.js');
    process.exit(1);
  }

  fs.mkdirSync(OUT_DIR, { recursive: true });

  let copied = 0;
  for (const { file, payload } of entries) {
    const state = payload.meta.state;
    const year = String(payload.meta.year);
    const dest = path.join(OUT_DIR, `${slugify(state)}-${year}.json`);
    fs.writeFileSync(dest, JSON.stringify(payload, null, 2));
    console.log(`Imported ${file} → ${path.relative(ROOT, dest)} (${Object.keys(payload.units).length} LGAs)`);
    copied += 1;
  }

  const historyPath = syncHistoryFromOfficial(entries);
  console.log(`Updated ${path.relative(ROOT, historyPath)}`);

  try {
    const { importElectionResultsFromDir, getDbStatus } = require('../db');
    const count = importElectionResultsFromDir(true);
    console.log(`SQLite reimport: ${count} election datasets`);
    console.log(getDbStatus());
  } catch (error) {
    console.warn('SQLite reimport skipped:', error.message);
  }
}

main();
