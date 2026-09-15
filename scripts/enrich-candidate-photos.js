/**
 * Enrich presidential + gubernatorial candidate profiles with Wikimedia photos.
 *
 * Strategy:
 *  1) Bulk pull Nigerian politicians with Wikidata P18 images (fast, few requests)
 *  2) Match catalog names carefully; set photo + wiki when confident
 *  3) MediaWiki pageimages/search fallback for remaining high-priority profiles
 *  4) Leave photo:null when no reliable portrait exists (do not invent images)
 *
 * Usage:
 *   node scripts/enrich-candidate-photos.js
 *   node scripts/enrich-candidate-photos.js --office=pres
 *   node scripts/enrich-candidate-photos.js --office=gov --limit=80
 *   node scripts/enrich-candidate-photos.js --force
 *   node scripts/enrich-candidate-photos.js --wiki-only   (skip MediaWiki fallback)
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const PRES_PATH = path.join(ROOT, 'public', 'data', 'presidential-candidates.json');
const GOV_PATH = path.join(ROOT, 'public', 'data', 'gubernatorial-candidates.json');

const WD_SPARQL = 'https://query.wikidata.org/sparql';
const MW_API = 'https://en.wikipedia.org/w/api.php';
const UA =
  'ElectionDashboardPhotoBot/1.2 (educational GIS election dashboard; catalog enrichment)';
const PHOTO_CREDIT = 'Wikipedia / Wikimedia Commons';
const DELAY_MS = 400;
const MAX_RETRIES = 4;

const args = process.argv.slice(2);
const FORCE = args.includes('--force');
const DRY = args.includes('--dry-run');
const WIKI_ONLY = args.includes('--wiki-only');
const MW_ONLY = args.includes('--mw-only');
const officeArg = (args.find((a) => a.startsWith('--office=')) || '').split('=')[1];
const limitArg = Number((args.find((a) => a.startsWith('--limit=')) || '').split('=')[1] || 0);

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function asciiSafe(s) {
  return String(s || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\x20-\x7E]/g, '')
    .trim();
}

function normName(s) {
  return asciiSafe(s)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function nameTokens(s) {
  return normName(s)
    .split(' ')
    .filter((t) => t.length > 1 && !['of', 'the', 'de', 'al', 'bin', 'ibn', 'dr', 'chief', 'hon'].includes(t));
}

/** Commons Special:FilePath -> HTTPS width-constrained URL (hotlink-friendly). */
function commonsFileUrl(fileUrlOrName) {
  if (!fileUrlOrName) return null;
  let s = String(fileUrlOrName);
  if (s.startsWith('http://')) s = 'https://' + s.slice(7);
  if (s.includes('Special:FilePath')) {
    if (!/[?&]width=/.test(s)) s += (s.includes('?') ? '&' : '?') + 'width=480';
    return s;
  }
  // Raw filename from Wikidata P18 often ends with the file title
  const m = s.match(/Special:FilePath\/(.+)$/i) || s.match(/FilePath\/(.+)$/i);
  if (m) {
    return `https://commons.wikimedia.org/wiki/Special:FilePath/${m[1]}${m[1].includes('?') ? '&' : '?'}width=480`.replace(
      '?width=480?width=480',
      '?width=480'
    );
  }
  if (s.includes('upload.wikimedia.org')) return s;
  // Treat as filename
  const file = s.replace(/^File:/i, '').trim();
  return `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(file).replace(/%2F/gi, '/')}?width=480`;
}

function wikiUrlFromTitle(title) {
  return 'https://en.wikipedia.org/wiki/' + encodeURIComponent(String(title).replace(/ /g, '_'));
}

