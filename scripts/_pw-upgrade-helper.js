/**
 * Playwright-callable upgrade helpers (also usable via node when shell works).
 * Kept as reference for Phase 2 offline merge logic.
 */
'use strict';

function voteOf(p) {
  const v = Number(p && (p.votes != null ? p.votes : p.voteCount));
  return Number.isFinite(v) && v > 0 ? v : 0;
}

function candidateName(p) {
  return String(p.candidateName || p.name || '').trim() || null;
}

function normDistrict(s) {
  return String(s || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/SENATORIAL\s*(DISTRICT)?/g, '')
    .replace(/FEDERAL\s*CONSTITUENCY/g, '')
    .replace(/CONSTITUENCY/g, '')
    .replace(/&/g, '/')
    .replace(/[^A-Z0-9]/g, '');
}

function matchDistrict(target, stearsDistricts) {
  const want = normDistrict(target);
  if (!want) return null;
  const list = [...stearsDistricts.keys()];
  let hit = list.find((d) => normDistrict(d) === want);
  if (hit) return hit;
  hit = list.find((d) => {
    const n = normDistrict(d);
    return n.includes(want) || want.includes(n);
  });
  if (hit) return hit;
  const tokens = want.match(/[A-Z]{3,}/g) || [];
  if (tokens.length >= 2) {
    hit = list.find((d) => {
      const n = normDistrict(d);
      return tokens.every((t) => n.includes(t));
    });
  }
  return hit || null;
}

function buildSeatFromStears(district, rows) {
  const candidates = rows
    .map((p) => ({
      name: candidateName(p) || p.party,
      party: String(p.party || 'Others').trim() || 'Others',
      votes: voteOf(p) || null,
      outcome: p.won ? 'Won' : voteOf(p) > 0 ? 'Lost' : null,
      _won: !!p.won,
    }))
    .sort((a, b) => (Number(b.votes) || 0) - (Number(a.votes) || 0));

  let winner = candidates.find((c) => c._won) || candidates.find((c) => c.votes > 0) || candidates[0];
  if (!winner && candidates.length) winner = candidates[0];

  const cleaned = candidates.map(({ _won, ...rest }) => {
    if (rest.outcome == null) {
      if (winner && rest.name === winner.name && rest.party === winner.party) rest.outcome = 'Won';
      else if (rest.votes != null) rest.outcome = 'Lost';
    }
    return rest;
  });

  const hasVotes = cleaned.some((c) => Number(c.votes) > 0);
  return {
    district,
    winner: winner ? { name: winner.name, party: winner.party } : null,
    candidates: cleaned,
    hasVotes,
  };
}

function mergeStatePayload(existing, stearsDistMap, metaPatch) {
  const usedStears = new Set();
  const seats = [];
  let seatsWithVotes = 0;
  let matched = 0;
  let unmatchedExisting = 0;

  for (const seat of existing.seats || []) {
    const district = seat.district || seat.constituency;
    const stearsKey = matchDistrict(district, stearsDistMap);
    if (stearsKey) {
      usedStears.add(stearsKey);
      const built = buildSeatFromStears(district, stearsDistMap.get(stearsKey));
      seats.push({
        district,
        winner: built.winner || seat.winner,
        candidates: built.candidates.length ? built.candidates : seat.candidates,
      });
      if (built.hasVotes) seatsWithVotes += 1;
      matched += 1;
    } else {
      unmatchedExisting += 1;
      seats.push(seat);
    }
  }

  for (const [stearsDistrict, rows] of stearsDistMap.entries()) {
    if (usedStears.has(stearsDistrict)) continue;
    const built = buildSeatFromStears(stearsDistrict, rows);
    seats.push({
      district: stearsDistrict,
      winner: built.winner,
      candidates: built.candidates,
    });
    if (built.hasVotes) seatsWithVotes += 1;
  }

  const candidates = [];
  for (const seat of seats) {
    for (const c of seat.candidates || []) {
      candidates.push({
        name: c.name,
        party: c.party,
        district: seat.district,
        votes: c.votes,
      });
    }
  }

  const collated = seatsWithVotes > 0;
  const meta = {
    ...existing.meta,
    ...metaPatch,
    collated,
    note: collated
      ? 'Constituency vote totals collated from Stears Elections (__NEXT_DATA__), sourced from INEC/IREV and LGA collation.'
      : existing.meta?.note || 'Winner-only scaffold; Stears had no vote tallies for this state/year.',
    updated: new Date().toISOString().slice(0, 10),
  };

  return {
    payload: { meta, seats, candidates },
    stats: {
      matched,
      unmatchedExisting,
      seatsTotal: seats.length,
      seatsWithVotes,
      stearsDistricts: stearsDistMap.size,
      collated,
    },
  };
}

module.exports = {
  voteOf,
  matchDistrict,
  buildSeatFromStears,
  mergeStatePayload,
};
