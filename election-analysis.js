/**
 * Election Analysis — explain results (not Live Results).
 * Aggregates archives into section payloads: summary, drivers, performance,
 * geographic swing, turnout, competitiveness, history, demographics, anomalies.
 */
const fs = require('fs');
const path = require('path');
const {
  DATA_DIR,
  PARTY_COLORS,
  partyColor,
  canonicalState,
  electionYearOf,
  isPublishableLegacyPayload,
  listGovCatalog,
  availablePresLgaYears,
  availablePresLgaStates,
  filterPresLgaPayload,
  presLgaFileForYear,
} = require('./election-results-data');

const MAJOR_PARTIES = ['APC', 'PDP', 'LP', 'NNPP', 'APGA', 'ADC', 'SDP'];
const CACHE_TTL_MS = 5 * 60 * 1000;

/** INEC-declared national presidential turnout (valid votes ÷ register). */
const NATIONAL_TURNOUT = {
  '2015': { registered: 67422005, turnoutPct: 43.7 },
  '2019': { registered: 84004184, turnoutPct: 34.8 },
  '2023': { registered: 93469008, turnoutPct: 27.1 },
};

const GEO_ZONES = {
  'North Central': ['Benue', 'Kogi', 'Kwara', 'Nasarawa', 'Niger', 'Plateau', 'FCT'],
  'North East': ['Adamawa', 'Bauchi', 'Borno', 'Gombe', 'Taraba', 'Yobe'],
  'North West': ['Jigawa', 'Kaduna', 'Kano', 'Katsina', 'Kebbi', 'Sokoto', 'Zamfara'],
  'South East': ['Abia', 'Anambra', 'Ebonyi', 'Enugu', 'Imo'],
  'South South': ['Akwa Ibom', 'Bayelsa', 'Cross River', 'Delta', 'Edo', 'Rivers'],
  'South West': ['Ekiti', 'Lagos', 'Ogun', 'Ondo', 'Osun', 'Oyo'],
};

const STATE_TO_ZONE = {};
Object.entries(GEO_ZONES).forEach(([zone, states]) => {
  states.forEach((s) => { STATE_TO_ZONE[s] = zone; });
});

let cache = { at: 0, base: null, key: null, payload: null };

function buildAnalysisBundle(filters = {}) {
  const now = Date.now();
  const key = JSON.stringify({
    office: filters.office || 'pres',
    year: filters.year || '',
    compare: filters.compare || '',
    party: filters.party || 'all',
    region: filters.region || 'all',
    state: filters.state || 'all',
    momentumWeight: filters.momentumWeight,
    retentionWeight: filters.retentionWeight,
    competitiveCutoff: filters.competitiveCutoff,
  });
  if (cache.payload && now - cache.at < CACHE_TTL_MS && cache.key === key) {
    return cache.payload;
  }

  let base = cache.base;
  if (!base || now - cache.at >= CACHE_TTL_MS) {
    base = loadBase();
  }

  const payload = assemblePayload(base, filters);
  cache = { at: now, base, key, payload };
  return payload;
}

function loadBase() {
  const catalog = listGovCatalog();
  const registeredByState = loadRegisteredByState();
  const pres = loadPresidentialSeries(registeredByState);
  const gov = loadGubernatorialSeries();
  const sen = loadSeatSeries('senatorial', 'sen');
  const reps = loadSeatSeries('house', 'reps');
  const states = [...new Set([
    ...Object.keys(catalog.byState || {}),
    ...(gov.margins || []).map((m) => m.state),
    ...Object.keys(pres.byYear[pres.years[pres.years.length - 1]]?.units || {}),
  ])].filter(Boolean).sort((a, b) => a.localeCompare(b));
  return { pres, gov, sen, reps, states, registeredByState };
}

function loadRegisteredByState() {
  const file = path.join(__dirname, 'data', 'reference', 'population-pvc-data.json');
  const map = {};
  try {
    const payload = JSON.parse(fs.readFileSync(file, 'utf8'));
    (payload.statePopulation || []).forEach((row) => {
      const state = canonicalState(row.state);
      if (state && row.registeredVoters) map[state] = Number(row.registeredVoters) || 0;
    });
  } catch {
    /* optional */
  }
  return map;
}

function readJsonSafe(fullPath) {
  try {
    return JSON.parse(fs.readFileSync(fullPath, 'utf8'));
  } catch {
    return null;
  }
}

function emptyPartyBucket() {
  return { wins: 0, seats: 0, votes: 0, voteShare: 0, seatShare: 0 };
}

function ensureParty(map, party) {
  const key = String(party || 'Others').trim() || 'Others';
  if (!map[key]) map[key] = emptyPartyBucket();
  return map[key];
}

function sumVotes(votes) {
  if (!votes || typeof votes !== 'object') return 0;
  return Object.values(votes).reduce((a, v) => a + (Number(v) || 0), 0);
}

function marginFromCandidates(candidates) {
  const rows = (candidates || [])
    .map((c) => ({ party: c.party, name: c.name, votes: Number(c.votes) || 0 }))
    .filter((c) => c.votes > 0)
    .sort((a, b) => b.votes - a.votes);
  if (rows.length < 2) {
    if (rows.length === 1) {
      return {
        winnerParty: rows[0].party,
        winnerName: rows[0].name,
        winnerVotes: rows[0].votes,
        runnerParty: null,
        runnerName: null,
        runnerVotes: 0,
        marginPct: null,
        totalVotes: rows[0].votes,
      };
    }
    return null;
  }
  const total = rows.reduce((a, r) => a + r.votes, 0) || 1;
  return {
    winnerParty: rows[0].party,
    winnerName: rows[0].name,
    winnerVotes: rows[0].votes,
    runnerParty: rows[1].party,
    runnerName: rows[1].name,
    runnerVotes: rows[1].votes,
    marginPct: ((rows[0].votes - rows[1].votes) / total) * 100,
    totalVotes: total,
  };
}

function formatCompact(n) {
  const v = Number(n) || 0;
  if (v >= 1e6) return `${(v / 1e6).toFixed(1)}M`;
  if (v >= 1e3) return `${(v / 1e3).toFixed(0)}k`;
  return String(Math.round(v));
}

function round1(n) {
  return Number((Number(n) || 0).toFixed(1));
}

function round2(n) {
  return Number((Number(n) || 0).toFixed(2));
}

function pct(part, whole) {
  if (!whole) return 0;
  return (part / whole) * 100;
}

function zoneOf(state) {
  return STATE_TO_ZONE[canonicalState(state)] || 'Other';
}

function inRegion(state, region) {
  if (!region || region === 'all') return true;
  return zoneOf(state) === region;
}

function inState(stateName, stateFilter) {
  if (!stateFilter || stateFilter === 'all') return true;
  return canonicalState(stateName) === canonicalState(stateFilter);
}

/** Rank parties from a filtered race list (used when State ≠ All). */
function partyStatsFromRaces(races) {
  const parties = {};
  let totalVotes = 0;
  (races || []).forEach((r) => {
    const winnerParty = r.winnerParty || 'Others';
    ensureParty(parties, winnerParty).wins += 1;
    (r.candidates || []).forEach((c) => {
      const votes = Number(c.votes) || 0;
      ensureParty(parties, c.party || 'Others').votes += votes;
      totalVotes += votes;
    });
  });
  const raceCount = (races || []).length;
  Object.values(parties).forEach((p) => {
    p.seatShare = pct(p.wins, raceCount || 1);
    p.voteShare = pct(p.votes, totalVotes);
  });
  return { parties, totalVotes, ranked: partyRankList(parties) };
}

function statesForGovYear(base, year) {
  return [...new Set((base.gov?.byYear?.[year]?.units || []).map((u) => u.state).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b));
}

function loadPresidentialSeries(registeredByState) {
  const years = [];
  const byYear = {};
  const lgaByYear = {};
  for (const year of ['2015', '2019', '2023']) {
    const file = path.join(DATA_DIR, `presidential-${year}-states.json`);
    if (!fs.existsSync(file)) continue;
    const payload = readJsonSafe(file);
    if (!payload || !isPublishableLegacyPayload(payload)) continue;
    const parties = {};
    let totalVotes = 0;
    let stateWins = 0;
    const competitive = [];
    const winnersByState = {};
    const units = {};
    Object.entries(payload.units || {}).forEach(([stateRaw, row]) => {
      const votes = row.votes || {};
      const unitTotal = sumVotes(votes);
      totalVotes += unitTotal;
      const stateName = canonicalState(stateRaw);
      const winnerParty = row.party || 'Others';
      const winnerName = row.winner || null;
      winnersByState[stateName] = winnerParty;
      ensureParty(parties, winnerParty).wins += 1;
      stateWins += 1;
      Object.entries(votes).forEach(([party, v]) => {
        ensureParty(parties, party).votes += Number(v) || 0;
      });
      const ranked = Object.entries(votes)
        .map(([party, v]) => ({ party, votes: Number(v) || 0 }))
        .sort((a, b) => b.votes - a.votes);
      const marginPct = ranked.length >= 2 && unitTotal > 0
        ? ((ranked[0].votes - ranked[1].votes) / unitTotal) * 100
        : null;
      const registered = registeredByState[stateName] || null;
      // Register is 2023 vintage — only treat as turnout proxy for 2023.
      const turnoutPct = (year === '2023' && registered && unitTotal)
        ? round1(pct(unitTotal, registered))
        : null;
      units[stateName] = {
        state: stateName,
        region: zoneOf(stateName),
        winnerParty,
        winnerName,
        votes: { ...votes },
        totalVotes: unitTotal,
        marginPct: marginPct != null ? round2(marginPct) : null,
        runnerParty: ranked[1]?.party || null,
        runnerVotes: ranked[1]?.votes || 0,
        winnerVotes: ranked[0]?.votes || 0,
        registered,
        turnoutPct,
        partyShares: Object.fromEntries(
          Object.entries(votes).map(([p, v]) => [p, round2(pct(Number(v) || 0, unitTotal))])
        ),
      };
      if (marginPct != null) {
        competitive.push({
          state: stateName,
          year,
          party: ranked[0].party,
          marginPct: round2(marginPct),
          winnerVotes: ranked[0].votes,
          runnerVotes: ranked[1].votes,
          totalVotes: unitTotal,
        });
      }
    });
    Object.values(parties).forEach((p) => {
      p.voteShare = pct(p.votes, totalVotes);
      p.seatShare = pct(p.wins, stateWins);
    });
    const nat = NATIONAL_TURNOUT[year] || null;
    years.push(year);
    byYear[year] = {
      parties,
      totalVotes,
      stateWins,
      competitive,
      winnersByState,
      units,
      nationalTurnout: nat,
      title: payload.meta?.title || `${year} Presidential Election`,
      source: payload.meta?.source || 'INEC',
    };

    // Optional LGA pack (Stears). Phase 0: 2023 only today.
    const lgaRel = presLgaFileForYear(year);
    if (lgaRel) {
      const lgaFull = path.join(DATA_DIR, lgaRel);
      const lgaPayload = readJsonSafe(lgaFull);
      if (lgaPayload && isPublishableLegacyPayload(lgaPayload)) {
        lgaByYear[year] = lgaPayload;
      }
    }
  }
  // Discover additional presidential LGA years not in the state series loop above.
  for (const y of availablePresLgaYears()) {
    if (lgaByYear[y]) continue;
    const lgaRel = presLgaFileForYear(y);
    if (!lgaRel) continue;
    const lgaPayload = readJsonSafe(path.join(DATA_DIR, lgaRel));
    if (lgaPayload && isPublishableLegacyPayload(lgaPayload)) lgaByYear[y] = lgaPayload;
  }
  return { years, byYear, lgaByYear, lgaYears: Object.keys(lgaByYear).sort() };
}

