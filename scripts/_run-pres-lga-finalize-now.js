'use strict';
/**
 * Standalone: extract agent-tools dump → fetch.json, then finalize.
 * Run: node scripts/_run-pres-lga-finalize-now.js
 */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const RAW = path.join(__dirname, '_wiki_raw');
const DUMP = path.join(
  process.env.USERPROFILE || '',
  '.cursor',
  'projects',
  'c-Users-Geoinfotech-Documents-GIS-Team-Election-Dashboard',
  'agent-tools',
  '98d628dd-c619-4634-8d47-ceddc7e8948b.txt'
);

function extract() {
  let text = fs.readFileSync(DUMP, 'utf8');
  const idx = text.indexOf('{');
  if (idx < 0) throw new Error('no JSON in dump');
  text = text.slice(idx);
  let depth = 0;
  let end = -1;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) {
        end = i;
        break;
      }
    }
  }
  if (end < 0) throw new Error('unbalanced JSON');
  const json = text.slice(0, end + 1);
  JSON.parse(json); // validate
  fs.mkdirSync(RAW, { recursive: true });
  const out = path.join(RAW, 'stears-pres-lga-fetch.json');
  fs.writeFileSync(out, json + '\n');
  console.log('Extracted', out, 'bytes', Buffer.byteLength(json));
  return out;
}

extract();
const r = spawnSync(process.execPath, [path.join(__dirname, '_finalize-pres-lga.js')], {
  cwd: ROOT,
  encoding: 'utf8',
  maxBuffer: 20 * 1024 * 1024,
});
process.stdout.write(r.stdout || '');
process.stderr.write(r.stderr || '');
process.exit(r.status == null ? 1 : r.status);
