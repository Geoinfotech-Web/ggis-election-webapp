(function () {
  const COUNTRY_LABELS = {
    global: 'Global',
    ng: 'Nigeria',
    us: 'United States',
    gb: 'United Kingdom',
    gh: 'Ghana',
    ke: 'Kenya',
    in: 'India',
    de: 'Germany',
    fr: 'France',
    br: 'Brazil',
    za: 'South Africa',
  };

  const state = {
    country: 'ng',
    tab: 'nav',
    draft: null,
    published: null,
    enums: null,
    selectedWidgetId: null,
    dirty: false,
  };

  const el = {
    country: document.getElementById('psCountry'),
    meta: document.getElementById('psMeta'),
    main: document.getElementById('psMain'),
    side: document.getElementById('psSide'),
    status: document.getElementById('psStatus'),
    preview: document.getElementById('psPreviewLink'),
  };

  function setStatus(message, isError) {
    if (!el.status) return;
    el.status.textContent = message || '';
    el.status.style.color = isError ? 'var(--danger)' : 'var(--dim)';
  }

  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function markDirty() {
    state.dirty = true;
  }

  async function loadList() {
    const data = await AdminCommon.apiFetch('/api/admin/pages');
    const countries = data.countries || [];
    el.country.innerHTML = countries.map((c) => {
      const label = COUNTRY_LABELS[c.code] || c.code;
      const badge = c.hasPublished ? ' · published' : ' · draft only';
      return `<option value="${escapeHtml(c.code)}">${escapeHtml(label)}${badge}</option>`;
    }).join('');
    if (!countries.some((c) => c.code === state.country) && countries[0]) {
      state.country = countries[0].code;
    }
    el.country.value = state.country;
    state.enums = data.enums || state.enums;
  }

  async function loadCountry(code) {
    state.country = code || state.country;
    setStatus('Loading…');
    const data = await AdminCommon.apiFetch('/api/admin/pages/' + encodeURIComponent(state.country));
    state.draft = data.draft;
    state.published = data.published;
    state.enums = data.enums || state.enums;
    state.selectedWidgetId = null;
    state.dirty = false;
    el.country.value = state.country;
    el.preview.href = state.country === 'global' ? '/' : `/#`;
    renderMeta();
    render();
    setStatus('Loaded ' + (COUNTRY_LABELS[state.country] || state.country));
  }

  function renderMeta() {
    const d = state.draft || {};
    const p = state.published;
    const navVisible = (d.nav || []).filter((n) => n.visible).length;
    const widgets = (d.widgets || []).length;
    el.meta.textContent = [
      COUNTRY_LABELS[state.country] || state.country,
      `tabs visible ${navVisible}/${(d.nav || []).length}`,
      `widgets ${widgets}`,
      state.dirty ? 'unsaved changes' : 'clean',
      `draft ${AdminCommon.formatDate(d.updatedAt)}`,
      p ? `published ${AdminCommon.formatDate(p.publishedAt || p.updatedAt)}` : 'not published',
    ].join(' · ');
  }

  function sortedNav() {
    return (state.draft.nav || []).slice().sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
  }

  function sortedSubTabs() {
    return ((state.draft.subTabs && state.draft.subTabs.Analysis) || [])
      .slice()
      .sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
  }

  function sortedWidgets() {
    return (state.draft.widgets || [])
      .slice()
      .sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
  }

  function moveItem(list, id, delta) {
    const sorted = list.slice().sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
    const index = sorted.findIndex((item) => item.id === id);
    if (index < 0) return;
    const target = index + delta;
    if (target < 0 || target >= sorted.length) return;
    const tmp = sorted[index].order;
    sorted[index].order = sorted[target].order;
    sorted[target].order = tmp;
    // Normalize sequential orders
    sorted
      .slice()
      .sort((a, b) => a.order - b.order || a.id.localeCompare(b.id))
      .forEach((item, i) => { item.order = i; });
    markDirty();
  }

  function renderNavPanel() {
    const rows = sortedNav().map((item) => `
      <div class="ps-row" data-nav-id="${escapeHtml(item.id)}">
        <input type="checkbox" data-nav-vis ${item.visible ? 'checked' : ''} title="Visible" />
        <code>${escapeHtml(item.id)}</code>
        <input type="text" data-nav-label value="${escapeHtml(item.label)}" />
        <label class="ps-hide-sm" style="display:inline-flex;gap:4px;align-items:center;font-weight:500;font-size:0.8rem;color:var(--dim)">
          <input type="checkbox" data-nav-live ${item.live ? 'checked' : ''} /> LIVE
        </label>
        <div class="ps-widget__actions">
          <button type="button" class="admin-btn admin-btn-ghost" data-nav-up title="Move up">↑</button>
          <button type="button" class="admin-btn admin-btn-ghost" data-nav-down title="Move down">↓</button>
        </div>
      </div>
    `).join('');

    el.main.innerHTML = `
      <p class="ps-hint">Control which public nav tabs appear for this country, their labels, and order. Tab ids stay fixed so routing remains stable.</p>
      <div class="ps-row ps-row--head">
        <span>On</span><span>Id</span><span>Label</span><span class="ps-hide-sm">Badge</span><span>Order</span>
      </div>
      ${rows || '<div class="ps-empty">No tabs</div>'}
    `;

    el.main.querySelectorAll('[data-nav-id]').forEach((row) => {
      const id = row.getAttribute('data-nav-id');
      const item = state.draft.nav.find((n) => n.id === id);
      if (!item) return;
      row.querySelector('[data-nav-vis]').addEventListener('change', (e) => {
        item.visible = !!e.target.checked;
        markDirty();
        renderMeta();
      });
      row.querySelector('[data-nav-label]').addEventListener('input', (e) => {
        item.label = e.target.value;
        markDirty();
      });
      const live = row.querySelector('[data-nav-live]');
      if (live) {
        live.addEventListener('change', (e) => {
          item.live = !!e.target.checked;
          markDirty();
        });
      }
      row.querySelector('[data-nav-up]').addEventListener('click', () => {
        moveItem(state.draft.nav, id, -1);
        render();
      });
      row.querySelector('[data-nav-down]').addEventListener('click', () => {
        moveItem(state.draft.nav, id, 1);
        render();
      });
    });

    el.side.innerHTML = `
      <h3 style="margin:0 0 8px;font-size:1rem">Tabs</h3>
      <p class="ps-hint">Hidden tabs stay available in the schema for later re-enable. Map is typically Nigeria-only.</p>
      <div class="ps-chip">${sortedNav().filter((n) => n.visible).map((n) => escapeHtml(n.label)).join(' · ') || 'None visible'}</div>
    `;
  }

  function renderSubTabsPanel() {
    const rows = sortedSubTabs().map((item) => `
      <div class="ps-row" data-sub-id="${escapeHtml(item.id)}" style="grid-template-columns:28px minmax(90px,1fr) minmax(100px,1.2fr) minmax(90px,1fr) 70px">
        <input type="checkbox" data-sub-vis ${item.visible ? 'checked' : ''} />
        <code>${escapeHtml(item.id)}</code>
        <input type="text" data-sub-label value="${escapeHtml(item.label)}" />
        <input type="text" data-sub-icon value="${escapeHtml(item.icon)}" />
        <div class="ps-widget__actions">
          <button type="button" class="admin-btn admin-btn-ghost" data-sub-up>↑</button>
          <button type="button" class="admin-btn admin-btn-ghost" data-sub-down>↓</button>
        </div>
      </div>
    `).join('');

    el.main.innerHTML = `
      <p class="ps-hint">Analysis sub-tabs for this country. Demographics / Data Quality still respect runtime data availability and Advanced mode on the public app.</p>
      <div class="ps-row ps-row--head" style="grid-template-columns:28px minmax(90px,1fr) minmax(100px,1.2fr) minmax(90px,1fr) 70px">
        <span>On</span><span>Id</span><span>Label</span><span>Icon</span><span>Order</span>
      </div>
      ${rows}
    `;

    const list = state.draft.subTabs.Analysis;
    el.main.querySelectorAll('[data-sub-id]').forEach((row) => {
      const id = row.getAttribute('data-sub-id');
      const item = list.find((n) => n.id === id);
      if (!item) return;
      row.querySelector('[data-sub-vis]').addEventListener('change', (e) => {
        item.visible = !!e.target.checked;
        markDirty();
        renderMeta();
      });
      row.querySelector('[data-sub-label]').addEventListener('input', (e) => {
        item.label = e.target.value;
        markDirty();
      });
      row.querySelector('[data-sub-icon]').addEventListener('input', (e) => {
        item.icon = e.target.value;
        markDirty();
      });
      row.querySelector('[data-sub-up]').addEventListener('click', () => {
        moveItem(list, id, -1);
        render();
      });
      row.querySelector('[data-sub-down]').addEventListener('click', () => {
        moveItem(list, id, 1);
        render();
      });
    });

    el.side.innerHTML = `
      <h3 style="margin:0 0 8px;font-size:1rem">Analysis sub-tabs</h3>
      <p class="ps-hint">Widget visibility under Widgets can further hide charts within each sub-tab.</p>
    `;
  }

  function renderEditorialPanel() {
    const ed = state.draft.editorial || { kpiCards: [] };
    const kpiRows = (ed.kpiCards || []).map((card, index) => `
      <div class="ps-widget" data-kpi-index="${index}">
        <div class="ps-widget__head">
          <span class="ps-widget__type">kpi</span>
          <strong>${escapeHtml(card.label || 'KPI')}</strong>
          <div class="ps-widget__actions">
            <button type="button" class="admin-btn admin-btn-ghost" data-kpi-remove>Remove</button>
          </div>
        </div>
        <div class="ps-fields ps-inline">
          <label>Label<input type="text" data-kpi-label value="${escapeHtml(card.label)}" /></label>
          <label>Value<input type="text" data-kpi-value value="${escapeHtml(card.value)}" /></label>
          <label>Unit<input type="text" data-kpi-unit value="${escapeHtml(card.unit || '')}" /></label>
          <label>Icon<input type="text" data-kpi-icon value="${escapeHtml(card.icon || '')}" /></label>
        </div>
        <div class="ps-fields">
          <label>Caption<input type="text" data-kpi-caption value="${escapeHtml(card.caption || '')}" /></label>
        </div>
      </div>
    `).join('');

    el.main.innerHTML = `
      <p class="ps-hint">Country-scoped copy and KPI overlays shown on Overview / coming-soon surfaces.</p>
      <div class="ps-fields">
        <label>Headline<input type="text" id="psHeadline" value="${escapeHtml(ed.headline || '')}" /></label>
        <label>Subhead<textarea id="psSubhead">${escapeHtml(ed.subhead || '')}</textarea></label>
        <label>Notes<textarea id="psNotes">${escapeHtml(ed.notes || '')}</textarea></label>
        <label>Coming-soon message<textarea id="psComingSoon">${escapeHtml(ed.comingSoonMessage || '')}</textarea></label>
      </div>
      <div style="display:flex;justify-content:space-between;align-items:center;margin:12px 0 8px">
        <h3 style="margin:0;font-size:1rem">KPI cards</h3>
        <button type="button" class="admin-btn admin-btn-ghost" id="psAddKpi">Add KPI</button>
      </div>
      ${kpiRows || '<div class="ps-empty">No editorial KPI cards yet</div>'}
    `;

    const bindEd = (id, key) => {
      const input = document.getElementById(id);
      if (!input) return;
      input.addEventListener('input', () => {
        state.draft.editorial[key] = input.value;
        markDirty();
      });
    };
    bindEd('psHeadline', 'headline');
    bindEd('psSubhead', 'subhead');
    bindEd('psNotes', 'notes');
    bindEd('psComingSoon', 'comingSoonMessage');

    document.getElementById('psAddKpi').addEventListener('click', () => {
      state.draft.editorial.kpiCards = state.draft.editorial.kpiCards || [];
      state.draft.editorial.kpiCards.push({
        id: 'kpi-' + (state.draft.editorial.kpiCards.length + 1),
        label: 'New KPI',
        value: '—',
        unit: '',
        caption: '',
        icon: 'analytics',
      });
      markDirty();
      render();
    });

    el.main.querySelectorAll('[data-kpi-index]').forEach((node) => {
      const index = Number(node.getAttribute('data-kpi-index'));
      const card = state.draft.editorial.kpiCards[index];
      if (!card) return;
      const bind = (sel, key) => {
        node.querySelector(sel).addEventListener('input', (e) => {
          card[key] = e.target.value;
          markDirty();
        });
      };
      bind('[data-kpi-label]', 'label');
      bind('[data-kpi-value]', 'value');
      bind('[data-kpi-unit]', 'unit');
      bind('[data-kpi-icon]', 'icon');
      bind('[data-kpi-caption]', 'caption');
      node.querySelector('[data-kpi-remove]').addEventListener('click', () => {
        state.draft.editorial.kpiCards.splice(index, 1);
        markDirty();
        render();
      });
    });

    el.side.innerHTML = `
      <h3 style="margin:0 0 8px;font-size:1rem">Editorial</h3>
      <p class="ps-hint">KPI cards appear as Overview extras for this country after publish. Coming-soon message replaces the default placeholder copy.</p>
      ${(state.draft.codeLocked || []).slice(0, 3).map((c) => `<div class="ps-chip" style="margin:6px 0;display:block">${escapeHtml(c.surface)}</div>`).join('')}
    `;
  }

  function widgetById(id) {
    return (state.draft.widgets || []).find((w) => w.id === id) || null;
  }

  function renderWidgetSide(widget) {
    if (!widget) {
      el.side.innerHTML = '<p class="admin-muted">Select a widget to edit its properties.</p>';
      return;
    }
    const cfg = widget.config || {};
    const sections = (state.enums && state.enums.sections) || [];
    const types = (state.enums && state.enums.widgetTypes) || [];
    const subTabs = (state.enums && state.enums.analysisSubTabs) || [];
    const chartTypes = (state.enums && state.enums.chartTypes) || ['bar', 'line', 'doughnut'];

    let configFields = '';
    if (widget.type === 'chart') {
      configFields = `
        <label>Chart type
          <select data-cfg="chartType">${chartTypes.map((t) => `<option value="${t}" ${cfg.chartType === t ? 'selected' : ''}>${t}</option>`).join('')}</select>
        </label>
        <label>Canvas id<input type="text" data-cfg="canvasId" value="${escapeHtml(cfg.canvasId || '')}" /></label>
        <label>Data key<input type="text" data-cfg="dataKey" value="${escapeHtml(cfg.dataKey || '')}" /></label>
        <label>Source<input type="text" data-cfg="source" value="${escapeHtml(cfg.source || '')}" /></label>
        <label>Meta<input type="text" data-cfg="meta" value="${escapeHtml(cfg.meta || '')}" /></label>
      `;
    } else if (widget.type === 'table') {
      configFields = `
        <label>Data key<input type="text" data-cfg="dataKey" value="${escapeHtml(cfg.dataKey || '')}" /></label>
        <label>Source<input type="text" data-cfg="source" value="${escapeHtml(cfg.source || '')}" /></label>
        <label>Columns (comma-separated)<input type="text" data-cfg="columns" value="${escapeHtml((cfg.columns || []).join(', '))}" /></label>
      `;
    } else if (widget.type === 'kpi') {
      configFields = `
        <label>Metric<input type="text" data-cfg="metric" value="${escapeHtml(cfg.metric || '')}" /></label>
        <label>Label<input type="text" data-cfg="label" value="${escapeHtml(cfg.label || '')}" /></label>
        <label>Value<input type="text" data-cfg="value" value="${escapeHtml(cfg.value || '')}" /></label>
        <label>Unit<input type="text" data-cfg="unit" value="${escapeHtml(cfg.unit || '')}" /></label>
        <label>Icon<input type="text" data-cfg="icon" value="${escapeHtml(cfg.icon || '')}" /></label>
      `;
    } else if (widget.type === 'map') {
      configFields = `
        <label>Map Studio id<input type="text" data-cfg="mapId" value="${escapeHtml(cfg.mapId || '')}" /></label>
      `;
    } else if (widget.type === 'list') {
      configFields = `
        <label>List type
          <select data-cfg="listType">
            ${['standings', 'ranked', 'custom', 'links'].map((t) => `<option value="${t}" ${cfg.listType === t ? 'selected' : ''}>${t}</option>`).join('')}
          </select>
        </label>
        <label>Items (one per line)<textarea data-cfg="items">${escapeHtml((cfg.items || []).join('\n'))}</textarea></label>
      `;
    } else {
      configFields = `<label>Body<textarea data-cfg="body">${escapeHtml(cfg.body || '')}</textarea></label>`;
    }

    el.side.innerHTML = `
      <div class="ps-props-head" style="display:flex;justify-content:space-between;gap:8px;align-items:center;margin-bottom:10px">
        <h3 style="margin:0;font-size:1rem">Widget</h3>
        <button type="button" class="admin-btn admin-btn-ghost" id="psDeleteWidget">Delete</button>
      </div>
      <div class="ps-fields">
        <label>Title<input type="text" id="psWTitle" value="${escapeHtml(widget.title || '')}" /></label>
        <label>Type
          <select id="psWType">${types.map((t) => `<option value="${t}" ${widget.type === t ? 'selected' : ''}>${t}</option>`).join('')}</select>
        </label>
        <label>Section
          <select id="psWSection">${sections.map((t) => `<option value="${t}" ${widget.section === t ? 'selected' : ''}>${t}</option>`).join('')}</select>
        </label>
        <label>Sub-tab
          <select id="psWSubTab">
            <option value="">—</option>
            ${subTabs.map((t) => `<option value="${t}" ${widget.subTab === t ? 'selected' : ''}>${t}</option>`).join('')}
          </select>
        </label>
        <label style="display:flex;align-items:center;gap:8px;font-weight:500">
          <input type="checkbox" id="psWVisible" ${widget.visible !== false ? 'checked' : ''} /> Visible
        </label>
        ${configFields}
      </div>
    `;

    document.getElementById('psWTitle').addEventListener('input', (e) => {
      widget.title = e.target.value;
      markDirty();
      renderWidgetsListOnly();
    });
    document.getElementById('psWType').addEventListener('change', (e) => {
      widget.type = e.target.value;
      widget.config = {};
      markDirty();
      render();
    });
    document.getElementById('psWSection').addEventListener('change', (e) => {
      widget.section = e.target.value;
      if (widget.section !== 'Analysis') widget.subTab = '';
      markDirty();
      render();
    });
    document.getElementById('psWSubTab').addEventListener('change', (e) => {
      widget.subTab = e.target.value;
      markDirty();
      renderWidgetsListOnly();
    });
    document.getElementById('psWVisible').addEventListener('change', (e) => {
      widget.visible = !!e.target.checked;
      markDirty();
      renderWidgetsListOnly();
      renderMeta();
    });
    document.getElementById('psDeleteWidget').addEventListener('click', () => {
      state.draft.widgets = state.draft.widgets.filter((w) => w.id !== widget.id);
      state.selectedWidgetId = null;
      markDirty();
      render();
    });

    el.side.querySelectorAll('[data-cfg]').forEach((input) => {
      const key = input.getAttribute('data-cfg');
      const handler = () => {
        if (key === 'columns') {
          widget.config.columns = input.value.split(',').map((s) => s.trim()).filter(Boolean);
        } else if (key === 'items') {
          widget.config.items = input.value.split('\n').map((s) => s.trim()).filter(Boolean);
        } else {
          widget.config[key] = input.value;
        }
        markDirty();
      };
      input.addEventListener('input', handler);
      input.addEventListener('change', handler);
    });
  }

  function renderWidgetsListOnly() {
    // Lightweight refresh of list titles after side edits
    if (state.tab !== 'widgets') return;
    const list = el.main.querySelector('#psWidgetList');
    if (!list) return;
    list.innerHTML = sortedWidgets().map((w) => widgetCardHtml(w)).join('') || '<div class="ps-empty">No widgets</div>';
    bindWidgetCards();
  }

  function widgetCardHtml(w) {
    return `
      <div class="ps-widget ${state.selectedWidgetId === w.id ? 'is-selected' : ''}" data-widget-id="${escapeHtml(w.id)}">
        <div class="ps-widget__head">
          <span class="ps-widget__type">${escapeHtml(w.type)}</span>
          <strong>${escapeHtml(w.title || w.id)}</strong>
          <span class="ps-chip">${escapeHtml(w.section)}${w.subTab ? ' / ' + escapeHtml(w.subTab) : ''}</span>
          <span class="ps-chip">${w.visible === false ? 'hidden' : 'visible'}</span>
          <div class="ps-widget__actions">
            <button type="button" class="admin-btn admin-btn-ghost" data-w-up>↑</button>
            <button type="button" class="admin-btn admin-btn-ghost" data-w-down>↓</button>
          </div>
        </div>
        <div style="font-size:0.8rem;color:var(--mute)">${escapeHtml(w.id)}${w.config && w.config.canvasId ? ' · ' + escapeHtml(w.config.canvasId) : ''}</div>
      </div>
    `;
  }

  function bindWidgetCards() {
    el.main.querySelectorAll('[data-widget-id]').forEach((node) => {
      const id = node.getAttribute('data-widget-id');
      node.addEventListener('click', (e) => {
        if (e.target.closest('[data-w-up]') || e.target.closest('[data-w-down]')) return;
        state.selectedWidgetId = id;
        render();
      });
      const up = node.querySelector('[data-w-up]');
      const down = node.querySelector('[data-w-down]');
      if (up) {
        up.addEventListener('click', (e) => {
          e.stopPropagation();
          moveItem(state.draft.widgets, id, -1);
          render();
        });
      }
      if (down) {
        down.addEventListener('click', (e) => {
          e.stopPropagation();
          moveItem(state.draft.widgets, id, 1);
          render();
        });
      }
    });
  }

  function renderWidgetsPanel() {
    el.main.innerHTML = `
      <p class="ps-hint">Configure chart/table/text widgets. Analysis widgets with a canvas id update titles and visibility on the public Analysis page. Overview extras render as cards.</p>
      <div style="display:flex;gap:8px;margin-bottom:10px">
        <button type="button" class="admin-btn admin-btn-ghost" id="psAddWidget">Add widget</button>
      </div>
      <div id="psWidgetList">${sortedWidgets().map(widgetCardHtml).join('') || '<div class="ps-empty">No widgets</div>'}</div>
    `;
    document.getElementById('psAddWidget').addEventListener('click', () => {
      const id = 'widget-' + Date.now().toString(36);
      state.draft.widgets.push({
        id,
        section: 'Overview',
        subTab: '',
        type: 'text',
        visible: true,
        order: state.draft.widgets.length,
        title: 'New note',
        config: { body: '' },
      });
      state.selectedWidgetId = id;
      markDirty();
      render();
    });
    bindWidgetCards();
    renderWidgetSide(widgetById(state.selectedWidgetId));
  }

  function renderSourcesPanel() {
    const rows = (state.draft.dataSources || []).map((src, index) => `
      <div class="ps-widget" data-src-index="${index}">
        <div class="ps-widget__head">
          <span class="ps-widget__type">${src.enabled ? 'on' : 'off'}</span>
          <strong>${escapeHtml(src.label)}</strong>
          <div class="ps-widget__actions">
            <button type="button" class="admin-btn admin-btn-ghost" data-src-remove>Remove</button>
          </div>
        </div>
        <div class="ps-fields">
          <label style="display:flex;align-items:center;gap:8px;font-weight:500">
            <input type="checkbox" data-src-enabled ${src.enabled ? 'checked' : ''} /> Enabled
          </label>
          <label>Label<input type="text" data-src-label value="${escapeHtml(src.label)}" /></label>
          <label>Endpoint / path<input type="text" data-src-endpoint value="${escapeHtml(src.endpoint || '')}" /></label>
          <label>Notes<textarea data-src-notes>${escapeHtml(src.notes || '')}</textarea></label>
        </div>
      </div>
    `).join('');

    el.main.innerHTML = `
      <p class="ps-hint">Attach or document country-scoped API / data hooks. Enabled sources with endpoints are advertised to the public consumer for discovery; existing fetch wiring still uses known APIs.</p>
      <div style="margin-bottom:10px">
        <button type="button" class="admin-btn admin-btn-ghost" id="psAddSource">Add data source</button>
      </div>
      ${rows || '<div class="ps-empty">No data sources</div>'}
    `;

    document.getElementById('psAddSource').addEventListener('click', () => {
      state.draft.dataSources.push({
        id: 'source-' + Date.now().toString(36),
        label: 'New source',
        endpoint: '',
        enabled: true,
        notes: '',
      });
      markDirty();
      render();
    });

    el.main.querySelectorAll('[data-src-index]').forEach((node) => {
      const index = Number(node.getAttribute('data-src-index'));
      const src = state.draft.dataSources[index];
      if (!src) return;
      node.querySelector('[data-src-enabled]').addEventListener('change', (e) => {
        src.enabled = !!e.target.checked;
        markDirty();
        render();
      });
      node.querySelector('[data-src-label]').addEventListener('input', (e) => {
        src.label = e.target.value;
        markDirty();
      });
      node.querySelector('[data-src-endpoint]').addEventListener('input', (e) => {
        src.endpoint = e.target.value;
        markDirty();
      });
      node.querySelector('[data-src-notes]').addEventListener('input', (e) => {
        src.notes = e.target.value;
        markDirty();
      });
      node.querySelector('[data-src-remove]').addEventListener('click', () => {
        state.draft.dataSources.splice(index, 1);
        markDirty();
        render();
      });
    });

    el.side.innerHTML = `
      <h3 style="margin:0 0 8px;font-size:1rem">Related studios</h3>
      <p class="ps-hint">Dashboard KPI grids and Map Studio configs remain in their own modules.</p>
      <div style="display:grid;gap:8px">
        <a class="admin-btn admin-btn-ghost" href="/admin/dashboards.html">Dashboards</a>
        <a class="admin-btn admin-btn-ghost" href="/admin/maps.html">Maps</a>
        <a class="admin-btn admin-btn-ghost" href="/admin/content.html">Content / catalogs</a>
      </div>
    `;
  }

  function renderCapsPanel() {
    const caps = state.draft.capabilities || {};
    const keys = [
      ['liveData', 'Live data'],
      ['maps', 'Maps'],
      ['analysis', 'Analysis'],
      ['candidates', 'Candidates'],
      ['parties', 'Parties'],
      ['liveResults', 'Live results'],
      ['dataExplorer', 'Data explorer'],
      ['comingSoon', 'Coming soon gate'],
    ];
    el.main.innerHTML = `
      <p class="ps-hint">Capability flags gate which sections behave as live for this country. Coming-soon overrides most live sections on the public app.</p>
      <div class="ps-cap-grid">
        ${keys.map(([key, label]) => `
          <label><input type="checkbox" data-cap="${key}" ${caps[key] ? 'checked' : ''} /> ${label}</label>
        `).join('')}
      </div>
      <h3 style="margin:18px 0 8px;font-size:1rem">Still code-locked</h3>
      <ul class="ps-locked">
        ${(state.draft.codeLocked || []).map((c) => `<li><strong>${escapeHtml(c.surface)}</strong> — ${escapeHtml(c.note)}</li>`).join('') || '<li>None listed</li>'}
      </ul>
    `;
    el.main.querySelectorAll('[data-cap]').forEach((input) => {
      input.addEventListener('change', (e) => {
        state.draft.capabilities[e.target.getAttribute('data-cap')] = !!e.target.checked;
        markDirty();
      });
    });
    el.side.innerHTML = `
      <h3 style="margin:0 0 8px;font-size:1rem">Publish checklist</h3>
      <ol style="margin:0;padding-left:18px;color:var(--dim);font-size:0.85rem;line-height:1.5">
        <li>Set tabs &amp; sub-tabs</li>
        <li>Tune widgets / editorial</li>
        <li>Save draft</li>
        <li>Publish to make public</li>
        <li>Open public app and switch country</li>
      </ol>
    `;
  }

  function render() {
    if (!state.draft) {
      el.main.innerHTML = '<div class="ps-empty">Loading…</div>';
      return;
    }
    renderMeta();
    if (state.tab === 'nav') renderNavPanel();
    else if (state.tab === 'subtabs') renderSubTabsPanel();
    else if (state.tab === 'editorial') renderEditorialPanel();
    else if (state.tab === 'widgets') renderWidgetsPanel();
    else if (state.tab === 'sources') renderSourcesPanel();
    else renderCapsPanel();
  }

  async function saveDraft() {
    try {
      setStatus('Saving draft…');
      const data = await AdminCommon.apiFetch('/api/admin/pages/' + encodeURIComponent(state.country), {
        method: 'PUT',
        body: JSON.stringify({ bundle: state.draft }),
      });
      state.draft = data.draft;
      state.published = data.published;
      state.dirty = false;
      renderMeta();
      setStatus('Draft saved.');
      await loadList();
      el.country.value = state.country;
    } catch (error) {
      setStatus(error.message || 'Save failed', true);
    }
  }

  async function publish() {
    try {
      if (state.dirty) await saveDraft();
      setStatus('Publishing…');
      const data = await AdminCommon.apiFetch('/api/admin/pages/' + encodeURIComponent(state.country) + '/publish', {
        method: 'POST',
        body: '{}',
      });
      state.draft = data.draft;
      state.published = data.published;
      state.dirty = false;
      renderMeta();
      setStatus('Published. Public app will pick this up within ~15s cache.');
      await loadList();
      el.country.value = state.country;
    } catch (error) {
      setStatus(error.message || 'Publish failed', true);
    }
  }

  async function revert() {
    try {
      setStatus('Reverting…');
      const data = await AdminCommon.apiFetch('/api/admin/pages/' + encodeURIComponent(state.country) + '/revert', {
        method: 'POST',
        body: '{}',
      });
      state.draft = data.draft;
      state.published = data.published;
      state.dirty = false;
      render();
      setStatus('Draft reverted to published.');
    } catch (error) {
      setStatus(error.message || 'Revert failed', true);
    }
  }

  function bindChrome() {
    document.querySelectorAll('[data-ps-tab]').forEach((btn) => {
      btn.addEventListener('click', () => {
        state.tab = btn.getAttribute('data-ps-tab');
        document.querySelectorAll('[data-ps-tab]').forEach((b) => b.classList.toggle('is-active', b === btn));
        render();
      });
    });
    el.country.addEventListener('change', async () => {
      if (state.dirty && !window.confirm('Discard unsaved changes?')) {
        el.country.value = state.country;
        return;
      }
      await loadCountry(el.country.value);
    });
    document.getElementById('psSave').addEventListener('click', saveDraft);
    document.getElementById('psPublish').addEventListener('click', publish);
    document.getElementById('psRevert').addEventListener('click', revert);
  }

  AdminCommon.mountShell({
    active: 'pages',
    title: 'Pages',
    kicker: 'Page / Content Studio',
  }).then(async () => {
    bindChrome();
    try {
      await loadList();
      await loadCountry(state.country);
    } catch (error) {
      setStatus(error.message || 'Failed to load page studio', true);
    }
  });
})();