function loadGubernatorialSeries() {
  const catalog = listGovCatalog();
  const yearsSet = new Set();
  const byYear = {};
  const margins = [];
  const retentionPairs = [];
  const byStateYear = {};

  for (const [state, entries] of Object.entries(catalog.byState || {})) {
    const chronological = [...entries].sort((a, b) => Number(a.electionYear) - Number(b.electionYear));
    let prevParty = null;
    let prevYear = null;
    for (const entry of chronological) {
      const full = path.join(DATA_DIR, entry.file);
      const payload = readJsonSafe(full);
      if (!payload || !isPublishableLegacyPayload(payload)) continue;
      const year = String(entry.electionYear || electionYearOf(payload.meta) || entry.storageYear);
      yearsSet.add(year);
      if (!byYear[year]) byYear[year] = { parties: {}, races: 0, totalVotes: 0, units: [] };
      const winnerParty = payload.winner?.party || payload.candidates?.[0]?.party || 'Others';
      const winnerName = payload.winner?.name || payload.candidates?.[0]?.name || null;
      ensureParty(byYear[year].parties, winnerParty).wins += 1;
      byYear[year].races += 1;
      const margin = marginFromCandidates(payload.candidates);
      const unitVotes = {};
      Object.entries(payload.units || {}).forEach(([lga, u]) => {
        unitVotes[lga] = {
          winnerParty: u.party,
          votes: u.votes || {},
          totalVotes: sumVotes(u.votes || {}),
        };
      });
      const race = {
        state,
        region: zoneOf(state),
        year,
        winnerParty,
        winnerName,
        marginPct: margin?.marginPct != null ? round2(margin.marginPct) : null,
        winnerVotes: margin?.winnerVotes || 0,
        runnerParty: margin?.runnerParty || null,
        runnerVotes: margin?.runnerVotes || 0,
        totalVotes: margin?.totalVotes || 0,
        candidates: (payload.candidates || []).map((c) => ({
          name: c.name,
          party: c.party,
          votes: Number(c.votes) || 0,
        })),
        lgas: unitVotes,
        estimated: !!(payload.meta?.lgaMethod === 'pvc-proportional' || payload.meta?.modeled),
      };
      byYear[year].units.push(race);
      byStateYear[`${state}|${year}`] = race;
      if (margin) {
        byYear[year].totalVotes += margin.totalVotes;
        ensureParty(byYear[year].parties, winnerParty).votes += margin.winnerVotes;
        Object.entries(
          (payload.candidates || []).reduce((acc, c) => {
            const p = c.party || 'Others';
            acc[p] = (acc[p] || 0) + (Number(c.votes) || 0);
            return acc;
          }, {})
        ).forEach(([party, v]) => {
          if (party !== winnerParty) ensureParty(byYear[year].parties, party).votes += v;
        });
        margins.push({
          state,
          year,
          party: margin.winnerParty,
          marginPct: round2(margin.marginPct ?? 0),
          winnerVotes: margin.winnerVotes,
          runnerVotes: margin.runnerVotes,
          totalVotes: margin.totalVotes,
          competitive: (margin.marginPct ?? 100) < 10,
          estimated: race.estimated,
        });
      }
      if (prevParty && prevYear) {
        retentionPairs.push({
          state,
          fromYear: prevYear,
          toYear: year,
          fromParty: prevParty,
          toParty: winnerParty,
          retained: prevParty === winnerParty,
        });
      }
      prevParty = winnerParty;
      prevYear = year;
    }
  }

  const years = [...yearsSet].sort((a, b) => Number(a) - Number(b));
  years.forEach((year) => {
    const bucket = byYear[year];
    Object.values(bucket.parties).forEach((p) => {
      p.seatShare = pct(p.wins, bucket.races);
      p.voteShare = pct(p.votes, bucket.totalVotes);
    });
  });

  return { years, byYear, margins, retentionPairs, byStateYear };
}

function loadSeatSeries(subdir, officeLabel) {
  const dir = path.join(DATA_DIR, subdir);
  const byYear = {};
  const yearsSet = new Set();
  if (!fs.existsSync(dir)) return { years: [], byYear: {}, office: officeLabel, hasVoteTotals: false };

  let hasVoteTotals = false;
  for (const file of fs.readdirSync(dir)) {
    if (!file.endsWith('.json')) continue;
    const payload = readJsonSafe(path.join(dir, file));
    if (!payload || !isPublishableLegacyPayload(payload)) continue;
    const year = String(electionYearOf(payload.meta) || payload.meta?.year || '');
    if (!year) continue;
    yearsSet.add(year);
    if (!byYear[year]) byYear[year] = { parties: {}, seats: 0, states: [], units: [], totalVotes: 0 };
    const state = canonicalState(payload.meta?.state || '');
    const seats = Array.isArray(payload.seats) ? payload.seats : [];
    seats.forEach((seat) => {
      const party = seat.winner?.party || seat.candidates?.[0]?.party || 'Others';
      const name = seat.winner?.name || seat.candidates?.[0]?.name || null;
      const district = seat.district || seat.constituency || 'Seat';
      ensureParty(byYear[year].parties, party).wins += 1;
      ensureParty(byYear[year].parties, party).seats += 1;
      byYear[year].seats += 1;
      byYear[year].states.push(state);
      const candVotes = (seat.candidates || [])
        .map((c) => ({ party: c.party, name: c.name, votes: Number(c.votes) || 0 }))
        .filter((c) => c.votes > 0);
      if (candVotes.length) hasVoteTotals = true;
      const total = candVotes.reduce((a, c) => a + c.votes, 0);
      candVotes.forEach((c) => {
        ensureParty(byYear[year].parties, c.party || 'Others').votes += c.votes;
      });
      byYear[year].totalVotes += total;
      candVotes.sort((a, b) => b.votes - a.votes);
      const marginPct = candVotes.length >= 2 && total
        ? round2(((candVotes[0].votes - candVotes[1].votes) / total) * 100)
        : null;
      byYear[year].units.push({
        state,
        region: zoneOf(state),
        district,
        year,
        winnerParty: party,
        winnerName: name,
        marginPct,
        totalVotes: total || null,
        votesAvailable: candVotes.length >= 2,
        candidates: candVotes,
      });
    });
  }

  const years = [...yearsSet].sort((a, b) => Number(a) - Number(b));
  years.forEach((year) => {
    const bucket = byYear[year];
    bucket.states = [...new Set(bucket.states.filter(Boolean))].sort((a, b) => a.localeCompare(b));
    const yearVotes = bucket.totalVotes || 0;
    Object.values(bucket.parties).forEach((p) => {
      p.seatShare = pct(p.wins, bucket.seats);
      p.voteShare = yearVotes ? pct(p.votes || 0, yearVotes) : 0;
    });
  });

  return { years, byYear, office: officeLabel, hasVoteTotals };
}

function partiesUnion(seriesList) {
  const set = new Set(MAJOR_PARTIES);
  seriesList.forEach((series) => {
    Object.values(series.byYear || {}).forEach((bucket) => {
      Object.keys(bucket.parties || {}).forEach((p) => set.add(p));
    });
  });
  return [...set];
}

function buildChartSeries(series, metric) {
  const parties = partiesUnion([series]).filter((p) =>
    series.years.some((y) => (series.byYear[y]?.parties?.[p]?.[metric] || 0) > 0)
  );
  const focus = parties
    .slice()
    .sort((a, b) => {
      const last = series.years[series.years.length - 1];
      return (series.byYear[last]?.parties?.[b]?.[metric] || 0) - (series.byYear[last]?.parties?.[a]?.[metric] || 0);
    })
    .slice(0, 8);

  return {
    years: series.years,
    parties: focus.map((party) => ({
      party,
      color: partyColor(party),
      values: series.years.map((y) => round2(series.byYear[y]?.parties?.[party]?.[metric] || 0)),
    })),
  };
}

function buildVoteVolume(pres) {
  const majors = ['APC', 'PDP', 'LP', 'NNPP'];
  return {
    years: pres.years,
    totalVotes: pres.years.map((y) => pres.byYear[y]?.totalVotes || 0),
    byParty: majors.map((party) => ({
      party,
      color: partyColor(party),
      values: pres.years.map((y) => Math.round(pres.byYear[y]?.parties?.[party]?.votes || 0)),
    })),
  };
}

function clamp01(n) {
  return Math.max(0, Math.min(1, n));
}

/** Coverage score for an office/year bucket (races, seats, or geographic units). */
function yearCoverage(series, year) {
  const bucket = series?.byYear?.[year];
  if (!bucket) return 0;
  return bucket.units?.length
    || bucket.races
    || bucket.seats
    || bucket.stateWins
    || 0;
}

/**
 * Prefer the richest archive year (most units/races). Among near-ties (±10% or ±2 units),
 * prefer the most recent so offices don't stick on an older dense year.
 */
function pickDefaultYear(series) {
  const years = series?.years || [];
  if (!years.length) return '';
  const scored = years.map((y) => ({ y, score: yearCoverage(series, y) }));
  const maxScore = Math.max(...scored.map((s) => s.score), 0);
  if (maxScore <= 0) return years[years.length - 1];
  const threshold = Math.max(maxScore - 2, Math.floor(maxScore * 0.9));
  const contenders = scored.filter((s) => s.score >= threshold);
  contenders.sort((a, b) => Number(b.y) - Number(a.y));
  return contenders[0]?.y || years[years.length - 1];
}

/** Prior cycle with meaningful coverage when possible (not just the previous calendar label). */
function pickCompareYear(series, year) {
  const years = series?.years || [];
  const idx = years.indexOf(year);
  if (idx <= 0) return '';
  const currentScore = yearCoverage(series, year);
  const minUseful = Math.max(3, Math.floor(currentScore * 0.35));
  for (let i = idx - 1; i >= 0; i -= 1) {
    if (yearCoverage(series, years[i]) >= minUseful) return years[i];
  }
  return years[idx - 1] || '';
}

