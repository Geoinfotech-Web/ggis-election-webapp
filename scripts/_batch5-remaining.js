#!/usr/bin/env node
/**
 * Batch 5: remaining 2023 official LGA imports.
 * Sources: Wikipedia (Bauchi/Kwara/Zamfara/Gombe), news LGA tables (others).
 */
const fs = require('fs');
const path = require('path');
const { buildGovernorshipDataset } = require('./lib/build-gov-dataset');
const { matchKey } = require('../lga-normalize');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'data', 'election-results', 'official');
const GOV = path.join(ROOT, 'data', 'election-results', 'gubernatorial');
const WIKI = path.join(__dirname, '_wiki_raw');

function write(file, payload) {
  fs.writeFileSync(path.join(OUT, file), JSON.stringify(payload, null, 2));
  console.log('wrote', file, Object.keys(payload.units).length, payload.winner.party, payload.winner.name);
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

function renameRows(rows, map) {
  return rows.map((r) => ({
    lga: map[r.lga] || map[matchKey(r.lga)] || r.lga,
    votes: r.votes,
  }));
}

function coverage(slug, rows) {
  const est = require(path.join(GOV, `${slug}-2022.json`));
  const keys = new Set(rows.map((r) => matchKey(r.lga)));
  const miss = Object.keys(est.units).filter((k) => !keys.has(matchKey(k)));
  const extra = rows.map((r) => r.lga).filter((k) => !Object.keys(est.units).some((e) => matchKey(e) === matchKey(k)));
  console.log(slug, 'rows', rows.length, 'expect', Object.keys(est.units).length, 'miss', miss, 'extra', extra);
  return miss.length === 0;
}

function emit(opts) {
  const ok = coverage(opts.slug, opts.lgaRows);
  if (!ok && !opts.allowMiss) {
    console.warn('SKIP incomplete', opts.slug);
    return;
  }
  write(`${opts.slug}-2022-lga.json`, buildGovernorshipDataset({
    state: opts.state,
    year: '2022',
    updated: opts.updated,
    sourceDetail: opts.sourceDetail,
    candidates: opts.candidates,
    lgaRows: opts.lgaRows,
  }));
  write(`${opts.slug}-2026-lga.json`, dupYear(`${opts.slug}-2022-lga.json`, '2026'));
}

// --- Bauchi (Wikipedia)
{
  const wiki = JSON.parse(fs.readFileSync(path.join(WIKI, 'Bauchi-lga.json'), 'utf8'));
  emit({
    slug: 'bauchi',
    state: 'Bauchi',
    updated: '2023-03-20',
    sourceDetail: 'INEC LGA collation centres (2023 Bauchi governorship) — Wikipedia reporting official returns, 20 March 2023',
    candidates: [
      { name: 'Bala Mohammed', party: 'PDP', votes: 525280 },
      { name: 'Sadique Abubakar', party: 'APC', votes: 432272 },
      { name: 'Halliru Dauda Jika', party: 'NNPP', votes: 60484 },
    ],
    lgaRows: renameRows(wiki.lgaRows, { Damban: 'Dambam', Jamaare: "Jama'are" }),
  });
}

// --- Kwara (Wikipedia)
{
  const wiki = JSON.parse(fs.readFileSync(path.join(WIKI, 'Kwara-lga.json'), 'utf8'));
  emit({
    slug: 'kwara',
    state: 'Kwara',
    updated: '2023-03-20',
    sourceDetail: 'INEC LGA collation centres (2023 Kwara governorship) — Wikipedia reporting official returns, 20 March 2023',
    candidates: [
      { name: 'Abdulrahman Abdulrazaq', party: 'APC', votes: 273420 },
      { name: 'Shuaib Yaman Abdullahi', party: 'PDP', votes: 155490 },
      { name: 'Hakeem Lawal', party: 'SDP', votes: 19269 },
    ],
    lgaRows: renameRows(wiki.lgaRows, {
      Patigi: 'Patigi',
      Pategi: 'Patigi',
      'Ilorin East': 'Ilorin East',
      'Ilorin South': 'Ilorin-South',
      'Ilorin West': 'Ilorin-West',
      'Oke Ero': 'Okeero',
      'Oke-Ero': 'Okeero',
    }),
  });
}

// --- Zamfara (Wikipedia)
{
  const wiki = JSON.parse(fs.readFileSync(path.join(WIKI, 'Zamfara-lga.json'), 'utf8'));
  emit({
    slug: 'zamfara',
    state: 'Zamfara',
    updated: '2023-03-20',
    sourceDetail: 'INEC LGA collation centres (2023 Zamfara governorship) — Wikipedia reporting official returns, 20 March 2023',
    candidates: [
      { name: 'Dauda Lawal', party: 'PDP', votes: 377726 },
      { name: 'Bello Matawalle', party: 'APC', votes: 311976 },
    ],
    lgaRows: renameRows(wiki.lgaRows, {
      'Birnin Magaji/Kiyaw': 'Birnin Magaji',
    }),
  });
}

// --- Gombe (Wikipedia / Punch / Nation)
emit({
  slug: 'gombe',
  state: 'Gombe',
  updated: '2023-03-19',
  sourceDetail: 'INEC LGA collation centres (2023 Gombe governorship) — Wikipedia / Punch / The Nation reporting official returns, 19 March 2023',
  candidates: [
    { name: 'Muhammad Inuwa Yahaya', party: 'APC', votes: 342821 },
    { name: 'Mohammed Jibrin', party: 'PDP', votes: 233131 },
    { name: 'Khamisu Mailantarki', party: 'NNPP', votes: 19861 },
  ],
  lgaRows: [
    { lga: 'Akko', votes: { APC: 50919, PDP: 36759, NNPP: 2953 } },
    { lga: 'Balanga', votes: { APC: 25341, PDP: 20085, NNPP: 1130 } },
    { lga: 'Billiri', votes: { APC: 14752, PDP: 23066, NNPP: 3421 } },
    { lga: 'Dukku', votes: { APC: 35207, PDP: 14181, NNPP: 1079 } },
    { lga: 'Funakaye', votes: { APC: 30371, PDP: 17332, NNPP: 606 } },
    { lga: 'Gombe', votes: { APC: 58645, PDP: 31605, NNPP: 4878 } },
    { lga: 'Kaltungo', votes: { APC: 21015, PDP: 21321, NNPP: 1129 } },
    { lga: 'Kwami', votes: { APC: 33956, PDP: 17454, NNPP: 1087 } },
    { lga: 'Nafada', votes: { APC: 15025, PDP: 9378, NNPP: 411 } },
    { lga: 'Shongom', votes: { APC: 13609, PDP: 13412, NNPP: 847 } },
    { lga: 'Yalmaltu/ Deba', votes: { APC: 43981, PDP: 28538, NNPP: 2320 } },
  ],
});

// --- Jigawa
emit({
  slug: 'jigawa',
  state: 'Jigawa',
  updated: '2023-03-19',
  sourceDetail: 'INEC LGA collation centres (2023 Jigawa governorship) — TheNiche reporting official returns, 19 March 2023',
  candidates: [
    { name: 'Umar Namadi', party: 'APC', votes: 618449 },
    { name: 'Mustapha Sule Lamido', party: 'PDP', votes: 368726 },
    { name: 'Aminu Ibrahim', party: 'NNPP', votes: 37156 },
  ],
  lgaRows: renameRows([
    { lga: 'Garki', votes: { APC: 26031, NNPP: 3199, PDP: 12449 } },
    { lga: 'Miga', votes: { APC: 18537, NNPP: 705, PDP: 11520 } },
    { lga: 'Buji', votes: { APC: 15941, NNPP: 316, PDP: 11447 } },
    { lga: 'Kazaure', votes: { APC: 13650, NNPP: 559, PDP: 10138 } },
    { lga: 'Auyo', votes: { APC: 25115, NNPP: 1400, PDP: 10424 } },
    { lga: 'Babura', votes: { APC: 28041, NNPP: 2567, PDP: 13172 } },
    { lga: 'Roni', votes: { APC: 15697, NNPP: 258, PDP: 7419 } },
    { lga: 'Gagarawa', votes: { APC: 12752, NNPP: 1405, PDP: 8704 } },
    { lga: 'Maigatari', votes: { APC: 19321, NNPP: 481, PDP: 13161 } },
    { lga: 'Malam Madori', votes: { APC: 20538, NNPP: 914, PDP: 10692 } },
    { lga: 'Yankwashi', votes: { APC: 8473, NNPP: 294, PDP: 5069 } },
    { lga: 'Taura', votes: { APC: 25991, NNPP: 1569, PDP: 11753 } },
    { lga: 'Birnin Kudu', votes: { APC: 33027, NNPP: 677, PDP: 35517 } },
    { lga: 'Birniwa', votes: { APC: 21341, NNPP: 1199, PDP: 12149 } },
    { lga: 'Kiyawa', votes: { APC: 25397, NNPP: 486, PDP: 16363 } },
    { lga: 'Kaugama', votes: { APC: 23557, NNPP: 2165, PDP: 13658 } },
    { lga: 'Hadejia', votes: { APC: 28381, NNPP: 2001, PDP: 4304 } },
    { lga: 'Gumel', votes: { APC: 12921, NNPP: 137, PDP: 9132 } },
    { lga: 'Gwiwa', votes: { APC: 17526, NNPP: 368, PDP: 6959 } },
    { lga: 'Guri', votes: { APC: 17384, NNPP: 2267, PDP: 6829 } },
    { lga: 'Jahun', votes: { APC: 31376, NNPP: 1127, PDP: 21106 } },
    { lga: 'Sule Tankarkar', votes: { APC: 22819, NNPP: 1305, PDP: 14512 } },
    { lga: 'Kafin Hausa', votes: { APC: 35458, NNPP: 755, PDP: 17049 } },
    { lga: 'Kirikasamma', votes: { APC: 22255, NNPP: 1462, PDP: 10586 } },
    { lga: 'Dutse', votes: { APC: 30051, NNPP: 674, PDP: 28464 } },
    { lga: 'Ringim', votes: { APC: 32475, NNPP: 7809, PDP: 12318 } },
    { lga: 'Gwaram', votes: { APC: 34394, NNPP: 1057, PDP: 33832 } },
  ], {
    Kirikasamma: 'Kirika Samma',
    'Sule Tankarkar': 'Sule-Tankarkar',
  }),
});

// --- Sokoto
emit({
  slug: 'sokoto',
  state: 'Sokoto',
  updated: '2023-03-19',
  sourceDetail: 'INEC LGA collation centres (2023 Sokoto governorship) — Daily Trust reporting official returns, 19 March 2023',
  candidates: [
    { name: 'Ahmed Aliyu', party: 'APC', votes: 453661 },
    { name: 'Saidu Umar', party: 'PDP', votes: 404632 },
  ],
  lgaRows: renameRows([
    { lga: 'Binji', votes: { APC: 13410, PDP: 11078 } },
    { lga: 'Wurno', votes: { APC: 17350, PDP: 13099 } },
    { lga: 'Yabo', votes: { APC: 14729, PDP: 12014 } },
    { lga: 'Isa', votes: { APC: 13632, PDP: 15117 } },
    { lga: 'Gwadabawa', votes: { APC: 19036, PDP: 16652 } },
    { lga: 'Rabah', votes: { APC: 12759, PDP: 11120 } },
    { lga: 'Tureta', votes: { APC: 9831, PDP: 10045 } },
    { lga: 'Bodinga', votes: { APC: 18986, PDP: 16440 } },
    { lga: 'Tangaza', votes: { APC: 16254, PDP: 9705 } },
    { lga: 'Kware', votes: { APC: 18644, PDP: 18161 } },
    { lga: 'Silame', votes: { APC: 9983, PDP: 10885 } },
    { lga: 'Dange/Shuni', votes: { APC: 22690, PDP: 18506 } },
    { lga: 'Sabon Birni', votes: { APC: 26884, PDP: 20680 } },
    { lga: 'Shagari', votes: { APC: 14264, PDP: 13893 } },
    { lga: 'Illela', votes: { APC: 23484, PDP: 19169 } },
    { lga: 'Gudu', votes: { APC: 12118, PDP: 10718 } },
    { lga: 'Gada', votes: { APC: 19969, PDP: 18434 } },
    { lga: 'Goronyo', votes: { APC: 16567, PDP: 17323 } },
    { lga: 'Kebbe', votes: { APC: 14902, PDP: 14619 } },
    { lga: 'Sokoto South', votes: { APC: 37114, PDP: 33363 } },
    { lga: 'Wamakko', votes: { APC: 36233, PDP: 27642 } },
    { lga: 'Sokoto North', votes: { APC: 35333, PDP: 33190 } },
    { lga: 'Tambuwal', votes: { APC: 29489, PDP: 32779 } },
  ], { 'Sabon Birni': 'S/Birni' }),
});

// --- Niger
emit({
  slug: 'niger',
  state: 'Niger',
  updated: '2023-03-20',
  sourceDetail: 'INEC LGA collation centres (2023 Niger governorship) — Voice of Nigeria / Punch reporting official returns, 20 March 2023',
  candidates: [
    { name: 'Mohammed Umar Bago', party: 'APC', votes: 469896 },
    { name: 'Isah Liman Kantigi', party: 'PDP', votes: 387476 },
  ],
  lgaRows: renameRows([
    { lga: 'Tafa', votes: { APC: 12520, PDP: 12082 } },
    { lga: 'Gurara', votes: { APC: 14520, PDP: 11506 } },
    { lga: 'Paikoro', votes: { APC: 21855, PDP: 15780 } },
    { lga: 'Munya', votes: { APC: 8644, PDP: 10208 } },
    { lga: 'Bosso', votes: { APC: 24794, PDP: 20251 } },
    { lga: 'Suleja', votes: { APC: 18261, PDP: 15551 } },
    { lga: 'Katcha', votes: { APC: 17037, PDP: 16495 } },
    { lga: 'Edati', votes: { APC: 9225, PDP: 16559 } },
    { lga: 'Bida', votes: { APC: 27778, PDP: 22846 } },
    { lga: 'Chanchaga', votes: { APC: 34231, PDP: 27989 } },
    { lga: 'Lapai', votes: { APC: 21795, PDP: 18041 } },
    { lga: 'Rafi', votes: { APC: 17843, PDP: 16007 } },
    { lga: 'Magama', votes: { APC: 17107, PDP: 13482 } },
    { lga: 'Agaie', votes: { APC: 20911, PDP: 19470 } },
    { lga: 'Lavun', votes: { APC: 18058, PDP: 20922 } },
    { lga: 'Gbako', votes: { APC: 16423, PDP: 18043 } },
    { lga: 'Kontagora', votes: { APC: 28050, PDP: 14329 } },
    { lga: 'Wushishi', votes: { APC: 15089, PDP: 9187 } },
    { lga: 'Agwara', votes: { APC: 8872, PDP: 7987 } },
    { lga: 'Mokwa', votes: { APC: 17978, PDP: 22063 } },
    { lga: 'Borgu', votes: { APC: 24122, PDP: 7714 } },
    { lga: 'Mariga', votes: { APC: 19188, PDP: 11714 } },
    { lga: 'Mashegu', votes: { APC: 14958, PDP: 11961 } },
    { lga: 'Shiroro', votes: { APC: 27714, PDP: 15826 } },
    { lga: 'Rijau', votes: { APC: 12925, PDP: 11463 } },
  ], { Edati: 'Edatti' }),
});

// --- Nasarawa
emit({
  slug: 'nasarawa',
  state: 'Nasarawa',
  updated: '2023-03-20',
  sourceDetail: 'INEC LGA collation centres (2023 Nasarawa governorship) — Universal Reporters / THISDAY reporting official returns, 20 March 2023',
  candidates: [
    { name: 'Abdullahi Sule', party: 'APC', votes: 347209 },
    { name: 'David Ombugadu', party: 'PDP', votes: 283016 },
  ],
  lgaRows: [
    { lga: 'Awe', votes: { APC: 26966, PDP: 8025 } },
    { lga: 'Akwanga', votes: { APC: 15873, PDP: 23787 } },
    { lga: 'Doma', votes: { APC: 15587, PDP: 19737 } },
    { lga: 'Karu', votes: { APC: 28322, PDP: 46564 } },
    { lga: 'Keana', votes: { APC: 9598, PDP: 7173 } },
    { lga: 'Keffi', votes: { APC: 27737, PDP: 11995 } },
    { lga: 'Kokona', votes: { APC: 18182, PDP: 19045 } },
    { lga: 'Lafia', votes: { APC: 107213, PDP: 41594 } },
    { lga: 'Nasarawa', votes: { APC: 27992, PDP: 19079 } },
    { lga: 'Nasarawa Eggon', votes: { APC: 16692, PDP: 36825 } },
    { lga: 'Obi', votes: { APC: 25126, PDP: 29467 } },
    { lga: 'Toto', votes: { APC: 15787, PDP: 11636 } },
    { lga: 'Wamba', votes: { APC: 12124, PDP: 8089 } },
  ],
});

// --- Akwa Ibom
emit({
  slug: 'akwa-ibom',
  state: 'Akwa Ibom',
  updated: '2023-03-19',
  sourceDetail: 'INEC LGA collation centres (2023 Akwa Ibom governorship) — Vanguard reporting official returns, 19 March 2023',
  candidates: [
    { name: 'Umo Eno', party: 'PDP', votes: 354348 },
    { name: 'Bassey Albert Akpan', party: 'YPP', votes: 136262 },
    { name: 'Akanimo Udofia', party: 'APC', votes: 129602 },
  ],
  lgaRows: renameRows([
    { lga: 'Nsit Ubium', votes: { APC: 1673, LP: 55, NNPP: 349, PDP: 19359, YPP: 1053 } },
    { lga: 'Okobo', votes: { APC: 3599, PDP: 7260, YPP: 3061 } },
    { lga: 'Nsit Ibom', votes: { APC: 7921, PDP: 11560, YPP: 897, NNPP: 166 } },
    { lga: 'Oron', votes: { APC: 3164, PDP: 6295, YPP: 1624 } },
    { lga: 'Ikono', votes: { APC: 1502, PDP: 11343, YPP: 13909 } },
    { lga: 'Uruan', votes: { APC: 5623, LP: 96, PDP: 12740, YPP: 3760 } },
    { lga: 'Ibeno', votes: { APC: 904, LP: 53, NNPP: 62, PDP: 5626, YPP: 1932 } },
    { lga: 'Eastern Obolo', votes: { APC: 622, PDP: 5180, YPP: 1538 } },
    { lga: 'Itu', votes: { APC: 2486, PDP: 10950, YPP: 932 } },
    { lga: 'Ikot Abasi', votes: { APC: 2360, PDP: 13559, YPP: 1943 } },
    { lga: 'Esit Eket', votes: { APC: 2488, PDP: 9549, YPP: 1765 } },
    { lga: 'Eket', votes: { APC: 4770, PDP: 20658, YPP: 4151 } },
    { lga: 'Etinan', votes: { APC: 4100, PDP: 15439, LP: 74, NNPP: 335, YPP: 3866 } },
    { lga: 'Ini', votes: { APC: 883, PDP: 10048, YPP: 6325 } },
    { lga: 'Udung Uko', votes: { APC: 2006, PDP: 3959, YPP: 1475 } },
    { lga: 'Ukanafun', votes: { APC: 5036, LP: 33, NNPP: 496, PDP: 11348, YPP: 2124 } },
    { lga: 'Etim Ekpo', votes: { APC: 4368, LP: 55, NNPP: 269, PDP: 7383, YPP: 2429 } },
    { lga: 'Mkpat Enin', votes: { APC: 3303, LP: 219, NNPP: 287, PDP: 14240, YPP: 2695 } },
    { lga: 'Nsit Atai', votes: { APC: 3418, LP: 16, PDP: 9938, YPP: 1818 } },
    { lga: 'Essien Udim', votes: { APC: 11833, LP: 90, NNPP: 916, PDP: 13754, YPP: 7601 } },
    { lga: 'Oruk Anam', votes: { APC: 6743, NNPP: 397, PDP: 16381, YPP: 3775 } },
    { lga: 'Onna', votes: { APC: 1733, LP: 48, NNPP: 81, PDP: 15910, YPP: 1782 } },
    { lga: 'Ibesikpo Asutan', votes: { APC: 7737, LP: 122, PDP: 15334, YPP: 2569 } },
    { lga: 'Urue-Offong/Oruko', votes: { APC: 3471, LP: 30, NNPP: 58, PDP: 5088, YPP: 2332 } },
    { lga: 'Abak', votes: { APC: 11249, LP: 436, NNPP: 342, PDP: 12847, YPP: 4954 } },
    { lga: 'Ikot Ekpene', votes: { APC: 6848, LP: 562, NNPP: 437, PDP: 14495, YPP: 5873 } },
    { lga: 'Obot Akara', votes: { APC: 4022, LP: 72, NNPP: 156, PDP: 10884, YPP: 2454 } },
    { lga: 'Mbo', votes: { APC: 4167, LP: 22, NNPP: 60, PDP: 6635, YPP: 1128 } },
    { lga: 'Ika', votes: { APC: 2908, LP: 7, NNPP: 160, PDP: 4361, YPP: 1301 } },
    { lga: 'Ibiono Ibom', votes: { APC: 398, LP: 29, NNPP: 454, PDP: 7066, YPP: 21992 } },
    { lga: 'Uyo', votes: { APC: 8267, LP: 1447, NNPP: 3229, PDP: 25149, YPP: 13810 } },
  ], { 'Urue-Offong/Oruko': 'Urue Offong/Oruko' }),
});

// --- Taraba
emit({
  slug: 'taraba',
  state: 'Taraba',
  updated: '2023-03-21',
  sourceDetail: 'INEC LGA collation centres (2023 Taraba governorship) — peer-reviewed INEC collation table / Stears statewide totals, 21 March 2023',
  candidates: [
    { name: 'Agbu Kefas', party: 'PDP', votes: 257823 },
    { name: 'Sani Yahaya', party: 'NNPP', votes: 202277 },
    { name: 'Emmanuel Bwacha', party: 'APC', votes: 143466 },
  ],
  lgaRows: renameRows([
    { lga: 'Ardo-Kola', votes: { PDP: 16034, APC: 2342, NNPP: 14089 } },
    { lga: 'Bali', votes: { PDP: 16126, APC: 7183, NNPP: 15330 } },
    { lga: 'Donga', votes: { PDP: 10470, APC: 22493, NNPP: 4135 } },
    { lga: 'Gashaka', votes: { PDP: 5809, APC: 4849, NNPP: 3226 } },
    { lga: 'Gassol', votes: { PDP: 10206, APC: 3430, NNPP: 42845 } },
    { lga: 'Ibi', votes: { PDP: 8334, APC: 2416, NNPP: 15564 } },
    { lga: 'Jalingo', votes: { PDP: 20769, APC: 5994, NNPP: 49424 } },
    { lga: 'Karim Lamido', votes: { PDP: 18140, APC: 6583, NNPP: 12323 } },
    { lga: 'Kurmi', votes: { PDP: 10579, APC: 8826, NNPP: 370 } },
    { lga: 'Lau', votes: { PDP: 13368, APC: 5079, NNPP: 10196 } },
    { lga: 'Sardauna', votes: { PDP: 18605, APC: 21593, NNPP: 9337 } },
    { lga: 'Takum', votes: { PDP: 16858, APC: 12281, NNPP: 2958 } },
    { lga: 'Ussa', votes: { PDP: 6933, APC: 23315, NNPP: 103 } },
    { lga: 'Wukari', votes: { PDP: 52024, APC: 4387, NNPP: 15230 } },
    { lga: 'Yorro', votes: { PDP: 11880, APC: 5396, NNPP: 4056 } },
    { lga: 'Zing', votes: { PDP: 20182, APC: 7299, NNPP: 2898 } },
  ], {
    'Ardo-Kola': 'Ardokola',
    'Karim Lamido': 'Karim-Lamido',
  }),
});

// --- Kogi (Nov 2023)
emit({
  slug: 'kogi',
  state: 'Kogi',
  updated: '2023-11-12',
  sourceDetail: 'INEC LGA collation centres (2023 Kogi governorship) — THISDAY reporting official returns, 12 November 2023',
  candidates: [
    { name: 'Ahmed Usman Ododo', party: 'APC', votes: 446237 },
    { name: 'Murtala Ajaka', party: 'SDP', votes: 259052 },
    { name: 'Dino Melaye', party: 'PDP', votes: 46362 },
    { name: 'Leke Abejide', party: 'ADC', votes: 21819 },
  ],
  lgaRows: renameRows([
    { lga: 'Adavi', votes: { ADC: 268, APC: 101156, PDP: 1005, SDP: 268 } },
    { lga: 'Ajaokuta', votes: { ADC: 247, APC: 23211, PDP: 483, SDP: 8869 } },
    { lga: 'Ankpa', votes: { ADC: 186, APC: 8707, PDP: 3654, SDP: 43258 } },
    { lga: 'Bassa', votes: { ADC: 448, APC: 9515, PDP: 3605, SDP: 7543 } },
    { lga: 'Dekina', votes: { ADC: 421, APC: 9174, PDP: 499, SDP: 47480 } },
    { lga: 'Ibaji', votes: { ADC: 133, APC: 6991, PDP: 269, SDP: 16984 } },
    { lga: 'Idah', votes: { ADC: 91, APC: 2033, PDP: 271, SDP: 20059 } },
    { lga: 'Igalamela-Odolu', votes: { ADC: 61, APC: 2975, PDP: 140, SDP: 23185 } },
    { lga: 'Ijumu', votes: { ADC: 1898, APC: 10524, PDP: 6909, SDP: 312 } },
    { lga: 'Kabba/Bunu', votes: { ADC: 1537, APC: 12376, PDP: 8566, SDP: 942 } },
    { lga: 'Koton Karfe', votes: { ADC: 133, APC: 14769, PDP: 2974, SDP: 8441 } },
    { lga: 'Lokoja', votes: { ADC: 148, APC: 19105, PDP: 4028, SDP: 10380 } },
    { lga: 'Mopa-Muro', votes: { ADC: 2027, APC: 5077, PDP: 1562, SDP: 253 } },
    { lga: 'Ofu', votes: { ADC: 297, APC: 5245, PDP: 293, SDP: 28768 } },
    { lga: 'Ogori/Magongo', votes: { ADC: 11, APC: 362, PDP: 86, SDP: 195 } },
    { lga: 'Okehi', votes: { ADC: 689, APC: 53062, PDP: 2722, SDP: 153 } },
    { lga: 'Okene', votes: { ADC: 261, APC: 138416, PDP: 1463, SDP: 271 } },
    { lga: 'Olamaboro', votes: { ADC: 126, APC: 5572, PDP: 1376, SDP: 22173 } },
    { lga: 'Omala', votes: { ADC: 218, APC: 2902, PDP: 832, SDP: 18160 } },
    { lga: 'Yagba East', votes: { ADC: 7453, APC: 7096, PDP: 2615, SDP: 312 } },
    { lga: 'Yagba West', votes: { ADC: 4556, APC: 7969, PDP: 3010, SDP: 1002 } },
  ], {
    'Igalamela-Odolu': 'Igalamela/Odolu',
    'Koton Karfe': 'Kogi . K. K.',
    'Mopa-Muro': 'Mopa Moro',
    'Ogori/Magongo': 'Ogori Mangogo',
  }),
});

// --- Kebbi (main poll LGA; statewide finals after supplementary)
emit({
  slug: 'kebbi',
  state: 'Kebbi',
  updated: '2023-04-16',
  sourceDetail: 'INEC LGA collation (2023 Kebbi governorship main poll, The Sun) — statewide finals after 15 Apr supplementary (Channels). LGA rows are main-poll returns; supplementary votes not published by LGA.',
  candidates: [
    { name: 'Nasir Idris', party: 'APC', votes: 409225 },
    { name: 'Aminu Bande', party: 'PDP', votes: 360940 },
  ],
  lgaRows: [
    { lga: 'Aliero', votes: { APC: 11126, PDP: 15828 } },
    { lga: 'Bunza', votes: { APC: 11630, PDP: 16209 } },
    { lga: 'Zuru', votes: { APC: 15830, PDP: 14203 } },
    { lga: 'Kalgo', votes: { APC: 11799, PDP: 10422 } },
    { lga: 'Suru', votes: { APC: 19418, PDP: 17310 } },
    { lga: 'Maiyama', votes: { APC: 17283, PDP: 15252 } },
    { lga: 'Augie', votes: { APC: 17595, PDP: 15889 } },
    { lga: 'Gwandu', votes: { APC: 16028, PDP: 15001 } },
    { lga: 'Koko/Besse', votes: { APC: 13138, PDP: 10969 } },
    { lga: 'Jega', votes: { APC: 23547, PDP: 19547 } },
    { lga: 'Argungu', votes: { APC: 23692, PDP: 29530 } },
    { lga: 'Yauri', votes: { APC: 15131, PDP: 14241 } },
    { lga: 'Fakai', votes: { APC: 11051, PDP: 9689 } },
    { lga: 'Bagudo', votes: { APC: 24284, PDP: 16950 } },
    { lga: 'Arewa', votes: { APC: 22842, PDP: 22340 } },
    { lga: 'Sakaba', votes: { APC: 10375, PDP: 6328 } },
    { lga: 'Dandi', votes: { APC: 29239, PDP: 17720 } },
    { lga: 'Shanga', votes: { APC: 14682, PDP: 12637 } },
    { lga: 'Ngaski', votes: { APC: 12767, PDP: 12705 } },
    { lga: 'Birnin Kebbi', votes: { APC: 52613, PDP: 32406 } },
    { lga: 'Wasagu/Danko', votes: { APC: 24193, PDP: 17804 } },
  ],
});

// --- Katsina (complete LGA table; Stears / Legit / The Sun)
emit({
  slug: 'katsina',
  state: 'Katsina',
  updated: '2023-03-19',
  sourceDetail: 'INEC LGA collation centres (2023 Katsina governorship) — Stears / Legit.ng / The Sun reporting official returns, 19 March 2023',
  candidates: [
    { name: 'Dikko Umaru Radda', party: 'APC', votes: 859892 },
    { name: 'Garba Yakubu Lado', party: 'PDP', votes: 486620 },
    { name: 'Nura Khalil', party: 'NNPP', votes: 8263 },
  ],
  lgaRows: renameRows([
    { lga: 'Bakori', votes: { APC: 29892, PDP: 19592 } },
    { lga: 'Batagarawa', votes: { APC: 26326, PDP: 13510 } },
    { lga: 'Batsari', votes: { APC: 20053, PDP: 10247 } },
    { lga: 'Baure', votes: { APC: 32802, PDP: 17888 } },
    { lga: 'Bindawa', votes: { APC: 28997, PDP: 12165 } },
    { lga: 'Charanchi', votes: { APC: 20782, PDP: 7539 } },
    { lga: 'Dan Musa', votes: { APC: 20145, PDP: 12514 } },
    { lga: 'Dandume', votes: { APC: 23710, PDP: 14792 } },
    { lga: 'Danja', votes: { APC: 28040, PDP: 16302 } },
    { lga: 'Daura', votes: { APC: 26548, PDP: 10689 } },
    { lga: 'Dutsi', votes: { APC: 15631, PDP: 8419 } },
    { lga: 'Dutsin-Ma', votes: { APC: 23878, PDP: 14328 } },
    { lga: 'Faskari', votes: { APC: 27366, PDP: 22565 } },
    { lga: 'Funtua', votes: { APC: 31924, PDP: 19849 } },
    { lga: 'Ingawa', votes: { APC: 22080, PDP: 12255 } },
    { lga: 'Jibia', votes: { APC: 21216, PDP: 13259 } },
    { lga: 'Kafur', votes: { APC: 42660, PDP: 18733 } },
    { lga: 'Kaita', votes: { APC: 24121, PDP: 9824 } },
    { lga: 'Kankara', votes: { APC: 21652, PDP: 27984 } },
    { lga: 'Kankia', votes: { APC: 18249, PDP: 14830 } },
    { lga: 'Katsina', votes: { APC: 47241, PDP: 28982 } },
    { lga: 'Kurfi', votes: { APC: 18750, PDP: 10545 } },
    { lga: 'Kusada', votes: { APC: 13750, PDP: 11151 } },
    { lga: "Mai'Adua", votes: { APC: 28436, PDP: 11506 } },
    { lga: 'Malumfashi', votes: { APC: 43522, PDP: 24676 } },
    { lga: 'Mani', votes: { APC: 29678, PDP: 16180 } },
    { lga: 'Mashi', votes: { APC: 28793, PDP: 8896 } },
    { lga: 'Matazu', votes: { APC: 18363, PDP: 10551 } },
    { lga: 'Musawa', votes: { APC: 24632, PDP: 10118 } },
    { lga: 'Rimi', votes: { APC: 28202, PDP: 13823 } },
    { lga: 'Sabuwa', votes: { APC: 16224, PDP: 11340 } },
    { lga: 'Safana', votes: { APC: 15417, PDP: 10450 } },
    { lga: 'Sandamu', votes: { APC: 21055, PDP: 10641 } },
    { lga: 'Zango', votes: { APC: 19757, PDP: 10477 } },
  ], {
    Malumfashi: 'Malufashi',
    "Mai'Adua": "Mai'adua",
  }),
});

// --- Adamawa (main poll + 15 Apr supplementary LGA adds; APC LGA sum ~1.7k below final declared)
{
  const main = [
    { lga: 'Demsa', votes: { APC: 11798, PDP: 22958 } },
    { lga: 'Fufore', votes: { APC: 24777, PDP: 20409 } },
    { lga: 'Ganye', votes: { APC: 21605, PDP: 17883 } },
    { lga: 'Girei', votes: { APC: 16140, PDP: 17298 } },
    { lga: 'Gombi', votes: { APC: 19665, PDP: 19866 } },
    { lga: 'Guyuk', votes: { APC: 14172, PDP: 18427 } },
    { lga: 'Hong', votes: { APC: 18639, PDP: 31443 } },
    { lga: 'Jada', votes: { APC: 20899, PDP: 22933 } },
    { lga: 'Lamurde', votes: { APC: 9376, PDP: 19104 } },
    { lga: 'Madagali', votes: { APC: 9650, PDP: 27351 } },
    { lga: 'Maiha', votes: { APC: 13242, PDP: 12792 } },
    { lga: 'Mayo Belwa', votes: { APC: 23576, PDP: 20239 } },
    { lga: 'Michika', votes: { APC: 15793, PDP: 30262 } },
    { lga: 'Mubi North', votes: { APC: 32342, PDP: 17469 } },
    { lga: 'Mubi South', votes: { APC: 18149, PDP: 12686 } },
    { lga: 'Numan', votes: { APC: 10626, PDP: 17026 } },
    { lga: 'Shelleng', votes: { APC: 12889, PDP: 14867 } },
    { lga: 'Song', votes: { APC: 19935, PDP: 24744 } },
    { lga: 'Toungo', votes: { APC: 7161, PDP: 7884 } },
    { lga: 'Yola North', votes: { APC: 37886, PDP: 24877 } },
    { lga: 'Yola South', votes: { APC: 32255, PDP: 21006 } },
  ];
  const supp = [
    { lga: 'Demsa', votes: { APC: 43, PDP: 124 } },
    { lga: 'Yola South', votes: { APC: 797, PDP: 678 } },
    { lga: 'Yola North', votes: { APC: 368, PDP: 357 } },
    { lga: 'Lamurde', votes: { APC: 285, PDP: 580 } },
    { lga: 'Jada', votes: { APC: 145, PDP: 271 } },
    { lga: 'Ganye', votes: { APC: 176, PDP: 309 } },
    { lga: 'Song', votes: { APC: 558, PDP: 411 } },
    { lga: 'Shelleng', votes: { APC: 223, PDP: 299 } },
    { lga: 'Maiha', votes: { APC: 172, PDP: 207 } },
    { lga: 'Hong', votes: { APC: 361, PDP: 1056 } },
    { lga: 'Mayo Belwa', votes: { APC: 478, PDP: 672 } },
    { lga: 'Toungo', votes: { APC: 427, PDP: 360 } },
    { lga: 'Guyuk', votes: { APC: 228, PDP: 322 } },
    { lga: 'Gombi', votes: { APC: 12, PDP: 53 } },
    { lga: 'Mubi North', votes: { APC: 168, PDP: 319 } },
    { lga: 'Michika', votes: { APC: 562, PDP: 1027 } },
    { lga: 'Girei', votes: { APC: 589, PDP: 444 } },
    { lga: 'Numan', votes: { APC: 621, PDP: 1403 } },
    { lga: 'Madagali', votes: { APC: 47, PDP: 147 } },
    { lga: 'Mubi South', votes: { APC: 253, PDP: 298 } },
  ];
  const by = Object.fromEntries(main.map((r) => [r.lga, { ...r.votes }]));
  for (const r of supp) {
    by[r.lga].APC += r.votes.APC;
    by[r.lga].PDP += r.votes.PDP;
  }
  emit({
    slug: 'adamawa',
    state: 'Adamawa',
    updated: '2023-04-15',
    sourceDetail: 'INEC LGA collation (2023 Adamawa governorship main poll — Stears) plus 15 Apr supplementary LGA adds (Eagle Online). Statewide APC declared 398,788; LGA sum APC ~397,088 (≈1.7k unpublished/rerun residual).',
    candidates: [
      { name: 'Ahmadu Umaru Fintiri', party: 'PDP', votes: 430861 },
      { name: 'Aishatu Dahiru Ahmed', party: 'APC', votes: 398788 },
    ],
    lgaRows: renameRows(
      Object.entries(by).map(([lga, votes]) => ({ lga, votes })),
      {
        Girei: 'Gire 1',
        'Mayo Belwa': 'Mayobelwa',
      },
    ),
  });
}

console.log('batch5 done');
