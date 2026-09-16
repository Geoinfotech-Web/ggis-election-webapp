const fs = require('fs/promises');
const path = require('path');

const STORE_PATH = process.env.PAGE_CONTENT_PATH
  || path.join(__dirname, '..', 'data', 'page-content.json');

const COUNTRY_CODES = Object.freeze([
  'global', 'ng', 'us', 'gb', 'gh', 'ke', 'in', 'de', 'fr', 'br', 'za',
]);
const COUNTRY_SET = new Set(COUNTRY_CODES);

const NAV_IDS = Object.freeze([
  'Overview', 'Map', 'Live Results', 'Candidates', 'Parties', 'Analysis', 'Data', 'About',
]);
const NAV_SET = new Set(NAV_IDS);

const SECTION_IDS = Object.freeze([
  'Overview', 'Map', 'Live Results', 'Candidates', 'Parties', 'Analysis', 'Data', 'About',
]);
const SECTION_SET = new Set(SECTION_IDS);

const ANALYSIS_SUBTAB_IDS = Object.freeze([
  'overview', 'geography', 'turnout', 'trends', 'demographics', 'quality',
]);
const ANALYSIS_SUBTAB_SET = new Set(ANALYSIS_SUBTAB_IDS);

const WIDGET_TYPES = Object.freeze(['chart', 'table', 'kpi', 'text', 'list', 'map']);
const WIDGET_TYPE_SET = new Set(WIDGET_TYPES);

const CHART_TYPES = new Set(['bar', 'line', 'doughnut', 'scatter', 'horizontalBar']);
const LIST_TYPES = new Set(['standings', 'ranked', 'custom', 'links']);

const MAX_NAV = 16;
const MAX_SUBTABS = 12;
const MAX_WIDGETS = 64;
const MAX_KPI_CARDS = 12;
const MAX_DATA_SOURCES = 24;
const MAX_CODE_LOCKED = 24;

