const fs = require('fs');
const https = require('https');
const path = require('path');

function get(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'ElectionDashboard/1.0 (research)' } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return get(res.headers.location).then(resolve, reject);
      }
      let d = '';
      res.on('data', (c) => { d += c; });
      res.on('end', () => resolve(d));
    }).on('error', reject);
  });
}

function strip(html) {
  return String(html || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&nbsp;/g, ' ')
    .replace(/&#160;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function partyCode(raw) {
  const s = String(raw || '').toUpperCase().replace(/\./g, '').replace(/\s+/g, '');
  if (s === 'NPP' || s === 'NP') return 'NPP';
  if (s === 'NDC') return 'NDC';
  if (s === 'INDIPENDENT' || s.indexOf('INDEP') === 0 || s === 'IND') return 'IND';
  if (s.indexOf('GHANAFREEDOM') === 0 || s === 'GFP') return 'GFP';
  return s || 'IND';
}

function titleCase(name) {
  const small = { of: 1, and: 1, the: 1 };
  return String(name || '').toLowerCase().split(/(\s+|\/|-)/).filter((part) => part !== '').map((word, i, arr) => {
    if (/^\s+$/.test(word) || word === '/' || word === '-') return word;
    const wordIndex = arr.slice(0, i).filter((part) => /[a-z]/i.test(part)).length;
    if (wordIndex > 0 && small[word]) return word;
    return word.charAt(0).toUpperCase() + word.slice(1);
  }).join('')
    .replace(/\bNpp\b/g, 'NPP')
    .replace(/\bNdc\b/g, 'NDC');
}

function tokens(name) {
  const drop = { dr: 1, hon: 1, alhaji: 1, mr: 1, mrs: 1, ms: 1, nana: 1, honble: 1 };
  return String(name || '').toLowerCase().replace(/[^a-z\s]/g, ' ').split(/\s+/).filter((w) => w && !drop[w]).sort().join(' ');
}

function parseModernGhana(html) {
  const tables = [];
  const re = /<table[\s\S]*?<\/table>/gi;
  let m;
  while ((m = re.exec(html))) tables.push({ index: m.index, html: m[0] });
  const headings = [];
  const hs = /<strong>\s*([^<]+?)\s*<\/strong>/gi;
  while ((m = hs.exec(html))) {
    const label = m[1].replace(/\s+/g, ' ').trim();
    if (/accra|eastern|western|ashanti|bono|ahafo|central|northern|volta|oti|savannah|north east|upper/i.test(label) && label.length < 40) {
      headings.push({ index: m.index, label: titleCase(label) });
    }
  }
  const rows = [];
  tables.forEach((table) => {
    const heading = headings.filter((h) => h.index < table.index).slice(-1)[0];
    const priorUpperEast = headings.filter((h) => h.index < table.index && /^upper east$/i.test(h.label)).length;
    let region = heading ? heading.label : '';
    if (/^upper east$/i.test(region) && priorUpperEast >= 2) region = 'Upper West';
    let constituency = '';
    const trs = table.html.match(/<tr[\s\S]*?<\/tr>/gi) || [];
    trs.forEach((tr) => {
      const cells = (tr.match(/<td[^>]*>[\s\S]*?<\/td>/gi) || []).map((td) => strip(td).replace(/\u2019/g, "'"));
      while (cells.length && !cells[cells.length - 1]) cells.pop();
      if (!cells.length || /^s\/n/i.test(cells[0]) || /constituency name/i.test(cells.join(' '))) return;
      const filled = cells.filter(Boolean);
      if (filled.length < 2) {
        if (/^\d+$/.test(cells[0]) && cells[1]) constituency = cells[1];
        return;
      }
      const party = filled[filled.length - 1];
      const name = filled[filled.length - 2];
      if (!name || !party || /^\d+$/.test(name)) {
        if (/^\d+$/.test(filled[0]) && filled[1]) constituency = filled[1];
        return;
      }
      if (/^\d+$/.test(filled[0]) && filled.length >= 4 && filled[1] !== name) constituency = filled[1];
      if (!constituency) return;
      rows.push({
        name: titleCase(name),
        party: partyCode(party),
        constituency: titleCase(constituency),
        region: region,
      });
    });
  });
  return rows;
}

function parseWikiWinners(wikitext) {
  const winners = [];
  let region = '';
  String(wikitext || '').split('\n').forEach((line) => {
    const head = line.match(/^==+\s*(.+?)\s*==+/);
    if (head && /Region/i.test(head[1])) {
      region = head[1].replace(/\[\[|\]\]/g, '').replace(/-.*$/, '').replace(/\d+\s*seats?/i, '').trim();
    }
    if (!line.startsWith('|') || line.indexOf('||') < 0) return;
    const parts = line.replace(/^\|/, '').split('||').map((p) => p.replace(/<ref[^>]*>[\s\S]*?(<\/ref>|$)/gi, '').replace(/\{\{[^}]+\}\}/g, '').trim());
    if (parts.length < 3) return;
    const constituency = strip(parts[0].replace(/\[\[[^|\]]*\|([^\]]+)\]\]/g, '$1').replace(/\[\[|\]\]/g, ''));
    const person = strip(parts[1].replace(/\[\[[^|\]]*\|([^\]]+)\]\]/g, '$1').replace(/\[\[|\]\]/g, ''));
    const party = strip(parts[2]).replace(/[^A-Za-z]/g, '').toUpperCase();
    if (!person || !constituency || /affiliation|elected mp|total/i.test(constituency)) return;
    if (!/^[A-Z]{2,5}$/.test(party) && party !== 'IND' && party.indexOf('INDEP') !== 0) return;
    winners.push({
      name: person,
      party: party.indexOf('INDEP') === 0 ? 'IND' : party,
      constituency: constituency,
      region: region,
      key: tokens(person) + '|' + tokens(constituency),
    });
  });
  return winners;
}