function resolveFilters(base, filters) {
  const office = ['pres', 'gov', 'sen', 'reps'].includes(filters.office) ? filters.office : 'pres';
  const series = office === 'pres' ? base.pres
    : office === 'gov' ? base.gov
    : office === 'sen' ? base.sen
    : base.reps;
  const years = series.years || [];
  let year = String(filters.year || '');
  if (!year || !years.includes(year)) year = pickDefaultYear(series);
  let compare = String(filters.compare || '');
  if (!compare || compare === year || !years.includes(compare)) {
    compare = pickCompareYear(series, year);
  }
  const party = filters.party && filters.party !== 'all' ? String(filters.party) : 'all';
  const region = filters.region && filters.region !== 'all' ? String(filters.region) : 'all';
  // State filter: governorship always; presidential when an LGA pack exists for the year.
  let state = 'all';
  if (office === 'gov' || office === 'pres') {
    const raw = filters.state && filters.state !== 'all' ? canonicalState(String(filters.state)) : 'all';
    if (raw && raw !== 'all') {
      const known = office === 'gov'
        ? ((base.states || []).length ? base.states : statesForGovYear(base, year))
        : (
          (base.pres?.lgaByYear?.[year] && availablePresLgaStates(year))
          || Object.keys(base.pres?.byYear?.[year]?.units || {})
        );
      if ((known || []).some((s) => canonicalState(s) === raw)) state = raw;
      else if (office === 'pres' && base.pres?.byYear?.[year]?.units?.[raw]) state = raw;
    }
  }
  return { office, year, compare, party, region, state, series };
}

function historyTrendFromSeries(series, metric) {
  const years = series?.years || [];
  return MAJOR_PARTIES.map((p) => ({
    party: p,
    color: partyColor(p),
    values: years.map((y) => round1(series.byYear[y]?.parties?.[p]?.[metric] || 0)),
  }));
}

function partyRankList(partiesMap) {
  return Object.entries(partiesMap || {})
    .map(([party, row]) => ({
      party,
      color: partyColor(party),
      wins: row.wins || 0,
      seats: row.seats || row.wins || 0,
      votes: row.votes || 0,
      voteShare: round2(row.voteShare || 0),
      seatShare: round2(row.seatShare || 0),
    }))
    .sort((a, b) => (b.votes || b.wins) - (a.votes || a.wins));
}

function buildPresUnits(cur, prev, region) {
  const units = [];
  Object.values(cur?.units || {}).forEach((u) => {
    if (!inRegion(u.state, region)) return;
    const p = prev?.units?.[u.state];
    const focusParties = new Set([
      ...Object.keys(u.partyShares || {}),
      ...Object.keys(p?.partyShares || {}),
    ]);
    const swings = {};
    focusParties.forEach((party) => {
      const now = u.partyShares?.[party] || 0;
      const then = p?.partyShares?.[party] || 0;
      swings[party] = round2(now - then);
    });
    const winnerSwing = p
      ? round2((u.partyShares?.[u.winnerParty] || 0) - (p.partyShares?.[u.winnerParty] || 0))
      : null;
    const flipped = !!(p && p.winnerParty !== u.winnerParty);
    units.push({
      ...u,
      previousWinner: p?.winnerParty || null,
      previousMargin: p?.marginPct ?? null,
      previousTurnout: p?.turnoutPct ?? null,
      swingWinnerPts: winnerSwing,
      swings,
      flipped,
      turnoutChange: (u.turnoutPct != null && p?.turnoutPct != null)
        ? round1(u.turnoutPct - p.turnoutPct)
        : null,
    });
  });
  return units.sort((a, b) => a.state.localeCompare(b.state));
}

/** Build Geography LGA rows for a presidential year × state (Stears pack). */
function buildPresLgaUnits(lgaPayload, stateName) {
  if (!lgaPayload) return [];
  const filtered = filterPresLgaPayload(lgaPayload, stateName);
  const units = [];
  Object.entries(filtered.units || {}).forEach(([lga, row]) => {
    const votes = row.votes || {};
    const totalVotes = sumVotes(votes);
    const ranked = Object.entries(votes)
      .map(([party, v]) => ({ party, votes: Number(v) || 0 }))
      .sort((a, b) => b.votes - a.votes);
    const marginPct = ranked.length >= 2 && totalVotes > 0
      ? ((ranked[0].votes - ranked[1].votes) / totalVotes) * 100
      : null;
    const winnerParty = row.party || ranked[0]?.party || 'Others';
    units.push({
      state: lga,
      district: lga,
      parentState: stateName,
      region: zoneOf(stateName),
      winnerParty,
      winnerName: row.winner || null,
      votes: { ...votes },
      totalVotes,
      marginPct: marginPct != null ? round2(marginPct) : null,
      runnerParty: ranked[1]?.party || null,
      runnerVotes: ranked[1]?.votes || 0,
      winnerVotes: ranked[0]?.votes || 0,
      partyShares: Object.fromEntries(
        Object.entries(votes).map(([p, v]) => [p, round2(pct(Number(v) || 0, totalVotes))])
      ),
      previousWinner: null,
      previousMargin: null,
      previousTurnout: null,
      swingWinnerPts: null,
      swings: {},
      flipped: false,
      turnoutPct: null,
      turnoutChange: null,
    });
  });
  return units.sort((a, b) => a.state.localeCompare(b.state));
}

function buildNarrative({ office, year, compare, winner, runner, units, flips, largestSwing, turnout }) {
  const parts = [];
  if (office === 'pres' && winner) {
    parts.push(
      `In ${year}, ${winner.name || winner.party} (${winner.party}) led nationally`
      + (winner.voteShare != null ? ` with ${winner.voteShare}% of valid votes` : '')
      + (winner.marginPts != null ? ` — a ${winner.marginPts}-point margin over ${runner?.party || 'the runner-up'}.` : '.')
    );
    if (winner.wins != null) {
      parts.push(`${winner.party} carried ${winner.wins} of ${winner.totalUnits || '—'} states/FCT.`);
    }
    if (flips != null && compare) {
      parts.push(`${flips} states changed party versus ${compare}.`);
    }
    if (largestSwing) {
      parts.push(
        `The largest ${largestSwing.party} swing was ${largestSwing.swing > 0 ? '+' : ''}${largestSwing.swing} pts in ${largestSwing.state}.`
      );
    }
    const gained = (units || []).filter((u) => u.flipped && u.winnerParty === winner.party).map((u) => u.state);
    const lost = (units || []).filter((u) => u.flipped && u.previousWinner === winner.party).map((u) => u.state);
    if (gained.length) parts.push(`${winner.party} gained ${gained.slice(0, 5).join(', ')}${gained.length > 5 ? ` (+${gained.length - 5} more)` : ''}.`);
    if (lost.length) parts.push(`${winner.party} lost ${lost.slice(0, 4).join(', ')}${lost.length > 4 ? '…' : ''} relative to ${compare}.`);
    if (runner) {
      const retained = (units || []).filter((u) => !u.flipped && u.winnerParty === runner.party).length;
      parts.push(`${runner.party} retained ${retained} states where it already led.`);
    }
    if (turnout?.current != null) {
      parts.push(
        `National turnout was ${turnout.current}%`
        + (turnout.change != null ? ` (${turnout.change > 0 ? '+' : ''}${turnout.change} pts vs ${compare}).` : '.')
      );
    }
  } else if (office === 'gov' && winner) {
    if ((units || []).length === 1) {
      const u = units[0];
      parts.push(
        `In the ${year} ${u.state} governorship race, ${u.winnerName || winner.party} (${u.winnerParty || winner.party}) won`
        + (u.marginPct != null ? ` by ${u.marginPct} pts` : '')
        + (u.runnerParty ? ` over ${u.runnerParty}` : '')
        + '.'
      );
      if (u.previousWinner && compare) {
        parts.push(
          u.flipped
            ? `The seat flipped from ${u.previousWinner} relative to the prior archive cycle.`
            : `${u.winnerParty || winner.party} retained the seat versus the prior archive cycle.`
        );
      }
      if (u.turnoutPct != null) parts.push(`Turnout proxy ≈ ${u.turnoutPct}% (candidate votes ÷ PVC register).`);
    } else {
      parts.push(
        `Across ${year} governorship archives, ${winner.party} won ${winner.wins} of ${winner.totalUnits} races`
        + (winner.voteShare != null ? ` and about ${winner.voteShare}% of summed candidate votes where totals exist.` : '.')
      );
      if (flips != null && compare) parts.push(`${flips} states flipped party between consecutive cycles overlapping ${compare}→${year}.`);
    }
  } else if ((office === 'sen' || office === 'reps') && winner) {
    const label = office === 'sen' ? 'Senate' : 'House';
    parts.push(
      `In the ${year} ${label} archive, ${winner.party} holds ${winner.wins} of ${winner.totalUnits} logged seats`
      + (winner.seatShare != null ? ` (${winner.seatShare}% seat share).` : '.')
    );
    if (flips != null && compare) parts.push(`${flips} seats changed party vs ${compare} (matched by state/district where possible).`);
    parts.push('Many legislative files are winner-only scaffolds without contested vote totals — margins and vote share are limited.');
  } else {
    parts.push('Insufficient archive coverage to draft a result narrative for this filter.');
  }
  return parts.join(' ');
}

function buildDrivers({ office, year, compare, winner, units, zoneSwing, turnout, flips, retention }) {
  const drivers = [];
  if (!winner) {
    return [{ text: 'Not enough data to identify result drivers for this selection.', value: null, kind: 'note' }];
  }

  if (zoneSwing && zoneSwing.length) {
    const top = zoneSwing[0];
    drivers.push({
      kind: 'geography',
      icon: 'public',
      title: 'Regional concentration',
      text: `${winner.party} ran strongest in ${top.region} (${top.wins} wins`
        + (top.voteShare != null ? `, ${top.voteShare}% vote share` : '')
        + ').',
      value: top.wins,
      unit: 'wins',
    });
    const weak = zoneSwing[zoneSwing.length - 1];
    if (weak && weak.region !== top.region) {
      drivers.push({
        kind: 'geography',
        icon: 'south',
        title: 'Softest region',
        text: `${winner.party} was weakest in ${weak.region}`
          + (weak.voteShare != null ? ` (${weak.voteShare}% vote share)` : ` (${weak.wins} wins)`)
          + '.',
        value: weak.voteShare ?? weak.wins,
        unit: weak.voteShare != null ? 'pts share' : 'wins',
      });
    }
  }

  if (turnout?.change != null) {
    drivers.push({
      kind: 'turnout',
      icon: 'how_to_vote',
      title: 'Turnout shift',
      text: `National turnout moved ${turnout.change > 0 ? '+' : ''}${turnout.change} pts from ${compare} (${turnout.previous}% → ${turnout.current}%).`,
      value: turnout.change,
      unit: 'pts',
      available: true,
    });
  } else {
    drivers.push({
      kind: 'turnout',
      icon: 'how_to_vote',
      title: 'Turnout',
      text: turnout?.current != null
        ? `National turnout ${turnout.current}% in ${year}; prior-cycle comparison unavailable for this office.`
        : 'Unit-level turnout (registered / rejected / abstentions) is not in most local archives — national rates shown when known.',
      value: turnout?.current ?? null,
      unit: turnout?.current != null ? '%' : null,
      available: turnout?.current != null,
    });
  }

  const swingRows = (units || [])
    .filter((u) => u.swingWinnerPts != null)
    .slice()
    .sort((a, b) => Math.abs(b.swingWinnerPts) - Math.abs(a.swingWinnerPts));
  if (swingRows.length) {
    const big = swingRows[0];
    drivers.push({
      kind: 'swing',
      icon: 'swap_vert',
      title: 'Largest geographic swing',
      text: `${big.state}: ${big.swingWinnerPts > 0 ? '+' : ''}${big.swingWinnerPts} pts for ${winner.party} vs ${compare}`
        + (big.flipped ? ' (party flipped).' : '.'),
      value: big.swingWinnerPts,
      unit: 'pts',
      unitId: big.state,
    });
  }

  if (flips != null) {
    drivers.push({
      kind: 'swing',
      icon: 'sync_alt',
      title: 'Party changes',
      text: `${flips} geographic units changed winning party vs ${compare || 'prior cycle'}.`,
      value: flips,
      unit: 'units',
    });
  }

  if (retention && retention.sample) {
    drivers.push({
      kind: 'incumbency',
      icon: 'replay',
      title: 'Incumbent party retention',
      text: retention.note,
      value: retention.rate,
      unit: '%',
    });
  }

  return drivers.slice(0, 5);
}

