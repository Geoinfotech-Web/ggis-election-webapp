/**
 * Enrich presidential candidate profiles with Wikipedia / Wikidata biographies.
 *
 * Updates summary, biography[], history[], roles[], born, birthPlace, wiki, fullName
 * while preserving photo / photoCredit.
 *
 * Usage:
 *   node scripts/enrich-presidential-bios.js
 *   node scripts/enrich-presidential-bios.js --dry-run
 *   node scripts/enrich-presidential-bios.js --force
 *   node scripts/enrich-presidential-bios.js --id=bola-ahmed-tinubu
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const CATALOG_PATH = path.join(ROOT, 'public', 'data', 'presidential-candidates.json');
const CACHE_PATH = path.join(ROOT, 'scripts', '_pres-bio-cache.json');
const MW_API = 'https://en.wikipedia.org/w/api.php';
const WD_API = 'https://www.wikidata.org/w/api.php';
const UA =
  'ElectionDashboardBioBot/1.1 (educational GIS election dashboard; biography enrichment)';
const DELAY_MS = 900;
const MAX_RETRIES = 6;

const PARTY_NAMES = {
  APC: 'All Progressives Congress',
  PDP: "People's Democratic Party",
  LP: 'Labour Party',
  NNPP: 'New Nigeria Peoples Party',
  AAC: 'African Action Congress',
  ADC: 'African Democratic Congress',
  SDP: 'Social Democratic Party',
  AA: 'Action Alliance',
  ADP: 'Action Democratic Party',
  APGA: 'All Progressives Grand Alliance',
  PRP: 'Peoples Redemption Party',
  YPP: 'Young Progressives Party',
  ZLP: 'Zenith Labour Party',
  A: 'Accord Party',
  APM: 'Allied Peoples Movement',
  APP: 'Action Peoples Party',
  BP: 'Boot Party',
  NRM: 'National Rescue Movement',
};

const args = process.argv.slice(2);
const DRY = args.includes('--dry-run');
const FORCE = args.includes('--force');
const THIN_ONLY = args.includes('--thin-only');
const idArg = (args.find((a) => a.startsWith('--id=')) || '').split('=')[1];

let bioCache = {};
try {
  if (fs.existsSync(CACHE_PATH)) bioCache = JSON.parse(fs.readFileSync(CACHE_PATH, 'utf8'));
} catch {
  bioCache = {};
}

function saveCache() {
  if (!DRY) fs.writeFileSync(CACHE_PATH, JSON.stringify(bioCache, null, 2) + '\n', 'utf8');
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function asciiSafe(s) {
  return String(s || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\x20-\x7E]/g, ' ')
    .replace(/\s+/g, ' ')
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
    .filter(
      (t) =>
        t.length > 1 &&
        !['of', 'the', 'de', 'al', 'bin', 'ibn', 'dr', 'chief', 'hon', 'prince', 'princess'].includes(t)
    );
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
    const timer = setTimeout(() => ac.abort(), 30000);
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': UA, 'Api-User-Agent': UA, Accept: 'application/json', ...headers },
        signal: ac.signal,
      });
      clearTimeout(timer);
      if (res.status === 429 || res.status === 503) {
        const ra = Number(res.headers.get('retry-after') || 0);
        const wait = Math.max(ra * 1000, 4000 * Math.pow(1.5, attempt));
        console.warn(`  rate limit HTTP ${res.status}, wait ${Math.round(wait)}ms`);
        await sleep(wait);
        continue;
      }
      if (res.status === 404) return null;
      const text = await res.text();
      if (!res.ok) {
        if (/You are ma|rate|limit/i.test(text)) {
          await sleep(5000 * (attempt + 1));
          continue;
        }
        throw new Error(`HTTP ${res.status}`);
      }
      if (!text || (text[0] !== '{' && text[0] !== '[')) {
        if (/You are ma|rate|limit/i.test(text)) {
          await sleep(5000 * (attempt + 1));
          continue;
        }
        throw new Error('Non-JSON response');
      }
      return JSON.parse(text);
    } catch (e) {
      clearTimeout(timer);
      lastErr = e;
      await sleep(1500 * (attempt + 1));
    }
  }
  throw lastErr || new Error('fetch failed');
}

async function wikiGet(params) {
  const q = new URLSearchParams({ format: 'json', origin: '*', maxlag: '5', ...params });
  return fetchJson(`${MW_API}?${q.toString()}`);
}

async function wdGet(params) {
  const q = new URLSearchParams({ format: 'json', origin: '*', ...params });
  return fetchJson(`${WD_API}?${q.toString()}`);
}

function decodeEntities(text) {
  return String(text || '')
    .replace(/&#(\d+);/g, (_, n) => {
      const code = Number(n);
      return code >= 32 && code <= 126 ? String.fromCharCode(code) : ' ';
    })
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => {
      const code = parseInt(h, 16);
      return code >= 32 && code <= 126 ? String.fromCharCode(code) : ' ';
    })
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"');
}

function stripHtml(html) {
  return asciiSafe(
    decodeEntities(String(html || ''))
      .replace(/<ref[^>]*>[\s\S]*?<\/ref>/gi, ' ')
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, ' ')
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, ' ')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/p>/gi, '\n\n')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\[\s*edit\s*\]/gi, ' ')
      .replace(/\[\d+\]/g, ' ')
      .replace(/\s+\[\s*\d+\s*\]\s+/g, ' ')
  );
}

function cleanBioParagraph(p) {
  let s = asciiSafe(p);
  if (!s || s.length < 60) return '';
  if (/\[\s*edit\s*\]/i.test(s)) {
    s = s.replace(/^[A-Za-z /]+(\[\s*edit\s*\])?\s*/i, '').trim();
  }
  if (/^Early life\b|^Education\b|^Career\b|^Political career\b/i.test(s) && s.length < 120) return '';
  if (/\&#\d+;/.test(s)) return '';
  if (/^\[\s*\d+\s*\]/.test(s)) return '';
  return s;
}