function filePathPhoto(page) {
  const file = page && (page.pageimage || (page.thumbnail && page.thumbnail.source));
  if (!file) return null;
  const name = page.pageimage || decodeURIComponent(String(file).split('/').pop().split('?')[0]);
  if (!name || name.length < 4) return null;
  return 'https://commons.wikimedia.org/wiki/Special:FilePath/' + encodeURIComponent(name.replace(/_/g, ' ')) + '?width=480';
}

async function wikiPages(titles) {
  const pages = [];
  for (let i = 0; i < titles.length; i += 1) {
    const url = 'https://en.wikipedia.org/w/api.php?action=query&format=json&prop=pageimages|extracts&explaintext=1&exchars=2400&pithumbsize=640&redirects=1&titles=' + encodeURIComponent(titles[i]);
    let json = null;
    for (let attempt = 0; attempt < 3 && !json; attempt += 1) {
      if (attempt) await new Promise((resolve) => setTimeout(resolve, 2500 * attempt));
      const raw = await get(url);
      try { json = JSON.parse(raw); } catch (err) { json = null; }
    }
    const batch = Object.values((json && json.query && json.query.pages) || {}).filter((p) => !p.missing && p.extract);
    pages.push.apply(pages, batch);
    await new Promise((resolve) => setTimeout(resolve, 700));
  }
  return pages;
}

function sentences(text) {
  return String(text || '').replace(/\s+/g, ' ').split(/(?<=\.)\s+/).filter((s) => s && s.length > 40);
}

