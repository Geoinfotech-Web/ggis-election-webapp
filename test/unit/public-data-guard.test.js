const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const indexHtml = fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'index.html'), 'utf8');

test('public UI disables prototype election values until records are published', () => {
  assert.match(indexHtml, /No verified election results are published/);
  assert.match(indexHtml, /\/api\/v1\/contests/);
  assert.doesNotMatch(indexHtml, /support\.js|unpkg\.com|text\/dc/);
  assert.doesNotMatch(indexHtml, /ngWinner\s*\(/);
});
