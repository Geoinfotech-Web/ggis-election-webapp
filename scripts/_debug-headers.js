#!/usr/bin/env node
const fs = require('fs');
function decode(s) {
  return String(s || '')
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
function parseCells(trInner) {
  const cells = [];
  const re = /<(td|th)(\s[^>]*)?>([\s\S]*?)<\/\1>/gi;
  let m;
  while ((m = re.exec(trInner))) cells.push(decode(m[3]));
  return cells;
}
for (const f of ['Gombe', 'Zamfara', 'Taraba', 'Katsina', 'Bauchi']) {
  const html = fs.readFileSync(`scripts/_wiki_raw/${f}.html`, 'utf8');
  const rows = [];
  const re = /<tr\b[^>]*>([\s\S]*?)<\/tr>/gi;
  let m;
  while ((m = re.exec(html))) rows.push(parseCells(m[1]));
  for (let i = 0; i < rows.length; i++) {
    if (rows[i][0] === 'LGA') {
      console.log(`\n${f} header@${i}`, rows[i].slice(0, 8));
      for (let j = 1; j <= 6; j++) console.log(' ', j, rows[i + j] && rows[i + j].slice(0, 10));
    }
  }
}
