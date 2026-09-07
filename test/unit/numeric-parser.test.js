const test = require('node:test');
const assert = require('node:assert/strict');

process.env.NODE_ENV = 'test';

const { parseNumericValue, normalizePollingUnitPointRow } = require('../../server');

test('blank coordinate fields remain unavailable', () => {
  assert.equal(parseNumericValue(''), null);
  assert.equal(parseNumericValue('   '), null);
  assert.equal(parseNumericValue(null), null);
  assert.equal(parseNumericValue(undefined), null);
});

test('valid coordinate fields remain numeric', () => {
  assert.equal(parseNumericValue('6.5244'), 6.5244);
  assert.equal(parseNumericValue(' 3.3792 '), 3.3792);
});

test('address number pairs are not interpreted as coordinates', () => {
  const point = normalizePollingUnitPointRow({
    state: 'Example',
    lga: 'Example LGA',
    pu_code: '001',
    location: 'LGEA School Block 1, 2 & 3',
  });

  assert.equal(point.latitude, null);
  assert.equal(point.longitude, null);
  assert.equal(point.sourceHasCoordinates, false);
});
