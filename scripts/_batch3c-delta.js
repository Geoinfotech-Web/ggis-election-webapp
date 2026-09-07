#!/usr/bin/env node
/** Writer for Delta 2023 official LGA tables (Wikipedia / Punch). */
const fs = require('fs');
const path = require('path');
const { buildGovernorshipDataset } = require('./lib/build-gov-dataset');

const OUT = path.join(__dirname, '..', 'data', 'election-results', 'official');

function write(file, payload) {
  fs.writeFileSync(path.join(OUT, file), JSON.stringify(payload, null, 2));
  console.log(file, Object.keys(payload.units).length, payload.winner.party, payload.winner.name);
}

function dupYear(srcFile, year) {
  const base = JSON.parse(fs.readFileSync(path.join(OUT, srcFile), 'utf8'));
  const rows = Object.entries(base.units).map(([lga, u]) => ({ lga, votes: u.votes }));
  return buildGovernorshipDataset({
    state: base.meta.state,
    year,
    updated: base.meta.updated,
    sourceDetail: base.meta.sourceDetail,
    candidates: base.candidates,
    lgaRows: rows,
  });
}

function sumParty(rows, party) {
  return rows.reduce((s, r) => s + Number(r.votes[party] || 0), 0);
}

const deltaRows = [
  { lga: 'Aniocha North', votes: { APC: 4386, LP: 1883, PDP: 8938 } },
  { lga: 'Aniocha South', votes: { APC: 4623, LP: 5107, PDP: 10032 } },
  { lga: 'Bomadi', votes: { APC: 4728, LP: 100, PDP: 12340 } },
  { lga: 'Burutu', votes: { APC: 11736, LP: 123, PDP: 12641 } },
  { lga: 'Ethiope East', votes: { APC: 11600, LP: 530, PDP: 13030 } },
  { lga: 'Ethiope West', votes: { APC: 6758, LP: 304, PDP: 7065 } },
  { lga: 'Ika North East', votes: { APC: 4733, LP: 1990, PDP: 26760 } },
  { lga: 'Ika South', votes: { APC: 6790, LP: 4495, PDP: 15283 } },
  { lga: 'Isoko North', votes: { APC: 10811, LP: 894, PDP: 15899 } },
  { lga: 'Isoko South', votes: { APC: 15954, LP: 492, PDP: 19963 } },
  { lga: 'Ndokwa East', votes: { APC: 9044, LP: 251, PDP: 10146 } },
  { lga: 'Ndokwa West', votes: { APC: 10252, LP: 935, PDP: 15539 } },
  { lga: 'Okpe', votes: { APC: 8679, LP: 1155, PDP: 14544 } },
  { lga: 'Oshimili North', votes: { APC: 5327, LP: 2183, PDP: 35966 } },
  { lga: 'Oshimili South', votes: { APC: 4763, LP: 10148, PDP: 23149 } },
  { lga: 'Patani', votes: { APC: 4743, LP: 85, PDP: 6069 } },
  { lga: 'Sapele', votes: { APC: 12090, LP: 1458, PDP: 15217 } },
  { lga: 'Udu', votes: { APC: 13154, LP: 1886, PDP: 9746 } },
  { lga: 'Ughelli North', votes: { APC: 34955, LP: 1438, PDP: 15198 } },
  { lga: 'Ughelli South', votes: { APC: 15620, LP: 571, PDP: 15513 } },
  { lga: 'Ukwuani', votes: { APC: 7591, LP: 791, PDP: 14640 } },
  { lga: 'Uvwie', votes: { APC: 12389, LP: 6340, PDP: 9776 } },
  { lga: 'Warri North', votes: { APC: 4165, LP: 205, PDP: 10367 } },
  { lga: 'Warri South', votes: { APC: 11569, LP: 3743, PDP: 15299 } },
  { lga: 'Warri South West', votes: { APC: 3770, LP: 140, PDP: 7114 } },
];

console.log('delta sums', {
  APC: sumParty(deltaRows, 'APC'),
  LP: sumParty(deltaRows, 'LP'),
  PDP: sumParty(deltaRows, 'PDP'),
}, 'official APC240229 LP48027 PDP360234');

write('delta-2022-lga.json', buildGovernorshipDataset({
  state: 'Delta',
  year: '2022',
  updated: '2023-03-20',
  sourceDetail: 'INEC LGA collation centres (2023 Delta governorship) — Wikipedia / Punch reporting official returns, 20 March 2023',
  candidates: [
    { name: 'Sheriff Oborevwori', party: 'PDP', votes: 360234 },
    { name: 'Ovie Omo-Agege', party: 'APC', votes: 240229 },
    { name: 'Ken Pela', party: 'LP', votes: 48027 },
  ],
  lgaRows: deltaRows,
}));
write('delta-2026-lga.json', dupYear('delta-2022-lga.json', '2026'));

const d = require(path.join(OUT, 'delta-2022-lga.json'));
const { matchKey } = require('../lga-normalize');
const est = require(path.join(__dirname, '..', 'data', 'election-results', 'gubernatorial', 'delta-2022.json'));
const estKeys = Object.keys(est.units);
const miss = estKeys.filter((k) => !Object.keys(d.units).some((nk) => matchKey(nk) === matchKey(k)));
console.log('delta lgas', Object.keys(d.units).length, 'unmatched est keys', miss);
console.log('done');
