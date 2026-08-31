const map = L.map('populationMap', {
  zoomControl: true,
  attributionControl: true,
  maxBoundsViscosity: 1,
}).setView([9.082, 8.6753], 6);

const baseMaps = {
  hillshade: {
    label: 'Hillshade',
    iconClass: 'map-view-icon-hillshade',
    layer: L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Shaded_Relief/MapServer/tile/{z}/{y}/{x}', {
      maxZoom: 13,
      attribution: 'Tiles &copy; Esri',
      className: 'hillshade-base-map',
    }),
  },
  openstreet: {
    label: 'OpenStreetMap',
    iconClass: 'map-view-icon-streets',
    layer: L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; OpenStreetMap contributors',
      className: 'osm-base-map',
    }),
  },
  satellite: {
    label: 'Satellite',
    iconClass: 'map-view-icon-satellite',
    layer: L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
      maxZoom: 19,
      attribution: 'Tiles &copy; Esri',
      className: 'satellite-base-map',
    }),
  },
};

let activeBaseMapKey = 'openstreet';
baseMaps[activeBaseMapKey].layer.addTo(map);

const stateSelect = document.getElementById('stateSelect');
const lgaSelect = document.getElementById('lgaSelect');
const levelSelect = document.getElementById('levelSelect');
const areaSearchInput = document.getElementById('areaSearchInput');
const areaSearchButton = document.getElementById('areaSearchButton');
const areaSearchMessage = document.getElementById('areaSearchMessage');
const populationGrid = document.querySelector('.population-grid');
const panelResizer = document.getElementById('panelResizer');
const coverageCount = document.getElementById('coverageCount');
const selectedAreaLabel = document.getElementById('selectedAreaLabel');
const selectedAreaName = document.getElementById('selectedAreaName');
const populationLabel = document.getElementById('populationLabel');
const populationValue = document.getElementById('populationValue');
const registeredVotersLabel = document.getElementById('registeredVotersLabel');
const registeredVotersValue = document.getElementById('registeredVotersValue');
const collectedPVCLabel = document.getElementById('collectedPVCLabel');
const collectedPVCValue = document.getElementById('collectedPVCValue');
const pvcRateLabel = document.getElementById('pvcRateLabel');
const pvcRateValue = document.getElementById('pvcRateValue');
const governorPartyLabel = document.getElementById('governorPartyLabel');
const governorPartyValue = document.getElementById('governorPartyValue');
const coverageLabel = document.getElementById('coverageLabel');
const pvcDonut = document.getElementById('pvcDonut');
const collectedLegend = document.getElementById('collectedLegend');
const uncollectedLegend = document.getElementById('uncollectedLegend');
const pvcChartCard = document.getElementById('pvcChartCard');
const africaLocatorCard = document.getElementById('africaLocatorCard');
const africaLocatorMapElement = document.getElementById('africaLocatorMap');
const downloadReport = document.getElementById('downloadReport');
const populationSyncStatus = document.getElementById('populationSyncStatus');
const voterRatioLabel = document.getElementById('voterRatioLabel');
const voterRatioValue = document.getElementById('voterRatioValue');
const uncollectedPVCLabel = document.getElementById('uncollectedPVCLabel');
const uncollectedPVCValue = document.getElementById('uncollectedPVCValue');
const geopoliticalZoneLabel = document.getElementById('geopoliticalZoneLabel');
const geopoliticalZoneValue = document.getElementById('geopoliticalZoneValue');
const fillOpacityRange = document.getElementById('fillOpacityRange');
const fillOpacityValue = document.getElementById('fillOpacityValue');
const strokeWeightRange = document.getElementById('strokeWeightRange');
const strokeWeightValue = document.getElementById('strokeWeightValue');

let adm0Data = null;
let adm1Data = null;
let adm2Data = null;
let populationData = null;
let activeLayer = null;
let stateLgaOverlay = null;
let nigeriaBounds = null;
let currentReport = null;
let choroplethLegend = null;
let choroplethLegendElements = null;
let currentRenderFeatures = [];
let currentRenderLevel = 'state';
let currentLegendFeatures = [];
let currentLegendLevel = 'state';
let currentChoroplethBreaks = [];
let currentOverlayFeatures = [];
let currentOverlayLevel = 'lga';
let currentOverlayChoroplethBreaks = [];
let activeLegendClassIndex = null;
let activeLegendHoverClassIndex = null;
let activeLgaOverlayState = '';
let stateLgaOverlayFadeTimer = null;
let freePanEnabled = false;
let africaLocatorMap = null;
let africaNigeriaLayer = null;
let populationDataSignature = '';
let populationDataRefreshTimer = null;
let populationDataRefreshDeadline = 0;
let isRefreshingPopulationData = false;
let lastPopulationReconnectSignal = '';
let areaSearchIndex = [];
const customSelectControls = new Map();

// Mode tracking
let currentClickedState = '';
let clickedStateLabel = null;
let clickModeLgaOverlay = null;
let isSearchMode = false;
let searchModeLgaLayer = null;

const POPULATION_DATA_REFRESH_INTERVAL_MS = 5 * 1000;
const POPULATION_DATA_REFRESH_WINDOW_MS = 15 * 60 * 1000;
const POPULATION_DATA_RECONNECT_KEY = 'populationDataReconnectAt';
const NIGERIA_BOUNDS_PADDING = 0.08;
const CHOROPLETH_CLASS_COUNT = 5;
const CHOROPLETH_CLASS_SCHEME = [
  { color: '#f2f0f7', label: 'Lowest' },
  { color: '#dadaf6', label: 'Low' },
  { color: '#b197e8', label: 'Medium' },
  { color: '#8b5de9', label: 'High' },
  { color: '#5a2c9f', label: 'Highest' },
];
const CHOROPLETH_METRICS = {
  population: {
    title: 'Population Density',
    field: 'population',
  },
  registeredVoters: {
    title: 'Registered Voters',
    field: 'registeredVoters',
  },
};
let activeChoroplethMetric = 'population';
const NIGERIA_PROFILE = {
  location: 'West Africa',
  landArea: '923,768 km²',
  capital: 'Abuja',
  president: 'Bola Ahmed Tinubu',
  presidentParty: 'All Progressives Congress (APC)',
  stateCount: '36 states + FCT',
  lgaCount: '774 LGAs',
  government: 'Federal republic',
};

// UI overrides for choropleth rendering (controlled via sidebar sliders)
let globalFillOpacityPercent = 95; // percent
let globalStrokeWeight = 2; // pixels

const FALLBACK_NIGERIA_SUMMARY = {
  population: 360722474,
  registeredVoters: 186938016,
  collectedPVCs: 174418014,
  uncollectedPVCs: 12518460,
};

const STATE_LABEL_POSITIONS = {
  Abia: [5.45, 7.48],
  Bauchi: [10.3, 10.15],
  'Cross River': [5.85, 8.65],
  Delta: [5.65, 6.05],
  Jigawa: [12.05, 9.55],
  Katsina: [12.55, 7.65],
  Kebbi: [11.35, 4.25],
  Ogun: [6.85, 3.35],
  Ondo: [7.05, 5.05],
};

function getStateName(feature) {
  return feature.properties.NAME_1 || 'Unknown State';
}

function normalizeStateName(state) {
  const normalizedKey = normalizeLookupKey(state);

  if (
    normalizedKey === 'fct' ||
    normalizedKey === 'fctabuja' ||
    normalizedKey === 'federalcapitalterritory' ||
    normalizedKey === 'abuja'
  ) {
    return 'FCT / Abuja';
  }

  if (state === 'Nassarawa') {
    return 'Nasarawa';
  }

  return state;
}

function normalizeLookupKey(value) {
  return String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]/gi, '')
    .replace(/^nassaraw$/i, 'nasarawa')
    .replace(/nassarawa/gi, 'nasarawa')
    .toLowerCase();
}

function normalizeStateLookupKey(value) {
  const key = normalizeLookupKey(value);

  if (
    key === 'fct' ||
    key === 'fctabuja' ||
    key === 'federalcapitalterritory' ||
    key === 'abuja'
  ) {
    return 'fctabuja';
  }

  return key;
}

function normalizeLgaLookupKey(state, lga) {
  const stateKey = normalizeStateLookupKey(state);
  const lgaKey = normalizeLookupKey(lga);

  if (stateKey === 'fctabuja' && (lgaKey.includes('municipal') || lgaKey.includes('areacouncil'))) {
    return 'municipalareacouncil';
  }

  return lgaKey;
}

function getStateLabel(feature) {
  return normalizeStateName(getStateName(feature));
}

function getLgaName(feature) {
  return feature.properties.NAME_2 || 'Unknown LGA';
}

function isWaterBody(feature) {
  return getStateName(feature).toLowerCase() === 'water body';
}

function getBoundaryFeatures(data) {
  return data.features.filter((feature) => !isWaterBody(feature));
}

function pointInRing(point, ring) {
  let inside = false;

  for (let index = 0, previous = ring.length - 1; index < ring.length; previous = index += 1) {
    const [currentX, currentY] = ring[index];
    const [previousX, previousY] = ring[previous];
    const intersects =
      currentY > point[1] !== previousY > point[1] &&
      point[0] <
        ((previousX - currentX) * (point[1] - currentY)) / (previousY - currentY) + currentX;

    if (intersects) {
      inside = !inside;
    }
  }

  return inside;
}

function pointInPolygonCoordinates(point, coordinates) {
  if (!Array.isArray(coordinates) || !coordinates.length) {
    return false;
  }

  return coordinates.some((polygon) => {
    if (!Array.isArray(polygon) || !polygon.length) {
      return false;
    }

    const [outerRing, ...holes] = polygon;
    if (!pointInRing(point, outerRing)) {
      return false;
    }

    return !holes.some((hole) => pointInRing(point, hole));
  });
}

function geometryContainsPoint(geometry, point) {
  if (!geometry?.type) {
    return false;
  }

  if (geometry.type === 'Polygon') {
    return pointInPolygonCoordinates(point, [geometry.coordinates]);
  }

  if (geometry.type === 'MultiPolygon') {
    return pointInPolygonCoordinates(point, geometry.coordinates);
  }

  return false;
}

function findStateContainingPoint(latlng) {
  if (!adm1Data || !latlng) {
    return null;
  }

  const point = [latlng.lng, latlng.lat];

  return getBoundaryFeatures(adm1Data).find((feature) => geometryContainsPoint(feature.geometry, point)) || null;
}

function formatNumber(value, maximumFractionDigits = 0) {
  if (value === null || value === undefined || value === '') {
    return '--';
  }

  return Number(value).toLocaleString(undefined, { maximumFractionDigits });
}

function formatPercent(value) {
  if (value === null || value === undefined || value === '') {
    return '--';
  }

  return `${Number(value).toFixed(1)}%`;
}

function getStatePopulation(state) {
  const stateKey = normalizeStateLookupKey(state);
  return populationData.statePopulation.find((row) => normalizeStateLookupKey(row.state) === stateKey);
}

function getLgaPopulation(state, lga) {
  const stateKey = normalizeStateLookupKey(state);
  const lgaKey = normalizeLgaLookupKey(state, lga);
  return populationData.lgaPopulation.find(
    (row) =>
      normalizeStateLookupKey(row.state) === stateKey &&
      normalizeLgaLookupKey(row.state, row.lga) === lgaKey
  );
}

function getGovernor(state) {
  const stateKey = normalizeStateLookupKey(state);
  return populationData.governors.find((row) => normalizeStateLookupKey(row.state) === stateKey);
}

function getPartyLogo(party) {
  if (!party) {
    return '';
  }

  const governorLogo = populationData.governors.find((row) => row.party === party)?.partyLogo;
  const chairmanLogo = populationData.lgaChairmen?.find((row) => row.party === party)?.partyLogo;

  return governorLogo || chairmanLogo || '';
}

function getLgaChairmanInfo(state, lga) {
  const stateKey = normalizeStateLookupKey(state);
  const lgaKey = normalizeLgaLookupKey(state, lga);
  const sources = [
    ...(populationData.lgaChairmen || []),
    ...(populationData.localGovernmentChairmen || []),
    ...(populationData.chairmen || []),
  ];
  const chairmanRow = sources.find(
    (row) =>
      normalizeStateLookupKey(row.state) === stateKey &&
      [row.lga, row.sourceLga].some(
        (candidate) => normalizeLgaLookupKey(row.state, candidate) === lgaKey
      )
  );
  const lgaRow = getLgaPopulation(state, lga);

  return {
    name: chairmanRow?.chairman || chairmanRow?.name || lgaRow?.chairman || lgaRow?.chairperson,
    party: chairmanRow?.party || lgaRow?.party,
  };
}

