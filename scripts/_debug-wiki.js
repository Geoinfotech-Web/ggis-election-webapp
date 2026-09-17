#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const DIR = path.join(__dirname, '_wiki_raw');
const files = [
  'Adamawa', 'Borno', 'Ebonyi', 'Akwa_Ibom', 'Gombe', 'Jigawa', 'Sokoto',
  'Niger', 'Nasarawa', 'Kogi', 'Taraba', 'Yobe', 'Zamfara', 'Kebbi',
];
for (const f of files) {
  const html = fs.readFileSync(path.join(DIR, `${f}.html`), 'utf8');
  const tables = html.match(/<table\b[^>]*class="[^"]*wikitable[^"]*"/gi) || [];
  let hits = 0;
  const re = /<tr\b[^>]*>([\s\S]*?)<\/tr>/gi;
  let m;
  while ((m = re.exec(html)) && hits < 3) {
    if (/>\s*LGA\s*</i.test(m[0]) || />Local government/i.test(m[0])) {
      console.log(f, 'HIT', m[0].replace(/\s+/g, ' ').slice(0, 400));
      hits += 1;
    }
  }
  if (!hits) {
    console.log(f, 'no LGA header row; wikitables=', tables.length);
    // Show nearby "Results" sections
    const i = html.search(/id="Results"|Results by|General election results/i);
    if (i >= 0) console.log('  context', html.slice(i, i + 300).replace(/\s+/g, ' '));
  }
}
