const Ajv = require('ajv');
const addFormats = require('ajv-formats');

const schema = {
  type: 'object',
  additionalProperties: false,
  required: ['contest', 'dataset', 'candidates', 'reportingUnits', 'summaries', 'results', 'sources'],
  properties: {
    contest: {
      type: 'object',
      additionalProperties: false,
      required: ['office', 'jurisdictionCode', 'jurisdictionName', 'electionDate', 'electionType', 'phase'],
      properties: {
        office: { enum: ['president', 'governor', 'senate', 'house', 'state_assembly'] },
        jurisdictionCode: { type: 'string', minLength: 2, maxLength: 32 },
        jurisdictionName: { type: 'string', minLength: 2, maxLength: 160 },
        constituencyName: { type: 'string', maxLength: 200, default: '' },
        electionDate: { type: 'string', format: 'date' },
        electionType: { enum: ['general', 'off_cycle', 'bye_election'] },
        phase: { enum: ['initial', 'supplementary', 'rerun'] },
      },
    },
    dataset: {
      type: 'object',
      additionalProperties: false,
      required: ['title', 'methodology', 'coverage', 'asOf', 'declaredWinnerRef', 'geographyVintage', 'expectedReportingUnits'],
      properties: {
        title: { type: 'string', minLength: 5, maxLength: 300 },
        methodology: { type: 'string', minLength: 10, maxLength: 4000 },
        coverage: { enum: ['legal_declaration', 'lga', 'ward', 'polling_unit'] },
        asOf: { type: 'string', format: 'date-time' },
        declaredWinnerRef: { type: 'string', minLength: 1, maxLength: 100 },
        geographyVintage: { type: 'string', minLength: 4, maxLength: 200 },
        expectedReportingUnits: { type: 'integer', minimum: 1, maximum: 200000 },
      },
    },
    candidates: {
      type: 'array', minItems: 1,
      items: {
        type: 'object', additionalProperties: false, required: ['ref', 'name', 'party'],
        properties: {
          ref: { type: 'string', minLength: 1, maxLength: 100 },
          name: { type: 'string', minLength: 2, maxLength: 200 },
          party: { type: 'string', minLength: 1, maxLength: 100 },
        },
      },
    },
    reportingUnits: {
      type: 'array', minItems: 1,
      items: {
        type: 'object', additionalProperties: false, required: ['ref', 'name', 'level', 'jurisdictionCode'],
        properties: {
          ref: { type: 'string', minLength: 1, maxLength: 100 },
          name: { type: 'string', minLength: 1, maxLength: 200 },
          level: { enum: ['national', 'state', 'lga', 'ward', 'polling_unit', 'constituency'] },
          jurisdictionCode: { type: 'string', minLength: 2, maxLength: 64 },
          geometrySource: { type: 'string', maxLength: 200 },
        },
      },
    },
    summaries: {
      type: 'array', minItems: 1,
      items: {
        type: 'object', additionalProperties: false, required: ['reportingUnitRef', 'validVotes'],
        properties: {
          reportingUnitRef: { type: 'string', minLength: 1, maxLength: 100 },
          registeredVoters: { type: 'integer', minimum: 0 },
          accreditedVoters: { type: 'integer', minimum: 0 },
          validVotes: { type: 'integer', minimum: 0 },
          rejectedVotes: { type: 'integer', minimum: 0 },
        },
      },
    },
    results: {
      type: 'array', minItems: 1,
      items: {
        type: 'object', additionalProperties: false,
        required: ['reportingUnitRef', 'candidateRef', 'votes', 'sourceRefs'],
        properties: {
          reportingUnitRef: { type: 'string', minLength: 1, maxLength: 100 },
          candidateRef: { type: 'string', minLength: 1, maxLength: 100 },
          votes: { type: 'integer', minimum: 0 },
          sourceRefs: { type: 'array', minItems: 1, uniqueItems: true, items: { type: 'string' } },
        },
      },
    },
    sources: {
      type: 'array', minItems: 1,
      items: {
        type: 'object', additionalProperties: false,
        required: ['ref', 'publisher', 'publisherType', 'url', 'documentType', 'documentDate', 'retrievedAt', 'pageReference', 'sha256', 'storageKey'],
        properties: {
          ref: { type: 'string', minLength: 1, maxLength: 100 },
          publisher: { type: 'string', minLength: 2, maxLength: 200 },
          publisherType: { enum: ['inec', 'independent'] },
          url: { type: 'string', format: 'uri', maxLength: 2000 },
          documentType: { type: 'string', minLength: 2, maxLength: 100 },
          documentDate: { type: 'string', format: 'date' },
          retrievedAt: { type: 'string', format: 'date-time' },
          pageReference: { type: 'string', minLength: 1, maxLength: 200 },
          sha256: { type: 'string', pattern: '^[0-9a-f]{64}$' },
          storageKey: { type: 'string', minLength: 3, maxLength: 1000 },
        },
      },
    },
  },
};

const ajv = new Ajv({ allErrors: true, useDefaults: true });
addFormats(ajv);
const validateSchema = ajv.compile(schema);

function isSpecificInecUrl(value) {
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    const isInec = host === 'inecnigeria.org' || host.endsWith('.inecnigeria.org') ||
      host === 'inecelectionresults.ng' || host.endsWith('.inecelectionresults.ng');
    return isInec && url.pathname !== '/' && url.pathname.length > 2;
  } catch {
    return false;
  }
}