function titleFromWikiUrl(url) {
  if (!url) return null;
  const m = String(url).match(/wikipedia\.org\/wiki\/([^?#]+)/i);
  if (!m) return null;
  try {
    return decodeURIComponent(m[1].replace(/_/g, ' '));
  } catch {
    return m[1].replace(/_/g, ' ');
  }
}

async function fetchJson(url, headers = {}) {
  let lastErr;
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), 20000);
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': UA, 'Api-User-Agent': UA, Accept: 'application/json', ...headers },
        signal: ac.signal,
      });
      clearTimeout(timer);
      if (res.status === 429 || res.status === 503) {
        const ra = Number(res.headers.get('retry-after') || 0);
        const wait = Math.max(ra * 1000, 2500 * Math.pow(1.4, attempt));
        console.warn(`  HTTP ${res.status}, backoff ${Math.round(wait)}ms`);
        await sleep(wait);
        continue;
      }
      if (res.status === 404) return null;
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        if (/You are ma|rate|limit/i.test(text)) {
          await sleep(4000 * (attempt + 1));
          continue;
        }
        throw new Error(`HTTP ${res.status}`);
      }
      const text = await res.text();
      if (!text || text[0] !== '{' && text[0] !== '[') {
        if (/You are ma|rate|limit/i.test(text)) {
          await sleep(4000 * (attempt + 1));
          continue;
        }
        throw new Error('Non-JSON response');
      }
      return JSON.parse(text);
    } catch (e) {
      clearTimeout(timer);
      lastErr = e;
      if (String(e.message || e).includes('abort')) {
        console.warn('  request timeout');
      }
      await sleep(1200 * (attempt + 1));
    }
  }
  throw lastErr || new Error('fetch failed');
}

async function wikiGet(params) {
  const q = new URLSearchParams({ format: 'json', origin: '*', maxlag: '5', ...params });
  return fetchJson(`${MW_API}?${q.toString()}`);
}

async function loadWikidataPortraits() {
  console.log('Loading Wikidata Nigerian politician portraits...');
  const sparql = `
SELECT DISTINCT ?person ?personLabel ?image ?enwiki WHERE {
  ?person wdt:P31 wd:Q5;
          wdt:P27 wd:Q1033;
          wdt:P18 ?image.
  OPTIONAL {
    ?person wdt:P106 ?occ.
    FILTER(?occ IN (wd:Q82955, wd:Q372436, wd:Q11748378, wd:Q82955))
  }
  OPTIONAL {
    ?article schema:about ?person;
             schema:isPartOf <https://en.wikipedia.org/>;
             schema:name ?enwiki.
  }
  # Prefer people with a political occupation OR a political office
  FILTER(
    EXISTS { ?person wdt:P106 wd:Q82955 } ||
    EXISTS { ?person wdt:P39 ?pos }
  )
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
}
LIMIT 3000
`;
  const url = `${WD_SPARQL}?format=json&query=${encodeURIComponent(sparql)}`;
  const data = await fetchJson(url, { Accept: 'application/sparql-results+json' });
  const rows = (data.results && data.results.bindings) || [];
  console.log('  Wikidata rows:', rows.length);

  /** @type {Map<string, {name:string, photo:string, wiki:string|null, qid:string}>} */
  const byNorm = new Map();
  /** @type {Array<{name:string, tokens:string[], photo:string, wiki:string|null, qid:string}>} */
  const list = [];

  for (const r of rows) {
    const name = r.personLabel && r.personLabel.value;
    const image = r.image && r.image.value;
    if (!name || !image) continue;
    if (/^Q\d+$/.test(name)) continue; // unlabeled
    const qid = String(r.person.value).split('/').pop();
    const wikiTitle = r.enwiki && r.enwiki.value;
    const entry = {
      name,
      photo: commonsFileUrl(image),
      wiki: wikiTitle ? wikiUrlFromTitle(wikiTitle) : null,
      qid,
      tokens: nameTokens(name),
    };
    const key = normName(name);
    if (!byNorm.has(key)) byNorm.set(key, entry);
    list.push(entry);
  }
  return { byNorm, list };
}

