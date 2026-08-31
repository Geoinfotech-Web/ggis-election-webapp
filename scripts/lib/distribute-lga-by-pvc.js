/**
 * Allocate statewide candidate totals across LGAs using population weights
 * from population-pvc-data.json (2023 PVC registration cycle).
 */
const { canonicalLga, matchKey } = require('../../lga-normalize');

function buildLgaWeights(state, lgaNames, lgaPopulation) {
  const popRows = (lgaPopulation || []).filter((r) => r.state === state);
  const popByKey = new Map();
  for (const row of popRows) {
    popByKey.set(matchKey(row.lga), Number(row.population) || 0);
  }

  const weights = lgaNames.map((lga) => {
    const key = matchKey(lga);
    const pop = popByKey.get(key) || popByKey.get(matchKey(canonicalLga(lga))) || 0;
    return { lga: canonicalLga(lga), weight: Math.max(pop, 1) };
  });

  const total = weights.reduce((s, w) => s + w.weight, 0) || weights.length;
  return weights.map((w) => ({ lga: w.lga, share: w.weight / total }));
}

function distributeLgaByPvc(state, candidates, lgaNames, lgaPopulation) {
  const shares = buildLgaWeights(state, lgaNames, lgaPopulation);
  const totalVotes = candidates.reduce((s, c) => s + Number(c.votes || 0), 0);
  const units = {};

  for (const { lga, share } of shares) {
    const lgaTotal = Math.max(1, Math.round(totalVotes * share));
    const votes = {};
    let allocated = 0;

    candidates.forEach((c, idx) => {
      const party = c.party;
      const stateTotal = Number(c.votes || 0);
      const proportion = totalVotes ? stateTotal / totalVotes : 1 / candidates.length;
      const slice = idx === candidates.length - 1
        ? lgaTotal - allocated
        : Math.max(0, Math.round(lgaTotal * proportion));
      votes[party] = slice;
      allocated += slice;
    });

    const sorted = Object.entries(votes).sort((a, b) => b[1] - a[1]);
    const topParty = sorted[0]?.[0];
    const winner = candidates.find((c) => c.party === topParty) || candidates[0];

    units[lga] = {
      winner: winner.name,
      party: winner.party,
      votes,
    };
  }

  return units;
}

module.exports = {
  distributeLgaByPvc,
  buildLgaWeights,
};
