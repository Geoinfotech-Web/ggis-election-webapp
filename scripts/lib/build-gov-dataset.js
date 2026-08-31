const { canonicalLga } = require('../../lga-normalize');

function normalizeParty(party) {
  const p = String(party || '').trim().toUpperCase();
  if (p === 'ACCORD') return 'Accord';
  if (p === 'APGA') return 'APGA';
  return p;
}

function winnerFromVotes(votes, candidates) {
  const sorted = Object.entries(votes || {}).sort((a, b) => Number(b[1]) - Number(a[1]));
  const topParty = sorted[0]?.[0] || 'Others';
  const match = (candidates || []).find((c) => normalizeParty(c.party) === normalizeParty(topParty));
  return {
    winner: match?.name || topParty,
    party: normalizeParty(topParty),
  };
}

function sumCandidates(candidates) {
  return (candidates || []).reduce((sum, c) => sum + Number(c.votes || 0), 0);
}

function buildGovernorshipDataset({
  state,
  year,
  title,
  source = 'INEC collated results',
  sourceUrl = 'https://www.inecnigeria.org/',
  sourceDetail,
  updated,
  candidates,
  lgaRows,
}) {
  const normalizedCandidates = candidates.map((c) => ({
    name: c.name,
    party: normalizeParty(c.party),
    votes: Number(c.votes),
  }));

  const winner = normalizedCandidates.reduce((top, c) =>
    (Number(c.votes) > Number(top.votes) ? c : top), normalizedCandidates[0]);

  const units = {};
  for (const row of lgaRows) {
    const lga = canonicalLga(row.lga);
    const votes = {};
    Object.entries(row.votes).forEach(([party, count]) => {
      votes[normalizeParty(party)] = Number(count);
    });
    const unitWinner = winnerFromVotes(votes, normalizedCandidates);
    units[lga] = {
      winner: unitWinner.winner,
      party: unitWinner.party,
      votes,
    };
  }

  return {
    meta: {
      office: 'gov',
      year: String(year),
      state,
      level: 'lga',
      title: title || `${state} State Governorship Election ${year}`,
      source,
      sourceUrl,
      sourceDetail: sourceDetail || source,
      attribution: 'Independent National Electoral Commission (INEC)',
      updated: updated || `${year}-06-21`,
      collated: true,
    },
    winner,
    candidates: normalizedCandidates,
    units,
  };
}

module.exports = {
  buildGovernorshipDataset,
  normalizeParty,
  winnerFromVotes,
};
