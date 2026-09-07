#!/usr/bin/env node
/**
 * Build governorship JSON for all 36 states × 4 years from sourced statewide totals.
 * LGA splits use PVC/population weights unless meta.collated (official LGA data).
 */
const fs = require('fs');
const path = require('path');
const { getStatewideElection, YEARS } = require('./data/governorship-statewide-index');
const { distributeLgaByPvc } = require('./lib/distribute-lga-by-pvc');
const { INEC_URL } = require('./data/governorship-statewide-meta');

const ROOT = path.join(__dirname, '..');
const POP_PATH = path.join(ROOT, 'data', 'reference', 'population-pvc-data.json');
const OUT_DIR = path.join(ROOT, 'data', 'election-results', 'gubernatorial');
const HISTORY_PATH = path.join(ROOT, 'data', 'governorship-history.json');
const EKITI_2026_PATH = path.join(ROOT, 'data', 'election-results', 'gubernatorial-ekiti-2026-lga.json');

function slugify(state) {
  return String(state).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function normalizeParty(party) {
  const p = String(party || '').trim().toUpperCase();
  if (p === 'ACCORD') return 'Accord';
  if (p === 'APGA') return 'APGA';
  return p;
}

function buildPayload(state, year, election, lgaNames, lgaPopulation) {
  const candidates = election.candidates.map((c) => ({
    name: c.name,
    party: normalizeParty(c.party),
    votes: Number(c.votes),
  }));

  const winner = candidates.reduce((top, c) =>
    (Number(c.votes) > Number(top.votes) ? c : top), candidates[0]);

  return {
    meta: {
      office: 'gov',
      year: String(year),
      state,
      level: 'lga',
      title: `${state} State Governorship Election ${year}`,
      source: 'INEC declared results',
      sourceUrl: election.sourceUrl || INEC_URL,
      sourceDetail: election.source,
      attribution: 'Independent National Electoral Commission (INEC)',
      electionDate: election.electionDate,
      updated: election.electionDate,
      sourced: true,
      lgaMethod: 'pvc-proportional',
    },
    winner,
    candidates,
    units: distributeLgaByPvc(state, candidates, lgaNames, lgaPopulation),
  };
}

function loadLgaIndex(lgaPopulation) {
  const { ensurePollingUnitsSeeded, listLgasByState } = require('../db');
  ensurePollingUnitsSeeded(() => ({}));
  const pop = JSON.parse(fs.readFileSync(POP_PATH, 'utf8'));
  const index = new Map();

  if (fs.existsSync(EKITI_2026_PATH)) {
    const ekiti = JSON.parse(fs.readFileSync(EKITI_2026_PATH, 'utf8'));
    index.set('Ekiti', Object.keys(ekiti.units || {}));
  }

  const states = (pop.governors || [])
    .map((g) => g.state)
    .filter((s) => s && s !== 'FCT' && !/total/i.test(s));

  for (const state of states) {
    if (index.has(state)) continue;
    const lgas = listLgasByState(state);
    if (lgas.length) index.set(state, lgas);
  }

  return { index, lgaPopulation: lgaPopulation || pop.lgaPopulation || [] };
}

function syncHistory() {
  const existing = fs.existsSync(HISTORY_PATH)
    ? JSON.parse(fs.readFileSync(HISTORY_PATH, 'utf8'))
    : {};

  const history = {};
  const pop = JSON.parse(fs.readFileSync(POP_PATH, 'utf8'));
  const states = (pop.governors || [])
    .map((g) => g.state)
    .filter((s) => s && s !== 'FCT' && !/total/i.test(s));

  for (const year of YEARS) {
    history[year] = {};
    for (const state of states) {
      if (existing[year]?.[state]?.collated) {
        history[year][state] = existing[year][state];
        continue;
      }

      const election = getStatewideElection(state, year);
      if (!election) continue;

      history[year][state] = {
        candidates: election.candidates.map((c) => ({
          name: c.name,
          party: normalizeParty(c.party),
          votes: Number(c.votes),
        })),
        source: election.source,
        sourceUrl: election.sourceUrl,
        electionDate: election.electionDate,
        sourced: true,
      };
    }
  }

  fs.writeFileSync(HISTORY_PATH, JSON.stringify(history, null, 2));
}

function main() {
  const pop = JSON.parse(fs.readFileSync(POP_PATH, 'utf8'));
  const governors = (pop.governors || []).filter((g) => g.state && g.state !== 'FCT' && !/total/i.test(g.state));
  const { index: lgaIndex, lgaPopulation } = loadLgaIndex(pop.lgaPopulation);

  fs.mkdirSync(OUT_DIR, { recursive: true });

  let written = 0;
  let skippedCollated = 0;
  let missing = 0;

  for (const gov of governors) {
    const state = gov.state;
    const lgaNames = lgaIndex.get(state) || [];
    if (!lgaNames.length) {
      console.warn(`No LGAs for ${state}; skipping`);
      continue;
    }

    for (const year of YEARS) {
      if (state === 'Ekiti' && year === '2026') continue;

      const destFile = path.join(OUT_DIR, `${slugify(state)}-${year}.json`);
      if (fs.existsSync(destFile)) {
        try {
          const existing = JSON.parse(fs.readFileSync(destFile, 'utf8'));
          if (existing.meta?.collated) {
            skippedCollated += 1;
            continue;
          }
        } catch (e) {
          /* regenerate */
        }
      }

      const election = getStatewideElection(state, year);
      if (!election) {
        console.warn(`No sourced election for ${state} ${year}`);
        missing += 1;
        continue;
      }

      const payload = buildPayload(state, year, election, lgaNames, lgaPopulation);
      fs.writeFileSync(destFile, JSON.stringify(payload, null, 2));
      written += 1;
    }
  }

  syncHistory();

  console.log(`Built ${written} sourced governorship files (${skippedCollated} collated preserved)`);
  if (missing) console.warn(`${missing} state/year pairs missing from statewide index`);

  try {
    const { importElectionResultsFromDir, getDbStatus } = require('../db');
    const count = importElectionResultsFromDir(true);
    console.log(`Imported ${count} election datasets into SQLite`);
    console.log(getDbStatus());
  } catch (e) {
    console.warn('SQLite import skipped:', e.message);
  }
}

main();