function getSearchModeLgaLabel(feature) {
  const state = getStateName(feature);
  const lga = getLgaName(feature);
  const lgaRow = getLgaPopulation(state, lga);
  const registeredVoters = lgaRow?.registeredVoters ?? getEstimatedLgaRegisteredVoters(state, lga);

  return `
    <strong>${lga}</strong>
    <span>Population: ${formatNumber(lgaRow?.population)}</span>
    <span>Registered Voters: ${formatNumber(registeredVoters)}</span>
  `;
}

function getStateLgaCount(state) {
  const stateKey = normalizeStateLookupKey(state);
  return getBoundaryFeatures(adm2Data).filter(
    (feature) => normalizeStateLookupKey(getStateLabel(feature)) === stateKey
  ).length;
}

function getNigeriaSummary() {
  if (!populationData?.statePopulation?.length) {
    return FALLBACK_NIGERIA_SUMMARY;
  }

  return populationData.statePopulation.reduce(
    (summary, row) => ({
      population: summary.population + row.population,
      registeredVoters: summary.registeredVoters + row.registeredVoters,
      collectedPVCs: summary.collectedPVCs + row.collectedPVCs,
      uncollectedPVCs: summary.uncollectedPVCs + row.uncollectedPVCs,
    }),
    {
      population: 0,
      registeredVoters: 0,
      collectedPVCs: 0,
      uncollectedPVCs: 0,
    }
  );
}

function getFeatureDataRow(feature, level) {
  const state = getStateName(feature);

  if (level === 'country') {
    return getNigeriaSummary();
  }

  if (level === 'lga') {
    const lgaRow = getLgaPopulation(state, getLgaName(feature));

    if (lgaRow?.[CHOROPLETH_METRICS[activeChoroplethMetric].field] !== undefined) {
      return lgaRow;
    }

    return getStatePopulation(state);
  }

  return getStatePopulation(state);
}

function getStateLgaPopulationRows(state) {
  const stateKey = normalizeStateLookupKey(state);
  return (populationData.lgaPopulation || []).filter(
    (row) => normalizeStateLookupKey(row.state) === stateKey
  );
}

function getEstimatedLgaRegisteredVoters(state, lga) {
  const stateRow = getStatePopulation(state);
  const lgaRows = getStateLgaPopulationRows(state);
  const lgaRow = lgaRows.find((row) => normalizeLookupKey(row.lga) === normalizeLookupKey(lga));
  const stateLgaPopulation = lgaRows.reduce((total, row) => total + Number(row.population || 0), 0);

  if (!stateRow?.registeredVoters || !lgaRow?.population || !stateLgaPopulation) {
    return null;
  }

  return (Number(lgaRow.population) / stateLgaPopulation) * Number(stateRow.registeredVoters);
}

function getFeatureMetricValue(feature, level = currentRenderLevel) {
  if (!populationData || !CHOROPLETH_METRICS[activeChoroplethMetric]) {
    return null;
  }

  const field = CHOROPLETH_METRICS[activeChoroplethMetric].field;

  if (level === 'lga' && field === 'registeredVoters') {
    return getEstimatedLgaRegisteredVoters(getStateName(feature), getLgaName(feature));
  }

  const row = getFeatureDataRow(feature, level);
  const value = Number(row?.[field]);

  return Number.isFinite(value) ? value : null;
}

function getMetricValues(features = currentLegendFeatures, level = currentLegendLevel) {
  return features
    .map((feature) => getFeatureMetricValue(feature, level))
    .filter((value) => Number.isFinite(value));
}

function calculateJenksBreaks(values, classCount = CHOROPLETH_CLASS_COUNT) {
  const sortedValues = values
    .filter((value) => Number.isFinite(value))
    .map(Number)
    .sort((a, b) => a - b);

  if (!sortedValues.length) {
    return [];
  }

  if (sortedValues.length === 1) {
    return Array.from({ length: classCount }, () => sortedValues[0]);
  }

  const classTotal = Math.min(classCount, sortedValues.length);
  const lowerClassLimits = Array.from({ length: sortedValues.length + 1 }, () =>
    Array(classTotal + 1).fill(0)
  );
  const varianceCombinations = Array.from({ length: sortedValues.length + 1 }, () =>
    Array(classTotal + 1).fill(0)
  );

  for (let i = 1; i <= classTotal; i += 1) {
    lowerClassLimits[1][i] = 1;
    varianceCombinations[1][i] = 0;
    for (let j = 2; j <= sortedValues.length; j += 1) {
      varianceCombinations[j][i] = Infinity;
    }
  }

  for (let l = 2; l <= sortedValues.length; l += 1) {
    let sum = 0;
    let sumSquares = 0;
    let weight = 0;
    let variance = 0;

    for (let m = 1; m <= l; m += 1) {
      const lowerClassLimit = l - m + 1;
      const value = sortedValues[lowerClassLimit - 1];

      weight += 1;
      sum += value;
      sumSquares += value * value;
      variance = sumSquares - (sum * sum) / weight;

      const previousIndex = lowerClassLimit - 1;

      if (previousIndex !== 0) {
        for (let j = 2; j <= classTotal; j += 1) {
          const candidateVariance = variance + varianceCombinations[previousIndex][j - 1];

          if (
            varianceCombinations[l][j] === 0 ||
            candidateVariance < varianceCombinations[l][j]
          ) {
            lowerClassLimits[l][j] = lowerClassLimit;
            varianceCombinations[l][j] = candidateVariance;
          }
        }
      }
    }

    lowerClassLimits[l][1] = 1;
    varianceCombinations[l][1] = variance;
  }

  const breaks = Array(classTotal).fill(sortedValues[sortedValues.length - 1]);
  let currentCount = sortedValues.length;

  for (let j = classTotal; j >= 2; j -= 1) {
    const lowerLimit = lowerClassLimits[currentCount][j] || 1;
    breaks[j - 2] = sortedValues[Math.max(lowerLimit - 2, 0)];
    currentCount = lowerLimit - 1;
  }

  while (breaks.length < classCount) {
    breaks.push(sortedValues[sortedValues.length - 1]);
  }

  return breaks;
}

function getChoroplethClassIndex(value, breaks = currentChoroplethBreaks) {
  if (!Number.isFinite(value) || !Array.isArray(breaks) || !breaks.length) {
    return null;
  }

  for (let index = 0; index < breaks.length; index += 1) {
    if (value <= breaks[index]) {
      return index;
    }
  }

  return breaks.length - 1;
}

function getChoroplethClassColor(classIndex) {
  return CHOROPLETH_CLASS_SCHEME[classIndex]?.color || '#6f7d78';
}

function setChoroplethContext(features, level, scope = 'base') {
  const breaks = calculateJenksBreaks(getMetricValues(features, level), CHOROPLETH_CLASS_COUNT);

  if (scope === 'overlay') {
    currentOverlayFeatures = features;
    currentOverlayLevel = level;
    currentOverlayChoroplethBreaks = breaks;
    return;
  }

  currentLegendFeatures = features;
  currentLegendLevel = level;
  currentChoroplethBreaks = breaks;
}

function setActiveLegendClass(classIndex) {
  activeLegendClassIndex = classIndex === activeLegendClassIndex ? null : classIndex;
}

function setHoveredLegendClass(classIndex) {
  activeLegendHoverClassIndex = classIndex;
}

function getLegendClassState(classIndex) {
  const activeClassIndex =
    activeLegendClassIndex !== null ? activeLegendClassIndex : activeLegendHoverClassIndex;

  if (activeClassIndex === null) {
    return 'default';
  }

  return activeClassIndex === classIndex ? 'active' : 'muted';
}

function getLegendLayerStyle(feature, level, breaks = currentChoroplethBreaks) {
  const metricValue = getFeatureMetricValue(feature, level);
  const classIndex = getChoroplethClassIndex(metricValue, breaks);
  const classState = getLegendClassState(classIndex);
  const baseFillOpacity = level === 'country' ? 0.46 : level === 'state' ? 0.82 : 0.68;
  const isMuted = classState === 'muted';
  const isActive = classState === 'active';

  const baseColor = isMuted ? 'rgba(13, 37, 44, 0.28)' : level === 'lga' ? '#1f6f54' : '#0b4d36';
  const baseWeight = isActive ? 3 : level === 'country' ? 3.4 : level === 'state' ? 2.4 : 1.2;
  const finalWeight = typeof globalStrokeWeight === 'number' && globalStrokeWeight >= 0 ? globalStrokeWeight : baseWeight;
  const baseFill = classIndex === null ? baseFillOpacity : isMuted ? 0.45 : 0.95;
  const finalFillOpacity = Math.min(1, Math.max(0, baseFill * (Number(globalFillOpacityPercent) / 100)));

  return {
    color: baseColor,
    weight: finalWeight,
    opacity: isMuted ? 0.5 : 1,
    fillColor: classIndex === null ? '#6f7d78' : getChoroplethClassColor(classIndex),
    fillOpacity: finalFillOpacity,
    dashArray: isMuted ? '3 4' : '',
  };
}

function updateRenderedLayerStyles() {
  [activeLayer, stateLgaOverlay].forEach((layerGroup) => {
    if (!layerGroup?.eachLayer) {
      return;
    }

    layerGroup.eachLayer((layer) => {
      const feature = layer.feature;
      if (!feature) {
        return;
      }

      if (layerGroup === stateLgaOverlay) {
        layer.setStyle(getLegendLayerStyle(feature, currentOverlayLevel, currentOverlayChoroplethBreaks));
        return;
      }

      layer.setStyle(getLegendLayerStyle(feature, currentRenderLevel, currentChoroplethBreaks));
    });
  });
}

function refreshChoroplethRendering() {
  const renderLevel = currentRenderLevel || levelSelect.value;
  const renderOptions =
    renderLevel === 'state'
      ? { fitBounds: false, selectedState: stateSelect.value || undefined, selectedLga: '' }
      : {
          fitBounds: false,
          selectedState: stateSelect.value || undefined,
          selectedLga: lgaSelect.value || '',
        };

  renderLayer(renderLevel, renderOptions);

  updateChoroplethLegend();
  updateRenderedLayerStyles();
}

function getChoroplethLegendRanges(values, breaks) {
  if (!values.length) {
    return CHOROPLETH_CLASS_SCHEME.map(() => ({
      min: null,
      max: null,
    }));
  }

  const sortedValues = [...values].sort((a, b) => a - b);

  return CHOROPLETH_CLASS_SCHEME.map((_, classIndex) => {
    const classValues = sortedValues.filter((value) => getChoroplethClassIndex(value, breaks) === classIndex);

    if (classValues.length) {
      return {
        min: classValues[0],
        max: classValues[classValues.length - 1],
      };
    }

    const lowerBound = classIndex === 0 ? sortedValues[0] : breaks[classIndex - 1] ?? sortedValues[0];
    const upperBound = breaks[classIndex] ?? sortedValues[sortedValues.length - 1];

    return {
      min: lowerBound,
      max: Math.max(lowerBound, upperBound),
    };
  });
}

function setStat(labelElement, valueElement, label, value, hidden = false) {
  labelElement.textContent = label;
  valueElement.textContent = value;
  valueElement.title = String(value);
  valueElement.closest('.stat-card').classList.toggle('is-hidden', hidden);
}

function setPvcChartVisibility(isVisible) {
  pvcChartCard.classList.toggle('is-hidden', !isVisible);
}

function initializeAfricaLocatorMap() {
  if (africaLocatorMap || !africaLocatorMapElement || !adm0Data) {
    return;
  }

  africaLocatorMap = L.map(africaLocatorMapElement, {
    attributionControl: false,
    zoomControl: true,
    dragging: true,
    doubleClickZoom: true,
    boxZoom: true,
    keyboard: true,
    scrollWheelZoom: true,
    tap: true,
  }).setView([3.5, 20], 2);

  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 6,
    minZoom: 2,
    className: 'africa-locator-tiles',
  }).addTo(africaLocatorMap);

  africaNigeriaLayer = L.geoJSON(adm0Data, {
    interactive: false,
    style: {
      color: '#0b4d36',
      fillColor: '#bdeccf',
      fillOpacity: 0.88,
      opacity: 1,
      weight: 2,
    },
  }).addTo(africaLocatorMap);
}

