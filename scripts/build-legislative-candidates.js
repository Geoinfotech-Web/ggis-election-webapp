#!/usr/bin/env node
/**
 * Build senatorial + House of Reps candidate catalogs.
 *
 * Sources:
 * - District geography from data/reference/Nigeria_polling_units.csv
 * - Archived race JSON under data/election-results/{senatorial,house}/
 * - Wikipedia scaffolds when a year is missing / thin:
 *   - Senate: Template "Nigerian senators of the {8th,9th,10th} National Assembly"
 *   - House 2023: currentaffairs.ng/rep/ + Wikipedia party enrichment
 *   - House 2019/2015: Wikipedia membership lists
 *
 * ASCII punctuation only in generated summaries.
 * 2027 is omitted (no completed National Assembly election yet).
 */
const fs = require('fs');
const path = require('path');
const https = require('https');

const ROOT = path.join(__dirname, '..');
const PU_CSV = path.join(ROOT, 'data', 'reference', 'Nigeria_polling_units.csv');
const SEN_DIR = path.join(ROOT, 'data', 'election-results', 'senatorial');
const HOUSE_DIR = path.join(ROOT, 'data', 'election-results', 'house');
const SEN_OUT = path.join(ROOT, 'public', 'data', 'senatorial-candidates.json');
const REPS_OUT = path.join(ROOT, 'public', 'data', 'reps-candidates.json');

const DISTRICT_CODE = {
  C: 'Central',
  N: 'North',
  S: 'South',
  E: 'East',
  W: 'West',
  NE: 'North East',
  NW: 'North West',
  SE: 'South East',
  SW: 'South West',
  FCT: 'FCT',
};

const YEAR_SOURCES = [
  {
    year: '2023',
    senateTemplate: 'Template:Nigerian senators of the 10th National Assembly',
    senateLabel: 'Wikipedia: Nigerian senators of the 10th National Assembly (elected 2023)',
    housePage: 'List_of_members_of_the_House_of_Representatives_of_Nigeria,_2023–2027',
    houseLabel: 'CurrentAffairs.ng House directory + Wikipedia 2023–2027 party enrichment',
    electionDate: '2023-02-25',
    minSen: 90,
    minHouse: 250,
  },
  {
    year: '2019',
    senateTemplate: 'Template:Nigerian senators of the 9th National Assembly',
    senateLabel: 'Wikipedia: Nigerian senators of the 9th National Assembly (elected 2019)',
    housePage: 'List_of_members_of_the_House_of_Representatives_of_Nigeria,_2019–2023',
    houseLabel: 'Wikipedia: List of members of the House of Representatives of Nigeria, 2019–2023',
    electionDate: '2019-02-23',
    minSen: 90,
    minHouse: 250,
  },
  {
    year: '2015',
    senateTemplate: 'Template:Nigerian senators of the 8th National Assembly',
    senateLabel: 'Wikipedia: Nigerian senators of the 8th National Assembly (elected 2015)',
    housePage: 'List_of_members_of_the_House_of_Representatives_of_Nigeria,_2015–2019',
    houseLabel: 'Wikipedia: List of members of the House of Representatives of Nigeria, 2015–2019',
    electionDate: '2015-03-28',
    minSen: 90,
    minHouse: 200,
  },
];

function parseCsvLine(line) {
  const out = [];
  let cur = '';
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (q) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (ch === '"') q = false;
      else cur += ch;
    } else if (ch === '"') q = true;
    else if (ch === ',') {
      out.push(cur);
      cur = '';
    } else cur += ch;
  }
  out.push(cur);
  return out;
}

function slugify(s) {
  return String(s || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

function titleCase(s) {
  return String(s || '')
    .trim()
    .toLowerCase()
    .replace(/\b([a-z])/g, (m) => m.toUpperCase())
    .replace(/\bOf\b/g, 'of')
    .replace(/\bAnd\b/g, 'and');
}

function stateTitle(s) {
  const raw = String(s || '').trim();
  if (/^(fct|abuja|federal capital)/i.test(raw)) return 'FCT';
  const t = titleCase(raw.replace(/\s*State$/i, ''));
  if (/^Fct$/i.test(t)) return 'FCT';
  return t;
}

function asciiSafe(s) {
  return String(s || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[\u2018\u2019\u201A\u2032]/g, "'")
    .replace(/[\u201C\u201D\u201E\u2033]/g, '"')
    .replace(/[\u2013\u2014\u2212]/g, '-')
    .replace(/\u2026/g, '...')
    .replace(/\u00A0/g, ' ')
    .replace(/[^\x09\x0A\x0D\x20-\x7E]/g, '');
}

function stripWiki(s) {
  return asciiSafe(
    String(s || '')
      .replace(/\{\{[^}]*\}\}/g, ' ')
      .replace(/\[\[([^|\]]+)\|([^\]]+)\]\]/g, '$2')
      .replace(/\[\[([^\]]+)\]\]/g, '$1')
      .replace(/'{2,}/g, '')
      .replace(/<[^>]+>/g, '')
      .replace(/&nbsp;/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
  );
}

