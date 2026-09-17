/**
 * Phase 2 — Upgrade Senate/House archives with Stears constituency vote tallies.
 *
 * Years (from stears-coverage.json):
 *   Senate: 2015, 2019, 2023
 *   House:  2019, 2023  (2015 = winner scaffolds only — skipped)
 *
 * House slug: house-of-representatives (NOT /house/).
 *
 * Usage: node scripts/_build-stears-nass-votes.js [--dry-run] [--office=sen|reps] [--year=2019]
 */
'use strict';

const fs = require('fs');
const path = require('path');
const https = require('https');

const ROOT = path.join(__dirname, '..');
const CACHE_DIR = path.join(__dirname, '_wiki_raw', 'stears-nass');
const SEN_DIR = path.join(ROOT, 'data', 'election-results', 'senatorial');
const HOUSE_DIR = path.join(ROOT, 'data', 'election-results', 'house');
const REPORT_OUT = path.join(__dirname, '_wiki_raw', 'stears-nass-upgrade-report.json');

const DELAY_MS = 700;
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';

const JOBS = [
  { office: 'sen', year: 2015, slug: 'senate', dir: SEN_DIR },
  { office: 'sen', year: 2019, slug: 'senate', dir: SEN_DIR },
  { office: 'sen', year: 2023, slug: 'senate', dir: SEN_DIR },
  { office: 'reps', year: 2019, slug: 'house-of-representatives', dir: HOUSE_DIR },
  { office: 'reps', year: 2023, slug: 'house-of-representatives', dir: HOUSE_DIR },
];

const CODE_TO_STATE = {
  AB: 'Abia',
  AD: 'Adamawa',
  AK: 'Akwa Ibom',
  AN: 'Anambra',
  BA: 'Bauchi',
  BY: 'Bayelsa',
  BE: 'Benue',
  BO: 'Borno',
  CR: 'Cross River',
  DE: 'Delta',
  EB: 'Ebonyi',
  ED: 'Edo',
  EK: 'Ekiti',
  EN: 'Enugu',
  FC: 'FCT',
  GO: 'Gombe',
  IM: 'Imo',
  JI: 'Jigawa',
  KD: 'Kaduna',
  KN: 'Kano',
  KT: 'Katsina',
  KE: 'Kebbi',
  KO: 'Kogi',
  KW: 'Kwara',
  LA: 'Lagos',
  NA: 'Nasarawa',
  NI: 'Niger',
  OG: 'Ogun',
  ON: 'Ondo',
  OS: 'Osun',
  OY: 'Oyo',
  PL: 'Plateau',
  RI: 'Rivers',
  SO: 'Sokoto',
  TA: 'Taraba',
  YO: 'Yobe',
  ZA: 'Zamfara',
};

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const onlyOffice = (args.find((a) => a.startsWith('--office=')) || '').split('=')[1];
const onlyYear = (args.find((a) => a.startsWith('--year=')) || '').split('=')[1];

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function fetchText(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(
      url,
      {
        headers: { 'User-Agent': UA, Accept: 'text/html', 'Accept-Language': 'en-US,en;q=0.9' },
        timeout: 60000,
      },
      (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          res.resume();
          const next = res.headers.location.startsWith('http')
            ? res.headers.location
            : new URL(res.headers.location, url).href;
          return fetchText(next).then(resolve, reject);
        }
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () =>
          resolve({
            statusCode: res.statusCode,
            url,
            body: Buffer.concat(chunks).toString('utf8'),
          })
        );
      }
    );
    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('timeout'));
    });
  });
}

function parseNextData(html) {
  const marker = 'id="__NEXT_DATA__"';
  const i = html.indexOf(marker);
  if (i < 0) return null;
  const start = html.indexOf('>', i) + 1;
  const end = html.indexOf('</script>', start);
  if (start <= 0 || end < 0) return null;
  try {
    return JSON.parse(html.slice(start, end));
  } catch {
    return null;
  }
}

function isFakeConstituencyLabel(name) {
  return /^(president|governor)$/i.test(String(name || '').trim());
}

