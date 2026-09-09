#!/usr/bin/env node
/**
 * Geocode polling units that still lack lat/long via OpenStreetMap Nominatim.
 *
 * DISABLED BY DEFAULT for the live map: LGA/ward geocode hits are not actual
 * polling-unit locations. Prefer INEC locator coordinates only
 * (`npm run pu:coords:refresh`).
 *
 * OSM rarely knows individual school/PU names, so this script:
 *  1) tries a cleaned place / school query when possible
 *  2) falls back to ward + LGA + state
 *  3) falls back to LGA + state
 * Unique place queries are cached and reused. Shared hits get a tiny
 * deterministic jitter so stacked units separate on the map.
 *
 * Respects Nominatim usage policy (~1 request/second). Progress is cached.
 * Only fills blank lat/long (never overwrites existing coords).
 *
 * Usage:
 *   node scripts/geocode-missing-pu-coordinates.js
 *   node scripts/geocode-missing-pu-coordinates.js --limit=200
 *   node scripts/geocode-missing-pu-coordinates.js --state=fct
 *   node scripts/geocode-missing-pu-coordinates.js --lga-only
 *   node scripts/geocode-missing-pu-coordinates.js --retry-failed
 *   node scripts/geocode-missing-pu-coordinates.js --dry-run
 */
const fs = require('fs');
const path = require('path');
const Papa = require('papaparse');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..');
const CSV_PATH = path.join(ROOT, 'data', 'reference', 'Nigeria_polling_units.csv');
const PROGRESS_PATH = path.join(ROOT, 'data', 'reference', 'pu-geocode-progress.json');
const REPORT_PATH = path.join(ROOT, 'data', 'reference', 'pu-geocode-report.json');

const NG_BBOX = { minLat: 3.8, maxLat: 14.2, minLng: 2.4, maxLng: 15.0 };
const NOMINATIM = 'https://nominatim.openstreetmap.org/search';
const USER_AGENT =
  'Geoinfotech-Election-Dashboard/1.0 (https://github.com/Geoinfotech-Web/ggis-election-webapp; geocode batch)';
const DELAY_MS = 1100;
const JITTER_DEG = 0.0035; // ~350–400m

const STATE_ALIASES = {
  fct: ['Federal Capital Territory', 'Abuja'],
  abuja: ['Federal Capital Territory', 'Abuja'],
  'cross river': ['Cross River'],
  'akwa ibom': ['Akwa Ibom'],
};