function setAfricaLocatorVisibility(isVisible) {
  africaLocatorCard.classList.toggle('is-hidden', !isVisible);

  if (!isVisible) {
    return;
  }

  initializeAfricaLocatorMap();
  window.requestAnimationFrame(() => {
    africaLocatorMap?.invalidateSize();
    africaLocatorMap?.setView([3.5, 20], 2, { animate: false });
  });
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function setDetailsPanelWidth(width) {
  if (!populationGrid) {
    return;
  }

  const gridWidth = populationGrid.getBoundingClientRect().width;
  const maxWidth = Math.max(260, gridWidth - 320);
  const nextWidth = clamp(width, 240, maxWidth);
  populationGrid.style.setProperty('--details-panel-width', `${nextWidth}px`);

  window.requestAnimationFrame(() => {
    map.invalidateSize();
    keepMapFocusedOnNigeria();
  });
}

function initializePanelResizer() {
  if (!populationGrid || !panelResizer) {
    return;
  }

  let isResizing = false;

  const resizeFromPointer = (clientX) => {
    const gridBounds = populationGrid.getBoundingClientRect();
    setDetailsPanelWidth(gridBounds.right - clientX);
  };

  panelResizer.addEventListener('pointerdown', (event) => {
    isResizing = true;
    panelResizer.setPointerCapture(event.pointerId);
    populationGrid.classList.add('is-resizing');
    resizeFromPointer(event.clientX);
  });

  panelResizer.addEventListener('pointermove', (event) => {
    if (!isResizing) {
      return;
    }

    resizeFromPointer(event.clientX);
  });

  panelResizer.addEventListener('pointerup', (event) => {
    isResizing = false;
    panelResizer.releasePointerCapture(event.pointerId);
    populationGrid.classList.remove('is-resizing');
  });

  panelResizer.addEventListener('pointercancel', () => {
    isResizing = false;
    populationGrid.classList.remove('is-resizing');
  });

  panelResizer.addEventListener('keydown', (event) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') {
      return;
    }

    event.preventDefault();
    const currentWidth =
      parseFloat(getComputedStyle(populationGrid).getPropertyValue('--details-panel-width')) || 300;
    const delta = event.key === 'ArrowLeft' ? 24 : -24;
    setDetailsPanelWidth(currentWidth + delta);
  });
}

function setProfileCard() {
  // Profile card removed from the sidebar; keep this hook for existing selection flows.
}

function setDonut(collectedRate, uncollectedRate) {
  if (!collectedRate && !uncollectedRate) {
    pvcDonut.style.background = 'conic-gradient(#5fe09b 0 0, #20343d 0 100%)';
    collectedLegend.textContent = '--';
    uncollectedLegend.textContent = '--';
    return;
  }

  pvcDonut.style.background = `conic-gradient(#18a768 0 ${collectedRate}%, #f0c95b ${collectedRate}% 100%)`;
  collectedLegend.textContent = formatPercent(collectedRate);
  uncollectedLegend.textContent = formatPercent(uncollectedRate);
}

function initializeOpacityControls() {
  if (fillOpacityRange && fillOpacityValue) {
    fillOpacityRange.addEventListener('input', (e) => {
      globalFillOpacityPercent = Number(e.target.value);
      fillOpacityValue.textContent = `${globalFillOpacityPercent}%`;
      updateRenderedLayerStyles();
    });
    // set initial display
    fillOpacityValue.textContent = `${globalFillOpacityPercent}%`;
  }

  if (strokeWeightRange && strokeWeightValue) {
    strokeWeightRange.addEventListener('input', (e) => {
      globalStrokeWeight = Number(e.target.value);
      strokeWeightValue.textContent = `${globalStrokeWeight}`;
      updateRenderedLayerStyles();
    });
    strokeWeightValue.textContent = `${globalStrokeWeight}`;
  }
}

function updateDetailsPanel(selection = {}) {
  const { state, lga, level = levelSelect.value } = selection;

  if (!populationData && !state && !lga && level !== 'country') {
    const summary = getNigeriaSummary();
    const collectedRate = (summary.collectedPVCs / summary.registeredVoters) * 100;
    const uncollectedRate = (summary.uncollectedPVCs / summary.registeredVoters) * 100;

    selectedAreaLabel.textContent = 'Selected Area';
    selectedAreaName.textContent = 'Nigeria';
    setProfileCard({});
    setStat(populationLabel, populationValue, 'Population', formatNumber(summary.population));
    setStat(
      registeredVotersLabel,
      registeredVotersValue,
      'Registered Voters',
      formatNumber(summary.registeredVoters)
    );
    setStat(collectedPVCLabel, collectedPVCValue, 'Collected PVCs', formatNumber(summary.collectedPVCs));
    setStat(pvcRateLabel, pvcRateValue, 'PVC Collection Rate', formatPercent(collectedRate));
    setStat(uncollectedPVCLabel, uncollectedPVCValue, 'Uncollected PVCs', formatNumber(summary.uncollectedPVCs));
    setStat(voterRatioLabel, voterRatioValue, 'Voter / Pop. Ratio', formatPercent((summary.registeredVoters / summary.population) * 100));
    setStat(governorPartyLabel, governorPartyValue, 'Governor / Party', '36 governors + FCT');
    setStat(geopoliticalZoneLabel, geopoliticalZoneValue, 'Geopolitical Zone', 'All 6 Zones');
    coverageCount.closest('.stat-card').classList.remove('is-hidden');
    coverageLabel.textContent = 'Administrative Coverage';
    coverageCount.textContent = '36 states + FCT / 774 LGAs';
    setAfricaLocatorVisibility(false);
    setPvcChartVisibility(true);
    setDonut(collectedRate, uncollectedRate);
    return;
  }

  if (level === 'country') {
    const summary = getNigeriaSummary();
    const countryCollectedRate = (summary.collectedPVCs / summary.registeredVoters) * 100;
    const countryUncollectedRate = (summary.uncollectedPVCs / summary.registeredVoters) * 100;

    selectedAreaLabel.textContent = 'Country';
    selectedAreaName.textContent = 'Nigeria';
    setProfileCard({});
    setStat(populationLabel, populationValue, 'Total Population', formatNumber(summary.population));
    setStat(registeredVotersLabel, registeredVotersValue, 'Registered Voters', formatNumber(summary.registeredVoters));
    setStat(voterRatioLabel, voterRatioValue, 'Voter / Pop. Ratio', formatPercent((summary.registeredVoters / summary.population) * 100));
    setStat(collectedPVCLabel, collectedPVCValue, 'Collected PVCs', formatNumber(summary.collectedPVCs));
    setStat(pvcRateLabel, pvcRateValue, 'PVC Collection Rate', formatPercent(countryCollectedRate));
    setStat(uncollectedPVCLabel, uncollectedPVCValue, 'Uncollected PVCs', formatNumber(summary.uncollectedPVCs));
    setStat(
      governorPartyLabel,
      governorPartyValue,
      'President / Party',
      `${NIGERIA_PROFILE.president} (${NIGERIA_PROFILE.presidentParty})`
    );
    setStat(geopoliticalZoneLabel, geopoliticalZoneValue, 'Geopolitical Zones', '6 Zones');
    coverageLabel.textContent = 'Administrative Coverage';
    coverageCount.closest('.stat-card').classList.remove('is-hidden');
    coverageCount.textContent = `${NIGERIA_PROFILE.stateCount} / ${NIGERIA_PROFILE.lgaCount}`;
    setAfricaLocatorVisibility(true);
    setPvcChartVisibility(false);

    currentReport = {
      title: 'Nigeria Country Profile',
      rows: [
        ['Area Type', 'Country'],
        ['Country', 'Nigeria'],
        ['Total Population', formatNumber(summary.population)],
        ['Number of States', NIGERIA_PROFILE.stateCount],
        ['Number of LGAs', NIGERIA_PROFILE.lgaCount],
        ['Size', NIGERIA_PROFILE.landArea],
        ['Location', NIGERIA_PROFILE.location],
        ['Capital', NIGERIA_PROFILE.capital],
        ['President', NIGERIA_PROFILE.president],
        ['Political Party', NIGERIA_PROFILE.presidentParty],
        ['Government', NIGERIA_PROFILE.government],
      ],
    };

    return;
  }

  if (lga && state) {
    const lgaRow = getLgaPopulation(state, lga);
    const chairman = getLgaChairmanInfo(state, lga);
    const chairmanLabel = chairman.name
      ? `${chairman.name}${chairman.party ? ` (${chairman.party})` : ''}`
      : 'Not available';
    const chairmanPartyLogo = getPartyLogo(chairman.party);

    selectedAreaLabel.textContent = 'Selected LGA';
    selectedAreaName.textContent = `${lga}, ${normalizeStateName(state)}`;
    setProfileCard({
      label: 'Chairman / Party',
      name: chairman.name || 'Not available',
      logo: chairmanPartyLogo,
      logoAlt: chairman.party ? `${chairman.party} logo` : '',
    });
    const lgaGovernor = getGovernor(state);
    setStat(populationLabel, populationValue, 'Population', lgaRow ? formatNumber(lgaRow.population, 0) : '--');
    setStat(registeredVotersLabel, registeredVotersValue, 'State', normalizeStateName(state));
    setStat(voterRatioLabel, voterRatioValue, 'Administrative Level', 'LGA');
    setStat(collectedPVCLabel, collectedPVCValue, 'LGA Chairman / Party', chairmanLabel);
    setStat(pvcRateLabel, pvcRateValue, 'PVC Collection Rate', '--');
    setStat(uncollectedPVCLabel, uncollectedPVCValue, 'Uncollected PVCs', '--');
    setStat(governorPartyLabel, governorPartyValue, 'Governor / Party', lgaGovernor ? `${lgaGovernor.governor} (${lgaGovernor.party})` : '--');
    setStat(geopoliticalZoneLabel, geopoliticalZoneValue, 'Geopolitical Zone', lgaGovernor?.geopoliticalZone || '--');
    coverageLabel.textContent = 'Administrative Coverage';
    coverageCount.closest('.stat-card').classList.add('is-hidden');
    setAfricaLocatorVisibility(false);
    setPvcChartVisibility(false);

    currentReport = {
      title: `${lga}, ${normalizeStateName(state)} LGA Report`,
      rows: [
        ['Area Type', 'LGA'],
        ['State', normalizeStateName(state)],
        ['LGA', lga],
        ['Population', formatNumber(lgaRow?.population)],
        ['Local Government Chairman', chairman.name || 'Not available'],
        ['Political Party', chairman.party || 'Not available'],
        ['Available Data', 'Population and chairman'],
      ],
      partyLogo: chairmanPartyLogo,
    };

    return;
  }

  if (state) {
    const stateRow = getStatePopulation(state);
    const governor = getGovernor(state);
    const statePartyLogo = getPartyLogo(governor?.party);
    const lgaCount = getStateLgaCount(state);

    selectedAreaLabel.textContent = 'Selected State';
    selectedAreaName.textContent = normalizeStateName(state);
    setProfileCard({
      label: 'Governor / Party',
      name: governor ? `${governor.governor} (${governor.party})` : 'Not available',
      logo: statePartyLogo,
      logoAlt: governor?.party ? `${governor.party} logo` : '',
    });
    setStat(populationLabel, populationValue, 'Population', stateRow ? formatNumber(stateRow.population) : '--');
    setStat(registeredVotersLabel, registeredVotersValue, 'Registered Voters', stateRow ? formatNumber(stateRow.registeredVoters) : '--');
    setStat(voterRatioLabel, voterRatioValue, 'Voter / Pop. Ratio', stateRow ? formatPercent((stateRow.registeredVoters / stateRow.population) * 100) : '--');
    setStat(collectedPVCLabel, collectedPVCValue, 'Collected PVCs', stateRow ? formatNumber(stateRow.collectedPVCs) : '--');
    setStat(pvcRateLabel, pvcRateValue, 'PVC Collection Rate', stateRow ? formatPercent(stateRow.pvcCollectionRate) : '--');
    setStat(uncollectedPVCLabel, uncollectedPVCValue, 'Uncollected PVCs', stateRow ? formatNumber(stateRow.uncollectedPVCs) : '--');
    setStat(governorPartyLabel, governorPartyValue, 'Governor / Party', governor ? `${governor.governor} (${governor.party})` : '--');
    setStat(geopoliticalZoneLabel, geopoliticalZoneValue, 'Geopolitical Zone', governor?.geopoliticalZone || '--');
    coverageCount.closest('.stat-card').classList.remove('is-hidden');
    coverageLabel.textContent = 'Number of LGAs';
    coverageCount.textContent = `${lgaCount.toLocaleString()} LGAs`;
    setAfricaLocatorVisibility(false);
    setPvcChartVisibility(true);
    setDonut(stateRow?.pvcCollectionRate, stateRow?.uncollectedRate);

    currentReport = {
      title: `${normalizeStateName(state)} State Report`,
      rows: [
        ['Area Type', 'State'],
        ['State', normalizeStateName(state)],
        ['Population', formatNumber(stateRow?.population)],
        ['Registered Voters', formatNumber(stateRow?.registeredVoters)],
        ['Collected PVCs', formatNumber(stateRow?.collectedPVCs)],
        ['PVC Collection Rate', formatPercent(stateRow?.pvcCollectionRate)],
        ['Uncollected PVCs', formatNumber(stateRow?.uncollectedPVCs)],
        ['Uncollected Rate', formatPercent(stateRow?.uncollectedRate)],
        ['Governor', governor?.governor || '--'],
        ['Party', governor?.party || '--'],
        ['Number of LGAs', lgaCount.toLocaleString()],
        ['Geopolitical Zone', governor?.geopoliticalZone || '--'],
      ],
      partyLogo: statePartyLogo,
    };

    return;
  }

  const summary = getNigeriaSummary();
  const collectedRate = (summary.collectedPVCs / summary.registeredVoters) * 100;
  const uncollectedRate = (summary.uncollectedPVCs / summary.registeredVoters) * 100;

  selectedAreaLabel.textContent = 'Selected Area';
  selectedAreaName.textContent = 'Nigeria';
  setProfileCard({});
  setStat(populationLabel, populationValue, 'Population', formatNumber(summary.population));
  setStat(registeredVotersLabel, registeredVotersValue, 'Registered Voters', formatNumber(summary.registeredVoters));
  setStat(voterRatioLabel, voterRatioValue, 'Voter / Pop. Ratio', formatPercent((summary.registeredVoters / summary.population) * 100));
  setStat(collectedPVCLabel, collectedPVCValue, 'Collected PVCs', formatNumber(summary.collectedPVCs));
  setStat(pvcRateLabel, pvcRateValue, 'PVC Collection Rate', formatPercent(collectedRate));
  setStat(uncollectedPVCLabel, uncollectedPVCValue, 'Uncollected PVCs', formatNumber(summary.uncollectedPVCs));
  setStat(governorPartyLabel, governorPartyValue, 'Governor / Party', '36 governors + FCT');
  setStat(geopoliticalZoneLabel, geopoliticalZoneValue, 'Geopolitical Zone', 'All 6 Zones');
  coverageCount.closest('.stat-card').classList.remove('is-hidden');
  coverageLabel.textContent = 'Administrative Coverage';
  coverageCount.textContent = '36 states + FCT / 774 LGAs';
  setAfricaLocatorVisibility(false);
  setPvcChartVisibility(true);
  setDonut(collectedRate, uncollectedRate);

  currentReport = {
    title: 'Nigeria Population and PVC Report',
    rows: [
      ['Area Type', 'National State Summary'],
      ['Country', 'Nigeria'],
      ['Population', formatNumber(summary.population)],
      ['Registered Voters', formatNumber(summary.registeredVoters)],
      ['Collected PVCs', formatNumber(summary.collectedPVCs)],
      ['PVC Collection Rate', formatPercent(collectedRate)],
      ['Uncollected PVCs', formatNumber(summary.uncollectedPVCs)],
      ['Uncollected Rate', formatPercent(uncollectedRate)],
    ],
  };
}

