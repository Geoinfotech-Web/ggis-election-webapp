/**
 * Build public/data/gubernatorial-candidates.json from archived state result files.
 * Uses ASCII punctuation only to avoid encoding issues on Windows shells.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const DIR = path.join(ROOT, 'data', 'election-results', 'gubernatorial');
const OUT = path.join(ROOT, 'public', 'data', 'gubernatorial-candidates.json');

const STORAGE_TO_ELECTION = {
  '2014': '2015',
  '2018': '2019',
  '2022': '2023',
  '2026': '2026',
};

function slugify(s) {
  return String(s || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

function electionYearOf(meta) {
  const dated = meta && meta.electionDate;
  if (dated && /^\d{4}/.test(String(dated))) return String(dated).slice(0, 4);
  const storage = String((meta && meta.year) || '');
  return STORAGE_TO_ELECTION[storage] || storage;
}

function totalVotes(cands) {
  return (cands || []).reduce((a, c) => a + (Number(c.votes) || 0), 0);
}

const ballots = {};
const profiles = {};
const statesByYear = {};

for (const file of fs.readdirSync(DIR).filter((f) => f.endsWith('.json'))) {
  let payload;
  try {
    payload = JSON.parse(fs.readFileSync(path.join(DIR, file), 'utf8'));
  } catch {
    continue;
  }
  const meta = payload.meta || {};
  if (!meta.state) continue;
  const storageYear = String(meta.year || '');
  const electionYear = electionYearOf(meta);
  const state = String(meta.state).trim();
  const cands = Array.isArray(payload.candidates) ? payload.candidates : [];
  if (!cands.length) continue;
  const winnerName = payload.winner && payload.winner.name;
  const total = totalVotes(cands) || 1;

  if (!ballots[electionYear]) ballots[electionYear] = [];
  if (!statesByYear[electionYear]) statesByYear[electionYear] = new Set();
  statesByYear[electionYear].add(state);

  // Sort by votes desc for stable ranking
  const ranked = cands
    .map((c) => ({ ...c, votes: Number(c.votes) || 0 }))
    .sort((a, b) => b.votes - a.votes);

  ranked.forEach((c, idx) => {
    const party = String(c.party || 'Others').trim();
    const name = String(c.name || '').trim();
    if (!name) return;
    const profileId = slugify(`${state}-${name}-${electionYear}`);
    const share = +((c.votes / total) * 100).toFixed(1);
    const won = winnerName && winnerName === name;
    const outcome = won ? 'Won' : idx === 0 && !winnerName ? 'Leading archive' : idx === 1 ? 'Runner-up' : 'Contested';

    // Same race can appear under multiple storage folders (e.g. 2022 + misfiled 2026).
    // Keep one ballot row per profileId; prefer storageYear matching the election year.
    const existingIdx = ballots[electionYear].findIndex((b) => b.profileId === profileId);
    const ballotRow = {
      state,
      party,
      name,
      votes: c.votes,
      share,
      outcome,
      profileId,
      storageYear,
      electionDate: meta.electionDate || meta.updated || null,
      title: meta.title || `${state} Governorship ${electionYear}`,
      source: meta.sourceDetail || meta.source || meta.attribution || null,
    };
    if (existingIdx < 0) {
      ballots[electionYear].push(ballotRow);
    } else {
      const prev = ballots[electionYear][existingIdx];
      const prevPreferred = String(prev.storageYear) === electionYear;
      const nextPreferred = storageYear === electionYear;
      if (!prevPreferred && nextPreferred) {
        ballots[electionYear][existingIdx] = ballotRow;
      }
    }

    if (!profiles[profileId]) {
      const roles = [`${state} governorship candidate (${electionYear})`];
      if (won) roles.unshift(`Governor of ${state} (from ${electionYear})`);
      profiles[profileId] = {
        id: profileId,
        name,
        fullName: name,
        state,
        party,
        photo: null,
        photoCredit: null,
        wiki: null,
        summary: won
          ? `${name} (${party}) won the ${electionYear} ${state} governorship election with ${c.votes.toLocaleString()} votes (${share}%).`
          : `${name} contested the ${electionYear} ${state} governorship election on the ${party} ticket, polling ${c.votes.toLocaleString()} votes (${share}%).`,
        biography: [
          won
            ? `Declared winner of the ${state} governorship contest in ${electionYear} under the ${party} platform.`
            : `Appeared on the archived ${state} governorship ballot for ${electionYear} as the ${party} candidate.`,
          meta.sourceDetail || meta.source
            ? `Result source: ${meta.sourceDetail || meta.source}.`
            : 'Result drawn from the dashboard gubernatorial archive.',
        ],
        history: [
          {
            year: String(electionYear),
            title: `${state} governorship`,
            detail: `${outcome} · ${party} · ${c.votes.toLocaleString()} votes (${share}%)`,
          },
        ],
        roles,
      };
    } else {
      // Merge additional races into existing profile history
      const hist = profiles[profileId].history || [];
      const label = `${electionYear} ${state}`;
      if (!hist.some((h) => h.year === String(electionYear) && String(h.title || '').includes(state))) {
        hist.push({
          year: String(electionYear),
          title: `${state} governorship`,
          detail: `${outcome} · ${party} · ${c.votes.toLocaleString()} votes (${share}%)`,
        });
        hist.sort((a, b) => Number(b.year) - Number(a.year));
        profiles[profileId].history = hist;
      }
    }
  });
}

for (const y of Object.keys(ballots)) {
  ballots[y].sort((a, b) => a.state.localeCompare(b.state) || b.votes - a.votes || a.name.localeCompare(b.name));
}

const years = Object.keys(ballots).sort((a, b) => Number(b) - Number(a));
const out = {
  source: 'Dashboard gubernatorial archive (INEC-declared / collated state results)',
  updated: new Date().toISOString().slice(0, 10),
  years,
  statesByYear: Object.fromEntries(
    Object.entries(statesByYear).map(([y, set]) => [y, [...set].sort((a, b) => a.localeCompare(b))])
  ),
  ballots,
  profiles,
  counts: Object.fromEntries(years.map((y) => [y, ballots[y].length])),
};

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(out, null, 2) + '\n', 'utf8');
console.log('Wrote', OUT);
console.log('years', out.counts);
console.log('profiles', Object.keys(profiles).length);
