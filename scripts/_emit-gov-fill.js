'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const WIKI = path.join(__dirname, '_wiki_raw');
const GOV = path.join(ROOT, 'data/election-results/gubernatorial');
const OFF = path.join(ROOT, 'data/election-results/official');

const five = JSON.parse(fs.readFileSync(path.join(WIKI, 'gov2023-five-states.json'), 'utf8'));
const byName = Object.fromEntries(five.map((s) => [s.state, s]));

const MAP = {
  Borno: { slug: 'borno', code: 'BO', existing: 'borno-2022.json' },
  Ebonyi: { slug: 'ebonyi', code: 'EB', existing: 'ebonyi-2022.json' },
  Yobe: { slug: 'yobe', code: 'YO', existing: 'yobe-2022.json' },
};

function displayLga(name) {
  return String(name)
    .replace(/\//g, ' / ')
    .replace(/Kwaya Kusar/i, 'Kwaya / Kusar')
    .replace(/Askira\/Uba/i, 'Askira / Uba')
    .replace(/Kala\/Balge/i, 'Kala Balge');
}

function build(pack, slug, code, existing) {
  const candidates = pack.candidates.map((c) => ({ ...c }));
  if (existing?.candidates?.length) {
    const byParty = Object.fromEntries(existing.candidates.map((c) => [c.party, c]));
    for (let i = 0; i < candidates.length; i++) {
      const prev = byParty[candidates[i].party];
      if (prev?.votes) candidates[i] = { ...candidates[i], name: prev.name || candidates[i].name, votes: prev.votes };
    }
    for (const c of existing.candidates) {
      if (!candidates.find((x) => x.party === c.party)) candidates.push({ ...c });
    }
    candidates.sort((a, b) => b.votes - a.votes);
  }
  const byPartyName = Object.fromEntries(candidates.map((c) => [c.party, c.name]));
  const units = {};
  for (const row of pack.partialRows) {
    const votes = { ...row.votes };
    const top = Object.entries(votes).sort((a, b) => b[1] - a[1])[0];
    units[displayLga(row.lga)] = {
      winner: top ? byPartyName[top[0]] || top[0] : null,
      party: top ? top[0] : null,
      votes,
    };
  }
  const stateUrl = `https://www.stears.co/elections/2023/governor/${code}/`;
  return {
    meta: {
      office: 'gov',
      year: '2022',
      state: pack.state,
      level: 'lga',
      title: `${pack.state} State Governorship Election 2022`,
      source: 'Stears Elections (INEC state collation / media reporting)',
      sourceUrl: stateUrl,
      sourceDetail: pack.note,
      attribution: 'Stears; Independent National Electoral Commission (INEC)',
      electionDate: '2023-03-18',
      updated: '2023-03-20',
      collated: true,
      incompleteLgas: pack.missing,
    },
    winner: {
      name: candidates[0].name,
      party: candidates[0].party,
      votes: candidates[0].votes,
    },
    candidates,
    units,
  };
}

for (const [state, cfg] of Object.entries(MAP)) {
  const pack = byName[state];
  const existing = JSON.parse(fs.readFileSync(path.join(GOV, cfg.existing), 'utf8'));
  const payload = build(pack, cfg.slug, cfg.code, existing);
  const govPath = path.join(GOV, `${cfg.slug}-2022.json`);
  const offPath = path.join(OFF, `${cfg.slug}-2022-lga.json`);
  fs.writeFileSync(govPath, JSON.stringify(payload, null, 2) + '\n');
  fs.writeFileSync(offPath, JSON.stringify(payload, null, 2) + '\n');
  console.log(state, Object.keys(payload.units).length, 'LGAs', 'missing', pack.missing.join(','));
}