function refreshDetailsPanel() {
  updateDetailsPanel({
    level: levelSelect.value,
    state: stateSelect.value,
    lga: lgaSelect.value,
  });
}

function clearActiveLayer() {
  if (activeLayer) {
    map.removeLayer(activeLayer);
    activeLayer = null;
  }

  clearStateLgaOverlay();
}

function clearStateLgaOverlay() {
  if (stateLgaOverlay) {
    const overlayToFade = stateLgaOverlay;
    stateLgaOverlay = null;

    overlayToFade.eachLayer((layer) => {
      layer.setStyle({ opacity: 0, fillOpacity: 0 });
    });

    if (stateLgaOverlayFadeTimer) {
      clearTimeout(stateLgaOverlayFadeTimer);
    }

    stateLgaOverlayFadeTimer = window.setTimeout(() => {
      map.removeLayer(overlayToFade);
      stateLgaOverlayFadeTimer = null;
    }, 220);
  }

  activeLgaOverlayState = '';
  currentOverlayFeatures = [];
  currentOverlayLevel = 'lga';
  currentOverlayChoroplethBreaks = [];
  setChoroplethContext(currentRenderFeatures, currentRenderLevel);
  setHoveredLegendClass(null);
  updateChoroplethLegend();
}

// ── Shared mode cleanup ─────────────────────────────────────────────────────

function clearAllModes() {
  if (isSearchMode) {
    isSearchMode = false;
    clearSearchModeLgaLayer();
  }
  if (currentClickedState) {
    currentClickedState = '';
    clearClickedStateLabel();
    clearClickModeLgaOverlay();
    map.getContainer().classList.remove('state-labels-hidden');
  }
}

// ── MODE 1: Click-to-highlight (all states remain visible) ──────────────────

function applyMode1StateStyles() {
  if (!activeLayer) return;
  activeLayer.eachLayer((layer) => {
    const feature = layer.feature;
    if (!feature) return;
    const isSelected =
      normalizeStateLookupKey(getStateName(feature)) === normalizeStateLookupKey(currentClickedState);
    const base = getLegendLayerStyle(feature, currentRenderLevel, currentChoroplethBreaks);
    if (currentClickedState && isSelected) {
      layer.setStyle({
        ...base,
        color: '#ffffff',
        weight: 4,
        opacity: 1,
        fillOpacity: Math.min(1, base.fillOpacity + 0.08),
      });
      layer.bringToFront();
    } else {
      layer.setStyle(base);
    }
  });
}

function clearClickedStateLabel() {
  if (clickedStateLabel) {
    map.removeLayer(clickedStateLabel);
    clickedStateLabel = null;
  }
}

function showClickedStateLabel(state) {
  clearClickedStateLabel();
  if (!state || !adm1Data) return;
  const stateKey = normalizeStateLookupKey(state);
  const feature = getBoundaryFeatures(adm1Data).find(
    (f) => normalizeStateLookupKey(getStateName(f)) === stateKey
  );
  if (!feature) return;
  const rawPos = STATE_LABEL_POSITIONS[getStateName(feature)];
  const labelLatLng = rawPos ? L.latLng(rawPos[0], rawPos[1]) : L.geoJSON(feature).getBounds().getCenter();
  clickedStateLabel = L.tooltip({
    permanent: true,
    direction: 'center',
    className: 'state-map-label state-map-label--selected',
  })
    .setContent(getStateLabel(feature))
    .setLatLng(labelLatLng);
  clickedStateLabel.addTo(map);
}

function clearClickModeLgaOverlay() {
  if (clickModeLgaOverlay) {
    map.removeLayer(clickModeLgaOverlay);
    clickModeLgaOverlay = null;
  }
}

function showClickModeLgaOverlay(state) {
  clearClickModeLgaOverlay();
  if (!state || !adm2Data) return;
  const stateKey = normalizeStateLookupKey(state);
  const features = getBoundaryFeatures(adm2Data).filter(
    (f) => normalizeStateLookupKey(getStateName(f)) === stateKey
  );
  if (!features.length) return;
  clickModeLgaOverlay = L.geoJSON(
    { type: 'FeatureCollection', features },
    {
      interactive: false,
      style: {
        fillColor: 'transparent',
        fillOpacity: 0,
        color: 'rgba(255,255,255,0.35)',
        weight: 1,
        dashArray: '3,3',
      },
    }
  ).addTo(map);
}

function selectStateMode1(state) {
  currentClickedState = state;
  map.getContainer().classList.add('state-labels-hidden');
  applyMode1StateStyles();
  showClickedStateLabel(state);
  showClickModeLgaOverlay(state);
  updateDetailsPanel({ state, level: 'state' });
}

function deselectStateMode1() {
  currentClickedState = '';
  map.getContainer().classList.remove('state-labels-hidden');
  clearClickedStateLabel();
  clearClickModeLgaOverlay();
  if (activeLayer) {
    activeLayer.eachLayer((layer) => {
      const feature = layer.feature;
      if (!feature) return;
      layer.setStyle(getLegendLayerStyle(feature, currentRenderLevel, currentChoroplethBreaks));
    });
  }
  updateDetailsPanel({ level: levelSelect.value });
}

// ── MODE 2: Search-to-zoom (single-state LGA choropleth) ────────────────────

function clearSearchModeLgaLayer() {
  if (searchModeLgaLayer) {
    map.removeLayer(searchModeLgaLayer);
    searchModeLgaLayer = null;
  }
}

function buildSearchModeLgaLayer(state) {
  clearSearchModeLgaLayer();
  if (!state || !adm2Data) return;
  const stateKey = normalizeStateLookupKey(state);
  const features = getBoundaryFeatures(adm2Data).filter(
    (f) => normalizeStateLookupKey(getStateName(f)) === stateKey
  );
  if (!features.length) return;

  const metricValues = features
    .map((f) => getFeatureMetricValue(f, 'lga'))
    .filter((v) => Number.isFinite(v));
  const lgaBreaks = calculateJenksBreaks(metricValues, CHOROPLETH_CLASS_COUNT);

  // Override legend context so legend reflects LGA-level range for this state
  currentLegendFeatures = features;
  currentLegendLevel = 'lga';
  currentChoroplethBreaks = lgaBreaks;

  searchModeLgaLayer = L.geoJSON(
    { type: 'FeatureCollection', features },
    {
      interactive: true,
      style: (feature) => getLegendLayerStyle(feature, 'lga', lgaBreaks),
      onEachFeature: (feature, layer) => {
        const lgaName = getLgaName(feature);
        layer.on({
          mouseover: highlightBoundary,
          mouseout: (e) => {
            if (searchModeLgaLayer) searchModeLgaLayer.resetStyle(e.target);
          },
          click: () => {
            updateDetailsPanel({ state, lga: lgaName, level: 'lga' });
          },
        });
      },
    }
  ).addTo(map);

  updateChoroplethLegend();
}

function enterSearchMode(state) {
  currentClickedState = '';
  clearClickedStateLabel();
  clearClickModeLgaOverlay();
  clearStateLgaOverlay();
  clearSearchModeLgaLayer();
  map.getContainer().classList.add('state-labels-hidden');

  stateSelect.value = state;
  updateLgaOptions();
  lgaSelect.value = '';
  refreshAllCustomSelects();

  // Set mode flag AFTER renderLayer so reapplyCurrentMode skips during initial render
  renderLayer('state', { selectedState: state, selectedLga: '', fitBounds: true });
  isSearchMode = true;
  buildSearchModeLgaLayer(state);
  updateDetailsPanel({ state, level: 'state' });
}

function exitSearchMode() {
  isSearchMode = false;
  currentClickedState = '';
  clearSearchModeLgaLayer();
  clearClickedStateLabel();
  clearClickModeLgaOverlay();
  clearStateLgaOverlay();
  map.getContainer().classList.remove('state-labels-hidden');

  stateSelect.value = '';
  updateLgaOptions();
  lgaSelect.value = '';
  if (areaSearchInput) areaSearchInput.value = '';
  setAreaSearchMessage('');
  refreshAllCustomSelects();

  if (adm1Data) {
    const allStateFeatures = getBoundaryFeatures(adm1Data);
    setChoroplethContext(allStateFeatures, 'state');
  }
  renderLayer('state', { selectedState: '', selectedLga: '', fitBounds: false });
  if (nigeriaBounds?.isValid()) {
    map.fitBounds(nigeriaBounds.pad(0.08), { padding: [24, 24] });
  }
  updateChoroplethLegend();
  updateDetailsPanel({ level: 'state' });
}