function clampInt(value, min, max, fallback) {
  const n = Number.parseInt(value, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function slugId(raw, fallback) {
  const base = String(raw || fallback || 'item')
    .replace(/[^a-zA-Z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
  return base || String(fallback || 'item');
}

function defaultNav() {
  return [
    { id: 'Overview', label: 'Overview', visible: true, order: 0, live: false },
    { id: 'Map', label: 'Polling units', visible: true, order: 1, live: false },
    { id: 'Live Results', label: 'Live Results', visible: true, order: 2, live: true },
    { id: 'Candidates', label: 'Candidates', visible: true, order: 3, live: false },
    { id: 'Parties', label: 'Parties', visible: true, order: 4, live: false },
    { id: 'Analysis', label: 'Analysis', visible: true, order: 5, live: false },
    { id: 'Data', label: 'Data', visible: true, order: 6, live: false },
    { id: 'About', label: 'About', visible: true, order: 7, live: false },
  ];
}

function defaultAnalysisSubTabs() {
  return [
    { id: 'overview', label: 'Overview', icon: 'insights', visible: true, order: 0 },
    { id: 'geography', label: 'Geography', icon: 'map', visible: true, order: 1 },
    { id: 'turnout', label: 'Turnout', icon: 'how_to_vote', visible: true, order: 2 },
    { id: 'trends', label: 'Trends', icon: 'timeline', visible: true, order: 3 },
    { id: 'demographics', label: 'Demographics', icon: 'groups', visible: true, order: 4 },
    { id: 'quality', label: 'Data Quality', icon: 'fact_check', visible: true, order: 5 },
  ];
}

function defaultCapabilities(code) {
  const isNg = code === 'ng';
  const isGlobal = code === 'global';
  return {
    liveData: isNg || isGlobal,
    maps: isNg,
    analysis: isNg || isGlobal,
    candidates: isNg || isGlobal,
    parties: isNg || isGlobal,
    liveResults: isNg || isGlobal,
    dataExplorer: isNg || isGlobal,
    comingSoon: !isNg && !isGlobal,
  };
}

function defaultDataSources(code) {
  if (code !== 'ng' && code !== 'global') {
    return [{
      id: 'placeholder',
      label: 'Country data (pending)',
      endpoint: '',
      enabled: false,
      notes: 'Attach APIs when this country goes live.',
    }];
  }
  return [
    {
      id: 'analysis',
      label: 'Election analysis bundle',
      endpoint: '/api/election-results/analysis',
      enabled: true,
      notes: 'Drives Analysis charts and tables.',
    },
    {
      id: 'dashboards-overview',
      label: 'Overview dashboard layout',
      endpoint: '/api/dashboards/overview',
      enabled: true,
      notes: 'Published KPI/widget grid from Dashboards admin.',
    },
    {
      id: 'dashboards-live',
      label: 'Live dashboard layout',
      endpoint: '/api/dashboards/live',
      enabled: true,
      notes: 'Published KPI/widget grid for Live Results.',
    },
    {
      id: 'map-views',
      label: 'Map Studio views',
      endpoint: '/api/maps/views',
      enabled: true,
      notes: 'Basemap / layers / extent for Overview, Polling, Live.',
    },
    {
      id: 'nigeria-kpis',
      label: 'Nigeria KPIs',
      endpoint: '/api/nigeria-kpis',
      enabled: code === 'ng',
      notes: 'Scoped KPI row for state / LGA / ward / PU.',
    },
    {
      id: 'candidates-presidential',
      label: 'Presidential candidates',
      endpoint: '/data/presidential-candidates.json',
      enabled: true,
      notes: 'Static catalog; editable via Content hub.',
    },
  ];
}

function defaultCodeLocked() {
  return [
    {
      surface: 'Analysis Chart.js renderers',
      note: 'Chart algorithms and canvas wiring stay in eid-analysis.js. Titles, visibility, and order are editable here.',
    },
    {
      surface: 'Map geometry & GRID3 layers',
      note: 'Basemap/layers use Map Studio. Boundary polygons and PU coordinates remain code/data-pipeline locked.',
    },
    {
      surface: 'Live submission moderation UI',
      note: 'In-app Admin moderation flow is not page-studio editable.',
    },
    {
      surface: 'dc-runtime template shells',
      note: 'Major HTML section shells in index.html are code-locked; studio toggles visibility/labels and injects extras.',
    },
  ];
}

function defaultAnalysisWidgets() {
  return [
    {
      id: 'ana-vote-share',
      section: 'Analysis',
      subTab: 'overview',
      type: 'chart',
      visible: true,
      order: 0,
      title: 'Vote share',
      config: {
        chartType: 'bar',
        canvasId: 'anaChartPerfShare',
        dataKey: 'performance.voteShare',
        source: 'analysis',
        meta: 'current vs previous',
      },
    },
    {
      id: 'ana-seat-vote',
      section: 'Analysis',
      subTab: 'overview',
      type: 'chart',
      visible: true,
      order: 1,
      title: 'Seat distribution',
      config: {
        chartType: 'scatter',
        canvasId: 'anaChartSeatVote',
        dataKey: 'performance.seatVsVote',
        source: 'analysis',
        meta: 'seat share vs vote share',
      },
    },
    {
      id: 'ana-regions',
      section: 'Analysis',
      subTab: 'geography',
      type: 'chart',
      visible: true,
      order: 0,
      title: 'Regional performance',
      config: {
        chartType: 'bar',
        canvasId: 'anaChartRegions',
        dataKey: 'geographic.regions',
        source: 'analysis',
        meta: 'wins / share',
      },
    },
    {
      id: 'ana-swing',
      section: 'Analysis',
      subTab: 'geography',
      type: 'chart',
      visible: true,
      order: 1,
      title: 'Unit swing',
      config: {
        chartType: 'bar',
        canvasId: 'anaChartSwing',
        dataKey: 'geographic.units',
        source: 'analysis',
        meta: 'focus party',
      },
    },
    {
      id: 'ana-margins',
      section: 'Analysis',
      subTab: 'geography',
      type: 'chart',
      visible: true,
      order: 2,
      title: 'Margin distribution',
      config: {
        chartType: 'bar',
        canvasId: 'anaChartMargins',
        dataKey: 'competitiveness.distribution',
        source: 'analysis',
        meta: 'histogram',
      },
    },
    {
      id: 'ana-geo-table',
      section: 'Analysis',
      subTab: 'geography',
      type: 'table',
      visible: true,
      order: 3,
      title: 'Constituency / unit results',
      config: {
        dataKey: 'geographic.units',
        source: 'analysis',
        columns: ['unit', 'winner', 'share', 'margin'],
      },
    },
    {
      id: 'ana-turnout-trend',
      section: 'Analysis',
      subTab: 'turnout',
      type: 'chart',
      visible: true,
      order: 0,
      title: 'Turnout by cycle',
      config: {
        chartType: 'line',
        canvasId: 'anaChartTurnoutTrend',
        dataKey: 'history.turnoutTrend',
        source: 'analysis',
        meta: 'national',
      },
    },
    {
      id: 'ana-turnout-swing',
      section: 'Analysis',
      subTab: 'turnout',
      type: 'chart',
      visible: true,
      order: 1,
      title: 'Turnout vs party swing',
      config: {
        chartType: 'scatter',
        canvasId: 'anaChartTurnoutSwing',
        dataKey: 'turnout.byUnit',
        source: 'analysis',
        meta: 'state proxy',
      },
    },
    {
      id: 'ana-turnout-by-unit',
      section: 'Analysis',
      subTab: 'turnout',
      type: 'chart',
      visible: true,
      order: 2,
      title: 'Turnout by region / unit',
      config: {
        chartType: 'horizontalBar',
        canvasId: 'anaChartTurnoutByUnit',
        dataKey: 'turnout.byUnit',
        source: 'analysis',
        meta: 'high → low',
      },
    },
    {
      id: 'ana-history',
      section: 'Analysis',
      subTab: 'trends',
      type: 'chart',
      visible: true,
      order: 0,
      title: 'Vote-share trend',
      config: {
        chartType: 'line',
        canvasId: 'anaChartHistory',
        dataKey: 'history.voteShareTrend',
        source: 'analysis',
        meta: 'major parties',
      },
    },
    {
      id: 'ana-seat-history',
      section: 'Analysis',
      subTab: 'trends',
      type: 'chart',
      visible: true,
      order: 1,
      title: 'Seat / win-share trend',
      config: {
        chartType: 'line',
        canvasId: 'anaChartSeatHistory',
        dataKey: 'history.seatShareTrend',
        source: 'analysis',
        meta: 'across cycles',
      },
    },
    {
      id: 'ana-outlook',
      section: 'Analysis',
      subTab: 'trends',
      type: 'chart',
      visible: true,
      order: 2,
      title: 'Outlook momentum',
      config: {
        chartType: 'bar',
        canvasId: 'anaChartOutlook',
        dataKey: 'prediction.partyMomentum',
        source: 'analysis',
        meta: 'heuristic',
      },
    },
  ];
}

function emptyBundle(code = 'global') {
  const caps = defaultCapabilities(code);
  return {
    version: 1,
    country: code,
    updatedAt: null,
    nav: defaultNav().map((item) => {
      if (code !== 'ng' && item.id === 'Map') {
        return { ...item, visible: false };
      }
      if (caps.comingSoon && !['Overview', 'About'].includes(item.id)) {
        return { ...item, visible: false };
      }
      return { ...item };
    }),
    subTabs: {
      Analysis: defaultAnalysisSubTabs(),
    },
    editorial: {
      headline: '',
      subhead: '',
      notes: '',
      comingSoonMessage: caps.comingSoon
        ? 'Live results and KPIs for this country are not loaded yet. Nigeria is the live scope.'
        : '',
      kpiCards: [],
    },
    widgets: code === 'ng' || code === 'global' ? defaultAnalysisWidgets() : [],
    dataSources: defaultDataSources(code),
    capabilities: caps,
    links: {
      dashboardOverview: true,
      dashboardLive: true,
      mapStudio: caps.maps,
    },
    codeLocked: defaultCodeLocked(),
  };
}

function defaultStore() {
  const countries = {};
  for (const code of COUNTRY_CODES) {
    countries[code] = { draft: emptyBundle(code), published: null };
  }
  return { version: 1, countries };
}

function sanitizeNavItem(raw, index) {
  if (!raw || typeof raw !== 'object') return null;
  let id = String(raw.id || '').trim();
  if (!NAV_SET.has(id)) {
    // Allow only known nav ids so public routing stays stable
    id = NAV_IDS[Math.min(index, NAV_IDS.length - 1)];
  }
  return {
    id,
    label: String(raw.label || id).slice(0, 64),
    visible: raw.visible !== false,
    order: clampInt(raw.order, 0, 99, index),
    live: !!raw.live,
  };
}

function sanitizeSubTab(raw, index) {
  if (!raw || typeof raw !== 'object') return null;
  let id = String(raw.id || '').toLowerCase().trim();
  if (!ANALYSIS_SUBTAB_SET.has(id)) {
    id = ANALYSIS_SUBTAB_IDS[Math.min(index, ANALYSIS_SUBTAB_IDS.length - 1)];
  }
  return {
    id,
    label: String(raw.label || id).slice(0, 64),
    icon: String(raw.icon || 'tab').slice(0, 48),
    visible: raw.visible !== false,
    order: clampInt(raw.order, 0, 99, index),
  };
}

function sanitizeWidgetConfig(type, config) {
  const src = config && typeof config === 'object' && !Array.isArray(config) ? config : {};
  if (type === 'chart') {
    return {
      chartType: CHART_TYPES.has(src.chartType) ? src.chartType : 'bar',
      canvasId: String(src.canvasId || '').slice(0, 80),
      dataKey: String(src.dataKey || '').slice(0, 120),
      source: String(src.source || 'analysis').slice(0, 64),
      meta: String(src.meta || '').slice(0, 120),
    };
  }
  if (type === 'table') {
    return {
      dataKey: String(src.dataKey || '').slice(0, 120),
      source: String(src.source || 'analysis').slice(0, 64),
      columns: Array.isArray(src.columns)
        ? src.columns.slice(0, 12).map((c) => String(c).slice(0, 48))
        : [],
      meta: String(src.meta || '').slice(0, 120),
    };
  }
  if (type === 'kpi') {
    return {
      metric: String(src.metric || 'custom').slice(0, 64),
      label: String(src.label || 'KPI').slice(0, 80),
      icon: String(src.icon || 'analytics').slice(0, 64),
      unit: String(src.unit || '').slice(0, 24),
      value: src.value != null ? String(src.value).slice(0, 48) : '',
      caption: String(src.caption || '').slice(0, 160),
    };
  }
  if (type === 'map') {
    return {
      mapId: String(src.mapId || '').slice(0, 80),
      title: String(src.title || 'Map').slice(0, 80),
    };
  }
  if (type === 'list') {
    return {
      listType: LIST_TYPES.has(src.listType) ? src.listType : 'custom',
      items: Array.isArray(src.items)
        ? src.items.slice(0, 24).map((item) => String(item).slice(0, 160))
        : [],
    };
  }
  return {
    body: String(src.body || '').slice(0, 4000),
  };
}

function sanitizeWidget(raw, index) {
  if (!raw || typeof raw !== 'object') return null;
  const type = String(raw.type || '').toLowerCase();
  if (!WIDGET_TYPE_SET.has(type)) return null;
  let section = String(raw.section || 'Overview');
  if (!SECTION_SET.has(section)) section = 'Overview';
  const subTabRaw = String(raw.subTab || '').toLowerCase();
  const subTab = ANALYSIS_SUBTAB_SET.has(subTabRaw) ? subTabRaw : '';
  return {
    id: slugId(raw.id, `${type}-${index + 1}`),
    section,
    subTab: section === 'Analysis' ? (subTab || 'overview') : '',
    type,
    visible: raw.visible !== false,
    order: clampInt(raw.order, 0, 999, index),
    title: String(raw.title || type).slice(0, 120),
    config: sanitizeWidgetConfig(type, raw.config),
  };
}

function sanitizeKpiCard(raw, index) {
  if (!raw || typeof raw !== 'object') return null;
  return {
    id: slugId(raw.id, `kpi-${index + 1}`),
    label: String(raw.label || 'KPI').slice(0, 80),
    value: String(raw.value != null ? raw.value : '—').slice(0, 48),
    unit: String(raw.unit || '').slice(0, 24),
    caption: String(raw.caption || '').slice(0, 160),
    icon: String(raw.icon || 'analytics').slice(0, 64),
  };
}

function sanitizeDataSource(raw, index) {
  if (!raw || typeof raw !== 'object') return null;
  return {
    id: slugId(raw.id, `source-${index + 1}`),
    label: String(raw.label || 'Data source').slice(0, 120),
    endpoint: String(raw.endpoint || '').slice(0, 240),
    enabled: raw.enabled !== false,
    notes: String(raw.notes || '').slice(0, 400),
  };
}

function sanitizeCodeLocked(raw) {
  if (!raw || typeof raw !== 'object') return null;
  return {
    surface: String(raw.surface || 'Locked surface').slice(0, 120),
    note: String(raw.note || '').slice(0, 400),
  };
}

function sanitizeBundle(raw, countryCode) {
  const base = emptyBundle(countryCode);
  if (!raw || typeof raw !== 'object') return base;

  const navSrc = Array.isArray(raw.nav) ? raw.nav : base.nav;
  const seenNav = new Set();
  const nav = [];
  navSrc.slice(0, MAX_NAV).forEach((item, index) => {
    const next = sanitizeNavItem(item, index);
    if (!next || seenNav.has(next.id)) return;
    seenNav.add(next.id);
    nav.push(next);
  });
  // Ensure all known nav ids exist so public routing never loses a tab permanently
  NAV_IDS.forEach((id, index) => {
    if (seenNav.has(id)) return;
    const fallback = base.nav.find((n) => n.id === id) || defaultNav()[index];
    nav.push({ ...fallback, order: nav.length });
  });
  nav.sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));

  const subSrc = raw.subTabs && typeof raw.subTabs === 'object' ? raw.subTabs : {};
  const analysisSrc = Array.isArray(subSrc.Analysis) ? subSrc.Analysis : base.subTabs.Analysis;
  const seenSub = new Set();
  const analysisTabs = [];
  analysisSrc.slice(0, MAX_SUBTABS).forEach((item, index) => {
    const next = sanitizeSubTab(item, index);
    if (!next || seenSub.has(next.id)) return;
    seenSub.add(next.id);
    analysisTabs.push(next);
  });
  ANALYSIS_SUBTAB_IDS.forEach((id, index) => {
    if (seenSub.has(id)) return;
    analysisTabs.push({ ...defaultAnalysisSubTabs()[index], order: analysisTabs.length });
  });
  analysisTabs.sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));

  const editorialSrc = raw.editorial && typeof raw.editorial === 'object' ? raw.editorial : {};
  const kpiCards = Array.isArray(editorialSrc.kpiCards)
    ? editorialSrc.kpiCards.slice(0, MAX_KPI_CARDS).map(sanitizeKpiCard).filter(Boolean)
    : [];

  const widgetsSrc = Array.isArray(raw.widgets) ? raw.widgets : base.widgets;
  const seenWidget = new Set();
  const widgets = [];
  widgetsSrc.slice(0, MAX_WIDGETS).forEach((item, index) => {
    const next = sanitizeWidget(item, index);
    if (!next) return;
    let id = next.id;
    let n = 1;
    while (seenWidget.has(id)) id = `${next.id}-${n++}`;
    next.id = id;
    seenWidget.add(id);
    widgets.push(next);
  });
  widgets.sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));

  const dsSrc = Array.isArray(raw.dataSources) ? raw.dataSources : base.dataSources;
  const dataSources = dsSrc.slice(0, MAX_DATA_SOURCES).map(sanitizeDataSource).filter(Boolean);

  const capsSrc = raw.capabilities && typeof raw.capabilities === 'object' ? raw.capabilities : {};
  const baseCaps = defaultCapabilities(countryCode);
  const capabilities = {
    liveData: capsSrc.liveData != null ? !!capsSrc.liveData : baseCaps.liveData,
    maps: capsSrc.maps != null ? !!capsSrc.maps : baseCaps.maps,
    analysis: capsSrc.analysis != null ? !!capsSrc.analysis : baseCaps.analysis,
    candidates: capsSrc.candidates != null ? !!capsSrc.candidates : baseCaps.candidates,
    parties: capsSrc.parties != null ? !!capsSrc.parties : baseCaps.parties,
    liveResults: capsSrc.liveResults != null ? !!capsSrc.liveResults : baseCaps.liveResults,
    dataExplorer: capsSrc.dataExplorer != null ? !!capsSrc.dataExplorer : baseCaps.dataExplorer,
    comingSoon: capsSrc.comingSoon != null ? !!capsSrc.comingSoon : baseCaps.comingSoon,
  };

  const linksSrc = raw.links && typeof raw.links === 'object' ? raw.links : {};
  const links = {
    dashboardOverview: linksSrc.dashboardOverview !== false,
    dashboardLive: linksSrc.dashboardLive !== false,
    mapStudio: linksSrc.mapStudio != null ? !!linksSrc.mapStudio : capabilities.maps,
  };

  const codeLockedSrc = Array.isArray(raw.codeLocked) ? raw.codeLocked : base.codeLocked;
  const codeLocked = codeLockedSrc.slice(0, MAX_CODE_LOCKED).map(sanitizeCodeLocked).filter(Boolean);

  return {
    version: clampInt(raw.version, 1, 9999, 1),
    country: countryCode,
    updatedAt: raw.updatedAt ? String(raw.updatedAt) : null,
    publishedAt: raw.publishedAt ? String(raw.publishedAt) : undefined,
    nav,
    subTabs: { Analysis: analysisTabs },
    editorial: {
      headline: String(editorialSrc.headline || '').slice(0, 200),
      subhead: String(editorialSrc.subhead || '').slice(0, 400),
      notes: String(editorialSrc.notes || '').slice(0, 4000),
      comingSoonMessage: String(editorialSrc.comingSoonMessage || '').slice(0, 600),
      kpiCards,
    },
    widgets,
    dataSources,
    capabilities,
    links,
    codeLocked,
  };
}

