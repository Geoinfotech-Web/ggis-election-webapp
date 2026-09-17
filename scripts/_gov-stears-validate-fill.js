/**
 * Phase 3 — Stears 2023 governor LGA vs local gubernatorial packs.
 * - Diff / validate against data/election-results/gubernatorial/* (+ official/*-lga.json)
 * - Fill only missing/estimated year×state (do not overwrite good collated packs)
 * - Focus calendar 2023 LGA (local storage year often 2022 for March 2023 cycle)
 *
 * Writes:
 *   scripts/_wiki_raw/gov-stears-2023-validation.json
 *   updated gubernatorial + official files when filling gaps
 */
'use strict';

const fs = require('fs');
const path = require('path');
const https = require('https');

const ROOT = path.join(__dirname, '..');
const DIR = path.join(__dirname, '_wiki_raw');
const GOV_DIR = path.join(ROOT, 'data', 'election-results', 'gubernatorial');
const OFF_DIR = path.join(ROOT, 'data', 'election-results', 'official');
const OUT = path.join(DIR, 'gov-stears-2023-validation.json');

const YEAR = 2023;
const DELAY_MS = 700;
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';

/** Stears stateCode → { name, slug } */
const STATE_MAP = {
  AB: { name: 'Abia', slug: 'abia' },
  AD: { name: 'Adamawa', slug: 'adamawa' },
  AK: { name: 'Akwa Ibom', slug: 'akwa-ibom' },
  AN: { name: 'Anambra', slug: 'anambra' },
  BA: { name: 'Bauchi', slug: 'bauchi' },
  BY: { name: 'Bayelsa', slug: 'bayelsa' },
  BE: { name: 'Benue', slug: 'benue' },
  BO: { name: 'Borno', slug: 'borno' },
  CR: { name: 'Cross River', slug: 'cross-river' },
  DE: { name: 'Delta', slug: 'delta' },
  EB: { name: 'Ebonyi', slug: 'ebonyi' },
  ED: { name: 'Edo', slug: 'edo' },
  EK: { name: 'Ekiti', slug: 'ekiti' },
  EN: { name: 'Enugu', slug: 'enugu' },
  GO: { name: 'Gombe', slug: 'gombe' },
  IM: { name: 'Imo', slug: 'imo' },
  JI: { name: 'Jigawa', slug: 'jigawa' },
  KD: { name: 'Kaduna', slug: 'kaduna' },
  KN: { name: 'Kano', slug: 'kano' },
  KT: { name: 'Katsina', slug: 'katsina' },
  KE: { name: 'Kebbi', slug: 'kebbi' },
  KO: { name: 'Kogi', slug: 'kogi' },
  KW: { name: 'Kwara', slug: 'kwara' },
  LA: { name: 'Lagos', slug: 'lagos' },
  NA: { name: 'Nasarawa', slug: 'nasarawa' },
  NI: { name: 'Niger', slug: 'niger' },
  OG: { name: 'Ogun', slug: 'ogun' },
  ON: { name: 'Ondo', slug: 'ondo' },
  OS: { name: 'Osun', slug: 'osun' },
  OY: { name: 'Oyo', slug: 'oyo' },
  PL: { name: 'Plateau', slug: 'plateau' },
  RI: { name: 'Rivers', slug: 'rivers' },
  SO: { name: 'Sokoto', slug: 'sokoto' },
  TA: { name: 'Taraba', slug: 'taraba' },
  YO: { name: 'Yobe', slug: 'yobe' },
  ZA: { name: 'Zamfara', slug: 'zamfara' },
  FC: { name: 'FCT', slug: 'fct' },
};

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

function norm(s) {
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
    .replace(/AJEROMI[\s\/-]*IFELODUN/g, 'AJEROMI/IFELODUN')
    .replace(/OSODI[\s\/-]*ISOLO/g, 'OSODI/ISOLO')
    .replace(/[^A-Z0-9]/g, '');
}