function splitSentences(text) {
  return String(text || '')
    .split(/(?<=[.!?])\s+/)
    .map((s) => asciiSafe(s))
    .filter((s) => s.length > 20);
}

function splitParagraphs(text) {
  return String(text || '')
    .split(/\n{2,}/)
    .map((p) => asciiSafe(p.replace(/\n+/g, ' ')))
    .filter((p) => p.length > 60);
}

function isRelevantSection(title) {
  const t = String(title || '').toLowerCase();
  if (/references|external links|see also|notes|bibliography|sources|further reading|gallery/.test(t)) {
    return false;
  }
  return /early life|education|career|business|politic|governor|presiden|activ|journal|military|public service|legal|professional|background|pre-presidency|post-presidency|vice-presidency|tenure|leadership|party|controvers|detention|imprison|release|return/.test(
    t
  );
}

function isDisambiguation(page) {
  const pp = page.pageprops || {};
  if (pp.disambiguation != null) return true;
  const extract = String(page.extract || '');
  return /may refer to|disambiguation/i.test(extract.slice(0, 200));
}

function scoreSearchHit(hit, name) {
  const title = String(hit.title || '');
  const snippet = String(hit.snippet || '');
  const blob = `${title}\n${snippet}`.toLowerCase();
  const tokens = nameTokens(name);
  const titleN = normName(title);
  const hits = tokens.filter((t) => titleN.includes(t));
  if (hits.length < Math.min(2, tokens.length)) return -1;
  if (/\belection\b|\blist of\b|\bcategory\b|\bdisambiguation\b/i.test(title)) return -1;
  if (!/\bnigeria|\bnigerian|politician|governor|president|senator|minister|candidate|army|journalist|economist|lawyer|business/.test(blob)) {
    return -1;
  }
  let score = hits.length * 3;
  if (titleN === normName(name)) score += 10;
  if (/\bnigerian politician\b/.test(blob)) score += 5;
  if (/\bpresident of nigeria\b/.test(blob)) score += 4;
  return score;
}

