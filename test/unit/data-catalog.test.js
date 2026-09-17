const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');

const {
  buildDataCatalog,
  publicCatalogForClient,
  findCatalogEntry,
  buildDownload,
  collectResultRows,
} = require('../../src/data-catalog');

test('data catalog lists public static and result datasets', () => {
  const catalog = buildDataCatalog({ force: true });
  assert.equal(catalog.ok, true);
  assert.ok(catalog.count > 20, `expected many datasets, got ${catalog.count}`);
  const ids = new Set(catalog.datasets.map((d) => d.id));
  assert.ok(ids.has('candidates:presidential'));
  assert.ok(ids.has('reference:population-pvc'));
  assert.ok(ids.has('geography:boundaries-state'));
  assert.ok(ids.has('reference:stears-africa-past-tracker'));
  assert.ok(ids.has('reference:stears-africa-upcoming-tracker'));
  assert.ok(catalog.datasets.every((d) => d.downloads && (d.downloads.json || d.downloads.zip || d.downloads.csv)));
  assert.ok(Array.isArray(catalog.gated) && catalog.gated.length >= 1);
  const stearsPast = catalog.datasets.find((d) => d.id === 'reference:stears-africa-past-tracker');
  assert.equal(stearsPast.country, 'global');
  assert.equal(stearsPast.downloads.csv, '/data/stears-open-data/africa-past-tracker.csv');
});

test('public catalog omits internal file paths', () => {
  const pub = publicCatalogForClient(buildDataCatalog({ force: true }));
  for (const row of pub.datasets) {
    assert.equal(row.file, undefined);
    assert.equal(row.kind, undefined);
    assert.ok(row.id);
    assert.ok(row.name);
  }
});

test('result rows are publishable and downloadable as csv', async () => {
  const rows = collectResultRows();
  assert.ok(rows.length > 0, 'expected at least one publishable result file');
  const sample = rows.find((r) => r.office === 'pres') || rows[0];
  const entry = findCatalogEntry(
    buildDataCatalog({ force: true }).datasets.find((d) => d.file === sample.file)?.id
  );
  assert.ok(entry);
  const json = await buildDownload(entry, 'json');
  assert.match(json.contentType, /json/);
  assert.ok(json.body.includes('{'));
  const csv = await buildDownload(entry, 'csv');
  assert.match(csv.contentType, /csv/);
  assert.ok(csv.body.includes(','));
});

test('candidate catalog csv download works from public folder', async () => {
  const entry = findCatalogEntry('candidates:presidential');
  assert.ok(entry);
  const csv = await buildDownload(entry, 'csv');
  assert.match(csv.fileName, /\.csv$/);
  assert.ok(csv.body.split('\n').length > 3);
  const publicFile = path.join(__dirname, '..', '..', 'public', 'data', 'presidential-candidates.json');
  assert.ok(fs.existsSync(publicFile));
});
