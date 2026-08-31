/**
 * Master index of sourced statewide governorship results (36 states × 4 dashboard years).
 */
const Y2014 = require('./governorship-statewide-2014');
const Y2018 = require('./governorship-statewide-2018');
const Y2022 = require('./governorship-statewide-2022');
const Y2026 = require('./governorship-statewide-2026');

const BY_YEAR = {
  2014: Y2014,
  2018: Y2018,
  2022: Y2022,
  2026: Y2026,
};

const YEARS = ['2026', '2022', '2018', '2014'];

function getStatewideElection(state, year) {
  return BY_YEAR[String(year)]?.[state] || null;
}

function listStates(year) {
  return Object.keys(BY_YEAR[String(year)] || {});
}

function allEntries() {
  const rows = [];
  for (const year of YEARS) {
    for (const [state, data] of Object.entries(BY_YEAR[year])) {
      rows.push({ year, state, ...data });
    }
  }
  return rows;
}

module.exports = {
  BY_YEAR,
  YEARS,
  getStatewideElection,
  listStates,
  allEntries,
};
