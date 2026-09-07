#!/usr/bin/env node
/** Validate + write Abia / Plateau / Enugu 2023 official LGA tables. */
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

const abiaRows = [
  { lga: 'Ukwa East', votes: { APC: 560, APGA: 646, LP: 2273, PDP: 2329, YPP: 759 } },
  { lga: 'Umunneochi', votes: { APC: 2034, APGA: 581, LP: 5940, PDP: 3198, YPP: 314 } },
  { lga: 'Ukwa West', votes: { APC: 1209, APGA: 830, LP: 2833, PDP: 4622, YPP: 890 } },
  { lga: 'Bende', votes: { APC: 2143, APGA: 847, LP: 9886, PDP: 3410, YPP: 1667 } },
  { lga: 'Isiala Ngwa North', votes: { APC: 838, APGA: 225, LP: 7323, PDP: 21741, YPP: 1094 } },
  { lga: 'Isiala Ngwa South', votes: { APC: 1580, APGA: 366, LP: 7589, PDP: 9093, YPP: 1691 } },
  { lga: 'Arochukwu', votes: { APC: 1082, APGA: 460, LP: 12689, PDP: 1280, YPP: 410 } },
  { lga: 'Ugwunagbo', votes: { APC: 375, APGA: 398, LP: 2159, PDP: 2538, YPP: 1805 } },
  { lga: 'Isuikwuato', votes: { APC: 872, APGA: 3662, LP: 8228, PDP: 2204, YPP: 269 } },
  { lga: 'Ikwuano', votes: { APC: 1198, APGA: 499, LP: 7054, PDP: 2427, YPP: 276 } },
  { lga: 'Umuahia South', votes: { APC: 1398, APGA: 1841, LP: 16187, PDP: 4564, YPP: 323 } },
  { lga: 'Ohafia', votes: { APC: 1354, APGA: 945, LP: 11848, PDP: 4128, YPP: 667 } },
  { lga: 'Osisioma', votes: { APC: 504, APGA: 292, LP: 7032, PDP: 4696, YPP: 8839 } },
  { lga: 'Aba North', votes: { APC: 487, APGA: 1404, LP: 20974, PDP: 4146, YPP: 2296 } },
  { lga: 'Aba South', votes: { APC: 511, APGA: 1762, LP: 22014, PDP: 3348, YPP: 1572 } },
  { lga: 'Umuahia North', votes: { APC: 7225, APGA: 1816, LP: 27668, PDP: 4843, YPP: 2999 } },
  { lga: 'Obingwa', votes: { APC: 721, APGA: 1445, LP: 3776, PDP: 9962, YPP: 3101 } },
];
console.log('abia sums', {
  LP: sumParty(abiaRows, 'LP'),
  PDP: sumParty(abiaRows, 'PDP'),
  YPP: sumParty(abiaRows, 'YPP'),
}, 'official LP175467 PDP88529 YPP28972');

write('abia-2022-lga.json', buildGovernorshipDataset({
  state: 'Abia',
  year: '2022',
  updated: '2023-03-22',
  sourceDetail: 'INEC LGA collation centres (2023 Abia governorship) — Channels TV / BBC reporting official returns, 22 March 2023',
  candidates: [
    { name: 'Alex Otti', party: 'LP', votes: 175467 },
    { name: 'Okey Ahiwe', party: 'PDP', votes: 88529 },
    { name: 'Enyinnaya Nwafor', party: 'YPP', votes: 28972 },
  ],
  lgaRows: abiaRows,
}));
write('abia-2026-lga.json', dupYear('abia-2022-lga.json', '2026'));

const plateauRows = [
  { lga: 'Jos East', votes: { APC: 11852, LP: 1347, PDP: 9290 } },
  { lga: 'Barikin Ladi', votes: { APC: 18568, LP: 4118, PDP: 32119 } },
  { lga: 'Bassa', votes: { APC: 25788, LP: 2581, PDP: 29135 } },
  { lga: 'Langtang South', votes: { APC: 12437, LP: 846, PDP: 16104 } },
  { lga: 'Kanke', votes: { APC: 35436, LP: 633, PDP: 6870 } },
  { lga: 'Langtang North', votes: { APC: 20756, LP: 6575, PDP: 27826 } },
  { lga: 'Mikang', votes: { APC: 10691, LP: 672, PDP: 12027 } },
  { lga: 'Pankshin', votes: { APC: 28827, LP: 7949, PDP: 15957 } },
  { lga: 'Shendam', votes: { APC: 30815, LP: 5169, PDP: 17733 } },
  { lga: 'Riyom', votes: { APC: 12657, LP: 1878, PDP: 18647 } },
  { lga: 'Wase', votes: { APC: 35011, LP: 269, PDP: 26557 } },
  { lga: 'Kanam', votes: { APC: 48710, LP: 1171, PDP: 28706 } },
  { lga: 'Mangu', votes: { APC: 25570, LP: 1621, PDP: 77279 } },
  { lga: 'Bokkos', votes: { APC: 20779, LP: 5876, PDP: 26529 } },
  { lga: 'Jos South', votes: { APC: 35403, LP: 10865, PDP: 84103 } },
  { lga: 'Jos North', votes: { APC: 83170, LP: 6915, PDP: 64690 } },
  { lga: "Qua'an Pan", votes: { APC: 24900, LP: 1825, PDP: 31727 } },
];
console.log('plateau sums', {
  APC: sumParty(plateauRows, 'APC'),
  LP: sumParty(plateauRows, 'LP'),
  PDP: sumParty(plateauRows, 'PDP'),
}, 'official APC481370 LP60310 PDP525299');

