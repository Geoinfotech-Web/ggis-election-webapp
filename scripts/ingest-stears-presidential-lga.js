/**
 * Phase 1 — Stears presidential LGA ingest (year-parameterized).
 *
 * Usage:
 *   node scripts/ingest-stears-presidential-lga.js [--year=2023] [--delay=600]
 *
 * Coverage constraint (Phase 0): only years with parties[].lga vote rows are
 * ingested. Discovery says 2023 only for president; 2015/2019 have state votes
 * but empty parties[] on state pages — those years are skipped (not invented).
 *
 * Output:
 *   data/election-results/presidential-{year}-lga.json
 *   scripts/_wiki_raw/stears-pres-lga-{year}-check.json  (aggregate mismatches)
 */
'use strict';

const fs = require('fs');
const path = require('path');
const https = require('https');

const ROOT = path.join(__dirname, '..');
const RAW_DIR = path.join(__dirname, '_wiki_raw');
const DATA_DIR = path.join(ROOT, 'data', 'election-results');
const COVERAGE_PATH = path.join(RAW_DIR, 'stears-coverage.json');

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';

const MAJOR_PARTIES = ['APC', 'LP', 'NNPP', 'PDP'];

/** Fallback display names when Stears omits candidateName on LGA rows. */
const CANDIDATE_FALLBACK = {
  2023: {
    APC: 'Bola Ahmed Tinubu',
    PDP: 'Atiku Abubakar',
    LP: 'Peter Obi',
    NNPP: 'Rabiu Musa Kwankwaso',
  },
};

function parseArgs(argv) {
  const out = { year: 2023, delay: 600 };
  for (const a of argv.slice(2)) {
    const m = a.match(/^--(\w+)=(.+)$/);
    if (!m) continue;
    if (m[1] === 'year') out.year = Number(m[2]);
    if (m[1] === 'delay') out.delay = Number(m[2]);
  }
  return out;
}

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
      reject(new Error(`timeout ${url}`));
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