async function resolveWikiTitle(profile) {
  const existing = titleFromWikiUrl(profile.wiki);
  if (existing) return existing;

  const queries = [
    `${profile.name} Nigerian politician`,
    `${profile.name} Nigeria`,
    profile.fullName || profile.name,
  ];
  for (const q of queries) {
    const data = await wikiGet({
      action: 'query',
      list: 'search',
      srsearch: q,
      srlimit: '5',
      srnamespace: '0',
    });
    const hits = (data.query && data.query.search) || [];
    let best = null;
    let bestScore = -1;
    for (const hit of hits) {
      const score = scoreSearchHit(hit, profile.name);
      if (score > bestScore) {
        bestScore = score;
        best = hit;
      }
    }
    if (best && bestScore >= 6) return best.title;
    await sleep(DELAY_MS);
  }
  return null;
}

async function fetchIntro(title) {
  const cacheKey = `intro:${title}`;
  if (bioCache[cacheKey]) return bioCache[cacheKey];

  let intro = null;
  try {
    const data = await wikiGet({
      action: 'query',
      prop: 'extracts|pageprops|info',
      titles: title,
      explaintext: '1',
      exsentences: '14',
      redirects: '1',
      inprop: 'url',
    });
    const pages = Object.values((data.query && data.query.pages) || {});
    const page = pages.find((p) => p && p.missing == null);
    if (page && !isDisambiguation(page)) {
      intro = {
        title: page.title,
        extract: String(page.extract || '').trim(),
        wiki: page.fullurl || wikiUrlFromTitle(page.title),
      };
    }
  } catch {
    /* fall through to REST */
  }

  if (!intro || intro.extract.length < 120) {
    const enc = encodeURIComponent(String(title).replace(/ /g, '_'));
    try {
      const rest = await fetchJson(`https://en.wikipedia.org/api/rest_v1/page/summary/${enc}`);
      if (rest && rest.type !== 'disambiguation' && rest.extract) {
        intro = {
          title: rest.title || title,
          extract: String(rest.extract).trim(),
          wiki:
            (rest.content_urls && rest.content_urls.desktop && rest.content_urls.desktop.page) ||
            wikiUrlFromTitle(rest.title || title),
        };
      }
    } catch {
      /* ignore */
    }
  }

  if (intro) bioCache[cacheKey] = intro;
  return intro;
}

async function fetchSections(title) {
  const data = await wikiGet({
    action: 'parse',
    page: title,
    prop: 'sections',
    redirects: '1',
  });
  if (!data.parse) return [];
  return (data.parse.sections || []).filter((s) => isRelevantSection(s.line));
}

async function fetchSectionText(title, sectionIndex) {
  const data = await wikiGet({
    action: 'parse',
    page: title,
    section: String(sectionIndex),
    prop: 'text',
    redirects: '1',
  });
  if (!data.parse || !data.parse.text) return '';
  return stripHtml(data.parse.text['*'] || data.parse.text);
}

async function fetchWikidata(title) {
  const data = await wdGet({
    action: 'wbgetentities',
    sites: 'enwiki',
    titles: title,
    props: 'claims|labels',
    languages: 'en',
  });
  const entities = data.entities || {};
  const entity = Object.values(entities).find((e) => e && e.id && e.id.startsWith('Q'));
  if (!entity) return null;

  const claims = entity.claims || {};
  const birthDate = claimValue(claims.P569);
  const birthPlace = await claimPlaceLabel(claims.P19);
  const positions = await extractPositions(claims.P39);
  const occupations = await claimItemLabels(claims.P106, 3);

  return {
    qid: entity.id,
    birthDate: formatWikidataDate(birthDate),
    birthPlace,
    positions,
    occupations,
  };
}

