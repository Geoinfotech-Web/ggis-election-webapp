const fs = require('fs/promises');
const path = require('path');

const ROOT_DIR = path.join(__dirname, '..');
const SOURCE_PATH = path.join(ROOT_DIR, 'public', 'data', 'lg-directory-source.html');
const DATA_PATH = path.join(ROOT_DIR, 'public', 'data', 'population-pvc-data.json');

const SOURCE_URL = 'https://democracybuilders.ng/lg-directory/';

const FCT_STATE_NAME = 'Fct, Abuja';

const SUPPLEMENTAL_ENTRIES = [
  ['Abia', 'Ugwunagbo', 'Ihenacho Chiemela Nwagbara', 'Daily Gazette Nigeria'],
  ['Abia', 'Umuahia South', 'Chinwendu Enwereuzo', 'Daily Gazette Nigeria'],
  ['Abia', 'Umu-Nneochi', 'Sunday Afuruike', 'Daily Gazette Nigeria'],
  ['Borno', 'Abadam', 'Abubakar Aji Mustapha', 'Nigerian Leaders'],
  ['Borno', 'Askira/Uba', 'Abubakar .U. Mazhinyi', 'Nigerian Leaders'],
  ['Borno', 'Bama', 'Modu Ali Gujja', 'Nigerian Leaders'],
  ['Borno', 'Bayo', 'Haruna Aliyu Chibra', 'Nigerian Leaders'],
  ['Borno', 'Biu', 'Sule Ali Abubakar', 'Nigerian Leaders'],
  ['Borno', 'Chibok', 'Madu Mustapha', 'Nigerian Leaders'],
  ['Borno', 'Damboa', 'Ali M Kauji', 'Nigerian Leaders'],
  ['Borno', 'Dikwa', 'R.G. Modu', 'Nigerian Leaders'],
  ['Borno', 'Gubio', 'Mali Bulama Mali Gubio', 'Nigerian Leaders'],
  ['Borno', 'Guzamala', 'Goni Gana Lawan', 'Nigerian Leaders'],
  ['Borno', 'Gwoza', 'Abba Kawu Idrisa Timta', 'Nigerian Leaders'],
  ['Borno', 'Hawul', 'Hussaini Malgwi', 'Nigerian Leaders'],
  ['Borno', 'Jere', 'Inna Galadima', 'Nigerian Leaders'],
  ['Borno', 'Kaga', 'Mairu Goni Abdallah', 'Nigerian Leaders'],
  ['Borno', 'Kala/Balge', 'Ajid Musa Ajid', 'Nigerian Leaders'],
  ['Borno', 'Konduga', 'Abba Satomi Abbari', 'Nigerian Leaders'],
  ['Borno', 'Kukawa', 'Abba Fugu Bukar', 'Nigerian Leaders'],
  ['Borno', 'Kwaya Kusar', 'Salisu Adamu Yanga', 'Nigerian Leaders'],
  ['Borno', 'Mafa', 'Sunusi Mustapha', 'Nigerian Leaders'],
  ['Borno', 'Magumeri', 'Abubakar Abdulkadir', 'Nigerian Leaders'],
  ['Borno', 'Maiduguri', 'Tijani Umar Ali', 'Nigerian Leaders'],
  ['Borno', 'Marte', 'Baba Gana Abatcha', 'Nigerian Leaders'],
  ['Borno', 'Mobbar', 'Mohammed M Aji', 'Nigerian Leaders'],
  ['Borno', 'Monguno', 'Liman Alhaji Kalla', 'Nigerian Leaders'],
  ['Borno', 'Ngala', 'Muhammad Umar', 'Nigerian Leaders'],
  ['Borno', 'Nganzai', 'Engr. Badu', 'Nigerian Leaders'],
  ['Borno', 'Shani', 'Hassan Abdu Labaki', 'Nigerian Leaders'],
  ['Kebbi', 'Augie', 'Alhaji Yahaya Mohammed Augie', 'Wikipedia'],
  ['Lagos', 'Eti Osa', "Omo'ba Adeola Alimot Adetoro", 'Eti-Osa LGA'],
  ['Ondo', 'Akoko South West', 'Ezekiel Ayorinde Ajana', 'Ondo State / The Hope'],
  ['Plateau', 'Barkin Ladi', 'HON. PWAJOK STEPHEN', 'Democracy Builders LG Directory'],
].map(([state, sourceLga, chairman, source]) => ({ state, sourceLga, chairman, source }));

const STATEWIDE_PARTIES = {
  Delta: ['PDP', 'Western Post'],
  Gombe: ['APC', 'The Nation'],
  Imo: ['APC', 'Independent / INNONEWS'],
  Kogi: ['APC', 'Independent'],
  Lagos: ['APC', 'Naija News'],
  Oyo: ['PDP', 'Inside Oyo / Gazette'],
};