function resetPopulationDashboard() {
  map.closePopup();
  activeChoroplethMetric = 'population';
  activeLegendClassIndex = null;
  activeLegendHoverClassIndex = null;

  clearAllModes();
  setFreePanMode(false);

  levelSelect.value = 'state';
  exitSearchMode();

  if (areaSearchInput) {
    areaSearchInput.value = '';
  }
  setAreaSearchMessage('');
  refreshAllCustomSelects();
  updateChoroplethLegend();
  keepMapFocusedOnNigeria();
}

function reapplyCurrentMode() {
  if (isSearchMode && stateSelect.value) {
    buildSearchModeLgaLayer(stateSelect.value);
  } else if (!isSearchMode && currentClickedState) {
    applyMode1StateStyles();
  }
}

function makeColor(index, total) {
  const lightness = 84 - Math.round((index / Math.max(total - 1, 1)) * 45);
  const saturation = 38 + ((index * 11) % 32);
  const hue = 122 + ((index * 17) % 26);
  return `hsl(${hue}, ${saturation}%, ${lightness}%)`;
}

function styleFeature(feature, index, total, level) {
  return getLegendLayerStyle(feature, level);
}

function showStateLgaOverlay(state) {
  clearStateLgaOverlay();

  const stateKey = normalizeStateLookupKey(state);
  const features = getBoundaryFeatures(adm2Data).filter(
    (feature) => normalizeStateLookupKey(getStateName(feature)) === stateKey
  );

  if (!features.length) {
    return;
  }

  activeLgaOverlayState = state;
  setChoroplethContext(features, 'lga', 'overlay');

  stateLgaOverlay = L.geoJSON(
    {
      type: 'FeatureCollection',
      features,
    },
    {
      interactive: true,
      style: (feature) => {
        const baseStyle = getLegendLayerStyle(feature, 'lga', currentOverlayChoroplethBreaks);
        return {
          ...baseStyle,
          color: 'rgba(255, 255, 255, 0.45)',
          weight: 1.15,
          opacity: 0.18,
          fillOpacity: 0.05,
        };
      },
      onEachFeature: (feature, layer) => {
        layer.bindTooltip(getLgaName(feature), {
          permanent: true,
          direction: 'center',
          className: 'lga-label',
        });
      },
    }
  ).addTo(map);

  stateLgaOverlay.bringToFront();
  window.requestAnimationFrame(() => {
    stateLgaOverlay?.eachLayer((layer) => {
      const baseStyle = getLegendLayerStyle(layer.feature, 'lga', currentOverlayChoroplethBreaks);
      layer.setStyle({
        opacity: 0.45,
        fillOpacity: 0.1,
      });
    });
  });
  updateChoroplethLegend();
  updateRenderedLayerStyles();
}

function highlightBoundary(event) {
  const layer = event.target;

  layer.setStyle({
    color: '#fff2a8',
    weight: 4,
    fillOpacity: 0.92,
  });

  layer.bringToFront();
}

function resetBoundaryHighlight(event) {
  if (activeLayer) {
    activeLayer.resetStyle(event.target);
  }
  if (currentClickedState && event.target.feature) {
    const feature = event.target.feature;
    const isSelected =
      normalizeStateLookupKey(getStateName(feature)) === normalizeStateLookupKey(currentClickedState);

    if (isSelected) {
      const base = getLegendLayerStyle(feature, currentRenderLevel, currentChoroplethBreaks);
      event.target.setStyle({
        ...base,
        color: '#ffffff',
        weight: 4,
        opacity: 1,
        fillOpacity: Math.min(1, base.fillOpacity + 0.08),
      });
      event.target.bringToFront();
    }
  }
}

function bindBoundaryPopup(feature, layer, level, selectedState = '') {
  const state = getStateName(feature);
  const stateLabel = getStateLabel(feature);
  const lga = getLgaName(feature);
  const title = level === 'lga' ? lga : level === 'state' ? stateLabel : 'Nigeria';
  const subtitle = level === 'lga' ? stateLabel : 'Administrative boundary';

  if (level !== 'lga') {
    layer.bindPopup(`
      <strong>${title}</strong>
      <span>${subtitle}</span>
    `);
  }

  if (level === 'state') {
    const labelPosition = STATE_LABEL_POSITIONS[state] || layer.getBounds().getCenter();
    const label = L.tooltip({
      permanent: true,
      direction: 'center',
      className: selectedState ? 'state-map-label state-map-label--popout' : 'state-map-label',
    })
      .setContent(stateLabel)
      .setLatLng(labelPosition);

    label.addTo(map);
    layer.on('remove', () => map.removeLayer(label));
  }

  if (level === 'lga') {
    layer.bindTooltip(lga, {
      sticky: true,
      className: 'lga-hover-label',
    });
  }

  if (level === 'state' || level === 'lga') {
    layer.on({
      mouseover: highlightBoundary,
      mouseout: resetBoundaryHighlight,
      click: () => {
        if (level === 'lga') {
          stateSelect.value = state;
          updateLgaOptions();
          lgaSelect.value = lga;
          clearStateLgaOverlay();
          updateDetailsPanel({ state, lga });
        } else {
          // MODE 1: keep all states visible, highlight selected
          if (isSearchMode) return;
          selectStateMode1(state);
        }
      },
    });
  }
}

function renderLayer(level = levelSelect.value, options = {}) {
  clearActiveLayer();

  const selectedState = options.selectedState ?? stateSelect.value;
  const selectedLga = options.selectedLga ?? lgaSelect.value;
  const shouldFitBounds = options.fitBounds ?? true;
  const selectedStateKey = normalizeStateLookupKey(selectedState);
  const selectedLgaKey = normalizeLookupKey(selectedLga);
  let data = level === 'country' ? adm0Data : level === 'lga' ? adm2Data : adm1Data;

  if (!data) {
    return;
  }

  const features = getBoundaryFeatures(data).filter((feature) => {
    const stateMatches =
      !selectedState ||
      normalizeStateLookupKey(getStateName(feature)) === normalizeStateLookupKey(selectedState);
    const lgaMatches = !selectedLga || getLgaName(feature) === selectedLga;

    if (level === 'country') {
      return true;
    }

    if (level === 'state') {
      return stateMatches;
    }

    return stateMatches && lgaMatches;
  });

  const renderData = {
    type: 'FeatureCollection',
    features,
  };
  currentRenderFeatures = features;
  currentRenderLevel = level;
  setChoroplethContext(features, level);

  activeLayer = L.geoJSON(renderData, {
    style: (feature) => {
      const baseStyle = getLegendLayerStyle(feature, level, currentChoroplethBreaks);
      const isFocusedState =
        level === 'state' &&
        Boolean(selectedState) &&
        normalizeStateLookupKey(getStateName(feature)) === selectedStateKey;
      const isFocusedLga =
        level === 'lga' &&
        Boolean(selectedState) &&
        Boolean(selectedLga) &&
        normalizeStateLookupKey(getStateName(feature)) === selectedStateKey &&
        normalizeLookupKey(getLgaName(feature)) === selectedLgaKey;

      return {
        ...baseStyle,
        className: [
          'population-boundary',
          level === 'state' ? 'population-state-boundary' : 'population-area-boundary',
          isFocusedState || isFocusedLga ? 'is-popout' : '',
        ]
          .filter(Boolean)
          .join(' '),
        weight: isFocusedState || isFocusedLga ? Math.max(baseStyle.weight, 4) : baseStyle.weight,
        color: isFocusedState ? '#f6d36b' : baseStyle.color,
        opacity: isFocusedState || isFocusedLga ? 1 : baseStyle.opacity,
        fillOpacity: isFocusedState ? Math.min(baseStyle.fillOpacity + 0.06, 0.98) : baseStyle.fillOpacity,
      };
    },
    onEachFeature: (feature, layer) => bindBoundaryPopup(feature, layer, level, selectedState),
  }).addTo(map);

  updateChoroplethLegend();
  updateRenderedLayerStyles();

  if (features.length > 0 && shouldFitBounds) {
    map.fitBounds(activeLayer.getBounds(), { padding: [24, 24] });
  }

  if (level === 'country') {
    coverageCount.textContent = '1 national boundary';
  } else if (level === 'state' && !selectedState) {
    coverageCount.textContent = '36 states + FCT';
  } else if (selectedState) {
    coverageLabel.textContent = 'Number of LGAs';
    coverageCount.textContent = `${getStateLgaCount(selectedState).toLocaleString()} LGAs`;
  } else {
    coverageCount.textContent = `${features.length.toLocaleString()} ${level === 'state' ? 'area' : 'LGAs'}`;
  }

  reapplyCurrentMode();
}

function handlePopulationZoomEnd() {
  if (levelSelect.value === 'country') {
    return;
  }

  const zoomLevel = map.getZoom();
  const selectedState = stateSelect.value;

  if (zoomLevel < 7) {
    if (!selectedState) {
      clearStateLgaOverlay();
      renderLayer('state', { fitBounds: false, selectedState: '', selectedLga: '' });
    }

    return;
  }

  const centerState = findStateContainingPoint(map.getCenter());
  if (!centerState) {
    return;
  }

  const centerStateName = getStateName(centerState);
  if (activeLgaOverlayState === centerStateName) {
    return;
  }

  stateSelect.value = centerStateName;
  updateLgaOptions();
  lgaSelect.value = '';
  refreshAllCustomSelects();
  updateDetailsPanel({ state: centerStateName, level: 'state' });
  renderLayer('state', { selectedState: centerStateName, selectedLga: '', fitBounds: false });
}

function getFocusedBounds() {
  if (levelSelect.value === 'lga' && stateSelect.value && lgaSelect.value) {
    const feature = getLgaFeatures(stateSelect.value).find(
      (candidate) =>
        normalizeLookupKey(getLgaName(candidate)) === normalizeLookupKey(lgaSelect.value)
    );

    if (feature) {
      return L.geoJSON(feature).getBounds();
    }
  }

  if (stateSelect.value) {
    const feature = getStateFeatures().find(
      (candidate) =>
        normalizeStateLookupKey(getStateName(candidate)) === normalizeStateLookupKey(stateSelect.value)
    );

    if (feature) {
      return L.geoJSON(feature).getBounds();
    }
  }

  return nigeriaBounds;
}

function fitToCurrentExtent() {
  const bounds = getFocusedBounds();

  if (bounds && bounds.isValid()) {
    map.fitBounds(bounds.pad(0.08), { padding: [24, 24] });
  }
}

function setFreePanMode(enabled) {
  freePanEnabled = enabled;
  const paddedBounds = nigeriaBounds?.pad(NIGERIA_BOUNDS_PADDING);

  if (enabled) {
    map.setMaxBounds(null);
    map.getContainer().classList.add('is-free-pan');
    return;
  }

  map.getContainer().classList.remove('is-free-pan');

  if (paddedBounds?.isValid()) {
    map.setMaxBounds(paddedBounds);
  }

  keepMapFocusedOnNigeria();
}

function toggleFreePanMode() {
  setFreePanMode(!freePanEnabled);
}

function keepMapFocusedOnNigeria() {
  if (freePanEnabled || !nigeriaBounds || !nigeriaBounds.isValid()) {
    return;
  }

  const paddedBounds = nigeriaBounds.pad(NIGERIA_BOUNDS_PADDING);
  const minimumNigeriaZoom = map.getBoundsZoom(paddedBounds, false, [24, 24]);
  map.setMaxBounds(paddedBounds);
  map.setMinZoom(minimumNigeriaZoom);

  if (map.getZoom() < minimumNigeriaZoom) {
    map.setZoom(minimumNigeriaZoom);
  }

  map.panInsideBounds(paddedBounds, { animate: false });
}

function addFitExtentControl() {
  const FitControl = L.Control.extend({
    options: {
      position: 'topleft',
    },

    onAdd() {
      const container = L.DomUtil.create('div', 'leaflet-bar fit-nigeria-control');
      const button = L.DomUtil.create('button', '', container);
      button.type = 'button';
      button.title = 'Fit map to current extent';
      button.setAttribute('aria-label', 'Fit map to current extent');
      button.innerHTML = `
        <span class="fit-icon-corners" aria-hidden="true"></span>
      `;

      L.DomEvent.disableClickPropagation(container);
      L.DomEvent.on(button, 'click', (event) => {
        L.DomEvent.preventDefault(event);
        fitToCurrentExtent();
      });

      return container;
    },
  });

  map.addControl(new FitControl());
}

