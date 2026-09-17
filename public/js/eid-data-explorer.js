window.EidDataExplorer = (function () {
  const CATEGORY_ORDER = ['results', 'candidates', 'geography', 'reference', 'catalogs'];

  const CATEGORY_LABELS = {
    results: 'Election results',
    candidates: 'Candidates',
    geography: 'Geography & boundaries',
    reference: 'Reference & registers',
    catalogs: 'Indexes & published layouts',
  };

  const CATEGORY_ICONS = {
    results: 'how_to_vote',
    candidates: 'person',
    geography: 'map',
    reference: 'menu_book',
    catalogs: 'list_alt',
  };

  function officeLabel(office, labels) {
    if (!office) return 'All offices';
    return (labels && labels[office]) || String(office).toUpperCase();
  }

  function filterDatasets(datasets, opts) {
    const q = String(opts.query || '').trim().toLowerCase();
    const office = opts.office && opts.office !== 'all' ? String(opts.office).toLowerCase() : '';
    const year = opts.year && opts.year !== 'all' ? String(opts.year) : '';
    const category = opts.category && opts.category !== 'all' ? String(opts.category) : '';
    const country = opts.country ? String(opts.country).toLowerCase() : '';

    return (datasets || []).filter((d) => {
      if (country && country !== 'global' && d.country && d.country !== 'global' && d.country !== country) {
        return false;
      }
      if (office && String(d.office || '').toLowerCase() !== office) return false;
      if (year && String(d.year || '') !== year) return false;
      if (category && String(d.category || '') !== category) return false;
      if (!q) return true;
      const hay = [d.name, d.coverage, d.source, d.office, d.year, d.state, d.category, d.type, d.fmt]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return hay.includes(q);
    });
  }

  function toRows(datasets, officeLabels) {
    return (datasets || []).map((d) => {
      const downloads = d.downloads || {};
      const jsonHref = downloads.json || d.href || null;
      const csvHref = downloads.csv || null;
      const zipHref = downloads.zip || null;
      const primaryHref = csvHref || jsonHref || zipHref || '#';
      const actions = [];
      if (jsonHref) {
        actions.push({
          label: 'JSON',
          href: jsonHref,
          icon: 'download',
        });
      }
      if (csvHref) {
        actions.push({
          label: 'CSV',
          href: csvHref,
          icon: 'table',
        });
      }
      if (zipHref && !jsonHref) {
        actions.push({
          label: 'ZIP',
          href: zipHref,
          icon: 'folder_zip',
        });
      }
      if (!actions.length && primaryHref !== '#') {
        actions.push({ label: 'Open', href: primaryHref, icon: 'open_in_new' });
      }
      return {
        id: d.id,
        name: d.name,
        type: d.type,
        fmt: d.fmt,
        icon: d.icon || 'database',
        coverage: d.coverage || '',
        source: d.source || '',
        updated: d.updated || '—',
        category: d.category,
        categoryLabel: CATEGORY_LABELS[d.category] || d.category || '',
        office: d.office,
        officeLabel: officeLabel(d.office, officeLabels),
        year: d.year,
        state: d.state || '',
        notes: d.notes || '',
        hasNotes: !!d.notes,
        href: primaryHref,
        action: actions[0]?.label || 'Download',
        actions,
        hasCsv: !!csvHref,
        hasJson: !!jsonHref,
        jsonHref: jsonHref || '',
        csvHref: csvHref || '',
        zipHref: zipHref || '',
      };
    });
  }

  /**
   * Group filtered dataset rows by category (stable CATEGORY_ORDER).
   * Empty categories are omitted. `collapsed` is a map of categoryId → true.
   */
  function groupByCategory(rows, opts) {
    const order = (opts && opts.order) || CATEGORY_ORDER;
    const collapsed = (opts && opts.collapsed) || {};
    const labels = (opts && opts.labels) || CATEGORY_LABELS;
    const icons = (opts && opts.icons) || CATEGORY_ICONS;
    const buckets = new Map();
    order.forEach((id) => buckets.set(id, []));
    const other = [];

    (rows || []).forEach((row) => {
      const cat = row.category;
      if (buckets.has(cat)) buckets.get(cat).push(row);
      else other.push(row);
    });

    const groups = [];
    order.forEach((id) => {
      const items = buckets.get(id) || [];
      if (!items.length) return;
      const isCollapsed = !!collapsed[id];
      groups.push({
        id,
        label: labels[id] || id,
        icon: icons[id] || 'folder',
        count: items.length,
        countLabel: String(items.length),
        open: !isCollapsed,
        showRows: !isCollapsed,
        chevron: isCollapsed ? 'expand_more' : 'expand_less',
        rows: items,
      });
    });

    if (other.length) {
      const id = 'other';
      const isCollapsed = !!collapsed[id];
      groups.push({
        id,
        label: 'Other',
        icon: 'folder',
        count: other.length,
        countLabel: String(other.length),
        open: !isCollapsed,
        showRows: !isCollapsed,
        chevron: isCollapsed ? 'expand_more' : 'expand_less',
        rows: other,
      });
    }

    return groups;
  }

  return {
    CATEGORY_ORDER,
    CATEGORY_LABELS,
    CATEGORY_ICONS,
    filterDatasets,
    toRows,
    groupByCategory,
    officeLabel,
  };
})();
