/* ── Map initialisation ─────────────────────────────────────────────────── */
const map = L.map('pollingUnitsMap', {
  zoomControl: true,
  attributionControl: true,
  maxBoundsViscosity: 0.9,
  preferCanvas: true,
}).setView([9.06, 8.67], 6);

const pollingPointsPaneName = 'pollingPointsPane';

const TILE_ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors ' +
  '&copy; <a href="https://carto.com/attributions">CARTO</a>';
const GOOGLE_SATELLITE_ATTRIBUTION =
  'Map data &copy; <a href="https://www.google.com/help/terms_maps/">Google</a>';

const TILE_URLS = {
  dark:  'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
  light: 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png',
  satellite: 'https://{s}.google.com/vt/lyrs=s&x={x}&y={y}&z={z}',
};

let mapTheme = 'dark';
const baseMapLayers = {
  dark: L.tileLayer(TILE_URLS.dark, { maxZoom: 19, subdomains: 'abcd', attribution: TILE_ATTRIBUTION }),
  light: L.tileLayer(TILE_URLS.light, { maxZoom: 19, subdomains: 'abcd', attribution: TILE_ATTRIBUTION }),
  satellite: L.tileLayer(TILE_URLS.satellite, { maxZoom: 20, subdomains: ['mt0', 'mt1', 'mt2', 'mt3'], attribution: GOOGLE_SATELLITE_ATTRIBUTION }),
};
let currentTileLayer = baseMapLayers.dark.addTo(map);
L.control.layers({
  'Dark Map': baseMapLayers.dark,
  'Light Map': baseMapLayers.light,
  'Google Satellite': baseMapLayers.satellite,
}, null, { position: 'topright' }).addTo(map);
const initialMapMinZoom = map.getMinZoom();

/* ── DOM refs ───────────────────────────────────────────────────────────── */
const stateSelect        = document.getElementById('pollingStateSelect');
const lgaSelect          = document.getElementById('pollingLgaSelect');
const metricSelect       = document.getElementById('pollingMetricSelect');
const searchInput        = document.getElementById('pollingSearchInput');
const searchButton       = document.getElementById('pollingSearchButton');
const searchMessage      = document.getElementById('pollingSearchMessage');
const pollingAreaLabel   = document.getElementById('pollingAreaLabel');
const pollingAreaName    = document.getElementById('pollingAreaName');
const pollingUnitsValue  = document.getElementById('pollingUnitsValue');
const pollingWardsValue  = document.getElementById('pollingWardsValue');
const pollingPopulationLoadValue     = document.getElementById('pollingPopulationLoadValue');
const pollingBandValue   = document.getElementById('pollingBandValue');
const pollingTopAreaValue= document.getElementById('pollingTopAreaValue');
const pollingSourceSummary = document.getElementById('pollingSourceSummary');
const pollingSourceName  = document.getElementById('pollingSourceName');
const pollingRowCount    = document.getElementById('pollingRowCount');
const pollingUpdatedAt   = document.getElementById('pollingUpdatedAt');
const pollingMethodology = document.getElementById('pollingMethodology');
const wardAnalysisStatus = document.getElementById('wardAnalysisStatus');
const wardAnalysisMatched = document.getElementById('wardAnalysisMatched');
const wardAnalysisUnmatched = document.getElementById('wardAnalysisUnmatched');
const pollingChartTitle  = document.getElementById('pollingChartTitle');
const panelResizer       = document.getElementById('pollingPanelResizer');
const populationGrid     = document.querySelector('.population-grid');
const wardStatusEl       = document.getElementById('wardStatus');
const wardStatusText     = document.getElementById('wardStatusText');
const userDistanceCard    = document.getElementById('userDistanceCard');
const userDistanceValue   = document.getElementById('userDistanceValue');
const pollingLegendTitle  = document.getElementById('pollingLegendTitle');
const pollingLegendItems  = document.getElementById('pollingLegendItems');
const pollingLegendNote   = document.getElementById('pollingLegendNote');
const pollingGuideModal   = document.getElementById('pollingGuideModal');
const pollingGuideClose   = document.getElementById('pollingGuideClose');
const pollingReportCard   = document.getElementById('pollingReportCard');
const viewReportButton    = document.getElementById('viewReportButton');
const reportModal         = document.getElementById('reportModal');
const reportModalClose    = document.getElementById('reportModalClose');
const reportModalBackdrop = document.getElementById('reportModalBackdrop');

let lgaData = null;
let lgaBoundaryLayer = null;
let pollingViewMode = 'lgaSearch';
const reportTitle         = document.getElementById('reportTitle');
const reportAreaName      = document.getElementById('reportAreaName');
const reportPuCount       = document.getElementById('reportPuCount');
const reportClosest       = document.getElementById('reportClosest');
const reportFarthest      = document.getElementById('reportFarthest');
const reportClosestValue  = document.getElementById('reportClosestValue');
const reportClosestMeta   = document.getElementById('reportClosestMeta');
const reportFarthestValue = document.getElementById('reportFarthestValue');
const reportFarthestMeta  = document.getElementById('reportFarthestMeta');
const reportSummaryAHeader = document.getElementById('reportSummaryAHeader');
const reportSummaryBHeader = document.getElementById('reportSummaryBHeader');
const reportHighlightAHeader = document.getElementById('reportHighlightAHeader');
const reportHighlightBHeader = document.getElementById('reportHighlightBHeader');
const reportListTitle      = document.getElementById('reportListTitle');
const reportSuggestions   = document.getElementById('reportSuggestions');
const reportUnitsList     = document.getElementById('reportUnitsList');
const downloadReportButton = document.getElementById('downloadReportButton');
const downloadPdfReportButton = document.getElementById('downloadPdfReportButton');

const pollingMetricSelect = metricSelect;

/* Layer toggle checkboxes */
const toggleStates       = document.getElementById('toggleStates');
const toggleLGAs         = document.getElementById('toggleLGAs');
const toggleWards        = document.getElementById('toggleWards');
const togglePollingUnits = document.getElementById('togglePollingUnits');
const toggleUserLocation = document.getElementById('toggleUserLocation');

/* ── State ──────────────────────────────────────────────────────────────── */
let adm0Data = null;
let adm1Data = null;   // state boundaries
let adm2Data = null;   // LGA boundaries
let wardData = null;   // ward boundaries (adm3 — optional)
let pollingData = null;
let nigeriaBounds = null;
let pollingChart = null;

/* Map layer handles */
let stateLayer           = null;
let lgaAdminLayer        = null;   // LGA administrative layer
let wardLayer            = null;
let pollingUnitPointsLayer   = null;
let userLocationLayer    = null;
let highlightLayer       = null;

/* Polling points (loaded once as static GeoJSON, like a shapefile) */
let allPollingUnitFeatures = [];   // all GeoJSON features from the server
let loadedPoints = [];             // flat array of properties for nearest-route calc
let loadedPollingPointAreaKey = '';
let pollingPointRequestKey = '';

/* User geolocation */
let userLatLng = null;
let watchId    = null;

/* ── Metrics ────────────────────────────────────────────────────────────── */
const METRICS = {
  pollingUnits: {
    title: 'Polling Units',
    getValue: (row) => row?.pollingUnits ?? null,
    reverse: false,
    format: (v) => formatNumber(v, 0),
    note: 'Higher values show more polling units in the area.',
  },
  populationPerPollingUnit: {
    title: 'Population per Polling Unit',
    getValue: (row) => row?.populationPerPollingUnit ?? null,
    reverse: true,
    format: (v) => formatNumber(v, 1),
    note: 'Lower values suggest easier access — each unit serves fewer people.',
  },
  accessibilityScore: {
    title: 'Accessibility Score',
    getValue: (row) => row?.accessibilityScore ?? null,
    reverse: false,
    format: (v) => formatNumber(v, 0),
    note: 'Higher scores combine polling-unit count and population service pressure.',
  },
};

/* ── Helpers ────────────────────────────────────────────────────────────── */
function normalizeStateName(value) {
  const text = String(value || '').trim();
  const key  = text.toLowerCase();
  if (['fct', 'fct, abuja', 'federal capital territory'].includes(key)) return 'FCT';
  return toDisplayCase(text);
}

function toDisplayCase(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/(^|[\s/-])([a-z])/g, (_, p, l) => `${p}${l.toUpperCase()}`);
}