function normalizeKey(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/federal constituency/g, '')
    .replace(/senatorial district/g, '')
    .replace(/[^a-z0-9]+/g, '');
}

function normalizeParty(p) {
  const raw = String(p || '').trim();
  if (
    !raw ||
    raw === '—' ||
    raw === '–' ||
    raw === '-' ||
    raw === '?' ||
    /^tbd$/i.test(raw) ||
    /^\?+$/.test(raw) ||
    /^vacant$/i.test(raw)
  )
    return null;
  const u = raw.toUpperCase().replace(/[^A-Z]/g, '');
  const map = {
    ALLPROGRESSIVESCONGRESS: 'APC',
    PEOPLESDEMOCRATICPARTY: 'PDP',
    PEOPLEDEMOCRATICPARTY: 'PDP',
    PEOPLESDEMOCRATICPARTYNIGERIA: 'PDP',
    LABOURPARTY: 'LP',
    NEWNIGERIANPEOPLESPARTY: 'NNPP',
    NEWNIGERIAPEOPLESPARTY: 'NNPP',
    ALLPROGRESSIVESGRANDALLIANCE: 'APGA',
    SOCIALDEMOCRATICPARTY: 'SDP',
    YOUNGPROGRESSIVESPARTY: 'YPP',
    AFRICANDEMOCRATICCONGRESS: 'ADC',
    ACCORD: 'A',
    PEOPLESREDEMPTIONPARTY: 'PRP',
    ACTIONDEMOCRATICPARTY: 'ADP',
    ALLIEDPEOPLESMOVEMENT: 'APM',
  };
  if (map[u]) return map[u];
  if (u.length && u.length <= 6) return u;
  return asciiSafe(raw);
}

function httpGet(url) {
  return new Promise((resolve, reject) => {
    https
      .get(
        url,
        {
          headers: {
            'User-Agent': 'ElectionDashboardBot/1.0 (local catalog build; contact: local)',
            Accept: '*/*',
          },
        },
        (res) => {
          if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
            const next = new URL(res.headers.location, url).href;
            httpGet(next).then(resolve, reject);
            return;
          }
          const chunks = [];
          res.on('data', (c) => chunks.push(c));
          res.on('end', () =>
            resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString('utf8') })
          );
        }
      )
      .on('error', reject);
  });
}

async function wikiWikitext(title) {
  const url =
    'https://en.wikipedia.org/w/api.php?action=parse&prop=wikitext&format=json&formatversion=2&redirects=1&page=' +
    encodeURIComponent(title);
  const { body } = await httpGet(url);
  const json = JSON.parse(body);
  if (!json.parse || !json.parse.wikitext) throw new Error('No wikitext for ' + title);
  return json.parse.wikitext;
}

function loadDistrictsFromPu() {
  if (!fs.existsSync(PU_CSV)) {
    return { senByState: {}, repsByState: {} };
  }
  const raw = fs.readFileSync(PU_CSV, 'utf8');
  const lines = raw.split(/\r?\n/).filter(Boolean);
  const headers = parseCsvLine(lines[0]);
  const idx = (name) => headers.indexOf(name);
  const iState = idx('state');
  const iSen = idx('senatorial');
  const iRep = idx('house_of_rep');
  const sen = new Map();
  const reps = new Map();
  for (let li = 1; li < lines.length; li++) {
    const cols = parseCsvLine(lines[li]);
    const state = stateTitle(cols[iState]);
    const dSen = titleCase(cols[iSen]);
    const dRep = titleCase(cols[iRep]);
    if (state && dSen) {
      if (!sen.has(state)) sen.set(state, new Set());
      sen.get(state).add(dSen);
    }
    if (state && dRep) {
      if (!reps.has(state)) reps.set(state, new Set());
      reps.get(state).add(dRep);
    }
  }
  const senByState = {};
  const repsByState = {};
  for (const [st, set] of sen) senByState[st] = [...set].sort((a, b) => a.localeCompare(b));
  for (const [st, set] of reps) repsByState[st] = [...set].sort((a, b) => a.localeCompare(b));
  return { senByState, repsByState };
}