function matchWikidata(name, { byNorm, list }, { state } = {}) {
  const key = normName(name);
  if (byNorm.has(key)) return byNorm.get(key);

  const tokens = nameTokens(name);
  if (tokens.length < 2) return null;

  let best = null;
  let bestScore = 0;
  for (const entry of list) {
    const et = entry.tokens;
    if (!et.length) continue;
    const overlap = tokens.filter((t) => et.includes(t)).length;
    if (overlap < Math.min(2, tokens.length)) continue;
    // Require last-token match (surname heuristic)
    const surname = tokens[tokens.length - 1];
    if (!et.includes(surname)) continue;
    // First token should match
    const first = tokens[0];
    if (!et.includes(first)) continue;

    // Reject when a distinctive middle name is present on one side only
    // e.g. "Mohammed Badaru Abubakar" must not match "Mohammed Abdullahi Abubakar"
    const midA = tokens.slice(1, -1);
    const midB = et.slice(1, -1);
    if (midA.length && midB.length) {
      const midOverlap = midA.filter((t) => midB.includes(t)).length;
      if (midOverlap === 0) continue;
    }

    let score = overlap * 3;
    if (normName(entry.name) === key) score += 20;
    if (et[et.length - 1] === surname) score += 2;
    // Prefer containment / subset matches (short ballot name vs full wiki name)
    if (tokens.every((t) => et.includes(t)) || et.every((t) => tokens.includes(t))) score += 5;
    if (et.length > tokens.length + 2) score -= 1;
    if (score > bestScore) {
      bestScore = score;
      best = entry;
    }
  }
  // Require a solid score to avoid wrong-person matches
  if (bestScore < 10) return null;
  return best;
}

function isDisambiguation(page) {
  const pp = page.pageprops || {};
  if (pp.disambiguation != null) return true;
  const extract = String(page.extract || '');
  return /may refer to|disambiguation/i.test(extract.slice(0, 200));
}

function scoreMwPage(page, { name, state, office }) {
  if (!page || isDisambiguation(page)) return -1;
  const title = String(page.title || '');
  const extract = String(page.extract || '');
  const blob = `${title}\n${extract}`.toLowerCase();
  const tokens = nameTokens(name);
  const titleN = normName(title);
  const titleHits = tokens.filter((t) => titleN.includes(t));
  if (titleHits.length < Math.min(2, tokens.length)) return -1;

  const nigeriaOk = /\bnigeria|\bnigerian\b/.test(blob);
  const politicsOk =
    /\b(politician|governor|governorship|presidential|senator|minister|president|candidate|national assembly|inec)\b/.test(
      blob
    );
  if (!nigeriaOk && !politicsOk) return -1;

  const thumb = page.thumbnail && page.thumbnail.source;
  if (!thumb) return -1;
  if (/Coat_of_arms|Flag_of_|logo|emblem|seal_/i.test(thumb)) return -1;

  let score = titleHits.length * 3;
  if (titleN === normName(name)) score += 8;
  if (nigeriaOk) score += 4;
  if (politicsOk) score += 3;
  if (office === 'pres' && /presidential|president of nigeria/.test(blob)) score += 6;
  if (office === 'gov' && state) {
    const st = normName(state);
    if (blob.includes(`governor of ${st}`) || blob.includes(`${st} state`)) score += 6;
    else if (blob.includes(st)) score += 2;
  }
  return score;
}

async function fetchPageMeta(titles) {
  if (!titles.length) return {};
  const out = {};
  const data = await wikiGet({
    action: 'query',
    prop: 'pageimages|pageprops|extracts|info',
    piprop: 'thumbnail|name',
    pithumbsize: '480',
    exintro: '1',
    explaintext: '1',
    exlimit: 'max',
    redirects: '1',
    inprop: 'url',
    titles: titles.slice(0, 15).join('|'),
  });
  const pages = (data.query && data.query.pages) || {};
  const normalized = {};
  for (const n of (data.query && data.query.normalized) || []) normalized[n.from] = n.to;
  const redirects = {};
  for (const r of (data.query && data.query.redirects) || []) redirects[r.from] = r.to;
  const byTitle = {};
  for (const page of Object.values(pages)) {
    if (!page || page.missing != null || !page.title) continue;
    byTitle[page.title] = page;
  }
  for (const t of titles) {
    let resolved = t;
    if (normalized[resolved]) resolved = normalized[resolved];
    if (redirects[resolved]) resolved = redirects[resolved];
    if (byTitle[resolved]) out[t] = byTitle[resolved];
  }
  return out;
}

async function searchTitles(query, limit = 4) {
  const data = await wikiGet({
    action: 'query',
    list: 'search',
    srsearch: query,
    srlimit: String(limit),
    srnamespace: '0',
  });
  return (data.query && data.query.search) || [];
}

