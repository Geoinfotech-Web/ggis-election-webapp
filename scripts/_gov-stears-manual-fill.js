/**
 * Manual fallback when _gov-stears-validate-fill.js hangs on network.
 * - Downloads Stears Open Data CSVs
 * - Fills Borno, Ebonyi, Yobe from cached Stears HTML + gov2023-five-states corrections
 * - Writes validation report + Lagos Alimosho spot-check
 */
'use strict';

const fs = require('fs');
const path = require('path');
const https = require('https');

const ROOT = path.join(__dirname, '..');
const WIKI = path.join(__dirname, '_wiki_raw');
const GOV_DIR = path.join(ROOT, 'data', 'election-results', 'gubernatorial');
const OFF_DIR = path.join(ROOT, 'data', 'election-results', 'official');
const CSV_DIR = path.join(ROOT, 'data', 'reference', 'stears-open-data');
const OUT = path.join(WIKI, 'gov-stears-2023-validation.json');

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';

const CSV_URLS = [
  'https://stears-flourish-data.s3.amazonaws.com/africa-past-tracker.csv',
  'https://stears-flourish-data.s3.amazonaws.com/africa-upcoming-tracker.csv',
  'https://stears-flourish-data.s3.amazonaws.com/africa-map-democracy-level.csv',
  'https://stears-flourish-data.s3.amazonaws.com/africa-map-coup.csv',
  'https://stears-flourish-data.s3.amazonaws.com/africa-map-democracy-age.csv',
  'https://stears-flourish-data.s3.amazonaws.com/africa-map-population.csv',
  'https://stears-flourish-data.s3.amazonaws.com/africa-map-gdp.csv',
];

const FILL_STATES = [
  { slug: 'borno', code: 'BO', name: 'Borno' },
  { slug: 'ebonyi', code: 'EB', name: 'Ebonyi' },
  { slug: 'yobe', code: 'YO', name: 'Yobe' },
];

function fetchBuffer(url, timeoutMs = 90000) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { 'User-Agent': UA }, timeout: timeoutMs }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        const next = res.headers.location.startsWith('http')
          ? res.headers.location
          : new URL(res.headers.location, url).href;
        return fetchBuffer(next, timeoutMs).then(resolve, reject);
      }
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ statusCode: res.statusCode, body: Buffer.concat(chunks) }));
    });
    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('timeout'));
    });
  });
}

function fetchText(url) {
  return fetchBuffer(url).then((r) => ({ ...r, text: r.body.toString('utf8') }));
}

function parseNextData(html) {
  const marker = 'id="__NEXT_DATA__"';
  const i = html.indexOf(marker);
  if (i < 0) return null;
  const start = html.indexOf('>', i) + 1;
  const end = html.indexOf('</script>', start);
  try {
    return JSON.parse(html.slice(start, end));
  } catch {
    return null;
  }
}

function loadStearsParties(code) {
  const cache = path.join(WIKI, `stears-${code}.html`);
  if (!fs.existsSync(cache)) return null;
  const html = fs.readFileSync(cache, 'utf8');
  const data = parseNextData(html);
  return data?.props?.pageProps?.parties || null;
}

function norm(s) {
  return String(s || '')
    .toUpperCase()
    .replace(/MMC|METROPOLITAN|MAIDUGURI MC/g, 'MAIDUGURI')
    .replace(/KALA[\s\/-]*BAL(?:GE|E)/g, 'KALABALGE')
    .replace(/ASKIRA[\s\/)]*UBA/g, 'ASKIRAUBA')
    .replace(/KWAYA[\s\-]*KUS(?:AR|A)/g, 'KWAYAKUSAR')
    .replace(/[^A-Z0-9]/g, '');
}