function validateResultDataset(payload) {
  const validShape = validateSchema(payload);
  const errors = validShape ? [] : validateSchema.errors.map((error) => `${error.instancePath || '/'} ${error.message}`);
  if (!validShape) return { valid: false, errors };

  const candidateRefs = new Set();
  for (const candidate of payload.candidates) {
    if (candidateRefs.has(candidate.ref)) errors.push(`Duplicate candidate ref: ${candidate.ref}`);
    candidateRefs.add(candidate.ref);
  }
  if (!candidateRefs.has(payload.dataset.declaredWinnerRef)) {
    errors.push('declaredWinnerRef must identify a candidate in this dataset.');
  }

  const unitRefs = new Set();
  for (const unit of payload.reportingUnits) {
    if (unitRefs.has(unit.ref)) errors.push(`Duplicate reporting unit ref: ${unit.ref}`);
    unitRefs.add(unit.ref);
  }
  if (payload.reportingUnits.length !== payload.dataset.expectedReportingUnits) {
    errors.push(`Expected ${payload.dataset.expectedReportingUnits} reporting units but received ${payload.reportingUnits.length}.`);
  }

  const electionDate = new Date(`${payload.contest.electionDate}T00:00:00Z`);
  const asOf = new Date(payload.dataset.asOf);
  if (electionDate.getUTCFullYear() < 2015) errors.push('Election date must be 2015 or later for this corpus.');
  if (asOf < electionDate) errors.push('Dataset asOf cannot precede the election date.');

  const sourceRefs = new Map(payload.sources.map((source) => [source.ref, source]));
  const hasInecPrimary = payload.sources.some((source) => source.publisherType === 'inec' && isSpecificInecUrl(source.url));
  const independentPublishers = new Set(
    payload.sources.filter((source) => source.publisherType === 'independent')
      .map((source) => source.publisher.trim().toLowerCase())
  );
  if (!hasInecPrimary && independentPublishers.size < 2) {
    errors.push('Evidence requires a specific INEC source or two independent publishers.');
  }
  if (payload.sources.some((source) => source.publisherType === 'inec' && !isSpecificInecUrl(source.url))) {
    errors.push('INEC evidence must link to a specific result page or document, not a homepage.');
  }

  const resultKeys = new Set();
  const voteSums = new Map();
  for (const result of payload.results) {
    if (!candidateRefs.has(result.candidateRef)) errors.push(`Unknown candidate ref: ${result.candidateRef}`);
    if (!unitRefs.has(result.reportingUnitRef)) errors.push(`Unknown reporting unit ref: ${result.reportingUnitRef}`);
    const key = `${result.reportingUnitRef}::${result.candidateRef}`;
    if (resultKeys.has(key)) errors.push(`Duplicate result total: ${key}`);
    resultKeys.add(key);
    voteSums.set(result.reportingUnitRef, (voteSums.get(result.reportingUnitRef) || 0) + result.votes);
    const linkedSources = result.sourceRefs.map((ref) => sourceRefs.get(ref)).filter(Boolean);
    const resultHasInec = linkedSources.some((source) => source.publisherType === 'inec' && isSpecificInecUrl(source.url));
    const resultIndependentPublishers = new Set(linkedSources
      .filter((source) => source.publisherType === 'independent')
      .map((source) => source.publisher.trim().toLowerCase()));
    if (!resultHasInec && resultIndependentPublishers.size < 2) {
      errors.push(`Result ${key} needs a specific INEC source or two independent publishers.`);
    }
    for (const ref of result.sourceRefs) {
      if (!sourceRefs.has(ref)) errors.push(`Unknown evidence source ref: ${ref}`);
    }
  }

  const summaryRefs = new Set();
  for (const summary of payload.summaries) {
    if (summaryRefs.has(summary.reportingUnitRef)) errors.push(`Duplicate vote summary: ${summary.reportingUnitRef}`);
    summaryRefs.add(summary.reportingUnitRef);
    if (!unitRefs.has(summary.reportingUnitRef)) errors.push(`Unknown summary reporting unit ref: ${summary.reportingUnitRef}`);
    if ((voteSums.get(summary.reportingUnitRef) || 0) !== summary.validVotes) {
      errors.push(`Candidate votes do not equal valid votes for ${summary.reportingUnitRef}.`);
    }
    const rejected = summary.rejectedVotes || 0;
    if (summary.accreditedVoters !== undefined && summary.accreditedVoters < summary.validVotes + rejected) {
      errors.push(`Accredited voters are below valid plus rejected votes for ${summary.reportingUnitRef}.`);
    }
    if (summary.registeredVoters !== undefined && summary.accreditedVoters !== undefined &&
        summary.registeredVoters < summary.accreditedVoters) {
      errors.push(`Registered voters are below accredited voters for ${summary.reportingUnitRef}.`);
    }
  }
  for (const unitRef of unitRefs) {
    if (!summaryRefs.has(unitRef)) errors.push(`Missing vote summary for reporting unit: ${unitRef}`);
  }

  if (/pvc[- ]proportional|synthetic|placeholder|modeled allocation/i.test(payload.dataset.methodology)) {
    errors.push('Modeled, PVC-proportional, synthetic, or placeholder vote totals cannot be published.');
  }

  return { valid: errors.length === 0, errors };
}

module.exports = { schema, isSpecificInecUrl, validateResultDataset };
