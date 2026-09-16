(function () {
  const cache = Object.create(null);
  const inflight = Object.create(null);

  const DEFAULT_NAV = [
    { id: 'Overview', label: 'Overview', visible: true, order: 0, live: false },
    { id: 'Map', label: 'Polling units', visible: true, order: 1, live: false },
    { id: 'Live Results', label: 'Live Results', visible: true, order: 2, live: true },
    { id: 'Candidates', label: 'Candidates', visible: true, order: 3, live: false },
    { id: 'Parties', label: 'Parties', visible: true, order: 4, live: false },
    { id: 'Analysis', label: 'Analysis', visible: true, order: 5, live: false },
    { id: 'Data', label: 'Data', visible: true, order: 6, live: false },
    { id: 'About', label: 'About', visible: true, order: 7, live: false },
  ];

  const DEFAULT_ANALYSIS_TABS = [
    { id: 'overview', label: 'Overview', icon: 'insights', visible: true, order: 0 },
    { id: 'geography', label: 'Geography', icon: 'map', visible: true, order: 1 },
    { id: 'turnout', label: 'Turnout', icon: 'how_to_vote', visible: true, order: 2 },
    { id: 'trends', label: 'Trends', icon: 'timeline', visible: true, order: 3 },
    { id: 'demographics', label: 'Demographics', icon: 'groups', visible: true, order: 4 },
    { id: 'quality', label: 'Data Quality', icon: 'fact_check', visible: true, order: 5 },
  ];

  function scopeKey(scope) {
    const key = String(scope || 'global').toLowerCase();
    return key || 'global';
  }

  async function fetchPublished(scope) {
    const key = scopeKey(scope);
    try {
      const res = await fetch('/api/page-content/' + encodeURIComponent(key), { cache: 'no-store' });
      if (!res.ok) return null;
      const data = await res.json();
      return data.published || null;
    } catch {
      return null;
    }
  }

  async function load(scope) {
    const key = scopeKey(scope);
    if (Object.prototype.hasOwnProperty.call(cache, key)) return cache[key];
    if (inflight[key]) return inflight[key];
    inflight[key] = fetchPublished(key).then((published) => {
      cache[key] = published;
      delete inflight[key];
      return published;
    });
    return inflight[key];
  }

  function invalidate(scope) {
    if (scope == null) {
      Object.keys(cache).forEach((k) => { delete cache[k]; });
      return;
    }
    delete cache[scopeKey(scope)];
  }

  function getCached(scope) {
    const key = scopeKey(scope);
    return Object.prototype.hasOwnProperty.call(cache, key) ? cache[key] : undefined;
  }

  function capabilities(scope) {
    const published = getCached(scope);
    if (published && published.capabilities) return published.capabilities;
    const key = scopeKey(scope);
    if (key === 'ng') {
      return {
        liveData: true, maps: true, analysis: true, candidates: true,
        parties: true, liveResults: true, dataExplorer: true, comingSoon: false,
      };
    }
    if (key === 'global') {
      return {
        liveData: true, maps: false, analysis: true, candidates: true,
        parties: true, liveResults: true, dataExplorer: true, comingSoon: false,
      };
    }
    return {
      liveData: false, maps: false, analysis: false, candidates: false,
      parties: false, liveResults: false, dataExplorer: false, comingSoon: true,
    };
  }

  function navItems(scope, options) {
    const opts = options || {};
    const published = getCached(scope);
    const caps = capabilities(scope);
    const key = scopeKey(scope);
    const source = (published && Array.isArray(published.nav) && published.nav.length)
      ? published.nav
      : DEFAULT_NAV;

    return source
      .slice()
      .sort((a, b) => (a.order - b.order) || String(a.id).localeCompare(String(b.id)))
      .filter((item) => {
        if (item.visible === false) return false;
        if (item.id === 'Map' && !caps.maps && key !== 'ng') return false;
        if (caps.comingSoon && !['Overview', 'About'].includes(item.id)) return false;
        if (typeof opts.filter === 'function' && !opts.filter(item)) return false;
        return true;
      })
      .map((item) => ({
        id: item.id,
        label: item.label || item.id,
        live: !!item.live,
        order: item.order,
      }));
  }

  function analysisSubTabs(scope, options) {
    const opts = options || {};
    const published = getCached(scope);
    const source = (published
      && published.subTabs
      && Array.isArray(published.subTabs.Analysis)
      && published.subTabs.Analysis.length)
      ? published.subTabs.Analysis
      : DEFAULT_ANALYSIS_TABS;

    return source
      .slice()
      .sort((a, b) => (a.order - b.order) || String(a.id).localeCompare(String(b.id)))
      .filter((item) => {
        if (item.visible === false) return false;
        if (item.id === 'demographics' && !opts.demoAvailable) return false;
        if (item.id === 'quality' && !opts.anaAdvanced) return false;
        return true;
      })
      .map((item) => ({
        id: item.id,
        label: item.label || item.id,
        icon: item.icon || 'tab',
        order: item.order,
      }));
  }

  function editorial(scope) {
    const published = getCached(scope);
    if (published && published.editorial) return published.editorial;
    return {
      headline: '',
      subhead: '',
      notes: '',
      comingSoonMessage: '',
      kpiCards: [],
    };
  }

  function widgets(scope, filter) {
    const published = getCached(scope);
    const list = (published && Array.isArray(published.widgets)) ? published.widgets : [];
    return list
      .filter((w) => w && w.visible !== false)
      .filter((w) => {
        if (!filter) return true;
        if (filter.section && w.section !== filter.section) return false;
        if (filter.subTab && w.subTab !== filter.subTab) return false;
        if (filter.type && w.type !== filter.type) return false;
        return true;
      })
      .slice()
      .sort((a, b) => (a.order - b.order) || String(a.id).localeCompare(String(b.id)));
  }

  function widgetTitleMap(scope) {
    const map = Object.create(null);
    widgets(scope).forEach((w) => {
      if (w.config && w.config.canvasId) map[w.config.canvasId] = w.title || w.id;
      map[w.id] = w.title || w.id;
    });
    return map;
  }

  function hiddenCanvasIds(scope) {
    const published = getCached(scope);
    const list = (published && Array.isArray(published.widgets)) ? published.widgets : [];
    return list
      .filter((w) => w && w.visible === false && w.config && w.config.canvasId)
      .map((w) => w.config.canvasId);
  }

  function overviewExtras(scope) {
    const ed = editorial(scope);
    const cards = Array.isArray(ed.kpiCards) ? ed.kpiCards : [];
    const fromKpis = cards.map((card) => ({
      id: card.id,
      type: 'kpi',
      title: card.label || 'KPI',
      body: `${card.value || '—'}${card.unit ? ' ' + card.unit : ''}${card.caption ? ' · ' + card.caption : ''}`,
      w: 3,
    }));
    const fromWidgets = widgets(scope, { section: 'Overview' })
      .filter((w) => w.type !== 'kpi' || !cards.some((c) => c.id === w.id))
      .map((w) => {
        const c = w.config || {};
        if (w.type === 'text') {
          return { id: w.id, type: 'text', title: w.title || 'Note', body: c.body || '', w: 4 };
        }
        if (w.type === 'list') {
          return {
            id: w.id,
            type: 'list',
            title: w.title || 'List',
            body: (c.items || []).slice(0, 8).join(' · '),
            w: 4,
          };
        }
        if (w.type === 'chart') {
          return {
            id: w.id,
            type: 'chart',
            title: w.title || 'Chart',
            body: `${c.chartType || 'bar'} · ${c.source || 'custom'}`,
            w: 4,
          };
        }
        if (w.type === 'map') {
          return {
            id: w.id,
            type: 'map',
            title: w.title || 'Map',
            body: c.mapId ? `Map “${c.mapId}”` : 'Map widget',
            w: 6,
          };
        }
        return {
          id: w.id,
          type: w.type,
          title: w.title || w.type,
          body: c.body || c.meta || '',
          w: 4,
        };
      });

    const notes = [];
    if (ed.headline || ed.subhead || ed.notes) {
      notes.push({
        id: 'editorial-note',
        type: 'text',
        title: ed.headline || 'Editorial',
        body: [ed.subhead, ed.notes].filter(Boolean).join(' — '),
        w: 12,
      });
    }
    return notes.concat(fromKpis, fromWidgets);
  }

  function dataSources(scope) {
    const published = getCached(scope);
    if (!published || !Array.isArray(published.dataSources)) return [];
    return published.dataSources.filter((s) => s && s.enabled !== false);
  }

  function escapeCssIdent(value) {
    if (typeof CSS !== 'undefined' && CSS.escape) return CSS.escape(value);
    return String(value).replace(/([^a-zA-Z0-9_-])/g, '\\$1');
  }

  function applyDomOverrides(scope, root) {
    const host = root || document;
    const titles = widgetTitleMap(scope);
    const hidden = new Set(hiddenCanvasIds(scope));

    Object.keys(titles).forEach((canvasId) => {
      if (!canvasId || canvasId.indexOf('anaChart') !== 0) return;
      const canvas = host.querySelector ? host.querySelector('#' + escapeCssIdent(canvasId)) : null;
      if (!canvas) return;
      const card = canvas.closest('.eid-analysis-card, .eid-analysis-section, .eid-analysis-predict');
      if (!card) return;
      const heading = card.querySelector('.eid-analysis-card__hd h2, .eid-analysis-section__hd h2, h2');
      if (heading && titles[canvasId]) heading.textContent = titles[canvasId];
    });

    hidden.forEach((canvasId) => {
      const canvas = host.querySelector ? host.querySelector('#' + escapeCssIdent(canvasId)) : null;
      if (!canvas) return;
      const card = canvas.closest('.eid-analysis-card, .eid-analysis-section');
      if (card) card.style.display = 'none';
      else canvas.style.display = 'none';
    });

    // Re-show previously hidden cards when config changes
    if (host.querySelectorAll) {
      host.querySelectorAll('canvas[id^="anaChart"]').forEach((canvas) => {
        if (hidden.has(canvas.id)) return;
        const card = canvas.closest('.eid-analysis-card, .eid-analysis-section');
        if (card && card.style.display === 'none') card.style.display = '';
        if (canvas.style.display === 'none') canvas.style.display = '';
      });
    }
  }

  function comingSoonMessage(scope, fallback) {
    const ed = editorial(scope);
    if (ed.comingSoonMessage) return ed.comingSoonMessage;
    return fallback || 'Live results and KPIs for this country are not loaded yet. Nigeria is the live scope.';
  }

  window.EidPageContent = {
    load,
    invalidate,
    getCached,
    capabilities,
    navItems,
    analysisSubTabs,
    editorial,
    widgets,
    widgetTitleMap,
    hiddenCanvasIds,
    overviewExtras,
    dataSources,
    applyDomOverrides,
    comingSoonMessage,
    DEFAULT_NAV,
    DEFAULT_ANALYSIS_TABS,
  };
})();
