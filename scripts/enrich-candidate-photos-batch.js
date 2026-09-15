/**
 * Fast batch pass: MediaWiki pageimages for missing profiles (batched titles).
 * Then optional Commons search for remaining high-priority (Won/Runner-up).
 *
 *   node scripts/enrich-candidate-photos-batch.js
 *   node scripts/enrich-candidate-photos-batch.js --commons
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const PRES_PATH = path.join(ROOT, 'public', 'data', 'presidential-candidates.json');
const GOV_PATH = path.join(ROOT, 'public', 'data', 'gubernatorial-candidates.json');
const MW = 'https://en.wikipedia.org/w/api.php';
const COMMONS = 'https://commons.wikimedia.org/w/api.php';
const UA = 'ElectionDashboardPhotoBot/1.3 (election dashboard catalog enrichment)';
const CREDIT = 'Wikipedia / Wikimedia Commons';
const DO_COMMONS = process.argv.includes('--commons');

const ALIASES = {
  'hope uzodinma': 'Hope Uzodimma',
  'charles soludo': 'Charles Chukwuma Soludo',
  'nasir el rufai': 'Nasir Ahmad el-Rufai',
};

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
function norm(s) {
  return asciiSafe(s)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
function tokens(s) {
  return norm(s)
    .split(' ')
    .filter((t) => t.length > 1 && !['of', 'the', 'de', 'al', 'dr'].includes(t));
}
function commonsFileUrl(file) {
  return `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(file)}?width=480`;
}
function wikiUrl(title) {
  return 'https://en.wikipedia.org/wiki/' + encodeURIComponent(String(title).replace(/ /g, '_'));
}

async function fetchJson(url) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), 25000);
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': UA, 'Api-User-Agent': UA, Accept: 'application/json' },
      signal: ac.signal,
    });
    if (res.status === 429 || res.status === 503) {
      const wait = Number(res.headers.get('retry-after') || 8) * 1000;
      console.warn('  rate limit, wait', wait);
      await sleep(Math.max(wait, 5000));
      return fetchJson(url);
    }
    if (res.status === 404) return null;
    const text = await res.text();
    if (!text || (text[0] !== '{' && text[0] !== '[')) {
      console.warn('  bad body', text.slice(0, 80));
      await sleep(5000);
      return null;
    }
    return JSON.parse(text);
  } finally {
    clearTimeout(t);
  }
}

function titleOk(pageTitle, personName) {
  if (!pageTitle) return false;
  if (/\belection\b|\blist of\b/i.test(pageTitle)) return false;
  const tok = tokens(personName);
  const tn = norm(pageTitle);
  const hits = tok.filter((x) => tn.includes(x));
  return hits.length >= Math.min(2, tok.length);
}

async function batchPageImages(titleList) {
  const q = new URLSearchParams({
    action: 'query',
    format: 'json',
    origin: '*',
    prop: 'pageimages|pageprops|info',
    piprop: 'thumbnail|name',
    pithumbsize: '480',
    redirects: '1',
    inprop: 'url',
    titles: titleList.join('|'),
  });
  const data = await fetchJson(`${MW}?${q}`);
  if (!data || !data.query) return {};
  const normalized = {};
  for (const n of data.query.normalized || []) normalized[n.from] = n.to;
  const redirects = {};
  for (const r of data.query.redirects || []) redirects[r.from] = r.to;
  const byTitle = {};
  for (const p of Object.values(data.query.pages || {})) {
    if (p && p.title && p.missing == null) byTitle[p.title] = p;
  }
  const out = {};
  for (const t of titleList) {
    let r = t;
    if (normalized[r]) r = normalized[r];
    if (redirects[r]) r = redirects[r];
    if (byTitle[r]) out[t] = byTitle[r];
  }
  return out;
}

function looksPortrait(fileTitle, personName) {
  const t = String(fileTitle || '').replace(/^File:/i, '');
  if (!/\.(jpe?g|png|webp)$/i.test(t)) return false;
  if (
    /\b(map|vote share|election by|logo|flag|seal|wav|ogg|svg|stadium|mosque|swearing|committee|inaugur|L-R | with )\b/i.test(
      t
    )
  )
    return false;
  if (/^l-r\b/i.test(t) || /\bwith\b/i.test(t)) return false;
  const tok = tokens(personName);
  const fn = norm(t.replace(/\.[^.]+$/, ''));
  const surname = tok[tok.length - 1];
  if (!fn.includes(surname)) return false;
  // Prefer files whose leading tokens are the person's name (not group captions)
  const leading = fn.split(' ').slice(0, Math.min(3, tok.length));
  const leadHits = tok.filter((x) => leading.includes(x)).length;
  if (leadHits < Math.min(2, tok.length) && !fn.startsWith(tok[0])) return false;
  return tok.filter((x) => fn.includes(x)).length >= Math.min(2, tok.length);
}

async function commonsSearch(name) {
  const q = new URLSearchParams({
    action: 'query',
    list: 'search',
    srsearch: `"${name}"`,
    srnamespace: '6',
    srlimit: '6',
    format: 'json',
    origin: '*',
  });
  const data = await fetchJson(`${COMMONS}?${q}`);
  const hits = (data && data.query && data.query.search) || [];
  for (const h of hits) {
    if (!looksPortrait(h.title, name)) continue;
    return String(h.title).replace(/^File:/i, '');
  }
  return null;
}

function collectMissing(catalog, kind) {
  const items = [];
  const seen = new Set();
  const ballots = catalog.ballots || {};
  const priority = {};
  for (const rows of Object.values(ballots)) {
    for (const b of rows) {
      const outcome = String(b.outcome || '');
      let rank = 10;
      if (outcome === 'Won') rank = 0;
      else if (/runner/i.test(outcome)) rank = 1;
      priority[b.profileId] = Math.min(priority[b.profileId] ?? 99, rank);
    }
  }
  for (const [id, pr] of Object.entries(catalog.profiles || {})) {
    if (pr.photo) continue;
    const key = `${norm(pr.name)}|${norm(pr.state || '')}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const title = ALIASES[norm(pr.name)] || pr.name;
    items.push({
      id,
      ids: Object.keys(catalog.profiles).filter(
        (x) => norm(catalog.profiles[x].name) === norm(pr.name) && norm(catalog.profiles[x].state || '') === norm(pr.state || '')
      ),
      name: pr.name,
      title,
      state: pr.state || null,
      kind,
      rank: priority[id] ?? 50,
    });
  }
  items.sort((a, b) => a.rank - b.rank);
  return items;
}

function applyPhoto(catalog, ids, hit) {
  for (const id of ids) {
    const pr = catalog.profiles[id];
    if (!pr || pr.photo) continue;
    pr.photo = hit.photo;
    pr.photoCredit = CREDIT;
    if (!pr.wiki && hit.wiki) pr.wiki = hit.wiki;
  }
}

async function enrichFile(filePath, kind) {
  const catalog = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  const missing = collectMissing(catalog, kind);
  console.log(kind, 'unique missing', missing.length);

  let set = 0;
  // Batch pageimages by requested title
  for (let i = 0; i < missing.length; i += 15) {
    const chunk = missing.slice(i, i + 15).filter((m) => !catalog.profiles[m.id].photo);
    if (!chunk.length) continue;
    const titles = [...new Set(chunk.map((m) => m.title))];
    console.log(`  pageimages batch ${i}-${i + chunk.length} (${titles.length} titles)`);
    let pages = {};
    try {
      pages = await batchPageImages(titles);
    } catch (e) {
      console.warn('  batch fail', e.message);
      await sleep(3000);
      continue;
    }
    for (const m of chunk) {
      const page = pages[m.title];
      if (!page) continue;
      if (!titleOk(page.title, m.name)) continue;
      if (page.pageprops && page.pageprops.disambiguation != null) continue;
      const thumb = page.thumbnail && page.thumbnail.source;
      if (!thumb) continue;
      if (/Coat_of_arms|Flag_of_|logo|emblem/i.test(thumb)) continue;
      applyPhoto(catalog, m.ids, {
        photo: String(thumb).split('?')[0],
        wiki: page.fullurl || wikiUrl(page.title),
      });
      set++;
      console.log('  +', m.name, '->', page.title);
    }
    catalog.updated = new Date().toISOString().slice(0, 10);
    fs.writeFileSync(filePath, JSON.stringify(catalog, null, 2) + '\n');
    await sleep(500);
  }

  if (DO_COMMONS) {
    const still = collectMissing(catalog, kind).filter((m) => m.rank <= 1);
    console.log(kind, 'commons pass for priority', still.length);
    for (const m of still) {
      if (catalog.profiles[m.id].photo) continue;
      await sleep(400);
      try {
        const file = await commonsSearch(m.name);
        if (!file) {
          const alt = ALIASES[norm(m.name)];
          if (alt) {
            await sleep(400);
            const f2 = await commonsSearch(alt);
            if (f2) {
              applyPhoto(catalog, m.ids, { photo: commonsFileUrl(f2), wiki: wikiUrl(m.title) });
              set++;
              console.log('  +commons', m.name, '->', f2);
              continue;
            }
          }
          process.stdout.write('.');
          continue;
        }
        applyPhoto(catalog, m.ids, { photo: commonsFileUrl(file), wiki: wikiUrl(m.title) });
        set++;
        console.log('  +commons', m.name, '->', file);
      } catch (e) {
        console.warn('  commons err', m.name, e.message);
      }
      if (set % 10 === 0) {
        catalog.updated = new Date().toISOString().slice(0, 10);
        fs.writeFileSync(filePath, JSON.stringify(catalog, null, 2) + '\n');
      }
    }
    console.log('');
  }

  catalog.updated = new Date().toISOString().slice(0, 10);
  fs.writeFileSync(filePath, JSON.stringify(catalog, null, 2) + '\n');
  const withPhoto = Object.values(catalog.profiles).filter((p) => p.photo).length;
  return { total: Object.keys(catalog.profiles).length, withPhoto, newlySet: set, remaining: Object.keys(catalog.profiles).length - withPhoto };
}

(async () => {
  console.log('=== PRES ===');
  console.log(await enrichFile(PRES_PATH, 'pres'));
  console.log('=== GOV ===');
  console.log(await enrichFile(GOV_PATH, 'gov'));
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