function normalizeLookupKey(value) {
  return String(value || '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]/gi, '')
    .replace(/nassarawa/gi, 'nasarawa')
    .replace(/deltal/gi, 'delta')
    .toLowerCase();
}

function formatNumber(value, maximumFractionDigits = 0) {
  if (value === null || value === undefined || value === '') return '--';
  return Number(value).toLocaleString(undefined, { maximumFractionDigits });
}

function formatDate(value) {
  if (!value) return '--';
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
}

function formatDistance(metres) {
  if (!Number.isFinite(metres)) return '--';
  return metres < 1000
    ? `${Math.round(metres)} m`
    : `${(metres / 1000).toFixed(1)} km`;
}

function clamp(v, min, max) { return Math.min(Math.max(v, min), max); }

function getCurrentMetric() {
  return METRICS[metricSelect.value] || METRICS.pollingUnits;
}

function getFeatureStateName(feature) {
  return normalizeStateName(feature.properties.NAME_1 || feature.properties.NAME_0 || 'Nigeria');
}

function getFeatureLgaCandidates(feature) {
  return [feature.properties.NAME_2, feature.properties.VARNAME_2, feature.properties.NL_NAME_2]
    .flatMap((v) => String(v || '').split('|'))
    .map((v) => v.trim())
    .filter(Boolean);
}

function getStateRow(state) {
  return (pollingData?.states || []).find(
    (r) => normalizeLookupKey(r.state) === normalizeLookupKey(state)
  );
}

function getStateFeatures() {
  return (adm1Data?.features || []).filter((f) => getFeatureStateName(f) !== 'Water Body');
}

function setSearchMessage(msg) { searchMessage.textContent = msg; }

function showPollingGuide() {
  if (!pollingGuideModal) return;
  const dismissed = localStorage.getItem('pollingGuideDismissed') === 'true';
  if (dismissed) {
    pollingGuideModal.classList.add('is-hidden');
    return;
  }
  pollingGuideModal.classList.remove('is-hidden');
}

function dismissPollingGuide() {
  if (!pollingGuideModal) return;
  localStorage.setItem('pollingGuideDismissed', 'true');
  pollingGuideModal.classList.add('is-hidden');
}

if (pollingGuideClose) {
  pollingGuideClose.addEventListener('click', dismissPollingGuide);
}

if (pollingGuideModal) {
  pollingGuideModal.addEventListener('click', (event) => {
    if (event.target === pollingGuideModal) dismissPollingGuide();
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !pollingGuideModal.classList.contains('is-hidden')) {
      dismissPollingGuide();
    }
  });
}

/* ── Accessibility colours ──────────────────────────────────────────────── */
function getAccessibilityColor(band) {
  if (band === 'Broadly Accessible')  return '#22b573';
  if (band === 'Watch Pressure')      return '#f0c95b';
  if (band === 'Needs More Coverage') return '#f25c54';
  return '#63737b';
}

const COLOR_PALETTES = {
  accessibility: {
    'Broadly Accessible': '#2a9d8f',
    'Watch Pressure': '#e9c46a',
    'Needs More Coverage': '#e76f51',
    'No Data': '#6c757d',
  },
  distance: ['#2a9d8f', '#82c0aa', '#f4d35e', '#ee964b', '#d62828'],
  populationPerPollingUnit: ['#440154', '#414487', '#2a788e', '#22a784', '#7ad151'],
};

function getDistanceColor(distanceMetres) {
  if (!Number.isFinite(distanceMetres)) return '#63737b';
  if (distanceMetres < 1000) return COLOR_PALETTES.distance[0];
  if (distanceMetres < 3000) return COLOR_PALETTES.distance[1];
  if (distanceMetres < 5000) return COLOR_PALETTES.distance[2];
  if (distanceMetres < 10000) return COLOR_PALETTES.distance[3];
  return COLOR_PALETTES.distance[4];
}

function getMetricColor(props, distanceMetres) {
  if (pollingViewMode === 'nearMe' && Number.isFinite(distanceMetres)) {
    return getDistanceColor(distanceMetres);
  }

  const metric = pollingMetricSelect?.value || 'accessibilityScore';
  if (metric === 'accessibilityScore') {
    return COLOR_PALETTES.accessibility[props.band] || COLOR_PALETTES.accessibility['No Data'];
  }

  if (metric === 'populationPerPollingUnit') {
    const value = Number(props.pop_pu);
    if (!Number.isFinite(value)) return '#63737b';
    if (value < 1200) return COLOR_PALETTES.populationPerPollingUnit[4];
    if (value < 1800) return COLOR_PALETTES.populationPerPollingUnit[3];
    if (value < 2600) return COLOR_PALETTES.populationPerPollingUnit[2];
    if (value < 3800) return COLOR_PALETTES.populationPerPollingUnit[1];
    return COLOR_PALETTES.populationPerPollingUnit[0];
  }

  return COLOR_PALETTES.accessibility[props.band] || COLOR_PALETTES.accessibility['No Data'];
}

function getLegendEntries() {
  if (pollingViewMode === 'nearMe') {
    return [
      { color: COLOR_PALETTES.distance[0], label: '< 1 km' },
      { color: COLOR_PALETTES.distance[1], label: '1–3 km' },
      { color: COLOR_PALETTES.distance[2], label: '3–5 km' },
      { color: COLOR_PALETTES.distance[3], label: '5–10 km' },
      { color: COLOR_PALETTES.distance[4], label: '> 10 km' },
    ];
  }

  const metric = pollingMetricSelect?.value || 'accessibilityScore';
  if (metric === 'accessibilityScore') {
    return [
      { color: COLOR_PALETTES.accessibility['Broadly Accessible'], label: 'Broadly Accessible' },
      { color: COLOR_PALETTES.accessibility['Watch Pressure'], label: 'Watch Pressure' },
      { color: COLOR_PALETTES.accessibility['Needs More Coverage'], label: 'Needs More Coverage' },
      { color: COLOR_PALETTES.accessibility['No Data'], label: 'No Data' },
    ];
  }

  if (metric === 'populationPerPollingUnit') {
    return [
      { color: COLOR_PALETTES.populationPerPollingUnit[4], label: '< 1,200' },
      { color: COLOR_PALETTES.populationPerPollingUnit[3], label: '1,200–1,799' },
      { color: COLOR_PALETTES.populationPerPollingUnit[2], label: '1,800–2,599' },
      { color: COLOR_PALETTES.populationPerPollingUnit[1], label: '2,600–3,799' },
      { color: COLOR_PALETTES.populationPerPollingUnit[0], label: '≥ 3,800' },
    ];
  }

  return [
    { color: COLOR_PALETTES.accessibility['Broadly Accessible'], label: 'Broadly Accessible' },
    { color: COLOR_PALETTES.accessibility['Watch Pressure'], label: 'Watch Pressure' },
    { color: COLOR_PALETTES.accessibility['Needs More Coverage'], label: 'Needs More Coverage' },
    { color: COLOR_PALETTES.accessibility['No Data'], label: 'No Data' },
  ];
}

function updateLegendMode() {
  if (!pollingLegendTitle || !pollingLegendItems || !pollingLegendNote) return;

  const metric = pollingViewMode === 'nearMe' ? 'nearMe' : pollingMetricSelect?.value || 'accessibilityScore';
  const entries = getLegendEntries();

  pollingLegendTitle.textContent = metric === 'nearMe'
    ? 'Distance from you'
    : metric === 'populationPerPollingUnit'
      ? 'Population per polling unit'
      : 'Accessibility band';

  pollingLegendItems.innerHTML = entries
    .map((item) => `<span><i class="pu-legend-dot" style="background:${item.color}"></i> ${item.label}</span>`)
    .join('');

  pollingLegendNote.textContent = metric === 'nearMe'
    ? 'Polling units are colored by distance from your location.'
    : metric === 'populationPerPollingUnit'
      ? 'Lower population per polling unit indicates better coverage.'
      : 'Polling units are colored by accessibility band.';
}

function clearLgaBoundary() {
  if (lgaBoundaryLayer) {
    map.removeLayer(lgaBoundaryLayer);
    lgaBoundaryLayer = null;
  }
}

function getLgaFeature() {
  if (!lgaData || !stateSelect.value || !lgaSelect.value) return null;
  const stateKey = normalizeLookupKey(stateSelect.value);
  const lgaKey = normalizeLookupKey(lgaSelect.value);
  return (lgaData.features || []).find((feature) => {
    const featureState = normalizeLookupKey(feature.properties.NAME_1 || feature.properties.NAME_0 || '');
    const featureLga = normalizeLookupKey(feature.properties.NAME_2 || feature.properties.VARNAME_2 || feature.properties.NL_NAME_2 || '');
    return featureState === stateKey && featureLga === lgaKey;
  }) || null;
}

function renderLgaBoundary() {
  clearLgaBoundary();
  if (!lgaData || !stateSelect.value || !lgaSelect.value || pollingViewMode !== 'lgaSearch') return;
  const feature = getLgaFeature();
  if (!feature) return;

  lgaBoundaryLayer = L.geoJSON(feature, {
    interactive: false,
    style: {
      color: '#d96b6b',
      weight: 3,
      fillColor: '#f7b6b2',
      fillOpacity: 0.32,
      opacity: 0.9,
      dashArray: '4,4',
    },
  }).addTo(map);

  const bounds = L.geoJSON(feature).getBounds();
  if (bounds.isValid()) {
    map.fitBounds(bounds.pad(0.08), { padding: [14, 14] });
  }
}