function zoneBreakdown(units, focusParty) {
  const zones = {};
  Object.keys(GEO_ZONES).forEach((z) => {
    zones[z] = { region: z, wins: 0, units: 0, votes: 0, focusVotes: 0, totalVotes: 0 };
  });
  (units || []).forEach((u) => {
    const z = u.region || zoneOf(u.state);
    if (!zones[z]) zones[z] = { region: z, wins: 0, units: 0, votes: 0, focusVotes: 0, totalVotes: 0 };
    zones[z].units += 1;
    zones[z].totalVotes += u.totalVotes || 0;
    if (u.winnerParty === focusParty) zones[z].wins += 1;
    if (focusParty && u.votes) zones[z].focusVotes += Number(u.votes[focusParty]) || 0;
    else if (focusParty && u.partyShares && u.totalVotes) {
      zones[z].focusVotes += Math.round(((u.partyShares[focusParty] || 0) / 100) * (u.totalVotes || 0));
    }
  });
  return Object.values(zones)
    .filter((z) => z.units > 0)
    .map((z) => ({
      ...z,
      voteShare: z.totalVotes ? round1(pct(z.focusVotes, z.totalVotes)) : null,
      winShare: z.units ? round1(pct(z.wins, z.units)) : 0,
    }))
    .sort((a, b) => (b.voteShare ?? b.wins) - (a.voteShare ?? a.wins));
}

function effectiveNumberOfParties(shares) {
  const probs = (shares || []).map((s) => (Number(s) || 0) / 100).filter((p) => p > 0);
  if (!probs.length) return null;
  const hhi = probs.reduce((a, p) => a + p * p, 0);
  if (!hhi) return null;
  return round2(1 / hhi);
}

function wastedVotesFptp(units) {
  // Approximate: in each unit, all non-winner votes are "wasted" under FPTP.
  let wasted = 0;
  let total = 0;
  let counted = 0;
  (units || []).forEach((u) => {
    if (!u.totalVotes || u.winnerVotes == null) return;
    total += u.totalVotes;
    wasted += Math.max(0, u.totalVotes - u.winnerVotes);
    counted += 1;
  });
  if (!counted || !total) return null;
  return { wasted, total, pct: round1(pct(wasted, total)), units: counted };
}

function buildAnomalies({ office, year, units, compare }) {
  const flags = [];
  const withMargin = (units || []).filter((u) => u.marginPct != null);
  if (withMargin.length >= 5) {
    const margins = withMargin.map((u) => u.marginPct);
    const mean = margins.reduce((a, b) => a + b, 0) / margins.length;
    const variance = margins.reduce((a, m) => a + (m - mean) ** 2, 0) / margins.length;
    const sd = Math.sqrt(variance) || 1;
    withMargin.forEach((u) => {
      if (u.marginPct > mean + 2.5 * sd && u.marginPct >= 70) {
        flags.push({
          id: `landslide-${u.state || u.district}`,
          kind: 'large_margin',
          severity: 'info',
          unit: u.state || u.district,
          region: u.region,
          why: `Victory margin ${u.marginPct}% is an outlier vs peers (mean ${round1(mean)}%).`,
          detail: `${u.winnerParty} vs ${u.runnerParty || '—'} in ${year}`,
        });
      }
    });
  }

  (units || []).forEach((u) => {
    if (u.swingWinnerPts != null && Math.abs(u.swingWinnerPts) >= 25) {
      flags.push({
        id: `swing-${u.state || u.district}`,
        kind: 'large_swing',
        severity: 'review',
        unit: u.state || u.district,
        region: u.region,
        why: `Party swing of ${u.swingWinnerPts > 0 ? '+' : ''}${u.swingWinnerPts} pts vs ${compare} exceeds the 25-pt review threshold.`,
        detail: `${u.previousWinner || '—'} → ${u.winnerParty}${u.flipped ? ' (flip)' : ''}`,
      });
    }
  });

  const withTurnout = (units || []).filter((u) => u.turnoutPct != null);
  if (withTurnout.length >= 8) {
    const vals = withTurnout.map((u) => u.turnoutPct);
    const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
    const sd = Math.sqrt(vals.reduce((a, v) => a + (v - mean) ** 2, 0) / vals.length) || 1;
    withTurnout.forEach((u) => {
      if (Math.abs(u.turnoutPct - mean) >= 2 * sd) {
        flags.push({
          id: `turnout-${u.state}`,
          kind: 'turnout_outlier',
          severity: 'info',
          unit: u.state,
          region: u.region,
          why: `Approx. turnout ${u.turnoutPct}% is ${u.turnoutPct > mean ? 'high' : 'low'} vs peer mean ${round1(mean)}% (2023 register proxy).`,
          detail: 'Not official state turnout — valid votes ÷ 2023 registered voters.',
        });
      }
    });
  }

  // Neighbor inconsistency: flipped unit whose region mostly held the previous party
  const byRegion = {};
  (units || []).forEach((u) => {
    const r = u.region || 'Other';
    if (!byRegion[r]) byRegion[r] = [];
    byRegion[r].push(u);
  });
  Object.entries(byRegion).forEach(([region, list]) => {
    if (list.length < 4) return;
    list.filter((u) => u.flipped).forEach((u) => {
      const samePrev = list.filter((x) => x.state !== u.state && x.winnerParty === u.previousWinner).length;
      if (samePrev >= Math.ceil((list.length - 1) * 0.6)) {
        flags.push({
          id: `neighbor-${u.state || u.district}`,
          kind: 'neighbor_contrast',
          severity: 'info',
          unit: u.state || u.district,
          region,
          why: `${u.state || u.district} flipped away from ${u.previousWinner} while most of ${region} still shows that party.`,
          detail: `Now ${u.winnerParty}. Heuristic only — not a fraud indicator.`,
        });
      }
    });
  });

  // Missing vote totals for legislative
  if (office === 'sen' || office === 'reps') {
    const missing = (units || []).filter((u) => !u.votesAvailable).length;
    if (missing) {
      flags.push({
        id: 'missing-votes',
        kind: 'missing_reports',
        severity: 'data',
        unit: 'archive',
        region: null,
        why: `${missing} seats lack contested vote totals in the local archive (winner-only scaffolds).`,
        detail: 'Margins, wasted votes, and ENP from ballots cannot be computed for those seats.',
      });
    }
  }

  flags.push({
    id: 'framing',
    kind: 'note',
    severity: 'note',
    unit: null,
    region: null,
    why: 'Flags are data-quality / investigation heuristics — not allegations of malpractice.',
    detail: 'Each item explains the rule that fired so analysts can inspect the source unit.',
  });

  return flags.slice(0, 24);
}

function matchSeatFlips(curUnits, prevUnits) {
  const prevMap = {};
  (prevUnits || []).forEach((u) => {
    const key = `${u.state}|${(u.district || '').toLowerCase()}`;
    prevMap[key] = u;
  });
  let flips = 0;
  const enriched = (curUnits || []).map((u) => {
    const key = `${u.state}|${(u.district || '').toLowerCase()}`;
    const p = prevMap[key];
    const flipped = !!(p && p.winnerParty !== u.winnerParty);
    if (flipped) flips += 1;
    return {
      ...u,
      previousWinner: p?.winnerParty || null,
      flipped,
      swingWinnerPts: null,
    };
  });
  return { flips, units: enriched };
}

function assemblePayload(base, filters) {
  const resolved = resolveFilters(base, filters);
  const { office, year, compare, party, region, state, series } = resolved;
  const assumptions = {
    momentumWeight: clamp01(Number(filters.momentumWeight ?? 0.65)),
    retentionWeight: clamp01(Number(filters.retentionWeight ?? 0.25)),
    competitiveCutoff: Number(filters.competitiveCutoff ?? 10),
  };

  let section;
  if (office === 'pres') section = buildPresSections(base, resolved);
  else if (office === 'gov') section = buildGovSections(base, resolved);
  else section = buildSeatSections(base, resolved);

  const prediction = buildPrediction(base, assumptions);
  // Dropdown lists states with data for the selected year; keep full catalog when year is empty.
  const yearStates = office === 'gov'
    ? statesForGovYear(base, year)
    : (office === 'pres' && base.pres?.lgaByYear?.[year]
      ? availablePresLgaStates(year)
      : []);
  const govStates = office === 'gov'
    ? (yearStates.length ? yearStates : base.states)
    : (office === 'pres' && yearStates.length ? yearStates : base.states);

  return {
    ok: true,
    generatedAt: new Date().toISOString(),
    partyColors: PARTY_COLORS,
    offices: [
      { id: 'pres', label: 'Presidential', years: base.pres.years },
      { id: 'gov', label: 'Governorship', years: base.gov.years },
      { id: 'sen', label: 'Senate', years: base.sen.years },
      { id: 'reps', label: 'House of Reps', years: base.reps.years },
    ],
    states: govStates.length ? govStates : base.states,
    allStates: (office === 'gov' || office === 'pres') ? (base.states || []) : undefined,
    regions: Object.keys(GEO_ZONES),
    filters: { office, year, compare, party, region, state },
    availability: section.availability,
    summary: section.summary,
    drivers: section.drivers,
    performance: section.performance,
    geographic: section.geographic,
    turnout: section.turnout,
    competitiveness: section.competitiveness,
    history: section.history,
    demographics: section.demographics,
    anomalies: section.anomalies,
    // Legacy charts (still useful for history / outlook)
    charts: {
      partyWins: {
        pres: buildChartSeries(base.pres, 'wins'),
        gov: buildChartSeries(base.gov, 'wins'),
        sen: buildChartSeries(base.sen, 'wins'),
        reps: buildChartSeries(base.reps, 'wins'),
      },
      seatShare: {
        gov: buildChartSeries(base.gov, 'seatShare'),
        sen: buildChartSeries(base.sen, 'seatShare'),
        reps: buildChartSeries(base.reps, 'seatShare'),
        pres: buildChartSeries(base.pres, 'seatShare'),
      },
      voteShare: {
        pres: buildChartSeries(base.pres, 'voteShare'),
      },
      voteVolume: buildVoteVolume(base.pres),
      govMargins: { years: base.gov.years, items: base.gov.margins },
    },
    metrics: section.summary?.kpis || [],
    battlegrounds: (section.competitiveness?.closest || []).slice(0, 8).map((m) => ({
      name: m.label || `${m.state}${m.district ? ` · ${m.district}` : ''} · ${m.year || year}`,
      swing: m.marginPct != null ? `${m.marginPct.toFixed(1)} pts` : '—',
      margin: `${m.party || m.winnerParty || '—'} hold`,
      color: partyColor(m.party || m.winnerParty),
    })),
    prediction,
    sources: [
      {
        office: 'pres',
        files: [
          ...base.pres.years.map((y) => `presidential-${y}-states.json`),
          ...(base.pres.lgaYears || []).map((y) => `presidential-${y}-lga.json`),
        ],
      },
      { office: 'gov', count: base.gov.margins.length, years: base.gov.years },
      { office: 'sen', years: base.sen.years, seatsLatest: base.sen.byYear[base.sen.years[base.sen.years.length - 1]]?.seats || 0 },
      { office: 'reps', years: base.reps.years, seatsLatest: base.reps.byYear[base.reps.years[base.reps.years.length - 1]]?.seats || 0 },
    ],
  };
}

