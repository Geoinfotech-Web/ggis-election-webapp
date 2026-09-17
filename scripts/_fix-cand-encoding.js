const fs = require('fs');
const path = require('path');
const file = path.join(__dirname, '../public/data/presidential-candidates.json');

let s = fs.readFileSync(file, 'utf8');

// Mojibake of UTF-8 en-dash (E2 80 93) read as Windows-1252 then saved as UTF-8:
// chars U+00E2 U+20AC U+201C  OR  U+00E2 U+20AC U+2013 depending on round-trip
const patterns = [
  // â€“  (a-circumflex + euro + en-dash) — common
  [/\u00E2\u20AC\u2013/g, '-'],
  // â€”  (em dash mojibake)
  [/\u00E2\u20AC\u2014/g, '-'],
  // â€™  (right single quote)
  [/\u00E2\u20AC\u2122/g, "'"],
  // â€˜
  [/\u00E2\u20AC\u0160/g, "'"],
  [/\u00E2\u20AC\u2018/g, "'"],
  [/\u00E2\u20AC\u2019/g, "'"],
  // â€œ â€
  [/\u00E2\u20AC\u0153/g, '"'],
  [/\u00E2\u20AC\u201C/g, '-'], // sometimes en-dash became this
  [/\u00E2\u20AC\u201D/g, '-'],
  // leftover â€
  [/\u00E2\u20AC/g, '-'],
  // proper unicode punctuation -> ascii
  [/[\u2013\u2014]/g, '-'],
  [/[\u2018\u2019]/g, "'"],
  [/[\u201C\u201D]/g, '"'],
];

for (const [re, to] of patterns) {
  const before = s;
  s = s.replace(re, to);
  if (s !== before) console.log('applied', re, 'delta', before.length - s.length);
}

const data = JSON.parse(s);
fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n', 'utf8');
console.log('role0', data.profiles['bola-ahmed-tinubu'].roles[0]);
console.log('year1', data.profiles['bola-ahmed-tinubu'].history[1].year);
const out = fs.readFileSync(file, 'utf8');
console.log('has circumflex-a', out.includes('\u00E2'));
