const { execSync, spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const http = require('http');

const root = __dirname;
const status = path.join(root, '.docker-sync-status.txt');
const log = [];
const L = (m) => { log.push(`[${new Date().toISOString()}] ${m}`); };

function sh(cmd, timeout = 60000) {
  return execSync(cmd, { cwd: root, encoding: 'utf8', timeout, stdio: ['ignore', 'pipe', 'pipe'] });
}

function get(url) {
  return new Promise((resolve, reject) => {
    const req = http.get(url, { timeout: 20000 }, (res) => {
      let d = '';
      res.on('data', (c) => { d += c; });
      res.on('end', () => resolve(d));
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
  });
}

(async () => {
  L('START _sync-node.js');
  let container = '';
  try {
    container = sh('docker ps --filter publish=3010 --format {{.Names}}', 20000).trim().split(/\r?\n/)[0] || '';
    if (!container) container = sh('docker ps --filter name=election-dashboard-app --format {{.Names}}', 20000).trim().split(/\r?\n/)[0] || '';
    L(`container=${container || 'NONE'}`);
  } catch (e) {
    L(`docker ps error: ${e.message}`);
  }

  let method = 'none';
  try {
    if (container) {
      L('docker cp 3 files');
      sh(`docker cp "public/index.html" ${container}:/app/public/index.html`);
      sh(`docker cp "public/js/eid-maps.js" ${container}:/app/public/js/eid-maps.js`);
      sh(`docker cp "election-results-data.js" ${container}:/app/election-results-data.js`);
      L(`restart ${container}`);
      sh(`docker restart ${container}`, 120000);
      method = 'docker-cp-restart';
    } else {
      L('compose up -d app');
      sh('docker compose up -d app', 180000);
      method = 'compose-up';
    }
  } catch (e) {
    L(`sync error: ${e.message}`);
    if (e.stdout) L(`stdout: ${String(e.stdout).slice(0, 500)}`);
    if (e.stderr) L(`stderr: ${String(e.stderr).slice(0, 500)}`);
  }

  await new Promise((r) => setTimeout(r, 6000));

  let homeOk = false, mapsOk = false;
  try {
    const h = await get('http://127.0.0.1:3010/');
    const m = await get('http://127.0.0.1:3010/js/eid-maps.js');
    homeOk = h.includes('isGovCoverageTheme');
    mapsOk = m.includes('theme.coverage === true');
    L(`VERIFY isGovCoverageTheme=${homeOk} homeLen=${h.length}`);
    L(`VERIFY coverageTrue=${mapsOk} mapsLen=${m.length}`);
    L(`RESULT fix_served=${homeOk && mapsOk} method=${method}`);
  } catch (e) {
    L(`VERIFY error: ${e.message}`);
    L('RESULT fix_served=false');
  }

  L('DONE');
  fs.writeFileSync(status, log.join('\n') + '\n', 'utf8');
})();