function slugify(s) {
  return String(s || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

function normDistrict(s) {
  return String(s || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/SENATORIAL\s*(DISTRICT)?/g, '')
    .replace(/FEDERAL\s*CONSTITUENCY/g, '')
    .replace(/CONSTITUENCY/g, '')
    .replace(/&/g, '/')
    .replace(/[^A-Z0-9]/g, '');
}

function voteOf(p) {
  const v = Number(p && (p.votes != null ? p.votes : p.voteCount));
  return Number.isFinite(v) && v > 0 ? v : 0;
}

function candidateName(p) {
  return String(p.candidateName || p.name || '').trim() || null;
}

function resolveStateName(code, fallbackName) {
  const c = String(code || '').toUpperCase();
  if (CODE_TO_STATE[c]) return CODE_TO_STATE[c];
  const raw = String(fallbackName || '').replace(/\s*State$/i, '').trim();
  if (/^(fct|abuja|federal capital)/i.test(raw)) return 'FCT';
  if (!raw) return c || null;
  return raw.replace(/\b([a-z])/g, (m) => m.toUpperCase()).replace(/\bOf\b/g, 'of');
}

function findArchivePath(dir, state, year) {
  const y = String(year);
  const primary = path.join(dir, `${slugify(state)}-${y}.json`);
  if (fs.existsSync(primary)) return primary;
  // Nasarawa / Nassarawa typo variants
  const alts = [];
  if (/^nasarawa$/i.test(state)) alts.push(`nassarawa-${y}.json`);
  if (/^nassarawa$/i.test(state)) alts.push(`nasarawa-${y}.json`);
  if (/^fct$/i.test(state)) alts.push(`abuja-${y}.json`, `federal-capital-territory-${y}.json`);
  for (const a of alts) {
    const p = path.join(dir, a);
    if (fs.existsSync(p)) return p;
  }
  // Fuzzy: any file for year whose meta.state matches
  if (!fs.existsSync(dir)) return null;
  for (const f of fs.readdirSync(dir)) {
    if (!f.endsWith(`-${y}.json`)) continue;
    try {
      const payload = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
      const st = String(payload.meta?.state || '');
      if (slugify(st) === slugify(state)) return path.join(dir, f);
      if (/nasarawa/i.test(state) && /nass?arawa/i.test(st)) return path.join(dir, f);
    } catch {
      /* skip */
    }
  }
  return null;
}

function cachePath(slug, year, stateCode) {
  const name = stateCode ? `${slug}-${year}-${stateCode}.html` : `${slug}-${year}-national.html`;
  return path.join(CACHE_DIR, name);
}

async function loadPage(url, cacheFile) {
  if (fs.existsSync(cacheFile)) {
    const html = fs.readFileSync(cacheFile, 'utf8');
    const next = parseNextData(html);
    if (next) return { statusCode: 200, url, fromCache: true, pageProps: next.props?.pageProps || null };
  }
  const res = await fetchText(url);
  if (res.statusCode === 200 && res.body) {
    fs.mkdirSync(path.dirname(cacheFile), { recursive: true });
    fs.writeFileSync(cacheFile, res.body, 'utf8');
  }
  const next = res.statusCode === 200 ? parseNextData(res.body) : null;
  return {
    statusCode: res.statusCode,
    url,
    fromCache: false,
    pageProps: next?.props?.pageProps || null,
  };
}

function constituencyRows(parties) {
  return (parties || []).filter((p) => {
    if (!p) return false;
    if (p.lga) return false;
    if (isFakeConstituencyLabel(p.constituencyName)) return false;
    return Boolean(p.constituencyName || p.constituencyCode);
  });
}

function groupByStateAndDistrict(parties) {
  /** @type {Map<string, Map<string, object[]>>} */
  const byState = new Map();
  for (const p of constituencyRows(parties)) {
    const state = resolveStateName(p.stateCode, p.stateName);
    if (!state) continue;
    const district = String(p.constituencyName || p.constituencyCode || '').trim();
    if (!district) continue;
    if (!byState.has(state)) byState.set(state, new Map());
    const distMap = byState.get(state);
    if (!distMap.has(district)) distMap.set(district, []);
    distMap.get(district).push(p);
  }
  return byState;
}

function matchDistrict(target, stearsDistricts) {
  const want = normDistrict(target);
  if (!want) return null;
  const list = [...stearsDistricts.keys()];
  let hit = list.find((d) => normDistrict(d) === want);
  if (hit) return hit;
  hit = list.find((d) => {
    const n = normDistrict(d);
    return n.includes(want) || want.includes(n);
  });
  if (hit) return hit;
  // token overlap (e.g. AJEROMI/IFELODUN vs AJEROMIIFELODUN)
  const tokens = want.match(/[A-Z]{3,}/g) || [];
  if (tokens.length >= 2) {
    hit = list.find((d) => {
      const n = normDistrict(d);
      return tokens.every((t) => n.includes(t));
    });
  }
  return hit || null;
}

function buildSeatFromStears(district, rows) {
  const candidates = rows
    .map((p) => ({
      name: candidateName(p) || p.party,
      party: String(p.party || 'Others').trim() || 'Others',
      votes: voteOf(p) || null,
      outcome: p.won ? 'Won' : voteOf(p) > 0 ? 'Lost' : null,
      _won: !!p.won,
    }))
    .sort((a, b) => (Number(b.votes) || 0) - (Number(a.votes) || 0));

  let winner = candidates.find((c) => c._won) || candidates.find((c) => c.votes > 0) || candidates[0];
  if (!winner && candidates.length) winner = candidates[0];

  const cleaned = candidates.map(({ _won, ...rest }) => {
    if (rest.outcome == null) {
      if (winner && rest.name === winner.name && rest.party === winner.party) rest.outcome = 'Won';
      else if (rest.votes != null) rest.outcome = 'Lost';
    }
    return rest;
  });

  const hasVotes = cleaned.some((c) => Number(c.votes) > 0);
  return {
    district,
    winner: winner ? { name: winner.name, party: winner.party } : null,
    candidates: cleaned,
    hasVotes,
  };
}

function mergeStatePayload(existing, stearsDistMap, metaPatch) {
  const usedStears = new Set();
  const seats = [];
  let seatsWithVotes = 0;
  let matched = 0;
  let unmatchedExisting = 0;

  for (const seat of existing.seats || []) {
    const district = seat.district || seat.constituency;
    const stearsKey = matchDistrict(district, stearsDistMap);
    if (stearsKey) {
      usedStears.add(stearsKey);
      const built = buildSeatFromStears(district, stearsDistMap.get(stearsKey));
      seats.push({
        district,
        winner: built.winner || seat.winner,
        candidates: built.candidates.length ? built.candidates : seat.candidates,
      });
      if (built.hasVotes) seatsWithVotes += 1;
      matched += 1;
    } else {
      unmatchedExisting += 1;
      seats.push(seat);
    }
  }

  // Add Stears districts not present in scaffold
  for (const [stearsDistrict, rows] of stearsDistMap.entries()) {
    if (usedStears.has(stearsDistrict)) continue;
    const built = buildSeatFromStears(stearsDistrict, rows);
    seats.push({
      district: stearsDistrict,
      winner: built.winner,
      candidates: built.candidates,
    });
    if (built.hasVotes) seatsWithVotes += 1;
  }

  const candidates = [];
  for (const seat of seats) {
    for (const c of seat.candidates || []) {
      candidates.push({
        name: c.name,
        party: c.party,
        district: seat.district,
        votes: c.votes,
      });
    }
  }

  const collated = seatsWithVotes > 0;
  const meta = {
    ...existing.meta,
    ...metaPatch,
    collated,
    note: collated
      ? 'Constituency vote totals collated from Stears Elections (__NEXT_DATA__), sourced from INEC/IREV and LGA collation.'
      : existing.meta?.note || 'Winner-only scaffold; Stears had no vote tallies for this state/year.',
    updated: new Date().toISOString().slice(0, 10),
  };

  return {
    payload: { meta, seats, candidates },
    stats: {
      matched,
      unmatchedExisting,
      seatsTotal: seats.length,
      seatsWithVotes,
      stearsDistricts: stearsDistMap.size,
      collated,
    },
  };
}

function loadCachedPartiesJson(job) {
  // Prefer Playwright/offline extracts: scripts/_wiki_raw/stears-nass/{senate|house}-{year}-national.json
  const key = job.office === 'sen' ? 'senate' : 'house';
  const file = path.join(CACHE_DIR, `${key}-${job.year}-national.json`);
  if (!fs.existsSync(file)) return null;
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    return {
      parties: raw.parties || raw.pageProps?.parties || [],
      dropdown: raw.dropdown || raw.dropdownItems || raw.pageProps?.dropdownItems || [],
      sourceUrl: raw.url || `https://www.stears.co/elections/${job.year}/${job.slug}/`,
      fromCache: true,
    };
  } catch {
    return null;
  }
}

function loadCachedStateParties(job, code) {
  const key = job.office === 'sen' ? 'senate' : 'house';
  const file = path.join(CACHE_DIR, `${key}-${job.year}-${code}.json`);
  if (!fs.existsSync(file)) return null;
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    return {
      parties: raw.parties || [],
      stateName: raw.stateName,
      fromCache: true,
    };
  } catch {
    return null;
  }
}