function claimValue(claimArr) {
  const c = (claimArr || [])[0];
  if (!c || !c.mainsnak || !c.mainsnak.datavalue) return null;
  return c.mainsnak.datavalue.value;
}

async function claimPlaceLabel(claimArr) {
  const val = claimValue(claimArr);
  if (!val) return null;
  if (val.id) {
    const label = await fetchEntityLabel(val.id);
    return label;
  }
  if (val.text) return asciiSafe(val.text);
  return null;
}

async function claimItemLabels(claimArr, limit = 3) {
  const out = [];
  for (const c of (claimArr || []).slice(0, limit)) {
    const val = c.mainsnak && c.mainsnak.datavalue && c.mainsnak.datavalue.value;
    if (val && val.id) {
      const label = await fetchEntityLabel(val.id);
      if (label) out.push(label);
    }
  }
  return out;
}

const labelCache = new Map();

async function fetchEntityLabels(qids) {
  const need = qids.filter((q) => q && !labelCache.has(q));
  for (let i = 0; i < need.length; i += 40) {
    const batch = need.slice(i, i + 40);
    if (!batch.length) continue;
    const data = await wdGet({
      action: 'wbgetentities',
      ids: batch.join('|'),
      props: 'labels',
      languages: 'en',
    });
    for (const qid of batch) {
      const ent = data.entities && data.entities[qid];
      const label = ent && ent.labels && ent.labels.en ? asciiSafe(ent.labels.en.value) : null;
      labelCache.set(qid, label);
    }
    await sleep(300);
  }
  return Object.fromEntries(qids.map((q) => [q, labelCache.get(q) || null]));
}

async function fetchEntityLabel(qid) {
  if (!qid) return null;
  if (labelCache.has(qid)) return labelCache.get(qid);
  await fetchEntityLabels([qid]);
  return labelCache.get(qid) || null;
}

function formatWikidataDate(val) {
  if (!val || !val.time) return null;
  const m = String(val.time).match(/^([+-]?\d{4})-(\d{2})-(\d{2})/);
  if (!m) return null;
  const year = m[1].replace(/^\+/, '');
  if (year.length > 4) return null;
  if (m[2] === '00') return year;
  if (m[3] === '00') return `${year}-${m[2]}`;
  return `${year}-${m[2]}-${m[3]}`;
}

function formatPositionRange(start, end) {
  const s = formatWikidataDate(start);
  const e = formatWikidataDate(end);
  if (s && e) return `${s.slice(0, 4)}-${e.slice(0, 4)}`;
  if (s) return `${s.slice(0, 4)}-present`;
  return null;
}

async function extractPositions(p39Claims) {
  const claims = (p39Claims || []).slice(0, 12);
  const qids = claims
    .map((c) => c.mainsnak && c.mainsnak.datavalue && c.mainsnak.datavalue.value && c.mainsnak.datavalue.value.id)
    .filter(Boolean);
  const labels = await fetchEntityLabels(qids);

  const out = [];
  for (const claim of claims) {
    const posVal = claim.mainsnak && claim.mainsnak.datavalue && claim.mainsnak.datavalue.value;
    if (!posVal || !posVal.id) continue;
    const label = labels[posVal.id];
    if (!label) continue;
    const quals = claim.qualifiers || {};
    const start = claimValue(quals.P580);
    const end = claimValue(quals.P582);
    const range = formatPositionRange(start, end);
    out.push({
      label,
      year: range || '',
      title: label,
      detail: range ? `Tenure: ${range}.` : 'Notable public office.',
    });
  }
  return out;
}

function buildBallotMap(ballots) {
  const map = {};
  for (const [year, entries] of Object.entries(ballots || {})) {
    for (const e of entries) {
      if (!e.profileId) continue;
      if (!map[e.profileId]) map[e.profileId] = [];
      map[e.profileId].push({ year, ...e });
    }
  }
  for (const arr of Object.values(map)) {
    arr.sort((a, b) => Number(a.year) - Number(b.year));
  }
  return map;
}