function normalizeCountryEntry(raw, code) {
  if (!raw || typeof raw !== 'object') {
    return { draft: emptyBundle(code), published: null };
  }
  if (raw.nav || raw.widgets || raw.editorial || (raw.subTabs && !raw.draft && !raw.published)) {
    return { draft: sanitizeBundle(raw, code), published: null };
  }
  return {
    draft: sanitizeBundle(raw.draft, code),
    published: raw.published ? sanitizeBundle(raw.published, code) : null,
  };
}

function normalizeStore(raw) {
  const store = defaultStore();
  if (!raw || typeof raw !== 'object') return store;
  const countries = raw.countries && typeof raw.countries === 'object' ? raw.countries : raw;
  for (const code of COUNTRY_CODES) {
    store.countries[code] = normalizeCountryEntry(countries[code], code);
  }
  store.version = clampInt(raw.version, 1, 9999, 1);
  return store;
}

async function readStore() {
  try {
    const contents = await fs.readFile(STORE_PATH, 'utf8');
    return normalizeStore(JSON.parse(contents.replace(/^\uFEFF/, '')));
  } catch (error) {
    if (error.code === 'ENOENT') return defaultStore();
    throw error;
  }
}

async function writeStore(store) {
  const normalized = normalizeStore(store);
  await fs.mkdir(path.dirname(STORE_PATH), { recursive: true });
  await fs.writeFile(STORE_PATH, `${JSON.stringify(normalized, null, 2)}\n`, 'utf8');
  return normalized;
}

