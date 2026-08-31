const fs = require('fs/promises');
const path = require('path');
const Papa = require('papaparse');
const { getFileMetadata, searchFiles, readFile } = require('./drive');

const POLLING_UNIT_FILE_CANDIDATES = ['Nigeria_polling_units.csv', 'Nigeria_polling_units'];
const LOCAL_POLLING_UNIT_DATA_PATH = path.join(
  __dirname,
  'public',
  'data',
  'Nigeria_polling_units.csv'
);
const POLLING_POPULATION_LGA_ALIASES = {
  'abia::obingwa': 'Obi Nwga',
  'abia::osisioma': 'Osisioma Ngwa',
  'adamawa::gire1': 'Girei',
  'anambra::ihala': 'Ihiala',
  'bayelsa::yenagoa': 'Yenegoa',
  'benue::otukpo': 'Oturkpo',
  'borno::maidugurimc': 'Maiduguri',
  'crossriver::calabarmunicipality': 'Calabar Municipal',
  'edo::igueben': 'Iguegben',
  'edo::uhunmwode': 'Uhunmwonde',
  'fct::municipal': 'Municipal Area Council',
  'gombe::shongom': 'Shomgom',
  'gombe::yalmaltudeba': 'Yamaltu-Deba',
  'imo::ezinihittembaise': 'Ezinihitte',
  'imo::mbaitoli': 'Mbatoli',
  'jigawa::birniwa': 'Biriniwa',
  'jigawa::kirikasamma': 'Kiri Kasama',
  'kano::danbata': 'Dambatta',
  'kano::dawakikudu': 'Dawakin Kudu',
  'kano::dawakitofa': 'Dawakin Tofa',
  'katsina::malufashi': 'Malumfashi',
  'kebbi::aliero': 'Aleiro',
  'kebbi::arewa': 'Arewa Dandi',
  'kebbi::bagudo': 'Bagudu',
  'kogi::kogikkk': 'Kogi',
  'kogi::mopamoro': 'Mopa-Muro',
  'kogi::ogorimangogo': 'Ogori-Magongo',
  'kwara::patigi': 'Pategi',
  'lagos::somolu': 'Shomolu',
  'nasarawa::nasarawaeggon': 'Nasarawa Egon',
  'niger::edatti': 'Edati',
  'ogun::egbadonorth': 'Yewa North',
  'ogun::egbadosouth': 'Yewa South',
  'ogun::sagamu': 'Shagamu',
  'osun::atakumosaeast': 'Atakunmosa East',
  'osun::atakumosawest': 'Atakunmosa West',
  'osun::ayedaade': 'Ayedade',
  'osun::ilesaeast': 'Ilesha East',
  'osun::ilesawest': 'Ilesha West',
  'oyo::ogbomosonorth': 'Ogbomosho North',
  'oyo::ogbomososouth': 'Ogbomosho South',
  'oyo::oorelope': 'Orelope',
  'plateau::barikinladi': 'Barkin Ladi',
  'rivers::emohua': 'Emuoha',
  'rivers::omuma': 'Omumma',
  'rivers::opobonekoro': 'Opobo-Nkoro',
  'sokoto::sbirni': 'Sabon Birni',
  'yobe::karasawa': 'Karasuwa',
  'zamfara::birninmagaji': 'Birnin Magaji-Kiyaw',
};

let pollingDashboardCache = null;

function clearBlockedLocalProxy() {
  for (const key of ['HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'GIT_HTTP_PROXY', 'GIT_HTTPS_PROXY']) {
    const value = String(process.env[key] || '');
    if (value.includes('127.0.0.1:9')) {
      process.env[key] = '';
    }
  }
}

function sanitizeDriveSearchTerm(value) {
  return String(value || '').replace(/\\/g, '\\\\').replace(/'/g, "\\'").trim();
}

function normalizeStateName(value) {
  const text = String(value || '').trim();
  const stateKey = text.toLowerCase();

  if (!text) {
    return '';
  }

  if (['fct', 'fct, abuja', 'federal capital territory'].includes(stateKey)) {
    return 'FCT';
  }

  return toDisplayCase(text);
}

function normalizeLookupKey(value) {
  return String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]/gi, '')
    .replace(/nassarawa/gi, 'nasarawa')
    .replace(/deltal/gi, 'delta')
    .replace(/nkokwa/gi, 'ndokwa')
    .replace(/municipalarea/gi, 'municipal')
    .toLowerCase();
}

function toDisplayCase(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/(^|[\s/-])([a-z])/g, (match, prefix, letter) => `${prefix}${letter.toUpperCase()}`);
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function safeNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function calculateAccessibilityScore(populationPerPollingUnit) {
  if (!Number.isFinite(populationPerPollingUnit) || populationPerPollingUnit <= 0) {
    return null;
  }

  return Math.round(clamp(100 - (populationPerPollingUnit - 650) / 12, 18, 100));
}

