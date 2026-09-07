const test = require('node:test');
const assert = require('node:assert/strict');
const { validateResultDataset, isSpecificInecUrl } = require('../../src/result-validation');
const { validDataset } = require('../fixtures');

test('accepts a complete declaration-level dataset', () => {
  assert.deepEqual(validateResultDataset(validDataset()), { valid: true, errors: [] });
});

test('rejects modeled totals, bad arithmetic, and an unexplained year', () => {
  const payload = validDataset();
  payload.dataset.methodology = 'PVC-proportional modeled allocation for display only';
  payload.summaries[0].validVotes = 71;
  payload.contest.electionDate = '2014-03-28';
  const report = validateResultDataset(payload);
  assert.equal(report.valid, false);
  assert.match(report.errors.join('\n'), /Modeled/);
  assert.match(report.errors.join('\n'), /Candidate votes/);
  assert.match(report.errors.join('\n'), /2015 or later/);
});

test('requires qualifying evidence for each total', () => {
  const payload = validDataset();
  payload.sources[0].url = 'https://www.inecnigeria.org/';
  const report = validateResultDataset(payload);
  assert.equal(report.valid, false);
  assert.match(report.errors.join('\n'), /not a homepage/);
  assert.match(report.errors.join('\n'), /Result national::winner/);
});

test('recognizes only specific INEC links', () => {
  assert.equal(isSpecificInecUrl('https://www.inecnigeria.org/'), false);
  assert.equal(isSpecificInecUrl('https://wp1.inecnigeria.org/election-results/'), true);
  assert.equal(isSpecificInecUrl('https://example.com/results.pdf'), false);
});