function addFreePanControl() {
  const PanControl = L.Control.extend({
    options: {
      position: 'topleft',
    },

    onAdd() {
      const container = L.DomUtil.create('div', 'leaflet-bar free-pan-control');
      const button = L.DomUtil.create('button', '', container);
      button.type = 'button';
      button.title = 'Toggle free pan';
      button.setAttribute('aria-label', 'Toggle free pan');
      button.setAttribute('aria-pressed', String(freePanEnabled));
      button.classList.toggle('is-active', freePanEnabled);
      button.innerHTML = `
        <span class="pan-icon-arrows" aria-hidden="true"></span>
      `;

      const syncButtonState = () => {
        button.classList.toggle('is-active', freePanEnabled);
        button.setAttribute('aria-pressed', String(freePanEnabled));
      };

      L.DomEvent.disableClickPropagation(container);
      L.DomEvent.on(button, 'click', (event) => {
        L.DomEvent.preventDefault(event);
        toggleFreePanMode();
        syncButtonState();
      });

      map.on('freepanchange', syncButtonState);
      container._syncButtonState = syncButtonState;

      return container;
    },
  });

  map.addControl(new PanControl());
}

function setBaseMap(nextBaseMapKey) {
  if (nextBaseMapKey === activeBaseMapKey || !baseMaps[nextBaseMapKey]) {
    return;
  }

  map.removeLayer(baseMaps[activeBaseMapKey].layer);
  baseMaps[nextBaseMapKey].layer.addTo(map);
  activeBaseMapKey = nextBaseMapKey;
  document.querySelectorAll('.map-view-control button').forEach((button) => {
    const isActive = button.dataset.mapView === activeBaseMapKey;
    button.classList.toggle('is-active', isActive);
    button.setAttribute('aria-pressed', String(isActive));
  });
}

function addBaseMapControl() {
  const BaseMapControl = L.Control.extend({
    options: {
      position: 'topright',
    },

    onAdd() {
      const container = L.DomUtil.create('div', 'leaflet-bar map-view-control');

      for (const [key, baseMap] of Object.entries(baseMaps)) {
        const button = L.DomUtil.create('button', '', container);
        const isActive = key === activeBaseMapKey;
        button.type = 'button';
        button.dataset.mapView = key;
        button.dataset.label = baseMap.label;
        button.title = baseMap.label;
        button.setAttribute('aria-label', `Switch to ${baseMap.label} map`);
        button.setAttribute('aria-pressed', String(isActive));
        button.classList.toggle('is-active', isActive);
        button.innerHTML = `
          <span class="map-view-icon ${baseMap.iconClass}" aria-hidden="true"></span>
        `;

        L.DomEvent.on(button, 'click', (event) => {
          L.DomEvent.preventDefault(event);
          setBaseMap(key);
        });
      }

      L.DomEvent.disableClickPropagation(container);
      L.DomEvent.disableScrollPropagation(container);

      return container;
    },
  });

  map.addControl(new BaseMapControl());
}

function updateChoroplethLegend() {
  if (!choroplethLegendElements) {
    return;
  }

  const values = getMetricValues();
  const breaks = currentChoroplethBreaks.length
    ? currentChoroplethBreaks
    : calculateJenksBreaks(values, CHOROPLETH_CLASS_COUNT);
  const legendRanges = getChoroplethLegendRanges(values, breaks);

  choroplethLegendElements.title.textContent = CHOROPLETH_METRICS[activeChoroplethMetric].title;

  choroplethLegendElements.buttons.forEach((button) => {
    const isActive = button.dataset.metric === activeChoroplethMetric;
    button.classList.toggle('is-active', isActive);
    button.setAttribute('aria-pressed', String(isActive));
  });

  choroplethLegendElements.classes.forEach((item, index) => {
    const legendClass = CHOROPLETH_CLASS_SCHEME[index];
    const legendRange = legendRanges[index];
    const classState = getLegendClassState(index);

    item.swatch.style.setProperty('--tier-color', legendClass.color);
    item.range.textContent =
      legendRange.min === null || legendRange.max === null
        ? '--'
        : `${formatLegendNumber(legendRange.min)} - ${formatLegendNumber(legendRange.max)}`;
    item.label.textContent = legendClass.label;
    item.row.classList.toggle('is-active', classState === 'active');
    item.row.classList.toggle('is-muted', classState === 'muted');
    item.row.setAttribute('aria-pressed', String(classState === 'active'));
  });
}

function formatLegendNumber(value) {
  return Number(Math.round(value)).toLocaleString();
}

function addChoroplethLegendControl() {
  const dock =
    document.getElementById('mapLegendDock') ||
    document.querySelector('.map-panel') ||
    document.querySelector('.insight-scroll') ||
    document.querySelector('.dashboard-main');

  if (!dock) {
    return;
  }

  const container = document.createElement('section');
  container.className = 'choropleth-legend choropleth-legend--docked';
  const switcher = L.DomUtil.create('div', 'choropleth-legend-switcher', container);
  const populationButton = L.DomUtil.create('button', 'choropleth-mode-button', switcher);
  const registeredButton = L.DomUtil.create('button', 'choropleth-mode-button', switcher);
  const title = L.DomUtil.create('strong', 'choropleth-legend-title', container);
  const classes = L.DomUtil.create('div', 'choropleth-legend-classes', container);
  const helperTip = L.DomUtil.create('p', 'choropleth-legend-tip', container);

  populationButton.type = 'button';
  populationButton.textContent = 'Population';
  populationButton.dataset.metric = 'population';
  populationButton.setAttribute('aria-pressed', 'true');
  populationButton.classList.add('is-active');
  registeredButton.type = 'button';
  registeredButton.textContent = 'Voters';
  registeredButton.dataset.metric = 'registeredVoters';
  registeredButton.setAttribute('aria-pressed', 'false');
  helperTip.textContent = 'Click a tier to highlight';

  const classItems = CHOROPLETH_CLASS_SCHEME.map((legendClass) => {
    const row = L.DomUtil.create('button', 'choropleth-legend-item', classes);
    const swatch = L.DomUtil.create('span', 'choropleth-legend-swatch', row);
    const content = L.DomUtil.create('span', 'choropleth-legend-content', row);
    const label = L.DomUtil.create('strong', 'choropleth-legend-label', content);
    const range = L.DomUtil.create('span', 'choropleth-legend-range', content);

    swatch.style.setProperty('--tier-color', legendClass.color);
    label.textContent = legendClass.label;
    row.type = 'button';
    row.setAttribute('aria-pressed', 'false');

    return {
      row,
      swatch,
      range,
      label,
    };
  });

  [populationButton, registeredButton].forEach((button) => {
    L.DomEvent.on(button, 'click', (event) => {
      L.DomEvent.preventDefault(event);
      activeChoroplethMetric = button.dataset.metric;
      activeLegendClassIndex = null;
      activeLegendHoverClassIndex = null;
      refreshChoroplethRendering();
    });
  });

  classItems.forEach((item, classIndex) => {
    item.row.dataset.classIndex = String(classIndex);

    item.row.addEventListener('mouseenter', () => {
      setHoveredLegendClass(classIndex);
      updateRenderedLayerStyles();
      updateChoroplethLegend();
    });

    item.row.addEventListener('mouseleave', () => {
      setHoveredLegendClass(null);
      updateRenderedLayerStyles();
      updateChoroplethLegend();
    });

    L.DomEvent.on(item.row, 'click', (event) => {
      L.DomEvent.preventDefault(event);
      setActiveLegendClass(classIndex);
      refreshChoroplethRendering();
    });
  });

  // initialize opacity controls after legend is added (or immediately)
  initializeOpacityControls();

  L.DomEvent.disableClickPropagation(container);
  L.DomEvent.disableScrollPropagation(container);

  choroplethLegendElements = {
    title,
    tip: helperTip,
    buttons: [populationButton, registeredButton],
    classes: classItems,
  };
  updateChoroplethLegend();
  dock.appendChild(container);
  choroplethLegend = container;
}

addFitExtentControl();
addFreePanControl();
addBaseMapControl();
addChoroplethLegendControl();

function closeCustomSelectMenus(exceptSelect = null) {
  customSelectControls.forEach((control, select) => {
    if (select === exceptSelect) {
      return;
    }

    control.root.classList.remove('is-open');
    control.button.setAttribute('aria-expanded', 'false');
  });
}

function refreshCustomSelect(select) {
  const control = customSelectControls.get(select);

  if (!control) {
    return;
  }

  const selectedOption = select.selectedOptions[0] || select.options[0];
  control.button.textContent = selectedOption?.textContent || '';
  control.menu.innerHTML = '';

  Array.from(select.options).forEach((option) => {
    const item = document.createElement('button');
    item.type = 'button';
    item.className = 'custom-select-option';
    item.textContent = option.textContent;
    item.disabled = option.disabled;
    item.dataset.value = option.value;
    item.setAttribute('role', 'option');
    item.setAttribute('aria-selected', String(option.value === select.value));

    if (option.value === select.value) {
      item.classList.add('is-selected');
    }

    item.addEventListener('click', () => {
      select.value = option.value;
      select.dispatchEvent(new Event('change', { bubbles: true }));
      closeCustomSelectMenus();
      refreshCustomSelect(select);
    });

    control.menu.appendChild(item);
  });
}

function refreshAllCustomSelects() {
  customSelectControls.forEach((control, select) => refreshCustomSelect(select));
}

function setAreaSearchMessage(message) {
  if (areaSearchMessage) {
    areaSearchMessage.textContent = message;
  }
}

function buildAreaSearchIndex() {
  const states = getBoundaryFeatures(adm1Data)
    .map((feature) => getStateName(feature))
    .sort((a, b) => normalizeStateName(a).localeCompare(normalizeStateName(b)));
  const lgas = getBoundaryFeatures(adm2Data)
    .map((feature) => ({
      state: getStateName(feature),
      lga: getLgaName(feature),
    }))
    .sort((a, b) => a.lga.localeCompare(b.lga) || normalizeStateName(a.state).localeCompare(normalizeStateName(b.state)));

  areaSearchIndex = [
    ...states.map((state) => ({
      type: 'state',
      state,
      label: normalizeStateName(state),
      searchKey: normalizeStateLookupKey(normalizeStateName(state)),
    })),
    ...lgas.map(({ state, lga }) => ({
      type: 'lga',
      state,
      lga,
      label: `${lga}, ${normalizeStateName(state)}`,
      searchKey: normalizeLookupKey(`${lga} ${normalizeStateName(state)}`),
      lgaKey: normalizeLgaLookupKey(state, lga),
    })),
  ];

}

function getAreaSearchMatch(value) {
  const searchKey = normalizeLookupKey(value);

  if (!searchKey) {
    return null;
  }

  return (
    areaSearchIndex.find((item) => item.searchKey === searchKey || item.lgaKey === searchKey) ||
    areaSearchIndex.find((item) => item.searchKey.startsWith(searchKey) || item.lgaKey?.startsWith(searchKey)) ||
    areaSearchIndex.find((item) => item.searchKey.includes(searchKey) || item.lgaKey?.includes(searchKey)) ||
    null
  );
}

function jumpToAreaSearchResult(match) {
  if (match.type === 'state') {
    // MODE 2: zoom to state, show LGA choropleth, hide other states
    levelSelect.value = 'state';
    refreshAllCustomSelects();
    setAreaSearchMessage(`Showing ${normalizeStateName(match.state)}.`);
    enterSearchMode(match.state);
    return;
  }

  // LGA search: exit any current mode, then zoom to that LGA
  clearAllModes();
  levelSelect.value = 'lga';
  stateSelect.value = match.state;
  updateLgaOptions();
  lgaSelect.value = match.lga;
  refreshAllCustomSelects();
  clearStateLgaOverlay();
  updateDetailsPanel({ state: match.state, lga: match.lga, level: 'lga' });
  renderLayer('lga', { selectedState: match.state, selectedLga: match.lga });
  setAreaSearchMessage(`Showing ${match.lga}, ${normalizeStateName(match.state)}.`);
}

function searchArea() {
  const match = getAreaSearchMatch(areaSearchInput?.value);

  if (!match) {
    setAreaSearchMessage('No matching state or LGA found.');
    return;
  }

  areaSearchInput.value = match.label;
  jumpToAreaSearchResult(match);
}