/** Normalize Stears LGA labels for matching (reuse _build-stears-lga.js ideas). */
function normLgaKey(s) {
  return String(s || '')
    .toUpperCase()
    .replace(/MMC|METROPOLITAN|MAIDUGURI MC/g, 'MAIDUGURI')
    .replace(/KALA[\s\/-]*BAL(?:GE|E)/g, 'KALA/BALGE')
    .replace(/ASKIRA[\s\/)]*UBA/g, 'ASKIRA/UBA')
    .replace(/KWAYA[\s\-]*KUS(?:AR|A)/g, 'KWAYA KUSAR')
    .replace(/MAYO[\s\-]*BELWA|MAYOBELWA/g, 'MAYO BELWA')
    .replace(/DAN[\s\-]*MUSA|DANMUSA/g, 'DAN MUSA')
    .replace(/DUTSIN[\s\-]*MA/g, 'DUTSIN-MA')
    .replace(/MAI[\s\-']*ADUA/g, "MAI'ADUA")
    .replace(/[^A-Z0-9]/g, '');
}

function titleCaseLga(raw) {
  const s = String(raw || '').trim();
  if (!s) return s;
  // Keep common slash / hyphen forms readable.
  return s
    .toLowerCase()
    .split(/(\s+|\/|-)/)
    .map((part) => {
      if (/^(\s+|\/|-)$/.test(part)) return part;
      if (!part) return part;
      return part.charAt(0).toUpperCase() + part.slice(1);
    })
    .join('');
}

function yearHasPresLga(year) {
  if (!fs.existsSync(COVERAGE_PATH)) {
    console.warn('Coverage file missing; allowing year', year, '(no Phase 0 gate)');
    return true;
  }
  const cov = JSON.parse(fs.readFileSync(COVERAGE_PATH, 'utf8'));
  const rec = cov.recommendations?.phase1_presidentialLga;
  if (Array.isArray(rec?.years) && rec.years.length) {
    return rec.years.map(Number).includes(Number(year));
  }
  const row = (cov.coverage || []).find(
    (c) => Number(c.year) === Number(year) && c.office === 'president'
  );
  return !!(row && row.hasLgaVoteRows);
}

function pickWinner(votes, candByParty) {
  const ranked = Object.entries(votes || {})
    .map(([party, v]) => ({ party, votes: Number(v) || 0 }))
    .sort((a, b) => b.votes - a.votes);
  const top = ranked[0];
  if (!top || top.votes <= 0) return { winner: null, party: null };
  return {
    winner: candByParty[top.party] || top.party,
    party: top.party,
  };
}

function buildStateUnits(parties, year) {
  // Stears uses two shapes on state pages:
  //   A) Nested: parties[].lga = [{ name, votes, ... }, ...]  (most states)
  //   B) Flat:   each parties[] row is already one LGA with party.lga string (e.g. Benue, Nasarawa)
  // This builder handles shape B (flat). Shape A is handled by callers that flatten first,
  // or by ingest via https which returns the same flat rows Stears embeds in __NEXT_DATA__.
  const fallback = CANDIDATE_FALLBACK[year] || {};
  const byLga = new Map();
  const candByParty = { ...fallback };

  for (const p of parties || []) {
    if (!p) continue;
    const party = String(p.party || '').trim();
    if (!party) continue;
    const votes = Number(p.votes || p.voteCount || 0);
    const cand = p.candidateName || p.name;
    if (cand && !p.lga) candByParty[party] = cand;
    if (cand && p.lga && !candByParty[party]) candByParty[party] = cand;

    // Nested LGA array (shape A)
    if (Array.isArray(p.lga)) {
      for (const row of p.lga) {
        const lgaName = String(row?.name || row?.lga || '').trim();
        const v = Number(row?.votes || row?.vote || 0);
        if (!lgaName || !Number.isFinite(v) || v <= 0) continue;
        const key = normLgaKey(lgaName);
        if (!byLga.has(key)) {
          byLga.set(key, {
            lga: titleCaseLga(lgaName),
            lgaRaw: lgaName,
            lgaCode: row.lgaCode || null,
            votes: {},
          });
        }
        const dest = byLga.get(key);
        dest.votes[party] = (dest.votes[party] || 0) + v;
        if (cand) candByParty[party] = candByParty[party] || cand;
      }
      continue;
    }

    // Flat LGA string (shape B)
    if (!p.lga) continue;
    if (!Number.isFinite(votes) || votes <= 0) continue;

    const key = normLgaKey(p.lga);
    if (!byLga.has(key)) {
      byLga.set(key, {
        lga: titleCaseLga(p.lga),
        lgaRaw: p.lga,
        lgaCode: p.lgaCode || null,
        votes: {},
      });
    }
    const row = byLga.get(key);
    row.votes[party] = (row.votes[party] || 0) + votes;
    if (cand) candByParty[party] = candByParty[party] || cand;
  }

  // Prefer title-cased Stears raw when it looks already mixed-case.
  const units = {};
  for (const row of byLga.values()) {
    const name = /[a-z]/.test(row.lgaRaw) ? String(row.lgaRaw).trim() : row.lga;
    const { winner, party } = pickWinner(row.votes, candByParty);
    units[name] = {
      winner,
      party,
      votes: row.votes,
      ...(row.lgaCode ? { lgaCode: row.lgaCode } : {}),
    };
  }

  const sums = {};
  for (const u of Object.values(units)) {
    for (const [party, v] of Object.entries(u.votes || {})) {
      sums[party] = (sums[party] || 0) + (Number(v) || 0);
    }
  }

  return { units, sums, candByParty };
}

function loadStateFile(year) {
  const file = path.join(DATA_DIR, `presidential-${year}-states.json`);
  if (!fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function compareAggregates(statePayload, lgaByState) {
  const mismatches = [];
  const ok = [];
  const stateUnits = statePayload?.units || {};
  for (const [state, declared] of Object.entries(stateUnits)) {
    const pack = lgaByState[state];
    if (!pack) {
      mismatches.push({ state, kind: 'missing-state', detail: 'No LGA pack ingested' });
      continue;
    }
    const declaredVotes = declared.votes || {};
    const parties = new Set([
      ...Object.keys(declaredVotes),
      ...Object.keys(pack.sums || {}),
      ...MAJOR_PARTIES,
    ]);
    const diffs = [];
    for (const party of parties) {
      const a = Number(declaredVotes[party] || 0);
      const b = Number(pack.sums[party] || 0);
      const delta = b - a;
      if (delta !== 0) {
        diffs.push({ party, stateFile: a, lgaSum: b, delta });
      }
    }
    if (diffs.length) {
      mismatches.push({
        state,
        kind: 'vote-mismatch',
        lgaCount: Object.keys(pack.units || {}).length,
        diffs,
      });
    } else {
      ok.push({ state, lgaCount: Object.keys(pack.units || {}).length });
    }
  }
  return { mismatches, ok };
}

async function fetchPageProps(url) {
  const res = await fetchText(url);
  if (res.statusCode !== 200) {
    return { ok: false, statusCode: res.statusCode, url, pageProps: null };
  }
  const next = parseNextData(res.body);
  const pageProps = next?.props?.pageProps || null;
  return { ok: !!pageProps, statusCode: res.statusCode, url, pageProps };
}

async function main() {
  const { year, delay } = parseArgs(process.argv);
  const yearId = String(year);

  if (!yearHasPresLga(year)) {
    console.error(
      `Skip year ${year}: Phase 0 coverage has no presidential LGA vote rows.` +
        ` Do not invent LGA data. See ${path.relative(ROOT, COVERAGE_PATH)}.`
    );
    process.exit(2);
  }

  const hubUrl = `https://www.stears.co/elections/${year}/president/`;
  console.log('Fetching hub', hubUrl);
  const hub = await fetchPageProps(hubUrl);
  if (!hub.ok) {
    console.error('Failed hub', hub.statusCode, hubUrl);
    process.exit(1);
  }

  const dropdown = Array.isArray(hub.pageProps.dropdownItems)
    ? hub.pageProps.dropdownItems
    : [];
  const states = dropdown
    .filter((d) => d && d.key && (d.hasElectionActivity !== false))
    .map((d) => ({
      code: String(d.key).toUpperCase(),
      name: String(d.name || d.label || d.key).trim(),
    }));

  if (!states.length) {
    console.error('No active states in dropdownItems');
    process.exit(1);
  }

  console.log(`States to fetch: ${states.length}`);

  const nationalCand = { ...(CANDIDATE_FALLBACK[year] || {}) };
  for (const p of hub.pageProps.parties || []) {
    if (p?.party && (p.candidateName || p.name) && !p.lga) {
      nationalCand[p.party] = p.candidateName || p.name;
    }
  }

  const allUnits = {};
  const lgaByState = {};
  const fetchLog = [];
  let totalLgas = 0;

  for (let i = 0; i < states.length; i += 1) {
    const st = states[i];
    const url = `https://www.stears.co/elections/${year}/president/${st.code}/`;
    process.stdout.write(`[${i + 1}/${states.length}] ${st.code} ${st.name} … `);
    let result;
    try {
      result = await fetchPageProps(url);
    } catch (err) {
      console.log('ERR', err.message || err);
      fetchLog.push({ state: st.name, code: st.code, error: String(err.message || err) });
      await sleep(delay);
      continue;
    }
    if (!result.ok) {
      console.log('HTTP', result.statusCode);
      fetchLog.push({ state: st.name, code: st.code, statusCode: result.statusCode });
      await sleep(delay);
      continue;
    }

    const stateName =
      result.pageProps.stateName ||
      (result.pageProps.parties || []).find((p) => p.stateName)?.stateName ||
      st.name;
    const { units, sums, candByParty } = buildStateUnits(result.pageProps.parties, year);
    const lgaCount = Object.keys(units).length;
    console.log(`${lgaCount} LGAs`);

    // Attach state on each unit for national pack filtering.
    for (const [lga, row] of Object.entries(units)) {
      // Disambiguate duplicate LGA names across states with composite key.
      const key = `${stateName}::${lga}`;
      allUnits[key] = {
        ...row,
        lga,
        state: stateName,
        stateCode: st.code,
      };
    }
    Object.assign(nationalCand, candByParty);
    lgaByState[stateName] = { units, sums, code: st.code };
    totalLgas += lgaCount;
    fetchLog.push({
      state: stateName,
      code: st.code,
      lgaCount,
      statusCode: 200,
    });
    await sleep(delay);
  }

  const statePayload = loadStateFile(yearId);
  const check = compareAggregates(statePayload, lgaByState);

  const candidates = Object.entries(nationalCand)
    .map(([party, name]) => {
      let votes = 0;
      for (const pack of Object.values(lgaByState)) {
        votes += Number(pack.sums[party] || 0);
      }
      return { name, party, votes };
    })
    .filter((c) => c.votes > 0)
    .sort((a, b) => b.votes - a.votes);

  const nationalWinner = candidates[0]
    ? { name: candidates[0].name, party: candidates[0].party, votes: candidates[0].votes }
    : null;

  const out = {
    meta: {
      office: 'pres',
      year: yearId,
      level: 'lga',
      title: `${yearId} Presidential Election — LGA results`,
      source: 'Stears Elections (INEC collation)',
      sourceUrl: hubUrl,
      sourceDetail:
        'LGA party vote tallies extracted from Stears Elections state pages (__NEXT_DATA__.props.pageProps.parties). Underlying official source: INEC.',
      attribution: 'Stears; Independent National Electoral Commission (INEC)',
      updated: new Date().toISOString().slice(0, 10),
      collated: true,
      unitKey: 'state::lga',
      coverage: {
        states: Object.keys(lgaByState).length,
        lgas: totalLgas,
        year: yearId,
      },
      evidence: [
        {
          label: 'Stears presidential hub',
          url: hubUrl,
        },
        {
          label: 'INEC',
          url: 'https://www.inecnigeria.org/',
        },
      ],
    },
    winner: nationalWinner,
    candidates,
    units: allUnits,
  };

  const outPath = path.join(DATA_DIR, `presidential-${yearId}-lga.json`);
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(out, null, 2) + '\n');

  const checkPath = path.join(RAW_DIR, `stears-pres-lga-${yearId}-check.json`);
  fs.mkdirSync(RAW_DIR, { recursive: true });
  fs.writeFileSync(
    checkPath,
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        year: yearId,
        sourceUrl: hubUrl,
        statesFetched: fetchLog.length,
        statesWithLga: Object.keys(lgaByState).length,
        totalLgas,
        matchedStates: check.ok.length,
        mismatchStates: check.mismatches.length,
        mismatches: check.mismatches,
        matched: check.ok,
        fetchLog,
      },
      null,
      2
    ) + '\n'
  );

  console.log('\nWrote', path.relative(ROOT, outPath));
  console.log('States', Object.keys(lgaByState).length, 'LGAs', totalLgas);
  console.log(
    'Aggregate check vs presidential-%s-states.json: %d match, %d mismatch',
    yearId,
    check.ok.length,
    check.mismatches.length
  );
  if (check.mismatches.length) {
    for (const m of check.mismatches.slice(0, 15)) {
      if (m.kind === 'missing-state') {
        console.log('  MISSING', m.state);
      } else {
        const sample = (m.diffs || [])
          .slice(0, 4)
          .map((d) => `${d.party}:${d.delta > 0 ? '+' : ''}${d.delta}`)
          .join(' ');
        console.log(`  ${m.state} (${m.lgaCount} LGAs) ${sample}`);
      }
    }
    if (check.mismatches.length > 15) {
      console.log(`  … +${check.mismatches.length - 15} more (see check JSON)`);
    }
  }
  console.log('Check log', path.relative(ROOT, checkPath));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
