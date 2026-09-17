/**
 * Phase 0 — Stears year × office discovery.
 * Probes /elections/{year}/{office}/ (+ sample state) and writes
 * scripts/_wiki_raw/stears-coverage.json
 *
 * House slug is house-of-representatives (not /house/).
 * LGA votes = parties[] with lga + votes>0 (same shape as _build-stears-lga.js).
 */
'use strict';

const fs = require('fs');
const path = require('path');
const https = require('https');

const DIR = path.join(__dirname, '_wiki_raw');
const OUT = path.join(DIR, 'stears-coverage.json');
const YEARS = [2015, 2016, 2017, 2018, 2019, 2020, 2021, 2022, 2023, 2024];
const DELAY_MS = 800;
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';

const OFFICES = [
  { office: 'president', slug: 'president' },
  { office: 'governor', slug: 'governor' },
  { office: 'senate', slug: 'senate' },
  { office: 'house', slug: 'house-of-representatives' },
];

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function fetchText(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(
      url,
      {
        headers: { 'User-Agent': UA, Accept: 'text/html', 'Accept-Language': 'en-US,en;q=0.9' },
        timeout: 45000,
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
          resolve({ statusCode: res.statusCode, url, body: Buffer.concat(chunks).toString('utf8') })
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

function analyze(pp) {
  if (!pp || typeof pp !== 'object') {
    return {
      hasNationalData: false,
      hasLgaOrConstituency: false,
      hasLgaVoteRows: false,
      hasConstituencyVoteRows: false,
      hasStateVoteRows: false,
      hasWinnerScaffoldOnly: false,
      pagePropsKeys: [],
      sampleKeys: [],
      signals: {},
      skipReason: 'no pageProps',
    };
  }

  const parties = Array.isArray(pp.parties) ? pp.parties : [];
  const withLga = parties.filter((p) => p && p.lga && Number(p.votes || p.voteCount) > 0);
  const withConst = parties.filter((p) => {
    if (!p || !(Number(p.votes || p.voteCount) > 0) || p.lga) return false;
    if (isFakeConstituencyLabel(p.constituencyName)) return false;
    return Boolean(p.constituencyName || p.constituencyCode);
  });
  const withState = parties.filter((p) => {
    if (!p || !(Number(p.votes || p.voteCount) > 0) || p.lga) return false;
    return !p.constituencyName || isFakeConstituencyLabel(p.constituencyName);
  });
  const withVotes = parties.filter((p) => Number(p && (p.votes || p.voteCount)) > 0);
  const winners = parties.filter((p) => p && p.won);
  const dropdown = Array.isArray(pp.dropdownItems) ? pp.dropdownItems : [];
  const activeStateCodes = dropdown.filter((d) => d && d.hasElectionActivity).map((d) => d.key);

  const hasLgaVoteRows = withLga.length > 0;
  const hasConstituencyVoteRows = withConst.length > 0;
  const hasStateVoteRows = withState.length > 0;
  const hasWinnerScaffoldOnly = parties.length > 0 && withVotes.length === 0 && winners.length > 0;
  const hasNationalData =
    withVotes.length > 0 || activeStateCodes.length > 0 || hasWinnerScaffoldOnly;
  const hasLgaOrConstituency = hasLgaVoteRows || hasConstituencyVoteRows;

  let skipReason = null;
  if (!hasNationalData && !hasLgaOrConstituency) {
    skipReason = 'empty shell / no collated results';
  } else if (hasWinnerScaffoldOnly && !hasLgaOrConstituency) {
    skipReason = 'winner scaffolds only — no vote tallies in parties[]';
  }

  const sample =
    withLga[0] || withConst[0] || withState[0] || winners[0] || parties[0] || null;

  return {
    hasNationalData,
    hasLgaOrConstituency,
    hasLgaVoteRows,
    hasConstituencyVoteRows,
    hasStateVoteRows,
    hasWinnerScaffoldOnly,
    pagePropsKeys: Object.keys(pp),
    sampleKeys: sample ? Object.keys(sample) : [],
    signals: {
      partiesCount: parties.length,
      partiesWithVotes: withVotes.length,
      lgaVoteRows: withLga.length,
      constituencyVoteRows: withConst.length,
      stateVoteRows: withState.length,
      winners: winners.length,
      activeStates: activeStateCodes.length,
      activeStateCodes,
      race: pp.race || null,
      level: pp.level || null,
    },
    skipReason,
  };
}

async function probe(url) {
  const t0 = Date.now();
  try {
    const res = await fetchText(url);
    const fetchMs = Date.now() - t0;
    if (res.statusCode === 404) {
      return {
        url,
        httpStatus: 404,
        fetchMs,
        hasNationalData: false,
        hasLgaOrConstituency: false,
        hasLgaVoteRows: false,
        hasConstituencyVoteRows: false,
        hasStateVoteRows: false,
        hasWinnerScaffoldOnly: false,
        sampleKeys: [],
        pagePropsKeys: [],
        signals: {},
        skipReason: 'HTTP 404',
      };
    }
    if (res.statusCode === 403 || res.statusCode === 429) {
      return {
        url,
        httpStatus: res.statusCode,
        fetchMs,
        hasNationalData: false,
        hasLgaOrConstituency: false,
        hasLgaVoteRows: false,
        hasConstituencyVoteRows: false,
        hasStateVoteRows: false,
        hasWinnerScaffoldOnly: false,
        sampleKeys: [],
        pagePropsKeys: [],
        signals: {},
        skipReason: res.statusCode === 429 ? 'rate limited' : 'forbidden / blocked',
        blocker: true,
      };
    }
    if (res.statusCode >= 400) {
      return {
        url,
        httpStatus: res.statusCode,
        fetchMs,
        hasNationalData: false,
        hasLgaOrConstituency: false,
        hasLgaVoteRows: false,
        hasConstituencyVoteRows: false,
        hasStateVoteRows: false,
        hasWinnerScaffoldOnly: false,
        sampleKeys: [],
        pagePropsKeys: [],
        signals: {},
        skipReason: `HTTP ${res.statusCode}`,
      };
    }
    const next = parseNextData(res.body);
    if (!next) {
      return {
        url,
        httpStatus: res.statusCode,
        fetchMs,
        hasNationalData: false,
        hasLgaOrConstituency: false,
        hasLgaVoteRows: false,
        hasConstituencyVoteRows: false,
        hasStateVoteRows: false,
        hasWinnerScaffoldOnly: false,
        sampleKeys: [],
        pagePropsKeys: [],
        signals: { htmlBytes: res.body.length },
        skipReason: 'no __NEXT_DATA__',
      };
    }
    const a = analyze(next.props && next.props.pageProps);
    return {
      url,
      httpStatus: res.statusCode,
      fetchMs,
      ...a,
      signals: { ...a.signals, htmlBytes: res.body.length },
    };
  } catch (err) {
    return {
      url,
      httpStatus: null,
      fetchMs: Date.now() - t0,
      hasNationalData: false,
      hasLgaOrConstituency: false,
      hasLgaVoteRows: false,
      hasConstituencyVoteRows: false,
      hasStateVoteRows: false,
      hasWinnerScaffoldOnly: false,
      sampleKeys: [],
      pagePropsKeys: [],
      signals: {},
      skipReason: `fetch error: ${err.message}`,
      blocker: true,
    };
  }
}

async function main() {
  if (!fs.existsSync(DIR)) fs.mkdirSync(DIR, { recursive: true });

  const coverage = [];
  const blockers = [];

  console.log('Stears Phase 0 discovery');
  for (const year of YEARS) {
    for (const { office, slug } of OFFICES) {
      const nationalUrl = `https://www.stears.co/elections/${year}/${slug}/`;
      process.stdout.write(`probe ${year} ${office} ... `);
      const national = await probe(nationalUrl);
      console.log(
        national.httpStatus,
        national.hasLgaVoteRows ? 'LGA' : national.hasConstituencyVoteRows ? 'CONST' : national.hasNationalData ? 'NAT' : 'empty',
        national.skipReason || '',
        `${national.fetchMs}ms`
      );
      if (national.blocker) blockers.push({ year, office, level: 'national', ...national });

      let stateSample = null;
      const promising =
        national.hasNationalData ||
        national.hasLgaOrConstituency ||
        (national.signals && national.signals.activeStates > 0);
      if (promising) {
        await sleep(DELAY_MS);
        const codes = (national.signals && national.signals.activeStateCodes) || [];
        const sampleCode = codes.includes('LA') ? 'LA' : codes[0] || 'LA';
        stateSample = await probe(`https://www.stears.co/elections/${year}/${slug}/${sampleCode}/`);
        stateSample.sampleState = sampleCode;
        console.log(
          `  ${sampleCode}`,
          stateSample.httpStatus,
          `lga=${stateSample.hasLgaVoteRows}`,
          `const=${stateSample.hasConstituencyVoteRows}`,
          stateSample.skipReason || ''
        );
        if (stateSample.blocker) {
          blockers.push({ year, office, level: 'state', state: sampleCode, ...stateSample });
        }
      }

      const hasLgaVoteRows = Boolean(national.hasLgaVoteRows || (stateSample && stateSample.hasLgaVoteRows));
      const hasConstituencyVoteRows = Boolean(
        national.hasConstituencyVoteRows || (stateSample && stateSample.hasConstituencyVoteRows)
      );
      const hasNationalData = Boolean(
        national.hasNationalData || (stateSample && stateSample.hasNationalData)
      );
      const hasLgaOrConstituency = hasLgaVoteRows || hasConstituencyVoteRows;

      let skipReason = null;
      if (!hasNationalData && !hasLgaOrConstituency) {
        skipReason = national.skipReason || (stateSample && stateSample.skipReason) || 'no data';
      } else if (national.hasWinnerScaffoldOnly && !hasLgaOrConstituency) {
        skipReason = 'winner scaffolds only — no vote tallies in parties[]';
      }

      coverage.push({
        year,
        office,
        hasNationalData,
        hasLgaOrConstituency,
        hasLgaVoteRows,
        hasConstituencyVoteRows,
        hasStateVoteRows: Boolean(national.hasStateVoteRows || (stateSample && stateSample.hasStateVoteRows)),
        hasWinnerScaffoldOnly: Boolean(
          national.hasWinnerScaffoldOnly || (stateSample && stateSample.hasWinnerScaffoldOnly)
        ),
        sampleKeys: (stateSample && stateSample.sampleKeys.length
          ? stateSample.sampleKeys
          : national.sampleKeys) || [],
        skipReason,
        national: {
          url: national.url,
          httpStatus: national.httpStatus,
          pagePropsKeys: national.pagePropsKeys,
          signals: national.signals,
          skipReason: national.skipReason,
        },
        stateSample: stateSample
          ? {
              state: stateSample.sampleState,
              url: stateSample.url,
              httpStatus: stateSample.httpStatus,
              hasLgaVoteRows: stateSample.hasLgaVoteRows,
              hasConstituencyVoteRows: stateSample.hasConstituencyVoteRows,
              pagePropsKeys: stateSample.pagePropsKeys,
              sampleKeys: stateSample.sampleKeys,
              signals: stateSample.signals,
              skipReason: stateSample.skipReason,
            }
          : null,
      });

      await sleep(DELAY_MS);
    }
  }

  const recommendations = {
    phase1_presidentialLga: coverage
      .filter((c) => c.office === 'president' && c.hasLgaVoteRows)
      .map((c) => c.year),
    phase1_presidentialNationalVotes: coverage
      .filter((c) => c.office === 'president' && c.hasNationalData)
      .map((c) => c.year),
    phase2_senate: coverage
      .filter((c) => c.office === 'senate' && c.hasConstituencyVoteRows)
      .map((c) => c.year),
    phase2_house: coverage
      .filter((c) => c.office === 'house' && c.hasConstituencyVoteRows)
      .map((c) => c.year),
    phase3_governorWithLgaVotes: coverage
      .filter((c) => c.office === 'governor' && c.hasLgaVoteRows)
      .map((c) => c.year),
    phase3_governorNationalOrActive: coverage
      .filter((c) => c.office === 'governor' && c.hasNationalData)
      .map((c) => c.year),
  };

  const report = {
    generatedAt: new Date().toISOString(),
    source: 'https://www.stears.co/elections/',
    probeMethod:
      '__NEXT_DATA__ pageProps; LGA=parties[].lga+votes; constituency excludes President/Governor labels; house slug=house-of-representatives',
    sampleStatePreference: 'LA, else first active dropdown state',
    yearsProbed: YEARS,
    officesProbed: OFFICES.map((o) => o.office),
    officeUrlPatterns: Object.fromEntries(
      OFFICES.map((o) => [o.office, `/elections/{year}/${o.slug}/`])
    ),
    coverage,
    recommendations,
    blockers,
    summary: {
      cellsWithNationalOrActiveData: coverage.filter((c) => c.hasNationalData).length,
      cellsWithLgaVoteRows: coverage.filter((c) => c.hasLgaVoteRows).length,
      cellsWithConstituencyVoteRows: coverage.filter((c) => c.hasConstituencyVoteRows).length,
      cellsEmpty: coverage.filter((c) => !c.hasNationalData && !c.hasLgaOrConstituency).length,
      blockerCount: blockers.length,
    },
    discoveryScript: 'scripts/_discover-stears-coverage.js',
  };

  fs.writeFileSync(OUT, JSON.stringify(report, null, 2));
  console.log('\nWrote', OUT);
  console.log('Summary', report.summary);
  console.log('Recommendations', JSON.stringify(recommendations, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
