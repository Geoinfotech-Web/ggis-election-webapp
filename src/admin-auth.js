const crypto = require('crypto');
const fs = require('fs/promises');
const path = require('path');
const { promisify } = require('util');

const scryptAsync = promisify(crypto.scrypt);

const CREDENTIALS_PATH = path.join(__dirname, '..', 'data', 'admin-credentials.json');
const ACCESS_PATH = path.join(__dirname, '..', 'admin-access.json');
const SCRYPT_KEYLEN = 64;
const SCRYPT_OPTIONS = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
const MAX_PASSWORD_LENGTH = 200;

/** In-memory bootstrap users when the credentials file cannot be written (e.g. read-only container root). */
let memoryUsers = null;
const memoryAllowList = new Set();

function normalizeUsername(value) {
  return String(value || '').trim().toLowerCase();
}

function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase();
}

function hashToStored(salt, derived) {
  return `scrypt$${salt.toString('base64url')}$${derived.toString('base64url')}`;
}

async function hashPassword(password) {
  const plain = String(password || '');
  if (!plain || plain.length > MAX_PASSWORD_LENGTH) {
    throw new Error('Password must be between 1 and 200 characters.');
  }
  const salt = crypto.randomBytes(16);
  const derived = await scryptAsync(plain, salt, SCRYPT_KEYLEN, SCRYPT_OPTIONS);
  return hashToStored(salt, derived);
}

async function verifyPassword(password, storedHash) {
  const plain = String(password || '');
  const stored = String(storedHash || '');
  if (!plain || plain.length > MAX_PASSWORD_LENGTH || !stored.startsWith('scrypt$')) {
    return false;
  }

  const parts = stored.split('$');
  if (parts.length !== 3) return false;

  try {
    const salt = Buffer.from(parts[1], 'base64url');
    const expected = Buffer.from(parts[2], 'base64url');
    const derived = await scryptAsync(plain, salt, expected.length, SCRYPT_OPTIONS);
    return expected.length === derived.length && crypto.timingSafeEqual(expected, derived);
  } catch {
    return false;
  }
}