function parseArgs(argv) {
  const opts = {
    limit: 0,
    state: null,
    dryRun: false,
    retryFailed: false,
    lgaOnly: false,
    flushEvery: 500,
  };
  for (const arg of argv) {
    if (arg === '--dry-run') opts.dryRun = true;
    else if (arg === '--retry-failed') opts.retryFailed = true;
    else if (arg === '--lga-only') opts.lgaOnly = true;
    else if (arg.startsWith('--limit=')) opts.limit = Math.max(0, Number(arg.slice(8)) || 0);
    else if (arg.startsWith('--state=')) opts.state = String(arg.slice(8)).trim().toLowerCase() || null;
    else if (arg.startsWith('--flush-every=')) opts.flushEvery = Math.max(1, Number(arg.slice(14)) || 50);
  }
  return opts;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function hasCoords(row) {
  const lat = Number(row.lat);
  const lng = Number(row.long);
  return (
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    String(row.lat || '').trim() !== '' &&
    String(row.long || '').trim() !== ''
  );
}

function inNigeria(lat, lng) {
  return (
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    lat >= NG_BBOX.minLat &&
    lat <= NG_BBOX.maxLat &&
    lng >= NG_BBOX.minLng &&
    lng <= NG_BBOX.maxLng &&
    !(lat === 0 && lng === 0)
  );
}

function cleanPlace(value) {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .replace(/^[,.\-\s]+|[,.\-\s]+$/g, '')
    .trim();
}

function titleCase(value) {
  return cleanPlace(value)
    .toLowerCase()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function stateVariants(state) {
  const raw = cleanPlace(state);
  if (!raw) return [];
  const key = raw.toLowerCase();
  const aliases = STATE_ALIASES[key] || [];
  const out = [];
  const push = (s) => {
    const t = cleanPlace(s);
    if (t && !out.includes(t)) out.push(t);
  };
  // Prefer OSM-friendly aliases first (e.g. FCT → Federal Capital Territory)
  for (const a of aliases) push(a);
  push(titleCase(raw));
  return out;
}

/** Extract a geocodable place fragment from PU location / delimitation text. */
function extractPlaceName(location) {
  let text = cleanPlace(location).toLowerCase();
  if (!text) return '';

  // Prefer the part after "/" (often "name / school")
  if (text.includes('/')) {
    const parts = text.split('/').map((p) => cleanPlace(p)).filter(Boolean);
    text = parts[parts.length - 1] || text;
  }

  text = text
    .replace(/\b(pri\.?\s*sch\.?|pri\.?\s*school|p\.?\s*sch\.?)\b/g, 'primary school')
    .replace(/\b(sec\.?\s*sch\.?|sec\.?\s*school)\b/g, 'secondary school')
    .replace(/\bjss\b/g, 'junior secondary school')
    .replace(/\bsss\b/g, 'senior secondary school')
    .replace(/\b(ung\.?|unguwan|unguwa)\b/g, 'ungwa')
    .replace(/\b(open\s+space|in\s*front\s+of|by\s+the|near|opposite|beside)\b.*$/i, '')
    .replace(/\b(i{1,3}|iv|v|vi{0,3}|1|2|3|4|5)\b/gi, ' ')
    .replace(/[^\w\s'.-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  // Drop ultra-generic leftovers
  if (!text || text.length < 4) return '';
  if (/^(primary|secondary|junior|senior|school|market|square|house|road|settlement)s?$/.test(text)) {
    return '';
  }
  return titleCase(text);
}

function buildQueries(row, { lgaOnly = false } = {}) {
  const place = extractPlaceName(row.location || row.name);
  const ward = titleCase(row.ward);
  const lga = titleCase(row.lg || row.lga);
  const states = stateVariants(row.state);
  const primaryState = states[0] || '';
  const queries = [];
  const push = (parts, level) => {
    const q = parts.filter(Boolean).join(', ');
    if (q.length < 8) return;
    if (queries.some((x) => x.q === q)) return;
    queries.push({ q, level });
  };

  if (lgaOnly) {
    if (lga && primaryState) push([lga, primaryState, 'Nigeria'], 'lga');
    if (states[1] && lga) push([lga, states[1], 'Nigeria'], 'lga');
    return queries;
  }

  // Keep query count low: place → ward → LGA, primary state first, one alias fallback.
  if (place && lga && primaryState) push([place, lga, primaryState, 'Nigeria'], 'place');
  if (ward && lga && primaryState) push([ward, lga, primaryState, 'Nigeria'], 'ward');
  if (lga && primaryState) push([lga, primaryState, 'Nigeria'], 'lga');
  if (states[1] && lga) {
    if (place) push([place, lga, states[1], 'Nigeria'], 'place');
    push([lga, states[1], 'Nigeria'], 'lga');
  }
  return queries;
}

function loadProgress() {
  if (!fs.existsSync(PROGRESS_PATH)) return { version: 2, queryHits: {}, unitResults: {} };
  try {
    const data = JSON.parse(fs.readFileSync(PROGRESS_PATH, 'utf8'));
    return {
      version: 2,
      queryHits: data.queryHits && typeof data.queryHits === 'object' ? data.queryHits : {},
      unitResults: data.unitResults && typeof data.unitResults === 'object' ? data.unitResults : {},
      // migrate v1
      ...(data.results && !data.unitResults
        ? { unitResults: data.results }
        : {}),
    };
  } catch {
    return { version: 2, queryHits: {}, unitResults: {} };
  }
}

function saveProgress(progress) {
  progress.updatedAt = new Date().toISOString();
  const tmp = `${PROGRESS_PATH}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(progress));
  fs.renameSync(tmp, PROGRESS_PATH);
}

async function writeCsvAtomic(fields, rows) {
  const outCsv = Papa.unparse(rows, { columns: fields, quotes: false });
  const body = outCsv.endsWith('\n') ? outCsv : `${outCsv}\n`;
  const tmp = `${CSV_PATH}.tmp`;
  fs.writeFileSync(tmp, body);

  const delays = [0, 500, 1000, 2000, 4000, 8000];
  let lastErr = null;
  for (const delay of delays) {
    if (delay) await sleep(delay);
    try {
      try {
        fs.renameSync(tmp, CSV_PATH);
      } catch {
        fs.copyFileSync(tmp, CSV_PATH);
        try {
          fs.unlinkSync(tmp);
        } catch {
          /* ignore */
        }
      }
      return;
    } catch (err) {
      lastErr = err;
    }
  }

  const fallback = path.join(path.dirname(CSV_PATH), 'Nigeria_polling_units.geocoded.csv');
  fs.copyFileSync(tmp, fallback);
  console.warn(
    `CSV locked — wrote ${fallback} instead. Close Excel/Docker readers and merge manually. Last error: ${
      lastErr ? lastErr.message : 'unknown'
    }`
  );
}

function jitterForCode(code, lat, lng) {
  const hash = crypto.createHash('sha1').update(String(code)).digest();
  const u = hash[0] / 255;
  const v = hash[1] / 255;
  const angle = u * Math.PI * 2;
  const radius = Math.sqrt(v) * JITTER_DEG;
  return {
    lat: lat + Math.sin(angle) * radius,
    lng: lng + Math.cos(angle) * radius,
  };
}

async function nominatimSearch(q) {
  const url =
    NOMINATIM +
    '?' +
    new URLSearchParams({
      q,
      format: 'json',
      limit: '1',
      countrycodes: 'ng',
      addressdetails: '0',
    });
  const res = await fetch(url, {
    headers: {
      Accept: 'application/json',
      'User-Agent': USER_AGENT,
    },
    signal: AbortSignal.timeout(20000),
  });
  if (res.status === 429) {
    const err = new Error('Nominatim rate limited (429)');
    err.retryable = true;
    throw err;
  }
  if (!res.ok) {
    const err = new Error(`Nominatim HTTP ${res.status}`);
    err.retryable = res.status >= 500;
    throw err;
  }
  const rows = await res.json();
  if (!Array.isArray(rows) || !rows.length) return null;
  const hit = rows[0];
  const lat = Number(hit.lat);
  const lng = Number(hit.lon);
  if (!inNigeria(lat, lng)) return null;
  return {
    lat,
    lng,
    label: hit.display_name || q,
    importance: hit.importance != null ? Number(hit.importance) : null,
    query: q,
  };
}

async function resolveQueries(queries, progress) {
  // If we already know this LGA, skip burning requests on place/ward misses.
  const lgaQuery = queries.find((x) => x.level === 'lga');
  if (lgaQuery && progress.queryHits[lgaQuery.q]?.ok) {
    const cached = progress.queryHits[lgaQuery.q];
    return { ok: true, level: 'lga', ...cached, query: lgaQuery.q, fromCache: true };
  }

  let lastError = null;
  for (const { q, level } of queries) {
    const cached = progress.queryHits[q];
    if (cached) {
      if (cached.ok) {
        return { ok: true, level: cached.level || level, ...cached, query: q, fromCache: true };
      }
      continue;
    }

    try {
      await sleep(DELAY_MS);
      const hit = await nominatimSearch(q);
      if (hit) {
        progress.queryHits[q] = {
          ok: true,
          lat: hit.lat,
          lng: hit.lng,
          label: hit.label,
          level,
          at: new Date().toISOString(),
        };
        return { ok: true, level, ...hit, fromCache: false };
      }
      progress.queryHits[q] = { ok: false, error: 'no_match', level, at: new Date().toISOString() };
    } catch (err) {
      lastError = err;
      if (err.retryable) {
        await sleep(5000);
        try {
          const hit = await nominatimSearch(q);
          if (hit) {
            progress.queryHits[q] = {
              ok: true,
              lat: hit.lat,
              lng: hit.lng,
              label: hit.label,
              level,
              at: new Date().toISOString(),
            };
            return { ok: true, level, ...hit, fromCache: false };
          }
          progress.queryHits[q] = { ok: false, error: 'no_match', level, at: new Date().toISOString() };
        } catch (err2) {
          lastError = err2;
        }
      }
    }
  }
  return {
    ok: false,
    error: lastError ? lastError.message : 'no_match',
    tried: queries.map((x) => x.q),
  };
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (!fs.existsSync(CSV_PATH)) {
    console.error('Missing CSV:', CSV_PATH);
    process.exit(1);
  }

  const parsed = Papa.parse(fs.readFileSync(CSV_PATH, 'utf8'), {
    header: true,
    skipEmptyLines: true,
  });
  const fields = parsed.meta.fields;
  const rows = parsed.data;
  const progress = loadProgress();

  if (opts.retryFailed) {
    for (const [code, prev] of Object.entries(progress.unitResults || {})) {
      if (prev && prev.ok === false) delete progress.unitResults[code];
    }
    for (const [q, prev] of Object.entries(progress.queryHits || {})) {
      if (prev && prev.ok === false) delete progress.queryHits[q];
    }
  }

  const candidates = rows.filter((row) => {
    if (hasCoords(row)) return false;
    const code = String(row.code || '').trim();
    if (!code) return false;
    if (opts.state && !String(row.state || '').toLowerCase().includes(opts.state)) return false;
    const prev = progress.unitResults[code];
    if (prev && prev.ok === false && !opts.retryFailed) return false;
    if (prev && prev.ok === true) return false;
    return true;
  });

  const queue = opts.limit > 0 ? candidates.slice(0, opts.limit) : candidates;
  console.log(
    `Geocode queue=${queue.length} (missing=${candidates.length}, state=${opts.state || 'all'}, dryRun=${opts.dryRun}, retryFailed=${opts.retryFailed}, lgaOnly=${opts.lgaOnly})`
  );

  const report = {
    startedAt: new Date().toISOString(),
    limit: opts.limit || null,
    state: opts.state,
    lgaOnly: opts.lgaOnly,
    queued: queue.length,
    attempted: 0,
    matched: 0,
    failed: 0,
    byLevel: { place: 0, ward: 0, lga: 0 },
    nominatimCallsApprox: 0,
  };

  let matchedSinceFlush = 0;
  for (let i = 0; i < queue.length; i++) {
    const row = queue[i];
    const code = String(row.code).trim();
    const queries = buildQueries(row, { lgaOnly: opts.lgaOnly });
    process.stdout.write(
      `[${i + 1}/${queue.length}] ${code} ${String(row.location || '').slice(0, 40)}… `
    );

    if (opts.dryRun) {
      console.log('dry-run', queries.map((x) => `${x.level}:${x.q}`).join(' | '));
      continue;
    }

    report.attempted += 1;
    const beforeHits = Object.keys(progress.queryHits).length;
    const result = await resolveQueries(queries, progress);
    report.nominatimCallsApprox += Math.max(0, Object.keys(progress.queryHits).length - beforeHits);

    if (result.ok) {
      const jittered = jitterForCode(code, result.lat, result.lng);
      progress.unitResults[code] = {
        ok: true,
        lat: jittered.lat,
        lng: jittered.lng,
        baseLat: result.lat,
        baseLng: result.lng,
        level: result.level,
        label: result.label,
        query: result.query,
        at: new Date().toISOString(),
      };
      row.lat = String(jittered.lat);
      row.long = String(jittered.lng);
      report.matched += 1;
      if (report.byLevel[result.level] != null) report.byLevel[result.level] += 1;
      matchedSinceFlush += 1;
      if (!result.fromCache || (i + 1) % 100 === 0) {
        console.log(`OK ${result.level} ${jittered.lat.toFixed(5)},${jittered.lng.toFixed(5)}`);
      } else {
        process.stdout.write('OK\n');
      }
    } else {
      progress.unitResults[code] = {
        ok: false,
        error: result.error || 'no_match',
        tried: result.tried || [],
        at: new Date().toISOString(),
      };
      report.failed += 1;
      console.log(`FAIL ${result.error || 'no_match'}`);
    }

    if ((i + 1) % 25 === 0) {
      saveProgress(progress);
    }
    if (matchedSinceFlush >= opts.flushEvery) {
      saveProgress(progress);
      await writeCsvAtomic(fields, rows);
      matchedSinceFlush = 0;
      console.log(`  …flushed CSV (matched=${report.matched}, failed=${report.failed})`);
    }
  }

  if (!opts.dryRun) {
    saveProgress(progress);
    await writeCsvAtomic(fields, rows);
  }

  report.finishedAt = new Date().toISOString();
  report.withCoordinatesAfter = rows.filter((r) => hasCoords(r)).length;
  report.withoutCoordinatesAfter = rows.length - report.withCoordinatesAfter;
  fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

module.exports = { main, buildQueries, extractPlaceName };
