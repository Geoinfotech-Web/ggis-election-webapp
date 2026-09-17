#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const DIR = path.join(__dirname, '_wiki_raw');
for (const file of fs.readdirSync(DIR).filter((f) => f.endsWith('.html') && !f.includes('-api'))) {
  const html = fs.readFileSync(path.join(DIR, file), 'utf8');
  const tbd = (html.match(/>TBD</g) || []).length;
  const nums = (html.match(/>\d{1,3},\d{3}</g) || []).length;
  console.log(file.replace('.html', ''), 'TBD=', tbd, 'commaNums=', nums);
}