(async () => {
  const html = fs.readFileSync(path.join('scripts', '_wiki_raw', 'gh-parl-2024-mg.html'), 'utf8');
  const filed = parseModernGhana(html);
  const wiki2024 = JSON.parse(fs.readFileSync(path.join('scripts', '_wiki_raw', 'gh-mp-2024-wt.json'), 'utf8'));
  const winners2024 = parseWikiWinners(wiki2024.parse.wikitext['*']);
  const winBy = {};
  winners2024.forEach((w) => { winBy[tokens(w.name) + '|' + tokens(w.constituency)] = w; });
  const winByName = {};
  winners2024.forEach((w) => { winByName[tokens(w.name)] = w; });
  const byConstituency = {};
  winners2024.forEach((w) => {
    const key = tokens(w.constituency);
    if (!byConstituency[key]) byConstituency[key] = [];
    byConstituency[key].push(w);
  });
  function samePerson(a, b) {
    const ta = tokens(a).split(' ').filter(Boolean);
    const tb = new Set(tokens(b).split(' ').filter(Boolean));
    if (!ta.length || !tb.size) return false;
    const hit = ta.filter((word) => tb.has(word)).length;
    return hit >= Math.min(ta.length, tb.size) && hit >= 2;
  }
  const candidates2024 = filed.map((row) => {
    const pool = byConstituency[tokens(row.constituency)] || [];
    const hit = pool.find((w) => samePerson(row.name, w.name)) || (winByName[tokens(row.name)] && tokens(winByName[tokens(row.name)].constituency) === tokens(row.constituency) ? winByName[tokens(row.name)] : null);
    return {
      name: row.name,
      party: row.party,
      constituency: row.constituency,
      region: row.region,
      outcome: hit ? 'Won' : 'Contested',
    };
  });
  const constituencies = new Set(candidates2024.map((c) => c.constituency.toLowerCase()));

  const wt2020 = JSON.parse(await get('https://en.wikipedia.org/w/api.php?action=parse&page=List_of_MPs_elected_in_the_2020_Ghanaian_general_election&prop=wikitext&format=json'));
  const winners2020 = parseWikiWinners(wt2020.parse.wikitext['*']).map((w) => ({
    name: w.name,
    party: w.party,
    constituency: w.constituency,
    region: w.region,
    outcome: 'Won',
  }));

  const existing = {};
  try {
    const prior = JSON.parse(fs.readFileSync(path.join('public', 'data', 'ghana', 'profiles.json'), 'utf8'));
    Object.assign(existing, prior.profiles || {});
  } catch (err) { /* first run */ }
  const wanted = [
    'John_Dramani_Mahama',
    'Nana_Akufo-Addo',
    'Mahamudu_Bawumia',
    'Alan_John_Kwadwo_Kyerematen',
    'Nana_Kwame_Bediako',
    'Hassan_Ayariga',
    'Ivor_Greenstreet',
    'Nana_Konadu_Agyeman_Rawlings',
    'Akua_Donkor',
    'Paa_Kwesi_Nduom',
    'Jacob_Osei_Yeboah',
    'Edward_Mahama',
    'Brigitte_Dzogbenuku',
    'Kofi_Akpaloo',
    'Kofi_Koranteng',
    'Christian_Kwabena_Andrews',
    'Henry_Herbert_Lartey',
    'Mohammed_Frimpong',
    'David_Apasera',
    'Nana_Frimpomaa_Kumankuma',
    'George_Twum-Barima-Adu',
    'Alfred_Kwame_Asiedu_Walker',
  ];
  const have = {};
  Object.keys(existing).forEach((name) => {
    if (existing[name] && existing[name].summary && existing[name].summary.length > 80) have[name.toLowerCase().replace(/[^a-z]/g, '')] = 1;
  });
  const missing = wanted.filter((title) => !have[title.toLowerCase().replace(/[^a-z_]/g, '').replace(/_/g, '')]);
  const pages = await wikiPages(missing);
  const profiles = existing;
  pages.forEach((page) => {
    const paras = String(page.extract || '').replace(/\s+\n/g, '\n').split(/\n{2,}/).map((p) => p.replace(/\s+/g, ' ').trim()).filter((p) => p.length > 40);
    let bits = paras;
    if (bits.length < 2) {
      const sents = sentences(page.extract);
      bits = [];
      if (sents[0]) bits.push(sents[0]);
      const rest = sents.slice(1);
      for (let i = 0; i < rest.length && bits.length < 6; i += 2) bits.push(rest.slice(i, i + 2).join(' '));
    }
    const photo = filePathPhoto(page);
    profiles[page.title] = {
      name: page.title,
      summary: bits[0] || '',
      biography: bits.slice(1, 6),
      photo: photo,
      photoCredit: photo ? 'Wikimedia Commons, via the English Wikipedia lead image' : null,
      wiki: 'https://en.wikipedia.org/wiki/' + encodeURIComponent(page.title.replace(/ /g, '_')),
      source: 'English Wikipedia introduction, retrieved for this pack.',
    };
  });

  const local = [
    { name: 'Dordoe Ignatius Godfred', role: 'Assembly member', area: 'Natriku', district: 'Shai-Osudoku', region: 'Greater Accra', outcome: 'Elected' },
    { name: 'Amartey Alex Kasibia', role: 'Unit committee', area: 'Natriku', district: 'Shai-Osudoku', region: 'Greater Accra', outcome: 'Elected' },
    { name: 'Adodoadzi Ibrahim', role: 'Unit committee', area: 'Natriku', district: 'Shai-Osudoku', region: 'Greater Accra', outcome: 'Elected' },
    { name: 'Akorli Philip Kwaku', role: 'Unit committee', area: 'Natriku', district: 'Shai-Osudoku', region: 'Greater Accra', outcome: 'Elected' },
    { name: 'Hogoh William', role: 'Unit committee', area: 'Natriku', district: 'Shai-Osudoku', region: 'Greater Accra', outcome: 'Elected' },
    { name: 'Nyamedor Beatrice', role: 'Unit committee', area: 'Natriku', district: 'Shai-Osudoku', region: 'Greater Accra', outcome: 'Elected' },
  ];

  const root = path.join('public', 'data', 'ghana');
  fs.writeFileSync(path.join(root, 'parliamentary.json'), JSON.stringify({
    2024: {
      meta: {
        year: '2024',
        source: 'Modern Ghana published list of 801 registered parliamentary candidates, 7 December 2024. This file contains every name the article tables yielded. The page repeats the heading UPPER EAST on the table that starts with Wa Central; those rows are stored as Upper West. Won is marked only where the name and constituency also match the English Wikipedia list of elected MPs.',
        sourceUrl: 'https://www.modernghana.com/news/1363580/election2024-full-list-of-801-parliamentary-candidates.html',
        winnerSourceUrl: 'https://en.wikipedia.org/wiki/List_of_MPs_elected_in_the_2024_Ghanaian_general_election',
        registered: 801,
        loaded: candidates2024.length,
        constituencies: constituencies.size,
        constituencyTotal: 276,
        electedMatched: candidates2024.filter((c) => c.outcome === 'Won').length,
      },
      candidates: candidates2024,
    },
    2020: {
      meta: {
        year: '2020',
        source: 'English Wikipedia list of MPs elected in 2020. This is the elected members, not the full candidate field.',
        sourceUrl: 'https://en.wikipedia.org/wiki/List_of_MPs_elected_in_the_2020_Ghanaian_general_election',
        loaded: winners2020.length,
        constituencyTotal: 275,
        coverage: 'elected members only',
      },
      candidates: winners2020,
    },
  }, null, 2));
  fs.writeFileSync(path.join(root, 'local-candidates.json'), JSON.stringify({
    2023: {
      meta: {
        year: '2023',
        date: '2023-12-19',
        source: 'Ghana News Agency report of the Shai-Osudoku district electoral officer: six candidates in the Natriku electoral area were elected unopposed after other nominees withdrew. The Electoral Commission recorded 18,755 assembly-member candidates and 47,502 unit-committee candidates nationwide (Graphic Online / GNA). Those national rolls are not in this file.',
        sourceUrl: 'https://gna.org.gh/2023/12/assembly-member-unit-committee-members-at-natriku-electoral-area-in-shai-osudoku-district-elected-unopposed/',
        nationalCountUrl: 'https://www.graphic.com.gh/news/general-news/ghana-news-66-000-contest-local-polls-today.html',
        loaded: local.length,
        nationalAssemblyCandidates: 18755,
        nationalUnitCandidates: 47502,
        coverage: 'Natriku electoral area, Shai-Osudoku District, only',
      },
      candidates: local,
    },
  }, null, 2));
  fs.writeFileSync(path.join(root, 'profiles.json'), JSON.stringify({ profiles, source: 'English Wikipedia lead sections. No photograph is stored when Wikipedia has no lead image.' }, null, 2));

  const pres2016 = fs.readFileSync(path.join('scripts', '_wiki_raw', 'gh-2016-wt.txt'), 'utf8');
  const presStart = pres2016.indexOf('===President===');
  const presEnd = pres2016.indexOf('====By region====');
  const presBlock = pres2016.slice(presStart, presEnd > presStart ? presEnd : presStart + 4000);
  const partyMap = {
    'new patriotic party': 'NPP',
    'national democratic congress': 'NDC',
    "progressive people's party": 'PPP',
    "convention people's party": 'CPP',
    "people's national convention": 'PNC',
    'national democratic party': 'NDP',
    independent: 'IND',
  };
  const already = { 'nanaakufoaddo': 1, 'johndramanimahama': 1, 'johnmahama': 1 };
  const added2016 = [];
  const candRe = /\|cand\d+=\[\[([^\]|]+)(?:\|[^\]]+)?\]\]\|vp\d+=(?:\[\[([^\]|]+)(?:\|[^\]]+)?\]\]|([^|]+))\|party\d+=(?:\[\[(?:[^\]|]+\|)?([^\]]+)\]\]|([^|\n]+))\|votes\d+=(\d+)/g;
  let hit;
  while ((hit = candRe.exec(presBlock))) {
    const name = strip(hit[1]);
    const key = name.toLowerCase().replace(/[^a-z]/g, '');
    if (already[key]) continue;
    const partyName = strip(hit[4] || hit[5] || '');
    const running = strip(hit[2] || hit[3] || '');
    added2016.push({
      name: name,
      party: partyMap[partyName.toLowerCase()] || partyName,
      votes: Number(hit[6]),
      runningMate: running || null,
      outcome: 'Contested',
    });
  }
  fs.writeFileSync(path.join(root, 'presidential.json'), JSON.stringify({
    2016: {
      meta: {
        year: '2016',
        source: 'English Wikipedia election-results template for the 2016 presidential election, citing the Electoral Commission workbook. Nana Akufo-Addo and John Dramani Mahama remain on the regional pack. That pack’s NDC regional sum is 4,751,188; the national template records 4,771,188 for Mahama and is not copied over the regional sheet.',
        sourceUrl: 'https://en.wikipedia.org/wiki/2016_Ghanaian_general_election',
        workbook: 'https://web.archive.org/web/20200527133248/https://s3-us-west-2.amazonaws.com/ecgovgh-public/downloads/2016-Presidential-Results_national-consitutuency.xlsb',
      },
      added: added2016,
    },
  }, null, 2));

  console.log(JSON.stringify({
    filed: candidates2024.length,
    constituencies: constituencies.size,
    won: candidates2024.filter((c) => c.outcome === 'Won').length,
    wikiWinners: winners2024.length,
    mp2020: winners2020.length,
    profiles: Object.keys(profiles),
    added2016: added2016.map((row) => row.name + ' ' + row.party + ' ' + row.votes),
  }, null, 2));
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
