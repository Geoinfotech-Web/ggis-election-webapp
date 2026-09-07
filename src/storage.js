const crypto = require('crypto');
const fs = require('fs/promises');
const path = require('path');

const DEFAULT_ARCHIVE_ROOT = 'D:\\Election Dashboard Data\\source-archive';

function safeSegment(value) {
  return String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 120);
}

function resolveArchivePath(storageKey, root = process.env.SOURCE_ARCHIVE_ROOT || DEFAULT_ARCHIVE_ROOT) {
  const rootPath = path.resolve(root);
  const segments = String(storageKey || '').split(/[\\/]+/).map(safeSegment).filter(Boolean);
  if (!segments.length) throw new Error('A valid storage key is required.');
  const target = path.resolve(rootPath, ...segments);
  const relative = path.relative(rootPath, target);
  if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('Storage key escapes the source archive.');
  return target;
}

async function storeSourceBuffer(storageKey, buffer) {
  const target = resolveArchivePath(storageKey);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, buffer, { flag: 'wx' });
  return {
    storageKey,
    sha256: crypto.createHash('sha256').update(buffer).digest('hex'),
    bytes: buffer.length,
  };
}

async function verifyStoredSource(storageKey, expectedSha256) {
  const target = resolveArchivePath(storageKey);
  const buffer = await fs.readFile(target);
  const actualSha256 = crypto.createHash('sha256').update(buffer).digest('hex');
  if (actualSha256 !== String(expectedSha256 || '').toLowerCase()) {
    throw new Error(`Archived source checksum mismatch for ${storageKey}.`);
  }
  return { storageKey, sha256: actualSha256, bytes: buffer.length };
}

class LocalArchiveStorage {
  async put(storageKey, buffer) {
    return storeSourceBuffer(storageKey, buffer);
  }

  async verify(storageKey, expectedSha256) {
    return verifyStoredSource(storageKey, expectedSha256);
  }
}

class GcsArchiveStorage {
  constructor(bucketName = process.env.GCS_SOURCE_ARCHIVE_BUCKET) {
    this.bucketName = String(bucketName || '').replace(/^gs:\/\//, '').replace(/\/$/, '');
    if (!this.bucketName || this.bucketName.includes('/')) throw new Error('A single GCS source archive bucket is required.');
    const { Storage } = require('@google-cloud/storage');
    this.bucket = new Storage().bucket(this.bucketName);
  }

  objectKey(storageKey) {
    const segments = String(storageKey || '').split(/[\\/]+/).map(safeSegment).filter(Boolean);
    if (!segments.length || segments.some((part) => part === '.' || part === '..')) throw new Error('A valid storage key is required.');
    return segments.join('/');
  }

  async put(storageKey, buffer) {
    const objectKey = this.objectKey(storageKey);
    const sha256 = crypto.createHash('sha256').update(buffer).digest('hex');
    const file = this.bucket.file(objectKey);
    await file.save(buffer, {
      resumable: false,
      preconditionOpts: { ifGenerationMatch: 0 },
      metadata: { metadata: { sha256 } },
    });
    return { storageKey: objectKey, sha256, bytes: buffer.length };
  }

  async verify(storageKey, expectedSha256) {
    const objectKey = this.objectKey(storageKey);
    const [buffer] = await this.bucket.file(objectKey).download();
    const actualSha256 = crypto.createHash('sha256').update(buffer).digest('hex');
    if (actualSha256 !== String(expectedSha256 || '').toLowerCase()) {
      throw new Error(`Archived source checksum mismatch for ${objectKey}.`);
    }
    return { storageKey: objectKey, sha256: actualSha256, bytes: buffer.length };
  }
}

let adapter;
function getStorageAdapter() {
  if (!adapter) adapter = process.env.SOURCE_STORAGE === 'gcs' ? new GcsArchiveStorage() : new LocalArchiveStorage();
  return adapter;
}

async function storeSource(storageKey, buffer) {
  return getStorageAdapter().put(storageKey, buffer);
}

async function verifySource(storageKey, expectedSha256) {
  return getStorageAdapter().verify(storageKey, expectedSha256);
}

module.exports = {
  DEFAULT_ARCHIVE_ROOT, safeSegment, resolveArchivePath, storeSourceBuffer, verifyStoredSource,
  LocalArchiveStorage, GcsArchiveStorage, getStorageAdapter, storeSource, verifySource,
};