function pointInPolygon(point, polygon) {
  const [x, y] = point;
  let inside = false;

  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i][0];
    const yi = polygon[i][1];
    const xj = polygon[j][0];
    const yj = polygon[j][1];

    const intersect = ((yi > y) !== (yj > y)) &&
      (x < ((xj - xi) * (y - yi)) / (yj - yi) + xi);
    if (intersect) inside = !inside;
  }

  return inside;
}

function isPointInGeoFeature(coordinates, feature) {
  if (!feature || !feature.geometry) return false;
  try {
    return turf.booleanPointInPolygon(turf.point(coordinates), feature);
  } catch (error) {
    console.warn('Turf point-in-polygon failed, falling back to manual test:', error);
    const geom = feature.geometry;
    if (geom.type === 'Polygon') {
      return feature.geometry.coordinates.some((ring) => pointInPolygon(coordinates, ring));
    }
    if (geom.type === 'MultiPolygon') {
      return geom.coordinates.some((polygon) => polygon.some((ring) => pointInPolygon(coordinates, ring)));
    }
    return false;
  }
}

function getSelectedBoundaryFeature() {
  if (lgaSelect.value) {
    return getLgaFeature();
  }

  if (!stateSelect.value) return null;
  return getStateFeatures().find(
    (feature) => normalizeLookupKey(getFeatureStateName(feature)) === normalizeLookupKey(stateSelect.value)
  ) || null;
}

function resetMapBounds() {
  if (nigeriaBounds && nigeriaBounds.isValid()) {
    map.setMaxBounds(nigeriaBounds.pad(0.04));
  } else {
    map.setMaxBounds(null);
  }
  map.setMinZoom(initialMapMinZoom);
}

function constrainMapToFeature(feature) {
  if (!feature) {
    resetMapBounds();
    return;
  }

  const bounds = L.geoJSON(feature).getBounds();
  if (!bounds.isValid()) {
    resetMapBounds();
    return;
  }

  map.fitBounds(bounds.pad(0.08), { padding: [18, 18], maxZoom: 12 });
  map.setMaxBounds(bounds.pad(0.08));
  map.setMinZoom(Math.max(initialMapMinZoom, map.getBoundsZoom(bounds.pad(0.08), false)));
}

function ensurePollingPointsPane() {
  if (map.getPane(pollingPointsPaneName)) {
    return map.getPane(pollingPointsPaneName);
  }

  const pane = map.createPane(pollingPointsPaneName);
  pane.style.zIndex = '650';
  pane.style.pointerEvents = 'auto';
  return pane;
}

/* ── State boundary layer ───────────────────────────────────────────────── */
function renderStateBoundaries() {
  if (stateLayer) { map.removeLayer(stateLayer); stateLayer = null; }
  if (!adm1Data || !toggleStates.checked) return;

  stateLayer = L.geoJSON(
    { type: 'FeatureCollection', features: getStateFeatures() },
    {
      style: {
        color: mapTheme === 'light' ? '#1a3d4a' : '#ffffff',
        weight: 2,
        fillOpacity: 0,
        opacity: 0.85,
      },
      onEachFeature(feature, layer) {
        const stateName = getFeatureStateName(feature);
        layer.on('click', () => {
          stateSelect.value = stateName;
          updateLgaOptions();
          lgaSelect.value = '';
          clearPollingUnitPointsLayer();
          loadedPoints = [];
          updateDetailsPanel();
          togglePollingUnits.checked = true;
          renderAllBoundaries();
          renderPollingUnitPointsLayer();
          renderAreaReport();
          zoomToFeature(feature);
        });
        layer.bindTooltip(stateName, { permanent: false, direction: 'center', className: 'pu-state-tooltip' });
      },
    }
  ).addTo(map);
}

/* ── LGA administrative boundary layer ──────────────────────────────────── */
function getLgaAdminFeatures() {
  if (!adm2Data) return [];
  return adm2Data.features || [];
}

function clearLgaAdminLayer() {
  if (lgaAdminLayer) { map.removeLayer(lgaAdminLayer); lgaAdminLayer = null; }
}

function renderLgaAdminBoundaries() {
  clearLgaAdminLayer();
  if (!adm2Data || !toggleLGAs.checked) return;

  lgaAdminLayer = L.geoJSON(
    { type: 'FeatureCollection', features: getLgaAdminFeatures() },
    {
      style: {
        color: '#d96b6b',
        weight: 1,
        fillColor: '#f7b6b2',
        fillOpacity: 0.22,
        opacity: 0.8,
      },
      onEachFeature(feature, layer) {
        const lgaName = feature.properties.NAME_2 || feature.properties.VARNAME_2 || feature.properties.NL_NAME_2 || 'LGA';
        const stateName = feature.properties.NAME_1 || feature.properties.NAME_0 || '';
        layer.bindTooltip(`${lgaName}, ${stateName}`, { permanent: false, direction: 'center', className: 'pu-lga-tooltip' });
      },
    }
  ).addTo(map);
}

/* ── Ward boundary layer ────────────────────────────────────────────────── */
function renderWardBoundaries() {
  if (wardLayer) { map.removeLayer(wardLayer); wardLayer = null; }
  if (!wardData || !toggleWards.checked) return;

  wardLayer = L.geoJSON(wardData, {
    interactive: false,
    style: {
      color: mapTheme === 'light' ? 'rgba(0,60,80,0.28)' : 'rgba(255,255,255,0.3)',
      weight: 0.8,
      fillOpacity: 0,
      opacity: 1,
      dashArray: '2,4',
    },
  }).addTo(map);
}

function setWardStatus(message, visible) {
  wardStatusText.textContent = message;
  wardStatusEl.classList.toggle('is-hidden', !visible);
}

/* ── Polling unit highlight ─────────────────────────────────────────────── */
function setHighlight(feature) {
  if (highlightLayer) { map.removeLayer(highlightLayer); highlightLayer = null; }
  if (!feature) return;
  highlightLayer = L.geoJSON(feature, {
    interactive: false,
    style: { color: '#5fe09b', weight: 3, fillOpacity: 0, opacity: 1 },
  }).addTo(map);
}

/* ── Polling unit points (loaded once as GeoJSON, like a shapefile) ──────── */
function clearPollingUnitPointsLayer() {
  if (pollingUnitPointsLayer) { map.removeLayer(pollingUnitPointsLayer); pollingUnitPointsLayer = null; }
}

function getPollingUnitPopupContent(props, distanceMetres, travelTimes) {
  const loc = [props.ward, props.lga, props.state].filter(Boolean).join(', ');

  let travelSection = '<span class="popup-note">Enable location to see distance & travel time.</span>';
  if (Number.isFinite(distanceMetres)) {
    const walkingText = formatDuration(estimateWalkingDuration(distanceMetres));
    const drivingText = travelTimes?.driving != null ? formatDuration(travelTimes.driving) : 'Loading driving…';
    travelSection = `
      <div class="popup-stats-row">
        <span>Distance</span>
        <strong>${formatDistance(distanceMetres)}</strong>
      </div>
      <div class="popup-stats-row">
        <span>Walking</span>
        <strong>${walkingText}</strong>
      </div>
      <div class="popup-stats-row">
        <span>Driving</span>
        <strong>${drivingText}</strong>
      </div>
    `;
  }

  return `
    <div class="polling-popup-card">
      <div class="popup-header">
        <div>
          <strong>${props.name || 'Polling Unit'}</strong>
          <span>${loc || 'Nigeria'}</span>
        </div>
        <span class="popup-badge">${props.band || 'No data'}</span>
      </div>

      ${travelSection}
    </div>
  `;
}

function formatDuration(seconds) {
  if (!Number.isFinite(seconds)) return '--';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return remainder === 0
    ? `${hours} hr${hours === 1 ? '' : 's'}`
    : `${hours} hr ${remainder} min`;
}

function estimateWalkingDuration(distanceMetres) {
  // Walking follows the direct path with a modest detour allowance at 4.8 km/h.
  const walkingSpeedMetresPerSecond = 4.8 * 1000 / 3600;
  return (distanceMetres * 1.25) / walkingSpeedMetresPerSecond;
}

async function fetchOsrmDuration(origin, destination, profile) {
  const url = `https://router.project-osrm.org/route/v1/${profile}/${origin[0]},${origin[1]};${destination[0]},${destination[1]}?overview=false&alternatives=false&annotations=duration`;
  try {
    const response = await fetch(url);
    if (!response.ok) return null;
    const data = await response.json();
    return data?.routes?.[0]?.duration ?? null;
  } catch (error) {
    console.warn('OSRM fetch failed:', error);
    return null;
  }
}