function initializeCustomFilterSelects() {
  [levelSelect, stateSelect, lgaSelect].forEach((select) => {
    if (customSelectControls.has(select)) {
      return;
    }

    const root = document.createElement('div');
    const button = document.createElement('button');
    const menu = document.createElement('div');

    root.className = 'custom-select';
    button.type = 'button';
    button.className = 'custom-select-button';
    button.setAttribute('aria-haspopup', 'listbox');
    button.setAttribute('aria-expanded', 'false');
    menu.className = 'custom-select-menu';
    menu.setAttribute('role', 'listbox');

    button.addEventListener('click', (event) => {
      event.stopPropagation();
      const shouldOpen = !root.classList.contains('is-open');
      closeCustomSelectMenus(select);
      root.classList.toggle('is-open', shouldOpen);
      button.setAttribute('aria-expanded', String(shouldOpen));
    });

    root.append(button, menu);
    select.classList.add('native-select-hidden');
    select.insertAdjacentElement('afterend', root);
    customSelectControls.set(select, { root, button, menu });
    refreshCustomSelect(select);
  });

  document.addEventListener('click', () => closeCustomSelectMenus());
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      closeCustomSelectMenus();
    }
  });
}

function populateFilters() {
  const states = [...new Set(getBoundaryFeatures(adm1Data).map(getStateName))].sort();

  for (const state of states) {
    const option = document.createElement('option');
    option.value = state;
    option.textContent = normalizeStateName(state);
    stateSelect.appendChild(option);
  }

  updateLgaOptions();
  buildAreaSearchIndex();
  refreshAllCustomSelects();
}

function updateLgaOptions() {
  const selectedState = stateSelect.value;
  const lgas = getBoundaryFeatures(adm2Data)
    .filter(
      (feature) =>
        !selectedState ||
        normalizeStateLookupKey(getStateName(feature)) === normalizeStateLookupKey(selectedState)
    )
    .map(getLgaName)
    .sort();

  lgaSelect.innerHTML = '<option value="">All LGAs</option>';

  for (const lga of lgas) {
    const option = document.createElement('option');
    option.value = lga;
    option.textContent = lga;
    lgaSelect.appendChild(option);
  }

  refreshCustomSelect(lgaSelect);
}

async function loadBoundary(url) {
  return shp(url);
}

async function fetchPopulationDataFromApi() {
  try {
    const response = await fetch(buildPopulationDataUrl('/api/population-data'));

    if (response.ok) {
      return response.json();
    }
  } catch (error) {
    console.warn('Population API unavailable; loading local data file instead.', error);
  }

  throw new Error('Population API unavailable.');
}

async function fetchPopulationDataFromLocal() {
  const response = await fetch(`data/population-pvc-data.json?t=${Date.now()}`);

  if (!response.ok) {
    throw new Error('Unable to load Population and PVC data.');
  }

  return response.json();
}

function getEmbeddedPopulationData() {
  return window.POPULATION_PVC_DATA || window.populationPvcData || null;
}

async function loadPopulationData({ preferRemote = false } = {}) {
  const embeddedData = getEmbeddedPopulationData();

  if (embeddedData) {
    return embeddedData;
  }

  const loaders = preferRemote
    ? [fetchPopulationDataFromApi, fetchPopulationDataFromLocal]
    : [fetchPopulationDataFromLocal, fetchPopulationDataFromApi];

  let lastError = null;

  for (const load of loaders) {
    try {
      return await load();
    } catch (error) {
      lastError = error;
      if (load === fetchPopulationDataFromApi) {
        console.warn('Population API unavailable; loading local data file instead.', error);
      }
    }
  }

  throw lastError || new Error('Unable to load Population and PVC data.');
}

function buildPopulationDataUrl(endpoint) {
  const params = new URLSearchParams();
  params.set('t', Date.now().toString());
  return `${endpoint}?${params.toString()}`;
}

async function getPopulationDataStatus() {
  const response = await fetch(buildPopulationDataUrl('/api/population-data/status'));

  if (!response.ok) {
    throw new Error('Unable to check Population and PVC data status.');
  }

  return response.json();
}

function setPopulationSyncStatus(message, state = 'active') {
  if (!populationSyncStatus) {
    return;
  }

  populationSyncStatus.textContent = message;
  populationSyncStatus.dataset.state = state;
}

function getSyncMinutesRemaining() {
  return Math.max(0, Math.ceil((populationDataRefreshDeadline - Date.now()) / 60000));
}

function stopPopulationDataAutoRefresh() {
  if (populationDataRefreshTimer) {
    clearInterval(populationDataRefreshTimer);
    populationDataRefreshTimer = null;
  }

  setPopulationSyncStatus(
    'Drive sync paused after 15 minutes. Reconnect from Admin to watch for new changes.',
    'paused'
  );
}

async function refreshPopulationDataIfChanged() {
  if (Date.now() > populationDataRefreshDeadline) {
    stopPopulationDataAutoRefresh();
    return;
  }

  if (isRefreshingPopulationData) {
    return;
  }

  isRefreshingPopulationData = true;

  try {
    const status = await getPopulationDataStatus();

    if (!status.signature || status.signature === populationDataSignature) {
      setPopulationSyncStatus(`Drive sync active. ${getSyncMinutesRemaining()} min remaining.`, 'active');
      return;
    }

    populationData = await loadPopulationData({ preferRemote: true });
    populationDataSignature = status.signature;
    renderLayer();
    refreshDetailsPanel();
    setPopulationSyncStatus(`Drive update applied. ${getSyncMinutesRemaining()} min remaining.`, 'active');
  } catch (error) {
    console.warn('Population data auto-refresh failed:', error);
    setPopulationSyncStatus('Drive sync check failed. It will retry shortly.', 'warning');
  } finally {
    isRefreshingPopulationData = false;
  }
}

async function reloadPopulationDataFromSource() {
  populationData = await loadPopulationData({ preferRemote: true });
  renderLayer();
  refreshDetailsPanel();

  try {
    const status = await getPopulationDataStatus();
    populationDataSignature = status.signature || populationDataSignature;
  } catch (error) {
    console.warn('Unable to update population data signature after reload:', error);
  }
}

async function startPopulationDataAutoRefresh(options = {}) {
  const shouldReloadNow = Boolean(options.reloadNow);
  populationDataRefreshDeadline = Date.now() + POPULATION_DATA_REFRESH_WINDOW_MS;
  setPopulationSyncStatus('Drive sync active. 15 min remaining.', 'active');

  if (shouldReloadNow) {
    try {
      await reloadPopulationDataFromSource();
    } catch (error) {
      console.warn('Unable to reload population data after admin update:', error);
    }
  } else {
    try {
      const status = await getPopulationDataStatus();
      populationDataSignature = status.signature || '';
    } catch (error) {
      console.warn('Unable to start population data watcher:', error);
    }
  }

  if (populationDataRefreshTimer) {
    clearInterval(populationDataRefreshTimer);
  }

  refreshPopulationDataIfChanged();
  populationDataRefreshTimer = setInterval(
    refreshPopulationDataIfChanged,
    POPULATION_DATA_REFRESH_INTERVAL_MS
  );
}

function handlePopulationReconnectSignal(signalValue) {
  if (!signalValue || signalValue === lastPopulationReconnectSignal) {
    return;
  }

  lastPopulationReconnectSignal = signalValue;
  startPopulationDataAutoRefresh({ reloadNow: true });
}

async function initPopulationMap() {
  try {
    populationData = await loadPopulationData();
    refreshDetailsPanel();

    [adm0Data, adm1Data, adm2Data] = await Promise.all([
      loadBoundary('data/boundaries/adm0.zip'),
      loadBoundary('data/boundaries/adm1.zip'),
      loadBoundary('data/boundaries/adm2.zip'),
    ]);

    populateFilters();
    nigeriaBounds = L.geoJSON(adm0Data).getBounds();
    keepMapFocusedOnNigeria();
    renderLayer('state');
    refreshDetailsPanel();
    map.on('zoomend', handlePopulationZoomEnd);
    startPopulationDataAutoRefresh();
  } catch (error) {
    console.error('Failed to load population boundary layers:', error);
    if (!populationData) {
      coverageCount.textContent = 'Boundary load failed';
    }
  }
}

stateSelect.addEventListener('change', () => {
  clearAllModes();
  updateLgaOptions();
  lgaSelect.value = '';
  if (stateSelect.value && levelSelect.value === 'country') {
    levelSelect.value = 'state';
  }
  refreshAllCustomSelects();
  refreshDetailsPanel();
  renderLayer();

  if (stateSelect.value && levelSelect.value !== 'lga') {
    showStateLgaOverlay(stateSelect.value);
  } else {
    clearStateLgaOverlay();
  }
});

lgaSelect.addEventListener('change', () => {
  clearAllModes();
  if (lgaSelect.value) {
    levelSelect.value = 'lga';
  }

  refreshAllCustomSelects();
  refreshDetailsPanel();
  renderLayer();
});

levelSelect.addEventListener('change', () => {
  clearAllModes();
  if (levelSelect.value === 'country') {
    lgaSelect.value = '';
  }
  refreshAllCustomSelects();
  renderLayer();
  refreshDetailsPanel();

  if (stateSelect.value && levelSelect.value === 'state') {
    showStateLgaOverlay(stateSelect.value);
  }
});

document.getElementById('applyFilters').addEventListener('click', () => {
  clearAllModes();
  renderLayer();
  refreshDetailsPanel();

  if (stateSelect.value && levelSelect.value !== 'lga') {
    showStateLgaOverlay(stateSelect.value);
  } else {
    clearStateLgaOverlay();
  }
});

document.getElementById('resetFilters').addEventListener('click', () => {
  resetPopulationDashboard();
});

areaSearchButton?.addEventListener('click', searchArea);

areaSearchInput?.addEventListener('keydown', (event) => {
  if (event.key !== 'Enter') {
    return;
  }

  event.preventDefault();
  searchArea();
});

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.crossOrigin = 'anonymous';
    image.onload = () => resolve(image);
    image.onerror = reject;
    image.src = url;
  });
}

async function imageUrlToPngDataUrl(url, size = 220) {
  if (!url) {
    return '';
  }

  const image = await loadImage(url);
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d');
  const side = size;
  const scale = Math.max(side / image.naturalWidth, side / image.naturalHeight);
  const width = image.naturalWidth * scale;
  const height = image.naturalHeight * scale;
  const x = (side - width) / 2;
  const y = (side - height) / 2;

  canvas.width = side;
  canvas.height = side;
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, side, side);
  context.drawImage(image, x, y, width, height);

  return canvas.toDataURL('image/png');
}

async function addReportImages(doc, report) {
  const hasPartyLogo = Boolean(report.partyLogo);

  if (!hasPartyLogo) {
    return 54;
  }

  let x = 14;

  try {
    if (hasPartyLogo) {
      const logoImage = await imageUrlToPngDataUrl(report.partyLogo, 260);
      doc.addImage(logoImage, 'PNG', x, 54, 24, 24);
    }

    return 98;
  } catch (error) {
    console.warn('Unable to add report image:', error);
    return 54;
  }
}

function getStateLandArea(state, governor) {
  const stateRow = getStatePopulation(state);
  return stateRow?.landArea || stateRow?.area || governor?.landArea || governor?.area || '--';
}

function getLgaPdfRows(state) {
  const stateRow = getStatePopulation(state);
  const lgaRows = getStateLgaPopulationRows(state)
    .map((row) => ({
      ...row,
      population: Number(row.population || 0),
    }))
    .filter((row) => Number.isFinite(row.population))
    .sort((a, b) => b.population - a.population);
  const totalLgaPopulation = lgaRows.reduce((total, row) => total + row.population, 0);
  const stateRegisteredVoters = Number(stateRow?.registeredVoters || 0);
  const stateCollectedPVCs = Number(stateRow?.collectedPVCs || 0);
  const statePvcRate = Number(stateRow?.pvcCollectionRate || 0);

  return lgaRows.map((row, index) => {
    const share = totalLgaPopulation ? row.population / totalLgaPopulation : 0;
    const registeredVoters = Number.isFinite(Number(row.registeredVoters))
      ? Number(row.registeredVoters)
      : stateRegisteredVoters * share;
    const collectedPVCs = Number.isFinite(Number(row.collectedPVCs))
      ? Number(row.collectedPVCs)
      : stateCollectedPVCs * share;
    const pvcRate = Number.isFinite(Number(row.pvcCollectionRate))
      ? Number(row.pvcCollectionRate)
      : statePvcRate;
    const chairman = getLgaChairmanInfo(state, row.lga);

    return {
      rank: index + 1,
      lga: row.lga,
      chairman: chairman.name || 'Not available',
      population: row.population,
      registeredVoters,
      collectedPVCs,
      pvcRate,
    };
  });
}