function partyLabel(abbr) {
  return PARTY_NAMES[abbr] || abbr;
}

function outcomeSentence(entry, profileName) {
  const phrase = outcomePhrase(entry).replace(/\.$/, '');
  if (/^(Won|Lost|Finished)/i.test(phrase)) {
    return `He ${phrase.charAt(0).toLowerCase()}${phrase.slice(1)}.`;
  }
  return `${phrase}.`;
}

function outcomePhrase(entry) {
  const party = partyLabel(entry.party);
  const base = `${entry.year} ${party} presidential candidate`;
  const outcome = String(entry.outcome || '').toLowerCase();
  if (outcome.includes('won')) return `Won the ${entry.year} presidential election as ${party} nominee`;
  if (outcome.includes('runner-up') || outcome.includes('2nd')) {
    const share = entry.share ? ` (${entry.share}% nationally)` : '';
    return `Finished runner-up in the ${entry.year} election on the ${party} ticket${share}`;
  }
  if (outcome.includes('3rd')) {
    const share = entry.share ? ` (${entry.share}% nationally)` : '';
    return `Finished third in the ${entry.year} election on the ${party} ticket${share}`;
  }
  if (outcome.includes('4th')) return `Finished fourth in the ${entry.year} election on the ${party} ticket`;
  if (outcome.includes('incumbent') && outcome.includes('lost')) {
    return `Lost re-election as incumbent in ${entry.year} on the ${party} ticket`;
  }
  if (outcome.includes('contested')) return `${base} (contested)`;
  return base;
}

function buildElectionSummarySentence(ballotEntries) {
  if (!ballotEntries || !ballotEntries.length) return '';
  const latest = ballotEntries[ballotEntries.length - 1];
  return outcomePhrase(latest) + '.';
}

function buildSummary(introSentences, ballotEntries, profile) {
  const core = introSentences.slice(0, 3).join(' ');
  const election = buildElectionSummarySentence(ballotEntries);
  let summary = core;
  const yr = String(latestYear(ballotEntries));
  const needsElection =
    election &&
    yr &&
    !new RegExp(`\\b${yr}\\b`).test(summary) &&
    !/presidential (candidate|election|nominee)/i.test(summary.slice(-120));
  if (needsElection) {
    summary = summary.replace(/[.?\s]+$/, '') + '. ' + election;
  }
  summary = asciiSafe(summary);
  const parts = splitSentences(summary);
  return parts.slice(0, 4).join(' ');
}

function latestYear(entries) {
  return entries && entries.length ? entries[entries.length - 1].year : '';
}

function chunkSentences(sentences, size = 3) {
  const chunks = [];
  for (let i = 0; i < sentences.length; i += size) {
    const chunk = sentences.slice(i, i + size).join(' ');
    if (chunk.length > 60) chunks.push(chunk);
  }
  return chunks;
}

function normalizeParagraph(p) {
  const cleaned = cleanBioParagraph(p);
  if (!cleaned) return [];
  const sentences = splitSentences(cleaned);
  if (sentences.length <= 4) return [cleaned];
  return chunkSentences(sentences, 3).map((c) => cleanBioParagraph(c)).filter(Boolean);
}