function getAccessibilityBand(populationPerPollingUnit) {
  if (!Number.isFinite(populationPerPollingUnit)) {
    return 'Unrated';
  }

  if (populationPerPollingUnit <= 800) {
    return 'High Access';
  }

  if (populationPerPollingUnit <= 1000) {
    return 'Balanced';
  }

  if (populationPerPollingUnit <= 1300) {
    return 'Moderate Pressure';
  }

  if (populationPerPollingUnit <= 1600) {
    return 'Stretched';
  }

  return 'High Pressure';
}

function buildTopWardList(wardCounts, limit = 5) {
  return [...wardCounts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([ward, pollingUnits]) => ({ ward, pollingUnits }));
}

function getCanonicalPopulationLga(stateKey, lga) {
  const aliasKey = `${stateKey}::${normalizeLookupKey(lga)}`;
  return POLLING_POPULATION_LGA_ALIASES[aliasKey] || lga;
}

async function loadLocalPollingUnitSource() {
  try {
    const [contents, stats] = await Promise.all([
      fs.readFile(LOCAL_POLLING_UNIT_DATA_PATH, 'utf8'),
      fs.stat(LOCAL_POLLING_UNIT_DATA_PATH),
    ]);
    const parsed = Papa.parse(contents, {
      header: true,
      skipEmptyLines: true,
    });

    if (parsed.errors?.length) {
      const message = parsed.errors[0]?.message || 'Unknown CSV parse error';
      throw new Error(`Failed to parse local polling unit CSV: ${message}`);
    }

    return {
      metadata: {
        id: `local:${LOCAL_POLLING_UNIT_DATA_PATH}`,
        name: 'Nigeria_polling_units.csv',
        mimeType: 'text/csv',
        modifiedTime: stats.mtime.toISOString(),
        version: 'local',
        md5Checksum: null,
      },
      rows: parsed.data,
      signature: `local:${stats.mtimeMs}:${stats.size}`,
    };
  } catch (error) {
    if (error && error.code === 'ENOENT') {
      return null;
    }

    throw error;
  }
}

async function resolvePollingUnitsDriveFile() {
  clearBlockedLocalProxy();

  for (const candidateName of POLLING_UNIT_FILE_CANDIDATES) {
    const files = await searchFiles(
      `name = '${sanitizeDriveSearchTerm(candidateName)}' and trashed = false`
    );

    if (files[0]) {
      return files[0];
    }
  }

  const fallbackFiles = await searchFiles(
    "name contains 'Nigeria_polling_units' and trashed = false"
  );

  return fallbackFiles[0] || null;
}

async function loadPopulationData(localPopulationDataPath) {
  const contents = await fs.readFile(localPopulationDataPath, 'utf8');
  return JSON.parse(contents);
}

function createPopulationLookups(populationData) {
  const stateLookup = new Map();
  const lgaLookup = new Map();

  for (const row of populationData.statePopulation || []) {
    const state = normalizeStateName(row.state);
    stateLookup.set(normalizeLookupKey(state), {
      state,
      population: safeNumber(row.population),
      registeredVoters: safeNumber(row.registeredVoters),
      collectedPVCs: safeNumber(row.collectedPVCs),
    });
  }

  for (const row of populationData.lgaPopulation || []) {
    const state = normalizeStateName(row.state);
    lgaLookup.set(
      `${normalizeLookupKey(state)}::${normalizeLookupKey(row.lga)}`,
      {
        state,
        lga: row.lga,
        population: safeNumber(row.population),
      }
    );
  }

  return { stateLookup, lgaLookup };
}

function finalizeLgaMetrics(lgaEntry) {
  lgaEntry.wards = lgaEntry.wardCounts.size;
  lgaEntry.topWards = buildTopWardList(lgaEntry.wardCounts);
  lgaEntry.pollingUnitsPer100k = Number.isFinite(lgaEntry.population) && lgaEntry.population > 0
    ? Number(((lgaEntry.pollingUnits / lgaEntry.population) * 100000).toFixed(1))
    : null;
  lgaEntry.populationPerPollingUnit = Number.isFinite(lgaEntry.population) && lgaEntry.pollingUnits > 0
    ? Number((lgaEntry.population / lgaEntry.pollingUnits).toFixed(1))
    : null;
  lgaEntry.accessibilityScore = calculateAccessibilityScore(lgaEntry.populationPerPollingUnit);
  lgaEntry.accessibilityBand = getAccessibilityBand(lgaEntry.populationPerPollingUnit);
  delete lgaEntry.wardCounts;
  return lgaEntry;
}