function bestDistrictMatch(state, hint, knownList) {
  const h = titleCase(
    String(hint || '')
      .replace(/Senatorial District$/i, '')
      .replace(/Federal Constituency$/i, '')
      .trim()
  );
  if (!knownList || !knownList.length) return h;
  const key = normalizeKey(h);
  const exact = knownList.find((d) => normalizeKey(d) === key);
  if (exact) return exact;
  const withState = knownList.find((d) => normalizeKey(d) === normalizeKey(`${state} ${h}`));
  if (withState) return withState;
  const contains = knownList.find((d) => {
    const dk = normalizeKey(d);
    return dk.includes(key) || key.includes(dk);
  });
  if (contains) return contains;
  return h;
}

function parseSortname(cell) {
  const m =
    cell.match(/\{\{[Ss]ortname\|([^|]+)\|([^}|]+)(?:\|([^}]+))?\}\}/) ||
    cell.match(/\{\{[Ss]ortname\|([^|]+)\|([^}|]+)\}\}/);
  if (m) {
    if (m[3]) return stripWiki(m[3]);
    return stripWiki(`${m[1].trim()} ${m[2].trim()}`);
  }
  const link = cell.match(/\[\[(?:[^|\]]+\|)?([^\]]+)\]\]/);
  if (link) return stripWiki(link[1]);
  return stripWiki(cell);
}

function parseSenateTemplate(wt, senByState, year, sourceLabel) {
  const races = [];
  const seenSeat = new Set();
  const groupRe =
    /\|group\d+\s*=\s*\[\[(?:[^|\]]+\|)?([^\]]+)\]\]\s*\n\|list\d+\s*=([\s\S]*?)(?=\n\|group\d+\s*=|\n\}\}|\n\|below\s*=)/g;
  let gm;
  while ((gm = groupRe.exec(wt))) {
    let state = stateTitle(gm[1]);
    if (/^abuja$/i.test(gm[1].trim())) state = 'FCT';
    const list = gm[2];
    const seatRe =
      /\*\s*(?:\{\{Party stripe\|[^}]+\}\})?\s*(?:\[\[[^\]]+\|([A-Z]{1,3})\]\]|([A-Z]{1,3}))\s*:\s*(?:''+)?\[\[([^\]]+)\]\](?:''+)?\s*\(([^)]+)\)/g;
    let sm;
    while ((sm = seatRe.exec(list))) {
      const code = sm[1] || sm[2];
      const name = stripWiki(sm[3]).replace(/^'+|'+$/g, '').trim();
      const party = normalizeParty(sm[4]);
      if (!name || /^tbd$/i.test(name) || /^vacant$/i.test(name) || !party) continue;
      let zone = DISTRICT_CODE[code] || code;
      let districtHint = state === 'FCT' ? 'FCT' : `${state} ${zone}`;
      if (state === 'Sokoto') {
        const n = name.toLowerCase();
        if (n.includes('wamakko')) districtHint = 'Sokoto North';
        else if (n.includes('gobir')) districtHint = 'Sokoto East';
        else if (n.includes('tambuwal') || n.includes('danbaba')) districtHint = 'Sokoto South';
      }
      const district = bestDistrictMatch(state, districtHint, senByState[state] || []);
      const seatKey = `${state}|${district}|${year}`;
      if (seenSeat.has(seatKey)) continue; // keep first (general-election winner) over replacements
      seenSeat.add(seatKey);
      races.push({
        state,
        district,
        party,
        name,
        votes: null,
        outcome: 'Won',
        electionYear: String(year),
        source: sourceLabel,
        storageYear: String(year),
      });
    }
  }
  return races;
}