function emptyDemographics() {
  return {
    available: false,
    kind: 'unavailable',
    title: 'Demographic & issue analysis',
    message: 'No reliable survey or census-linked election microdata is bundled in this repository.',
    distinction: 'Official result archives (INEC returns) are separate from opinion surveys. This panel stays empty rather than inventing demographics.',
  };
}

function buildPresSections(base, { year, compare, party, region, state }) {
  const cur = base.pres.byYear[year];
  const prev = compare ? base.pres.byYear[compare] : null;
  const ranked = partyRankList(cur?.parties);
  const winnerRow = ranked[0] || null;
  const runnerRow = ranked[1] || null;
  const focusParty = party !== 'all' ? party : (winnerRow?.party || 'APC');
  const stateFilter = state && state !== 'all' ? canonicalState(state) : 'all';
  const hasLgaPack = !!(base.pres.lgaByYear && base.pres.lgaByYear[year]);
  const drillLga = stateFilter !== 'all' && hasLgaPack;

  let units = buildPresUnits(cur, prev, region);
  if (stateFilter !== 'all') {
    units = units.filter((u) => inState(u.state, stateFilter));
  }
  if (drillLga) {
    units = buildPresLgaUnits(base.pres.lgaByYear[year], stateFilter);
  }

  const flips = units.filter((u) => u.flipped).length;
  const swingRows = units
    .filter((u) => u.swings?.[focusParty] != null)
    .map((u) => ({ state: u.state, party: focusParty, swing: u.swings[focusParty], flipped: u.flipped }))
    .sort((a, b) => Math.abs(b.swing) - Math.abs(a.swing));
  const largestSwing = swingRows[0] || null;
  const zoneSwing = drillLga
    ? []
    : zoneBreakdown(units, focusParty);

  const nat = cur?.nationalTurnout;
  const prevNat = prev?.nationalTurnout;
  const turnout = {
    current: nat?.turnoutPct ?? null,
    previous: prevNat?.turnoutPct ?? null,
    change: (nat && prevNat) ? round1(nat.turnoutPct - prevNat.turnoutPct) : null,
    registered: nat?.registered ?? null,
    note: 'National INEC-declared turnout. State figures below use valid votes ÷ 2023 register (proxy) for 2023 only.',
    byUnit: units
      .filter((u) => u.turnoutPct != null)
      .map((u) => ({
        state: u.state,
        region: u.region,
        turnoutPct: u.turnoutPct,
        previous: u.previousTurnout,
        change: u.turnoutChange,
        focusShare: u.partyShares?.[focusParty] ?? null,
        swing: u.swings?.[focusParty] ?? null,
      }))
      .sort((a, b) => (b.turnoutPct || 0) - (a.turnoutPct || 0)),
    fields: {
      registered: true,
      valid: true,
      rejected: false,
      abstentions: false,
    },
  };

  const winner = winnerRow ? {
    party: winnerRow.party,
    name: Object.values(cur?.units || {}).find((u) => u.winnerParty === winnerRow.party)?.winnerName || null,
    voteShare: round1(winnerRow.voteShare),
    wins: winnerRow.wins,
    totalUnits: cur?.stateWins || units.length,
    votes: winnerRow.votes,
    marginPts: runnerRow ? round1(winnerRow.voteShare - runnerRow.voteShare) : null,
    seatShare: round1(winnerRow.seatShare),
  } : null;

  const runner = runnerRow ? {
    party: runnerRow.party,
    voteShare: round1(runnerRow.voteShare),
    wins: runnerRow.wins,
  } : null;

  const kpis = [
    {
      icon: 'emoji_events',
      label: 'Winner',
      value: winner ? winner.party : '—',
      unit: winner?.marginPts != null ? `+${winner.marginPts} pts` : '',
      color: winner ? partyColor(winner.party) : 'var(--mute)',
      caption: winner?.name || '',
    },
    {
      icon: 'map',
      label: 'State wins',
      value: winner ? String(winner.wins) : '—',
      unit: winner ? `of ${winner.totalUnits}` : '',
      color: 'var(--primary)',
    },
    {
      icon: 'pie_chart',
      label: 'National vote share',
      value: winner ? `${winner.voteShare}` : '—',
      unit: winner ? '%' : '',
      color: 'var(--good)',
    },
    {
      icon: 'how_to_vote',
      label: 'Turnout',
      value: turnout.current != null ? String(turnout.current) : '—',
      unit: turnout.change != null ? `${turnout.change > 0 ? '+' : ''}${turnout.change} vs ${compare}` : (turnout.current != null ? '%' : ''),
      color: 'var(--up)',
    },
    {
      icon: 'sync_alt',
      label: 'States changed party',
      value: compare ? String(flips) : '—',
      unit: compare ? `vs ${compare}` : '',
      color: 'var(--live)',
    },
    {
      icon: 'swap_vert',
      label: 'Largest swing',
      value: largestSwing ? `${largestSwing.swing > 0 ? '+' : ''}${largestSwing.swing}` : '—',
      unit: largestSwing ? `pts · ${largestSwing.state}` : '',
      color: 'var(--primary)',
    },
  ];

  const narrative = buildNarrative({
    office: 'pres', year, compare, winner, runner, units, flips, largestSwing, turnout,
  });
  const drivers = buildDrivers({
    office: 'pres', year, compare, winner, units, zoneSwing, turnout, flips,
    retention: null,
  });

  const prevParties = partyRankList(prev?.parties);
  const performance = {
    voteShare: ranked.map((p) => {
      const was = prevParties.find((x) => x.party === p.party);
      return {
        party: p.party,
        color: p.color,
        currentShare: round1(p.voteShare),
        previousShare: was ? round1(was.voteShare) : null,
        deltaShare: was ? round1(p.voteShare - was.voteShare) : null,
        currentVotes: p.votes,
        previousVotes: was?.votes ?? null,
        deltaVotes: was ? p.votes - was.votes : null,
        seatShare: round1(p.seatShare),
        wins: p.wins,
      };
    }),
    seatVsVote: ranked.map((p) => ({
      party: p.party,
      color: p.color,
      voteShare: round1(p.voteShare),
      seatShare: round1(p.seatShare),
    })),
    strongest: units.slice().sort((a, b) => (b.partyShares?.[focusParty] || 0) - (a.partyShares?.[focusParty] || 0)).slice(0, 8)
      .map((u) => ({ state: u.state, region: u.region, share: u.partyShares?.[focusParty] || 0, party: focusParty })),
    weakest: units.slice().sort((a, b) => (a.partyShares?.[focusParty] || 0) - (b.partyShares?.[focusParty] || 0)).slice(0, 8)
      .map((u) => ({ state: u.state, region: u.region, share: u.partyShares?.[focusParty] || 0, party: focusParty })),
    incumbent: { available: false, note: 'Presidential incumbent retention needs a declared incumbent party mapping not stored in archives.' },
    focusParty,
  };

  const geographic = {
    mode: drillLga ? 'lga' : 'state',
    mapHint: drillLga
      ? `${stateFilter} presidential LGA tallies (${year}); choropleth also on Live Results / Map when a state is selected.`
      : (hasLgaPack
        ? 'Select a state to drill presidential LGA results (Stears + INEC). State rows below; Leaflet choropleths on Map / Live Results.'
        : 'Use Live Results / Map for Leaflet choropleths; Analysis lists swing-ready state rows. Presidential LGA unavailable for this year on Stears.'),
    focusParty,
    regions: zoneSwing,
    units,
    strongholds: units.filter((u) => (u.marginPct ?? 0) >= 20 && u.winnerParty === focusParty).slice(0, 10),
    competitive: units.filter((u) => u.marginPct != null && u.marginPct < 10).sort((a, b) => a.marginPct - b.marginPct).slice(0, 12),
    gained: units.filter((u) => u.flipped && u.winnerParty === focusParty),
    lost: units.filter((u) => u.flipped && u.previousWinner === focusParty),
    selected: stateFilter !== 'all' ? stateFilter : null,
    hasLga: hasLgaPack,
  };

  const margins = units.filter((u) => u.marginPct != null).map((u) => u.marginPct);
  const avgMargin = margins.length ? round1(margins.reduce((a, b) => a + b, 0) / margins.length) : null;
  const competitiveness = {
    available: margins.length > 0,
    counts: {
      under1: margins.filter((m) => m < 1).length,
      under5: margins.filter((m) => m < 5).length,
      under10: margins.filter((m) => m < 10).length,
      safe20: margins.filter((m) => m >= 20).length,
      total: margins.length,
    },
    averageMargin: avgMargin,
    enp: effectiveNumberOfParties(ranked.map((p) => p.voteShare)),
    wastedVotes: wastedVotesFptp(units),
    distribution: margins.slice().sort((a, b) => a - b),
    closest: units.filter((u) => u.marginPct != null).sort((a, b) => a.marginPct - b.marginPct).slice(0, 10).map((u) => ({
      label: u.state,
      state: u.state,
      year,
      party: u.winnerParty,
      winnerParty: u.winnerParty,
      marginPct: u.marginPct,
    })),
  };

  const historyYears = base.pres.years;
  const history = {
    years: historyYears,
    voteShareTrend: historyTrendFromSeries(base.pres, 'voteShare'),
    seatShareTrend: historyTrendFromSeries(base.pres, 'seatShare'),
    turnoutTrend: historyYears.map((y) => ({
      year: y,
      turnoutPct: base.pres.byYear[y]?.nationalTurnout?.turnoutPct ?? null,
    })),
    compareSideBySide: {
      current: { year, parties: ranked.slice(0, 6) },
      previous: { year: compare, parties: prevParties.slice(0, 6) },
    },
    realignmentNote: flips
      ? `${flips} states realigned party between ${compare} and ${year}.`
      : 'Limited realignment detectable for this pair.',
  };

  return {
    availability: {
      voteShare: true,
      turnoutNational: true,
      turnoutByState: year === '2023',
      rejectedBallots: false,
      demographics: false,
      map: false,
      legislativeVotes: true,
    },
    summary: { kpis, narrative, winner, runner, year, compare },
    drivers,
    performance,
    geographic,
    turnout,
    competitiveness,
    history,
    demographics: emptyDemographics(),
    anomalies: buildAnomalies({ office: 'pres', year, units, compare }),
  };
}

