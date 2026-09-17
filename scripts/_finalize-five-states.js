const fs = require('fs');
const path = require('path');
const DIR = path.join(__dirname, '_wiki_raw');
const raw = JSON.parse(fs.readFileSync(path.join(DIR, 'stears-lga-extract.json'), 'utf8'));

function sortRows(rows) {
  return rows.slice().sort((a, b) => a.lga.localeCompare(b.lga));
}

// --- Katsina complete ---
const ktRows = sortRows([
  ...raw.Katsina.lgaRows.map((r) => ({
    lga: r.lga,
    votes: { APC: r.votes.APC || 0, PDP: r.votes.PDP || 0, ...(r.votes.Others ? { Others: r.votes.Others } : {}) }
  })),
  { lga: 'Malumfashi', votes: { APC: 43522, PDP: 24676, Others: 665 } }
]);

const katsina = {
  state: 'Katsina',
  complete: true,
  source: 'Stears Elections (INEC state collation / media reporting), cross-checked with Legit.ng live INEC updates 19 Mar 2023 and The Sun Katsina LGA results; statewide APC/PDP LGA sums match declared totals',
  candidates: [
    { name: 'Umar Dikko Radda', party: 'APC', votes: 859892 },
    { name: 'Garba Yakubu Lado', party: 'PDP', votes: 486620 },
    { name: 'Nura Khalil', party: 'NNPP', votes: 8263 }
  ],
  lgaRows: ktRows
};

// --- Adamawa incomplete (pre-supp full 21 + supp by LGA; final post-rerun LGA table not published as one reconciled set) ---
const adamawaBase = sortRows(
  raw.Adamawa.lgaRows.map((r) => ({
    lga: r.lga,
    votes: { APC: r.votes.APC || 0, PDP: r.votes.PDP || 0, ...(r.votes.Others ? { Others: r.votes.Others } : {}) }
  }))
);
const adamawaSupp = [
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
  { lga: 'Mubi South', votes: { APC: 253, PDP: 298 } }
];

const adamawa = {
  state: 'Adamawa',
  complete: false,
  have: 21,
  need: 21,
  missing: [],
  note: 'All 21 LGAs published for the March 18 collation (Stears; sums APC 390,575 / PDP 421,524 ≈ inconclusive totals). April 15 supplementary LGA adds published (The Eagle Online, 19 Apr 2023: APC 6,513 / PDP 9,337 statewide). No single published final post-rerun LGA table reconciles APC LGA sum to declared 398,788 (Stears+supp APC≈397,088; PDP does hit 430,861). Fufore had no supplementary units in Eagle list.',
  candidates: [
    { name: 'Ahmadu Umaru Fintiri', party: 'PDP', votes: 430861 },
    { name: 'Aishatu Dahiru Ahmed (Binani)', party: 'APC', votes: 398788 }
  ],
  partialRows: adamawaBase,
  supplementaryRows: adamawaSupp
};

// --- Borno ---
const bornoRows = sortRows([
  ...raw.Borno.lgaRows.map((r) => ({
    lga: r.lga,
    votes: { APC: r.votes.APC || 0, PDP: r.votes.PDP || 0, ...(r.votes.Others ? { Others: r.votes.Others } : {}) }
  })),
  { lga: 'Maiduguri', votes: { APC: 80942, PDP: 7365, Others: 41 } }
]);

const adamawaOut = adamawa;
const borno = {
  state: 'Borno',
  complete: false,
  have: 26,
  need: 27,
  missing: ['Biu'],
  note: 'Stears + National Accord / VON / Naija News Hawul. MMC as Maiduguri. Biu never published with vote figures in searched outlets; PDP LGA sum of these 26 (~56.6k) leaves an implausibly large residual vs declared 82,147, so some PDP cells may also be under-reported.',
  candidates: [
    { name: 'Babagana Umara Zulum', party: 'APC', votes: 545543 },
    { name: 'Mohammed Ali Jajari', party: 'PDP', votes: 82147 }
  ],
  partialRows: bornoRows
};

// --- Ebonyi ---
const ebonyi = {
  state: 'Ebonyi',
  complete: false,
  have: 12,
  need: 13,
  missing: ['Ishielu'],
  note: 'Stears/Legit.ng/Daily Post/New Telegraph cover 12/13. Ishielu delayed for IREV review; win attributed to APC but no published vote line. Statewide: APC 199,131; PDP 80,191; APGA 52,189 (Punch 20 Mar 2023). Stears Others often ≈ APGA+minor parties.',
  candidates: [
    { name: 'Francis Nwifuru', party: 'APC', votes: 199131 },
    { name: 'Ifeanyi Odii', party: 'PDP', votes: 80191 },
    { name: 'Bernard Odoh', party: 'APGA', votes: 52189 }
  ],
  partialRows: sortRows(
    raw.Ebonyi.lgaRows.map((r) => ({
      lga: r.lga,
      votes: { APC: r.votes.APC || 0, PDP: r.votes.PDP || 0, ...(r.votes.Others ? { Others: r.votes.Others } : {}) }
    }))
  )
};

// --- Yobe ---
const yobeFixed = {
  Bade: { APC: 21370, NNPP: 1254, PDP: 10766 },
  Bursari: { APC: 13825, NNPP: 97, PDP: 4879 },
  Damaturu: { APC: 20877, NNPP: 217, PDP: 7655 },
  Geidam: { APC: 14495, NNPP: 355, PDP: 1777 },
  Gujba: { APC: 20252, NNPP: 46, PDP: 2428 },
  Gulani: { APC: 16244, NNPP: 114, PDP: 5537 },
  Machina: { APC: 11039, NNPP: 262, PDP: 4288 },
  Nguru: { APC: 22459, NNPP: 310, PDP: 9332 },
  Nangere: { APC: 18346, NNPP: 450, PDP: 6958 },
  Tarmuwa: { APC: 8249, NNPP: 85, PDP: 4145 },
  Yunusari: { APC: 16042, NNPP: 1657, PDP: 2102 },
  Yusufari: { APC: 16216, NNPP: 222, PDP: 3837 }
};

const yobe = {
  state: 'Yobe',
  complete: false,
  have: 12,
  need: 17,
  missing: ['Fika', 'Fune', 'Jakusko', 'Karasuwa', 'Potiskum'],
  note: 'Daily Post 19 Mar 2023 (11 LGAs) + Development Diaries Yusufari; Stears Yunusari duplicated Bursari so replaced with Daily Post Yunusari. No published figures found for Fika, Fune, Jakusko, Karasuwa, Potiskum. Statewide APC 317,113; PDP 104,259; NNPP 14,246.',
  candidates: [
    { name: 'Mai Mala Buni', party: 'APC', votes: 317113 },
    { name: 'Sharif Abdullahi', party: 'PDP', votes: 104259 },
    { name: 'NNPP candidate', party: 'NNPP', votes: 14246 }
  ],
  partialRows: sortRows(Object.entries(yobeFixed).map(([lga, votes]) => ({ lga, votes })))
};

const out = [adamawaOut, borno, ebonyi, yobe, katsina];
fs.writeFileSync(path.join(DIR, 'gov2023-five-states.json'), JSON.stringify(out, null, 2));
console.log('wrote', out.map((o) => o.state + ':' + o.complete + (o.have != null ? ` ${o.have}/${o.need}` : ` ${o.lgaRows.length}`)).join(', '));