function parseHouseWikipediaParties(wt) {
  const map = new Map();
  const blocks = wt.split(/\n\|-\n/);
  let currentState = null;
  for (const block of blocks) {
    const stateHit = block.match(/rowspan="?\d+"?[^|]*\|\s*\[\[(?:[^|\]]+\|)?([^\]]+)\]\]/);
    if (stateHit) {
      currentState = stateTitle(
        stateHit[1].replace(/\s*State$/i, '').replace(/^Nigerian National Assembly delegation from /i, '')
      );
    }
    if (!currentState) continue;
    const constHit =
      block.match(/align="center"\s*\|\s*\[\[(?:[^|\]]+\|)?([^\]]+)\]\]/) ||
      block.match(/align="center"\s*\|\s*([^\n|{]+)/);
    const partyHit = block.match(
      /\[\[(?:[^\]]+\|)?(APC|PDP|LP|NNPP|APGA|SDP|YPP|ADC|ADP|PRP|A|APM)\]\]/
    );
    if (!constHit || !partyHit) continue;
    const constituency = stripWiki(constHit[1]).replace(/\s*federal constituency$/i, '');
    const party = normalizeParty(partyHit[1]);
    if (!party) continue;
    map.set(normalizeKey(`${currentState}|${constituency}`), party);
    const nameHit = block.match(/\{\{sortname\|([^|]+)\|([^}|]+)/i);
    if (nameHit) {
      const nm = `${nameHit[1].trim()} ${nameHit[2].trim()}`;
      map.set(normalizeKey(`name:${nm}`), party);
    }
  }
  return map;
}

function parseHouseCurrentAffairs(html, repsByState, partyMap, year, sourceLabel) {
  const races = [];
  const rowRe =
    /<tr class="ca-dir-row"><td><a[^>]*>([^<]+)<\/a><\/td><td[^>]*>([^<]+)<\/td><td[^>]*>([^<]+)<\/td><\/tr>/gi;
  let m;
  while ((m = rowRe.exec(html))) {
    const name = asciiSafe(m[1].trim());
    const constituency = titleCase(m[2]);
    const state = stateTitle(m[3]);
    if (!name || !state) continue;
    const district = bestDistrictMatch(state, constituency, repsByState[state] || []);
    const party =
      partyMap.get(normalizeKey(`${state}|${constituency}`)) ||
      partyMap.get(normalizeKey(`${state}|${district}`)) ||
      partyMap.get(normalizeKey(`name:${name}`)) ||
      null;
    races.push({
      state,
      district,
      party: party || 'NA',
      name,
      votes: null,
      outcome: 'Won',
      electionYear: String(year),
      source: sourceLabel,
      storageYear: String(year),
    });
  }
  return races;
}

/** Flat Member|Party|State|Constituency table (2015 list). */
function parseHouseFlatWikiTable(wt, repsByState, year, sourceLabel) {
  const races = [];
  const seen = new Set();
  const rowRe =
    /\n\|-\s*\n\|\s*(.+?)\s*\|\|\s*(.+?)\s*\|\|\s*(.+?)\s*\|\|\s*(.+?)(?=\n\|-|\n\|\})/gs;
  let m;
  while ((m = rowRe.exec(wt))) {
    const name = parseSortname(m[1]);
    const party = normalizeParty(stripWiki(m[2]));
    const state = stateTitle(stripWiki(m[3]));
    const constituency = titleCase(stripWiki(m[4]));
    if (!name || !state || !constituency || /^vacant$/i.test(name)) continue;
    const district = bestDistrictMatch(state, constituency, repsByState[state] || []);
    const key = `${state}|${district}|${year}`;
    if (seen.has(key)) continue;
    seen.add(key);
    races.push({
      state,
      district,
      party: party || 'NA',
      name,
      votes: null,
      outcome: 'Won',
      electionYear: String(year),
      source: sourceLabel,
      storageYear: String(year),
    });
  }
  return races;
}

