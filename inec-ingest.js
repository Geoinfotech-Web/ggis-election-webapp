const fs = require('fs/promises');
const path = require('path');

const INEC_PVC_STATS_URL = 'https://www.inecnigeria.org/pvc-statistics/';
const INEC_HOME_URL = 'https://www.inecnigeria.org/';
const IREV_HOME_URL = 'https://www.inecelectionresults.ng/';
const DATA_DIR = path.join(__dirname, 'data', 'inec');
const LATEST_PATH = path.join(DATA_DIR, 'latest.json');
const STATUS_PATH = path.join(DATA_DIR, 'status.json');
const LOCAL_POP_PATH = path.join(__dirname, 'public', 'data', 'population-pvc-data.json');

let lastStatus = {
  ok: false,
  lastRunAt: null,
  lastSuccessAt: null,
  source: 'local-fallback',
  sourceUrls: [],
  error: null,
  pdfCount: 0,
};

async function readJsonSafe(filePath, fallback) {
  try {
    return JSON.parse(await fs.readFile(filePath, 'utf8'));
  } catch (error) {
    return fallback;
  }
}

async function ensureDir() {
  await fs.mkdir(DATA_DIR, { recursive: true });
}

function parseHtmlTables(html) {
  try {
    const cheerio = require('cheerio');
    const $ = cheerio.load(html);
    const tables = [];
    $('table').each((_, table) => {
      const headers = [];
      $(table).find('tr').first().find('th,td').each((__, cell) => {
        headers.push($(cell).text().replace(/\s+/g, ' ').trim());
      });
      const rows = [];
      $(table).find('tr').slice(1).each((__, tr) => {
        const cells = [];
        $(tr).find('td,th').each((___, td) => {
          cells.push($(td).text().replace(/\s+/g, ' ').trim());
        });
        if (cells.some(Boolean)) rows.push(cells);
      });
      if (headers.length && rows.length) tables.push({ headers, rows });
    });
    return tables;
  } catch (error) {
    return [];
  }
}

async function tryParsePdf(url) {
  try {
    const pdfParse = require('pdf-parse');
    const response = await fetch(url, {
      headers: { accept: 'application/pdf' },
      signal: AbortSignal.timeout(25000),
    });
    if (!response.ok) return null;
    const buffer = Buffer.from(await response.arrayBuffer());
    const parsed = await pdfParse(buffer);
    return { url, pages: parsed.numpages, textPreview: String(parsed.text || '').slice(0, 4000) };
  } catch (error) {
    return { url, error: error.message || String(error) };
  }
}

function extractPdfLinks(html, baseUrl) {
  const links = [];
  const re = /href=["']([^"']+\.pdf[^"']*)["']/gi;
  let match;
  while ((match = re.exec(html))) {
    try {
      links.push(new URL(match[1], baseUrl).href);
    } catch (error) {
      /* skip bad href */
    }
  }
  return [...new Set(links)];
}

function buildSnapshotFromPopulation(pop, extra = {}) {
  return {
    generatedAt: new Date().toISOString(),
    source: extra.source || 'local-population-pvc-data',
    sourceUrls: extra.sourceUrls || [],
    statePopulation: pop.statePopulation || [],
    lgaPopulation: pop.lgaPopulation || [],
    lgaRegister: extra.lgaRegister || [],
    wardRegister: extra.wardRegister || [],
    puRegister: extra.puRegister || [],
    notes: extra.notes || 'Official INEC REST API is not available. Snapshot from local PVC/register file plus any public INEC pages that parsed successfully.',
  };
}