async function fetchOsrmRouteMetrics(origin, destination) {
  const url = `https://router.project-osrm.org/route/v1/driving/${origin[0]},${origin[1]};${destination[0]},${destination[1]}?overview=false&alternatives=false`;
  try {
    const response = await fetch(url);
    if (!response.ok) return null;
    const route = (await response.json())?.routes?.[0];
    return route ? { duration: route.duration, distance: route.distance } : null;
  } catch (error) {
    console.warn('OSRM route metrics fetch failed:', error);
    return null;
  }
}

async function fetchTravelTimes(origin, destination) {
  // The public OSRM endpoint uses a driving profile; walking is estimated separately.
  const driving = await fetchOsrmDuration(origin, destination, 'driving');
  return { driving };
}

function renderPollingUnitPointsLayer() {
  clearPollingUnitPointsLayer();
  loadedPoints = [];
  if (!togglePollingUnits.checked || !stateSelect.value) return;

  const state = stateSelect.value;
  const lga   = lgaSelect.value;
  const areaKey = `${normalizeLookupKey(state)}::${normalizeLookupKey(lga)}`;
  if (loadedPollingPointAreaKey !== areaKey) {
    void loadPollingUnitPointsGeoJSON();
    return;
  }
  if (!allPollingUnitFeatures.length) return;
  const boundaryFeature = getSelectedBoundaryFeature();
  if (!boundaryFeature) return;

  let features = allPollingUnitFeatures
    .filter((f) => normalizeLookupKey(f.properties.state) === normalizeLookupKey(state))
    .filter((f) => !lga || normalizeLookupKey(f.properties.lga) === normalizeLookupKey(lga));

  // Many records in the supplied register have no coordinates. Place those
  // records at stable estimated positions within the selected boundary so the
  // complete polling-unit list remains visible.
  features = features.map((feature, index) => placePollingPointInBoundary(feature, boundaryFeature, index));

  if (!features.length) return;

  /* build flat point list for nearest-route calculations */
  loadedPoints = features.map((f) => {
    const latitude = f.geometry.coordinates[1];
    const longitude = f.geometry.coordinates[0];
    const point = {
      latitude,
      longitude,
      ...f.properties,
    };

    if (userLatLng && pollingViewMode === 'nearMe') {
      point._distance = userLatLng.distanceTo(L.latLng(latitude, longitude));
    }
    return point;
  });

  const markers = L.geoJSON(
    { type: 'FeatureCollection', features },
    {
      pane: pollingPointsPaneName,
      pointToLayer: (feature, latlng) => {
        const props = feature.properties;
        const latitude = latlng.lat;
        const longitude = latlng.lng;
        const distance = userLatLng && pollingViewMode === 'nearMe'
          ? userLatLng.distanceTo(L.latLng(latitude, longitude))
          : null;
        const fillColor = getMetricColor(props, distance);

        return L.circleMarker(latlng, {
          radius: 2.5,
          color: '#ffffff',
          weight: 0.9,
          opacity: 1,
          fillColor: '#e53935',
          fillOpacity: 0.92,
        });
      },
      onEachFeature: (feature, layer) => {
        const props = feature.properties;
        const coordinates = feature.geometry.coordinates;
        const distance = userLatLng
          ? userLatLng.distanceTo(L.latLng(coordinates[1], coordinates[0]))
          : null;

        layer.bindPopup(getPollingUnitPopupContent(props, distance, distance ? { walking: null, driving: null } : null), {
          maxWidth: 360,
          minWidth: 280,
          className: 'polling-popup',
        });

        layer.on('popupopen', async () => {
          if (!userLatLng || !distance) return;
          if (layer._travelTimesLoaded) return;

          const origin = [userLatLng.lng, userLatLng.lat];
          const destination = [coordinates[0], coordinates[1]];
          const travelTimes = await fetchTravelTimes(origin, destination);

          layer._travelTimesLoaded = true;
          layer.setPopupContent(getPollingUnitPopupContent(props, distance, travelTimes));
        });
      },
    }
  );

  pollingUnitPointsLayer = markers.addTo(map);
  markers.bringToFront();

  renderAreaReport();
}

function focusSelectedPollingArea() {
  const state = stateSelect.value;
  if (!state) {
    if (nigeriaBounds?.isValid()) {
      map.fitBounds(nigeriaBounds, { padding: [18, 18] });
    }
    return;
  }

  const feature = getStateFeatures().find(
    (f) => normalizeLookupKey(getFeatureStateName(f)) === normalizeLookupKey(state)
  );

  if (feature) {
    zoomToFeature(feature);
  }
}

function pointSeed(value) {
  let hash = 2166136261;
  for (const char of String(value || '')) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) / 4294967296;
}

function placePollingPointInBoundary(feature, boundaryFeature, index) {
  const coordinates = feature?.geometry?.coordinates;
  if (Array.isArray(coordinates) && isPointInGeoFeature(coordinates, boundaryFeature)) return feature;

  const bounds = L.geoJSON(boundaryFeature).getBounds();
  const seed = `${feature?.properties?.name || ''}:${feature?.properties?.ward || ''}:${index}`;
  for (let attempt = 0; attempt < 24; attempt += 1) {
    const longitude = bounds.getWest() + (bounds.getEast() - bounds.getWest()) * pointSeed(`${seed}:x:${attempt}`);
    const latitude = bounds.getSouth() + (bounds.getNorth() - bounds.getSouth()) * pointSeed(`${seed}:y:${attempt}`);
    if (isPointInGeoFeature([longitude, latitude], boundaryFeature)) {
      return {
        ...feature,
        geometry: { ...feature.geometry, coordinates: [longitude, latitude] },
        properties: { ...feature.properties, geometrySource: 'boundary-estimate' },
      };
    }
  }

  const centre = bounds.getCenter();
  return {
    ...feature,
    geometry: { ...feature.geometry, coordinates: [centre.lng, centre.lat] },
    properties: { ...feature.properties, geometrySource: 'boundary-estimate' },
  };
}

async function loadPollingUnitPointsGeoJSON() {
  const state = stateSelect.value;
  const lga = lgaSelect.value;
  if (!state) {
    allPollingUnitFeatures = [];
    loadedPollingPointAreaKey = '';
    return;
  }

  const areaKey = `${normalizeLookupKey(state)}::${normalizeLookupKey(lga)}`;
  if (pollingPointRequestKey === areaKey) return;
  pollingPointRequestKey = areaKey;

  try {
    pollingSourceSummary.textContent = 'Loading polling unit points…';
    const query = new URLSearchParams({ state });
    if (lga) query.set('lga', lga);
    const response = await fetch(`/api/polling-units.geojson?${query}`);
    if (!response.ok) throw new Error('Unable to load polling unit GeoJSON.');
    const geojson = await response.json();
    if (pollingPointRequestKey !== areaKey) return;
    allPollingUnitFeatures = geojson.features || [];
    loadedPollingPointAreaKey = areaKey;
    const counts = geojson?.source?.counts || {};
    const estimatedCount = Number(counts.estimated || 0);
    const geocodedCount = Number(counts.geocoded || 0);
    const csvCount = Number(counts.csvLatLong || 0);
    const exactCount = Number(counts.exact || 0);
    pollingSourceSummary.textContent =
      `${formatNumber(allPollingUnitFeatures.length)} polling units across Nigeria` +
      (estimatedCount || geocodedCount || csvCount
        ? ` · ${formatNumber(exactCount)} exact, ${formatNumber(csvCount)} CSV, ${formatNumber(geocodedCount)} geocoded, ${formatNumber(estimatedCount)} estimated`
        : '');
    renderPollingUnitPointsLayer();
  } catch (error) {
    console.warn('Failed to load polling unit GeoJSON:', error);
    pollingSourceSummary.textContent = 'Failed to load polling unit points.';
  } finally {
    if (pollingPointRequestKey === areaKey) pollingPointRequestKey = '';
  }
}

/* ── User location ──────────────────────────────────────────────────────── */
function clearUserLocation() {
  if (userLocationLayer) { map.removeLayer(userLocationLayer); userLocationLayer = null; }
  if (watchId !== null) { navigator.geolocation.clearWatch(watchId); watchId = null; }
  userLatLng = null;
  userDistanceCard.classList.add('is-hidden');
}