function buildGovSections(base, { year, compare, party, region, state }) {
  const cur = base.gov.byYear[year];
  const stateFilter = state && state !== 'all' ? state : 'all';
  let races = (cur?.units || []).filter((r) => inRegion(r.state, region) && inState(r.state, stateFilter));

  // When scoped to one/few races, recompute party stats from the filtered set.
  const filteredStats = (stateFilter !== 'all' || (region && region !== 'all'))
    ? partyStatsFromRaces(races)
    : null;
  const ranked = filteredStats
    ? filteredStats.ranked
    : partyRankList(cur?.parties);
  const winnerRow = ranked[0] || null;
  const focusParty = party !== 'all' ? party : (winnerRow?.party || 'APC');
  const registeredByState = base.registeredByState || {};
  const scopedTotalVotes = filteredStats
    ? filteredStats.totalVotes
    : (cur?.totalVotes || 0);

  const relevantPairs = base.gov.retentionPairs
    .filter((p) => String(p.toYear) === String(year))
    .filter((p) => inRegion(p.state, region) && inState(p.state, stateFilter));
  const flips = relevantPairs.filter((p) => !p.retained).length;
  const retained = relevantPairs.filter((p) => p.retained).length;
  const sample = relevantPairs.length;

  if (!races.length) {
    const emptyNote = stateFilter !== 'all'
      ? `No governorship archive for ${stateFilter} in ${year}. Choose All states or another year.`
      : (region && region !== 'all'
        ? `No governorship races in ${region} for ${year}.`
        : `No governorship races archived for ${year}.`);
    const emptyKpis = [
      { icon: 'emoji_events', label: 'Leading party', value: '—', unit: '', color: 'var(--mute)' },
      { icon: 'map', label: 'Races in view', value: '0', unit: year, color: 'var(--mute)' },
      { icon: 'pie_chart', label: 'Vote share (summed)', value: '—', unit: '', color: 'var(--mute)' },
      { icon: 'how_to_vote', label: 'Turnout (proxy)', value: '—', unit: 'not in archive', color: 'var(--mute)' },
      { icon: 'sync_alt', label: 'Party flips', value: '—', unit: '', color: 'var(--mute)' },
      { icon: 'replay', label: 'Retention rate', value: '—', unit: '', color: 'var(--mute)' },
    ];
    return {
      availability: {
        voteShare: false,
        turnoutNational: false,
        turnoutByState: false,
        rejectedBallots: false,
        demographics: false,
        map: false,
        legislativeVotes: false,
      },
      summary: { kpis: emptyKpis, narrative: emptyNote, winner: null, runner: null, year, compare },
      drivers: [{ text: emptyNote, value: null, kind: 'note', icon: 'info', title: 'No races' }],
      performance: {
        voteShare: [],
        seatVsVote: [],
        strongest: [],
        weakest: [],
        incumbent: { available: false, rate: null, sample: 0, note: emptyNote },
        focusParty,
      },
      geographic: {
        mode: 'state',
        mapHint: emptyNote,
        focusParty,
        regions: [],
        units: [],
        strongholds: [],
        competitive: [],
        gained: [],
        lost: [],
        selected: stateFilter !== 'all' ? stateFilter : null,
      },
      turnout: {
        current: null,
        previous: null,
        change: null,
        registered: null,
        note: emptyNote,
        byUnit: [],
        fields: { registered: false, valid: false, rejected: false, abstentions: false },
      },
      competitiveness: {
        available: false,
        counts: { under1: 0, under5: 0, under10: 0, safe20: 0, total: 0 },
        averageMargin: null,
        enp: null,
        wastedVotes: null,
        distribution: [],
        closest: [],
        note: emptyNote,
      },
      history: {
        years: base.gov.years,
        voteShareTrend: historyTrendFromSeries(base.gov, 'voteShare'),
        seatShareTrend: historyTrendFromSeries(base.gov, 'seatShare'),
        turnoutTrend: base.gov.years.map((y) => ({ year: y, turnoutPct: null })),
        compareSideBySide: {
          current: { year, parties: [] },
          previous: { year: compare, parties: [] },
        },
        realignmentNote: emptyNote,
      },
      demographics: emptyDemographics(),
      anomalies: [{
        kind: 'coverage',
        unit: stateFilter !== 'all' ? stateFilter : year,
        why: emptyNote,
        detail: 'Adjust State or Year filters to see governorship analysis.',
      }],
    };
  }

  const units = races.map((r) => {
    const prevKey = relevantPairs.find((p) => p.state === r.state);
    const prevRace = prevKey ? base.gov.byStateYear[`${r.state}|${prevKey.fromYear}`] : null;
    const flipped = !!(prevKey && !prevKey.retained);
    let swingWinnerPts = null;
    if (prevRace && prevRace.totalVotes && r.totalVotes) {
      const nowShare = pct(r.winnerVotes, r.totalVotes);
      const thenShare = pct(
        (prevRace.candidates || []).find((c) => c.party === r.winnerParty)?.votes || 0,
        prevRace.totalVotes
      );
      swingWinnerPts = round2(nowShare - thenShare);
    }
    const registered = registeredByState[r.state] || 0;
    const prevRegistered = registered;
    const turnoutPct = (registered && r.totalVotes)
      ? round1(pct(r.totalVotes, registered))
      : null;
    const previousTurnout = (prevRace && prevRegistered && prevRace.totalVotes)
      ? round1(pct(prevRace.totalVotes, prevRegistered))
      : null;
    const swings = {};
    const focusParties = new Set([
      ...Object.keys(
        Object.fromEntries((r.candidates || []).map((c) => [c.party, c.votes]))
      ),
      ...Object.keys(
        Object.fromEntries((prevRace?.candidates || []).map((c) => [c.party, c.votes]))
      ),
    ]);
    focusParties.forEach((p) => {
      const now = r.totalVotes
        ? pct((r.candidates || []).find((c) => c.party === p)?.votes || 0, r.totalVotes)
        : 0;
      const then = prevRace?.totalVotes
        ? pct((prevRace.candidates || []).find((c) => c.party === p)?.votes || 0, prevRace.totalVotes)
        : 0;
      swings[p] = round2(now - then);
    });
    return {
      state: r.state,
      region: r.region,
      winnerParty: r.winnerParty,
      winnerName: r.winnerName,
      marginPct: r.marginPct,
      winnerVotes: r.winnerVotes,
      runnerParty: r.runnerParty,
      runnerVotes: r.runnerVotes,
      totalVotes: r.totalVotes,
      previousWinner: prevKey?.fromParty || null,
      flipped,
      swingWinnerPts,
      swings,
      turnoutPct,
      previousTurnout,
      turnoutChange: (turnoutPct != null && previousTurnout != null)
        ? round1(turnoutPct - previousTurnout)
        : null,
      votes: Object.fromEntries((r.candidates || []).map((c) => [c.party, c.votes])),
      partyShares: Object.fromEntries(
        (r.candidates || []).map((c) => [c.party, round2(pct(c.votes, r.totalVotes || 1))])
      ),
      estimated: r.estimated,
    };
  });

  const zoneSwing = zoneBreakdown(units, focusParty);
  const winner = winnerRow ? {
    party: winnerRow.party,
    name: units.length === 1 ? (units[0].winnerName || null) : null,
    voteShare: scopedTotalVotes ? round1(winnerRow.voteShare) : null,
    wins: races.filter((r) => r.winnerParty === winnerRow.party).length,
    totalUnits: races.length,
    marginPts: units.length === 1 ? units[0].marginPct : null,
    seatShare: round1(winnerRow.seatShare),
  } : null;

  const turnoutUnits = units
    .filter((u) => u.turnoutPct != null)
    .map((u) => ({
      state: u.state,
      region: u.region,
      turnoutPct: u.turnoutPct,
      previous: u.previousTurnout,
      change: u.turnoutChange,
      focusShare: u.partyShares?.[focusParty] ?? null,
      swing: u.swings?.[focusParty] ?? u.swingWinnerPts ?? null,
    }))
    .sort((a, b) => (b.turnoutPct || 0) - (a.turnoutPct || 0));
  const turnoutAvg = turnoutUnits.length
    ? round1(turnoutUnits.reduce((a, u) => a + u.turnoutPct, 0) / turnoutUnits.length)
    : null;
  const turnout = {
    current: turnoutAvg,
    previous: null,
    change: null,
    registered: null,
    note: turnoutUnits.length
      ? (stateFilter !== 'all'
        ? `Turnout proxy for ${stateFilter} = summed candidate votes ÷ PVC register (approximate).`
        : 'State turnout proxies = summed candidate votes ÷ PVC register (same register vintage for all years — approximate).')
      : 'Governorship archives lack registered / rejected / abstention fields; no vote totals to build proxies.',
    byUnit: turnoutUnits,
    fields: { registered: turnoutUnits.length > 0, valid: true, rejected: false, abstentions: false },
  };

  const retention = {
    rate: sample ? round1(pct(retained, sample)) : null,
    sample,
    retained,
    note: sample
      ? (stateFilter !== 'all'
        ? `${retained ? 'Retained' : 'Flipped'} party into ${year} for ${stateFilter} (vs prior archive cycle).`
        : `${retained} of ${sample} states kept the same party into ${year} (consecutive archive pairs).`)
      : (stateFilter !== 'all'
        ? `No prior governorship archive pair for ${stateFilter} ending in ${year}.`
        : 'No consecutive governorship pairs for this year filter.'),
  };

  const kpis = [
    {
      icon: 'emoji_events',
      label: units.length === 1 ? 'Winner' : 'Leading party',
      value: winner ? winner.party : '—',
      unit: winner
        ? (units.length === 1
          ? (units[0].winnerName || `${winner.wins} win`)
          : `${winner.wins} wins`)
        : '',
      color: winner ? partyColor(winner.party) : 'var(--mute)',
    },
    {
      icon: 'map',
      label: 'Races in view',
      value: String(races.length || '—'),
      unit: stateFilter !== 'all' ? stateFilter : year,
      color: 'var(--primary)',
    },
    {
      icon: 'pie_chart',
      label: 'Vote share (summed)',
      value: winner?.voteShare != null ? String(winner.voteShare) : '—',
      unit: winner?.voteShare != null ? '%' : '',
      color: 'var(--good)',
      caption: 'Where candidate totals exist',
    },
    {
      icon: 'how_to_vote',
      label: 'Turnout (proxy)',
      value: turnout.current != null ? String(turnout.current) : '—',
      unit: turnout.current != null ? (units.length === 1 ? '%' : '% avg') : 'not in archive',
      color: turnout.current != null ? 'var(--up)' : 'var(--mute)',
      caption: turnoutUnits.length ? `${turnoutUnits.length} states with vote totals` : '',
    },
    {
      icon: 'sync_alt',
      label: 'Party flips',
      value: sample ? String(flips) : '—',
      unit: sample ? `of ${sample} pairs` : '',
      color: 'var(--live)',
    },
    {
      icon: 'replay',
      label: 'Retention rate',
      value: retention.rate != null ? String(retention.rate) : '—',
      unit: retention.rate != null ? '%' : '',
      color: 'var(--up)',
    },
  ];

  const narrative = buildNarrative({
    office: 'gov', year, compare, winner, runner: ranked[1], units, flips, largestSwing: null, turnout,
  });
  const drivers = buildDrivers({
    office: 'gov', year, compare, winner, units, zoneSwing, turnout, flips, retention,
  });

  const prevRaces = (base.gov.byYear[compare]?.units || [])
    .filter((r) => inRegion(r.state, region) && inState(r.state, stateFilter));
  const prevStats = filteredStats
    ? partyStatsFromRaces(prevRaces)
    : null;
  const prevParties = prevStats
    ? prevStats.ranked
    : partyRankList(base.gov.byYear[compare]?.parties);
  const prevTotalVotes = prevStats
    ? prevStats.totalVotes
    : (base.gov.byYear[compare]?.totalVotes || 0);
  const margins = units.filter((u) => u.marginPct != null).map((u) => u.marginPct);
  const performance = {
    voteShare: ranked.map((p) => {
      const was = prevParties.find((x) => x.party === p.party);
      return {
        party: p.party,
        color: p.color,
        currentShare: scopedTotalVotes ? round1(p.voteShare) : null,
        previousShare: was && prevTotalVotes ? round1(was.voteShare) : null,
        deltaShare: (was && scopedTotalVotes && prevTotalVotes)
          ? round1(p.voteShare - was.voteShare)
          : null,
        currentVotes: p.votes,
        previousVotes: was?.votes ?? null,
        deltaVotes: was ? p.votes - was.votes : null,
        seatShare: round1(p.seatShare),
        wins: p.wins,
      };
    }),
    seatVsVote: ranked.filter((p) => p.votes > 0).map((p) => ({
      party: p.party,
      color: p.color,
      voteShare: round1(p.voteShare),
      seatShare: round1(p.seatShare),
    })),
    strongest: units.slice().sort((a, b) => (b.partyShares?.[focusParty] || 0) - (a.partyShares?.[focusParty] || 0)).slice(0, 8)
      .map((u) => ({ state: u.state, region: u.region, share: u.partyShares?.[focusParty] || 0, party: focusParty })),
    weakest: units.slice().sort((a, b) => (a.partyShares?.[focusParty] || 0) - (b.partyShares?.[focusParty] || 0)).slice(0, 8)
      .map((u) => ({ state: u.state, region: u.region, share: u.partyShares?.[focusParty] || 0, party: focusParty })),
    incumbent: {
      available: sample > 0,
      rate: retention.rate,
      sample,
      note: retention.note,
    },
    focusParty,
  };

  const turnoutTrend = base.gov.years.map((y) => {
    const bucket = base.gov.byYear[y];
    const rows = (bucket?.units || [])
      .filter((r) => inRegion(r.state, region) && inState(r.state, stateFilter))
      .map((r) => {
        const registered = registeredByState[r.state] || 0;
        return (registered && r.totalVotes) ? pct(r.totalVotes, registered) : null;
      })
      .filter((v) => v != null);
    return {
      year: y,
      turnoutPct: rows.length ? round1(rows.reduce((a, v) => a + v, 0) / rows.length) : null,
    };
  });

  let voteShareTrend = historyTrendFromSeries(base.gov, 'voteShare');
  let seatShareTrend = historyTrendFromSeries(base.gov, 'seatShare');
  if (stateFilter !== 'all') {
    voteShareTrend = MAJOR_PARTIES.map((p) => ({
      party: p,
      color: partyColor(p),
      values: base.gov.years.map((y) => {
        const race = base.gov.byStateYear[`${stateFilter}|${y}`];
        if (!race?.totalVotes) return 0;
        const cand = (race.candidates || []).find((c) => c.party === p);
        return round1(pct(cand?.votes || 0, race.totalVotes));
      }),
    }));
    seatShareTrend = MAJOR_PARTIES.map((p) => ({
      party: p,
      color: partyColor(p),
      values: base.gov.years.map((y) => {
        const race = base.gov.byStateYear[`${stateFilter}|${y}`];
        return race && race.winnerParty === p ? 100 : (race ? 0 : 0);
      }),
    }));
  }

  return {
    availability: {
      voteShare: !!scopedTotalVotes,
      turnoutNational: false,
      turnoutByState: turnoutUnits.length > 0,
      rejectedBallots: false,
      demographics: false,
      map: false,
      legislativeVotes: false,
    },
    summary: { kpis, narrative, winner, runner: ranked[1] || null, year, compare },
    drivers,
    performance,
    geographic: {
      mode: 'state',
      mapHint: stateFilter !== 'all'
        ? `${stateFilter} governorship focus; LGA detail remains on Live Results maps.`
        : 'Governorship swing by state; LGA detail remains on Live Results maps.',
      focusParty,
      regions: zoneSwing,
      units,
      strongholds: units.filter((u) => (u.marginPct ?? 0) >= 20 && u.winnerParty === focusParty).slice(0, 10),
      competitive: units.filter((u) => u.marginPct != null && u.marginPct < 10).sort((a, b) => a.marginPct - b.marginPct),
      gained: units.filter((u) => u.flipped && u.winnerParty === focusParty),
      lost: units.filter((u) => u.flipped && u.previousWinner === focusParty),
      selected: stateFilter !== 'all' ? stateFilter : null,
    },
    turnout,
    competitiveness: {
      available: margins.length > 0,
      counts: {
        under1: margins.filter((m) => m < 1).length,
        under5: margins.filter((m) => m < 5).length,
        under10: margins.filter((m) => m < 10).length,
        safe20: margins.filter((m) => m >= 20).length,
        total: margins.length,
      },
      averageMargin: margins.length ? round1(margins.reduce((a, b) => a + b, 0) / margins.length) : null,
      enp: effectiveNumberOfParties(ranked.map((p) => p.seatShare)),
      wastedVotes: wastedVotesFptp(units),
      distribution: margins.slice().sort((a, b) => a - b),
      closest: units.filter((u) => u.marginPct != null).sort((a, b) => a.marginPct - b.marginPct).slice(0, 10).map((u) => ({
        label: u.state,
        state: u.state,
        year,
        party: u.winnerParty,
        winnerParty: u.winnerParty,
        marginPct: u.marginPct,
      })),
    },
    history: {
      years: base.gov.years,
      voteShareTrend,
      seatShareTrend,
      turnoutTrend,
      compareSideBySide: {
        current: { year, parties: ranked.slice(0, 6) },
        previous: {
          year: compare,
          parties: prevParties.slice(0, 6),
        },
      },
      realignmentNote: retention.note,
    },
    demographics: emptyDemographics(),
    anomalies: buildAnomalies({ office: 'gov', year, units, compare }),
  };
}