write('plateau-2022-lga.json', buildGovernorshipDataset({
  state: 'Plateau',
  year: '2022',
  updated: '2023-03-20',
  sourceDetail: 'INEC LGA collation centres (2023 Plateau governorship) — Punch / New Telegraph reporting official returns, 20 March 2023',
  candidates: [
    { name: 'Caleb Mutfwang', party: 'PDP', votes: 525299 },
    { name: 'Nentawe Yilwatda', party: 'APC', votes: 481370 },
    { name: 'Patrick Dakum', party: 'LP', votes: 60310 },
  ],
  lgaRows: plateauRows,
}));
write('plateau-2026-lga.json', dupYear('plateau-2022-lga.json', '2026'));

const enuguRows = [
  { lga: 'Aninri', votes: { APC: 902, APGA: 498, LP: 3431, PDP: 6520 } },
  { lga: 'Awgu', votes: { APC: 1175, APGA: 805, LP: 5462, PDP: 10668 } },
  { lga: 'Enugu East', votes: { APC: 622, APGA: 2779, LP: 12405, PDP: 12803 } },
  { lga: 'Enugu North', votes: { APC: 563, APGA: 3108, LP: 9610, PDP: 9333 } },
  { lga: 'Enugu South', votes: { APC: 560, APGA: 3110, LP: 7438, PDP: 10557 } },
  { lga: 'Ezeagu', votes: { APC: 963, APGA: 300, LP: 5949, PDP: 7576 } },
  { lga: 'Igbo Etiti', votes: { APC: 939, APGA: 1259, LP: 11941, PDP: 8959 } },
  { lga: 'Igbo Eze North', votes: { APC: 541, APGA: 250, LP: 9955, PDP: 8738 } },
  { lga: 'Igbo Eze South', votes: { APC: 927, APGA: 246, LP: 9680, PDP: 4691 } },
  { lga: 'Isi Uzo', votes: { APC: 231, APGA: 42, LP: 12518, PDP: 6381 } },
  // Final declared Nkanu East after INEC review (Punch); pre-review PDP was 30,350
  { lga: 'Nkanu East', votes: { APC: 448, APGA: 188, LP: 1864, PDP: 16956 } },
  { lga: 'Nkanu West', votes: { APC: 1676, APGA: 1609, LP: 2577, PDP: 8382 } },
  { lga: 'Nsukka', votes: { APC: 1017, APGA: 1309, LP: 30294, PDP: 10886 } },
  { lga: 'Oji-River', votes: { APC: 1060, APGA: 246, LP: 7747, PDP: 7365 } },
  { lga: 'Udenu', votes: { APC: 513, APGA: 412, LP: 11315, PDP: 10148 } },
  { lga: 'Udi', votes: { APC: 1648, APGA: 1724, LP: 10109, PDP: 13633 } },
  { lga: 'Uzo-Uwani', votes: { APC: 1019, APGA: 169, LP: 5257, PDP: 7298 } },
];
console.log('enugu sums', {
  APC: sumParty(enuguRows, 'APC'),
  APGA: sumParty(enuguRows, 'APGA'),
  LP: sumParty(enuguRows, 'LP'),
  PDP: sumParty(enuguRows, 'PDP'),
}, 'official APC14575 APGA17983 LP157552 PDP160895');

write('enugu-2022-lga.json', buildGovernorshipDataset({
  state: 'Enugu',
  year: '2022',
  updated: '2023-03-22',
  sourceDetail: 'INEC LGA collation centres (2023 Enugu governorship) — Wikipedia / Punch reporting official returns, 22 March 2023',
  candidates: [
    { name: 'Peter Mbah', party: 'PDP', votes: 160895 },
    { name: 'Chijioke Edeoga', party: 'LP', votes: 157552 },
    { name: 'Frank Nweke', party: 'APGA', votes: 17983 },
    { name: 'Uche Nnaji', party: 'APC', votes: 14575 },
  ],
  lgaRows: enuguRows,
}));
write('enugu-2026-lga.json', dupYear('enugu-2022-lga.json', '2026'));

// coverage check
for (const [slug, n] of [['abia', 17], ['plateau', 17], ['enugu', 17]]) {
  const d = require(path.join(OUT, `${slug}-2022-lga.json`));
  const est = require(path.join(__dirname, '..', 'data', 'election-results', 'gubernatorial', `${slug}-2022.json`));
  const miss = Object.keys(est.units).filter((k) => !d.units[k]);
  const extra = Object.keys(d.units).filter((k) => !est.units[k]);
  console.log(slug, 'lgas', Object.keys(d.units).length, 'expect', n, 'miss', miss, 'extra', extra);
}

console.log('done');
