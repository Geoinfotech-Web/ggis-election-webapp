const fs = require('fs');
const path = require('path');
const { google } = require('googleapis');
const { getAuthClient } = require('../auth');

const ROOT_DIR = path.join(__dirname, '..');
const FOLDER_NAME = 'Election Dashboard';

const FILES = [
  ['public/index.html', 'text/html'],
  ['public/admin-login.html', 'text/html'],
  ['public/admin.html', 'text/html'],
  ['public/admin.js', 'application/javascript'],
  ['public/population.html', 'text/html'],
  ['public/styles.css', 'text/css'],
  ['public/population.js', 'application/javascript'],
  ['server.js', 'application/javascript'],
  ['drive.js', 'application/javascript'],
  ['auth.js', 'application/javascript'],
  ['public/data/population-pvc-data.json', 'application/json'],
  ['public/data/lg-directory-source.html', 'text/html'],
  ['scripts/import-lga-chairmen.js', 'application/javascript'],
  ['scripts/download-governor-assets.js', 'application/javascript'],
];

function getMimeType(filePath) {
  const extension = path.extname(filePath).toLowerCase();

  if (extension === '.svg') {
    return 'image/svg+xml';
  }

  if (extension === '.jpg' || extension === '.jpeg') {
    return 'image/jpeg';
  }

  if (extension === '.png') {
    return 'image/png';
  }

  return 'application/octet-stream';
}

async function collectAssetFiles() {
  const assetFolders = ['public/assets/governors', 'public/assets/parties'];
  const files = [];

  for (const folder of assetFolders) {
    const absoluteFolder = path.join(ROOT_DIR, folder);

    if (!fs.existsSync(absoluteFolder)) {
      continue;
    }

    const entries = fs.readdirSync(absoluteFolder, { withFileTypes: true });

    for (const entry of entries) {
      if (!entry.isFile()) {
        continue;
      }

      const relativePath = path.join(folder, entry.name).replaceAll('\\', '/');
      files.push([relativePath, getMimeType(relativePath)]);
    }
  }

  return files;
}

async function getDriveClient() {
  const auth = await getAuthClient();
  return google.drive({ version: 'v3', auth });
}

async function findOrCreateFolder(drive) {
  const response = await drive.files.list({
    q: `name = '${FOLDER_NAME.replace(/'/g, "\\'")}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`,
    fields: 'files(id, name, webViewLink)',
    pageSize: 10,
    supportsAllDrives: true,
    includeItemsFromAllDrives: true,
  });
  const existingFolder = response.data.files?.[0];

  if (existingFolder) {
    return existingFolder;
  }

  const created = await drive.files.create({
    requestBody: {
      name: FOLDER_NAME,
      mimeType: 'application/vnd.google-apps.folder',
    },
    fields: 'id, name, webViewLink',
  });

  return created.data;
}

async function findFileInFolder(drive, folderId, name) {
  const response = await drive.files.list({
    q: `name = '${name.replace(/'/g, "\\'")}' and '${folderId}' in parents and trashed = false`,
    fields: 'files(id, name, webViewLink)',
    pageSize: 1,
    supportsAllDrives: true,
    includeItemsFromAllDrives: true,
  });

  return response.data.files?.[0] || null;
}

async function uploadFile(drive, folderId, relativePath, mimeType) {
  const absolutePath = path.join(ROOT_DIR, relativePath);
  const fileName = relativePath.replaceAll('\\', '/');
  const existingFile = await findFileInFolder(drive, folderId, fileName);
  const media = {
    mimeType,
    body: fs.createReadStream(absolutePath),
  };

  if (existingFile) {
    const updated = await drive.files.update({
      fileId: existingFile.id,
      media,
      requestBody: {
        name: fileName,
      },
      fields: 'id, name, webViewLink',
      supportsAllDrives: true,
    });

    return { action: 'updated', ...updated.data };
  }

  const created = await drive.files.create({
    requestBody: {
      name: fileName,
      parents: [folderId],
    },
    media,
    fields: 'id, name, webViewLink',
    supportsAllDrives: true,
  });

  return { action: 'created', ...created.data };
}

async function main() {
  const drive = await getDriveClient();
  const folder = await findOrCreateFolder(drive);
  const files = [...FILES, ...(await collectAssetFiles())];
  const uploads = [];

  for (const [relativePath, mimeType] of files) {
    uploads.push(await uploadFile(drive, folder.id, relativePath, mimeType));
  }

  console.log(`Folder: ${folder.name}`);
  console.log(`Folder ID: ${folder.id}`);
  console.log(`Folder URL: ${folder.webViewLink || '(link unavailable)'}`);

  for (const upload of uploads) {
    console.log(`${upload.action}: ${upload.name} (${upload.id})`);
  }
}

main().catch((error) => {
  console.error(error.message || error);
  process.exitCode = 1;
});
