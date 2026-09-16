const fs = require('fs/promises');
const path = require('path');

const LAYOUTS_PATH = path.join(__dirname, '..', 'data', 'dashboard-layouts.json');
const PAGES = new Set(['overview', 'live']);
const WIDGET_TYPES = new Set(['kpi', 'map', 'chart', 'list', 'text']);
const MAX_WIDGETS = 48;

const DEFAULT_GRID = Object.freeze({ columns: 12, rowHeight: 80 });

function emptyLayout() {
  return {
    version: 1,
    grid: { ...DEFAULT_GRID },
    widgets: [],
    updatedAt: null,
  };
}

function defaultStore() {
  return {
    overview: { draft: emptyLayout(), published: null },
    live: { draft: emptyLayout(), published: null },
  };
}

function clampInt(value, min, max, fallback) {
  const n = Number.parseInt(value, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function sanitizeConfig(type, config) {
  const src = config && typeof config === 'object' && !Array.isArray(config) ? config : {};
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
      mapId: String(src.mapId || 'overview-default').slice(0, 80),
      title: String(src.title || 'Map').slice(0, 80),
    };
  }
  if (type === 'chart') {
    return {
      chartType: ['bar', 'line', 'doughnut'].includes(src.chartType) ? src.chartType : 'bar',
      title: String(src.title || 'Chart').slice(0, 80),
      source: String(src.source || 'election-results').slice(0, 64),
    };
  }
  if (type === 'list') {
    return {
      listType: ['standings', 'ranked', 'custom'].includes(src.listType) ? src.listType : 'standings',
      title: String(src.title || 'List').slice(0, 80),
      items: Array.isArray(src.items)
        ? src.items.slice(0, 20).map((item) => String(item).slice(0, 120))
        : [],
    };
  }
  return {
    title: String(src.title || 'Note').slice(0, 80),
    body: String(src.body || '').slice(0, 2000),
  };
}

function sanitizeWidget(raw, index) {
  if (!raw || typeof raw !== 'object') return null;
  const type = String(raw.type || '').toLowerCase();
  if (!WIDGET_TYPES.has(type)) return null;
  const idBase = String(raw.id || `${type}-${index + 1}`).replace(/[^a-zA-Z0-9_-]+/g, '-').slice(0, 64);
  return {
    id: idBase || `${type}-${index + 1}`,
    type,
    x: clampInt(raw.x, 0, 11, 0),
    y: clampInt(raw.y, 0, 40, 0),
    w: clampInt(raw.w, 1, 12, type === 'kpi' ? 3 : 4),
    h: clampInt(raw.h, 1, 12, type === 'kpi' ? 1 : 3),
    config: sanitizeConfig(type, raw.config),
  };
}

function sanitizeLayout(raw) {
  const base = emptyLayout();
  if (!raw || typeof raw !== 'object') return base;
  const gridSrc = raw.grid && typeof raw.grid === 'object' ? raw.grid : {};
  const widgets = Array.isArray(raw.widgets) ? raw.widgets : [];
  const seen = new Set();
  const cleaned = [];
  widgets.slice(0, MAX_WIDGETS).forEach((widget, index) => {
    const next = sanitizeWidget(widget, index);
    if (!next) return;
    let id = next.id;
    let n = 1;
    while (seen.has(id)) {
      id = `${next.id}-${n++}`;
    }
    next.id = id;
    seen.add(id);
    if (next.x + next.w > 12) next.x = Math.max(0, 12 - next.w);
    cleaned.push(next);
  });
  return {
    version: clampInt(raw.version, 1, 9999, 1),
    grid: {
      columns: 12,
      rowHeight: clampInt(gridSrc.rowHeight, 48, 160, DEFAULT_GRID.rowHeight),
    },
    widgets: cleaned,
    updatedAt: raw.updatedAt ? String(raw.updatedAt) : null,
    publishedAt: raw.publishedAt ? String(raw.publishedAt) : undefined,
  };
}