function assertCountry(code) {
  const key = String(code || '').toLowerCase().trim();
  if (!COUNTRY_SET.has(key)) {
    const error = new Error(`Unknown country scope. Use one of: ${COUNTRY_CODES.join(', ')}`);
    error.status = 400;
    throw error;
  }
  return key;
}

async function listCountries() {
  const store = await readStore();
  return {
    countries: COUNTRY_CODES.map((code) => {
      const entry = store.countries[code];
      const draft = entry.draft || emptyBundle(code);
      const published = entry.published;
      return {
        code,
        draftUpdatedAt: draft.updatedAt || null,
        publishedAt: published?.publishedAt || published?.updatedAt || null,
        hasPublished: !!published,
        draftNavVisible: (draft.nav || []).filter((n) => n.visible).length,
        draftWidgetCount: (draft.widgets || []).length,
        comingSoon: !!draft.capabilities?.comingSoon,
      };
    }),
    enums: {
      navIds: [...NAV_IDS],
      analysisSubTabs: [...ANALYSIS_SUBTAB_IDS],
      widgetTypes: [...WIDGET_TYPES],
      sections: [...SECTION_IDS],
    },
  };
}

async function getAdminCountry(code) {
  const key = assertCountry(code);
  const store = await readStore();
  return {
    country: key,
    draft: store.countries[key].draft,
    published: store.countries[key].published,
    enums: {
      navIds: [...NAV_IDS],
      analysisSubTabs: [...ANALYSIS_SUBTAB_IDS],
      widgetTypes: [...WIDGET_TYPES],
      sections: [...SECTION_IDS],
      chartTypes: [...CHART_TYPES],
    },
  };
}

