/**
 * One-shot Phase 2 runner: split dump, restore house-2019, build votes.
 * Usage: node scripts/_run-phase2-offline.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const AGENT_TOOLS = path.join(
  process.env.USERPROFILE || '',
  '.cursor',
  'projects',
  'c-Users-Geoinfotech-Documents-GIS-Team-Election-Dashboard',
  'agent-tools'
);
const NASS = path.join(__dirname, '_wiki_raw', 'stears-nass');

function run(cmd) {
  console.log('>', cmd);
  execSync(cmd, { cwd: ROOT, stdio: 'inherit', timeout: 600000 });
}

fs.mkdirSync(NASS, { recursive: true });

console.log('node', execSync('node -v', { encoding: 'utf8' }).trim());

run('node scripts/_split-stears-nass-dump.js');

// Restore valid house-2019 from Playwright evaluate dump if present
const houseDump = path.join(AGENT_TOOLS, 'dfe2159c-3898-43c5-ae17-daac331dce99.txt');
if (fs.existsSync(houseDump)) {
  const j = JSON.parse(fs.readFileSync(houseDump, 'utf8'));
  if (j.parties && j.parties[0] && j.parties[0].race === 'house' && j.parties[0].year === 2019) {
    const out = {
      url: j.url,
      parties: j.parties,
      dropdown: j.dropdown || [],
      race: j.race || 'house',
    };
    fs.writeFileSync(path.join(NASS, 'house-2019-national.json'), JSON.stringify(out) + '\n');
    console.log('restored house-2019-national.json', out.parties.length, 'parties');
  } else {
    console.warn('house dump present but not valid house-2019');
  }
} else {
  console.warn('missing house-2019 agent-tools dump; build will use whatever is in stears-nass');
}

run('node scripts/_build-stears-nass-votes.js');
console.log('Phase 2 offline runner complete');