function buildSeatSections(base, { office, year, compare, party, region }) {
  const series = office === 'sen' ? base.sen : base.reps;
  const cur = series.byYear[year];
  const prev = compare ? series.byYear[compare] : null;
  const ranked = partyRankList(cur?.parties);
  const prevRanked = partyRankList(prev?.parties);
  const winnerRow = ranked[0] || null;
  const focusParty = party !== 'all' ? party : (winnerRow?.party || 'APC');
  const rawUnits = (cur?.units || []).filter((u) => inRegion(u.state, region));
  const { flips, units } = matchSeatFlips(rawUnits, (prev?.units || []).filter((u) => inRegion(u.state, region)));
  const zoneSwing = zoneBreakdown(units, focusParty);
  const yearHasVotes = !!(cur?.totalVotes > 0);
  const prevHasVotes = !!(prev?.totalVotes > 0);
  const winner = winnerRow ? {
    party: winnerRow.party,
    wins: units.filter((u) => u.winnerParty === winnerRow.party).length,
    totalUnits: units.length,
    seatShare: units.length ? round1(pct(units.filter((u) => u.winnerParty === winnerRow.party).length, units.length)) : round1(winnerRow.seatShare),
    voteShare: yearHasVotes ? round1(winnerRow.voteShare) : null,
    marginPts: null,
  } : null;

  const turnout = {
    current: null,
    previous: null,
    change: null,
    note: yearHasVotes
      ? 'Constituency vote totals available from Stears/INEC collations; registered-voter turnout fields are not present.'
      : 'Legislative archives here are mostly winner-only; turnout fields are not present.',
    byUnit: [],
    fields: { registered: false, valid: false, rejected: false, abstentions: false },
  };

  const voteUnits = units.filter((u) => u.votesAvailable && u.marginPct != null);
  const largestSwingUnit = voteUnits.length
    ? voteUnits.slice().sort((a, b) => (b.marginPct || 0) - (a.marginPct || 0))[0]
    : null;

  const kpis = [
    {
      icon: 'emoji_events',
      label: 'Seat leader',
      value: winner ? winner.party : '—',
      unit: winner ? `${winner.wins} seats` : '',
      color: winner ? partyColor(winner.party) : 'var(--mute)',
    },
    {
      icon: 'event_seat',
      label: 'Seats logged',
      value: String(units.length || '—'),
      unit: year,
      color: 'var(--primary)',
    },
    {
      icon: 'pie_chart',
      label: 'Seat share',
      value: winner ? String(winner.seatShare) : '—',
      unit: '%',
      color: 'var(--good)',
    },
    {
      icon: 'how_to_vote',
      label: 'Vote share',
      value: winner?.voteShare != null ? String(winner.voteShare) : '—',
      unit: winner?.voteShare != null ? '% (summed)' : 'winner-only archive',
      color: winner?.voteShare != null ? 'var(--good)' : 'var(--mute)',
    },
    {
      icon: 'sync_alt',
      label: 'Seats changed party',
      value: compare ? String(flips) : '—',
      unit: compare ? `vs ${compare}` : '',
      color: 'var(--live)',
    },
    {
      icon: 'swap_vert',
      label: largestSwingUnit ? 'Widest margin' : 'Largest swing',
      value: largestSwingUnit ? String(round1(largestSwingUnit.marginPct)) : '—',
      unit: largestSwingUnit
        ? `pts · ${largestSwingUnit.state} ${largestSwingUnit.district}`
        : 'needs vote totals',
      color: largestSwingUnit ? 'var(--live)' : 'var(--mute)',
    },
  ];

  const narrative = buildNarrative({
    office, year, compare, winner, runner: ranked[1], units, flips, largestSwing: null, turnout,
  });
  const drivers = buildDrivers({
    office, year, compare, winner, units, zoneSwing, turnout, flips, retention: null,
  });

  const margins = units.filter((u) => u.marginPct != null).map((u) => u.marginPct);
  const prevByParty = Object.fromEntries(prevRanked.map((p) => [p.party, p]));

  return {
    availability: {
      voteShare: yearHasVotes || series.hasVoteTotals,
      turnoutNational: false,
      turnoutByState: false,
      rejectedBallots: false,
      demographics: false,
      map: false,
      legislativeVotes: yearHasVotes || series.hasVoteTotals,
    },
    summary: { kpis, narrative, winner, runner: ranked[1] || null, year, compare },
    drivers,
    performance: {
      voteShare: ranked.map((p) => {
        const was = prevByParty[p.party];
        return {
          party: p.party,
          color: p.color,
          currentShare: yearHasVotes ? round1(p.voteShare) : null,
          previousShare: prevHasVotes && was ? round1(was.voteShare) : null,
          deltaShare: yearHasVotes && prevHasVotes && was
            ? round1(p.voteShare - was.voteShare)
            : null,
          currentVotes: yearHasVotes ? Math.round(p.votes || 0) : null,
          previousVotes: prevHasVotes && was ? Math.round(was.votes || 0) : null,
          deltaVotes: yearHasVotes && prevHasVotes && was
            ? Math.round((p.votes || 0) - (was.votes || 0))
            : null,
          seatShare: round1(p.seatShare),
          wins: p.wins,
        };
      }),
      seatVsVote: yearHasVotes
        ? ranked.filter((p) => p.votes > 0 || p.wins > 0).slice(0, 8).map((p) => ({
          party: p.party,
          color: p.color,
          voteShare: round1(p.voteShare),
          seatShare: round1(p.seatShare),
        }))
        : [],
      strongest: zoneSwing.slice(0, 6).map((z) => ({
        state: z.region,
        region: z.region,
        share: z.winShare,
        party: focusParty,
      })),
      weakest: zoneSwing.slice().reverse().slice(0, 6).map((z) => ({
        state: z.region,
        region: z.region,
        share: z.winShare,
        party: focusParty,
      })),
      incumbent: { available: false, note: 'Incumbent win/loss needs candidate continuity not present in winner scaffolds.' },
      focusParty,
    },
    geographic: {
      mode: 'district',
      mapHint: 'District-level choropleth not wired here; table + region bars available.',
      focusParty,
      regions: zoneSwing,
      units,
      strongholds: units.filter((u) => u.winnerParty === focusParty).slice(0, 12),
      competitive: units.filter((u) => u.marginPct != null && u.marginPct < 10),
      gained: units.filter((u) => u.flipped && u.winnerParty === focusParty),
      lost: units.filter((u) => u.flipped && u.previousWinner === focusParty),
      selected: null,
    },
    turnout,
    competitiveness: {
      available: margins.length > 0,
      counts: {
        under1: margins.filter((m) => m < 1).length,
        under5: margins.filter((m) => m < 5).length,
        under10: margins.filter((m) => m < 10).length,
        safe20: margins.filter((m) => m >= 20).length,
        total: margins.length || units.length,
      },
      averageMargin: margins.length ? round1(margins.reduce((a, b) => a + b, 0) / margins.length) : null,
      enp: effectiveNumberOfParties(
        yearHasVotes
          ? ranked.map((p) => p.voteShare)
          : ranked.map((p) => p.seatShare)
      ),
      wastedVotes: null,
      distribution: margins,
      closest: units.filter((u) => u.marginPct != null).sort((a, b) => a.marginPct - b.marginPct).slice(0, 10).map((u) => ({
        label: `${u.state} · ${u.district}`,
        state: u.state,
        district: u.district,
        year,
        party: u.winnerParty,
        winnerParty: u.winnerParty,
        marginPct: u.marginPct,
      })),
      note: margins.length ? null : 'Margins unavailable — archives are mostly winner-only.',
    },
    history: {
      years: series.years,
      voteShareTrend: series.hasVoteTotals
        ? historyTrendFromSeries(series, 'voteShare')
        : [],
      seatShareTrend: historyTrendFromSeries(series, 'seatShare'),
      turnoutTrend: [],
      compareSideBySide: {
        current: { year, parties: ranked.slice(0, 6) },
        previous: { year: compare, parties: prevRanked.slice(0, 6) },
      },
      realignmentNote: compare
        ? `${flips} matched seats changed party between ${compare} and ${year}.`
        : 'Select a compare year to measure seat realignment.',
    },
    demographics: emptyDemographics(),
    anomalies: buildAnomalies({ office, year, units, compare }),
  };
}