const PARTY_OVERRIDES = {
  Abia: {
    'Aba North': ['ZLP', 'Channels Television'],
    'Aba South': ['ZLP', 'Channels Television'],
    Arochukwu: ['ZLP', 'Channels Television'],
    Bende: ['ZLP', 'Channels Television'],
    Ikwuano: ['ZLP', 'Channels Television'],
    'Isiala-Ngwa North': ['ZLP', 'Channels Television'],
    'Isiala-Ngwa South': ['ZLP', 'Channels Television'],
    Isuikwuato: ['ZLP', 'Channels Television'],
    'Obi Nwga': ['ZLP', 'Channels Television'],
    Ohafia: ['ZLP', 'Channels Television'],
    'Osisioma Ngwa': ['YPP', 'Channels Television'],
    Ugwunagbo: ['YPP', 'Channels Television'],
    'Ukwa East': ['ZLP', 'Channels Television'],
    'Ukwa West': ['ZLP', 'Channels Television'],
    'Umuahia North': ['ZLP', 'Channels Television'],
    'Umuahia South': ['ZLP', 'Channels Television'],
    'Umu-Nneochi': ['ZLP', 'Channels Television'],
  },
};

const LGA_ALIASES = {
  abia: {
    isialangwanorth: 'isialangwanorth',
    isialangwasouth: 'isialangwasouth',
    obingwa: 'obinwga',
    osisioma: 'osisiomangwa',
  },
  bauchi: {
    akaleri: 'alkaleri',
    itasgada: 'itasgadau',
  },
  bayelsa: {
    kolokumaopokuma: 'kolokumaopokuma',
    yenagoa: 'yenegoa',
  },
  borno: {
    askirauba: 'askirauba',
    kalabalge: 'kalabalge',
  },
  crossriver: {
    calamunicipal: 'calabarmunicipal',
  },
  delta: {
    warrisouthwest: 'warrisouthwest',
  },
  ebonyi: {
    afikposouthedda: 'afikposouth',
  },
  benue: {
    otukpo: 'oturkpo',
  },
  edo: {
    igueben: 'iguegben',
  },
  ekiti: {
    aiyekiregbonyin: 'gbonyin',
  },
  fctabuja: {
    abaji: 'abaji',
    abujamunicipal: 'municipalareacouncil',
    bwari: 'bwari',
    gwagwalada: 'gwagwalada',
    kuje: 'kuje',
    kwali: 'kwali',
  },
  gombe: {
    shongom: 'shomgom',
  },
  imo: {
    ezinihittembaise: 'ezinihitte',
    ihetteuboma: 'ihitteuboma',
    ihettuboma: 'ihitteuboma',
    mbaitoli: 'mbatoli',
    ohajiegbema: 'ohajiegbema',
    unuimo: 'onuimo',
  },
  jigawa: {
    kirikasamma: 'kirikasama',
    mallammadori: 'malammadori',
  },
  kano: {
    garunmallam: 'garunmalam',
    nasarawa: 'nassarawa',
  },
  kebbi: {
    aliero: 'aleiro',
    bagudo: 'bagudu',
    dankowasagu: 'wasagudanko',
  },
  kogi: {
    kabbabunnu: 'kabbabunu',
  },
  kwara: {
    patigi: 'pategi',
  },
  lagos: {
    etiosawest: 'etiosa',
  },
  ogun: {
    sagamu: 'shagamu',
  },
  osun: {
    aiyedade: 'ayedade',
    aiyedire: 'ayedire',
    atakumosaeast: 'atakunmosaeast',
    atakumosawest: 'atakunmosawest',
  },
  oyo: {
    ogbomosonorth: 'ogbomoshonorth',
    ogbomososouth: 'ogbomoshosouth',
    oorelope: 'orelope',
    orire: 'oriire',
  },
  plateau: {
    quanpan: 'quaanpan',
  },
  rivers: {
    emohua: 'emuoha',
    omuma: 'omumma',
  },
  zamfara: {
    birninmagaji: 'birninmagajikiyaw',
    birninmagajikiyaw: 'birninmagajikiyaw',
    kaurannamoda: 'kauranamoda',
    talatanmafara: 'talatamafara',
  },
};

