const fs = require('fs/promises');
const path = require('path');
const Papa = require('papaparse');
const { normalizeLookupKey } = require('./polling-data');
const { loadLatestSnapshot } = require('./inec-ingest');

const LOCAL_POLLING_UNIT_DATA_PATH = path.join(__dirname, 'data', 'reference', 'Nigeria_polling_units.csv');

/** National presidential turnout rates used for ballot estimates (INEC-declared cycles). */
const TURNOUT_BY_YEAR = {
  '2023': { rate: 0.271, label: '2023 national turnout 27.1%' },
  '2019': { rate: 0.348, label: '2019 national turnout 34.8%' },
  '2015': { rate: 0.437, label: '2015 national turnout 43.7%' },
};
const TURNOUT_2023 = TURNOUT_BY_YEAR['2023'].rate;

function turnoutForYear(year) {
  const key = String(year || '2023');
  return TURNOUT_BY_YEAR[key] || TURNOUT_BY_YEAR['2023'];
}

function pickRow(rows, name, field) {
  if (!name || !rows?.length) return null;
  const key = normalizeLookupKey(name);
  return rows.find((row) => normalizeLookupKey(row[field]) === key) || null;
}

function roundInt(value) {
  return Math.round(Number(value) || 0);
}

function ratePct(collected, registered) {
  if (!registered) return 0;
  return Math.round((collected / registered) * 1000) / 10;
}

let puIndexPromise = null;

async function loadPuIndex() {
  if (puIndexPromise) return puIndexPromise;
  puIndexPromise = (async () => {
    const csvText = await fs.readFile(LOCAL_POLLING_UNIT_DATA_PATH, 'utf8');
    const parsed = Papa.parse(csvText, {
      header: true,
      skipEmptyLines: true,
      transformHeader: (column) => String(column || '').trim(),
    });
    const byStateLga = new Map();
    for (const row of parsed.data || []) {
      const state = normalizeLookupKey(row.state);
      const lga = normalizeLookupKey(row.lg || row.lga);
      const ward = String(row.ward || '').trim();
      if (!state) continue;
      const key = `${state}::${lga}`;
      if (!byStateLga.has(key)) byStateLga.set(key, { lgaTotal: 0, byWard: new Map() });
      const bucket = byStateLga.get(key);
      bucket.lgaTotal += 1;
      bucket.byWard.set(ward, (bucket.byWard.get(ward) || 0) + 1);
    }
    return byStateLga;
  })();
  return puIndexPromise;
}

async function countPollingUnits({ state, lga, ward } = {}) {
  const index = await loadPuIndex();
  const key = `${normalizeLookupKey(state)}::${normalizeLookupKey(lga)}`;
  const bucket = index.get(key) || { lgaTotal: 0, byWard: new Map() };
  let wardTotal = 0;
  const wardKey = normalizeLookupKey(ward);
  if (wardKey) {
    for (const [name, count] of bucket.byWard.entries()) {
      if (normalizeLookupKey(name) === wardKey) wardTotal += count;
    }
  }
  return { lgaTotal: bucket.lgaTotal, wardTotal, byWard: bucket.byWard };
}

function packKpi({ level, scope, registered, collected, origin, caption, year }) {
  const rate = ratePct(collected, registered);
  const turnout = turnoutForYear(year);
  const estimatedBallots = roundInt(collected * turnout.rate);
  return {
    level,
    scope,
    year: String(year || '2023'),
    registered,
    collected,
    rate,
    votingStrength: estimatedBallots,
    estimatedBallots,
    turnoutBasis: turnout.label,
    origin,
    caption,
  };
}

async function computeNigeriaKpis({ state, lga, ward, pu, year } = {}) {
  const electionYear = String(year || '2023');
  const snap = await loadLatestSnapshot();
  const states = snap.statePopulation || [];
  const lgas = snap.lgaPopulation || [];
  const officialLga = (snap.lgaRegister || []).filter(Boolean);

  const nationalReg = states.reduce((sum, row) => sum + Number(row.registeredVoters || 0), 0);
  const nationalPvc = states.reduce((sum, row) => sum + Number(row.collectedPVCs || 0), 0);

  if (!state) {
    return packKpi({
      level: 'National',
      scope: 'Nigeria',
      registered: nationalReg,
      collected: nationalPvc,
      origin: 'source_series',
      caption: 'INEC February 2023 state series · national discrepancy disclosed',
      year: electionYear,
    });
  }

  const stateRow = pickRow(states, state, 'state');
  if (!stateRow) {
    return packKpi({
      level: 'State',
      scope: state,
      registered: 0,
      collected: 0,
      origin: 'pending',
      caption: 'No official state row in the current snapshot',
      year: electionYear,
    });
  }

  const stateReg = Number(stateRow.registeredVoters || 0);
  const statePvc = Number(stateRow.collectedPVCs || 0);

  if (!lga) {
    return packKpi({
      level: 'State',
      scope: stateRow.state || state,
      registered: stateReg,
      collected: statePvc,
      origin: 'source_series',
      caption: 'INEC February 2023 state table · in review',
      year: electionYear,
    });
  }

  const official = officialLga.find(
    (row) =>
      normalizeLookupKey(row.state) === normalizeLookupKey(state) &&
      normalizeLookupKey(row.lga) === normalizeLookupKey(lga)
  );
  let lgaReg;
  let lgaPvc;
  let origin = 'allocated';
  let caption = 'Allocated from state using LGA population';

  if (official && Number(official.registeredVoters) > 0) {
    lgaReg = Number(official.registeredVoters);
    lgaPvc = Number(official.collectedPVCs || 0);
    origin = 'source_series';
    caption = 'INEC LGA source table · in review';
  } else {
    const stateLgas = lgas.filter((row) => normalizeLookupKey(row.state) === normalizeLookupKey(state));
    const popSum = stateLgas.reduce((sum, row) => sum + Number(row.population || 0), 0) || 1;
    const lgaRow = pickRow(stateLgas, lga, 'lga');
    const share = Number(lgaRow?.population || 0) / popSum;
    lgaReg = roundInt(stateReg * share);
    lgaPvc = roundInt(statePvc * share);
  }

  if (!ward) {
    return packKpi({
      level: 'LGA',
      scope: lga,
      registered: lgaReg,
      collected: lgaPvc,
      origin,
      caption,
      year: electionYear,
    });
  }

  const counts = await countPollingUnits({ state, lga, ward });
  const wardShare = counts.lgaTotal ? (counts.wardTotal || 0) / counts.lgaTotal : 0;
  const wardReg = roundInt(lgaReg * wardShare);
  const wardPvc = roundInt(lgaPvc * wardShare);
  const wardCaption = origin === 'source_series'
    ? 'Estimated using polling-unit counts within sourced LGA totals'
    : 'Allocated using polling-unit counts';

  if (!pu) {
    return packKpi({
      level: 'Ward',
      scope: ward,
      registered: wardReg,
      collected: wardPvc,
      origin: 'allocated',
      caption: wardCaption,
      year: electionYear,
    });
  }

  const puCount = Math.max(counts.wardTotal, 1);
  return packKpi({
    level: 'Polling unit',
    scope: pu,
    registered: roundInt(wardReg / puCount),
    collected: roundInt(wardPvc / puCount),
    origin: 'allocated',
    caption: 'Allocated equally across units in this ward',
    year: electionYear,
  });
}

module.exports = { computeNigeriaKpis, TURNOUT_2023, TURNOUT_BY_YEAR };