async function readJsonFile(filePath, fallback) {
  try {
    return JSON.parse(await fs.readFile(filePath, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return fallback;
    throw error;
  }
}

async function writeJsonFile(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function envBootstrapAvailable() {
  const email = normalizeEmail(process.env.PRIMARY_ADMIN_EMAIL || process.env.ADMIN_EMAIL || '');
  const passwordHash = String(process.env.ADMIN_PASSWORD_HASH || '').trim();
  const password = process.env.ADMIN_PASSWORD;
  return Boolean(email && (passwordHash || password));
}

async function isLocalAdminConfigured() {
  if (memoryUsers?.length) return true;
  const file = await readJsonFile(CREDENTIALS_PATH, { users: [] });
  const users = (Array.isArray(file.users) ? file.users : []).map(sanitizeUser).filter(Boolean);
  if (users.length) return true;
  // Also accept legacy repo-root credentials file if present.
  const legacy = await readJsonFile(path.join(__dirname, '..', 'admin-credentials.json'), { users: [] });
  const legacyUsers = (Array.isArray(legacy.users) ? legacy.users : []).map(sanitizeUser).filter(Boolean);
  if (legacyUsers.length) return true;
  return envBootstrapAvailable();
}

function sanitizeUser(raw) {
  const username = normalizeUsername(raw.username);
  const email = normalizeEmail(raw.email);
  const passwordHash = String(raw.passwordHash || '').trim();
  if (!username || !email || !passwordHash) return null;
  return {
    username,
    email,
    name: String(raw.name || username).trim() || username,
    passwordHash,
  };
}

async function ensureEmailOnAllowList(email) {
  const normalized = normalizeEmail(email);
  if (!normalized) return;
  memoryAllowList.add(normalized);
  const access = await readJsonFile(ACCESS_PATH, { admins: [] });
  const admins = new Set(
    (Array.isArray(access.admins) ? access.admins : [])
      .map((entry) => normalizeEmail(entry))
      .filter(Boolean)
  );
  if (admins.has(normalized)) return;
  admins.add(normalized);
  try {
    await writeJsonFile(ACCESS_PATH, { admins: [...admins].sort() });
  } catch (error) {
    console.warn('Unable to persist admin-access.json:', error.message || error);
  }
}

async function isEmailAllowListed(email) {
  const normalized = normalizeEmail(email);
  if (!normalized) return false;
  if (memoryAllowList.has(normalized)) return true;
  const access = await readJsonFile(ACCESS_PATH, { admins: [] });
  const admins = (Array.isArray(access.admins) ? access.admins : [])
    .map((entry) => normalizeEmail(entry))
    .filter(Boolean);
  return admins.includes(normalized);
}

async function bootstrapFromEnv() {
  if (memoryUsers?.length) return memoryUsers;

  const username = normalizeUsername(process.env.ADMIN_USERNAME || 'admin');
  const email = normalizeEmail(process.env.PRIMARY_ADMIN_EMAIL || process.env.ADMIN_EMAIL || '');
  const passwordHashEnv = String(process.env.ADMIN_PASSWORD_HASH || '').trim();
  const password = process.env.ADMIN_PASSWORD;

  if (!email) return [];

  let passwordHash = passwordHashEnv;
  if (!passwordHash && password) {
    passwordHash = await hashPassword(password);
  }
  if (!passwordHash) return [];

  const users = [
    {
      username,
      email,
      name: String(process.env.ADMIN_NAME || 'Primary Admin').trim() || 'Primary Admin',
      passwordHash,
    },
  ];

  memoryUsers = users;

  // Persist hash when possible so plaintext ADMIN_PASSWORD can be removed after first boot.
  if (!passwordHashEnv && password) {
    try {
      await writeJsonFile(CREDENTIALS_PATH, { users });
    } catch (error) {
      console.warn('Unable to persist admin-credentials.json:', error.message || error);
    }
  }

  try {
    await ensureEmailOnAllowList(email);
  } catch (error) {
    console.warn('Unable to update admin allow-list:', error.message || error);
    memoryAllowList.add(email);
  }

  return users;
}

async function listCredentialUsers() {
  if (memoryUsers?.length) return memoryUsers;

  const file = await readJsonFile(CREDENTIALS_PATH, { users: [] });
  let users = (Array.isArray(file.users) ? file.users : []).map(sanitizeUser).filter(Boolean);
  if (!users.length) {
    const legacy = await readJsonFile(path.join(__dirname, '..', 'admin-credentials.json'), { users: [] });
    users = (Array.isArray(legacy.users) ? legacy.users : []).map(sanitizeUser).filter(Boolean);
  }
  if (users.length) return users;
  return bootstrapFromEnv();
}

async function findUserByUsername(username) {
  const needle = normalizeUsername(username);
  if (!needle) return null;
  const users = await listCredentialUsers();
  return users.find((user) => user.username === needle) || null;
}

let dummyHashPromise;

function getDummyHash() {
  if (!dummyHashPromise) {
    dummyHashPromise = hashPassword('timing-pad-not-a-real-password');
  }
  return dummyHashPromise;
}

async function refreshStoredPassword(user, password) {
  const passwordHash = await hashPassword(password);
  const next = { ...user, passwordHash };
  memoryUsers = [next];
  try {
    await writeJsonFile(CREDENTIALS_PATH, { users: [next] });
  } catch (error) {
    console.warn('Unable to refresh admin-credentials.json:', error.message || error);
  }
  return next;
}

async function authenticateLocalAdmin(username, password) {
  const user = await findUserByUsername(username);
  let ok = await verifyPassword(password, user ? user.passwordHash : await getDummyHash());

  // If a stale hashed credentials file no longer matches ADMIN_PASSWORD, allow the
  // configured env password for the bootstrap username and refresh the stored hash.
  if (!ok && user) {
    const envUser = normalizeUsername(process.env.ADMIN_USERNAME || 'admin');
    const envPass = process.env.ADMIN_PASSWORD;
    if (envPass && user.username === envUser && String(password) === String(envPass)) {
      await refreshStoredPassword(user, password);
      ok = true;
    }
  }

  if (!user || !ok) return null;
  return {
    username: user.username,
    email: user.email,
    name: user.name,
  };
}

module.exports = {
  CREDENTIALS_PATH,
  hashPassword,
  verifyPassword,
  listCredentialUsers,
  findUserByUsername,
  authenticateLocalAdmin,
  isLocalAdminConfigured,
  ensureEmailOnAllowList,
  isEmailAllowListed,
  normalizeUsername,
  normalizeEmail,
  MAX_PASSWORD_LENGTH,
};
