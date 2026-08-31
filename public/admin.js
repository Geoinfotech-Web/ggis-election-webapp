const adminEmail = document.getElementById('adminEmail');
const sourceSummary = document.getElementById('sourceSummary');
const sourceMode = document.getElementById('sourceMode');
const sourceName = document.getElementById('sourceName');
const sourceFileId = document.getElementById('sourceFileId');
const sourceUpdatedBy = document.getElementById('sourceUpdatedBy');
const sourceUpdatedAt = document.getElementById('sourceUpdatedAt');
const driveSearchForm = document.getElementById('driveSearchForm');
const driveSearchInput = document.getElementById('driveSearchInput');
const driveResults = document.getElementById('driveResults');
const searchMessage = document.getElementById('searchMessage');
const useLocalButton = document.getElementById('useLocalButton');
const refreshDriveFiles = document.getElementById('refreshDriveFiles');
const logoutButton = document.getElementById('logoutButton');

let currentAdmin = null;
let currentSource = null;
const POPULATION_DATA_RECONNECT_KEY = 'populationDataReconnectAt';

async function apiFetch(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(data.error || 'Request failed.');
  }

  return data;
}

function formatDate(value) {
  if (!value) {
    return '--';
  }

  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value));
}

function renderSource(source) {
  currentSource = source;
  const mode = source?.mode || 'local';
  sourceSummary.textContent = mode === 'drive' ? source.name || 'Google Drive file' : 'Local JSON file';
  sourceMode.textContent = mode === 'drive' ? 'Google Drive' : 'Local';
  sourceName.textContent = source?.name || 'Local population-pvc-data.json';
  sourceFileId.textContent = source?.fileId || '--';
  sourceUpdatedBy.textContent = source?.updatedBy || '--';
  sourceUpdatedAt.textContent = formatDate(source?.updatedAt);
}

function signalPopulationDashboardReconnect() {
  localStorage.setItem(POPULATION_DATA_RECONNECT_KEY, Date.now().toString());
}

function renderDriveResults(files) {
  driveResults.innerHTML = '';

  if (!files.length) {
    searchMessage.textContent = 'No supported JSON, Sheet, or Excel files found inside the Election Dashboard folder or its subfolders.';
    return;
  }

  searchMessage.textContent = `${files.length} supported file${files.length === 1 ? '' : 's'} found inside the Election Dashboard folder and subfolders.`;

  for (const file of files) {
    const isCurrentSource = currentSource?.mode === 'drive' && currentSource.fileId === file.id;
    const card = document.createElement('article');
    card.className = 'drive-result-card';
    card.classList.toggle('is-active-source', isCurrentSource);

    const details = document.createElement('div');
    const name = document.createElement('strong');
    const meta = document.createElement('span');
    const path = document.createElement('span');
    const badge = document.createElement('small');
    name.textContent = file.name;
    meta.textContent = file.mimeType;
    path.textContent = file.folderPath ? `Folder: ${file.folderPath}` : '';
    path.hidden = !file.folderPath;
    badge.textContent = 'Current Source';
    badge.className = 'source-badge';
    badge.hidden = !isCurrentSource;
    details.append(name, meta, path, badge);

    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = isCurrentSource ? 'Update Again' : 'Use This File';
    button.addEventListener('click', () => saveDriveSource(file, button));

    card.append(details, button);
    driveResults.append(card);
  }
}

async function saveDriveSource(file, button) {
  const originalText = button.textContent;
  button.disabled = true;
  button.textContent = 'Validating...';
  searchMessage.textContent = 'Checking that this file matches the dashboard data format.';

  try {
    const source = await apiFetch('/api/admin/population-source', {
      method: 'POST',
      body: JSON.stringify({
        mode: 'drive',
        fileId: file.id,
        mimeType: file.mimeType,
      }),
    });
    renderSource(source);
    signalPopulationDashboardReconnect();
    await loadDriveFiles();
    searchMessage.textContent = 'Population dashboard data source updated.';
  } catch (error) {
    searchMessage.textContent = error.message;
  } finally {
    button.disabled = false;
    button.textContent = originalText;
  }
}

async function loadAdmin() {
  currentAdmin = await apiFetch('/api/admin/me');
  adminEmail.textContent = 'Authenticated admin';
}

async function loadSource() {
  const source = await apiFetch('/api/admin/population-source');
  renderSource(source);
}

async function loadDriveFiles() {
  searchMessage.textContent = 'Loading supported files from the Election Dashboard folder and subfolders...';
  driveResults.innerHTML = '';

  try {
    const files = await apiFetch('/api/admin/drive/files');
    renderDriveResults(files);
  } catch (error) {
    searchMessage.textContent = error.message;
  }
}

driveSearchForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const searchTerm = driveSearchInput.value.trim();

  if (!searchTerm) {
    await loadDriveFiles();
    return;
  }

  try {
    searchMessage.textContent = 'Searching Google Drive...';
    driveResults.innerHTML = '';
    const files = await apiFetch(`/api/admin/drive/search?q=${encodeURIComponent(driveSearchInput.value)}`);
    renderDriveResults(files);
  } catch (error) {
    searchMessage.textContent = error.message;
  }
});

refreshDriveFiles.addEventListener('click', loadDriveFiles);

useLocalButton.addEventListener('click', async () => {
  searchMessage.textContent = 'Switching back to local JSON data...';

  try {
    const source = await apiFetch('/api/admin/population-source', {
      method: 'POST',
      body: JSON.stringify({ mode: 'local' }),
    });
    renderSource(source);
    signalPopulationDashboardReconnect();
    await loadDriveFiles();
    searchMessage.textContent = 'Dashboard is using the local JSON data again.';
  } catch (error) {
    searchMessage.textContent = error.message;
  }
});

logoutButton.addEventListener('click', async () => {
  await apiFetch('/auth/logout', { method: 'POST' });
  window.location.href = 'admin-login.html';
});

loadAdmin()
  .then(loadSource)
  .then(loadDriveFiles)
  .catch(() => {
    window.location.href = 'admin-login.html';
  });
