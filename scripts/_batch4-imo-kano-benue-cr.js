#!/usr/bin/env node
/** Official LGA writers: Imo / Kano / Benue / Cross River (2023). */
const fs = require('fs');
const path = require('path');
const { buildGovernorshipDataset } = require('./lib/build-gov-dataset');
const { matchKey } = require('../lga-normalize');

const OUT = path.join(__dirname, '..', 'data', 'election-results', 'official');
const GOV = path.join(__dirname, '..', 'data', 'election-results', 'gubernatorial');

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

function coverage(slug, rows) {
  const est = require(path.join(GOV, `${slug}-2022.json`));
  const keys = new Set(rows.map((r) => matchKey(r.lga)));
  const miss = Object.keys(est.units).filter((k) => !keys.has(matchKey(k)));
  console.log(slug, 'rows', rows.length, 'miss', miss);
}

// --- Imo 2023 (Nov) — THISDAY table; totals APC 540308 / PDP 71503 / LP 64081
const imoRows = [
  { lga: 'Aboh Mbaise', votes: { APC: 9638, PDP: 1724, LP: 2435 } },
  { lga: 'Ahiazu Mbaise', votes: { APC: 8369, PDP: 3507, LP: 2214 } },
  { lga: 'Ehime Mbano', votes: { APC: 6632, PDP: 681, LP: 4958 } },
  { lga: 'Ezinihitte Mbaise', votes: { APC: 8473, PDP: 2784, LP: 3332 } },
  { lga: 'Ideato North', votes: { APC: 5271, PDP: 2052, LP: 1522 } },
  { lga: 'Ideato South', votes: { APC: 16891, PDP: 2469, LP: 1649 } },
  { lga: 'Ihitte/Uboma', votes: { APC: 11099, PDP: 3077, LP: 2766 } },
  { lga: 'Ikeduru', votes: { APC: 22356, PDP: 7258, LP: 1877 } },
  { lga: 'Isiala Mbano', votes: { APC: 10860, PDP: 1659, LP: 2419 } },
  { lga: 'Isu', votes: { APC: 11312, PDP: 2508, LP: 1253 } },
  { lga: 'Mbaitoli', votes: { APC: 12556, PDP: 5343, LP: 4007 } },
  { lga: 'Ngor Okpala', votes: { APC: 14143, PDP: 3451, LP: 2716 } },
  { lga: 'Njaba', votes: { APC: 8110, PDP: 2404, LP: 995 } },
  { lga: 'Nkwerre', votes: { APC: 22488, PDP: 2632, LP: 1320 } },
  { lga: 'Nwangele', votes: { APC: 29282, PDP: 2132, LP: 895 } },
  { lga: 'Obowo', votes: { APC: 17514, PDP: 3404, LP: 711 } },
  { lga: 'Oguta', votes: { APC: 57310, PDP: 2653, LP: 1941 } },
  { lga: 'Ohaji/Egbema', votes: { APC: 14962, PDP: 1506, LP: 3694 } },
  { lga: 'Okigwe', votes: { APC: 55585, PDP: 1688, LP: 2655 } },
  { lga: 'Onuimo', votes: { APC: 13434, PDP: 2676, LP: 1753 } },
  { lga: 'Orlu', votes: { APC: 37614, PDP: 3290, LP: 2424 } },
  { lga: 'Orsu', votes: { APC: 18003, PDP: 624, LP: 813 } },
  { lga: 'Oru-East', votes: { APC: 67315, PDP: 2202, LP: 3443 } },
  { lga: 'Oru West', votes: { APC: 38726, PDP: 1867, LP: 987 } },
  { lga: 'Owerri Municipal', votes: { APC: 5324, PDP: 2914, LP: 2180 } },
  { lga: 'Owerri North', votes: { APC: 8536, PDP: 3449, LP: 4386 } },
  { lga: 'Owerri West', votes: { APC: 9205, PDP: 3305, LP: 2597 } },
];
console.log('imo sums', { APC: sumParty(imoRows, 'APC'), PDP: sumParty(imoRows, 'PDP'), LP: sumParty(imoRows, 'LP') }, 'off 540308/71503/64081');
coverage('imo', imoRows);
write('imo-2022-lga.json', buildGovernorshipDataset({
  state: 'Imo',
  year: '2022',
  updated: '2023-11-12',
  sourceDetail: 'INEC LGA collation centres (2023 Imo governorship) — THISDAY reporting official returns, 12 November 2023',
  candidates: [
    { name: 'Hope Uzodinma', party: 'APC', votes: 540308 },
    { name: 'Samuel Anyanwu', party: 'PDP', votes: 71503 },
    { name: 'Athan Achonu', party: 'LP', votes: 64081 },
  ],
  lgaRows: imoRows,
}));
write('imo-2026-lga.json', dupYear('imo-2022-lga.json', '2026'));

