const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { resolveArchivePath, safeSegment } = require('../../src/storage');

test('keeps archive keys inside the configured root', () => {
  const root = path.resolve('test-archive-root');
  const target = resolveArchivePath('president/2015/source.pdf', root);
  assert.equal(path.relative(root, target), path.join('president', '2015', 'source.pdf'));
  assert.throws(() => resolveArchivePath('../../outside.pdf', root), /escapes/);
});

test('normalizes unsafe filename characters', () => {
  assert.equal(safeSegment('INEC result: page 1?.pdf'), 'INEC-result-page-1-.pdf');
});
