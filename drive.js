const path = require('path');
const { google } = require('googleapis');
const Papa = require('papaparse');
const XLSX = require('xlsx');
const JSZip = require('jszip');
const { getAuthClient } = require('./auth');

const MIME_TYPES = {
  googleSheet: 'application/vnd.google-apps.spreadsheet',
  folder: 'application/vnd.google-apps.folder',
  csv: 'text/csv',
  text: 'text/plain',
  excel: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
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

function parseExcel(buffer) {
  const workbook = XLSX.read(buffer, { type: 'buffer' });
  const firstSheetName = workbook.SheetNames[0];

  if (!firstSheetName) {
    return [];
  }

  return XLSX.utils.sheet_to_json(workbook.Sheets[firstSheetName], {
    defval: '',
  });
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

function isXlsxFileName(fileName) {
  return getExtension(fileName) === '.xlsx';
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

async function exportGoogleSheetAsCsv(drive, fileId) {
  const response = await drive.files.export(
    { fileId, mimeType: MIME_TYPES.csv },
    { responseType: 'text' }
  );

  return response.data;
}

async function exportGoogleSheetAsXlsx(drive, fileId) {
  const response = await drive.files.export(
    { fileId, mimeType: MIME_TYPES.excel },
    { responseType: 'arraybuffer' }
  );

  return Buffer.from(response.data);
}

function cleanRow(row) {
  return Object.fromEntries(Object.entries(row).filter(([key]) => !key.startsWith('__EMPTY')));
}

function normalizeStateName(value) {
  return value === 'Federal Capital Territory' ? 'FCT' : value;
}

function getSheetRows(workbook, sheetName) {
  const sheet = workbook.Sheets[sheetName];

  if (!sheet) {
    return [];
  }

  return XLSX.utils.sheet_to_json(sheet, { defval: '' }).map(cleanRow);
}

function parsePopulationWorkbook(buffer) {
  const workbook = XLSX.read(buffer, { type: 'buffer' });
  const statePopulation = getSheetRows(workbook, 'State Population')
    .filter((row) => row.State && row.State !== 'Water body')
    .map((row) => ({
      state: normalizeStateName(row.State),
      population: Number(row.Population) || 0,
      registeredVoters: Number(row.Registered_Voters) || 0,
      collectedPVCs: Number(row.Collected_PVCs) || 0,
      pvcCollectionRate: Number(row['PVC_Collection_%']) || 0,
      uncollectedPVCs: Number(row.Uncollected_PVCs) || 0,
      uncollectedRate: Number(row['Uncollected_%']) || 0,
    }));

  let currentState = '';
  const lgaPopulation = getSheetRows(workbook, 'LGA Population')
    .map((row) => {
      if (row.state) {
        currentState = row.state;
      }

      return {
        state: normalizeStateName(currentState),
        lga: row.local,
        population: Number(row.mean) || 0,
      };
    })
    .filter((row) => row.state && row.lga);

  const governors = getSheetRows(workbook, 'Governors and Party')
    .filter((row) => row.STATE)
    .map((row) => ({
      state: normalizeStateName(row.STATE),
      governor: row["GOVERNOR'S NAME"],
      party: row.PARTY,
      geopoliticalZone: row['GEOPOLITICAL ZONES'],
      partyLogo: row.partyLogo || row.PartyLogo || row.PARTY_LOGO || '',
      photo: row.photo || row.Photo || '',
      photoSource: row.photoSource || row.PhotoSource || '',
    }));

  return {
    generatedAt: new Date().toISOString(),
    statePopulation,
    lgaPopulation,
    governors,
  };
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

    if (isXlsxFileName(fileName)) {
      const buffer = await downloadBuffer(drive, fileId);
      return { type: 'table', data: parseExcel(buffer) };
    }

    if (mimeType === MIME_TYPES.googleSheet) {
      const csvText = await exportGoogleSheetAsCsv(drive, fileId);
      return { type: 'table', data: parseCsv(csvText) };
    }

    if (isMimeOrExtension(mimeType, [MIME_TYPES.csv, MIME_TYPES.text], ['.csv'], fileName)) {
      const buffer = await downloadBuffer(drive, fileId);

      if (mimeType === MIME_TYPES.csv && looksLikeBinaryData(buffer)) {
        console.warn(`File ${fileId} is marked text/csv but looks binary; parsing as xlsx.`);
        return { type: 'table', data: parseExcel(buffer) };
      }

      return { type: 'table', data: parseCsv(buffer.toString('utf8')) };
    }

    if (isMimeOrExtension(mimeType, [MIME_TYPES.excel], ['.xlsx'], fileName)) {
      const buffer = await downloadBuffer(drive, fileId);
      return { type: 'table', data: parseExcel(buffer) };
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

  if (effectiveMimeType === MIME_TYPES.googleSheet) {
    const buffer = await exportGoogleSheetAsXlsx(drive, fileId);
    return parsePopulationWorkbook(buffer);
  }

  if (isXlsxFileName(fileName) || isMimeOrExtension(effectiveMimeType, [MIME_TYPES.excel], ['.xlsx'], fileName)) {
    const buffer = await downloadBuffer(drive, fileId);
    return parsePopulationWorkbook(buffer);
  }

  throw new Error(`Unsupported population source type: ${effectiveMimeType}`);
}

module.exports = {
  getFileMetadata,
  listFilesInFolderTree,
  searchFiles,
  readFile,
  readPopulationData,
};