async function saveDraft(code, bundle) {
  const key = assertCountry(code);
  const store = await readStore();
  const draft = sanitizeBundle(bundle, key);
  draft.updatedAt = new Date().toISOString();
  delete draft.publishedAt;
  store.countries[key].draft = draft;
  await writeStore(store);
  return {
    country: key,
    draft: store.countries[key].draft,
    published: store.countries[key].published,
  };
}

async function publishCountry(code) {
  const key = assertCountry(code);
  const store = await readStore();
  const published = sanitizeBundle(store.countries[key].draft, key);
  const now = new Date().toISOString();
  published.updatedAt = now;
  published.publishedAt = now;
  store.countries[key].published = published;
  store.countries[key].draft = { ...sanitizeBundle(published, key), updatedAt: now };
  await writeStore(store);
  return {
    country: key,
    draft: store.countries[key].draft,
    published: store.countries[key].published,
  };
}

async function revertCountry(code) {
  const key = assertCountry(code);
  const store = await readStore();
  if (!store.countries[key].published) {
    const error = new Error('No published page content to revert to.');
    error.status = 400;
    throw error;
  }
  const draft = sanitizeBundle(store.countries[key].published, key);
  draft.updatedAt = new Date().toISOString();
  delete draft.publishedAt;
  store.countries[key].draft = draft;
  await writeStore(store);
  return {
    country: key,
    draft: store.countries[key].draft,
    published: store.countries[key].published,
  };
}

async function getPublished(code) {
  const key = assertCountry(code);
  const store = await readStore();
  const published = store.countries[key].published;
  if (!published) {
    return { country: key, published: null };
  }
  return { country: key, published };
}

module.exports = {
  STORE_PATH,
  COUNTRY_CODES,
  NAV_IDS,
  ANALYSIS_SUBTAB_IDS,
  WIDGET_TYPES,
  SECTION_IDS,
  listCountries,
  getAdminCountry,
  saveDraft,
  publishCountry,
  revertCountry,
  getPublished,
  sanitizeBundle,
  emptyBundle,
  defaultStore,
  assertCountry,
};