function summarizeNationalData(stateRows, lgaRows) {
  const totalPollingUnits = lgaRows.reduce((sum, row) => sum + row.pollingUnits, 0);
  const totalWards = lgaRows.reduce((sum, row) => sum + row.wards, 0);
  const totalPopulation = stateRows.reduce((sum, row) => sum + (row.population || 0), 0);
  const topState = [...stateRows].sort((a, b) => b.pollingUnits - a.pollingUnits)[0] || null;
  const highestPressureLga = [...lgaRows]
    .filter((row) => Number.isFinite(row.populationPerPollingUnit))
    .sort((a, b) => b.populationPerPollingUnit - a.populationPerPollingUnit)[0] || null;

  return {
    totalPollingUnits,
    totalStates: stateRows.length,
    totalLgas: lgaRows.length,
    totalWards,
    totalPopulation: Math.round(totalPopulation),
    avgPollingUnitsPerLga: Number((totalPollingUnits / Math.max(lgaRows.length, 1)).toFixed(1)),
    nationalPollingUnitsPer100k: totalPopulation
      ? Number(((totalPollingUnits / totalPopulation) * 100000).toFixed(1))
      : null,
    nationalPopulationPerPollingUnit: totalPollingUnits
      ? Number((totalPopulation / totalPollingUnits).toFixed(1))
      : null,
    topStateByPollingUnits: topState
      ? { state: topState.state, pollingUnits: topState.pollingUnits }
      : null,
    highestPressureLga: highestPressureLga
      ? {
          state: highestPressureLga.state,
          lga: highestPressureLga.lga,
          populationPerPollingUnit: highestPressureLga.populationPerPollingUnit,
        }
      : null,
  };
}

