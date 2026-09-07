const path = require('path');
const { google } = require('googleapis');
const Papa = require('papaparse');
const JSZip = require('jszip');
const { getAuthClient } = require('./auth');

const MIME_TYPES = {
  folder: 'application/vnd.google-apps.folder',
  csv: 'text/csv',
  text: 'text/plain',
  kml: 'application/vnd.google-earth.kml+xml',
  kmz: 'application/vnd.google-earth.kmz',
  jpeg: 'image/jpeg',
  tiff: 'image/tiff',
};

async function getDriveClient() {
  const auth = await getAuthClient();
  return google.drive({ version: 'v3', auth });
}

function parseCsv(csvText) {
  const parsed = Papa.parse(csvText, {
    header: true,
    skipEmptyLines: true,
  });

  if (parsed.errors.length > 0) {
    console.warn('CSV parse warnings:', parsed.errors);
  }

  return parsed.data;
}

function parsePopulationCsv(csvText) {
  const rows = parseCsv(csvText);
  const statePopulation = [];
  const lgaPopulation = [];
  const governors = [];
  for (const row of rows) {
    const recordType = String(row.recordType || row.record_type || '').trim().toLowerCase();
    if (recordType === 'state') {
      statePopulation.push({
        state: row.state,
        population: Number(row.population) || 0,
        registeredVoters: Number(row.registeredVoters || row.registered_voters) || 0,
        collectedPVCs: Number(row.collectedPVCs || row.collected_pvcs) || 0,
        pvcCollectionRate: Number(row.pvcCollectionRate || row.pvc_collection_rate) || 0,
        uncollectedPVCs: Number(row.uncollectedPVCs || row.uncollected_pvcs) || 0,
        uncollectedRate: Number(row.uncollectedRate || row.uncollected_rate) || 0,
      });
    } else if (recordType === 'lga') {
      lgaPopulation.push({ state: row.state, lga: row.lga, population: Number(row.population) || 0 });
    } else if (recordType === 'governor') {
      governors.push({ state: row.state, governor: row.governor, party: row.party, geopoliticalZone: row.geopoliticalZone || row.geopolitical_zone || '' });
    }
  }
  if (!statePopulation.length || !lgaPopulation.length) {
    throw new Error('Population CSV must contain state and lga recordType rows.');
  }
  return { generatedAt: new Date().toISOString(), statePopulation, lgaPopulation, governors };
}

function getExtension(value) {
  const cleanInput = value || '';
  const cleanValue = cleanInput.split('?')[0].split('#')[0];
  return path.extname(cleanValue).toLowerCase();
}

function looksLikeBinaryData(buffer) {
  if (!buffer || buffer.length === 0) {
    return false;
  }

  if (buffer.subarray(0, 2).toString('utf8') === 'PK') {
    return true;
  }

  const sample = buffer.subarray(0, Math.min(buffer.length, 1024));
  return sample.includes(0);
}

function isMimeOrExtension(mimeType, acceptedMimeTypes, acceptedExtensions = [], fileName = '') {
  const extension = getExtension(fileName || mimeType);
  return acceptedMimeTypes.includes(mimeType) || acceptedExtensions.includes(extension);
}

async function getFileName(drive, fileId) {
  const response = await drive.files.get({
    fileId,
    fields: 'name',
    supportsAllDrives: true,
  });

  return response.data.name || '';
}

async function downloadText(drive, fileId) {
  const response = await drive.files.get(
    { fileId, alt: 'media' },
    { responseType: 'text' }
  );

  return response.data;
}

async function downloadBuffer(drive, fileId) {
  const response = await drive.files.get(
    { fileId, alt: 'media' },
    { responseType: 'arraybuffer' }
  );

  return Buffer.from(response.data);
}

async function downloadJson(drive, fileId) {
  const text = await downloadText(drive, fileId);
  return JSON.parse(text);
}

async function extractKmlFromKmz(buffer) {
  const zip = await JSZip.loadAsync(buffer);
  const kmlFileName = Object.keys(zip.files).find((fileName) =>
    fileName.toLowerCase().endsWith('.kml')
  );

  if (!kmlFileName) {
    throw new Error('No .kml file found inside KMZ archive.');
  }

  return zip.files[kmlFileName].async('string');
}