// --- Kano 2023 — Wikipedia LGA table; Nasarawa APC/NNPP corrected per Stears; PU cancellations mean LGA sum ≠ statewide
const kanoRows = [
  { lga: 'Ajingi', votes: { APC: 14438, NNPP: 14422, PDP: 103 } },
  { lga: 'Albasu', votes: { APC: 16952, NNPP: 19952, PDP: 293 } },
  { lga: 'Bagwai', votes: { APC: 21295, NNPP: 17311, PDP: 51 } },
  { lga: 'Bebeji', votes: { APC: 14782, NNPP: 21001, PDP: 254 } },
  { lga: 'Bichi', votes: { APC: 46443, NNPP: 23029, PDP: 112 } },
  { lga: 'Bunkure', votes: { APC: 17156, NNPP: 19277, PDP: 51 } },
  { lga: 'Dala', votes: { APC: 33993, NNPP: 48119, PDP: 874 } },
  { lga: 'Danbata', votes: { APC: 16955, NNPP: 9674, PDP: 1107 } },
  { lga: 'Dawaki Kudu', votes: { APC: 23656, NNPP: 31813, PDP: 1350 } },
  { lga: 'Dawaki Tofa', votes: { APC: 25226, NNPP: 24124, PDP: 258 } },
  { lga: 'Doguwa', votes: { APC: 20658, NNPP: 17184, PDP: 720 } },
  { lga: 'Fagge', votes: { APC: 17457, NNPP: 23015, PDP: 540 } },
  { lga: 'Gabasawa', votes: { APC: 17584, NNPP: 19507, PDP: 1269 } },
  { lga: 'Garko', votes: { APC: 18808, NNPP: 14658, PDP: 162 } },
  { lga: 'Garun Malam', votes: { APC: 14958, NNPP: 15400, PDP: 107 } },
  { lga: 'Gaya', votes: { APC: 19272, NNPP: 19246, PDP: 71 } },
  { lga: 'Gezawa', votes: { APC: 19961, NNPP: 22077, PDP: 277 } },
  { lga: 'Gwale', votes: { APC: 21548, NNPP: 39460, PDP: 638 } },
  { lga: 'Gwarzo', votes: { APC: 26881, NNPP: 25419, PDP: 377 } },
  { lga: 'Kabo', votes: { APC: 23599, NNPP: 16963, PDP: 2118 } },
  { lga: 'Kano Municipal', votes: { APC: 30264, NNPP: 47351, PDP: 359 } },
  { lga: 'Karaye', votes: { APC: 14515, NNPP: 15838, PDP: 77 } },
  { lga: 'Kibiya', votes: { APC: 13260, NNPP: 17157, PDP: 52 } },
  { lga: 'Kiru', votes: { APC: 27014, NNPP: 29153, PDP: 263 } },
  { lga: 'Kumbotso', votes: { APC: 22681, NNPP: 37668, PDP: 326 } },
  { lga: 'Kunchi', votes: { APC: 13215, NNPP: 10674, PDP: 39 } },
  { lga: 'Kura', votes: { APC: 18924, NNPP: 20989, PDP: 259 } },
  { lga: 'Madobi', votes: { APC: 17102, NNPP: 25151, PDP: 203 } },
  { lga: 'Makoda', votes: { APC: 15006, NNPP: 13956, PDP: 101 } },
  { lga: 'Minjibir', votes: { APC: 16038, NNPP: 17575, PDP: 189 } },
  { lga: 'Nasarawa', votes: { APC: 38952, NNPP: 53434, PDP: 480 } },
  { lga: 'Rano', votes: { APC: 17090, NNPP: 18040, PDP: 225 } },
  { lga: 'Rimin Gado', votes: { APC: 13402, NNPP: 12316, PDP: 64 } },
  { lga: 'Rogo', votes: { APC: 11112, NNPP: 18559, PDP: 124 } },
  { lga: 'Shanono', votes: { APC: 17249, NNPP: 13650, PDP: 272 } },
  { lga: 'Sumaila', votes: { APC: 19682, NNPP: 29052, PDP: 113 } },
  { lga: 'Takai', votes: { APC: 25244, NNPP: 23666, PDP: 194 } },
  { lga: 'Tarauni', votes: { APC: 21276, NNPP: 31333, PDP: 321 } },
  { lga: 'Tofa', votes: { APC: 12996, NNPP: 15789, PDP: 183 } },
  { lga: 'Tsanyawa', votes: { APC: 18746, NNPP: 16769, PDP: 71 } },
  { lga: 'Tudun Wada', votes: { APC: 24382, NNPP: 27434, PDP: 166 } },
  { lga: 'Ungogo', votes: { APC: 24644, NNPP: 33111, PDP: 819 } },
  { lga: 'Warawa', votes: { APC: 16256, NNPP: 14629, PDP: 201 } },
  { lga: 'Wudil', votes: { APC: 20299, NNPP: 21740, PDP: 276 } },
];
console.log('kano sums', { APC: sumParty(kanoRows, 'APC'), NNPP: sumParty(kanoRows, 'NNPP'), PDP: sumParty(kanoRows, 'PDP') }, 'off 890705/1019602/15957 (PU cancellations)');
coverage('kano', kanoRows);
write('kano-2022-lga.json', buildGovernorshipDataset({
  state: 'Kano',
  year: '2022',
  updated: '2023-03-20',
  sourceDetail: 'INEC LGA collation centres (2023 Kano governorship) — Wikipedia / Stears reporting official returns, 20 March 2023 (some PU results cancelled before statewide declaration)',
  candidates: [
    { name: 'Abba Kabir Yusuf', party: 'NNPP', votes: 1019602 },
    { name: 'Nasir Yusuf Gawuna', party: 'APC', votes: 890705 },
    { name: 'Sadiq Wali', party: 'PDP', votes: 15957 },
  ],
  lgaRows: kanoRows,
}));
write('kano-2026-lga.json', dupYear('kano-2022-lga.json', '2026'));

