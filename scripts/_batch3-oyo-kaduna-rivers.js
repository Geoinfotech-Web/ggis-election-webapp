#!/usr/bin/env node
/** One-shot writer for Oyo / Kaduna / Rivers 2023 official LGA tables. */
const fs = require('fs');
const path = require('path');
const { buildGovernorshipDataset } = require('./lib/build-gov-dataset');

const OUT = path.join(__dirname, '..', 'data', 'election-results', 'official');

function write(file, payload) {
  const outPath = path.join(OUT, file);
  fs.writeFileSync(outPath, JSON.stringify(payload, null, 2));
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

write('oyo-2022-lga.json', buildGovernorshipDataset({
  state: 'Oyo',
  year: '2022',
  updated: '2023-03-19',
  sourceDetail: 'INEC LGA collation centres (2023 Oyo governorship) — BusinessDay reporting official returns, 19 March 2023',
  candidates: [
    { name: 'Seyi Makinde', party: 'PDP', votes: 563756 },
    { name: 'Teslim Folarin', party: 'APC', votes: 256685 },
    { name: 'Adebayo Adelabu', party: 'Accord', votes: 38357 },
  ],
  lgaRows: [
    { lga: 'Ona-Ara', votes: { Accord: 1212, APC: 5510, PDP: 17326 } },
    { lga: 'Ibadan North West', votes: { Accord: 1291, APC: 5947, PDP: 19007 } },
    { lga: 'Ibarapa East', votes: { Accord: 1885, APC: 7094, PDP: 11125 } },
    { lga: 'Afijio', votes: { Accord: 1357, APC: 5588, PDP: 13139 } },
    { lga: 'Atiba', votes: { Accord: 1113, APC: 7484, PDP: 18389 } },
    { lga: 'Ori Ire', votes: { Accord: 1895, APC: 9216, PDP: 13767 } },
    { lga: 'Ibadan South West', votes: { Accord: 2270, APC: 9491, PDP: 31273 } },
    { lga: 'Oluyole', votes: { Accord: 1386, APC: 6592, PDP: 21700 } },
    { lga: 'Atisbo', votes: { Accord: 1188, APC: 6955, PDP: 9199 } },
    { lga: 'Saki East', votes: { Accord: 188, APC: 5519, PDP: 8374 } },
    { lga: 'Surulere', votes: { Accord: 271, APC: 8882, PDP: 15554 } },
    { lga: 'Itesiwaju', votes: { Accord: 2036, APC: 4597, PDP: 8034 } },
    { lga: 'Ogo-Oluwa', votes: { Accord: 50, APC: 5570, PDP: 10930 } },
    { lga: 'Irepo', votes: { Accord: 388, APC: 9785, PDP: 7193 } },
    { lga: 'Olorunsogo', votes: { Accord: 998, APC: 4851, PDP: 5838 } },
    { lga: 'Ibadan North East', votes: { Accord: 1564, APC: 8486, PDP: 29396 } },
    { lga: 'Ogbomoso South', votes: { Accord: 10, APC: 8257, PDP: 17693 } },
    { lga: 'Ibadan South-East', votes: { Accord: 1846, APC: 9147, PDP: 23585 } },
    { lga: 'Ibarapa North', votes: { Accord: 563, APC: 5678, PDP: 10845 } },
    { lga: 'Ibarapa Central', votes: { Accord: 1455, APC: 6287, PDP: 10491 } },
    { lga: 'Oyo West', votes: { Accord: 431, APC: 7599, PDP: 15084 } },
    { lga: 'Oyo East', votes: { Accord: 571, APC: 6999, PDP: 15751 } },
    { lga: 'Ogbomoso North', votes: { Accord: 562, APC: 10661, PDP: 20387 } },
    { lga: 'Ido', votes: { Accord: 822, APC: 7865, PDP: 19284 } },
    { lga: 'Kajola', votes: { Accord: 1710, APC: 9523, PDP: 13562 } },
    { lga: 'Lagelu', votes: { Accord: 886, APC: 7432, PDP: 19104 } },
    { lga: 'Ibadan North', votes: { Accord: 2120, APC: 11883, PDP: 39658 } },
    { lga: 'Iseyin', votes: { Accord: 501, APC: 9694, PDP: 25740 } },
    { lga: 'Egbeda', votes: { Accord: 3072, APC: 7377, PDP: 30444 } },
    { lga: 'Saki West', votes: { Accord: 607, APC: 13753, PDP: 17452 } },
    { lga: 'Oorelope', votes: { Accord: 1602, APC: 7077, PDP: 6485 } },
    { lga: 'Iwajowa', votes: { Accord: 269, APC: 6441, PDP: 9029 } },
    { lga: 'Akinyele', votes: { Accord: 1287, APC: 9445, PDP: 28920 } },
  ],
}));
write('oyo-2026-lga.json', dupYear('oyo-2022-lga.json', '2026'));

write('kaduna-2022-lga.json', buildGovernorshipDataset({
  state: 'Kaduna',
  year: '2022',
  updated: '2023-03-20',
  sourceDetail: 'INEC LGA collation centres (2023 Kaduna governorship) — Blueprint Newspapers reporting official returns, 20 March 2023',
  candidates: [
    { name: 'Uba Sani', party: 'APC', votes: 730002 },
    { name: 'Isa Ashiru', party: 'PDP', votes: 719196 },
    { name: 'Jonathan Asake', party: 'LP', votes: 58283 },
  ],
  lgaRows: [
    { lga: 'Kaura', votes: { APC: 7748, LP: 12950, PDP: 15108 } },
    { lga: 'Giwa', votes: { APC: 30773, LP: 221, PDP: 28869 } },
    { lga: 'Sanga', votes: { APC: 12338, LP: 2135, PDP: 13119 } },
    { lga: 'Kajuru', votes: { APC: 8271, LP: 1773, PDP: 23125 } },
    { lga: 'Jaba', votes: { APC: 7564, LP: 2871, PDP: 14616 } },
    { lga: 'Makarfi', votes: { APC: 25670, LP: 278, PDP: 26128 } },
    { lga: 'Ikara', votes: { APC: 29066, LP: 692, PDP: 28612 } },
    { lga: "Jema'a", votes: { APC: 19920, LP: 6017, PDP: 28963 } },
    { lga: 'Zangon Kataf', votes: { APC: 11448, LP: 7377, PDP: 33185 } },
    { lga: 'Kauru', votes: { APC: 26915, LP: 3461, PDP: 26342 } },
    { lga: 'Soba', votes: { APC: 27235, LP: 457, PDP: 30874 } },
    { lga: 'Sabon Gari', votes: { APC: 44406, LP: 972, PDP: 33253 } },
    { lga: 'Kubau', votes: { APC: 39855, LP: 604, PDP: 36499 } },
    { lga: 'Zaria', votes: { APC: 78659, LP: 672, PDP: 47091 } },
    { lga: 'Kaduna South', votes: { APC: 69170, LP: 2292, PDP: 42604 } },
    { lga: 'Kaduna North', votes: { APC: 65782, LP: 1042, PDP: 33120 } },
    { lga: 'Chikun', votes: { APC: 19979, LP: 4770, PDP: 89946 } },
    { lga: 'Igabi', votes: { APC: 74974, LP: 1198, PDP: 40681 } },
    { lga: 'Kagarko', votes: { APC: 18830, LP: 1530, PDP: 19991 } },
    { lga: 'Birnin Gwari', votes: { APC: 20627, LP: 37, PDP: 19954 } },
    { lga: 'Kachia', votes: { APC: 23849, LP: 1726, PDP: 27491 } },
    { lga: 'Lere', votes: { APC: 45823, LP: 4321, PDP: 46363 } },
    { lga: 'Kudan', votes: { APC: 21076, LP: 887, PDP: 23272 } },
  ],
}));
write('kaduna-2026-lga.json', dupYear('kaduna-2022-lga.json', '2026'));

write('rivers-2022-lga.json', buildGovernorshipDataset({
  state: 'Rivers',
  year: '2022',
  updated: '2023-03-20',
  sourceDetail: 'INEC LGA collation centres (2023 Rivers governorship) — Vanguard / Wikipedia reporting official returns, 20 March 2023',
  candidates: [
    { name: 'Siminalayi Fubara', party: 'PDP', votes: 302614 },
    { name: 'Tonye Cole', party: 'APC', votes: 95274 },
    { name: 'Magnus Abe', party: 'SDP', votes: 46981 },
    { name: 'Beatrice Itubo', party: 'LP', votes: 22224 },
  ],
  lgaRows: [
    { lga: 'Tai', votes: { APC: 295, LP: 13, PDP: 9276, SDP: 508 } },
    { lga: 'Opobo/Nekoro', votes: { APC: 1426, LP: 10, PDP: 11538, SDP: 159 } },
    { lga: 'Gokana', votes: { APC: 7410, LP: 97, PDP: 17455, SDP: 13840 } },
    { lga: 'Ogu/Bolo', votes: { APC: 1524, LP: 34, PDP: 7103, SDP: 310 } },
    { lga: 'Eleme', votes: { APC: 2662, LP: 544, PDP: 8414, SDP: 2251 } },
    { lga: 'Ikwerre', votes: { APC: 7503, LP: 895, PDP: 13716, SDP: 1447 } },
    { lga: 'Oyigbo', votes: { APC: 2793, LP: 2688, PDP: 9886, SDP: 796 } },
    { lga: 'Etche', votes: { APC: 6408, LP: 552, PDP: 16043, SDP: 2586 } },
    { lga: 'Khana', votes: { APC: 620, LP: 57, PDP: 9475, SDP: 5846 } },
    { lga: 'Bonny', votes: { APC: 3285, LP: 1292, PDP: 8032, SDP: 559 } },
    { lga: 'Ahoada East', votes: { APC: 2650, LP: 219, PDP: 14408, SDP: 2077 } },
    { lga: 'Omuma', votes: { APC: 2127, LP: 52, PDP: 8760, SDP: 804 } },
    { lga: 'Okrika', votes: { APC: 2719, LP: 231, PDP: 10342, SDP: 822 } },
    { lga: 'Andoni', votes: { APC: 3149, LP: 84, PDP: 8319, SDP: 1185 } },
    { lga: 'Abua-Odual', votes: { APC: 5738, LP: 391, PDP: 9763, SDP: 463 } },
    { lga: 'Emohua', votes: { APC: 5916, LP: 505, PDP: 20600, SDP: 805 } },
    { lga: 'Ogba/Egbema/Ndoni', votes: { APC: 6811, LP: 1267, PDP: 17729, SDP: 3450 } },
    { lga: 'Obio/Akpor', votes: { APC: 7361, LP: 8262, PDP: 45065, SDP: 3056 } },
    { lga: 'Port Harcourt', votes: { APC: 8954, LP: 4660, PDP: 26892, SDP: 3974 } },
    { lga: 'Degema', votes: { APC: 3107, LP: 102, PDP: 4437, SDP: 579 } },
    { lga: 'Akuku Toru', votes: { APC: 3724, LP: 61, PDP: 6273, SDP: 222 } },
    { lga: 'Asari-Toru', votes: { APC: 4209, LP: 40, PDP: 12663, SDP: 179 } },
    { lga: 'Ahoada West', votes: { APC: 4883, LP: 168, PDP: 6425, SDP: 1063 } },
  ],
}));
write('rivers-2026-lga.json', dupYear('rivers-2022-lga.json', '2026'));

console.log('done');
