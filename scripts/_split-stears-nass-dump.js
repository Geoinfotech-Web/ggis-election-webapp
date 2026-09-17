/**
 * Split Playwright MCP dump into stears-nass JSON caches.
 * Source: agent-tools dump with nationals + senate2015States.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SRC =
  process.argv[2] ||
  path.join(
    process.env.USERPROFILE || '',
    '.cursor',
    'projects',
    'c-Users-Geoinfotech-Documents-GIS-Team-Election-Dashboard',
    'agent-tools',
    '14f2ca6e-e34e-482f-93fe-6f057fbdf7f9.txt'
  );
const OUT = path.join(__dirname, '_wiki_raw', 'stears-nass');

fs.mkdirSync(OUT, { recursive: true });

const text = fs.readFileSync(SRC, 'utf8');
// Find the JSON object that starts with {"summary":
const start = text.indexOf('{"summary":');
if (start < 0) {
  console.error('No summary JSON found in', SRC);
  process.exit(1);
}
// The JSON is one line (or until next ### heading)
let end = text.indexOf('\n###', start);
if (end < 0) end = text.indexOf('\n\n', start);
if (end < 0) end = text.length;
const jsonText = text.slice(start, end).trim();
const data = JSON.parse(jsonText);

console.log('summary', JSON.stringify(data.summary, null, 2));

for (const [name, payload] of Object.entries(data.nationals || {})) {
  const dest = path.join(OUT, name);
  fs.writeFileSync(dest, JSON.stringify(payload) + '\n', 'utf8');
  console.log('wrote', name, 'parties', (payload.parties || []).length);
}

for (const [code, payload] of Object.entries(data.senate2015States || {})) {
  const dest = path.join(OUT, `senate-2015-${code}.json`);
  fs.writeFileSync(dest, JSON.stringify(payload) + '\n', 'utf8');
  const wv = (payload.parties || []).filter((p) => Number(p.votes) > 0).length;
  console.log('wrote senate-2015-' + code, 'voteRows', wv);
}

fs.writeFileSync(path.join(OUT, '_split-summary.json'), JSON.stringify(data.summary, null, 2));
console.log('done →', OUT);