// --- Benue 2023 — Wikipedia; Kwande had no election (ballot error)
const benueRows = [
  { lga: 'Ado', votes: { APC: 8662, LP: 308, PDP: 4379 } },
  { lga: 'Agatu', votes: { APC: 7482, LP: 216, PDP: 9934 } },
  { lga: 'Apa', votes: { APC: 7925, LP: 465, PDP: 7806 } },
  { lga: 'Buruku', votes: { APC: 34713, LP: 1155, PDP: 9513 } },
  { lga: 'Gboko', votes: { APC: 53985, LP: 1493, PDP: 18773 } },
  { lga: 'Guma', votes: { APC: 15371, LP: 535, PDP: 22083 } },
  { lga: 'Gwer East', votes: { APC: 20083, LP: 1272, PDP: 12085 } },
  { lga: 'Gwer West', votes: { APC: 10947, LP: 1509, PDP: 13609 } },
  { lga: 'Katsina-Ala', votes: { APC: 34347, LP: 178, PDP: 6716 } },
  { lga: 'Konshisha', votes: { APC: 13997, LP: 21606, PDP: 5905 } },
  { lga: 'Logo', votes: { APC: 15574, LP: 296, PDP: 16385 } },
  { lga: 'Makurdi', votes: { APC: 56432, LP: 3792, PDP: 12329 } },
  { lga: 'Obi', votes: { APC: 9897, LP: 1185, PDP: 6267 } },
  { lga: 'Ogbadibo', votes: { APC: 7627, LP: 405, PDP: 6032 } },
  { lga: 'Ohimini', votes: { APC: 7233, LP: 973, PDP: 6785 } },
  { lga: 'Oju', votes: { APC: 17245, LP: 1611, PDP: 8811 } },
  { lga: 'Okpokwu', votes: { APC: 9326, LP: 1039, PDP: 8634 } },
  { lga: 'Otukpo', votes: { APC: 19430, LP: 2187, PDP: 12834 } },
  { lga: 'Tarka', votes: { APC: 16422, LP: 175, PDP: 3748 } },
  { lga: 'Ukum', votes: { APC: 28503, LP: 439, PDP: 9418 } },
  { lga: 'Ushongo', votes: { APC: 31946, LP: 913, PDP: 8879 } },
  { lga: 'Vandeikya', votes: { APC: 46786, LP: 129, PDP: 12988 } },
];
console.log('benue sums', { APC: sumParty(benueRows, 'APC'), LP: sumParty(benueRows, 'LP'), PDP: sumParty(benueRows, 'PDP') }, 'off 473933/41881/223913 (Kwande no poll)');
coverage('benue', benueRows);
write('benue-2022-lga.json', buildGovernorshipDataset({
  state: 'Benue',
  year: '2022',
  updated: '2023-03-20',
  sourceDetail: 'INEC LGA collation centres (2023 Benue governorship) — Wikipedia / Punch reporting official returns, 20 March 2023 (Kwande LGA: no election — ballot paper error)',
  candidates: [
    { name: 'Hyacinth Alia', party: 'APC', votes: 473933 },
    { name: 'Titus Uba', party: 'PDP', votes: 223913 },
    { name: 'Herman Hembe', party: 'LP', votes: 41881 },
  ],
  lgaRows: benueRows,
}));
write('benue-2026-lga.json', dupYear('benue-2022-lga.json', '2026'));