async function collectStearsForJob(job) {
  const nationalUrl = `https://www.stears.co/elections/${job.year}/${job.slug}/`;
  console.log(`\n=== ${job.office} ${job.year} — national ===`);

  const offline = loadCachedPartiesJson(job);
  let nationalParties;
  let dropdown;
  let sourceUrl = nationalUrl;

  if (offline && (offline.parties || []).length) {
    console.log(`  using offline cache (${offline.parties.length} parties)`);
    nationalParties = offline.parties;
    dropdown = offline.dropdown || [];
    sourceUrl = offline.sourceUrl || nationalUrl;
  } else {
    const national = await loadPage(nationalUrl, cachePath(job.slug, job.year, null));
    if (national.statusCode !== 200 || !national.pageProps) {
      console.warn(`  national failed: HTTP ${national.statusCode}`);
      return { byState: new Map(), sourceUrl: nationalUrl, activeCodes: [] };
    }
    nationalParties = national.pageProps.parties || [];
    dropdown = Array.isArray(national.pageProps.dropdownItems)
      ? national.pageProps.dropdownItems
      : [];
  }

  let activeCodes = (dropdown || [])
    .filter((d) => d && d.hasElectionActivity && d.key)
    .map((d) => String(d.key).toUpperCase());
  if (!activeCodes.length) activeCodes = Object.keys(CODE_TO_STATE);

  let byState = groupByStateAndDistrict(nationalParties);
  let voteRows = 0;
  for (const distMap of byState.values()) {
    for (const rows of distMap.values()) {
      voteRows += rows.filter((r) => voteOf(r) > 0).length;
    }
  }
  console.log(
    `  national: states=${byState.size} constituencyVoteRows≈${voteRows} active=${activeCodes.length}`
  );

  // Senate 2015 (and any sparse national) needs per-state pages.
  // Also fetch state pages when a state has no vote rows on national.
  const needStateFetch = new Set();
  if (job.year === 2015 && job.office === 'sen') {
    activeCodes.forEach((c) => needStateFetch.add(c));
  } else {
    for (const code of activeCodes) {
      const state = CODE_TO_STATE[code] || code;
      const distMap = byState.get(state);
      let votes = 0;
      if (distMap) {
        for (const rows of distMap.values()) votes += rows.filter((r) => voteOf(r) > 0).length;
      }
      if (votes === 0) needStateFetch.add(code);
    }
  }

  // House/Senate 2019+ usually have full national tallies; still fill gaps via state pages.
  for (const code of needStateFetch) {
    process.stdout.write(`  state ${code}... `);
    try {
      let stateParties = null;
      let stateNameHint = null;
      let fromCache = false;

      const offlineState = loadCachedStateParties(job, code);
      if (offlineState && offlineState.parties.length) {
        stateParties = constituencyRows(offlineState.parties);
        stateNameHint = offlineState.stateName;
        fromCache = true;
      } else {
        await sleep(DELAY_MS);
        const url = `https://www.stears.co/elections/${job.year}/${job.slug}/${code}/`;
        const page = await loadPage(url, cachePath(job.slug, job.year, code));
        if (page.statusCode !== 200 || !page.pageProps) {
          console.log(`HTTP ${page.statusCode}`);
          continue;
        }
        stateParties = constituencyRows(page.pageProps.parties || []);
        stateNameHint = page.pageProps.stateName || page.pageProps.state;
        fromCache = !!page.fromCache;
      }

      const stateName =
        resolveStateName(code, stateNameHint) || CODE_TO_STATE[code] || code;
      const distMap = new Map();
      for (const p of stateParties || []) {
        const district = String(p.constituencyName || p.constituencyCode || '').trim();
        if (!district) continue;
        if (!distMap.has(district)) distMap.set(district, []);
        distMap.get(district).push({ ...p, stateCode: code, stateName });
      }
      if (distMap.size) {
        byState.set(stateName, distMap);
        const vr = [...distMap.values()].reduce(
          (a, rows) => a + rows.filter((r) => voteOf(r) > 0).length,
          0
        );
        console.log(`districts=${distMap.size} voteRows=${vr}${fromCache ? ' (cache)' : ''}`);
      } else {
        console.log('no constituency rows');
      }
    } catch (err) {
      console.log(`err ${err.message}`);
    }
  }

  return { byState, sourceUrl, activeCodes };
}