function titleCaseLga(raw) {
  const s = String(raw || '').trim();
  if (!s) return s;
  // Prefer spaced title case from Stears ALLCAPS
  return s
    .toLowerCase()
    .split(/([\s\/'-]+)/)
    .map((part, i) => {
      if (/^[\s\/'-]+$/.test(part)) return part;
      if (part === 'and' || part === 'of') return part;
      return part.charAt(0).toUpperCase() + part.slice(1);
    })
    .join('');
}

function loadLocal(slug) {
  const candidates = [
    path.join(GOV_DIR, `${slug}-2022.json`),
    path.join(GOV_DIR, `${slug}-2023.json`),
    path.join(OFF_DIR, `${slug}-2022-lga.json`),
    path.join(OFF_DIR, `${slug}-2023-lga.json`),
  ];
  for (const p of candidates) {
    if (!fs.existsSync(p)) continue;
    try {
      const payload = JSON.parse(fs.readFileSync(p, 'utf8'));
      return { path: p, rel: path.relative(ROOT, p).replace(/\\/g, '/'), payload };
    } catch {
      /* skip */
    }
  }
  return null;
}

function isEstimated(meta) {
  return meta?.lgaMethod === 'pvc-proportional' || meta?.modeled === true || meta?.synthetic === true;
}

function isCollated(meta) {
  return !!meta?.collated && !isEstimated(meta);
}

function partiesToLgaMap(parties) {
  const byLga = new Map();
  const stateCands = {};
  for (const p of parties || []) {
    const party = String(p.party || '').trim();
    if (!party) continue;
    const votes = Number(p.votes ?? p.voteCount ?? 0);
    if (!Number.isFinite(votes) || votes <= 0) continue;
    if (p.lga) {
      const key = norm(p.lga);
      if (!byLga.has(key)) byLga.set(key, { raw: p.lga, display: titleCaseLga(p.lga), votes: {} });
      byLga.get(key).votes[party] = (byLga.get(key).votes[party] || 0) + votes;
    } else {
      const name = p.candidateName || p.name || party;
      if (!stateCands[party] || votes > stateCands[party].votes) {
        stateCands[party] = { name, party, votes };
      }
    }
  }
  return { byLga, stateCands };
}

function localUnitsToMap(units) {
  const map = new Map();
  for (const [name, row] of Object.entries(units || {})) {
    map.set(norm(name), { name, votes: { ...(row.votes || {}) } });
  }
  return map;
}

function compareLga(stearsByLga, localUnits) {
  const local = localUnitsToMap(localUnits);
  const mismatches = [];
  const onlyStears = [];
  const onlyLocal = [];
  let matched = 0;
  let voteDiffCells = 0;

  for (const [key, sRow] of stearsByLga) {
    const lRow = local.get(key);
    if (!lRow) {
      onlyStears.push({ stears: sRow.raw, votes: sRow.votes });
      continue;
    }
    matched += 1;
    const parties = new Set([...Object.keys(sRow.votes), ...Object.keys(lRow.votes)]);
    const diffs = [];
    for (const party of parties) {
      const sv = Number(sRow.votes[party] || 0);
      const lv = Number(lRow.votes[party] || 0);
      if (sv !== lv) {
        voteDiffCells += 1;
        diffs.push({ party, stears: sv, local: lv, delta: sv - lv });
      }
    }
    if (diffs.length) {
      mismatches.push({ lga: lRow.name, stearsRaw: sRow.raw, diffs });
    }
  }
  for (const [key, lRow] of local) {
    if (!stearsByLga.has(key)) onlyLocal.push({ lga: lRow.name, votes: lRow.votes });
  }

  // statewide party sums
  const stearsSums = {};
  for (const row of stearsByLga.values()) {
    for (const [p, v] of Object.entries(row.votes)) stearsSums[p] = (stearsSums[p] || 0) + v;
  }
  const localSums = {};
  for (const row of local.values()) {
    for (const [p, v] of Object.entries(row.votes)) localSums[p] = (localSums[p] || 0) + Number(v || 0);
  }

  return {
    matched,
    onlyStearsCount: onlyStears.length,
    onlyLocalCount: onlyLocal.length,
    mismatchLgaCount: mismatches.length,
    voteDiffCells,
    onlyStears: onlyStears.slice(0, 20),
    onlyLocal: onlyLocal.slice(0, 20),
    mismatches: mismatches.slice(0, 30),
    stearsSums,
    localSums,
  };
}

function buildPayload(stateName, storageYear, stearsByLga, stateCands, sourceUrl, notes) {
  const candidates = Object.values(stateCands).sort((a, b) => b.votes - a.votes);
  const winner = candidates[0]
    ? { name: candidates[0].name, party: candidates[0].party, votes: candidates[0].votes }
    : null;

  const units = {};
  const sorted = [...stearsByLga.values()].sort((a, b) =>
    a.display.localeCompare(b.display, undefined, { sensitivity: 'base' })
  );
  for (const row of sorted) {
    const votes = { ...row.votes };
    const top = Object.entries(votes).sort((a, b) => b[1] - a[1])[0];
    const winCand = top ? candidates.find((c) => c.party === top[0]) : null;
    units[row.display] = {
      winner: winCand ? winCand.name : top ? top[0] : null,
      party: top ? top[0] : null,
      votes,
    };
  }

  return {
    meta: {
      office: 'gov',
      year: String(storageYear),
      state: stateName,
      level: 'lga',
      title: `${stateName} State Governorship Election ${storageYear}`,
      source: 'Stears Elections (INEC state collation / media reporting)',
      sourceUrl,
      sourceDetail: notes,
      attribution: 'Stears; Independent National Electoral Commission (INEC)',
      electionDate: '2023-03-18',
      updated: '2023-03-20',
      collated: true,
      lgaMethod: 'official-collation',
    },
    winner,
    candidates,
    units,
  };
}

function writeJson(filePath, obj) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(obj, null, 2) + '\n', 'utf8');
}

async function main() {
  if (!fs.existsSync(DIR)) fs.mkdirSync(DIR, { recursive: true });

  const nationalUrl = `https://www.stears.co/elections/${YEAR}/governor/`;
  console.log('Fetching', nationalUrl);
  const nat = await fetchText(nationalUrl);
  const natData = parseNextData(nat.body);
  const pp = natData?.props?.pageProps || {};
  const dropdown = pp.dropdownItems || pp.stateDropdownItems || [];
  let activeCodes = [];
  if (Array.isArray(dropdown) && dropdown.length) {
    activeCodes = dropdown
      .filter((d) => d.hasElectionActivity || d.hasResults || d.active)
      .map((d) => String(d.code || d.stateCode || d.value || '').toUpperCase())
      .filter(Boolean);
  }
  // Fallback: unique stateCodes from parties with votes
  if (!activeCodes.length) {
    const codes = new Set();
    for (const p of pp.parties || []) {
      if (p.stateCode && Number(p.votes || p.voteCount || 0) > 0) codes.add(String(p.stateCode).toUpperCase());
    }
    activeCodes = [...codes];
  }
  activeCodes = [...new Set(activeCodes)].filter((c) => STATE_MAP[c]).sort();
  console.log('Active Stears 2023 gov states:', activeCodes.length, activeCodes.join(','));

  const report = {
    generatedAt: new Date().toISOString(),
    stearsYear: YEAR,
    nationalUrl,
    activeStateCount: activeCodes.length,
    activeStates: activeCodes.map((c) => ({ code: c, ...STATE_MAP[c] })),
    note:
      'Local March 2023 governorship packs are stored as *-2022.json (storage year). electionDate/updated map to electionYear 2023. Pre-2023 Stears LGA unavailable per Phase 0.',
    filled: [],
    validated: [],
    skippedNoLga: [],
    residuals: [],
  };

  for (const code of activeCodes) {
    const info = STATE_MAP[code];
    const stateUrl = `https://www.stears.co/elections/${YEAR}/governor/${code}/`;
    await sleep(DELAY_MS);
    console.log('…', code, info.name);
    let page;
    try {
      page = await fetchText(stateUrl);
    } catch (e) {
      report.residuals.push({ state: info.name, code, error: String(e.message || e) });
      continue;
    }
    if (page.statusCode !== 200) {
      report.residuals.push({ state: info.name, code, error: `HTTP ${page.statusCode}` });
      continue;
    }
    const data = parseNextData(page.body);
    const parties = data?.props?.pageProps?.parties || [];
    const { byLga, stateCands } = partiesToLgaMap(parties);
    const lgaCount = byLga.size;

    if (lgaCount === 0) {
      report.skippedNoLga.push({ state: info.name, code, url: stateUrl, partiesCount: parties.length });
      continue;
    }

    const local = loadLocal(info.slug);
    const entry = {
      state: info.name,
      code,
      stearsLgaCount: lgaCount,
      stearsUrl: stateUrl,
      localFile: local?.rel || null,
      localEstimated: local ? isEstimated(local.payload.meta) : null,
      localCollated: local ? isCollated(local.payload.meta) : null,
      action: null,
      compare: null,
    };

    if (!local) {
      // Truly missing — create storage year 2022 to match siblings
      const storageYear = 2022;
      const notes = `Stears Elections LGA tallies for ${YEAR} ${info.name} governorship (${stateUrl}). Underlying source: INEC collation / IREV reporting via Stears.`;
      const payload = buildPayload(info.name, storageYear, byLga, stateCands, stateUrl, notes);
      const govPath = path.join(GOV_DIR, `${info.slug}-${storageYear}.json`);
      const offPath = path.join(OFF_DIR, `${info.slug}-${storageYear}-lga.json`);
      writeJson(govPath, payload);
      writeJson(offPath, payload);
      entry.action = 'filled-missing';
      entry.wrote = [path.relative(ROOT, govPath).replace(/\\/g, '/'), path.relative(ROOT, offPath).replace(/\\/g, '/')];
      report.filled.push(entry);
      console.log('  FILLED missing', info.name, lgaCount, 'LGAs');
      continue;
    }

    if (isEstimated(local.payload.meta) || !isCollated(local.payload.meta)) {
      // Gap-fill estimated / non-collated
      const storageYear = Number(local.payload.meta?.year) || 2022;
      const notes = `Stears Elections LGA tallies replacing prior estimated (pvc-proportional) LGA for ${YEAR} ${info.name} governorship (${stateUrl}). Cite Stears + INEC.`;
      const payload = buildPayload(info.name, storageYear, byLga, stateCands, stateUrl, notes);
      // Preserve statewide declared winners if Stears state-level candidates missing
      if ((!payload.candidates || !payload.candidates.length) && local.payload.candidates?.length) {
        payload.candidates = local.payload.candidates;
        payload.winner = local.payload.winner || payload.winner;
      } else if (local.payload.candidates?.length) {
        // Prefer declared statewide totals from existing file when present
        const byParty = Object.fromEntries(local.payload.candidates.map((c) => [c.party, c]));
        payload.candidates = payload.candidates.map((c) => {
          const prev = byParty[c.party];
          return prev && prev.votes ? { ...c, name: prev.name || c.name, votes: prev.votes } : c;
        });
        // Keep any parties only in declared list
        for (const c of local.payload.candidates) {
          if (!payload.candidates.find((x) => x.party === c.party)) payload.candidates.push(c);
        }
        payload.candidates.sort((a, b) => b.votes - a.votes);
        payload.winner = {
          name: payload.candidates[0].name,
          party: payload.candidates[0].party,
          votes: payload.candidates[0].votes,
        };
      }

      writeJson(local.path, payload);
      const offPath = path.join(OFF_DIR, `${info.slug}-${storageYear}-lga.json`);
      writeJson(offPath, payload);
      entry.action = 'filled-estimated';
      entry.wrote = [local.rel, path.relative(ROOT, offPath).replace(/\\/g, '/')];
      entry.compare = compareLga(byLga, local.payload.units);
      report.filled.push(entry);
      console.log('  FILLED estimated', info.name, lgaCount, 'LGAs');
      continue;
    }

    // Validate collated existing
    entry.action = 'validated';
    entry.compare = compareLga(byLga, local.payload.units);
    const c = entry.compare;
    const significant =
      c.mismatchLgaCount > Math.max(2, Math.floor(c.matched * 0.15)) ||
      c.onlyStearsCount > 3 ||
      c.onlyLocalCount > 3;
    entry.significantMismatch = significant;
    report.validated.push(entry);
    if (significant) {
      report.residuals.push({
        state: info.name,
        code,
        type: 'mismatch',
        mismatchLgaCount: c.mismatchLgaCount,
        onlyStearsCount: c.onlyStearsCount,
        onlyLocalCount: c.onlyLocalCount,
        stearsSums: c.stearsSums,
        localSums: c.localSums,
      });
      console.log(
        '  MISMATCH',
        info.name,
        `lgaDiff=${c.mismatchLgaCount}`,
        `onlyS=${c.onlyStearsCount}`,
        `onlyL=${c.onlyLocalCount}`
      );
    } else {
      console.log('  OK', info.name, `matched=${c.matched}`, `cellDiffs=${c.voteDiffCells}`);
    }
  }

  // Also note local estimated 2022 files not in Stears active list
  for (const file of fs.readdirSync(GOV_DIR)) {
    if (!/-2022\.json$/.test(file)) continue;
    const slug = file.replace(/-2022\.json$/, '');
    const payload = JSON.parse(fs.readFileSync(path.join(GOV_DIR, file), 'utf8'));
    if (!isEstimated(payload.meta)) continue;
    const covered = report.filled.some((f) => f.state === payload.meta.state) ||
      report.validated.some((f) => f.state === payload.meta.state);
    if (!covered) {
      report.residuals.push({
        state: payload.meta.state,
        type: 'local-estimated-not-in-stears-2023-active',
        file: `data/election-results/gubernatorial/${file}`,
      });
    }
  }

  report.summary = {
    filled: report.filled.length,
    validated: report.validated.length,
    validatedOk: report.validated.filter((v) => !v.significantMismatch).length,
    validatedMismatch: report.validated.filter((v) => v.significantMismatch).length,
    skippedNoLga: report.skippedNoLga.length,
    residualCount: report.residuals.length,
  };

  writeJson(OUT, report);
  console.log('\nWrote', OUT);
  console.log(JSON.stringify(report.summary, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