/* ── Outlook scenario (retained for sensitivity exploration) ───────────── */

function aggregateRecentWindow(series, years, windowSize = 4) {
  const recent = (years || []).slice(-windowSize);
  const parties = {};
  let races = 0;
  recent.forEach((year) => {
    const bucket = series.byYear[year];
    if (!bucket) return;
    races += bucket.races || bucket.seats || bucket.stateWins || 0;
    Object.entries(bucket.parties || {}).forEach(([party, row]) => {
      ensureParty(parties, party).wins += row.wins || 0;
      ensureParty(parties, party).votes += row.votes || 0;
    });
  });
  Object.values(parties).forEach((p) => {
    p.seatShare = races ? pct(p.wins, races) : 0;
  });
  return { years: recent, parties, races };
}

function buildPrediction(base, assumptions) {
  const { pres, gov, sen, reps } = base;
  const momentumWeight = assumptions.momentumWeight;
  const retentionWeight = assumptions.retentionWeight;
  const competitiveCutoff = assumptions.competitiveCutoff;

  const retained = gov.retentionPairs.filter((p) => p.retained).length;
  const retentionSample = gov.retentionPairs.length;
  const retentionRate = retentionSample ? retained / retentionSample : 0.55;

  const latestGovYear = gov.years[gov.years.length - 1];
  const latestSenYear = sen.years[sen.years.length - 1];
  const prevSenYear = sen.years[sen.years.length - 2];
  const latestRepsYear = reps.years[reps.years.length - 1];
  const prevRepsYear = reps.years[reps.years.length - 2];
  const latestPresYear = pres.years[pres.years.length - 1];
  const prevPresYear = pres.years[pres.years.length - 2];

  const govRecent = aggregateRecentWindow(gov, gov.years, 4);
  const govPriorYears = gov.years.slice(0, Math.max(0, gov.years.length - 4)).slice(-4);
  const govPrior = aggregateRecentWindow(gov, govPriorYears.length ? govPriorYears : gov.years.slice(0, 4), 4);

  function blendSeatMaps(latestMap, prevMap) {
    const out = {};
    const keys = new Set([...Object.keys(latestMap || {}), ...Object.keys(prevMap || {})]);
    keys.forEach((party) => {
      const latest = latestMap?.[party]?.seatShare ?? 0;
      const prev = prevMap?.[party]?.seatShare ?? latest;
      out[party] = (1 - momentumWeight) * prev + momentumWeight * latest;
    });
    return out;
  }

  function blendSeriesShares(series, latestYear, prevYear) {
    const latestMap = series.byYear[latestYear]?.parties || {};
    const prevMap = series.byYear[prevYear]?.parties || latestMap;
    return blendSeatMaps(latestMap, prevMap);
  }

  const govBlend = blendSeatMaps(govRecent.parties, govPrior.parties);
  const senBlend = blendSeriesShares(sen, latestSenYear, prevSenYear);
  const repsBlend = blendSeriesShares(reps, latestRepsYear, prevRepsYear);
  const presBlend = blendSeriesShares(pres, latestPresYear, prevPresYear);

  function applyRetention(blend, leaderParty) {
    const out = { ...blend };
    if (leaderParty && out[leaderParty] != null) {
      out[leaderParty] = out[leaderParty] * (1 + retentionWeight * retentionRate);
    }
    const total = Object.values(out).reduce((a, v) => a + v, 0) || 1;
    Object.keys(out).forEach((p) => {
      out[p] = (out[p] / total) * 100;
    });
    return out;
  }

  const govLeader = Object.entries(govRecent.parties).sort((a, b) => b[1].wins - a[1].wins)[0]?.[0];
  const senLeader = Object.entries(sen.byYear[latestSenYear]?.parties || {}).sort((a, b) => b[1].wins - a[1].wins)[0]?.[0];
  const repsLeader = Object.entries(reps.byYear[latestRepsYear]?.parties || {}).sort((a, b) => b[1].wins - a[1].wins)[0]?.[0];
  const presLeader = Object.entries(pres.byYear[latestPresYear]?.parties || {}).sort((a, b) => b[1].wins - a[1].wins)[0]?.[0];

  const govOutlook = applyRetention(govBlend, govLeader);
  const senOutlook = applyRetention(senBlend, senLeader);
  const repsOutlook = applyRetention(repsBlend, repsLeader);
  const presOutlook = applyRetention(presBlend, presLeader);

  const recentGovYearSet = new Set(govRecent.years);
  const competitiveGov = gov.margins
    .filter((m) => recentGovYearSet.has(m.year) && m.marginPct < competitiveCutoff)
    .sort((a, b) => a.marginPct - b.marginPct)
    .slice(0, 12);

  const partyMomentum = MAJOR_PARTIES.map((party) => {
    const presDelta =
      (pres.byYear[latestPresYear]?.parties?.[party]?.wins || 0)
      - (pres.byYear[prevPresYear]?.parties?.[party]?.wins || 0);
    const govLatest = govRecent.parties?.[party]?.wins || 0;
    const senShare = sen.byYear[latestSenYear]?.parties?.[party]?.seatShare || 0;
    const score = clamp01(
      (0.35 * (presOutlook[party] || 0) + 0.25 * (govOutlook[party] || 0) + 0.2 * (senOutlook[party] || 0) + 0.2 * (repsOutlook[party] || 0)) / 100
    );
    return {
      party,
      color: partyColor(party),
      presStateWinsDelta: presDelta,
      govWinsLatest: govLatest,
      senSeatShareLatest: round1(senShare),
      outlookScore: round1(score * 100),
      estimatedPresStateShare: round1(presOutlook[party] || 0),
      estimatedGovShare: round1(govOutlook[party] || 0),
      estimatedSenShare: round1(senOutlook[party] || 0),
      estimatedRepsShare: round1(repsOutlook[party] || 0),
    };
  }).sort((a, b) => b.outlookScore - a.outlookScore);

  return {
    label: 'Scenario estimate — not an official forecast',
    horizon: {
      pres: '2027',
      sen: '2027',
      reps: '2027',
      gov: 'Next governorship cycle (staggered by state)',
    },
    assumptions: {
      momentumWeight,
      retentionWeight,
      competitiveCutoff,
      govWindowYears: govRecent.years,
      description:
        'Blend of prior-cycle seat/win share with latest-cycle momentum (governorship uses a rolling multi-year window because races are staggered), plus a soft boost for the current leading party scaled by historical incumbent retention.',
    },
    incumbentRetention: {
      office: 'gov',
      rate: round1(retentionRate * 100),
      sample: retentionSample,
      retained,
      note: retentionSample
        ? `${retained} of ${retentionSample} consecutive state governorship pairs kept the same party.`
        : 'Insufficient consecutive governorship pairs for retention estimate.',
    },
    partyMomentum,
    competitiveWatch: competitiveGov,
    caveats: [
      'Estimates use archived results only (presidential state wins, governorship winners, National Assembly seat winners).',
      'Senatorial / House archives are often winner-only scaffolds without contested vote totals.',
      'Governorship files may include PVC-proportional LGA estimates; margins use candidate totals when present.',
      'Real elections depend on candidates, coalitions, turnout, court outcomes, and events not modeled here.',
      'Toggle assumptions below to explore sensitivity — this is a scenario tool, not a prediction market.',
    ],
  };
}

function clearAnalysisCache() {
  cache = { at: 0, base: null, key: null, payload: null };
}

module.exports = {
  buildAnalysisBundle,
  clearAnalysisCache,
  GEO_ZONES,
  NATIONAL_TURNOUT,
};
