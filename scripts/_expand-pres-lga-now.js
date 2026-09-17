/**
 * Shell-free expand helper: when node works, run:
 *   node scripts/_expand-pres-lga-now.js
 * Prefers ensurePresLga2023Artifacts (merges BE/NA patch).
 */
'use strict';
const path = require('path');
const fs = require('fs');
const ROOT = path.join(__dirname, '..');
const mod = require(path.join(ROOT, 'election-results-data.js'));
const out = mod.ensurePresLga2023Artifacts();
const unitKeys = Object.keys(out.units || {});
const states = new Set(unitKeys.map((k) => k.split('::')[0]));
const report = {
  ok: !('__MORE__' in (out.units || {})),
  unitCount: unitKeys.length,
  stateCount: states.size,
  hasMore: '__MORE__' in (out.units || {}),
  staticHas: (mod.STATIC_INDEX || []).some((r) => r.file === 'presidential-2023-lga.json'),
  coverage: out.meta && out.meta.coverage,
  lagos: unitKeys.filter((k) => k.startsWith('Lagos::')).length,
  benue: unitKeys.filter((k) => k.startsWith('Benue::')).length,
  nasarawa: unitKeys.filter((k) => k.startsWith('Nasarawa::')).length,
};
fs.writeFileSync(
  path.join(__dirname, '_wiki_raw', 'stears-pres-lga-expand-verify.json'),
  JSON.stringify(report, null, 2) + '\n'
);
console.log(JSON.stringify(report));