function upgradeJob(job, stears) {
  const results = {
    office: job.office,
    year: job.year,
    filesUpdated: 0,
    filesSkipped: 0,
    filesMissing: [],
    statesWithVotes: [],
    statesWithoutVotes: [],
    details: [],
  };

  const metaPatch = {
    source: 'Stears Elections + INEC',
    sourceDetail: `Stears ${job.year} ${job.slug} constituency results (__NEXT_DATA__); underlying INEC/IREV and LGA collation`,
    attribution: 'Stears Elections; Independent National Electoral Commission (INEC)',
    sourceUrl: stears.sourceUrl,
  };

  for (const [state, distMap] of stears.byState.entries()) {
    const archivePath = findArchivePath(job.dir, state, job.year);
    if (!archivePath) {
      results.filesMissing.push(state);
      continue;
    }

    let existing;
    try {
      existing = JSON.parse(fs.readFileSync(archivePath, 'utf8'));
    } catch (err) {
      results.details.push({ state, error: err.message });
      continue;
    }

    const { payload, stats } = mergeStatePayload(existing, distMap, metaPatch);
    results.details.push({ state, file: path.relative(ROOT, archivePath), ...stats });

    if (stats.seatsWithVotes > 0) {
      results.statesWithVotes.push(state);
      if (!DRY_RUN) {
        fs.writeFileSync(archivePath, JSON.stringify(payload, null, 2) + '\n', 'utf8');
      }
      results.filesUpdated += 1;
    } else {
      results.statesWithoutVotes.push(state);
      results.filesSkipped += 1;
    }
  }

  // Report archive states for this year that Stears never mentioned
  if (fs.existsSync(job.dir)) {
    const y = String(job.year);
    for (const f of fs.readdirSync(job.dir)) {
      if (!f.endsWith(`-${y}.json`)) continue;
      try {
        const payload = JSON.parse(fs.readFileSync(path.join(job.dir, f), 'utf8'));
        const st = payload.meta?.state;
        if (st && !stears.byState.has(st) && !results.filesMissing.includes(st)) {
          // Check alias
          const found = [...stears.byState.keys()].some((k) => slugify(k) === slugify(st));
          if (!found) results.filesMissing.push(st);
        }
      } catch {
        /* ignore */
      }
    }
  }

  return results;
}

async function main() {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  const jobs = JOBS.filter((j) => {
    if (onlyOffice && j.office !== onlyOffice) return false;
    if (onlyYear && String(j.year) !== String(onlyYear)) return false;
    return true;
  });

  console.log(`Phase 2 NASS votes — ${jobs.length} job(s)${DRY_RUN ? ' [DRY RUN]' : ''}`);
  const report = {
    generatedAt: new Date().toISOString(),
    dryRun: DRY_RUN,
    jobs: [],
  };

  for (const job of jobs) {
    const stears = await collectStearsForJob(job);
    const result = upgradeJob(job, stears);
    report.jobs.push(result);
    console.log(
      `  → updated ${result.filesUpdated}, skipped(no votes) ${result.filesSkipped}, missing archive ${result.filesMissing.length}`
    );
  }

  fs.writeFileSync(REPORT_OUT, JSON.stringify(report, null, 2) + '\n', 'utf8');
  console.log(`\nReport: ${REPORT_OUT}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
