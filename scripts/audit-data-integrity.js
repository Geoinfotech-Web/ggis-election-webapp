const fs = require('fs');
const path = require('path');
const Papa = require('papaparse');

const root = path.join(__dirname, '..');
const govDir = path.join(root, 'data', 'election-results', 'gubernatorial');
const files = fs.existsSync(govDir) ? fs.readdirSync(govDir).filter((name) => name.endsWith('.json')) : [];
const report = {
  auditedAt: new Date().toISOString(),
  governorshipFiles: files.length,
  modeled: 0,
  published: 0,
  yearDateMismatches: 0,
  homepageOnlySources: 0,
  invalidJson: 0,
  pvc: {},
};

for (const name of files) {
  try {
    const payload = JSON.parse(fs.readFileSync(path.join(govDir, name), 'utf8'));
    const meta = payload.meta || {};
    if (meta.lgaMethod === 'pvc-proportional' || meta.modeled || meta.synthetic) report.modeled += 1;
    if (meta.publicationStatus === 'published') report.published += 1;
    const electionYear = meta.electionDate ? new Date(meta.electionDate).getUTCFullYear() : null;
    if (Number.isFinite(electionYear) && meta.year && Number(meta.year) !== electionYear) report.yearDateMismatches += 1;
    if (/^https?:\/\/(www\.)?inecnigeria\.org\/?$/i.test(String(meta.sourceUrl || ''))) report.homepageOnlySources += 1;
  } catch {
    report.invalidJson += 1;
  }
}

const population = JSON.parse(fs.readFileSync(path.join(root, 'data', 'reference', 'population-pvc-data.json'), 'utf8'));
const states = population.statePopulation.filter((row) => String(row.state).toLowerCase() !== 'total');
report.pvc.jurisdictions = states.length;
report.pvc.registeredVoters = states.reduce((sum, row) => sum + Number(row.registeredVoters || 0), 0);
report.pvc.stateSeriesCollected = states.reduce((sum, row) => sum + Number(row.collectedPVCs || 0), 0);
report.pvc.reportNarrativeCollected = population.metadata?.voterRegister?.laterReportNarrativeCollectedPVCs || null;
report.pvc.unexplainedDifference = report.pvc.reportNarrativeCollected - report.pvc.stateSeriesCollected;
report.pvc.lgas = population.lgaPopulation.length;

const pollingCsv = fs.readFileSync(path.join(root, 'data', 'reference', 'Nigeria_polling_units.csv'), 'utf8');
const polling = Papa.parse(pollingCsv, { header: true, skipEmptyLines: true });
report.pollingUnits = {
  rows: polling.data.length,
  withCoordinates: polling.data.filter((row) => Number.isFinite(Number(row.lat)) && Number.isFinite(Number(row.long)) && String(row.lat).trim() && String(row.long).trim()).length,
};
report.pollingUnits.withoutCoordinates = report.pollingUnits.rows - report.pollingUnits.withCoordinates;

console.log(JSON.stringify(report, null, 2));

// Register must stay complete; coordinates come from the INEC locator archive (~67% coverage).
const MIN_SOURCED_COORDS = 100000;
const unsafe = report.invalidJson > 0 || report.published > 0 || report.pvc.jurisdictions !== 37 ||
  report.pvc.registeredVoters !== 93469008 || report.pvc.stateSeriesCollected !== 87209007 ||
  report.pvc.lgas !== 774 || report.pollingUnits.rows !== 176846 ||
  report.pollingUnits.withCoordinates < MIN_SOURCED_COORDS;
if (unsafe) process.exitCode = 1;