async function resolveViaRestSummary(title, personName) {
  const enc = encodeURIComponent(String(title).replace(/ /g, '_'));
  try {
    const data = await fetchJson(`https://en.wikipedia.org/api/rest_v1/page/summary/${enc}`, {
      Accept: 'application/json',
    });
    if (!data || data.type === 'disambiguation') return null;
    const returnedTitle = data.title || '';
    // Reject redirects/soft-matches onto election articles, lists, etc.
    if (/\belection\b|\blist of\b|\bcategory\b/i.test(returnedTitle)) return null;
    const tokens = nameTokens(personName || title);
    const titleN = normName(returnedTitle);
    const titleHits = tokens.filter((t) => titleN.includes(t));
    if (titleHits.length < Math.min(2, tokens.length)) return null;

    const thumb =
      (data.thumbnail && data.thumbnail.source) || (data.originalimage && data.originalimage.source);
    if (!thumb) return null;
    if (/Coat_of_arms|Flag_of_|logo|emblem|seal_/i.test(thumb)) return null;
    const photo = String(thumb).split('?')[0];
    const desc = String(data.description || data.extract || '').toLowerCase();
    if (desc && !/\bnigeria|\bnigerian|politician|governor|president|senator|minister|candidate\b/.test(desc)) {
      if (/\b(album|film|footballer|cricketer|actor|musician)\b/.test(desc)) return null;
    }
    return {
      photo,
      photoCredit: PHOTO_CREDIT,
      wiki:
        data.content_urls && data.content_urls.desktop && data.content_urls.desktop.page
          ? data.content_urls.desktop.page
          : wikiUrlFromTitle(returnedTitle),
      matchedTitle: returnedTitle,
      score: 12,
      source: 'rest-summary',
    };
  } catch {
    return null;
  }
}

function looksLikePortraitFile(fileTitle, name) {
  const t = String(fileTitle || '').replace(/^File:/i, '');
  const lower = t.toLowerCase();
  if (!/\.(jpe?g|png|webp)$/i.test(t)) return false;
  if (/\b(map|vote share|election by|logo|flag|seal|coat|svg|wav|ogg|marker)\b/i.test(lower)) return false;
  if (/\b(swearing|committee|stadium|mosque|network)\b/i.test(lower)) return false;
  const tokens = nameTokens(name);
  const fileN = normName(t.replace(/\.[^.]+$/, ''));
  const hits = tokens.filter((tok) => fileN.includes(tok));
  // Require surname + at least one other token, or exact-ish leading name
  const surname = tokens[tokens.length - 1];
  if (!fileN.includes(surname)) return false;
  if (hits.length < Math.min(2, tokens.length)) return false;
  // Prefer files that start with the person's name tokens
  const startsWell = tokens.slice(0, 2).every((tok) => fileN.startsWith(tok) || fileN.includes(tok));
  return startsWell || hits.length >= Math.min(3, tokens.length);
}

async function resolveViaCommons(name) {
  const q = new URLSearchParams({
    action: 'query',
    list: 'search',
    srsearch: `"${name}"`,
    srnamespace: '6',
    srlimit: '8',
    format: 'json',
    origin: '*',
  });
  try {
    const data = await fetchJson(`https://commons.wikimedia.org/w/api.php?${q}`, {
      Accept: 'application/json',
    });
    const hits = (data.query && data.query.search) || [];
    for (const h of hits) {
      if (!looksLikePortraitFile(h.title, name)) continue;
      const file = String(h.title).replace(/^File:/i, '');
      return {
        photo: commonsFileUrl(file),
        photoCredit: PHOTO_CREDIT,
        wiki: null,
        matchedTitle: h.title,
        score: 9,
        source: 'commons-search',
      };
    }
  } catch (e) {
    console.warn('  commons fail', e.message);
  }
  return null;
}

const NAME_ALIASES = {
  'hope uzodinma': ['Hope Uzodimma'],
  'charles soludo': ['Charles Chukwuma Soludo'],
  'nasir el rufai': ['Nasir Ahmad el-Rufai'],
  'yabagi sani yusuf': ['Yabagi Sani'],
};