function applyUserLocation(position) {
  userLatLng = L.latLng(position.coords.latitude, position.coords.longitude);
  const accuracy = position.coords.accuracy;

  if (userLocationLayer) { map.removeLayer(userLocationLayer); userLocationLayer = null; }

  userLocationLayer = L.layerGroup();

  L.circle(userLatLng, {
    radius: accuracy,
    color: '#4fc3f7',
    fillColor: '#4fc3f7',
    fillOpacity: 0.08,
    weight: 1,
    interactive: false,
  }).addTo(userLocationLayer);

  L.circleMarker(userLatLng, {
    radius: 9,
    color: '#ffffff',
    weight: 2.5,
    fillColor: '#4fc3f7',
    fillOpacity: 1,
  }).bindPopup(
    `<strong>Your Location</strong><span>Accuracy: ±${Math.round(accuracy)} m</span>`
  ).addTo(userLocationLayer);

  userLocationLayer.addTo(map);
  map.panTo(userLatLng);

  renderAreaReport();
}

function activateUserLocation() {
  if (!('geolocation' in navigator)) {
    alert('Geolocation is not supported by your browser.');
    toggleUserLocation.checked = false;
    return;
  }

  watchId = navigator.geolocation.watchPosition(
    applyUserLocation,
    (err) => {
      console.warn('Geolocation error:', err);
      setSearchMessage('Unable to get your location. Check browser permissions.');
      toggleUserLocation.checked = false;
      clearUserLocation();
    },
    { enableHighAccuracy: true, maximumAge: 0, timeout: 20000 }
  );
}

/* ── Map theme toggle ───────────────────────────────────────────────────── */
function applyBaseMap(key) {
  if (!baseMapLayers[key]) return;

  if (currentTileLayer !== baseMapLayers[key]) {
    map.removeLayer(currentTileLayer);
    currentTileLayer = baseMapLayers[key].addTo(map);
  }
  currentTileLayer.bringToBack();

  mapTheme = key;

  const mapPanel = document.querySelector('.map-panel');
  mapPanel.classList.toggle('map-light', key === 'light');

  const lbl = document.querySelector('.mtt-label');
  if (lbl) lbl.textContent = key === 'light' ? 'Dark Map' : 'Light Map';

  // Re-render boundaries so their contrast remains clear on the selected basemap.
  renderAllBoundaries();
}

function toggleMapTheme() {
  applyBaseMap(mapTheme === 'dark' ? 'light' : 'dark');
}

document.getElementById('mapThemeToggle').addEventListener('click', toggleMapTheme);

map.on('baselayerchange', (event) => {
  const key = Object.entries(baseMapLayers).find(([, layer]) => layer === event.layer)?.[0];
  if (key) applyBaseMap(key);
});

/* ── Layer toggle handlers ──────────────────────────────────────────────── */
toggleStates.addEventListener('change', renderStateBoundaries);

toggleLGAs.addEventListener('change', renderLgaAdminBoundaries);

toggleWards.addEventListener('change', () => {
  if (wardData) {
    renderWardBoundaries();
  } else if (toggleWards.checked) {
    setWardStatus('Ward boundaries not available — place adm3.zip in data/boundaries/', true);
    setTimeout(() => setWardStatus('', false), 4000);
  }
});

togglePollingUnits.addEventListener('change', () => {
  renderPollingUnitPointsLayer();
});

if (pollingMetricSelect) {
  pollingMetricSelect.addEventListener('change', () => {
    updateLegendMode();
    renderPollingUnitPointsLayer();
  });
}

toggleUserLocation.addEventListener('change', () => {
  if (toggleUserLocation.checked) {
    activateUserLocation();
  } else {
    clearUserLocation();
  }
});

/* ── Zoom / move ────────────────────────────────────────────────────────── */
/* ── Zoom helpers ───────────────────────────────────────────────────────── */
function zoomToFeature(feature) {
  if (!feature) {
    if (nigeriaBounds) map.fitBounds(nigeriaBounds, { padding: [18, 18] });
    return;
  }
  const bounds = L.geoJSON(feature).getBounds();
  if (bounds.isValid()) map.fitBounds(bounds.pad(0.12), { padding: [18, 18] });
}

/* ── Right-panel details ────────────────────────────────────────────────── */
function updateSourceDetails() {
  const source = pollingData?.source;
  if (!source) return;
  pollingSourceSummary.textContent = `${source.name} • ${formatNumber(source.rowCount)} rows`;
  pollingSourceName.textContent    = source.name;
  pollingRowCount.textContent      = formatNumber(source.rowCount);
  pollingUpdatedAt.textContent     = formatDate(source.modifiedTime);
  pollingMethodology.textContent   = pollingData.methodology ||
    'Accessibility derived from polling unit counts and population coverage.';
}

async function loadWardAnalysisSummary() {
  if (!wardAnalysisStatus || !wardAnalysisMatched || !wardAnalysisUnmatched) return;

  try {
    const response = await fetch('/data/ward_pu_summary.json', { cache: 'no-store' });
    if (!response.ok) {
      throw new Error('Ward analysis summary not generated yet.');
    }

    const summary = await response.json();
    wardAnalysisStatus.textContent = 'Loaded';
    wardAnalysisMatched.textContent = formatNumber(summary.total_wards_matched ?? 0);
    wardAnalysisUnmatched.textContent = formatNumber(summary.total_unmatched_pus ?? 0);
  } catch (error) {
    wardAnalysisStatus.textContent = 'Not generated';
    wardAnalysisMatched.textContent = '--';
    wardAnalysisUnmatched.textContent = '--';
  }
}

function buildChart(labels, values, label) {
  const canvas = document.getElementById('pollingChart');
  if (!canvas || !window.Chart) return;
  if (pollingChart) pollingChart.destroy();
  pollingChart = new Chart(canvas, {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        label,
        data: values,
        backgroundColor: '#22b573',
        borderColor: '#0d3c31',
        borderWidth: 1,
        borderRadius: 4,
      }],
    },
    options: {
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        x: { ticks: { color: '#d9ece4', maxRotation: 65, minRotation: 65, autoSkip: false }, grid: { display: false } },
        y: { beginAtZero: true, ticks: { color: '#d9ece4' }, grid: { color: 'rgba(255,255,255,0.08)' } },
      },
    },
  });
}

function updateChart(selection = {}) {
  const { state, lga } = selection;
  if (!pollingData) return;

  if (state && lga) {
    const row = (pollingData.lgas || []).find(
      (r) => normalizeLookupKey(r.state) === normalizeLookupKey(state) &&
             normalizeLookupKey(r.lga) === normalizeLookupKey(lga)
    );
    const topWards = row?.topWards || [];
    pollingChartTitle.textContent = 'Top Wards by Polling Units';
    buildChart(topWards.map((w) => w.ward), topWards.map((w) => w.pollingUnits), 'Polling Units');
    return;
  }

  if (state) {
    const rows = (pollingData.lgas || [])
      .filter((r) => normalizeLookupKey(r.state) === normalizeLookupKey(state))
      .sort((a, b) => b.pollingUnits - a.pollingUnits).slice(0, 10);
    pollingChartTitle.textContent = `${state} — LGAs by Polling Units`;
    buildChart(rows.map((r) => r.lga), rows.map((r) => r.pollingUnits), 'Polling Units');
    return;
  }

  const stateRows = [...(pollingData.states || [])].sort((a, b) => b.pollingUnits - a.pollingUnits).slice(0, 10);
  pollingChartTitle.textContent = 'Top States by Polling Units';
  buildChart(stateRows.map((r) => r.state), stateRows.map((r) => r.pollingUnits), 'Polling Units');
}

function getNationalBand(pop) {
  if (!Number.isFinite(pop)) return '--';
  if (pop <= 900)  return 'Broadly Accessible';
  if (pop <= 1150) return 'Watch Pressure';
  return 'Needs More Coverage';
}

function getFilteredPollingUnitFeatures() {
  const state = stateSelect.value;
  const lga = lgaSelect.value;

  if (!state || !lga) return [];

  return (allPollingUnitFeatures || []).filter((f) => {
    if (normalizeLookupKey(f.properties.state) !== normalizeLookupKey(state)) return false;
    if (normalizeLookupKey(f.properties.lga) !== normalizeLookupKey(lga)) return false;
    return true;
  });
}

function formatTravelTime(distanceKm) {
  if (!Number.isFinite(distanceKm)) return '--';
  const minutes = distanceKm / 5 * 60;
  if (minutes < 60) return `${Math.round(minutes)} min walk`;
  return `${(minutes / 60).toFixed(1)} hr walk`;
}