function buildBiography(introText, sectionParagraphs, ballotEntries, profile) {
  const paras = [];
  const introSentences = splitSentences(introText);
  if (introSentences.length > 3) {
    for (const chunk of chunkSentences(introSentences.slice(3), 3)) {
      if (chunk.length > 80) paras.push(chunk);
    }
  }

  for (const p of sectionParagraphs) {
    if (paras.length >= 6) break;
    if (p.length < 80) continue;
    for (const part of normalizeParagraph(p.length > 1200 ? p.slice(0, 1200) : p)) {
      if (paras.length >= 6) break;
      if (part.length > 900) continue;
      if (paras.some((x) => similarity(x, part) > 0.65)) continue;
      paras.push(part);
    }
  }

  if (ballotEntries && ballotEntries.length) {
    const runs = ballotEntries.map((e) => {
      const mate = e.runningMate ? ` with ${e.runningMate} as running mate` : '';
      return `In ${e.year}, ${profile.name} ran for president on the ${partyLabel(e.party)} ticket${mate}. ${outcomeSentence(e, profile.name)}`;
    });
    const electionPara = runs.join(' ');
    if (!paras.some((x) => /ran for president|presidential election|presidential candidate/i.test(x))) {
      paras.push(asciiSafe(electionPara));
    } else if (ballotEntries.length > 1) {
      paras.push(asciiSafe(electionPara));
    }
  }

  while (paras.length > 6) paras.pop();
  return paras
    .map((p) => asciiSafe(p))
    .map((p) =>
      p.replace(
        /\. (Won the|Finished runner-up|Finished third|Finished fourth|Lost re-election)/g,
        (_, g) => '. He ' + g.charAt(0).toLowerCase() + g.slice(1)
      )
    );
}

function similarity(a, b) {
  const ta = new Set(normName(a).split(' '));
  const tb = new Set(normName(b).split(' '));
  let inter = 0;
  for (const t of ta) if (tb.has(t)) inter++;
  return inter / Math.max(ta.size, tb.size, 1);
}

const GENERIC_OCCUPATIONS = new Set(['politician', 'accountant', 'businessperson', 'businessman', 'lawyer']);

function isGarbageRole(s) {
  return (
    /From \d{4} to \d{4} During/i.test(s) ||
    /Unsuccess/i.test(s) ||
    /Senato$/i.test(s) ||
    /Since \d{4}/i.test(s) ||
    /^senator$/i.test(s)
  );
}

function formatRole(label, range) {
  let s = asciiSafe(label);
  if (!s) return null;
  if (/^senator$/i.test(s)) s = 'Senator of Nigeria';
  if (range) s = `${s} (${range})`;
  return s;
}

function buildRoles(wd, introText, existingRoles) {
  const roles = [];
  const seen = new Set();
  const add = (r) => {
    const s = asciiSafe(r);
    const key = normName(s.replace(/\(\d{4}[^)]*\)/g, '').trim());
    if (!s || s.length < 4 || seen.has(key)) return;
    seen.add(key);
    roles.push(s);
  };

  for (const p of (wd && wd.positions) || []) {
    if (!p.year && !/(president|vice president|governor|minister|senator)/i.test(p.label)) continue;
    const formatted = formatRole(p.label, p.year);
    if (formatted) add(formatted);
  }

  for (const occ of (wd && wd.occupations) || []) {
    if (GENERIC_OCCUPATIONS.has(normName(occ))) continue;
    if (roles.length >= 4) break;
    add(occ);
  }

  for (const r of existingRoles || []) {
    if (isGarbageRole(r) || GENERIC_OCCUPATIONS.has(normName(r))) continue;
    if (roles.length >= 5) break;
    add(r);
  }
  return roles.slice(0, 5);
}

