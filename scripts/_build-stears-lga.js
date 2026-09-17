const fs = require('fs');
const path = require('path');
const DIR = path.join(__dirname, '_wiki_raw');

const OFFICIAL = {
  Adamawa: [
    'Demsa','Fufore','Ganye','Girei','Gombi','Guyuk','Hong','Jada','Lamurde',
    'Madagali','Maiha','Mayo Belwa','Michika','Mubi North','Mubi South','Numan',
    'Shelleng','Song','Toungo','Yola North','Yola South'
  ],
  Borno: [
    'Abadam','Askira/Uba','Bama','Bayo','Biu','Chibok','Damboa','Dikwa','Gubio',
    'Guzamala','Gwoza','Hawul','Jere','Kaga','Kala/Balge','Konduga','Kukawa',
    'Kwaya Kusar','Mafa','Magumeri','Maiduguri','Marte','Mobbar','Monguno',
    'Ngala','Nganzai','Shani'
  ],
  Ebonyi: [
    'Abakaliki','Afikpo North','Afikpo South','Ebonyi','Ezza North','Ezza South',
    'Ikwo','Ishielu','Ivo','Izzi','Ohaozara','Ohaukwu','Onicha'
  ],
  Yobe: [
    'Bade','Bursari','Damaturu','Fika','Fune','Geidam','Gujba','Gulani','Jakusko',
    'Karasuwa','Machina','Nangere','Nguru','Potiskum','Tarmuwa','Yunusari','Yusufari'
  ],
  Katsina: [
    'Bakori','Batagarawa','Batsari','Baure','Bindawa','Charanchi','Dandume','Danja',
    'Dan Musa','Daura','Dutsi','Dutsin-Ma','Faskari','Funtua','Ingawa','Jibia',
    'Kafur','Kaita','Kankara','Kankia','Katsina','Kurfi','Kusada',"Mai'Adua",
    'Malumfashi','Mani','Mashi','Matazu','Musawa','Rimi','Sabuwa','Safana',
    'Sandamu','Zango'
  ]
};

function norm(s) {
  return String(s || '')
    .toUpperCase()
    .replace(/MMC|METROPOLITAN|MAIDUGURI MC/g, 'MAIDUGURI')
    .replace(/KALA[\s\/-]*BAL(?:GE|E)/g, 'KALA/BALGE')
    .replace(/ASKIRA[\s\/)]*UBA/g, 'ASKIRA/UBA')
    .replace(/KWAYA[\s\-]*KUS(?:AR|A)/g, 'KWAYA KUSAR')
    .replace(/MAYO[\s\-]*BELWA|MAYOBELWA/g, 'MAYO BELWA')
    .replace(/DAN[\s\-]*MUSA|DANMUSA/g, 'DAN MUSA')
    .replace(/DUTSIN[\s\-]*MA/g, 'DUTSIN-MA')
    .replace(/MAI[\s\-']*ADUA/g, "MAI'ADUA")
    .replace(/AFIKPO[\s\-]*NORTH/g, 'AFIKPO NORTH')
    .replace(/AFIKPO[\s\-]*SOUTH/g, 'AFIKPO SOUTH')
    .replace(/EZZA[\s\-]*NORTH/g, 'EZZA NORTH')
    .replace(/EZZA[\s\-]*SOUTH/g, 'EZZA SOUTH')
    .replace(/MUBI[\s\-]*NORTH/g, 'MUBI NORTH')
    .replace(/MUBI[\s\-]*SOUTH/g, 'MUBI SOUTH')
    .replace(/YOLA[\s\-]*NORTH/g, 'YOLA NORTH')
    .replace(/YOLA[\s\-]*SOUTH/g, 'YOLA SOUTH')
    .replace(/[^A-Z0-9]/g, '');
}

function loadParties(code) {
  const html = fs.readFileSync(path.join(DIR, `stears-${code}.html`), 'utf8');
  const marker = 'id="__NEXT_DATA__"';
  const i = html.indexOf(marker);
  const start = html.indexOf('>', i) + 1;
  const end = html.indexOf('</script>', start);
  const data = JSON.parse(html.slice(start, end));
  return data.props.pageProps.parties || [];
}

function build(state, code) {
  const parties = loadParties(code).filter((p) => p.lga);
  const byLga = new Map();
  for (const p of parties) {
    const key = norm(p.lga);
    if (!byLga.has(key)) byLga.set(key, { raw: p.lga, votes: {} });
    const votes = Number(p.votes || p.voteCount || 0);
    if (Number.isFinite(votes) && votes > 0) byLga.get(key).votes[p.party] = votes;
  }

  const official = OFFICIAL[state];
  const lgaRows = [];
  const missing = [];
  for (const name of official) {
    const row = byLga.get(norm(name));
    if (!row || !Object.keys(row.votes).length) {
      missing.push(name);
      continue;
    }
    lgaRows.push({ lga: name, votes: row.votes });
  }

  // leftover stears names
  const used = new Set(official.map(norm));
  const extras = [...byLga.entries()].filter(([k]) => !used.has(k)).map(([k, v]) => ({ key: k, raw: v.raw, votes: v.votes }));

  const candMap = {};
  for (const p of loadParties(code).filter((x) => !x.lga)) {
    candMap[p.party] = { name: p.candidateName || p.name, party: p.party, votes: Number(p.votes || p.voteCount || 0) };
  }

  const out = {
    state,
    complete: missing.length === 0,
    have: lgaRows.length,
    need: official.length,
    missing,
    extras,
    candidates: Object.values(candMap).sort((a, b) => b.votes - a.votes),
    lgaRows,
    sums: {}
  };
  for (const r of lgaRows) {
    for (const [party, v] of Object.entries(r.votes)) {
      out.sums[party] = (out.sums[party] || 0) + v;
    }
  }
  return out;
}

const results = {
  Adamawa: build('Adamawa', 'AD'),
  Borno: build('Borno', 'BO'),
  Ebonyi: build('Ebonyi', 'EB'),
  Yobe: build('Yobe', 'YO'),
  Katsina: build('Katsina', 'KT')
};

fs.writeFileSync(path.join(DIR, 'stears-lga-extract.json'), JSON.stringify(results, null, 2));
for (const [st, r] of Object.entries(results)) {
  console.log(st, 'complete=', r.complete, 'have', r.have, '/', r.need, 'missing', r.missing.join('|') || '-', 'sums', JSON.stringify(r.sums));
  if (r.extras.length) console.log('  extras', r.extras.map((e) => e.raw + ':' + Object.keys(e.votes).join(',')).join('; '));
}