function decodeEntities(value) {
  return value
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([a-f0-9]+);/gi, (_, code) => String.fromCodePoint(parseInt(code, 16)))
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#8211;/g, '-')
    .replace(/&#8217;/g, "'")
    .replace(/&#8220;/g, '"')
    .replace(/&#8221;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

function stripTags(value) {
  return decodeEntities(value.replace(/<[^>]*>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeState(state) {
  if (state === 'Federal Capital Territory') {
    return FCT_STATE_NAME;
  }

  return state.replace(/\s+State$/i, '').trim();
}

function key(value) {
  return decodeEntities(String(value))
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]/gi, '')
    .toLowerCase();
}

function parseChairmen(html) {
  const entries = [];
  const detailsBlocks = html.match(/<details[\s\S]*?<\/details>/g) || [];

  for (const block of detailsBlocks) {
    const stateMatch = block.match(/e-n-accordion-item-title-text">\s*([^<]+?)\s*<\/div>/);
    const tableMatch = block.match(/<table[\s\S]*?<\/table>/);

    if (!stateMatch || !tableMatch) {
      continue;
    }

    const state = normalizeState(stripTags(stateMatch[1]));
    const rowMatches = [...tableMatch[0].matchAll(/<tr>([\s\S]*?)<\/tr>/g)];

    for (const rowMatch of rowMatches.slice(1)) {
      const cells = [...rowMatch[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((cell) =>
        stripTags(cell[1])
      );

      if (cells.length < 2 || !cells[0] || !cells[1] || cells[1] === '-') {
        continue;
      }

      entries.push({
        state,
        sourceLga: cells[0],
        chairman: cells[1],
      });
    }
  }

  return entries;
}

function buildCanonicalLgaMap(lgaPopulation) {
  const byState = new Map();

  for (const row of lgaPopulation) {
    const stateKey = key(row.state);
    const lgaKey = key(row.lga);

    if (!byState.has(stateKey)) {
      byState.set(stateKey, new Map());
    }

    byState.get(stateKey).set(lgaKey, row.lga);
  }

  return byState;
}

function findCanonicalLga(byState, state, sourceLga) {
  const stateKey = key(state);
  const lgaKey = key(sourceLga);
  const stateMap = byState.get(stateKey);

  if (stateKey === 'plateau' && lgaKey === 'barkinladi') {
    return sourceLga;
  }

  if (!stateMap) {
    return null;
  }

  if (stateMap.has(lgaKey)) {
    return stateMap.get(lgaKey);
  }

  const alias = LGA_ALIASES[stateKey]?.[lgaKey];

  if (alias && stateMap.has(alias)) {
    return stateMap.get(alias);
  }

  return null;
}

function resolveParty(state, lga) {
  const override = PARTY_OVERRIDES[state]?.[lga];

  if (override) {
    return {
      party: override[0],
      partySource: override[1],
    };
  }

  const statewide = STATEWIDE_PARTIES[state];

  if (statewide) {
    return {
      party: statewide[0],
      partySource: statewide[1],
    };
  }

  return {};
}

async function main() {
  const [sourceHtml, rawData] = await Promise.all([
    fs.readFile(SOURCE_PATH, 'utf8'),
    fs.readFile(DATA_PATH, 'utf8'),
  ]);
  const data = JSON.parse(rawData);
  const scrapedEntries = parseChairmen(sourceHtml);
  const allEntries = [...scrapedEntries, ...SUPPLEMENTAL_ENTRIES];
  const byState = buildCanonicalLgaMap(data.lgaPopulation);
  const unmatched = [];
  const lgaChairmenByArea = new Map();

  for (const entry of allEntries) {
    const canonicalLga = findCanonicalLga(byState, entry.state, entry.sourceLga);

    if (!canonicalLga) {
      unmatched.push(entry);
      continue;
    }

    const areaKey = `${entry.state}::${canonicalLga}`;
    const partyInfo = resolveParty(entry.state, canonicalLga);
    lgaChairmenByArea.set(areaKey, {
      state: entry.state,
      lga: canonicalLga,
      chairman: entry.chairman,
      sourceLga: entry.sourceLga,
      source: entry.source || 'Democracy Builders LG Directory',
      ...partyInfo,
    });
  }

  const lgaChairmen = [...lgaChairmenByArea.values()];

  data.lgaChairmenSource = {
    name: 'Democracy Builders LG Directory with targeted supplemental public sources',
    url: SOURCE_URL,
    scrapedAt: new Date().toISOString(),
    importedRecords: lgaChairmen.length,
    unmatchedRecords: unmatched.length,
    supplementalSources: [
      'Channels Television',
      'Daily Gazette Nigeria',
      'Nigerian Leaders',
      'Wikipedia',
      'Eti-Osa LGA',
      'Ondo State / The Hope',
      'Independent',
      'INNONEWS',
      'Inside Oyo',
      'Naija News',
      'The Nation',
      'Western Post',
    ],
  };
  data.lgaChairmen = lgaChairmen.sort((a, b) =>
    `${a.state} ${a.lga}`.localeCompare(`${b.state} ${b.lga}`)
  );

  await fs.writeFile(DATA_PATH, `${JSON.stringify(data, null, 2)}\n`);

  console.log(`Scraped records: ${scrapedEntries.length}`);
  console.log(`Supplemental records: ${SUPPLEMENTAL_ENTRIES.length}`);
  console.log(`Imported records: ${lgaChairmen.length}`);
  console.log(`Unmatched records: ${unmatched.length}`);
  if (unmatched.length) {
    console.log(JSON.stringify(unmatched.slice(0, 40), null, 2));
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
