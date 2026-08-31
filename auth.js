const fs = require('fs/promises');
const path = require('path');
const readline = require('readline/promises');
const { stdin: input, stdout: output } = require('process');

function disableProxyForGoogleAuth() {
  for (const key of ['HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'http_proxy', 'https_proxy', 'all_proxy']) {
    delete process.env[key];
  }
}

disableProxyForGoogleAuth();

const { google } = require('googleapis');

const SCOPES = ['https://www.googleapis.com/auth/drive'];
const CREDENTIALS_PATH = path.join(__dirname, 'credentials.json');
const TOKEN_PATH = path.join(__dirname, 'token.json');

async function readJson(filePath) {
  const contents = await fs.readFile(filePath, 'utf8');
  return JSON.parse(contents);
}

async function loadOAuthClient() {
  const credentials = await readJson(CREDENTIALS_PATH);
  const config = credentials.installed || credentials.web;

  if (!config) {
    throw new Error('credentials.json must contain either an "installed" or "web" OAuth client.');
  }

  const { client_id, client_secret, redirect_uris } = config;
  const redirectUri = (redirect_uris && redirect_uris[0]) || 'http://localhost';

  if (!client_id || !client_secret) {
    throw new Error('credentials.json is missing client_id or client_secret.');
  }

  return new google.auth.OAuth2(client_id, client_secret, redirectUri);
}

async function loadSavedToken(authClient) {
  try {
    const token = await readJson(TOKEN_PATH);
    authClient.setCredentials(token);
    return true;
  } catch (error) {
    if (error.code === 'ENOENT') {
      return false;
    }

    throw error;
  }
}

function extractCode(value) {
  const trimmedValue = value.trim();

  try {
    const url = new URL(trimmedValue);
    return url.searchParams.get('code') || trimmedValue;
  } catch {
    return trimmedValue;
  }
}

async function requestNewToken(authClient) {
  const authUrl = authClient.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: SCOPES,
  });

  console.log('Authorize this app by visiting this URL:');
  console.log(authUrl);

  const rl = readline.createInterface({ input, output });

  try {
    const answer = await rl.question('Paste the authorization code here: ');
    const code = extractCode(answer);
    const { tokens } = await authClient.getToken(code);

    authClient.setCredentials(tokens);
    await fs.writeFile(TOKEN_PATH, JSON.stringify(tokens, null, 2));
  } finally {
    rl.close();
  }
}

async function getAuthClient() {
  const authClient = await loadOAuthClient();
  const hasSavedToken = await loadSavedToken(authClient);

  if (!hasSavedToken) {
    await requestNewToken(authClient);
  }

  return authClient;
}

module.exports = {
  getAuthClient,
};
// Run if called directly
if (require.main === module) {
  getAuthClient().then(() => console.log('Authentication complete!')).catch(console.error);
}