/** Per-state Constituency/Member/Party/Term tables (2019 list). Prefer first member per seat. */
function parseHouseStateWikiTables(wt, repsByState, year, sourceLabel) {
  const races = [];
  const seen = new Set();
  const sectionRe = /===\s*([^=]+?)\s*===\s*\n([\s\S]*?)(?=\n===\s*[^=]|\n==[^=]|$)/g;
  let sec;
  while ((sec = sectionRe.exec(wt))) {
    const heading = sec[1].trim();
    if (!/State|Federal Capital|FCT/i.test(heading)) continue;
    const state = stateTitle(heading.replace(/\s*State$/i, ''));
    const body = sec[2];
    let currentConst = null;
    const lines = body.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const constHit = line.match(/^!\s*(?:rowspan=\d+\s*\|)?\s*(.+)\s*$/);
      if (constHit && !/^(Constituency|Member|Party|Term)/i.test(constHit[1].replace(/['\[\]]/g, ''))) {
        currentConst = titleCase(stripWiki(constHit[1]));
        continue;
      }
      if (!currentConst) continue;
      if (!/^\|/.test(line) || /^!/.test(line)) continue;
      // Member cell often on its own line after constituency header
      const memberCell = line;
      if (!/\{\{[Ss]ortname|\[\[/.test(memberCell)) continue;
      // Skip faded/deceased? Keep first including opacity for original winner.
      const name = parseSortname(memberCell);
      if (!name || /^vacant$/i.test(name)) continue;
      // Look ahead for party on next few lines
      let party = null;
      for (let j = i; j < Math.min(i + 6, lines.length); j++) {
        const ph = lines[j].match(/\[\[(?:[^\]]+\|)?(APC|PDP|LP|NNPP|APGA|SDP|YPP|ADC|ADP|PRP|A|APM)\]\]/);
        if (ph) {
          party = normalizeParty(ph[1]);
          break;
        }
      }
      const district = bestDistrictMatch(state, currentConst, repsByState[state] || []);
      const key = `${state}|${district}|${year}`;
      if (seen.has(key)) continue;
      seen.add(key);
      races.push({
        state,
        district,
        party: party || 'NA',
        name,
        votes: null,
        outcome: 'Won',
        electionYear: String(year),
        source: sourceLabel,
        storageYear: String(year),
      });
    }
  }
  return races;
}

function readArchiveDir(dir) {
  if (!fs.existsSync(dir)) return [];
  const out = [];
  for (const file of fs.readdirSync(dir).filter((f) => f.endsWith('.json'))) {
    try {
      out.push(JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8')));
    } catch {
      /* skip */
    }
  }
  return out;
}

function racesFromArchive(payloads) {
  const races = [];
  for (const payload of payloads) {
    const meta = payload.meta || {};
    const electionYear = String(
      (meta.electionDate && String(meta.electionDate).slice(0, 4)) || meta.year || '2023'
    );
    const state = stateTitle(meta.state || '');
    if (!state) continue;
    const source = meta.sourceDetail || meta.source || null;
    const title = meta.title || null;
    const storageYear = String(meta.year || electionYear);

    if (Array.isArray(payload.seats) && payload.seats.length) {
      for (const seat of payload.seats) {
        const district = titleCase(seat.district || seat.constituency || '');
        const cands = Array.isArray(seat.candidates) ? seat.candidates : [];
        const winnerName = (seat.winner && seat.winner.name) || (cands[0] && cands[0].name);
        const ranked = cands
          .map((c) => ({ ...c, votes: Number(c.votes) || 0 }))
          .sort((a, b) => b.votes - a.votes);
        const total = ranked.reduce((a, c) => a + c.votes, 0) || 0;
        ranked.forEach((c, idx) => {
          const name = asciiSafe(String(c.name || '').trim());
          const party =
            normalizeParty(c.party) ||
            (/^(\?+|—|–|-)$/.test(String(c.party || '').trim())
              ? 'NA'
              : asciiSafe(String(c.party || 'NA').trim()));
          if (!name) return;
          const won = winnerName ? winnerName === c.name : idx === 0;
          const outcome = c.outcome || (won ? 'Won' : idx === 1 ? 'Runner-up' : 'Contested');
          races.push({
            electionYear,
            state,
            district,
            party: party === '???' || /^\?+$/.test(party) ? 'NA' : party,
            name,
            votes: total ? c.votes : null,
            share: total ? +((c.votes / total) * 100).toFixed(1) : null,
            outcome,
            source,
            title,
            storageYear,
          });
        });
      }
      continue;
    }

    const district = titleCase(meta.district || meta.constituency || meta.seat || '');
    const cands = Array.isArray(payload.candidates) ? payload.candidates : [];
    if (!cands.length) continue;
    const winnerName = payload.winner && payload.winner.name;
    const ranked = cands
      .map((c) => ({ ...c, votes: Number(c.votes) || 0 }))
      .sort((a, b) => b.votes - a.votes);
    const total = ranked.reduce((a, c) => a + c.votes, 0) || 0;
    ranked.forEach((c, idx) => {
      const name = asciiSafe(String(c.name || '').trim());
      const party = normalizeParty(c.party) || asciiSafe(String(c.party || 'Others').trim());
      if (!name) return;
      const won = winnerName ? winnerName === c.name : idx === 0;
      const outcome = won ? 'Won' : idx === 1 ? 'Runner-up' : 'Contested';
      races.push({
        electionYear,
        state,
        district: district || titleCase(c.district || ''),
        party,
        name,
        votes: total ? c.votes : null,
        share: total ? +((c.votes / total) * 100).toFixed(1) : null,
        outcome,
        source,
        title,
        storageYear,
      });
    });
  }
  return races;
}

function countByYear(races, year) {
  return races.filter((r) => String(r.electionYear) === String(year)).length;
}

function mergeRaces(existing, incoming) {
  const out = existing.slice();
  const keys = new Set(
    existing.map(
      (r) =>
        `${r.electionYear}|${normalizeKey(r.state)}|${normalizeKey(r.district)}|${normalizeKey(r.name)}|${r.party}`
    )
  );
  for (const r of incoming) {
    const k = `${r.electionYear}|${normalizeKey(r.state)}|${normalizeKey(r.district)}|${normalizeKey(r.name)}|${r.party}`;
    if (keys.has(k)) continue;
    keys.add(k);
    out.push(r);
  }
  return out;
}

function buildCatalog(office, races, label, gapsNote) {
  const ballots = {};
  const profiles = {};
  const statesByYear = {};
  const districtsByYear = {};

  for (const r of races) {
    const electionYear = String(r.electionYear || '2023');
    const state = asciiSafe(r.state);
    const district = asciiSafe(r.district || state);
    const name = asciiSafe(r.name);
    const party = asciiSafe(r.party || 'NA') || 'NA';
    if (!name || !state) continue;

    if (!ballots[electionYear]) ballots[electionYear] = [];
    if (!statesByYear[electionYear]) statesByYear[electionYear] = new Set();
    if (!districtsByYear[electionYear]) districtsByYear[electionYear] = {};
    statesByYear[electionYear].add(state);
    if (!districtsByYear[electionYear][state]) districtsByYear[electionYear][state] = new Set();
    districtsByYear[electionYear][state].add(district);

    const profileId = slugify(`${state}-${district}-${name}-${electionYear}`);
    const outcome = r.outcome || 'Contested';
    const officeNoun = office === 'sen' ? 'senatorial' : 'House of Representatives';
    const seatLabel =
      office === 'sen' ? `${district} senatorial district` : `${district} federal constituency`;

    const ballotRow = {
      state,
      district,
      party,
      name,
      votes: r.votes != null ? r.votes : null,
      share: r.share != null ? r.share : null,
      outcome,
      profileId,
      storageYear: r.storageYear || electionYear,
      electionDate: r.electionDate || null,
      title: asciiSafe(r.title || `${state} ${seatLabel} ${electionYear}`),
      source: r.source ? asciiSafe(r.source) : null,
    };

    const existingIdx = ballots[electionYear].findIndex((b) => b.profileId === profileId);
    if (existingIdx < 0) ballots[electionYear].push(ballotRow);
    else {
      const prev = ballots[electionYear][existingIdx];
      const prevPreferred = String(prev.storageYear) === electionYear;
      const nextPreferred = String(ballotRow.storageYear) === electionYear;
      if (!prevPreferred && nextPreferred) ballots[electionYear][existingIdx] = ballotRow;
    }

    if (!profiles[profileId]) {
      const roles = [`${seatLabel} candidate (${electionYear})`];
      if (outcome === 'Won') {
        roles.unshift(
          office === 'sen'
            ? `Senator for ${district} (from ${electionYear})`
            : `Member, House of Representatives - ${district} (from ${electionYear})`
        );
      }
      const voteBit =
        r.votes != null
          ? ` with ${Number(r.votes).toLocaleString('en-US')} votes` +
            (r.share != null ? ` (${r.share}%)` : '')
          : '';
      const partyBit = party && party !== 'NA' ? ` (${party})` : '';
      profiles[profileId] = {
        id: profileId,
        name,
        fullName: name,
        state,
        district,
        party,
        photo: null,
        photoCredit: null,
        wiki: null,
        summary: asciiSafe(
          outcome === 'Won'
            ? `${name}${partyBit} won the ${electionYear} ${officeNoun} contest for ${seatLabel}${voteBit}.`
            : `${name} contested the ${electionYear} ${officeNoun} race for ${seatLabel}` +
                (party && party !== 'NA' ? ` on the ${party} ticket` : '') +
                (voteBit ? `, polling${voteBit}` : '') +
                '.'
        ),
        biography: [
          asciiSafe(
            outcome === 'Won'
              ? `Declared winner for ${seatLabel} in ${electionYear}` +
                  (party && party !== 'NA' ? ` under the ${party} platform.` : '.')
              : `Appeared on the archived ${seatLabel} ballot for ${electionYear}` +
                  (party && party !== 'NA' ? ` as the ${party} candidate.` : '.')
          ),
          asciiSafe(
            r.source
              ? `Result source: ${r.source}.`
              : 'Membership drawn from National Assembly / public election records; full contested ballots with vote totals are limited in the local archive.'
          ),
        ],
        history: [
          {
            year: electionYear,
            title: seatLabel,
            detail: asciiSafe(
              `${outcome}` +
                (party && party !== 'NA' ? ` - ${party}` : '') +
                (r.votes != null
                  ? ` - ${Number(r.votes).toLocaleString('en-US')} votes` +
                    (r.share != null ? ` (${r.share}%)` : '')
                  : '')
            ),
          },
        ],
        roles: roles.map(asciiSafe),
      };
    }
  }

  for (const y of Object.keys(ballots)) {
    ballots[y].sort(
      (a, b) =>
        a.state.localeCompare(b.state) ||
        a.district.localeCompare(b.district) ||
        (b.votes || 0) - (a.votes || 0) ||
        a.name.localeCompare(b.name)
    );
  }

  const years = Object.keys(ballots).sort((a, b) => Number(b) - Number(a));
  return {
    office,
    source: label,
    updated: new Date().toISOString().slice(0, 10),
    years,
    statesByYear: Object.fromEntries(
      Object.entries(statesByYear).map(([y, set]) => [y, [...set].sort((a, b) => a.localeCompare(b))])
    ),
    districtsByYear: Object.fromEntries(
      Object.entries(districtsByYear).map(([y, byState]) => [
        y,
        Object.fromEntries(
          Object.entries(byState).map(([st, set]) => [st, [...set].sort((a, b) => a.localeCompare(b))])
        ),
      ])
    ),
    ballots,
    profiles,
    counts: Object.fromEntries(years.map((y) => [y, ballots[y].length])),
    gaps: {
      note: gapsNote,
    },
  };
}

function writeSeedArchive(dir, office, races, year, sourceDetail, electionDate) {
  fs.mkdirSync(dir, { recursive: true });
  const byState = {};
  for (const r of races) {
    if (String(r.electionYear) !== String(year)) continue;
    if (!byState[r.state]) byState[r.state] = [];
    byState[r.state].push(r);
  }
  for (const [state, list] of Object.entries(byState)) {
    const districts = {};
    for (const r of list) {
      if (!districts[r.district]) districts[r.district] = [];
      districts[r.district].push(r);
    }
    const payload = {
      meta: {
        office,
        year: String(year),
        electionDate: electionDate || `${year}-02-25`,
        state,
        level: 'district',
        title: `${state} ${office === 'sen' ? 'Senatorial' : 'House of Representatives'} Election ${year}`,
        source: 'Public National Assembly membership scaffold',
        sourceDetail,
        attribution: 'Independent National Electoral Commission (INEC) / National Assembly public records',
        updated: new Date().toISOString().slice(0, 10),
        collated: false,
        note: 'Winner-only scaffold; runner-up and contested vote totals not in local archive.',
      },
      seats: Object.entries(districts).map(([district, cands]) => ({
        district,
        winner: { name: cands[0].name, party: cands[0].party },
        candidates: cands.map((c) => ({
          name: c.name,
          party: c.party,
          votes: c.votes,
          outcome: c.outcome,
        })),
      })),
      candidates: list.map((c) => ({
        name: c.name,
        party: c.party,
        district: c.district,
        votes: c.votes,
      })),
    };
    fs.writeFileSync(
      path.join(dir, `${slugify(state)}-${year}.json`),
      JSON.stringify(payload, null, 2) + '\n',
      'utf8'
    );
  }
}

async function ensureSenateYear(yearCfg, senByState, senRaces, force) {
  const y = yearCfg.year;
  const have = countByYear(senRaces, y);
  if (!force && have >= yearCfg.minSen) {
    console.log(`Senate ${y}: archive OK (${have})`);
    return senRaces;
  }
  console.log(`Senate ${y}: fetching ${yearCfg.senateTemplate} (have ${have})...`);
  const wt = await wikiWikitext(yearCfg.senateTemplate);
  const parsed = parseSenateTemplate(wt, senByState, y, yearCfg.senateLabel);
  console.log(`Senate ${y}: parsed ${parsed.length}`);
  writeSeedArchive(SEN_DIR, 'sen', parsed, y, yearCfg.senateLabel, yearCfg.electionDate);
  return mergeRaces(
    senRaces.filter((r) => String(r.electionYear) !== y),
    parsed
  );
}

async function ensureHouseYear(yearCfg, repsByState, houseRaces, force) {
  const y = yearCfg.year;
  const have = countByYear(houseRaces, y);
  if (!force && have >= yearCfg.minHouse) {
    console.log(`House ${y}: archive OK (${have})`);
    return houseRaces;
  }
  console.log(`House ${y}: scaffolding (have ${have})...`);
  let parsed = [];
  if (y === '2023') {
    let partyMap = new Map();
    try {
      const wt = await wikiWikitext(yearCfg.housePage);
      partyMap = parseHouseWikipediaParties(wt);
      console.log(`House ${y}: Wikipedia party rows`, partyMap.size);
    } catch (e) {
      console.warn(`House ${y}: Wikipedia parties failed:`, e.message);
    }
    const { body: html } = await httpGet('https://currentaffairs.ng/rep/');
    parsed = parseHouseCurrentAffairs(html, repsByState, partyMap, y, yearCfg.houseLabel);
  } else if (y === '2019') {
    const wt = await wikiWikitext(yearCfg.housePage);
    parsed = parseHouseStateWikiTables(wt, repsByState, y, yearCfg.houseLabel);
  } else if (y === '2015') {
    const wt = await wikiWikitext(yearCfg.housePage);
    parsed = parseHouseFlatWikiTable(wt, repsByState, y, yearCfg.houseLabel);
  }
  console.log(`House ${y}: parsed ${parsed.length}`);
  writeSeedArchive(HOUSE_DIR, 'reps', parsed, y, yearCfg.houseLabel, yearCfg.electionDate);
  return mergeRaces(
    houseRaces.filter((r) => String(r.electionYear) !== y),
    parsed
  );
}

async function main() {
  const force = process.argv.includes('--refresh');
  const { senByState, repsByState } = loadDistrictsFromPu();
  console.log(
    'PU districts: sen states',
    Object.keys(senByState).length,
    'reps states',
    Object.keys(repsByState).length
  );

  let senRaces = force ? [] : racesFromArchive(readArchiveDir(SEN_DIR));
  let houseRaces = force ? [] : racesFromArchive(readArchiveDir(HOUSE_DIR));
  console.log('Archive loaded: sen', senRaces.length, 'house', houseRaces.length);

  for (const yearCfg of YEAR_SOURCES) {
    senRaces = await ensureSenateYear(yearCfg, senByState, senRaces, force);
    houseRaces = await ensureHouseYear(yearCfg, repsByState, houseRaces, force);
  }

  const gapsNote =
    'Winner-only scaffolds from Wikipedia National Assembly membership lists (and CurrentAffairs.ng for 2023 House). ' +
    'Runner-up/contested lists and vote totals are generally unavailable. ' +
    '2015 House Wikipedia list is incomplete versus 360 seats. ' +
    '2027 omitted: no completed National Assembly general election yet.';

  const senCatalog = buildCatalog(
    'sen',
    senRaces,
    'National Assembly senatorial winners (Wikipedia 8th/9th/10th Senate templates) + local archive',
    gapsNote
  );
  const repsCatalog = buildCatalog(
    'reps',
    houseRaces,
    'National Assembly House winners (Wikipedia 2015/2019 lists; CurrentAffairs.ng + Wikipedia for 2023) + local archive',
    gapsNote
  );

  fs.mkdirSync(path.dirname(SEN_OUT), { recursive: true });
  fs.writeFileSync(SEN_OUT, JSON.stringify(senCatalog, null, 2) + '\n', 'utf8');
  fs.writeFileSync(REPS_OUT, JSON.stringify(repsCatalog, null, 2) + '\n', 'utf8');
  console.log('Wrote', SEN_OUT, senCatalog.counts);
  console.log('Wrote', REPS_OUT, repsCatalog.counts);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
