const fs = require('fs/promises');
const path = require('path');

const ROOT_DIR = path.join(__dirname, '..');
const DATA_PATH = path.join(ROOT_DIR, 'public', 'data', 'population-pvc-data.json');
const GOVERNOR_DIR = path.join(ROOT_DIR, 'public', 'assets', 'governors');
const PARTY_DIR = path.join(ROOT_DIR, 'public', 'assets', 'parties');

const PARTY_STYLES = {
  ACCORD: { color: '#7b2cbf', accent: '#f4d35e' },
  APC: { color: '#1f8f4d', accent: '#ffffff' },
  APGA: { color: '#d62828', accent: '#ffffff' },
  LP: { color: '#c1121f', accent: '#2d7d46' },
  NNPP: { color: '#d71920', accent: '#233f8f' },
  PDP: { color: '#0b7a3b', accent: '#d71920' },
  YPP: { color: '#f5c400', accent: '#111111' },
  ZLP: { color: '#1d4ed8', accent: '#f5c400' },
};

function slugify(value) {
  return String(value)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/gi, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase();
}

async function fetchJson(url) {
  const response = await fetch(url, {
    headers: {
      'User-Agent': 'ElectionDashboard/1.0 (local data enrichment)',
    },
  });

  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}`);
  }

  return response.json();
}

async function findWikipediaImage(name) {
  const searchUrl = `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(
    `${name} governor Nigeria`
  )}&format=json&origin=*`;
  const searchData = await fetchJson(searchUrl);
  const pageTitle = searchData.query?.search?.[0]?.title || name;
  const summaryUrl = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(pageTitle)}`;
  const summaryData = await fetchJson(summaryUrl);

  return {
    title: summaryData.title || pageTitle,
    imageUrl: summaryData.originalimage?.source || summaryData.thumbnail?.source || '',
    pageUrl: summaryData.content_urls?.desktop?.page || `https://en.wikipedia.org/wiki/${encodeURIComponent(pageTitle)}`,
  };
}

async function findWikidataImages(names) {
  const values = names.map((name) => `"${name.replace(/"/g, '\\"')}"@en`).join(' ');
  const query = `
SELECT ?personLabel ?image WHERE {
  VALUES ?personLabel { ${values} }
  ?person rdfs:label ?personLabel;
          wdt:P18 ?image.
  FILTER(LANG(?personLabel) = "en")
}
`;
  const url = `https://query.wikidata.org/sparql?query=${encodeURIComponent(query)}&format=json`;
  const data = await fetchJson(url);
  const images = new Map();

  for (const binding of data.results?.bindings || []) {
    images.set(binding.personLabel.value, binding.image.value);
  }

  return images;
}

async function downloadFile(url, outputPath) {
  const response = await fetch(url, {
    headers: {
      'User-Agent': 'ElectionDashboard/1.0 (local data enrichment)',
    },
  });

  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}`);
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  await fs.writeFile(outputPath, buffer);
}

function partyLogoSvg(party) {
  const style = PARTY_STYLES[party] || { color: '#263238', accent: '#f4d35e' };

  return `<svg xmlns="http://www.w3.org/2000/svg" width="240" height="240" viewBox="0 0 240 240" role="img" aria-label="${party} logo">
  <rect width="240" height="240" rx="48" fill="${style.color}"/>
  <circle cx="120" cy="91" r="45" fill="${style.accent}" opacity="0.95"/>
  <path d="M61 171h118" stroke="${style.accent}" stroke-width="18" stroke-linecap="round"/>
  <text x="120" y="134" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="${party.length > 4 ? 42 : 54}" font-weight="800" fill="${style.color}">${party}</text>
</svg>
`;
}

async function writePartyLogos(parties) {
  await fs.mkdir(PARTY_DIR, { recursive: true });

  for (const party of parties) {
    const fileName = `${slugify(party)}.svg`;
    await fs.writeFile(path.join(PARTY_DIR, fileName), partyLogoSvg(party));
  }
}

async function main() {
  await fs.mkdir(GOVERNOR_DIR, { recursive: true });

  const data = JSON.parse(await fs.readFile(DATA_PATH, 'utf8'));
  const parties = new Set();
  let wikidataImages = new Map();

  try {
    wikidataImages = await findWikidataImages(data.governors.map((governor) => governor.governor));
  } catch (error) {
    console.warn(`Wikidata image query failed: ${error.message || error}`);
  }

  for (const governor of data.governors) {
    if (governor.party) {
      parties.add(governor.party);
      governor.partyLogo = `assets/parties/${slugify(governor.party)}.svg`;
    }

    const fileName = `${slugify(governor.state)}-${slugify(governor.governor)}.jpg`;
    const relativePath = `assets/governors/${fileName}`;
    const outputPath = path.join(ROOT_DIR, 'public', relativePath);

    try {
      await fs.access(outputPath);
      governor.photo = relativePath;
      continue;
    } catch {
      // Download below.
    }

    try {
      const wikidataImageUrl = wikidataImages.get(governor.governor);
      const image = wikidataImageUrl
        ? {
            imageUrl: wikidataImageUrl,
            pageUrl: `https://www.wikidata.org/wiki/Special:Search?search=${encodeURIComponent(
              governor.governor
            )}`,
          }
        : await findWikipediaImage(governor.governor);

      if (!image.imageUrl) {
        throw new Error('No Wikipedia image found');
      }

      await downloadFile(image.imageUrl, outputPath);
      governor.photo = relativePath;
      governor.photoSource = image.pageUrl;
      console.log(`downloaded: ${governor.state} - ${governor.governor}`);
    } catch (error) {
      governor.photo = '';
      governor.photoSource = '';
      console.warn(`missing: ${governor.state} - ${governor.governor}: ${error.message || error}`);
    }
  }

  for (const chairman of data.lgaChairmen || []) {
    if (chairman.party) {
      parties.add(chairman.party);
      chairman.partyLogo = `assets/parties/${slugify(chairman.party)}.svg`;
    }
  }

  await writePartyLogos([...parties].sort());
  await fs.writeFile(DATA_PATH, `${JSON.stringify(data, null, 2)}\n`);

  const photoCount = data.governors.filter((governor) => governor.photo).length;
  console.log(`Governor photos: ${photoCount}/${data.governors.length}`);
  console.log(`Party logos: ${parties.size}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