function renderAreaReport() {
  const state = stateSelect.value;
  const lga = lgaSelect.value;

  if (!pollingData || !reportTitle) {
    return;
  }

  if (!state) {
    viewReportButton?.setAttribute('disabled', '');
    downloadPdfReportButton?.setAttribute('disabled', '');
    if (downloadPdfReportButton) downloadPdfReportButton.querySelector('small').textContent = 'Select a state or LGA';
    return;
  }

  viewReportButton?.removeAttribute('disabled');
  downloadPdfReportButton?.removeAttribute('disabled');
  if (downloadPdfReportButton) downloadPdfReportButton.querySelector('small').textContent = lga ? `${lga}, ${state}` : `${state} state`;
  const stateRow = (pollingData.states || []).find(
    (row) => normalizeLookupKey(row.state) === normalizeLookupKey(state)
  );
  const stateLgas = (pollingData.lgas || []).filter(
    (row) => normalizeLookupKey(row.state) === normalizeLookupKey(state)
  );

  if (lga) {
    const features = getFilteredPollingUnitFeatures();
    reportTitle.textContent = `${lga} report`;
    reportAreaName.textContent = `${lga}, ${state}`;
    reportPuCount.textContent = formatNumber(features.length);
    if (reportSummaryAHeader) reportSummaryAHeader.textContent = 'Closest';
    if (reportSummaryBHeader) reportSummaryBHeader.textContent = 'Farthest';
    if (reportHighlightAHeader) reportHighlightAHeader.textContent = 'Closest to you';
    if (reportHighlightBHeader) reportHighlightBHeader.textContent = 'Farthest from you';

    const points = features
      .map((feature) => {
        const [lng, lat] = feature.geometry.coordinates;
        return {
          ...feature.properties,
          latitude: lat,
          longitude: lng,
        };
      })
      .filter((point) => Number.isFinite(point.latitude) && Number.isFinite(point.longitude));

    if (userLatLng) {
      points.forEach((point) => {
        point._distance = userLatLng.distanceTo(L.latLng(point.latitude, point.longitude)) / 1000;
      });
    }

    let closest = null;
    let farthest = null;
    let closestDistance = null;
    let farthestDistance = null;

    if (userLatLng && points.length) {
      points.forEach((point) => {
        const distanceKm = point._distance;
        if (closestDistance === null || distanceKm < closestDistance) {
          closestDistance = distanceKm;
          closest = point;
        }
        if (farthestDistance === null || distanceKm > farthestDistance) {
          farthestDistance = distanceKm;
          farthest = point;
        }
      });
    }

    reportClosest.textContent = closest ? closest.name || 'Polling Unit' : '--';
    reportFarthest.textContent = farthest ? farthest.name || 'Polling Unit' : '--';

    reportClosestValue.textContent = closest ? `${closest.name || 'Polling Unit'}` : '--';
    reportClosestMeta.textContent = closest
      ? `${formatNumber(closestDistance, 1)} km • ${formatTravelTime(closestDistance)}`
      : 'Enable User Location to calculate distance';

    reportFarthestValue.textContent = farthest ? `${farthest.name || 'Polling Unit'}` : '--';
    reportFarthestMeta.textContent = farthest
      ? `${formatNumber(farthestDistance, 1)} km • ${formatTravelTime(farthestDistance)}`
      : 'Enable User Location to calculate distance';

    const suggestions = [];
    if (!userLatLng) {
      suggestions.push('Enable User Location so the report can show closest and farthest polling units from your position.');
    }
    if (closestDistance !== null && closestDistance > 3) {
      suggestions.push('The nearest polling unit is farther than expected, so transport support or a new access point may help.');
    }
    if (farthestDistance !== null && farthestDistance > 8) {
      suggestions.push('Some polling units are quite far away, so consider additional outreach or better route planning.');
    }
    const row = stateLgas.find((r) => normalizeLookupKey(r.lga) === normalizeLookupKey(lga));
    if (row?.accessibilityBand === 'Needs More Coverage') {
      suggestions.push('This LGA needs more coverage, so adding or redistributing polling units would improve access.');
    } else if (row?.accessibilityBand === 'Watch Pressure') {
      suggestions.push('This area is under watch pressure, so more support during peak periods would help.');
    } else {
      suggestions.push('Coverage looks generally healthy, so keep monitoring and supporting the busiest wards.');
    }

    reportSuggestions.innerHTML = suggestions.map((item) => `<li>${item}</li>`).join('');
    reportListTitle.textContent = `Polling units in ${lga}`;

    reportUnitsList.innerHTML = points
      .map((point) => {
        const unitName = point.name || 'Polling Unit';
        const locationText = [point.ward, point.lga, point.state].filter(Boolean).join(', ');
        const distanceText = userLatLng && Number.isFinite(point._distance)
          ? `${formatNumber(point._distance, 1)} km`
          : 'Distance pending';
        return `<div class="report-unit-item"><strong>${unitName}</strong><span>${locationText}</span><span>${distanceText}</span></div>`;
      })
      .join('');

    updateChart({ state, lga });
    return;
  }

  reportTitle.textContent = `${state} overview`;
  reportAreaName.textContent = `${state} state`;
  reportPuCount.textContent = formatNumber(stateRow?.pollingUnits || stateLgas.reduce((sum, row) => sum + (Number(row.pollingUnits) || 0), 0));
  if (reportSummaryAHeader) reportSummaryAHeader.textContent = 'Highest LGA';
  if (reportSummaryBHeader) reportSummaryBHeader.textContent = 'Lowest LGA';
  if (reportHighlightAHeader) reportHighlightAHeader.textContent = 'Top polling units';
  if (reportHighlightBHeader) reportHighlightBHeader.textContent = 'Lowest polling units';
  reportClosest.textContent = stateLgas.length ? `${stateLgas.reduce((best, row) => (!best || row.pollingUnits > best.pollingUnits ? row : best), null)?.lga || '--'}` : '--';
  reportFarthest.textContent = stateLgas.length ? `${stateLgas.reduce((worst, row) => (!worst || row.pollingUnits < worst.pollingUnits ? row : worst), null)?.lga || '--'}` : '--';

  const highestLga = stateLgas.reduce((best, row) => (!best || row.pollingUnits > best.pollingUnits ? row : best), null);
  const lowestLga = stateLgas.reduce((worst, row) => (!worst || row.pollingUnits < worst.pollingUnits ? row : worst), null);

  reportClosestValue.textContent = highestLga?.lga || '--';
  reportClosestMeta.textContent = highestLga
    ? `${formatNumber(highestLga.pollingUnits)} PUs • ${formatNumber(highestLga.populationPerPollingUnit, 1)} pop/PU`
    : '--';
  reportFarthestValue.textContent = lowestLga?.lga || '--';
  reportFarthestMeta.textContent = lowestLga
    ? `${formatNumber(lowestLga.pollingUnits)} PUs • ${formatNumber(lowestLga.populationPerPollingUnit, 1)} pop/PU`
    : '--';

  const suggestions = [];
  if (!stateLgas.length) {
    suggestions.push('No LGAs are available for this state.');
  } else {
    suggestions.push('Review the highest- and lowest-count LGAs to understand coverage gaps.');
    if (highestLga && lowestLga && highestLga.pollingUnits - lowestLga.pollingUnits > 200) {
      suggestions.push('There is a large imbalance between LGAs, so focus planning on lower-coverage areas.');
    }
  }

  const statePopulationPerPu = stateRow?.populationPerPollingUnit ?? '--';
  reportSuggestions.innerHTML = suggestions.map((item) => `<li>${item}</li>`).join('');
  reportListTitle.textContent = `State summary for ${state}`;
  reportUnitsList.innerHTML = '';

  updateChart({ state });
}

function updateDetailsPanel() {
  if (!pollingData) return;

  const state = stateSelect.value;
  const lga   = lgaSelect.value;

  if (state && lga) {
    const row = (pollingData.lgas || []).find(
      (r) => normalizeLookupKey(r.state) === normalizeLookupKey(state) &&
             normalizeLookupKey(r.lga)   === normalizeLookupKey(lga)
    );
    if (!row) return;
    pollingAreaLabel.textContent              = 'Selected LGA';
    pollingAreaName.textContent               = `${row.lga}, ${row.state}`;
    pollingUnitsValue.textContent             = formatNumber(row.pollingUnits);
    pollingWardsValue.textContent             = formatNumber(row.wards);
    pollingPopulationLoadValue.textContent    = formatNumber(row.populationPerPollingUnit, 1);
    pollingBandValue.textContent              = row.accessibilityBand || '--';
    pollingTopAreaValue.textContent           = row.topWards?.[0]
      ? `${row.topWards[0].ward} (${formatNumber(row.topWards[0].pollingUnits)})`
      : '--';
    updateChart({ state, lga });
    return;
  }

  if (state) {
    const row = getStateRow(state);
    if (!row) return;
    pollingAreaLabel.textContent              = 'Selected State';
    pollingAreaName.textContent               = row.state;
    pollingUnitsValue.textContent             = formatNumber(row.pollingUnits);
    pollingWardsValue.textContent             = formatNumber(row.wards);
    pollingPopulationLoadValue.textContent    = formatNumber(row.populationPerPollingUnit, 1);
    pollingBandValue.textContent              = row.accessibilityBand || '--';
    pollingTopAreaValue.textContent           = row.topLgaByPollingUnits
      ? `${row.topLgaByPollingUnits.lga} (${formatNumber(row.topLgaByPollingUnits.pollingUnits)})`
      : '--';
    updateChart({ state });
    return;
  }

  const summary = pollingData.summary;
  pollingAreaLabel.textContent              = 'Country';
  pollingAreaName.textContent               = 'Nigeria';
  pollingUnitsValue.textContent             = formatNumber(summary.totalPollingUnits);
  pollingWardsValue.textContent             = formatNumber(summary.totalWards);
  pollingPopulationLoadValue.textContent    = formatNumber(summary.nationalPopulationPerPollingUnit, 1);
  pollingBandValue.textContent              = getNationalBand(summary.nationalPopulationPerPollingUnit);
  pollingTopAreaValue.textContent           = summary.topStateByPollingUnits
    ? `${summary.topStateByPollingUnits.state} (${formatNumber(summary.topStateByPollingUnits.pollingUnits)})`
    : '--';
  updateChart();
}