async function resolveViaMediaWiki(profile, { office, state }) {
  const name = profile.name || profile.fullName;
  if (!name) return null;

  const titles = [];
  const seen = new Set();
  const push = (t) => {
    const k = normName(t);
    if (!k || seen.has(k)) return;
    seen.add(k);
    titles.push(t);
  };
  const existing = titleFromWikiUrl(profile.wiki);
  if (existing) push(existing);
  push(name);
  for (const a of NAME_ALIASES[normName(name)] || []) push(a);

  // REST summary — exact name (+ alias / existing wiki), max 2
  for (const t of titles.slice(0, 2)) {
    await sleep(DELAY_MS);
    const rest = await resolveViaRestSummary(t, name);
    if (rest) return rest;
  }

  // Commons portrait filename search
  await sleep(DELAY_MS);
  const commons = await resolveViaCommons(name);
  if (commons) return commons;
  const alias0 = (NAME_ALIASES[normName(name)] || [])[0];
  if (alias0) {
    await sleep(DELAY_MS);
    const c2 = await resolveViaCommons(alias0);
    if (c2) return c2;
  }

  if (!args.includes('--deep')) return null;

  push(`${name} (politician)`);
  let best = null;
  let bestScore = -1;
  await sleep(DELAY_MS);
  const meta = await fetchPageMeta(titles.slice(0, 4));
  for (const t of titles) {
    const page = meta[t];
    if (!page) continue;
    const sc = scoreMwPage(page, { name, state, office });
    if (sc > bestScore) {
      bestScore = sc;
      best = page;
    }
  }

  if (bestScore < 8) {
    const queries =
      office === 'pres'
        ? [`${name} Nigerian politician`]
        : [`${name} Governor of ${state}`];
    for (const q of queries) {
      await sleep(DELAY_MS);
      let hits = [];
      try {
        hits = await searchTitles(q, 4);
      } catch (e) {
        console.warn('  search fail', e.message);
        continue;
      }
      const hitTitles = hits.map((h) => h.title).filter(Boolean);
      if (!hitTitles.length) continue;
      await sleep(DELAY_MS);
      const hitMeta = await fetchPageMeta(hitTitles);
      for (const ht of hitTitles) {
        const page = hitMeta[ht];
        if (!page) continue;
        const sc = scoreMwPage(page, { name, state, office });
        if (sc > bestScore) {
          bestScore = sc;
          best = page;
        }
      }
      if (bestScore >= 10) break;
    }
  }

  if (best && bestScore >= 6) {
    const thumb = best.thumbnail && best.thumbnail.source;
    if (thumb) {
      return {
        photo: String(thumb).split('?')[0],
        photoCredit: PHOTO_CREDIT,
        wiki: best.fullurl || wikiUrlFromTitle(best.title),
        matchedTitle: best.title,
        score: bestScore,
        source: 'mediawiki',
      };
    }
  }
  return null;
}

function priorityRank(ballot) {
  const outcome = String((ballot && ballot.outcome) || '');
  const party = String((ballot && ballot.party) || '').toUpperCase();
  const major = new Set(['APC', 'PDP', 'LP', 'NNPP', 'APGA', 'ADC', 'SDP', 'YP', 'YPP', 'PRP', 'AA', 'A', 'AAC']);
  let r = 50;
  if (outcome === 'Won') r = 0;
  else if (/runner/i.test(outcome)) r = 1;
  else if (/lost/i.test(outcome)) r = 2;
  else r = 10;
  if (major.has(party)) r -= 0.4;
  return r;
}

function applyHit(pr, hit) {
  pr.photo = hit.photo;
  pr.photoCredit = asciiSafe(hit.photoCredit || PHOTO_CREDIT);
  if (!pr.wiki && hit.wiki) pr.wiki = hit.wiki;
}