function normalizePage(pageRaw) {
  if (!pageRaw || typeof pageRaw !== 'object') {
    return { draft: emptyLayout(), published: null };
  }
  // Legacy shape: layout directly on page (no draft/published)
  if (pageRaw.widgets || (pageRaw.grid && !pageRaw.draft && !pageRaw.published)) {
    const layout = sanitizeLayout(pageRaw);
    return { draft: layout, published: null };
  }
  return {
    draft: sanitizeLayout(pageRaw.draft),
    published: pageRaw.published ? sanitizeLayout(pageRaw.published) : null,
  };
}

function normalizeStore(raw) {
  const store = defaultStore();
  if (!raw || typeof raw !== 'object') return store;
  for (const page of PAGES) {
    store[page] = normalizePage(raw[page]);
  }
  return store;
}

async function readStore() {
  try {
    const contents = await fs.readFile(LAYOUTS_PATH, 'utf8');
    return normalizeStore(JSON.parse(contents.replace(/^\uFEFF/, '')));
  } catch (error) {
    if (error.code === 'ENOENT') return defaultStore();
    throw error;
  }
}

async function writeStore(store) {
  const normalized = normalizeStore(store);
  await fs.mkdir(path.dirname(LAYOUTS_PATH), { recursive: true });
  await fs.writeFile(LAYOUTS_PATH, `${JSON.stringify(normalized, null, 2)}\n`, 'utf8');
  return normalized;
}

function assertPage(page) {
  const key = String(page || '').toLowerCase();
  if (!PAGES.has(key)) {
    const error = new Error('Unknown dashboard page. Use overview or live.');
    error.status = 400;
    throw error;
  }
  return key;
}

async function listDashboards() {
  const store = await readStore();
  return {
    pages: [...PAGES].map((page) => ({
      page,
      draftUpdatedAt: store[page].draft?.updatedAt || null,
      publishedAt: store[page].published?.publishedAt || store[page].published?.updatedAt || null,
      draftWidgetCount: store[page].draft?.widgets?.length || 0,
      publishedWidgetCount: store[page].published?.widgets?.length || 0,
      hasPublished: !!(store[page].published && store[page].published.widgets?.length),
    })),
  };
}

async function getAdminPage(page) {
  const key = assertPage(page);
  const store = await readStore();
  return {
    page: key,
    draft: store[key].draft,
    published: store[key].published,
  };
}

async function saveDraft(page, layout) {
  const key = assertPage(page);
  const store = await readStore();
  const draft = sanitizeLayout(layout);
  draft.updatedAt = new Date().toISOString();
  delete draft.publishedAt;
  store[key].draft = draft;
  await writeStore(store);
  return { page: key, draft: store[key].draft, published: store[key].published };
}

async function publishPage(page) {
  const key = assertPage(page);
  const store = await readStore();
  const published = sanitizeLayout(store[key].draft);
  const now = new Date().toISOString();
  published.updatedAt = now;
  published.publishedAt = now;
  store[key].published = published;
  store[key].draft = { ...sanitizeLayout(published), updatedAt: now };
  await writeStore(store);
  return { page: key, draft: store[key].draft, published: store[key].published };
}

async function revertPage(page) {
  const key = assertPage(page);
  const store = await readStore();
  if (!store[key].published) {
    const error = new Error('No published layout to revert to.');
    error.status = 400;
    throw error;
  }
  const draft = sanitizeLayout(store[key].published);
  draft.updatedAt = new Date().toISOString();
  delete draft.publishedAt;
  store[key].draft = draft;
  await writeStore(store);
  return { page: key, draft: store[key].draft, published: store[key].published };
}

async function getPublished(page) {
  const key = assertPage(page);
  const store = await readStore();
  const published = store[key].published;
  if (!published || !Array.isArray(published.widgets) || published.widgets.length === 0) {
    return { page: key, published: null };
  }
  return { page: key, published };
}

module.exports = {
  LAYOUTS_PATH,
  PAGES,
  WIDGET_TYPES,
  listDashboards,
  getAdminPage,
  saveDraft,
  publishPage,
  revertPage,
  getPublished,
  sanitizeLayout,
  defaultStore,
};
