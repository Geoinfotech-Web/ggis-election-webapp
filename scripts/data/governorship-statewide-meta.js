/** Default attribution for sourced statewide results. */
const INEC_URL = 'https://www.inecnigeria.org/';

function entry(candidates, source, electionDate, sourceUrl = INEC_URL) {
  return {
    candidates,
    source,
    sourceUrl,
    electionDate,
  };
}

module.exports = { entry, INEC_URL };
