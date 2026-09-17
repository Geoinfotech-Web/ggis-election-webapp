/**
 * One-shot finalize: load agent-tools dump (or fetch json), write outputs.
 * Avoids lastIndexOf('}') bug on agent-tools markdown trailers.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const DATA_DIR = path.join(ROOT, 'data', 'election-results');
const RAW_DIR = path.join(__dirname, '_wiki_raw');

const CANDIDATE_DISPLAY = {
  APC: 'Bola Ahmed Tinubu',
  PDP: 'Atiku Abubakar',
  LP: 'Peter Obi',
  NNPP: 'Rabiu Musa Kwankwaso',
};

function findDump() {
  const preferred = path.join(RAW_DIR, 'stears-pres-lga-fetch.json');
  if (fs.existsSync(preferred)) return preferred;
  const agentTools = path.join(
    process.env.USERPROFILE || '',
    '.cursor',
    'projects',
    'c-Users-Geoinfotech-Documents-GIS-Team-Election-Dashboard',
    'agent-tools',
    '98d628dd-c619-4634-8d47-ceddc7e8948b.txt'
  );
  if (fs.existsSync(agentTools)) return agentTools;
  throw new Error('No fetch dump found');
}

function loadDump(file) {
  let text = fs.readFileSync(file, 'utf8');
  if (text.startsWith('###')) {
    const idx = text.indexOf('{');
    text = text.slice(idx);
  }
  try {
    return JSON.parse(text);
  } catch (_) {
    /* fall through */
  }
  let depth = 0;
  let end = -1;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) {
        end = i;
        break;
      }
    }
  }
  if (end < 0) throw new Error('Could not locate JSON object in dump');
  return JSON.parse(text.slice(0, end + 1));
}

function displayName(party, stearsName) {
  return CANDIDATE_DISPLAY[party] || stearsName || party;
}

function main() {
  const dumpPath = findDump();
  console.log('Reading', dumpPath);
  const dump = loadDump(dumpPath);

  fs.mkdirSync(RAW_DIR, { recursive: true });
  const rawOut = path.join(RAW_DIR, 'stears-pres-lga-fetch.json');
  // Compact write — pretty-print of this dump is huge and slow under load
  fs.writeFileSync(rawOut, JSON.stringify(dump) + '\n');
  console.log('Wrote', rawOut);

  const units = {};
  for (const [key, row] of Object.entries(dump.units || {})) {
    const party = row.party;
    units[key] = {
      winner: displayName(party, row.winner),
      party,
      votes: row.votes || {},
      lga: row.lga,
      state: row.state,
      stateCode: row.stateCode,
      ...(row.lgaCode ? { lgaCode: row.lgaCode } : {}),
    };
  }

  const candidates = (dump.candidates || []).map((c) => ({
    name: displayName(c.party, c.name),
    party: c.party,
    votes: c.votes,
  }));

  const out = {
    meta: {
      office: 'pres',
      year: '2023',
      level: 'lga',
      title: '2023 Presidential Election — LGA results',
      source: 'Stears Elections (INEC collation)',
      sourceUrl: dump.hubUrl || 'https://www.stears.co/elections/2023/president/',
      sourceDetail:
        'LGA party vote tallies extracted from Stears Elections state pages (__NEXT_DATA__.props.pageProps.parties). Underlying official source: INEC. Coverage may be partial where Stears publishes subset LGA rows.',
      attribution: 'Stears; Independent National Electoral Commission (INEC)',
      updated: new Date().toISOString().slice(0, 10),
      collated: true,
      unitKey: 'state::lga',
      coverage: {
        states: dump.statesWithLga,
        lgas: dump.totalLgas,
        year: '2023',
        statesFetched: dump.statesFetched,
      },
      evidence: [
        { label: 'Stears presidential hub', url: 'https://www.stears.co/elections/2023/president/' },
        { label: 'INEC', url: 'https://www.inecnigeria.org/' },
      ],
    },
    winner: candidates[0]
      ? { name: candidates[0].name, party: candidates[0].party, votes: candidates[0].votes }
      : null,
    candidates,
    units,
  };

  const outPath = path.join(DATA_DIR, 'presidential-2023-lga.json');
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(out, null, 2) + '\n');
  console.log('Wrote', outPath);
  console.log('States', dump.statesWithLga, 'LGAs', dump.totalLgas);

  const statePath = path.join(DATA_DIR, 'presidential-2023-states.json');
  const statePayload = JSON.parse(fs.readFileSync(statePath, 'utf8'));
  const mismatches = [];
  const matched = [];
  const MAJOR = ['APC', 'LP', 'NNPP', 'PDP'];

  for (const [state, declared] of Object.entries(statePayload.units || {})) {
    const sums = dump.lgaByStateSums?.[state] || {};
    const hasAny = Object.keys(sums).length > 0;
    if (!hasAny) {
      mismatches.push({ state, kind: 'missing-state', detail: 'No LGA pack' });
      continue;
    }
    const diffs = [];
    for (const party of new Set([...MAJOR, ...Object.keys(declared.votes || {}), ...Object.keys(sums)])) {
      const a = Number(declared.votes?.[party] || 0);
      const b = Number(sums[party] || 0);
      if (a !== b) diffs.push({ party, stateFile: a, lgaSum: b, delta: b - a });
    }
    const lgaCount = (dump.fetchLog || []).find((f) => f.state === state)?.lgaCount || null;
    if (diffs.length) {
      mismatches.push({ state, kind: 'vote-mismatch', lgaCount, diffs });
    } else {
      matched.push({ state, lgaCount });
    }
  }

  const checkPath = path.join(RAW_DIR, 'stears-pres-lga-2023-check.json');
  fs.writeFileSync(
    checkPath,
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        year: '2023',
        sourceUrl: dump.hubUrl,
        statesFetched: dump.statesFetched,
        statesWithLga: dump.statesWithLga,
        totalLgas: dump.totalLgas,
        matchedStates: matched.length,
        mismatchStates: mismatches.length,
        note:
          'Stears state pages often expose a partial LGA set; LGA sums are therefore frequently below INEC state declared totals. Do not treat mismatches as ingest bugs without checking Stears coverage.',
        mismatches,
        matched,
        fetchLog: dump.fetchLog,
      },
      null,
      2
    ) + '\n'
  );
  console.log('Check', checkPath);
  console.log('Match', matched.length, 'Mismatch', mismatches.length);
  for (const m of mismatches.slice(0, 12)) {
    if (m.kind === 'missing-state') console.log('  MISSING', m.state);
    else {
      const sample = (m.diffs || [])
        .filter((d) => MAJOR.includes(d.party))
        .map((d) => `${d.party}:${d.delta}`)
        .join(' ');
      console.log(`  ${m.state} LGAs=${m.lgaCount} ${sample}`);
    }
  }
}

main();