async function fetchText(url, timeoutMs = 20000) {
  const response = await fetch(url, {
    headers: { accept: 'text/html,application/xhtml+xml,application/pdf;q=0.9,*/*;q=0.8' },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) throw new Error(`${url} returned ${response.status}`);
  return response.text();
}

async function runIngest() {
  await ensureDir();
  lastStatus = {
    ...lastStatus,
    lastRunAt: new Date().toISOString(),
    error: null,
  };

  const pop = await readJsonSafe(LOCAL_POP_PATH, { statePopulation: [], lgaPopulation: [] });
  const sourceUrls = [INEC_PVC_STATS_URL];
  let html = '';
  let pdfLinks = [];
  let notes = ['Seeded from local population-pvc-data.json (state registered voters and PVC collection).'];

  try {
    html = await fetchText(INEC_PVC_STATS_URL);
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    await fs.writeFile(path.join(DATA_DIR, `pvc-statistics-${stamp}.html`), html, 'utf8');
    pdfLinks = extractPdfLinks(html, INEC_PVC_STATS_URL);
    sourceUrls.push(...pdfLinks.slice(0, 12));
    const tables = parseHtmlTables(html);
    notes.push(`Fetched INEC PVC statistics page; found ${pdfLinks.length} PDF link(s) and ${tables.length} HTML table(s).`);
    if (tables.length) {
      await fs.writeFile(path.join(DATA_DIR, `pvc-tables-${stamp}.json`), JSON.stringify(tables, null, 2));
    }
    if (pdfLinks[0]) {
      const pdfMeta = await tryParsePdf(pdfLinks[0]);
      if (pdfMeta) {
        await fs.writeFile(path.join(DATA_DIR, `pvc-pdf-preview-${stamp}.json`), JSON.stringify(pdfMeta, null, 2));
        notes.push(pdfMeta.error
          ? `PDF parse skipped: ${pdfMeta.error}`
          : `Stored text preview from first linked PDF (${pdfMeta.pages || 0} pages). Nationwide LGA/PU register is used only when that table is present.`);
      }
    }
  } catch (error) {
    notes.push(`INEC website fetch failed: ${error.message || error}`);
    lastStatus.error = error.message || String(error);
  }

  try {
    const irevHtml = await fetchText(IREV_HOME_URL, 12000);
    const irevStamp = new Date().toISOString().replace(/[:.]/g, '-');
    await fs.writeFile(path.join(DATA_DIR, `irev-home-${irevStamp}.html`), irevHtml, 'utf8');
    sourceUrls.push(IREV_HOME_URL);
    notes.push('Cached IReV public homepage (unofficial PU vote portal — not PVC).');
  } catch (error) {
    notes.push(`IReV homepage not cached: ${error.message || error}`);
  }

  const snapshot = buildSnapshotFromPopulation(pop, {
    source: html ? 'inec-website+local' : 'local-fallback',
    sourceUrls,
    notes: notes.join(' '),
  });

  const previous = await readJsonSafe(LATEST_PATH, null);
  if (!snapshot.statePopulation.length && previous?.statePopulation?.length) {
    lastStatus.ok = true;
    lastStatus.source = 'last-good-cache';
    lastStatus.error = lastStatus.error || 'Empty parse; kept previous snapshot.';
    await fs.writeFile(STATUS_PATH, JSON.stringify(lastStatus, null, 2));
    return { snapshot: previous, status: lastStatus };
  }

  await fs.writeFile(LATEST_PATH, JSON.stringify(snapshot, null, 2));
  lastStatus = {
    ok: true,
    lastRunAt: lastStatus.lastRunAt,
    lastSuccessAt: new Date().toISOString(),
    source: snapshot.source,
    sourceUrls,
    error: lastStatus.error,
    pdfCount: pdfLinks.length,
    notes: snapshot.notes,
  };
  await fs.writeFile(STATUS_PATH, JSON.stringify(lastStatus, null, 2));
  return { snapshot, status: lastStatus };
}

async function loadLatestSnapshot() {
  const latest = await readJsonSafe(LATEST_PATH, null);
  if (latest?.statePopulation?.length) return latest;
  const pop = await readJsonSafe(LOCAL_POP_PATH, { statePopulation: [], lgaPopulation: [] });
  return buildSnapshotFromPopulation(pop, { source: 'local-fallback' });
}

function getIngestStatus() {
  return lastStatus;
}

async function hydrateIngestStatus() {
  const stored = await readJsonSafe(STATUS_PATH, null);
  if (stored) lastStatus = { ...lastStatus, ...stored };
  return lastStatus;
}

if (require.main === module) {
  runIngest()
    .then((result) => {
      console.log('INEC ingest complete:', result.status.source, `${(result.snapshot.statePopulation || []).length} states`);
    })
    .catch((error) => {
      console.error('INEC ingest failed:', error);
      process.exitCode = 1;
    });
}

module.exports = {
  runIngest,
  loadLatestSnapshot,
  getIngestStatus,
  hydrateIngestStatus,
  INEC_PVC_STATS_URL,
};
