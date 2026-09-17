#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

// Inline minimal debug by requiring parse helpers via eval of file sections
const html = fs.readFileSync(path.join(__dirname, '_wiki_raw/Adamawa.html'), 'utf8');

function decode(s) {
  return String(s || '')
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}
function parseNum(s) {
  const t = decode(s).replace(/,/g, '').replace(/%/g, '').trim();
  if (!t || /^tbd$/i.test(t) || t === '—' || t === '-' || t === '–') return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}
function partyFromText(h) {
  const u = decode(h).toUpperCase();
  if (/\bAPC\b/.test(u)) return 'APC';
  if (/\bPDP\b/.test(u)) return 'PDP';
  if (/\bNNPP\b/.test(u)) return 'NNPP';
  if (/\bLP\b/.test(u) || /LABOUR/.test(u)) return 'LP';
  if (/\bSDP\b/.test(u)) return 'SDP';
  return null;
}
function parseCells(trInner) {
  const cells = [];
  const re = /<(td|th)(\s[^>]*)?>([\s\S]*?)<\/\1>/gi;
  let m;
  while ((m = re.exec(trInner))) cells.push({ text: decode(m[3]), raw: m[3].slice(0, 80) });
  return cells;
}

const rows = [];
const re = /<tr\b[^>]*>([\s\S]*?)<\/tr>/gi;
let m;
while ((m = re.exec(html))) rows.push(parseCells(m[1]));

for (let i = 0; i < rows.length; i++) {
  if (rows[i][0] && /^lga$/i.test(rows[i][0].text)) {
    const parties = rows[i].slice(1).map((c) => partyFromText(c.text)).filter(Boolean);
    console.log('header at', i, 'parties', parties, 'cells', rows[i].map((c) => c.text).slice(0, 6));
    for (let j = 1; j <= 6; j++) {
      const r = rows[i + j];
      if (!r) break;
      const nums = r.slice(1).map((c) => parseNum(c.text)).filter((n) => n != null);
      console.log(' +', j, 'name=', r[0] && r[0].text, 'nCells=', r.length, 'nums=', nums.slice(0, 8));
    }
  }
}
