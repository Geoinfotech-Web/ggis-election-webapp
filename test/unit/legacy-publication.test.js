const test = require('node:test');
const assert = require('node:assert/strict');
const { isPublishableLegacyPayload } = require('../../election-results-data');

test('quarantines modeled and unlabeled legacy records', () => {
  assert.equal(isPublishableLegacyPayload({ meta: { lgaMethod: 'pvc-proportional' } }), false);
  assert.equal(isPublishableLegacyPayload({ meta: { publicationStatus: 'published', evidence: [{}], modeled: true } }), false);
});

test('requires published status, evidence, and matching election year', () => {
  const payload = { meta: { publicationStatus: 'published', evidence: [{}], year: 2023, electionDate: '2023-03-18' } };
  assert.equal(isPublishableLegacyPayload(payload), true);
  payload.meta.year = 2026;
  assert.equal(isPublishableLegacyPayload(payload), false);
});