async function searchFiles(query, folderId) {
  try {
    const drive = await getDriveClient();
    const driveQuery = folderId ? `(${query}) and '${folderId}' in parents` : query;
    const files = [];
    let pageToken = '';

    do {
      const response = await drive.files.list({
        q: driveQuery,
        fields: 'nextPageToken, files(id, name, mimeType)',
        pageSize: 100,
        pageToken: pageToken || undefined,
        supportsAllDrives: true,
        includeItemsFromAllDrives: true,
      });
      files.push(...(response.data.files || []));
      pageToken = response.data.nextPageToken || '';
    } while (pageToken);

    return files;
  } catch (error) {
    console.error('Error searching Google Drive files:', error.message || error);
    return [];
  }
}

async function listFolderChildren(folderId) {
  const drive = await getDriveClient();
  const files = [];
  let pageToken = '';

  do {
    const response = await drive.files.list({
      q: `'${folderId}' in parents and trashed = false`,
      fields: 'nextPageToken, files(id, name, mimeType)',
      pageSize: 100,
      pageToken: pageToken || undefined,
      supportsAllDrives: true,
      includeItemsFromAllDrives: true,
    });
    files.push(...(response.data.files || []));
    pageToken = response.data.nextPageToken || '';
  } while (pageToken);

  return files;
}

async function listFilesInFolderTree(rootFolder, options = {}) {
  const includeFolders = Boolean(options.includeFolders);
  const queue = [
    {
      id: rootFolder.id,
      path: rootFolder.name,
    },
  ];
  const files = [];

  while (queue.length) {
    const folder = queue.shift();
    const children = await listFolderChildren(folder.id);

    for (const child of children) {
      const folderPath = folder.path;
      const fullPath = `${folderPath}/${child.name}`;

      if (child.mimeType === MIME_TYPES.folder) {
        if (includeFolders) {
          files.push({ ...child, folderPath, path: fullPath });
        }

        queue.push({
          id: child.id,
          path: fullPath,
        });
        continue;
      }

      files.push({ ...child, folderPath, path: fullPath });
    }
  }

  return files;
}

async function getFileMetadata(fileId) {
  const drive = await getDriveClient();
  const response = await drive.files.get({
    fileId,
    fields: 'id, name, mimeType, modifiedTime, version, md5Checksum',
    supportsAllDrives: true,
  });

  return response.data;
}

async function readFile(fileId, mimeType) {
  try {
    const drive = await getDriveClient();
    const fileName = await getFileName(drive, fileId);

    if (isMimeOrExtension(mimeType, [MIME_TYPES.csv, MIME_TYPES.text], ['.csv'], fileName)) {
      const buffer = await downloadBuffer(drive, fileId);

      if (looksLikeBinaryData(buffer)) throw new Error('Binary spreadsheet data is not accepted. Export it as normalized CSV.');

      return { type: 'table', data: parseCsv(buffer.toString('utf8')) };
    }

    if (isMimeOrExtension(mimeType, [MIME_TYPES.kml], ['.kml'], fileName)) {
      const kmlText = await downloadText(drive, fileId);
      return { type: 'kml', data: kmlText };
    }

    if (isMimeOrExtension(mimeType, [MIME_TYPES.kmz], ['.kmz'], fileName)) {
      const buffer = await downloadBuffer(drive, fileId);
      const kmlText = await extractKmlFromKmz(buffer);
      return { type: 'kml', data: kmlText };
    }

    if (mimeType === MIME_TYPES.jpeg) {
      const buffer = await downloadBuffer(drive, fileId);
      return { type: 'image', data: `data:image/jpeg;base64,${buffer.toString('base64')}` };
    }

    if (mimeType === MIME_TYPES.tiff) {
      const buffer = await downloadBuffer(drive, fileId);
      return { type: 'image', data: `data:image/tiff;base64,${buffer.toString('base64')}` };
    }

    throw new Error(`Unsupported file type: ${mimeType}`);
  } catch (error) {
    console.error(`Error reading Google Drive file ${fileId}:`, error.message || error);
    return null;
  }
}

async function readPopulationData(fileId, mimeType) {
  const drive = await getDriveClient();
  const metadata = await getFileMetadata(fileId);
  const effectiveMimeType = mimeType || metadata.mimeType;
  const fileName = metadata.name || '';

  if (effectiveMimeType === 'application/json' || isMimeOrExtension(effectiveMimeType, [], ['.json'], fileName)) {
    return downloadJson(drive, fileId);
  }

  if (isMimeOrExtension(effectiveMimeType, [MIME_TYPES.csv, MIME_TYPES.text], ['.csv'], fileName)) {
    return parsePopulationCsv(await downloadText(drive, fileId));
  }

  throw new Error(`Unsupported population source type: ${effectiveMimeType}. Use normalized JSON.`);
}

module.exports = {
  getFileMetadata,
  listFilesInFolderTree,
  searchFiles,
  readFile,
  readPopulationData,
};
