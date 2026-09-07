const crypto = require('crypto');

function validDataset(storageKey = 'tests/2015/nigeria/source.pdf', contents = Buffer.from('%PDF-test source')) {
  const sha256 = crypto.createHash('sha256').update(contents).digest('hex');
  return {
    contest: {
      office: 'president', jurisdictionCode: 'NG', jurisdictionName: 'Nigeria', constituencyName: '',
      electionDate: '2015-03-28', electionType: 'general', phase: 'initial',
    },
    dataset: {
      title: 'Nigeria presidential election declaration totals',
      methodology: 'Candidate totals transcribed from the legally declared national collation document.',
      coverage: 'legal_declaration', asOf: '2015-04-01T12:00:00Z', declaredWinnerRef: 'winner',
      geographyVintage: 'INEC 2015 national declaration geography', expectedReportingUnits: 1,
    },
    candidates: [
      { ref: 'winner', name: 'Candidate One', party: 'AAA' },
      { ref: 'runner-up', name: 'Candidate Two', party: 'BBB' },
    ],
    reportingUnits: [{ ref: 'national', name: 'Nigeria', level: 'national', jurisdictionCode: 'NG' }],
    summaries: [{ reportingUnitRef: 'national', registeredVoters: 100, accreditedVoters: 72, validVotes: 70, rejectedVotes: 2 }],
    results: [
      { reportingUnitRef: 'national', candidateRef: 'winner', votes: 40, sourceRefs: ['inec-form'] },
      { reportingUnitRef: 'national', candidateRef: 'runner-up', votes: 30, sourceRefs: ['inec-form'] },
    ],
    sources: [{
      ref: 'inec-form', publisher: 'Independent National Electoral Commission', publisherType: 'inec',
      url: 'https://wp1.inecnigeria.org/wp-content/uploads/results/2015-national-declaration.pdf',
      documentType: 'declaration form', documentDate: '2015-04-01', retrievedAt: '2026-09-03T10:00:00Z',
      pageReference: 'National declaration, page 1', sha256, storageKey,
    }],
  };
}

module.exports = { validDataset };
