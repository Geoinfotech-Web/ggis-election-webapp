(function () {
  const apiFetch = () => window.AdminCommon.apiFetch;
  const METRICS = [
    { id: 'registered', label: 'Registered voters' },
    { id: 'turnout', label: 'Turnout' },
    { id: 'elections', label: 'Elections' },
    { id: 'parties', label: 'Parties' },
    { id: 'votes', label: 'Valid votes' },
    { id: 'winner_share', label: 'Winner share' },
    { id: 'pvc_collected', label: 'PVCs collected' },
    { id: 'collection_rate', label: 'Collection rate' },
    { id: 'projected_turnout', label: 'Projected turnout' },
    { id: 'countries', label: 'Countries (global)' },
    { id: 'citizen_reports', label: 'Citizen reports' },
    { id: 'population', label: 'Population' },
    { id: 'live_winner', label: 'Live · Winner' },
    { id: 'live_reports', label: 'Live · Public reports' },
    { id: 'live_approved', label: 'Live · Approved' },
    { id: 'live_official', label: 'Live · Official' },
    { id: 'custom', label: 'Custom static value' },
  ];

  const PALETTE = [
    { type: 'kpi', label: 'KPI card', blurb: 'Metric-bound or static value', defaults: { w: 3, h: 1, config: { metric: 'registered', label: 'KPI', icon: 'analytics' } } },
    { type: 'map', label: 'Map', blurb: 'Map Studio config id', defaults: { w: 8, h: 5, config: { mapId: 'overview-default', title: 'Map' } } },
    { type: 'chart', label: 'Chart', blurb: 'Bar / line / doughnut', defaults: { w: 6, h: 4, config: { chartType: 'bar', title: 'Chart', source: 'election-results' } } },
    { type: 'list', label: 'List / table', blurb: 'Standings or ranked units', defaults: { w: 4, h: 4, config: { listType: 'standings', title: 'Standings', items: [] } } },
    { type: 'text', label: 'Text / note', blurb: 'Caption or rich note', defaults: { w: 4, h: 2, config: { title: 'Note', body: '' } } },
  ];

  const state = {
    page: 'overview',
    draft: null,
    published: null,
    selectedId: null,
    preview: false,
    dirty: false,
    drag: null,
  };

  const els = {};

  function $(id) {
    return document.getElementById(id);
  }

  function uid(type) {
    return `${type}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  }

  function setStatus(msg, kind) {
    if (!els.status) return;
    els.status.textContent = msg || '';
    els.status.className = 'admin-status' + (kind === 'error' ? ' is-error' : kind === 'ok' ? ' is-ok' : '');
  }

  function nextFreeY(widgets) {
    return (widgets || []).reduce((max, w) => Math.max(max, (w.y || 0) + (w.h || 1)), 0);
  }

  function findWidget(id) {
    return (state.draft?.widgets || []).find((w) => w.id === id) || null;
  }

  async function loadPage(page) {
    setStatus('Loading…');
    const data = await apiFetch()(`/api/admin/dashboards/${page}`);
    state.page = page;
    state.draft = data.draft;
    state.published = data.published;
    state.selectedId = null;
    state.dirty = false;
    state.preview = false;
    document.querySelectorAll('[data-page-tab]').forEach((btn) => {
      btn.classList.toggle('is-active', btn.dataset.pageTab === page);
    });
    els.previewBtn?.classList.toggle('is-active', false);
    renderAll();
    setStatus(`Loaded ${page} draft (${(state.draft.widgets || []).length} widgets).`, 'ok');
  }

  function renderAll() {
    renderMeta();
    renderCanvas();
    renderProps();
  }

  function renderMeta() {
    const draftAt = state.draft?.updatedAt ? window.AdminCommon.formatDate(state.draft.updatedAt) : 'Never saved';
    const pubAt = state.published?.publishedAt || state.published?.updatedAt;
    els.meta.textContent = `Draft: ${draftAt} · Published: ${pubAt ? window.AdminCommon.formatDate(pubAt) : 'Not published'}${state.dirty ? ' · Unsaved changes' : ''}`;
    els.revertBtn.disabled = !state.published;
  }

  function widgetTitle(w) {
    const c = w.config || {};
    if (w.type === 'kpi') return c.label || c.metric || 'KPI';
    if (w.type === 'map') return c.title || c.mapId || 'Map';
    if (w.type === 'chart') return c.title || 'Chart';
    if (w.type === 'list') return c.title || 'List';
    return c.title || 'Text';
  }

  function widgetBody(w) {
    const c = w.config || {};
    if (w.type === 'kpi') return `${c.metric || 'custom'}${c.unit ? ` · ${c.unit}` : ''}`;
    if (w.type === 'map') return `mapId: ${c.mapId || '—'}`;
    if (w.type === 'chart') return `${c.chartType || 'bar'} · ${c.source || ''}`;
    if (w.type === 'list') return c.listType || 'standings';
    return (c.body || '').slice(0, 80) || 'Empty note';
  }

  function renderCanvas() {
    const canvas = els.canvas;
    const rowH = state.draft?.grid?.rowHeight || 80;
    const widgets = state.draft?.widgets || [];
    const rows = Math.max(6, nextFreeY(widgets) + 2);
    canvas.style.setProperty('--row-h', `${rowH}px`);
    canvas.style.gridTemplateRows = `repeat(${rows}, ${rowH}px)`;
    canvas.classList.toggle('is-preview', state.preview);
    canvas.innerHTML = '';

    if (!widgets.length) {
      const empty = document.createElement('div');
      empty.className = 'db-empty';
      empty.textContent = 'No widgets yet. Click Add element to place KPIs, maps, charts, lists, or text.';
      empty.style.gridColumn = '1 / -1';
      empty.style.gridRow = '1 / span 2';
      canvas.appendChild(empty);
      return;
    }

    widgets.forEach((w) => {
      const card = document.createElement('div');
      card.className = 'db-widget' + (w.id === state.selectedId ? ' is-selected' : '');
      card.dataset.id = w.id;
      card.style.gridColumn = `${(w.x || 0) + 1} / span ${w.w || 1}`;
      card.style.gridRow = `${(w.y || 0) + 1} / span ${w.h || 1}`;
      card.innerHTML = `
        <div class="db-widget__head">
          <span class="db-widget__type">${w.type}</span>
          <strong>${escapeHtml(widgetTitle(w))}</strong>
        </div>
        <div class="db-widget__body">${escapeHtml(widgetBody(w))}</div>
        ${state.preview ? '' : '<div class="db-widget__resize" data-resize="1" title="Resize"></div>'}`;
      card.addEventListener('pointerdown', onWidgetPointerDown);
      canvas.appendChild(card);
    });
  }

  function escapeHtml(value) {
    return String(value || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function cellFromPoint(clientX, clientY) {
    const rect = els.canvas.getBoundingClientRect();
    const gap = 8;
    const colW = (rect.width - gap * 11) / 12;
    const rowH = state.draft?.grid?.rowHeight || 80;
    const x = Math.max(0, Math.min(11, Math.floor((clientX - rect.left) / (colW + gap))));
    const y = Math.max(0, Math.floor((clientY - rect.top) / (rowH + gap)));
    return { x, y };
  }

  function onWidgetPointerDown(ev) {
    if (state.preview) return;
    const card = ev.currentTarget;
    const id = card.dataset.id;
    const widget = findWidget(id);
    if (!widget) return;
    state.selectedId = id;
    renderProps();
    document.querySelectorAll('.db-widget').forEach((el) => el.classList.toggle('is-selected', el.dataset.id === id));

    const resizing = !!ev.target.closest('[data-resize]');
    const startCell = cellFromPoint(ev.clientX, ev.clientY);
    state.drag = {
      id,
      resizing,
      originX: widget.x,
      originY: widget.y,
      originW: widget.w,
      originH: widget.h,
      startX: startCell.x,
      startY: startCell.y,
    };
    card.setPointerCapture(ev.pointerId);
    card.addEventListener('pointermove', onWidgetPointerMove);
    card.addEventListener('pointerup', onWidgetPointerUp);
    card.addEventListener('pointercancel', onWidgetPointerUp);
    ev.preventDefault();
  }

  function onWidgetPointerMove(ev) {
    if (!state.drag) return;
    const widget = findWidget(state.drag.id);
    if (!widget) return;
    const cell = cellFromPoint(ev.clientX, ev.clientY);
    const dx = cell.x - state.drag.startX;
    const dy = cell.y - state.drag.startY;
    if (state.drag.resizing) {
      widget.w = Math.max(1, Math.min(12 - widget.x, state.drag.originW + dx));
      widget.h = Math.max(1, Math.min(12, state.drag.originH + dy));
    } else {
      widget.x = Math.max(0, Math.min(12 - widget.w, state.drag.originX + dx));
      widget.y = Math.max(0, state.drag.originY + dy);
    }
    state.dirty = true;
    const card = ev.currentTarget;
    card.style.gridColumn = `${widget.x + 1} / span ${widget.w}`;
    card.style.gridRow = `${widget.y + 1} / span ${widget.h}`;
    renderMeta();
  }

  function onWidgetPointerUp(ev) {
    const card = ev.currentTarget;
    card.releasePointerCapture?.(ev.pointerId);
    card.removeEventListener('pointermove', onWidgetPointerMove);
    card.removeEventListener('pointerup', onWidgetPointerUp);
    card.removeEventListener('pointercancel', onWidgetPointerUp);
    state.drag = null;
    renderCanvas();
    renderProps();
  }

  function renderProps() {
    const panel = els.props;
    const w = findWidget(state.selectedId);
    if (!w) {
      panel.innerHTML = '<p class="admin-muted">Select a widget on the canvas to edit its properties.</p>';
      return;
    }
    const c = w.config || {};
    let extra = '';
    if (w.type === 'kpi') {
      extra = `
        <label>Metric<select data-field="metric">${METRICS.map((m) => `<option value="${m.id}" ${c.metric === m.id ? 'selected' : ''}>${m.label}</option>`).join('')}</select></label>
        <label>Label<input data-field="label" value="${escapeHtml(c.label || '')}" /></label>
        <label>Icon<input data-field="icon" value="${escapeHtml(c.icon || '')}" placeholder="Material symbol name" /></label>
        <label>Unit<input data-field="unit" value="${escapeHtml(c.unit || '')}" /></label>
        <label>Static value<input data-field="value" value="${escapeHtml(c.value || '')}" placeholder="Used when metric is custom" /></label>
        <label>Caption<input data-field="caption" value="${escapeHtml(c.caption || '')}" /></label>`;
    } else if (w.type === 'map') {
      extra = `
        <label>Map id<input data-field="mapId" value="${escapeHtml(c.mapId || '')}" placeholder="overview-default" /></label>
        <label>Title<input data-field="title" value="${escapeHtml(c.title || '')}" /></label>
        <p class="admin-muted" style="margin:0;font-size:0.85rem">Map Studio may not exist yet — public app shows a graceful placeholder for unknown map ids.</p>`;
    } else if (w.type === 'chart') {
      extra = `
        <label>Title<input data-field="title" value="${escapeHtml(c.title || '')}" /></label>
        <label>Type<select data-field="chartType">${['bar', 'line', 'doughnut'].map((t) => `<option value="${t}" ${c.chartType === t ? 'selected' : ''}>${t}</option>`).join('')}</select></label>
        <label>Source<input data-field="source" value="${escapeHtml(c.source || '')}" /></label>`;
    } else if (w.type === 'list') {
      extra = `
        <label>Title<input data-field="title" value="${escapeHtml(c.title || '')}" /></label>
        <label>List type<select data-field="listType">${['standings', 'ranked', 'custom'].map((t) => `<option value="${t}" ${c.listType === t ? 'selected' : ''}>${t}</option>`).join('')}</select></label>
        <label>Custom items (one per line)<textarea data-field="itemsText" rows="4">${escapeHtml((c.items || []).join('\n'))}</textarea></label>`;
    } else {
      extra = `
        <label>Title<input data-field="title" value="${escapeHtml(c.title || '')}" /></label>
        <label>Body<textarea data-field="body" rows="5">${escapeHtml(c.body || '')}</textarea></label>`;
    }

    panel.innerHTML = `
      <div class="db-props-head">
        <strong>${escapeHtml(w.type)} · ${escapeHtml(w.id)}</strong>
        <button type="button" class="admin-btn admin-btn-ghost admin-btn-small" id="dbDeleteWidget">Delete</button>
      </div>
      <div class="db-props-grid">
        <label>X<input type="number" min="0" max="11" data-geo="x" value="${w.x}" /></label>
        <label>Y<input type="number" min="0" max="40" data-geo="y" value="${w.y}" /></label>
        <label>W<input type="number" min="1" max="12" data-geo="w" value="${w.w}" /></label>
        <label>H<input type="number" min="1" max="12" data-geo="h" value="${w.h}" /></label>
      </div>
      <div class="db-props-fields">${extra}</div>`;

    panel.querySelectorAll('[data-geo]').forEach((input) => {
      input.addEventListener('change', () => {
        const key = input.dataset.geo;
        let val = Number.parseInt(input.value, 10) || 0;
        if (key === 'x') val = Math.max(0, Math.min(11, val));
        if (key === 'y') val = Math.max(0, val);
        if (key === 'w') val = Math.max(1, Math.min(12, val));
        if (key === 'h') val = Math.max(1, Math.min(12, val));
        w[key] = val;
        if (w.x + w.w > 12) w.x = Math.max(0, 12 - w.w);
        state.dirty = true;
        renderAll();
      });
    });

    panel.querySelectorAll('[data-field]').forEach((input) => {
      input.addEventListener('change', () => applyField(w, input));
      input.addEventListener('input', () => {
        if (input.tagName === 'TEXTAREA' || input.type === 'text') applyField(w, input, true);
      });
    });

    panel.querySelector('#dbDeleteWidget')?.addEventListener('click', () => {
      state.draft.widgets = state.draft.widgets.filter((item) => item.id !== w.id);
      state.selectedId = null;
      state.dirty = true;
      renderAll();
      setStatus('Widget removed (unsaved).');
    });
  }

  function applyField(widget, input, soft) {
    const field = input.dataset.field;
    if (field === 'itemsText') {
      widget.config.items = String(input.value || '')
        .split('\n')
        .map((s) => s.trim())
        .filter(Boolean)
        .slice(0, 20);
    } else {
      widget.config[field] = input.value;
    }
    state.dirty = true;
    if (!soft) renderCanvas();
    renderMeta();
  }

  function openPalette() {
    els.palette.hidden = false;
    els.palette.innerHTML = `
      <div class="db-palette-card">
        <div class="db-palette-head"><h2>Add element</h2><button type="button" class="admin-btn admin-btn-ghost admin-btn-small" id="dbPaletteClose">Close</button></div>
        <div class="db-palette-grid">
          ${PALETTE.map((p) => `
            <button type="button" class="db-palette-item" data-type="${p.type}">
              <strong>${p.label}</strong>
              <span>${p.blurb}</span>
            </button>`).join('')}
        </div>
      </div>`;
    els.palette.querySelector('#dbPaletteClose')?.addEventListener('click', () => {
      els.palette.hidden = true;
    });
    els.palette.querySelectorAll('[data-type]').forEach((btn) => {
      btn.addEventListener('click', () => {
        addWidget(btn.dataset.type);
        els.palette.hidden = true;
      });
    });
    els.palette.addEventListener('click', (ev) => {
      if (ev.target === els.palette) els.palette.hidden = true;
    }, { once: true });
  }

  function addWidget(type) {
    const def = PALETTE.find((p) => p.type === type);
    if (!def || !state.draft) return;
    const widget = {
      id: uid(type),
      type,
      x: 0,
      y: nextFreeY(state.draft.widgets),
      w: def.defaults.w,
      h: def.defaults.h,
      config: { ...def.defaults.config },
    };
    state.draft.widgets.push(widget);
    state.selectedId = widget.id;
    state.dirty = true;
    renderAll();
    setStatus(`Added ${type} widget.`);
  }

  async function saveDraft() {
    setStatus('Saving draft…');
    const payload = await apiFetch()(`/api/admin/dashboards/${state.page}`, {
      method: 'PUT',
      body: JSON.stringify({ layout: state.draft }),
    });
    state.draft = payload.draft;
    state.published = payload.published;
    state.dirty = false;
    renderAll();
    setStatus('Draft saved.', 'ok');
  }

  async function publish() {
    if (state.dirty) await saveDraft();
    setStatus('Publishing…');
    const payload = await apiFetch()(`/api/admin/dashboards/${state.page}/publish`, {
      method: 'POST',
      body: '{}',
    });
    state.draft = payload.draft;
    state.published = payload.published;
    state.dirty = false;
    renderAll();
    setStatus('Published. Public Overview/Live will use this layout.', 'ok');
  }

  async function revert() {
    if (!confirm('Revert draft to the last published layout?')) return;
    setStatus('Reverting…');
    const payload = await apiFetch()(`/api/admin/dashboards/${state.page}/revert`, {
      method: 'POST',
      body: '{}',
    });
    state.draft = payload.draft;
    state.published = payload.published;
    state.dirty = false;
    state.selectedId = null;
    renderAll();
    setStatus('Draft reverted to published.', 'ok');
  }

  function togglePreview() {
    state.preview = !state.preview;
    els.previewBtn.classList.toggle('is-active', state.preview);
    renderCanvas();
    setStatus(state.preview ? 'Preview mode — drag/resize disabled.' : 'Edit mode.');
  }

  async function init() {
    els.meta = $('dbMeta');
    els.canvas = $('dbCanvas');
    els.props = $('dbProps');
    els.status = $('dbStatus');
    els.palette = $('dbPalette');
    els.previewBtn = $('dbPreview');
    els.revertBtn = $('dbRevert');

    document.querySelectorAll('[data-page-tab]').forEach((btn) => {
      btn.addEventListener('click', () => {
        if (state.dirty && !confirm('Discard unsaved changes?')) return;
        loadPage(btn.dataset.pageTab).catch((err) => setStatus(err.message, 'error'));
      });
    });
    $('dbAdd')?.addEventListener('click', openPalette);
    $('dbSave')?.addEventListener('click', () => saveDraft().catch((err) => setStatus(err.message, 'error')));
    $('dbPublish')?.addEventListener('click', () => publish().catch((err) => setStatus(err.message, 'error')));
    els.revertBtn?.addEventListener('click', () => revert().catch((err) => setStatus(err.message, 'error')));
    els.previewBtn?.addEventListener('click', togglePreview);

    await window.AdminCommon.mountShell({
      active: 'dashboards',
      title: 'Dashboards',
      kicker: 'Layout builder',
    });
    await loadPage('overview');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => init().catch((err) => setStatus(err.message, 'error')));
  } else {
    init().catch((err) => setStatus(err.message, 'error'));
  }
})();
