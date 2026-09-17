'use strict';
const fs = require('fs');
const path = require('path');

const DEFAULT_SRC = path.join(
  process.env.USERPROFILE || '',
  '.cursor/projects/c-Users-Geoinfotech-Documents-GIS-Team-Election-Dashboard/agent-tools/e633dbde-bbbd-4a22-afda-147e4ad47998.txt'
);
const SRC = process.argv[2] || (fs.existsSync(DEFAULT_SRC) ? DEFAULT_SRC : path.join(__dirname, '_wiki_raw/stears-csv-b64-full.json'));
const OUT_DIR = path.join(__dirname, '..', 'data', 'reference', 'stears-open-data');

const raw = fs.readFileSync(SRC, 'utf8');
const start = raw.indexOf('[');
const end = raw.lastIndexOf(']');
if (start < 0 || end < 0) throw new Error('JSON array not found in source file');
const items = JSON.parse(raw.slice(start, end + 1));

fs.mkdirSync(OUT_DIR, { recursive: true });
const files = [];
for (const item of items) {
  const dest = path.join(OUT_DIR, item.name);
  const buf = Buffer.from(item.b64, 'base64');
  fs.writeFileSync(dest, buf);
  files.push({
    filename: item.name,
    url: `https://stears-flourish-data.s3.amazonaws.com/${item.name}`,
    bytes: buf.length,
    expectedBytes: item.bytes,
    downloaded: true,
    status: item.status,
  });
  console.log('WROTE', item.name, buf.length, 'bytes');
}

const manifest = {
  generatedAt: new Date().toISOString(),
  attribution: 'Stears Open Data (Flourish datasets hosted on AWS S3)',
  source: 'https://www.stears.co/open-data',
  license: 'See Stears Open Data terms; cite Stears when using these datasets.',
  downloadStatus: 'complete',
  files,
};
fs.writeFileSync(path.join(OUT_DIR, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');

const readme = `# Stears Open Data (reference CSVs)

Downloaded from [Stears Open Data](https://www.stears.co/open-data) Flourish S3 endpoints for offline reference in the Election Dashboard.

## Attribution

Data © **Stears**. When publishing charts or analysis derived from these files, cite Stears Open Data and link to https://www.stears.co/open-data .

## Files

${files
  .map(
    (f) =>
      `- \`${f.filename}\` — ${f.bytes.toLocaleString()} bytes — ${f.url} — downloaded: true`
  )
  .join('\n')}

See \`manifest.json\` for download timestamps and byte sizes.
`;
fs.writeFileSync(path.join(OUT_DIR, 'README.md'), readme);
console.log('MANIFEST', files.length, 'files');
