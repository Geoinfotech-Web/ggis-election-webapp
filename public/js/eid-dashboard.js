(function () {
  const cache = { overview: undefined, live: undefined };
  let loadPromise = null;

  function hasLayout(page) {
    const layout = cache[page];
    return !!(layout && Array.isArray(layout.widgets) && layout.widgets.length);
  }

  async function fetchPage(page) {
    try {
      const res = await fetch('/api/dashboards/' + page, { cache: 'no-store' });
      if (!res.ok) return null;
      const data = await res.json();
      return data.published || null;
    } catch {
      return null;
    }
  }

  async function load() {
    if (loadPromise) return loadPromise;
    loadPromise = Promise.all([fetchPage('overview'), fetchPage('live')]).then(([overview, live]) => {
      cache.overview = overview;
      cache.live = live;
      return cache;
    });
    return loadPromise;
  }

  function pickFromFallback(fallback, metric) {
    if (!Array.isArray(fallback)) return null;
    const key = String(metric || '').toLowerCase();
    const aliases = {
      registered: ['registered', 'reg'],
      turnout: ['turnout', 'turn'],
      elections: ['elections', 'ballot'],
      parties: ['parties', 'groups'],
      votes: ['votes', 'valid'],
      winner_share: ['winner', 'win'],
      pvc_collected: ['pvc', 'collected'],
      collection_rate: ['collection', 'rate'],
      projected_turnout: ['projected', 'str'],
      countries: ['countries', 'public'],
      citizen_reports: ['citizen', 'reports', 'sensors'],
      population: ['population'],
      live_winner: ['winner'],
      live_reports: ['public reports', 'reports'],
      live_approved: ['approved'],
      live_official: ['official'],
    };
    const needles = aliases[key] || [key];
    return fallback.find((item) => {
      const blob = `${item.label || ''} ${item.key || ''} ${item.icon || ''}`.toLowerCase();
      return needles.some((n) => blob.includes(n));
    }) || null;
  }

  function resolveMetric(metric, ctx, fallbackItem) {
    const metrics = (ctx && ctx.metrics) || {};
    if (Object.prototype.hasOwnProperty.call(metrics, metric) && metrics[metric] != null) {
      const m = metrics[metric];
      if (typeof m === 'object') return m;
      return { value: String(m), unit: '', sub: '' };
    }
    if (fallbackItem) {
      return {
        value: fallbackItem.value != null ? String(fallbackItem.value) : '—',
        unit: fallbackItem.unit || '',
        sub: fallbackItem.sub || fallbackItem.delta || fallbackItem.caption || '',
        icon: fallbackItem.icon,
        delta: fallbackItem.delta,
        deltaIcon: fallbackItem.deltaIcon,
        deltaColor: fallbackItem.deltaColor,
        caption: fallbackItem.caption,
      };
    }
    return { value: '—', unit: '', sub: '' };
  }

  function mapKpiWidgets(page, fallback, ctx) {
    if (!hasLayout(page)) return null;
    const kpis = cache[page].widgets.filter((w) => w.type === 'kpi');
    if (!kpis.length) return null;
    return kpis
      .slice()
      .sort((a, b) => (a.y - b.y) || (a.x - b.x))
      .map((w, i) => {
        const c = w.config || {};
        const fallbackItem = pickFromFallback(fallback, c.metric) || fallback[i] || null;
        const resolved = resolveMetric(c.metric || 'custom', ctx, fallbackItem);
        const custom = c.metric === 'custom';
        return {
          key: w.id,
          icon: c.icon || resolved.icon || 'analytics',
          label: c.label || (fallbackItem && fallbackItem.label) || 'KPI',
          value: custom && c.value ? c.value : (resolved.value != null ? resolved.value : '—'),
          unit: c.unit != null && c.unit !== '' ? c.unit : (resolved.unit || ''),
          sub: resolved.sub || '',
          delta: resolved.delta || c.caption || '',
          deltaIcon: resolved.deltaIcon || 'info',
          deltaColor: resolved.deltaColor || 'var(--dim)',
          caption: c.caption || resolved.caption || '',
        };
      });
  }

  function mapExtraWidgets(page, ctx) {
    if (!hasLayout(page)) return [];
    return cache[page].widgets
      .filter((w) => w.type !== 'kpi')
      .slice()
      .sort((a, b) => (a.y - b.y) || (a.x - b.x))
      .map((w) => {
        const c = w.config || {};
        if (w.type === 'map') {
          return {
            id: w.id,
            type: 'map',
            title: c.title || 'Map',
            body: `Map config “${c.mapId || 'unset'}” — Map Studio placeholder`,
            x: w.x, y: w.y, w: w.w, h: w.h,
          };
        }
        if (w.type === 'chart') {
          return {
            id: w.id,
            type: 'chart',
            title: c.title || 'Chart',
            body: `${c.chartType || 'bar'} · ${c.source || 'election-results'}`,
            x: w.x, y: w.y, w: w.w, h: w.h,
          };
        }
        if (w.type === 'list') {
          const items = Array.isArray(c.items) && c.items.length
            ? c.items
            : ((ctx && ctx.listItems) || ['No items yet']);
          return {
            id: w.id,
            type: 'list',
            title: c.title || 'List',
            body: items.slice(0, 8).join(' · '),
            items,
            x: w.x, y: w.y, w: w.w, h: w.h,
          };
        }
        return {
          id: w.id,
          type: 'text',
          title: c.title || 'Note',
          body: c.body || '',
          x: w.x, y: w.y, w: w.w, h: w.h,
        };
      });
  }

  function applyOverview(fallbackKpis, ctx) {
    const mapped = mapKpiWidgets('overview', fallbackKpis, ctx);
    return {
      usedLayout: !!mapped,
      kpis: mapped || fallbackKpis,
      extras: mapExtraWidgets('overview', ctx),
      layout: hasLayout('overview') ? cache.overview : null,
    };
  }

  function applyLive(fallbackStats, ctx) {
    const mapped = mapKpiWidgets('live', fallbackStats, ctx);
    const liveStats = mapped
      ? mapped.map((k) => ({ label: k.label, value: k.value + (k.unit ? ` ${k.unit}` : ''), sub: k.sub || k.caption || '' }))
      : fallbackStats;
    return {
      usedLayout: !!mapped,
      stats: liveStats,
      extras: mapExtraWidgets('live', ctx),
      layout: hasLayout('live') ? cache.live : null,
    };
  }

  window.EidDashboard = {
    load,
    hasLayout,
    applyOverview,
    applyLive,
    getCached: () => cache,
  };
})();