async function enrichCatalog(kind, filePath, buildQueue) {
  const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  const profiles = data.profiles || {};
  const wd = MW_ONLY ? { byNorm: new Map(), list: [] } : await loadWikidataPortraits();

  const queue = buildQueue(profiles, data);
  let newlySet = 0;
  let skipped = 0;
  let failed = 0;
  let wdHits = 0;
  let mwHits = 0;
  let reused = 0;
  let processed = 0;
  const personCache = new Map();

  for (const item of queue) {
    const pr = profiles[item.id];
    if (!pr) continue;
    if (!FORCE && pr.photo) {
      skipped++;
      continue;
    }
    if (limitArg && processed >= limitArg) break;
    processed++;

    const state = pr.state || item.state || null;
    const cacheKey = `${normName(pr.name)}|${normName(state || '')}|${kind}`;
    process.stdout.write(`${kind.toUpperCase()} ${processed}: ${pr.name}${state ? ' (' + state + ')' : ''} ... `);

    try {
      if (personCache.has(cacheKey)) {
        const cached = personCache.get(cacheKey);
        if (cached) {
          applyHit(pr, cached);
          newlySet++;
          reused++;
          console.log(`reuse`);
        } else {
          failed++;
          console.log('reuse miss');
        }
        continue;
      }

      // 1) Wikidata
      const wdMatch = matchWikidata(pr.name, wd, { state });
      if (wdMatch && wdMatch.photo) {
        const hit = {
          photo: wdMatch.photo,
          photoCredit: PHOTO_CREDIT,
          wiki: wdMatch.wiki,
          matchedTitle: wdMatch.name,
          source: 'wikidata',
        };
        applyHit(pr, hit);
        personCache.set(cacheKey, hit);
        newlySet++;
        wdHits++;
        console.log(`WD ${wdMatch.name}`);
        continue;
      }

      // 2) MediaWiki fallback
      if (!WIKI_ONLY) {
        await sleep(DELAY_MS);
        const mw = await resolveViaMediaWiki(pr, { office: kind === 'pres' ? 'pres' : 'gov', state });
        if (mw) {
          applyHit(pr, mw);
          personCache.set(cacheKey, mw);
          newlySet++;
          mwHits++;
          console.log(`MW ${mw.matchedTitle} (score=${mw.score})`);
          continue;
        }
      }

      personCache.set(cacheKey, null);
      if (FORCE) {
        pr.photo = null;
        pr.photoCredit = null;
      }
      failed++;
      console.log('no match');
    } catch (e) {
      failed++;
      console.log('ERR', e.message);
    }

    if (!DRY && processed % 20 === 0) {
      data.updated = new Date().toISOString().slice(0, 10);
      fs.writeFileSync(filePath, JSON.stringify(data, null, 2) + '\n', 'utf8');
      console.log(`  [checkpoint @ ${processed}]`);
    }
  }

  data.updated = new Date().toISOString().slice(0, 10);
  if (!DRY) fs.writeFileSync(filePath, JSON.stringify(data, null, 2) + '\n', 'utf8');

  const withPhoto = Object.values(profiles).filter((p) => p.photo).length;
  return {
    total: Object.keys(profiles).length,
    withPhoto,
    remainingNull: Object.keys(profiles).length - withPhoto,
    newlySet,
    skipped,
    failed,
    wdHits,
    mwHits,
    reused,
  };
}

async function main() {
  const summary = {};
  if (!officeArg || officeArg === 'pres') {
    console.log('=== Presidential ===');
    summary.pres = await enrichCatalog('pres', PRES_PATH, (profiles) =>
      Object.keys(profiles).map((id) => ({ id, rank: 0 }))
    );
    console.log(summary.pres);
  }
  if (!officeArg || officeArg === 'gov') {
    console.log('=== Gubernatorial ===');
    summary.gov = await enrichCatalog('gov', GOV_PATH, (profiles, data) => {
      const byId = {};
      for (const [year, rows] of Object.entries(data.ballots || {})) {
        for (const b of rows) {
          if (!b.profileId || !profiles[b.profileId]) continue;
          const rank = priorityRank(b);
          const prev = byId[b.profileId];
          if (!prev || rank < prev.rank) {
            byId[b.profileId] = { id: b.profileId, year, state: b.state, rank };
          }
        }
      }
      // include orphan profiles
      for (const id of Object.keys(profiles)) {
        if (!byId[id]) byId[id] = { id, rank: 99, state: profiles[id].state };
      }
      return Object.values(byId).sort((a, b) => a.rank - b.rank || String(b.year || '').localeCompare(String(a.year || '')));
    });
    console.log(summary.gov);
  }
  console.log('\nDONE', JSON.stringify(summary, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