function displayLga(name) {
  return String(name)
    .replace(/\//g, ' / ')
    .replace(/Kwaya Kusar/i, 'Kwaya / Kusar')
    .replace(/Askira\/Uba/i, 'Askira / Uba')
    .replace(/Kala\/Balge/i, 'Kala Balge');
}

function buildUnitsFromRows(rows, candidates) {
  const byParty = Object.fromEntries(candidates.map((c) => [c.party, c.name]));
  const units = {};
  for (const row of rows) {
    const votes = { ...row.votes };
    const top = Object.entries(votes).sort((a, b) => b[1] - a[1])[0];
    units[displayLga(row.lga)] = {
      winner: top ? byParty[top[0]] || top[0] : null,
      party: top ? top[0] : null,
      votes,
    };
  }
  return units;
}

function buildPayload(stateName, slug, code, pack, existing) {
  const storageYear = 2022;
  const stateUrl = `https://www.stears.co/elections/2023/governor/${code}/`;
  const notes = pack.note || `Stears Elections LGA tallies for 2023 ${stateName} governorship (${stateUrl}).`;
  const candidates = pack.candidates.map((c) => ({ ...c }));
  const winner = candidates[0]
    ? { name: candidates[0].name, party: candidates[0].party, votes: candidates[0].votes }
    : existing?.winner || null;

  // Preserve declared statewide totals from existing file when present
  if (existing?.candidates?.length) {
    const byParty = Object.fromEntries(existing.candidates.map((c) => [c.party, c]));
    for (let i = 0; i < candidates.length; i++) {
      const prev = byParty[candidates[i].party];
      if (prev?.votes) candidates[i] = { ...candidates[i], name: prev.name || candidates[i].name, votes: prev.votes };
    }
    for (const c of existing.candidates) {
      if (!candidates.find((x) => x.party === c.party)) candidates.push({ ...c });
    }
    candidates.sort((a, b) => b.votes - a.votes);
  }

  const payload = {
    meta: {
      office: 'gov',
      year: String(storageYear),
      state: stateName,
      level: 'lga',
      title: `${stateName} State Governorship Election ${storageYear}`,
      source: 'Stears Elections (INEC state collation / media reporting)',
      sourceUrl: stateUrl,
      sourceDetail: notes,
      attribution: 'Stears; Independent National Electoral Commission (INEC)',
      electionDate: '2023-03-18',
      updated: '2023-03-20',
      collated: true,
      incompleteLgas: pack.missing || [],
    },
    winner: {
      name: candidates[0]?.name || winner?.name,
      party: candidates[0]?.party || winner?.party,
      votes: candidates[0]?.votes || winner?.votes,
    },
    candidates,
    units: buildUnitsFromRows(pack.partialRows, candidates),
  };
  return payload;
}

async function downloadCsvs() {
  fs.mkdirSync(CSV_DIR, { recursive: true });
  const files = [];
  for (const url of CSV_URLS) {
    const name = path.basename(new URL(url).pathname);
    const dest = path.join(CSV_DIR, name);
    try {
      const res = await fetchBuffer(url);
      if (res.statusCode !== 200) throw new Error(`HTTP ${res.statusCode}`);
      fs.writeFileSync(dest, res.body);
      files.push({ name, bytes: res.body.length, url, ok: true });
      console.log('CSV', name, res.body.length, 'bytes');
    } catch (e) {
      files.push({ name, url, ok: false, error: String(e.message || e) });
      console.warn('CSV fail', name, e.message);
    }
  }

  const manifest = {
    generatedAt: new Date().toISOString(),
    attribution: 'Stears Open Data (Flourish datasets hosted on AWS S3)',
    source: 'https://www.stears.co/open-data',
    license: 'See Stears Open Data terms; cite Stears when using these datasets.',
    files: files.map((f) => ({
      filename: f.name,
      url: f.url,
      bytes: f.bytes ?? null,
      downloaded: !!f.ok,
      error: f.error || null,
    })),
  };
  fs.writeFileSync(path.join(CSV_DIR, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');

  const readme = `# Stears Open Data (reference CSVs)

Downloaded from [Stears Open Data](https://www.stears.co/open-data) Flourish S3 endpoints for offline reference in the Election Dashboard.

## Attribution

Data © **Stears**. When publishing charts or analysis derived from these files, cite Stears Open Data and link to https://www.stears.co/open-data .

## Files

${CSV_URLS.map((u) => `- \`${path.basename(new URL(u).pathname)}\` — ${u}`).join('\n')}

See \`manifest.json\` for download timestamps and byte sizes.
`;
  fs.writeFileSync(path.join(CSV_DIR, 'README.md'), readme);
  return files;
}

function compareLgaFromParties(parties, localUnits, lgaName) {
  const key = norm(lgaName);
  const stears = {};
  for (const p of parties || []) {
    if (!p.lga || norm(p.lga) !== key) continue;
    const party = String(p.party || '').trim();
    const v = Number(p.votes || p.voteCount || 0);
    if (party && v) stears[party] = v;
  }
  const local = localUnits?.[lgaName]?.votes || {};
  const diffs = [];
  for (const party of new Set([...Object.keys(stears), ...Object.keys(local)])) {
    const sv = Number(stears[party] || 0);
    const lv = Number(local[party] || 0);
    if (sv !== lv) diffs.push({ party, stears: sv, local: lv });
  }
  return { stears, local, match: diffs.length === 0, diffs };
}

async function main() {
  console.log('=== Stears gov manual fill ===');
  const csvFiles = await downloadCsvs();

  const five = JSON.parse(fs.readFileSync(path.join(WIKI, 'gov2023-five-states.json'), 'utf8'));
  const byName = Object.fromEntries(five.map((s) => [s.state, s]));

  const report = {
    generatedAt: new Date().toISOString(),
    mode: 'manual-fallback',
    note: 'Primary _gov-stears-validate-fill.js hung on network; used cached Stears HTML + gov2023-five-states.json corrections.',
    csvDir: 'data/reference/stears-open-data',
    csvFiles,
    filled: [],
    validated: [],
    spotChecks: [],
    residuals: [],
    summary: {},
  };

  for (const { slug, code, name } of FILL_STATES) {
    const pack = byName[name];
    if (!pack) {
      report.residuals.push({ state: name, error: 'missing gov2023-five-states entry' });
      continue;
    }
    const govPath = path.join(GOV_DIR, `${slug}-2022.json`);
    const offPath = path.join(OFF_DIR, `${slug}-2022-lga.json`);
    let existing = null;
    if (fs.existsSync(govPath)) {
      try {
        existing = JSON.parse(fs.readFileSync(govPath, 'utf8'));
      } catch {
        /* skip */
      }
    }
    const payload = buildPayload(name, slug, code, pack, existing);
    fs.writeFileSync(govPath, JSON.stringify(payload, null, 2) + '\n');
    fs.writeFileSync(offPath, JSON.stringify(payload, null, 2) + '\n');

    const stearsParties = loadStearsParties(code);
    const entry = {
      state: name,
      code,
      action: 'filled-estimated',
      stearsLgaCount: pack.partialRows.length,
      incompleteLgas: pack.missing,
      note: pack.note,
      wrote: [
        `data/election-results/gubernatorial/${slug}-2022.json`,
        `data/election-results/official/${slug}-2022-lga.json`,
      ],
      priorLgaMethod: existing?.meta?.lgaMethod || null,
      collated: true,
    };
    report.filled.push(entry);
    console.log('FILLED', name, pack.partialRows.length, 'LGAs; missing:', (pack.missing || []).join(', ') || '-');
  }

  // Spot-check Lagos Alimosho vs Stears (fetch or skip)
  const lagosPath = path.join(GOV_DIR, 'lagos-2022.json');
  let lagosLocal = null;
  if (fs.existsSync(lagosPath)) {
    lagosLocal = JSON.parse(fs.readFileSync(lagosPath, 'utf8'));
  }
  const expected = { APC: 83631, LP: 37136 };
  const localAlimosho = lagosLocal?.units?.Alimosho?.votes || {};
  const localCheck = {
    lga: 'Alimosho',
    state: 'Lagos',
    expected,
    local: { APC: localAlimosho.APC, LP: localAlimosho.LP },
    localMatchExpected: localAlimosho.APC === expected.APC && localAlimosho.LP === expected.LP,
  };

  let stearsCheck = { fetched: false };
  try {
    const laUrl = 'https://www.stears.co/elections/2023/governor/LA/';
    const la = await fetchText(laUrl);
    if (la.statusCode === 200) {
      const data = parseNextData(la.text);
      const parties = data?.props?.pageProps?.parties || [];
      const cmp = compareLgaFromParties(parties, lagosLocal?.units, 'Alimosho');
      stearsCheck = {
        fetched: true,
        url: laUrl,
        stears: { APC: cmp.stears.APC, LP: cmp.stears.LP },
        matchLocal: cmp.match,
        diffs: cmp.diffs,
      };
      report.validated.push({
        state: 'Lagos',
        code: 'LA',
        action: 'validated',
        localFile: 'data/election-results/gubernatorial/lagos-2022.json',
        localCollated: !!lagosLocal?.meta?.collated,
        compare: {
          matched: cmp.match ? 1 : 0,
          mismatchLgaCount: cmp.match ? 0 : 1,
          mismatches: cmp.match ? [] : [{ lga: 'Alimosho', diffs: cmp.diffs }],
        },
        significantMismatch: !cmp.match,
      });
    }
  } catch (e) {
    stearsCheck = { fetched: false, error: String(e.message || e) };
    report.residuals.push({ state: 'Lagos', type: 'spot-check-fetch-failed', error: stearsCheck.error });
  }

  report.spotChecks.push({ ...localCheck, stears: stearsCheck });

  report.summary = {
    filled: report.filled.length,
    filledStates: report.filled.map((f) => f.state),
    validated: report.validated.length,
    csvDownloaded: csvFiles.filter((f) => f.ok).length,
    csvFailed: csvFiles.filter((f) => !f.ok).length,
    residualCount: report.residuals.length,
  };

  fs.writeFileSync(OUT, JSON.stringify(report, null, 2) + '\n');
  console.log('\nWrote', OUT);
  console.log(JSON.stringify(report.summary, null, 2));
  console.log('Alimosho local vs expected:', localCheck.localMatchExpected);
  if (stearsCheck.fetched) console.log('Alimosho Stears vs local:', stearsCheck.matchLocal);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
