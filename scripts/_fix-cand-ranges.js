const fs = require('fs');
const file = 'public/data/presidential-candidates.json';
const data = JSON.parse(fs.readFileSync(file, 'utf8'));

function fix(str) {
  if (typeof str !== 'string') return str;
  return str.replace(/\((\d{4})-\)/g, '($1-present)');
}

function walk(v) {
  if (Array.isArray(v)) return v.map(walk);
  if (v && typeof v === 'object') {
    for (const k of Object.keys(v)) v[k] = walk(v[k]);
    return v;
  }
  return fix(v);
}

walk(data);

for (const p of Object.values(data.profiles)) {
  if (p.photo && String(p.photo).includes('Special:FilePath')) {
    p.photo = String(p.photo).replace(/([?&])width=\d+/g, '$1width=480');
    if (!/[?&]width=/.test(p.photo)) {
      p.photo += (p.photo.includes('?') ? '&' : '?') + 'width=480';
    }
  }
}

fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n', 'utf8');
console.log(data.profiles['bola-ahmed-tinubu'].roles);
console.log('year', data.profiles['bola-ahmed-tinubu'].history[1].year);
console.log('photo', data.profiles['bola-ahmed-tinubu'].photo);