function getPdfSummaryRow(lgaRows) {
  const totals = lgaRows.reduce(
    (summary, row) => ({
      population: summary.population + row.population,
      registeredVoters: summary.registeredVoters + row.registeredVoters,
      collectedPVCs: summary.collectedPVCs + row.collectedPVCs,
      pvcRate: summary.pvcRate + row.pvcRate,
    }),
    {
      population: 0,
      registeredVoters: 0,
      collectedPVCs: 0,
      pvcRate: 0,
    }
  );
  const averagePvcRate = lgaRows.length ? totals.pvcRate / lgaRows.length : 0;

  return [
    '',
    'Totals / Avg',
    '',
    formatNumber(totals.population),
    formatNumber(totals.registeredVoters),
    formatNumber(totals.collectedPVCs),
    formatPercent(averagePvcRate),
  ];
}

function safePdfFileName(value) {
  return String(value || 'State')
    .trim()
    .replace(/[^a-z0-9]+/gi, '_')
    .replace(/^_+|_+$/g, '');
}

function addPdfHeader(doc, title, subtitle = '') {
  doc.setFillColor(14, 61, 31);
  doc.rect(0, 0, 210, 26, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(14);
  doc.setFont('helvetica', 'bold');
  doc.text(title, 14, 16, { maxWidth: 155 });
  doc.setFont('helvetica', 'normal');

  if (subtitle) {
    doc.setFontSize(8);
    doc.text(subtitle, 14, 22, { maxWidth: 170 });
  }
}

async function addBrandHeader(doc, reportTitle, generatedAt) {
  addPdfHeader(doc, 'Nigeria Election GIS Dashboard', 'Geoinfotech population and demographics intelligence');

  try {
    const logoImage = await imageUrlToPngDataUrl('assets/geoinfotech-logo.jpeg', 220);
    doc.addImage(logoImage, 'PNG', 178, 5, 18, 18);
  } catch (error) {
    console.warn('Unable to add Geoinfotech logo to PDF:', error);
  }

  doc.setTextColor(14, 61, 31);
  doc.setFontSize(18);
  doc.setFont('helvetica', 'bold');
  doc.text(reportTitle, 14, 46, { maxWidth: 182 });
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(74, 86, 80);
  doc.setFontSize(10);
  doc.text(`Generated: ${generatedAt.toLocaleString()}`, 14, 56);
}

function drawSummaryCards(doc, summaryItems) {
  const leftX = 14;
  const rightX = 108;
  const cardWidth = 88;
  const cardHeight = 21;
  const startY = 78;

  doc.setTextColor(14, 61, 31);
  doc.setFontSize(13);
  doc.setFont('helvetica', 'bold');
  doc.text('State Summary', 14, 68);
  doc.setFont('helvetica', 'normal');

  summaryItems.forEach((item, index) => {
    const x = index % 2 === 0 ? leftX : rightX;
    const y = startY + Math.floor(index / 2) * 27;

    doc.setDrawColor(0, 200, 100);
    doc.setFillColor(249, 255, 249);
    doc.roundedRect(x, y, cardWidth, cardHeight, 2, 2, 'FD');
    doc.setTextColor(91, 105, 98);
    doc.setFontSize(8);
    doc.text(item.label, x + 5, y + 7);
    doc.setTextColor(20, 39, 33);
    doc.setFontSize(11);
    doc.setFont('helvetica', 'bold');
    doc.text(String(item.value), x + 5, y + 16, { maxWidth: cardWidth - 10 });
    doc.setFont('helvetica', 'normal');
  });
}

function drawCalloutBox(doc, x, y, width, title, lgaRow, fillColor) {
  doc.setFillColor(...fillColor);
  doc.setDrawColor(0, 200, 100);
  doc.roundedRect(x, y, width, 32, 2, 2, 'FD');
  doc.setTextColor(14, 61, 31);
  doc.setFontSize(9);
  doc.setFont('helvetica', 'bold');
  doc.text(title, x + 5, y + 8);
  doc.setTextColor(20, 39, 33);
  doc.setFontSize(11);
  doc.text(lgaRow?.lga || '--', x + 5, y + 17, { maxWidth: width - 10 });
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.text(`Chairman: ${lgaRow?.chairman || 'Not available'}`, x + 5, y + 24, { maxWidth: width - 10 });
  doc.text(`Population: ${formatNumber(lgaRow?.population)}`, x + 5, y + 29);
}

function createChartImage(config, width = 1200, height = 720) {
  return new Promise((resolve) => {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    canvas.style.position = 'fixed';
    canvas.style.left = '-10000px';
    canvas.style.top = '0';
    document.body.appendChild(canvas);

    const chart = new Chart(canvas, {
      ...config,
      options: {
        ...config.options,
        animation: false,
        responsive: false,
        maintainAspectRatio: false,
      },
    });

    chart.update();
    requestAnimationFrame(() => {
      const imageUrl = canvas.toDataURL('image/png');
      chart.destroy();
      canvas.remove();
      resolve(imageUrl);
    });
  });
}

async function createPopulationChartImage(lgaRows) {
  return createChartImage({
    type: 'bar',
    data: {
      labels: lgaRows.map((row) => row.lga),
      datasets: [
        {
          label: 'Population',
          data: lgaRows.map((row) => Math.round(row.population)),
          backgroundColor: '#00c864',
          borderColor: '#0e3d1f',
          borderWidth: 1,
        },
      ],
    },
    options: {
      indexAxis: 'y',
      plugins: {
        legend: { display: false },
        title: {
          display: true,
          text: 'LGA Population Ranking',
          color: '#0e3d1f',
          font: { size: 22, weight: 'bold' },
        },
      },
      scales: {
        x: { beginAtZero: true, ticks: { color: '#34453b' }, grid: { color: '#e6efe8' } },
        y: { ticks: { color: '#34453b', autoSkip: false, font: { size: 10 } }, grid: { display: false } },
      },
    },
  });
}

async function createPvcRateChartImage(lgaRows) {
  return createChartImage({
    type: 'bar',
    data: {
      labels: lgaRows.map((row) => row.lga),
      datasets: [
        {
          label: 'PVC Collection Rate %',
          data: lgaRows.map((row) => Number(row.pvcRate.toFixed(1))),
          backgroundColor: '#0e3d1f',
          borderColor: '#00c864',
          borderWidth: 1,
        },
      ],
    },
    options: {
      plugins: {
        legend: { display: false },
        title: {
          display: true,
          text: 'PVC Collection Rate by LGA',
          color: '#0e3d1f',
          font: { size: 22, weight: 'bold' },
        },
      },
      scales: {
        x: { ticks: { color: '#34453b', autoSkip: false, maxRotation: 70, minRotation: 70 }, grid: { display: false } },
        y: { beginAtZero: true, max: 100, ticks: { color: '#34453b' }, grid: { color: '#e6efe8' } },
      },
    },
  });
}

async function downloadStateDemographicsReport(state) {
  if (!state || !window.jspdf || !window.Chart) {
    return;
  }

  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const normalizedState = normalizeStateName(state);
  const generatedAt = new Date();
  const stateRow = getStatePopulation(state);
  const governor = getGovernor(state);
  const lgaRows = getLgaPdfRows(state);
  const highestPopulationLga = lgaRows[0];
  const lowestPopulationLga = lgaRows[lgaRows.length - 1];
  const landArea = getStateLandArea(state, governor);
  const reportTitle = `${normalizedState} — Population & Demographics Report`;

  await addBrandHeader(doc, reportTitle, generatedAt);
  drawSummaryCards(doc, [
    { label: 'Total Population', value: formatNumber(stateRow?.population) },
    { label: 'Registered Voters', value: formatNumber(stateRow?.registeredVoters) },
    { label: 'Collected PVCs', value: formatNumber(stateRow?.collectedPVCs) },
    { label: 'PVC Collection Rate', value: formatPercent(stateRow?.pvcCollectionRate) },
    { label: 'Governor Name and Party', value: governor ? `${governor.governor} (${governor.party})` : '--' },
    { label: 'Number of LGAs', value: formatNumber(lgaRows.length || getStateLgaCount(state)) },
    { label: 'Total Land Area', value: landArea },
  ]);

  doc.addPage();
  addPdfHeader(doc, 'LGA Breakdown Table', `${normalizedState} LGAs sorted by population descending`);
  doc.autoTable({
    startY: 34,
    head: [['Rank', 'LGA Name', 'LGA Chairman', 'Population', 'Registered Voters', 'PVC Collected', 'PVC Rate %']],
    body: lgaRows.map((row) => [
      row.rank,
      row.lga,
      row.chairman,
      formatNumber(row.population),
      formatNumber(row.registeredVoters),
      formatNumber(row.collectedPVCs),
      Number(row.pvcRate).toFixed(1),
    ]),
    foot: [getPdfSummaryRow(lgaRows)],
    theme: 'grid',
    margin: { left: 8, right: 8 },
    tableWidth: 194,
    styles: {
      fontSize: 5.2,
      cellPadding: 0.65,
      minCellHeight: 3.5,
      lineColor: [220, 234, 224],
      lineWidth: 0.1,
      overflow: 'ellipsize',
      valign: 'middle',
    },
    headStyles: {
      fillColor: [14, 61, 31],
      textColor: [255, 255, 255],
      fontStyle: 'bold',
    },
    footStyles: {
      fillColor: [0, 200, 100],
      textColor: [14, 61, 31],
      fontStyle: 'bold',
    },
    alternateRowStyles: {
      fillColor: [249, 255, 249],
    },
    columnStyles: {
      0: { cellWidth: 10, halign: 'center' },
      1: { cellWidth: 31 },
      2: { cellWidth: 46 },
      3: { cellWidth: 27, halign: 'right' },
      4: { cellWidth: 30, halign: 'right' },
      5: { cellWidth: 28, halign: 'right' },
      6: { cellWidth: 18, halign: 'right' },
    },
    didParseCell(data) {
      if (data.section !== 'body') {
        return;
      }

      const row = lgaRows[data.row.index];
      if (row === highestPopulationLga) {
        data.cell.styles.fillColor = [221, 247, 226];
      }

      if (row === lowestPopulationLga) {
        data.cell.styles.fillColor = [255, 232, 232];
      }
    },
  });

  const calloutY = Math.min((doc.lastAutoTable?.finalY || 236) + 8, 252);
  drawCalloutBox(doc, 14, calloutY, 86, 'Highest Population LGA', highestPopulationLga, [221, 247, 226]);
  drawCalloutBox(doc, 110, calloutY, 86, 'Lowest Population LGA', lowestPopulationLga, [255, 232, 232]);

  const [populationChartImage, pvcRateChartImage] = await Promise.all([
    createPopulationChartImage(lgaRows),
    createPvcRateChartImage(lgaRows),
  ]);

  doc.addPage();
  addPdfHeader(doc, 'Charts', `${normalizedState} LGA population and PVC collection views`);
  doc.addImage(populationChartImage, 'PNG', 14, 34, 182, 104);
  doc.setDrawColor(0, 200, 100);
  doc.line(14, 148, 196, 148);
  doc.addImage(pvcRateChartImage, 'PNG', 14, 158, 182, 104);

  doc.save(`${safePdfFileName(normalizedState)}_Demographics_Report.pdf`);
}

initializePanelResizer();
initializeCustomFilterSelects();

window.addEventListener('resize', () => {
  window.requestAnimationFrame(() => {
    map.invalidateSize();
    keepMapFocusedOnNigeria();
  });
});

window.addEventListener('storage', (event) => {
  if (event.key === POPULATION_DATA_RECONNECT_KEY && event.newValue) {
    handlePopulationReconnectSignal(event.newValue);
  }
});

window.addEventListener('focus', () => {
  handlePopulationReconnectSignal(localStorage.getItem(POPULATION_DATA_RECONNECT_KEY));
});

downloadReport.addEventListener('click', async () => {
  if (!stateSelect.value) {
    window.alert('Please select a state before downloading the Population & Demographics report.');
    return;
  }

  await downloadStateDemographicsReport(stateSelect.value);
});

// Deselect MODE 1 when clicking outside any state polygon
map.on('click', (event) => {
  if (isSearchMode || !currentClickedState) return;
  const stateFeature = findStateContainingPoint(event.latlng);
  if (!stateFeature) {
    deselectStateMode1();
  }
});

initPopulationMap();