async function buildPollingUnitDashboardData(localPopulationDataPath) {
  clearBlockedLocalProxy();

  const [populationData, localPollingSource] = await Promise.all([
    loadPopulationData(localPopulationDataPath),
    loadLocalPollingUnitSource(),
  ]);

  let pollingSource = localPollingSource;

  if (!pollingSource) {
    const pollingFile = await resolvePollingUnitsDriveFile();

    if (!pollingFile) {
      throw new Error('Could not find Nigeria_polling_units in local cache or Google Drive.');
    }

    const metadata = await getFileMetadata(pollingFile.id);
    const signature = [metadata.id, metadata.modifiedTime, metadata.version, metadata.md5Checksum]
      .filter(Boolean)
      .join(':');

    if (pollingDashboardCache?.signature === signature) {
      return pollingDashboardCache.data;
    }

    const result = await readFile(pollingFile.id, pollingFile.mimeType);

    if (!result?.data || !Array.isArray(result.data)) {
      throw new Error('Polling unit source could not be read as a table.');
    }

    pollingSource = {
      metadata,
      rows: result.data,
      signature,
    };
  }

  if (pollingDashboardCache?.signature === pollingSource.signature) {
    return pollingDashboardCache.data;
  }

  const rows = pollingSource.rows;
  const metadata = pollingSource.metadata;
  const signature = pollingSource.signature;
  const { stateLookup, lgaLookup } = createPopulationLookups(populationData);
  const lgaMap = new Map();

  for (const row of rows) {
    const rawState = normalizeStateName(row.state);
    const rawLga = toDisplayCase(row.lg);
    const rawWard = toDisplayCase(row.ward);
    const stateKey = normalizeLookupKey(rawState);
    const lgaKey = normalizeLookupKey(rawLga);

    if (!stateKey || !lgaKey) {
      continue;
    }

    const entryKey = `${stateKey}::${lgaKey}`;
    let entry = lgaMap.get(entryKey);

    if (!entry) {
      const populationMatchName = getCanonicalPopulationLga(stateKey, rawLga);
      const populationMatchKey = `${stateKey}::${normalizeLookupKey(populationMatchName)}`;
      const populationMatch = lgaLookup.get(populationMatchKey);
      const statePopulation = stateLookup.get(stateKey);

      entry = {
        state: rawState,
        lga: rawLga,
        pollingUnits: 0,
        wards: 0,
        wardCounts: new Map(),
        population: populationMatch?.population ?? null,
        populationSource: populationMatch ? 'matched' : 'estimated',
        populationMatchName: populationMatch?.lga || populationMatchName,
        statePopulation: statePopulation?.population ?? null,
      };
      lgaMap.set(entryKey, entry);
    }

    entry.pollingUnits += 1;

    if (rawWard) {
      entry.wardCounts.set(rawWard, (entry.wardCounts.get(rawWard) || 0) + 1);
    }
  }

  const stateGroups = new Map();

  for (const lgaEntry of lgaMap.values()) {
    const stateKey = normalizeLookupKey(lgaEntry.state);

    if (!stateGroups.has(stateKey)) {
      const statePopulation = stateLookup.get(stateKey);
      stateGroups.set(stateKey, {
        state: lgaEntry.state,
        population: statePopulation?.population ?? null,
        registeredVoters: statePopulation?.registeredVoters ?? null,
        collectedPVCs: statePopulation?.collectedPVCs ?? null,
        lgas: [],
      });
    }

    stateGroups.get(stateKey).lgas.push(lgaEntry);
  }

  for (const stateGroup of stateGroups.values()) {
    const matchedPopulation = stateGroup.lgas
      .filter((row) => row.populationSource === 'matched' && Number.isFinite(row.population))
      .reduce((sum, row) => sum + row.population, 0);
    const unmatchedRows = stateGroup.lgas.filter((row) => !Number.isFinite(row.population));
    const unmatchedPollingUnits = unmatchedRows.reduce((sum, row) => sum + row.pollingUnits, 0);
    const totalPollingUnits = stateGroup.lgas.reduce((sum, row) => sum + row.pollingUnits, 0);
    const statePopulation = stateGroup.population;

    for (const row of unmatchedRows) {
      if (!Number.isFinite(statePopulation) || !totalPollingUnits) {
        row.population = null;
        row.populationSource = 'missing';
        continue;
      }

      const remainingPopulation = statePopulation - matchedPopulation;
      const canUseRemainingPool =
        Number.isFinite(remainingPopulation) &&
        remainingPopulation > 0 &&
        unmatchedPollingUnits > 0;

      row.population = canUseRemainingPool
        ? Number(((remainingPopulation * row.pollingUnits) / unmatchedPollingUnits).toFixed(1))
        : Number(((statePopulation * row.pollingUnits) / totalPollingUnits).toFixed(1));
      row.populationSource = 'estimated';
    }
  }

  const lgaRows = [...lgaMap.values()]
    .map(finalizeLgaMetrics)
    .sort((a, b) => a.state.localeCompare(b.state) || a.lga.localeCompare(b.lga));

  const stateRows = [...stateGroups.values()]
    .map((group) => {
      const stateLgas = lgaRows.filter((row) => row.state === group.state);
      const totalPollingUnits = stateLgas.reduce((sum, row) => sum + row.pollingUnits, 0);
      const totalWards = stateLgas.reduce((sum, row) => sum + row.wards, 0);
      const topLgaByPollingUnits = [...stateLgas].sort((a, b) => b.pollingUnits - a.pollingUnits)[0] || null;
      const highestPressureLga = [...stateLgas]
        .filter((row) => Number.isFinite(row.populationPerPollingUnit))
        .sort((a, b) => b.populationPerPollingUnit - a.populationPerPollingUnit)[0] || null;
      const populationPerPollingUnit = Number.isFinite(group.population) && totalPollingUnits > 0
        ? Number((group.population / totalPollingUnits).toFixed(1))
        : null;

      return {
        state: group.state,
        pollingUnits: totalPollingUnits,
        wards: totalWards,
        lgas: stateLgas.length,
        population: Number.isFinite(group.population) ? Math.round(group.population) : null,
        registeredVoters: group.registeredVoters,
        collectedPVCs: group.collectedPVCs,
        pollingUnitsPer100k:
          Number.isFinite(group.population) && group.population > 0
            ? Number(((totalPollingUnits / group.population) * 100000).toFixed(1))
            : null,
        populationPerPollingUnit,
        accessibilityScore: calculateAccessibilityScore(populationPerPollingUnit),
        accessibilityBand: getAccessibilityBand(populationPerPollingUnit),
        topLgaByPollingUnits: topLgaByPollingUnits
          ? { lga: topLgaByPollingUnits.lga, pollingUnits: topLgaByPollingUnits.pollingUnits }
          : null,
        highestPressureLga: highestPressureLga
          ? {
              lga: highestPressureLga.lga,
              populationPerPollingUnit: highestPressureLga.populationPerPollingUnit,
            }
          : null,
      };
    })
    .sort((a, b) => a.state.localeCompare(b.state));

  const data = {
    source: {
      id: metadata.id,
      name: metadata.name,
      mimeType: metadata.mimeType,
      modifiedTime: metadata.modifiedTime,
      rowCount: rows.length,
      signature,
    },
    summary: summarizeNationalData(stateRows, lgaRows),
    states: stateRows,
    lgas: lgaRows,
    methodology:
      'Accessibility on this page is based on polling-unit availability relative to local population because the polling-unit source file does not include coordinates.',
  };

  pollingDashboardCache = { signature, data };
  return data;
}

module.exports = {
  buildPollingUnitDashboardData,
  normalizeLookupKey,
};