/* ── Filter dropdowns ───────────────────────────────────────────────────── */
function populateStateOptions() {
  const current = stateSelect.value;
  stateSelect.innerHTML = '<option value="">All States</option>';
  for (const row of pollingData.states || []) {
    const opt = document.createElement('option');
    opt.value = row.state;
    opt.textContent = row.state;
    stateSelect.append(opt);
  }
  stateSelect.value = current;
}

function updateLgaOptions() {
  const current = lgaSelect.value;
  lgaSelect.innerHTML = '<option value="">All LGAs</option>';
  if (!stateSelect.value) return;

  const lgas = (pollingData.lgas || [])
    .filter((r) => normalizeLookupKey(r.state) === normalizeLookupKey(stateSelect.value))
    .sort((a, b) => a.lga.localeCompare(b.lga));

  for (const row of lgas) {
    const opt = document.createElement('option');
    opt.value = row.lga;
    opt.textContent = row.lga;
    lgaSelect.append(opt);
  }

  if (lgas.some((r) => normalizeLookupKey(r.lga) === normalizeLookupKey(current))) {
    lgaSelect.value = current;
  }
}

/* ── Search ─────────────────────────────────────────────────────────────── */
function searchArea() {
  const query = normalizeLookupKey(searchInput.value);
  if (!query) { setSearchMessage('Enter a state or LGA name to search.'); return; }
  if (!pollingData) { setSearchMessage('Polling unit data is still loading. Please try again shortly.'); return; }

  const matchState = (pollingData.states || []).find((r) =>
    normalizeLookupKey(r.state).includes(query)
  );

  if (matchState) {
    stateSelect.value = matchState.state;
    updateLgaOptions();
    lgaSelect.value = '';
    clearPollingUnitPointsLayer();
    loadedPoints = [];
    updateDetailsPanel();
    renderAllBoundaries();
    renderPollingUnitPointsLayer();
    renderAreaReport();
    const feat = getStateFeatures().find(
      (f) => normalizeLookupKey(getFeatureStateName(f)) === normalizeLookupKey(matchState.state)
    );
    zoomToFeature(feat);
    setSearchMessage(`Showing ${matchState.state}.`);
    return;
  }

  const lgaRows = pollingData.lgas || [];
  const matchLga =
    lgaRows.find((r) => normalizeLookupKey(r.lga) === query) ||
    lgaRows.find((r) => normalizeLookupKey(`${r.lga} ${r.state}`) === query) ||
    lgaRows.find((r) => normalizeLookupKey(r.lga).includes(query)) ||
    lgaRows.find((r) => normalizeLookupKey(`${r.lga} ${r.state}`).includes(query));

  if (matchLga) {
    stateSelect.value = matchLga.state;
    updateLgaOptions();
    lgaSelect.value = matchLga.lga;
    clearPollingUnitPointsLayer();
    loadedPoints = [];
    updateDetailsPanel();
    renderAllBoundaries();
    renderPollingUnitPointsLayer();
    renderAreaReport();
    zoomToFeature(getLgaFeature());
    setSearchMessage(`Showing ${matchLga.lga}, ${matchLga.state}.`);
    return;
  }

  setSearchMessage('No matching state or LGA found.');
}

/* ── Render all boundary layers ─────────────────────────────────────────── */
function renderAllBoundaries() {
  renderStateBoundaries();
  renderLgaAdminBoundaries();
  renderWardBoundaries();
  renderLgaBoundary();
  if (highlightLayer) { map.removeLayer(highlightLayer); highlightLayer = null; }

  const selectedFeature = getSelectedBoundaryFeature();
  if (selectedFeature) {
    setHighlight(selectedFeature);
    constrainMapToFeature(selectedFeature);
    return;
  }

  resetMapBounds();
}

/* ── Panel resizer ──────────────────────────────────────────────────────── */
function setDetailsPanelWidth(width) {
  if (!populationGrid) return;
  const gridWidth = populationGrid.getBoundingClientRect().width;
  const nextWidth = clamp(width, 280, Math.max(280, gridWidth - 320));
  populationGrid.style.setProperty('--details-panel-width', `${nextWidth}px`);
  window.requestAnimationFrame(() => map.invalidateSize());
}

function initializePanelResizer() {
  if (!populationGrid || !panelResizer) return;
  let isResizing = false;

  const resize = (clientX) => {
    setDetailsPanelWidth(populationGrid.getBoundingClientRect().right - clientX);
  };

  panelResizer.addEventListener('pointerdown', (e) => {
    isResizing = true;
    panelResizer.setPointerCapture(e.pointerId);
    populationGrid.classList.add('is-resizing');
    resize(e.clientX);
  });

  panelResizer.addEventListener('pointermove', (e) => { if (isResizing) resize(e.clientX); });

  panelResizer.addEventListener('pointerup', (e) => {
    isResizing = false;
    panelResizer.releasePointerCapture(e.pointerId);
    populationGrid.classList.remove('is-resizing');
  });

  panelResizer.addEventListener('pointercancel', () => {
    isResizing = false;
    populationGrid.classList.remove('is-resizing');
  });
}

