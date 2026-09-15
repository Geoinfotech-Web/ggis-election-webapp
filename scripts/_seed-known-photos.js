/**
 * Seed known-good Wikimedia Commons portraits for high-profile candidates
 * that Wikidata P18 / Wikipedia pageimages miss. ASCII-only metadata.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const PRES = path.join(ROOT, 'public', 'data', 'presidential-candidates.json');
const GOV = path.join(ROOT, 'public', 'data', 'gubernatorial-candidates.json');
const CREDIT = 'Wikipedia / Wikimedia Commons';

function commons(file) {
  return `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(file)}?width=480`;
}

function wiki(title) {
  return `https://en.wikipedia.org/wiki/${encodeURIComponent(title.replace(/ /g, '_'))}`;
}

/** Exact profile name (normalized) -> { file, wikiTitle } */
const BY_NAME = {
  'alex otti': { file: 'Alex otti.jpg', wikiTitle: 'Alex Otti' },
  'charles soludo': { file: 'Charles Chukwuma Soludo.jpg', wikiTitle: 'Charles Soludo' },
  'siminalayi fubara': { file: 'Governor siminalayi Fubara 11.jpg', wikiTitle: 'Siminalayi Fubara' },
  'sheriff oborevwori': { file: 'Sheriff Oborevwori.jpg', wikiTitle: 'Sheriff Oborevwori' },
};

function norm(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function apply(catalog, label) {
  let n = 0;
  for (const pr of Object.values(catalog.profiles || {})) {
    if (pr.photo) continue;
    const hit = BY_NAME[norm(pr.name)];
    if (!hit) continue;
    pr.photo = commons(hit.file);
    pr.photoCredit = CREDIT;
    if (!pr.wiki) pr.wiki = wiki(hit.wikiTitle);
    n++;
    console.log(label, pr.id, '->', hit.file);
  }
  return n;
}

const pres = JSON.parse(fs.readFileSync(PRES, 'utf8'));
const gov = JSON.parse(fs.readFileSync(GOV, 'utf8'));
const a = apply(pres, 'PRES');
const b = apply(gov, 'GOV');
pres.updated = new Date().toISOString().slice(0, 10);
gov.updated = new Date().toISOString().slice(0, 10);
fs.writeFileSync(PRES, JSON.stringify(pres, null, 2) + '\n');
fs.writeFileSync(GOV, JSON.stringify(gov, null, 2) + '\n');
console.log('seeded', { pres: a, gov: b });
