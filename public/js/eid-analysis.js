/**
 * Election Analysis charts — explain-the-result sections (Chart.js).
 */
(function (global) {
  const charts = {};
  let lastThemeKey = '';

  function themeColors(root) {
    const el = root || document.body;
    const g = (name, fallback) => {
      try {
        const val = getComputedStyle(el).getPropertyValue(name).trim();
        return val || fallback;
      } catch {
        return fallback;
      }
    };
    return {
      text: g('--text', '#161b22'),
      mute: g('--mute', '#8b939d'),
      dim: g('--dim', '#5a636e'),
      border: g('--border', '#e4e8ed'),
      grid: g('--grid', 'rgba(22,30,42,.08)'),
      surface: g('--surface', '#fff'),
      primary: g('--primary', '#1c8f86'),
      live: g('--live', '#cf3f36'),
      good: g('--good', '#2f9150'),
      up: g('--up', '#b57d1e'),
    };
  }

  function destroyAll() {
    Object.keys(charts).forEach((k) => {
      try { charts[k].destroy(); } catch (e) { /* ignore */ }
      delete charts[k];
    });
  }

  function baseOptions(t, { stacked = false, percent = false, beginAtZero = true, indexAxis } = {}) {
    const opts = {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'nearest', intersect: false },
      plugins: {
        legend: {
          position: 'bottom',
          labels: {
            color: t.dim,
            boxWidth: 10,
            boxHeight: 10,
            font: { family: "'IBM Plex Sans', sans-serif", size: 11 },
            usePointStyle: true,
            pointStyle: 'rectRounded',
          },
        },
        tooltip: {
          backgroundColor: t.surface,
          titleColor: t.text,
          bodyColor: t.dim,
          borderColor: t.border,
          borderWidth: 1,
          padding: 10,
          callbacks: percent
            ? { label: (ctx) => `${ctx.dataset.label}: ${Number(ctx.parsed[indexAxis === 'y' ? 'x' : 'y']).toFixed(1)}%` }
            : undefined,
        },
      },
      scales: {
        x: {
          stacked,
          ticks: { color: t.mute, font: { family: "'IBM Plex Sans', sans-serif", size: 10 } },
          grid: { color: indexAxis === 'y' ? t.grid : 'transparent' },
          border: { color: t.border },
        },
        y: {
          stacked,
          beginAtZero,
          ticks: {
            color: t.mute,
            font: { family: "'IBM Plex Sans', sans-serif", size: 10 },
            callback: percent && indexAxis !== 'y' ? (v) => `${v}%` : undefined,
          },
          grid: { color: t.grid },
          border: { color: t.border },
        },
      },
    };
    if (indexAxis) opts.indexAxis = indexAxis;
    return opts;
  }

  function upsertChart(key, canvas, config) {
    if (!canvas || !global.Chart) return null;
    if (charts[key]) {
      try { charts[key].destroy(); } catch (e) { /* ignore */ }
    }
    charts[key] = new global.Chart(canvas, config);
    return charts[key];
  }

  function emptyCanvas(canvas, t, msg) {
    if (!canvas) return;
    const parent = canvas.parentElement;
    if (parent) {
      let note = parent.querySelector('.eid-chart-empty');
      if (!note) {
        note = document.createElement('div');
        note.className = 'eid-chart-empty';
        note.style.cssText = 'position:absolute;inset:0;display:grid;place-items:center;padding:16px;text-align:center;font-size:12px;color:var(--mute);pointer-events:none';
        parent.style.position = parent.style.position || 'relative';
        parent.appendChild(note);
      }
      note.textContent = msg || 'No data for this filter';
      note.style.display = 'grid';
    }
    upsertChart(canvas.id || keyFallback(canvas), canvas, {
      type: 'bar',
      data: { labels: [], datasets: [] },
      options: { ...baseOptions(t), plugins: { legend: { display: false } } },
    });
  }

  function clearEmpty(canvas) {
    const parent = canvas && canvas.parentElement;
    const note = parent && parent.querySelector('.eid-chart-empty');
    if (note) note.style.display = 'none';
  }

  function keyFallback(canvas) {
    return canvas.id || `c${Math.random().toString(36).slice(2)}`;
  }

  function groupedShareBars(canvas, rows, t) {
    if (!canvas) return;
    const data = (rows || []).filter((r) => r.currentShare != null || r.seatShare != null).slice(0, 8);
    if (!data.length) {
      emptyCanvas(canvas, t, 'Vote / seat share not available for this office');
      return;
    }
    clearEmpty(canvas);
    const hasPrev = data.some((r) => r.previousShare != null);
    const datasets = [];
    if (data.some((r) => r.currentShare != null)) {
      datasets.push({
        label: 'Vote share %',
        data: data.map((r) => r.currentShare),
        backgroundColor: data.map((r) => r.color || t.primary),
        borderRadius: 4,
        maxBarThickness: 28,
      });
      if (hasPrev) {
        datasets.push({
          label: 'Previous %',
          data: data.map((r) => r.previousShare),
          backgroundColor: data.map((r) => (r.color || t.primary) + '66'),
          borderRadius: 4,
          maxBarThickness: 28,
        });
      }
    } else {
      datasets.push({
        label: 'Seat share %',
        data: data.map((r) => r.seatShare),
        backgroundColor: data.map((r) => r.color || t.primary),
        borderRadius: 4,
        maxBarThickness: 28,
      });
    }
    upsertChart(canvas.id, canvas, {
      type: 'bar',
      data: { labels: data.map((r) => r.party), datasets },
      options: baseOptions(t, { percent: true }),
    });
  }

  function deltaBars(canvas, rows, t) {
    if (!canvas) return;
    const data = (rows || []).filter((r) => r.deltaShare != null).slice(0, 8);
    if (!data.length) {
      emptyCanvas(canvas, t, 'Change vs previous cycle not computable');
      return;
    }
    clearEmpty(canvas);
    upsertChart(canvas.id, canvas, {
      type: 'bar',
      data: {
        labels: data.map((r) => r.party),
        datasets: [{
          label: 'Share change (pts)',
          data: data.map((r) => r.deltaShare),
          backgroundColor: data.map((r) => (r.deltaShare >= 0 ? t.good : t.live)),
          borderRadius: 4,
          maxBarThickness: 28,
        }],
      },
      options: baseOptions(t, { beginAtZero: false }),
    });
  }

  function scatterSeatVote(canvas, rows, t) {
    if (!canvas) return;
    const data = (rows || []).filter((r) => r.voteShare != null && r.seatShare != null);
    if (!data.length) {
      emptyCanvas(canvas, t, 'Seat share vs vote share needs both metrics');
      return;
    }
    clearEmpty(canvas);
    upsertChart(canvas.id, canvas, {
      type: 'scatter',
      data: {
        datasets: data.map((r) => ({
          label: r.party,
          data: [{ x: r.voteShare, y: r.seatShare }],
          backgroundColor: r.color || t.primary,
          pointRadius: 7,
          pointHoverRadius: 9,
        })),
      },
      options: {
        ...baseOptions(t, { percent: true }),
        plugins: {
          ...baseOptions(t).plugins,
          tooltip: {
            ...baseOptions(t).plugins.tooltip,
            callbacks: {
              label: (ctx) => `${ctx.dataset.label}: vote ${ctx.parsed.x}% · seats ${ctx.parsed.y}%`,
            },
          },
        },
        scales: {
          x: {
            title: { display: true, text: 'Vote share %', color: t.mute, font: { size: 11 } },
            ticks: { color: t.mute, callback: (v) => `${v}%` },
            grid: { color: t.grid },
            border: { color: t.border },
          },
          y: {
            title: { display: true, text: 'Seat / win share %', color: t.mute, font: { size: 11 } },
            ticks: { color: t.mute, callback: (v) => `${v}%` },
            grid: { color: t.grid },
            border: { color: t.border },
          },
        },
      },
    });
  }

  function regionBars(canvas, regions, t) {
    if (!canvas) return;
    const rows = (regions || []).slice();
    if (!rows.length) {
      emptyCanvas(canvas, t, 'No regional breakdown for this filter');
      return;
    }
    clearEmpty(canvas);
    const hasVoteShare = rows.some((r) => r.voteShare != null);
    const datasets = [
      {
        label: 'Wins',
        data: rows.map((r) => r.wins),
        backgroundColor: t.primary,
        borderRadius: 4,
        maxBarThickness: 26,
      },
    ];
    if (hasVoteShare) {
      datasets.push({
        label: 'Vote share %',
        data: rows.map((r) => r.voteShare),
        backgroundColor: t.up,
        borderRadius: 4,
        maxBarThickness: 26,
      });
    } else if (rows.some((r) => r.winShare != null)) {
      datasets.push({
        label: 'Win share %',
        data: rows.map((r) => r.winShare),
        backgroundColor: t.up,
        borderRadius: 4,
        maxBarThickness: 26,
      });
    }
    upsertChart(canvas.id, canvas, {
      type: 'bar',
      data: {
        labels: rows.map((r) => r.region.replace('North ', 'N. ').replace('South ', 'S. ')),
        datasets,
      },
      options: baseOptions(t),
    });
  }

  function marginHist(canvas, distribution, t) {
    if (!canvas) return;
    const vals = (distribution || []).filter((v) => v != null);
    if (!vals.length) {
      emptyCanvas(canvas, t, 'Margin distribution unavailable');
      return;
    }
    clearEmpty(canvas);
    const bins = [
      { label: '<1%', min: 0, max: 1 },
      { label: '1–5%', min: 1, max: 5 },
      { label: '5–10%', min: 5, max: 10 },
      { label: '10–20%', min: 10, max: 20 },
      { label: '≥20%', min: 20, max: 101 },
    ];
    const counts = bins.map((b) => vals.filter((v) => v >= b.min && v < b.max).length);
    upsertChart(canvas.id, canvas, {
      type: 'bar',
      data: {
        labels: bins.map((b) => b.label),
        datasets: [{
          label: 'Units',
          data: counts,
          backgroundColor: [t.live, t.up, t.primary, t.dim, t.good],
          borderRadius: 4,
          maxBarThickness: 36,
        }],
      },
      options: {
        ...baseOptions(t),
        plugins: { ...baseOptions(t).plugins, legend: { display: false } },
      },
    });
  }

  function turnoutScatter(canvas, points, t) {
    if (!canvas) return;
    const rows = (points || []).filter((p) => p.swing != null && (p.change != null || p.turnoutPct != null));
    if (!rows.length) {
      emptyCanvas(canvas, t, 'Turnout vs swing needs unit turnout proxies for this office/year');
      return;
    }
    clearEmpty(canvas);
    const useChange = rows.some((p) => p.change != null);
    upsertChart(canvas.id, canvas, {
      type: 'scatter',
      data: {
        datasets: [{
          label: useChange ? 'Turnout Δ vs party swing' : 'Turnout vs party share',
          data: rows.map((p) => ({
            x: useChange ? p.change : p.turnoutPct,
            y: p.swing != null ? p.swing : p.focusShare,
            label: p.state,
          })),
          backgroundColor: t.primary,
          pointRadius: 5,
        }],
      },
      options: {
        ...baseOptions(t),
        plugins: {
          ...baseOptions(t).plugins,
          legend: { display: false },
          tooltip: {
            ...baseOptions(t).plugins.tooltip,
            callbacks: {
              label: (ctx) => {
                const p = ctx.raw;
                return `${p.label}: x=${p.x}, y=${p.y}`;
              },
            },
          },
        },
        scales: {
          x: {
            title: { display: true, text: useChange ? 'Turnout change (pts)' : 'Turnout %', color: t.mute },
            ticks: { color: t.mute },
            grid: { color: t.grid },
            border: { color: t.border },
          },
          y: {
            title: { display: true, text: 'Party swing / share (pts)', color: t.mute },
            ticks: { color: t.mute },
            grid: { color: t.grid },
            border: { color: t.border },
          },
        },
      },
    });
  }

  function historyLines(canvas, trend, years, t, { percent = true } = {}) {
    if (!canvas) return;
    const series = (trend || []).filter((p) => (p.values || []).some((v) => v > 0));
    if (!series.length || !(years || []).length) {
      emptyCanvas(canvas, t, 'Historical series not available');
      return;
    }
    clearEmpty(canvas);
    upsertChart(canvas.id, canvas, {
      type: 'line',
      data: {
        labels: years,
        datasets: series.map((p) => ({
          label: p.party,
          data: p.values,
          borderColor: p.color,
          backgroundColor: p.color,
          tension: 0.28,
          pointRadius: 3,
          borderWidth: 2,
          fill: false,
        })),
      },
      options: baseOptions(t, { percent }),
    });
  }

  function swingBars(canvas, units, focusParty, t) {
    if (!canvas) return;
    const rows = (units || [])
      .filter((u) => u.swings?.[focusParty] != null || u.swingWinnerPts != null)
      .map((u) => ({
        label: u.state || u.district,
        swing: u.swings?.[focusParty] != null ? u.swings[focusParty] : u.swingWinnerPts,
        flipped: u.flipped,
      }))
      .sort((a, b) => b.swing - a.swing)
      .slice(0, 16);
    if (!rows.length) {
      emptyCanvas(canvas, t, 'Geographic swing needs comparable prior-cycle vote shares');
      return;
    }
    clearEmpty(canvas);
    upsertChart(canvas.id, canvas, {
      type: 'bar',
      data: {
        labels: rows.map((r) => r.label),
        datasets: [{
          label: `${focusParty} swing (pts)`,
          data: rows.map((r) => r.swing),
          backgroundColor: rows.map((r) => (r.flipped ? t.live : (r.swing >= 0 ? t.good : t.up))),
          borderRadius: 3,
          maxBarThickness: 18,
        }],
      },
      options: {
        ...baseOptions(t, { indexAxis: 'y', beginAtZero: false }),
        plugins: { ...baseOptions(t).plugins, legend: { display: false } },
      },
    });
  }

  function outlookBars(canvas, parties, t) {
    if (!canvas) return;
    const rows = (parties || []).slice(0, 6);
    if (!rows.length) {
      emptyCanvas(canvas, t, 'Outlook scenario unavailable');
      return;
    }
    clearEmpty(canvas);
    upsertChart(canvas.id, canvas, {
      type: 'bar',
      data: {
        labels: rows.map((r) => r.party),
        datasets: [
          {
            label: 'Pres. state share (est.)',
            data: rows.map((r) => r.estimatedPresStateShare),
            backgroundColor: rows.map((r) => r.color),
            borderRadius: 4,
            maxBarThickness: 28,
          },
          {
            label: 'Senate seat share (est.)',
            data: rows.map((r) => r.estimatedSenShare),
            backgroundColor: rows.map((r) => (r.color || t.primary) + '99'),
            borderRadius: 4,
            maxBarThickness: 28,
          },
        ],
      },
      options: baseOptions(t, { percent: true }),
    });
  }

  function turnoutByUnitBars(canvas, points, t) {
    if (!canvas) return;
    const rows = (points || [])
      .filter((p) => p.turnoutPct != null)
      .slice()
      .sort((a, b) => b.turnoutPct - a.turnoutPct)
      .slice(0, 18);
    if (!rows.length) {
      emptyCanvas(canvas, t, 'Unit turnout proxies unavailable for this office/year');
      return;
    }
    clearEmpty(canvas);
    upsertChart(canvas.id, canvas, {
      type: 'bar',
      data: {
        labels: rows.map((r) => r.state),
        datasets: [{
          label: 'Turnout %',
          data: rows.map((r) => r.turnoutPct),
          backgroundColor: rows.map((r, i) => (i < 3 || i >= rows.length - 3 ? t.up : t.primary)),
          borderRadius: 3,
          maxBarThickness: 16,
        }],
      },
      options: {
        ...baseOptions(t, { indexAxis: 'y', percent: true }),
        plugins: { ...baseOptions(t).plugins, legend: { display: false } },
      },
    });
  }

  /**
   * @param {HTMLElement} root
   * @param {object} bundle
   */
  function render(root, bundle) {
    if (!root || !bundle || !bundle.ok || !global.Chart) return;
    const t = themeColors(root);
    lastThemeKey = `${t.text}|${t.primary}|${t.border}`;
    global.EID_PARTY_COLORS = bundle.partyColors || global.EID_PARTY_COLORS || {};

    const perf = bundle.performance || {};
    const geo = bundle.geographic || {};
    const turnout = bundle.turnout || {};
    const comp = bundle.competitiveness || {};
    const history = bundle.history || {};

    groupedShareBars(root.querySelector('#anaChartPerfShare'), perf.voteShare, t);
    deltaBars(root.querySelector('#anaChartPerfDelta'), perf.voteShare, t);
    scatterSeatVote(root.querySelector('#anaChartSeatVote'), perf.seatVsVote, t);
    regionBars(root.querySelector('#anaChartRegions'), geo.regions, t);
    swingBars(root.querySelector('#anaChartSwing'), geo.units, geo.focusParty || perf.focusParty, t);
    marginHist(root.querySelector('#anaChartMargins'), comp.distribution, t);
    turnoutScatter(root.querySelector('#anaChartTurnoutSwing'), turnout.byUnit, t);
    turnoutByUnitBars(root.querySelector('#anaChartTurnoutByUnit'), turnout.byUnit, t);

    historyLines(root.querySelector('#anaChartHistory'), history.voteShareTrend, history.years, t, { percent: true });
    historyLines(root.querySelector('#anaChartSeatHistory'), history.seatShareTrend, history.years, t, { percent: true });

    const turnoutYears = (history.turnoutTrend || []).map((r) => r.year);
    const turnoutVals = (history.turnoutTrend || []).map((r) => r.turnoutPct);
    const turnoutCanvases = [
      root.querySelector('#anaChartTurnoutTrend'),
      root.querySelector('#anaChartTrendTurnout'),
    ].filter(Boolean);
    turnoutCanvases.forEach((turnoutCanvas) => {
      if (turnoutVals.some((v) => v != null)) {
        clearEmpty(turnoutCanvas);
        upsertChart(turnoutCanvas.id, turnoutCanvas, {
          type: 'line',
          data: {
            labels: turnoutYears,
            datasets: [{
              label: 'National turnout %',
              data: turnoutVals,
              borderColor: t.primary,
              backgroundColor: t.primary,
              tension: 0.3,
              pointRadius: 4,
              borderWidth: 2,
            }],
          },
          options: baseOptions(t, { percent: true }),
        });
      } else {
        emptyCanvas(turnoutCanvas, t, 'National turnout series not available for this office');
      }
    });

    outlookBars(root.querySelector('#anaChartOutlook'), bundle.prediction?.partyMomentum, t);
  }

  function resizeAll() {
    Object.keys(charts).forEach((k) => {
      try {
        if (charts[k] && typeof charts[k].resize === 'function') charts[k].resize();
      } catch (e) { /* ignore */ }
    });
  }

  global.EIDAnalysis = { render, destroyAll, resizeAll };
})(typeof window !== 'undefined' ? window : globalThis);