/* ── Data loaders ───────────────────────────────────────────────────────── */
async function loadBoundary(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Failed to load: ${url}`);
  return shp(await response.arrayBuffer());
}

async function loadPollingDashboardData() {
  const response = await fetch('/api/polling-units-data');
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.error || 'Unable to load polling unit data.');
  }
  return response.json();
}

/* ── Event listeners ────────────────────────────────────────────────────── */
stateSelect.addEventListener('change', () => {
  updateLgaOptions();
  lgaSelect.value = '';
  clearPollingUnitPointsLayer();
  loadedPoints = [];
  updateDetailsPanel();
  renderAllBoundaries();
  renderPollingUnitPointsLayer();
  renderAreaReport();
});

document.getElementById('applyPollingFilters').addEventListener('click', () => {
  updateDetailsPanel();
  renderAllBoundaries();
  renderPollingUnitPointsLayer();
  renderAreaReport();
});

document.getElementById('resetPollingFilters').addEventListener('click', () => {
  metricSelect.value = 'pollingUnits';
  stateSelect.value  = '';
  updateLgaOptions();
  lgaSelect.value    = '';
  searchInput.value  = '';
  setSearchMessage('');
  clearPollingUnitPointsLayer();
  loadedPoints = [];
  updateDetailsPanel();
  renderAllBoundaries();
  resetMapBounds();
  if (nigeriaBounds?.isValid()) {
    map.fitBounds(nigeriaBounds, { padding: [18, 18] });
  }
  renderAreaReport();
  closeReportModal();
});

searchButton.addEventListener('click', searchArea);
searchInput.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') {
    event.preventDefault();
    searchArea();
  }
});

lgaSelect.addEventListener('change', () => {
  clearPollingUnitPointsLayer();
  loadedPoints = [];
  updateDetailsPanel();
  renderAllBoundaries();
  renderPollingUnitPointsLayer();
  renderAreaReport();
});

function openReportModal() {
  if (!reportModal) return;
  reportModal.classList.remove('is-hidden');
  document.body.style.overflow = 'hidden';
}

function closeReportModal() {
  if (!reportModal) return;
  reportModal.classList.add('is-hidden');
  document.body.style.overflow = '';
}

viewReportButton?.addEventListener('click', () => {
  renderAreaReport();
  openReportModal();
});

reportModalClose?.addEventListener('click', closeReportModal);
reportModalBackdrop?.addEventListener('click', (event) => {
  if (event.target === reportModalBackdrop) closeReportModal();
});
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && reportModal && !reportModal.classList.contains('is-hidden')) {
    closeReportModal();
  }
});

async function downloadPollingReportPdf() {
  const state = stateSelect.value;
  const lga = lgaSelect.value;
  if (!state) {
    alert('Select a state or LGA before downloading a report.');
    return;
  }

  if (!window.jspdf?.jsPDF) {
    alert('The PDF generator is not available. Please refresh the page and try again.');
    return;
  }

  const stateFeatures = allPollingUnitFeatures.filter(
    (feature) => normalizeLookupKey(feature.properties.state) === normalizeLookupKey(state)
  );
  const areaFeatures = lga
    ? stateFeatures.filter((feature) => normalizeLookupKey(feature.properties.lga) === normalizeLookupKey(lga))
    : stateFeatures;
  if (!areaFeatures.length) {
    alert('No polling units were found for the selected area.');
    return;
  }

  const stateLgas = (pollingData.lgas || []).filter(
    (row) => normalizeLookupKey(row.state) === normalizeLookupKey(state)
  );
  const highestLga = stateLgas.reduce((best, row) => !best || row.pollingUnits > best.pollingUnits ? row : best, null);
  const lowestLga = stateLgas.reduce((best, row) => !best || row.pollingUnits < best.pollingUnits ? row : best, null);
  const nearest = userLatLng
    ? areaFeatures
      .map((feature) => {
        const [lng, lat] = feature.geometry.coordinates || [];
        const distance = Number.isFinite(lat) && Number.isFinite(lng)
          ? userLatLng.distanceTo(L.latLng(lat, lng))
          : Infinity;
        return { feature, distance };
      })
      .filter((item) => Number.isFinite(item.distance))
      .sort((a, b) => a.distance - b.distance)[0]
    : null;

  let driving = null;
  if (nearest) {
    const [lng, lat] = nearest.feature.geometry.coordinates;
    driving = await fetchOsrmRouteMetrics([userLatLng.lng, userLatLng.lat], [lng, lat]);
  }

  const { jsPDF } = window.jspdf;
  const pdf = new jsPDF({ unit: 'mm', format: 'a4' });
  const pageWidth = pdf.internal.pageSize.getWidth();
  const margin = 16;
  const contentWidth = pageWidth - margin * 2;
  const areaName = lga ? `${lga}, ${state}` : `${state} State`;
  const addText = (text, x, y, maxWidth, options = {}) => {
    pdf.setFontSize(options.size || 10);
    pdf.setTextColor(...(options.color || [30, 48, 61]));
    pdf.setFont('helvetica', options.bold ? 'bold' : 'normal');
    pdf.text(pdf.splitTextToSize(String(text), maxWidth), x, y);
  };
  const metricCard = (x, y, label, value, color) => {
    pdf.setFillColor(...color);
    pdf.roundedRect(x, y, 54, 26, 3, 3, 'F');
    addText(label, x + 4, y + 8, 46, { size: 7.5, color: [255, 255, 255], bold: true });
    addText(value, x + 4, y + 18, 46, { size: 13, color: [255, 255, 255], bold: true });
  };

  pdf.setFillColor(14, 76, 96);
  pdf.rect(0, 0, pageWidth, 45, 'F');
  addText('POLLING UNITS ACCESSIBILITY REPORT', margin, 16, 170, { size: 17, color: [255, 255, 255], bold: true });
  addText(areaName, margin, 25, 170, { size: 12, color: [197, 240, 224], bold: true });
  addText(`Generated ${new Date().toLocaleDateString('en-NG', { dateStyle: 'long' })}`, margin, 34, 170, { size: 8, color: [224, 243, 248] });

  metricCard(margin, 53, 'STATE', state, [39, 132, 143]);
  metricCard(margin + 58, 53, 'NUMBER OF LGAS', formatNumber(stateLgas.length), [56, 115, 177]);
  metricCard(margin + 116, 53, 'IDENTIFIED POLLING UNITS', formatNumber(stateFeatures.length), [203, 107, 61]);

  addText('Polling unit coverage by LGA', margin, 92, contentWidth, { size: 13, bold: true, color: [14, 76, 96] });
  const maxValue = Math.max(highestLga?.pollingUnits || 1, lowestLga?.pollingUnits || 1);
  const chartRows = [
    { label: `Highest: ${highestLga?.lga || '--'}`, value: highestLga?.pollingUnits || 0, color: [28, 159, 118] },
    { label: `Lowest: ${lowestLga?.lga || '--'}`, value: lowestLga?.pollingUnits || 0, color: [235, 123, 72] },
  ];
  chartRows.forEach((row, index) => {
    const y = 101 + index * 18;
    addText(row.label, margin, y, 62, { size: 9, bold: true });
    pdf.setFillColor(228, 238, 241);
    pdf.roundedRect(margin + 64, y - 5, 94, 8, 2, 2, 'F');
    pdf.setFillColor(...row.color);
    pdf.roundedRect(margin + 64, y - 5, Math.max(4, 94 * row.value / maxValue), 8, 2, 2, 'F');
    addText(formatNumber(row.value), margin + 162, y + 1, 24, { size: 9, bold: true, color: row.color });
  });

  addText('Closest polling unit to you', margin, 146, contentWidth, { size: 13, bold: true, color: [14, 76, 96] });
  pdf.setFillColor(242, 250, 247);
  pdf.roundedRect(margin, 152, contentWidth, 37, 3, 3, 'F');
  if (nearest) {
    const props = nearest.feature.properties || {};
    const travelDistance = driving ? formatDistance(driving.distance || nearest.distance) : formatDistance(nearest.distance);
    const walkingTime = formatDuration(estimateWalkingDuration(nearest.distance));
    const drivingTime = driving ? formatDuration(driving.duration) : 'Road time unavailable';
    addText(props.name || 'Polling Unit', margin + 5, 162, contentWidth - 10, { size: 11, bold: true, color: [22, 91, 83] });
    addText([props.ward, props.lga, props.state].filter(Boolean).join(', '), margin + 5, 169, contentWidth - 10, { size: 8.5 });
    addText(`Travel distance: ${travelDistance}   |   Walking: ${walkingTime}   |   Driving: ${drivingTime}`, margin + 5, 180, contentWidth - 10, { size: 9, bold: true, color: [30, 48, 61] });
  } else {
    addText('Enable User Location before downloading the report to include the closest polling unit, travel distance, and travel time.', margin + 5, 164, contentWidth - 10, { size: 9 });
  }

  addText('Report scope', margin, 202, contentWidth, { size: 11, bold: true, color: [14, 76, 96] });
  addText(`The report covers ${lga ? `${lga} within ${state}` : `${state} State`} and is based on ${formatNumber(areaFeatures.length)} identified polling-unit records.`, margin, 211, contentWidth, { size: 9 });
  addText('Nigeria Election GIS Dashboard', margin, 283, contentWidth, { size: 8, color: [92, 112, 122] });

  const fileName = `${lga ? `${lga}-${state}` : state}-polling-units-report.pdf`
    .replace(/[^a-z0-9\-\.]+/gi, '-').toLowerCase();
  pdf.save(fileName);
}

if (downloadReportButton) {
  downloadReportButton.addEventListener('click', downloadPollingReportPdf);
}
downloadPdfReportButton?.addEventListener('click', downloadPollingReportPdf);

window.addEventListener('resize', () => window.requestAnimationFrame(() => map.invalidateSize()));

/* ── Init ───────────────────────────────────────────────────────────────── */
async function initPollingMap() {
  try {
    [adm0Data, adm1Data, adm2Data, pollingData] = await Promise.all([
      loadBoundary('data/boundaries/adm0.zip'),
      loadBoundary('data/boundaries/adm1.zip'),
      loadBoundary('data/boundaries/adm2.zip'),
      loadPollingDashboardData(),
    ]);

    // The selected-LGA outline uses the same complete ADM2 dataset as the map layer.
    lgaData = adm2Data;

    nigeriaBounds = L.geoJSON(adm0Data).getBounds();

    /* Try to load ward boundaries — optional */
    try {
      wardData = await loadBoundary('data/boundaries/adm3.zip');
      setWardStatus('', false);
    } catch {
      wardData = null;
      if (toggleWards.checked) {
        setWardStatus('Ward boundaries (adm3.zip) not found — add to data/boundaries/ to enable', true);
        setTimeout(() => setWardStatus('', false), 6000);
      }
    }

    populateStateOptions();
    updateLgaOptions();
    updateSourceDetails();
    loadWardAnalysisSummary();
    updateDetailsPanel();

    renderAllBoundaries();

    pollingSourceSummary.textContent = 'Select a state to display its polling-unit points.';
  } catch (error) {
    console.error('Failed to initialize polling dashboard:', error);
    pollingSourceSummary.textContent = error.message || 'Failed to load.';
    setSearchMessage('Polling unit dashboard failed to load.');
  }
}

initializePanelResizer();
ensurePollingPointsPane();
showPollingGuide();
initPollingMap();
