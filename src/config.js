const fs = require('fs');

function readSecret(envName, fileEnvName) {
  const direct = String(process.env[envName] || '').trim();
  if (direct) return direct;
  const filePath = String(process.env[fileEnvName] || '').trim();
  if (!filePath) return '';
  return fs.readFileSync(filePath, 'utf8').trim();
}

function getSessionSecret() {
  return readSecret('ADMIN_SESSION_SECRET', 'ADMIN_SESSION_SECRET_FILE') ||
    readSecret('SESSION_SECRET', 'SESSION_SECRET_FILE');
}

function getEditorialDatabaseUrl() {
  const configured = String(process.env.EDITORIAL_DATABASE_URL || process.env.DATABASE_URL || '').trim();
  if (configured) return configured;

  const host = String(process.env.EDITORIAL_DATABASE_HOST || '').trim();
  if (!host) return '';
  const user = String(process.env.EDITORIAL_DATABASE_USER || 'election_app').trim();
  const database = String(process.env.EDITORIAL_DATABASE_NAME || 'election_dashboard').trim();
  const port = String(process.env.EDITORIAL_DATABASE_PORT || '5432').trim();
  const password = readSecret('EDITORIAL_DATABASE_PASSWORD', 'EDITORIAL_DATABASE_PASSWORD_FILE');
  if (!password) return '';
  return `postgresql://${encodeURIComponent(user)}:${encodeURIComponent(password)}@${host}:${port}/${encodeURIComponent(database)}`;
}

module.exports = { getEditorialDatabaseUrl, getSessionSecret, readSecret };