function titleCase(s) {
  return asciiSafe(String(s || ''))
    .split(' ')
    .map((w) => (w.length <= 3 && !/^(of|for|the)$/i.test(w) ? w : w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()))
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function buildHistory(wdPositions, ballotEntries, existingHistory) {
  const items = [];
  const seenTitles = new Set();

  const add = (item) => {
    const titleKey = normName(item.title);
    const yearKey = String(item.year || '').slice(0, 4);
    const key = `${yearKey}|${titleKey}`;
    if (seenTitles.has(key)) return;
    if (!item.year && seenTitles.has(titleKey)) return;
    seenTitles.add(key);
    if (titleKey) seenTitles.add(titleKey);
    items.push(item);
  };

  for (const h of existingHistory || []) {
    if (!h.year && /Notable public office/i.test(h.detail || '')) continue;
    add(h);
  }

  for (const p of wdPositions || []) {
    if (!p.year) continue;
    add({
      year: p.year,
      title: p.title,
      detail: p.detail,
    });
  }

  for (const e of ballotEntries || []) {
    add({
      year: e.year,
      title: `${partyLabel(e.party)} presidential candidate`,
      detail: outcomePhrase(e).replace(/\.$/, '') + '.',
    });
  }

  items.sort((a, b) => {
    const ya = parseInt(String(a.year).slice(0, 4), 10) || 9999;
    const yb = parseInt(String(b.year).slice(0, 4), 10) || 9999;
    return ya - yb;
  });

  return items.slice(0, 10);
}

function bioDepth(profile) {
  const bioLen = (profile.biography || []).join(' ').length;
  const histLen = (profile.history || []).length;
  return { bioLen, histLen, summaryLen: (profile.summary || '').length };
}

function shouldSkipEnrich(profile, before) {
  if (FORCE) return false;
  if (THIN_ONLY && before.bioLen < 800) return false;
  if (before.bioLen >= 1200 && before.histLen >= 4 && before.summaryLen >= 200) return true;
  return false;
}

function buildFallbackProfile(profile, ballotEntries) {
  const party = ballotEntries.length ? partyLabel(ballotEntries[0].party) : 'their party';
  const years = ballotEntries.map((e) => e.year).join(', ');
  const summary = asciiSafe(
    `${profile.name} was a ${party} presidential candidate in Nigeria's ${years || 'recent'} general election(s). ` +
      buildElectionSummarySentence(ballotEntries)
  );
  const biography = [
    asciiSafe(
      `${profile.name} appeared on INEC's final presidential ballot as the ${party} flag bearer${years ? ` (${years})` : ''}.`
    ),
    asciiSafe(
      `Public encyclopedic coverage of ${profile.name.split(' ')[0]} is limited; this profile reflects verified ballot and party context rather than extended biographical sources.`
    ),
  ];
  if (ballotEntries.length > 1) {
    biography.push(
      asciiSafe(ballotEntries.map((e) => outcomePhrase(e)).join(' '))
    );
  }
  const history = (ballotEntries || []).map((e) => ({
    year: e.year,
    title: `${partyLabel(e.party)} presidential candidate`,
    detail: outcomePhrase(e).replace(/\.$/, '') + '.',
  }));
  const roles = profile.roles && profile.roles.length ? profile.roles : [`${party} presidential candidate`];
  return { summary, biography, history, roles };
}

async function enrichProfile(profile, ballotEntries) {
  const before = bioDepth(profile);
  if (shouldSkipEnrich(profile, before)) {
    return { profile, skipped: true, before, after: before };
  }

  let title = await resolveWikiTitle(profile);
  await sleep(DELAY_MS);

  if (!title) {
    const fb = buildFallbackProfile(profile, ballotEntries);
    const merged = {
      ...profile,
      ...fb,
      roles: fb.roles,
    };
    return { profile: merged, skipped: false, before, after: bioDepth(merged), source: 'ballot-fallback' };
  }

  const intro = await fetchIntro(title);
  await sleep(DELAY_MS);
  if (!intro || !intro.extract) {
    const fb = buildFallbackProfile(profile, ballotEntries);
    const merged = { ...profile, ...fb, wiki: profile.wiki || wikiUrlFromTitle(title) };
    return { profile: merged, skipped: false, before, after: bioDepth(merged), source: 'ballot-fallback' };
  }

  title = intro.title;
  const sections = await fetchSections(title);
  await sleep(DELAY_MS);

  const sectionParagraphs = [];
  const cacheKey = `sections:${title}`;
  let sectionTexts = bioCache[cacheKey];
  if (!sectionTexts) {
    sectionTexts = [];
    for (const sec of sections.slice(0, 4)) {
      const text = await fetchSectionText(title, sec.index);
      await sleep(DELAY_MS);
      sectionTexts.push({ line: sec.line, text });
    }
    bioCache[cacheKey] = sectionTexts;
    saveCache();
  }
  for (const block of sectionTexts) {
    for (const p of splitParagraphs(block.text).slice(0, 2)) {
      sectionParagraphs.push(p);
    }
  }

  const wd = await fetchWikidata(title);
  await sleep(DELAY_MS);

  const introSentences = splitSentences(intro.extract);
  const summary = buildSummary(introSentences, ballotEntries, profile);
  const biography = buildBiography(intro.extract, sectionParagraphs, ballotEntries, profile);
  const roles = buildRoles(wd, intro.extract, profile.roles);
  const curatedHistory = (profile.history || []).filter(
    (h) => h.year && !/Notable public office/i.test(h.detail || '')
  );
  const history = buildHistory(wd && wd.positions, ballotEntries, curatedHistory);

  const enriched = {
    ...profile,
    wiki: intro.wiki || profile.wiki || wikiUrlFromTitle(title),
    summary: summary || profile.summary,
    biography: biography.length ? biography : profile.biography,
    history: history.length ? history : profile.history,
    roles: roles.length ? roles : profile.roles,
  };

  if (wd && wd.birthDate && !profile.born) enriched.born = wd.birthDate;
  if (wd && wd.birthPlace && !profile.birthPlace) enriched.birthPlace = wd.birthPlace;

  return {
    profile: enriched,
    skipped: false,
    before,
    after: bioDepth(enriched),
    source: 'wikipedia',
    title,
  };
}

async function main() {
  const catalog = JSON.parse(fs.readFileSync(CATALOG_PATH, 'utf8'));
  const ballotMap = buildBallotMap(catalog.ballots);
  let ids = idArg ? [idArg] : Object.keys(catalog.profiles);
  if (THIN_ONLY && !idArg) {
    ids = ids.filter((id) => bioDepth(catalog.profiles[id]).bioLen < 800);
    console.log(`Thin-only mode: ${ids.length} profile(s) below 800 chars`);
  }

  console.log(`Enriching ${ids.length} presidential profile(s)...`);
  const results = [];

  for (const id of ids) {
    const profile = catalog.profiles[id];
    if (!profile) {
      console.warn(`  skip unknown id: ${id}`);
      continue;
    }
    console.log(`\n>> ${profile.name} (${id})`);
    try {
      const res = await enrichProfile(profile, ballotMap[id] || []);
      catalog.profiles[id] = res.profile;
      results.push({ id, name: profile.name, ...res });
      if (res.skipped) {
        console.log(`  skipped (already rich): bio=${res.before.bioLen} summary=${res.before.summaryLen}`);
      } else {
        console.log(
          `  ${res.source}: bio ${res.before.bioLen} -> ${res.after.bioLen}, summary ${res.before.summaryLen} -> ${res.after.summaryLen}, history ${res.before.histLen} -> ${res.after.histLen}`
        );
      }
    } catch (err) {
      console.error(`  ERROR: ${err.message}`);
      results.push({ id, name: profile.name, error: err.message });
    }
    await sleep(DELAY_MS);
  }

  catalog.source =
    'INEC final list of candidates for national elections - Wikipedia / Wikidata biographies (enriched)';
  catalog.updated = new Date().toISOString().slice(0, 10);

  saveCache();
  if (!DRY) {
    fs.writeFileSync(CATALOG_PATH, JSON.stringify(catalog, null, 2) + '\n', 'utf8');
    console.log('\nWrote', CATALOG_PATH);
  } else {
    console.log('\nDry run - no file written');
  }

  const enriched = results.filter((r) => !r.skipped && !r.error);
  const skipped = results.filter((r) => r.skipped);
  const errors = results.filter((r) => r.error);
  console.log('\nSummary:');
  console.log(`  enriched: ${enriched.length}`);
  console.log(`  skipped:  ${skipped.length}`);
  console.log(`  errors:   ${errors.length}`);

  return results;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