// --- Cross River 2023 — Wikipedia
const crRows = [
  { lga: 'Abi', votes: { APC: 9861, PDP: 8816 } },
  { lga: 'Akamkpa', votes: { APC: 10529, PDP: 6935 } },
  { lga: 'Akpabuyo', votes: { APC: 10410, PDP: 5938 } },
  { lga: 'Bakassi', votes: { APC: 1632, PDP: 316 } },
  { lga: 'Bekwarra', votes: { APC: 11839, PDP: 12129 } },
  { lga: 'Biase', votes: { APC: 11626, PDP: 7079 } },
  { lga: 'Boki', votes: { APC: 17355, PDP: 15303 } },
  { lga: 'Calabar Municipality', votes: { APC: 20320, PDP: 15882 } },
  { lga: 'Calabar South', votes: { APC: 28340, PDP: 7980 } },
  { lga: 'Etung', votes: { APC: 5205, PDP: 5139 } },
  { lga: 'Ikom', votes: { APC: 12883, PDP: 14158 } },
  { lga: 'Obanliku', votes: { APC: 10386, PDP: 10100 } },
  { lga: 'Obubra', votes: { APC: 13371, PDP: 10945 } },
  { lga: 'Obudu', votes: { APC: 21599, PDP: 12461 } },
  { lga: 'Odukpani', votes: { APC: 13622, PDP: 3971 } },
  { lga: 'Ogoja', votes: { APC: 16162, PDP: 17483 } },
  { lga: 'Yakurr', votes: { APC: 17684, PDP: 9208 } },
  { lga: 'Yala', votes: { APC: 24793, PDP: 15793 } },
];
console.log('cross-river sums', { APC: sumParty(crRows, 'APC'), PDP: sumParty(crRows, 'PDP') }, 'off 258619/179636');
coverage('cross-river', crRows);
write('cross-river-2022-lga.json', buildGovernorshipDataset({
  state: 'Cross River',
  year: '2022',
  updated: '2023-03-20',
  sourceDetail: 'INEC LGA collation centres (2023 Cross River governorship) — Wikipedia reporting official returns, 20 March 2023',
  candidates: [
    { name: 'Bassey Otu', party: 'APC', votes: 258619 },
    { name: 'Sandy Onor', party: 'PDP', votes: 179636 },
  ],
  lgaRows: crRows,
}));
write('cross-river-2026-lga.json', dupYear('cross-river-2022-lga.json', '2026'));

console.log('done');
