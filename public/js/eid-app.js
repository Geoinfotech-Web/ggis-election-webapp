(function () {
  const D = window.EID_DATA;
  const THEME_KEY = "electionDashboardTheme";
  const app = document.getElementById("app");

  const TILES = {
    dark: "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png",
    light: "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png",
    satellite: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    terrain: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Shaded_Relief/MapServer/tile/{z}/{y}/{x}",
    streets: "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
  };

  const state = {
    theme: localStorage.getItem(THEME_KEY) === "light" ? "light" : "dark",
    view: "welcome",
    scope: "global",
    section: "Overview",
    switcherOpen: false,
    countryQuery: "",
    statuses: { live: true, upcoming: true, recent: true, nodata: false },
    layers: { boundaries: true, results: true, turnout: false, live: true },
    basemap: "dark",
    ngState: "",
    ngLga: "",
    ngWard: "",
    ngPU: "",
    ovElec: 0,
    mapSel: null,
    elecType: "All",
    candYear: "2023",
    candOffice: "pres",
    selParty: null,
    subState: "",
    subLga: "",
    subWard: "",
    subPU: "",
    subFile: "",
    locating: false,
    submissions: [],
    nearLabel: "",
  };

  let mapInstance = null;
  let tileLayer = null;

  function esc(value) {
    return String(value ?? "").replace(/[&<>"']/g, (ch) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    })[ch]);
  }

  function applyTheme() {
    document.documentElement.dataset.theme = state.theme;
    document.body.dataset.theme = state.theme;
    localStorage.setItem(THEME_KEY, state.theme);
  }

  function parseHash() {
    const raw = (location.hash || "#/welcome").replace(/^#/, "");
    const parts = raw.split("/").filter(Boolean);
    if (!parts.length || parts[0] === "welcome") {
      state.view = "welcome";
      return;
    }
    state.view = "app";
    if (parts[0] === "c" && parts[1]) {
      state.scope = parts[1];
      state.section = decodeURIComponent(parts[2] || "Overview").replace(/-/g, " ");
      const known = D.NAV.find((n) => n.toLowerCase() === state.section.toLowerCase());
      state.section = known || (state.section === "map" ? "Map" : "Overview");
      return;
    }
    if (parts[0] === "overview") {
      state.scope = "global";
      state.section = "Overview";
      return;
    }
    state.scope = "global";
    const section = decodeURIComponent(parts[0] || "Overview").replace(/-/g, " ");
    const known = D.NAV.find((n) => n.toLowerCase() === section.toLowerCase());
    state.section = known || (section.toLowerCase() === "map" ? "Map" : "Overview");
  }

  function hrefFor(scope, section) {
    const slug = encodeURIComponent(section);
    if (scope === "global") {
      return section === "Overview" ? "#/overview" : `#/${slug}`;
    }
    return `#/c/${scope}/${slug}`;
  }

  function navigate(scope, section) {
    state.scope = scope;
    state.section = section;
    state.view = "app";
    state.switcherOpen = false;
    location.hash = hrefFor(scope, section).slice(1);
    render();
  }

  function country() {
    return state.scope === "global" ? null : D.COUNTRIES[state.scope];
  }

  function scopeLabel() {
    return state.scope === "global" ? "Global" : (country()?.name || "Global");
  }

  function destroyMap() {
    if (mapInstance) {
      mapInstance.remove();
      mapInstance = null;
      tileLayer = null;
    }
  }

  function mountMap(targetId, options) {
    const el = document.getElementById(targetId);
    if (!el || typeof L === "undefined") return;
    destroyMap();
    const center = options.center || [20, 10];
    const zoom = options.zoom || 2;
    mapInstance = L.map(el, { zoomControl: false, attributionControl: true }).setView(center, zoom);
    const url = TILES[state.basemap] || TILES.dark;
    tileLayer = L.tileLayer(url, { maxZoom: 19, attribution: "&copy; OpenStreetMap &copy; CARTO / Esri" }).addTo(mapInstance);
    (options.markers || []).forEach((m) => {
      const marker = L.circleMarker([m.lat, m.lng], {
        radius: 7,
        color: "#12161d",
        weight: 2,
        fillColor: m.live ? "#e0564f" : "#3db3aa",
        fillOpacity: 1,
      }).addTo(mapInstance);
      marker.bindTooltip(m.name);
      marker.on("click", () => navigate(m.code, "Overview"));
    });
    requestAnimationFrame(() => mapInstance && mapInstance.invalidateSize());
  }

  function icon(name, size) {
    return `<span class="msi" style="font-size:${size || 18}px">${name}</span>`;
  }

  function renderWelcome() {
    const q = state.countryQuery.trim().toLowerCase();
    const cards = D.ORDER.map((code) => D.COUNTRIES[code]).filter((c) => {
      if (!q) return true;
      return `${c.name} ${c.region}`.toLowerCase().includes(q);
    });

    return `
      <div class="eid-welcome">
        <div class="eid-welcome-top">
          <div class="eid-brand-mark">${icon("public", 20)}</div>
          <span style="font-weight:600;font-size:13.5px;letter-spacing:-.01em">Election Intelligence Dashboard</span>
          <button class="eid-btn eid-btn-icon" data-action="theme" title="Toggle theme" style="margin-left:auto">${icon(state.theme === "dark" ? "light_mode" : "dark_mode", 18)}</button>
        </div>
        <div class="eid-welcome-body eid-scroll">
          <div class="eid-welcome-hero">
            <div class="eid-chip"><span class="eid-dot"></span>54 countries · 312 elections · 2 live now</div>
            <h1>Explore elections through<br>data, geography and time</h1>
            <p>Select a country to open its election intelligence, or open the global dashboard to explore every tracked election on the map.</p>
            <div class="eid-cta-row">
              <button class="eid-btn eid-btn-primary" data-action="open-global">${icon("travel_explore", 19)}Open global dashboard</button>
              <div class="eid-search">
                ${icon("search", 19)}
                <input id="countrySearch" placeholder="Search a country or election…" value="${esc(state.countryQuery)}">
              </div>
            </div>
          </div>
          <div class="eid-section-label"><span>Select a country</span><span></span></div>
          <div class="eid-country-grid">
            ${cards.map((c) => {
              const st = D.STATUS[c.status];
              return `<button class="eid-country-card" data-action="open-country" data-code="${c.code}" style="border-color:var(--border)" onmouseenter="this.style.borderColor='${c.flag}'" onmouseleave="this.style.borderColor='var(--border)'">
                <div style="display:flex;align-items:center;gap:12px">
                  <img class="eid-flag" src="${D.flagSrc(c.code)}" alt="${esc(c.name)} flag" width="52" height="35">
                  <div style="min-width:0;line-height:1.2">
                    <div class="name">${esc(c.name)}</div>
                    <div class="region">${esc(c.region)}</div>
                  </div>
                </div>
                <div class="meta"><span style="display:inline-flex;align-items:center;gap:6px"><span style="width:7px;height:7px;border-radius:50%;background:${st.color}"></span>${st.label}</span><span class="elections">${c.elections} elections</span></div>
                <div class="accent" style="background:${c.flag}"></div>
              </button>`;
            }).join("")}
          </div>
        </div>
      </div>`;
  }

  function renderHeader() {
    const c = country();
    const isGlobal = !c;
    const items = [{ name: "Global", global: true, code: "global", active: isGlobal }].concat(
      D.ORDER.map((code) => ({ name: D.COUNTRIES[code].name, code, global: false, active: state.scope === code }))
    );
    return `
      <header class="eid-header">
        <button class="eid-btn" data-action="home" title="Home" style="display:flex;align-items:center;gap:9px;border:none;background:transparent;padding:0;color:inherit">
          <div class="eid-brand-mark">${icon("public", 20)}</div>
        </button>
        <div style="position:relative;flex:none">
          <button class="eid-scope" data-action="toggle-switcher" title="Switch scope">
            ${isGlobal ? icon("public", 18) : `<img class="eid-flag" src="${D.flagSrc(c.code)}" alt="" width="22" height="15">`}
            <span class="eid-scope-meta"><small>Scope</small><strong>${isGlobal ? "Global" : esc(c.name)}</strong></span>
            ${icon("unfold_more", 18)}
          </button>
          ${state.switcherOpen ? `
            <div>
              <div data-action="close-switcher" style="position:fixed;inset:0;z-index:30"></div>
              <div class="eid-switcher eid-scroll">
                ${items.map((it) => `
                  <button class="${it.active ? "is-active" : ""}" data-action="set-scope" data-code="${it.code}">
                    ${it.global ? icon("public", 19) : `<img class="eid-flag" src="${D.flagSrc(it.code)}" alt="" width="22" height="15">`}
                    <span>${esc(it.name)}</span>
                    ${it.active ? `<span class="msi" style="margin-left:auto;font-size:17px;color:var(--primary)">check</span>` : ""}
                  </button>`).join("")}
              </div>
            </div>` : ""}
        </div>
        <nav class="eid-nav" aria-label="Primary">
          ${D.NAV.map((label) => {
            const live = label === "Live Results";
            const active = state.section === label;
            return `<a href="${hrefFor(state.scope, label)}" class="${active ? "is-active" : ""}" data-nav="${esc(label)}">${esc(label)}${live ? `<span class="eid-live-badge">LIVE</span>` : ""}</a>`;
          }).join("")}
        </nav>
        <div style="flex:none;display:flex;align-items:center;gap:8px">
          <a class="eid-btn eid-btn-ghost eid-btn-danger" href="/admin/index.html" title="Admin console">${icon("admin_panel_settings", 17)}Admin</a>
          <button class="eid-btn eid-btn-icon" data-action="theme" title="Toggle theme">${icon(state.theme === "dark" ? "light_mode" : "dark_mode", 19)}</button>
          <div class="eid-avatar">GI</div>
        </div>
      </header>`;
  }

  function kpisHtml(items) {
    return `<div class="eid-kpis">${items.map((k) => `
      <div class="eid-kpi">
        <div class="label">${icon(k.icon, 16)}${esc(k.label)}</div>
        <div><span class="value">${esc(k.value)}</span><span class="unit">${esc(k.unit || "")}</span></div>
        ${k.delta ? `<div class="delta" style="color:${k.deltaColor || "var(--dim)"}">${icon(k.deltaIcon || "trending_up", 14)}${esc(k.delta)}</div>` : ""}
      </div>`).join("")}</div>`;
  }

  function renderGlobalOverview() {
    const statuses = [
      { k: "live", label: "Live now", color: "var(--live)", count: "2" },
      { k: "upcoming", label: "Upcoming", color: "var(--up)", count: "37" },
      { k: "recent", label: "Recent result", color: "var(--primary)", count: "128" },
      { k: "nodata", label: "No data", color: "var(--mute)", count: "—" },
    ];
    const layers = [
      { k: "boundaries", label: "Boundaries", dot: "var(--dim)" },
      { k: "results", label: "Results", dot: "var(--primary)" },
      { k: "turnout", label: "Turnout", dot: "var(--up)" },
      { k: "live", label: "Live feed", dot: "var(--live)" },
    ];
    const kpis = [
      { icon: "public", label: "Countries", value: "54", unit: "", delta: "+3 this quarter", deltaIcon: "trending_up", deltaColor: "var(--good)" },
      { icon: "how_to_vote", label: "Elections", value: "312", unit: "", delta: "128 with results", deltaIcon: "check_circle", deltaColor: "var(--dim)" },
      { icon: "sensors", label: "Live now", value: "2", unit: "", delta: "Real-time reporting", deltaIcon: "bolt", deltaColor: "var(--live)" },
      { icon: "groups", label: "Registered", value: "1.24", unit: "bn", delta: "across regions", deltaIcon: "database", deltaColor: "var(--dim)" },
    ];
    return `
      <div class="eid-overview">
        <aside class="eid-panel eid-scroll">
          <div style="display:flex;align-items:center;gap:8px">
            ${icon("tune", 18)}
            <h2 style="margin:0;font-size:13px;font-weight:600">Filters</h2>
            <button class="eid-btn" data-action="reset-filters" style="margin-left:auto;border:none;background:transparent;color:var(--mute);font-size:11.5px;padding:0">Reset</button>
          </div>
          ${["Region", "Country", "Election type"].map((label, i) => {
            const opts = [
              ["All regions", "Africa", "Americas", "Europe", "Asia", "Oceania"],
              ["All countries", ...D.ORDER.map((c) => D.COUNTRIES[c].name)],
              ["All types", "Presidential", "Parliamentary", "Governorship", "Local / Regional", "Referendum"],
            ][i];
            return `<label style="display:flex;flex-direction:column;gap:6px">
              <span style="font-size:10px;letter-spacing:.09em;text-transform:uppercase;color:var(--mute)">${label}</span>
              <div style="position:relative">
                <select class="eid-select">${opts.map((o) => `<option>${esc(o)}</option>`).join("")}</select>
                <span class="msi" style="position:absolute;right:9px;top:9px;color:var(--mute);font-size:18px;pointer-events:none">expand_more</span>
              </div>
            </label>`;
          }).join("")}
          <div style="display:flex;flex-direction:column;gap:8px">
            <span style="font-size:10px;letter-spacing:.09em;text-transform:uppercase;color:var(--mute)">Election status</span>
            ${statuses.map((st) => {
              const on = state.statuses[st.k];
              return `<button class="eid-status-btn ${on ? "is-on" : "is-off"}" data-action="toggle-status" data-key="${st.k}">
                <span style="width:10px;height:10px;border-radius:50%;background:${st.color}"></span>
                <span>${st.label}</span>
                <span style="margin-left:auto;font-size:11px;color:var(--mute)">${st.count}</span>
                ${icon(on ? "check_box" : "check_box_outline_blank", 16)}
              </button>`;
            }).join("")}
          </div>
          <div style="margin-top:auto;padding-top:12px;border-top:1px solid var(--border);display:flex;align-items:center;gap:8px;font-size:11px;color:var(--mute)"><span style="width:7px;height:7px;border-radius:50%;background:var(--good)"></span>54 countries · 312 elections</div>
        </aside>
        <main style="min-height:0;display:grid;grid-template-rows:auto minmax(0,1fr);gap:12px;overflow:hidden">
          ${kpisHtml(kpis)}
          <section class="eid-map-card">
            <div class="eid-map-toolbar">
              <div style="display:flex;align-items:center;gap:8px">${icon("travel_explore", 18)}<h2>Global Election Map</h2></div>
              <div class="eid-seg">
                <button class="${state.basemap === "dark" || state.basemap === "light" ? "is-active" : ""}" data-action="basemap" data-map="${state.theme === "light" ? "light" : "dark"}">${icon("dark_mode", 15)}${state.theme === "light" ? "Light" : "Dark"}</button>
                <button class="${state.basemap === "satellite" ? "is-active" : ""}" data-action="basemap" data-map="satellite">Satellite</button>
              </div>
            </div>
            <div style="flex:none;display:flex;align-items:center;gap:8px;padding:8px 16px;border-bottom:1px solid var(--border);background:var(--surface2);flex-wrap:wrap">
              <span style="font-size:10px;letter-spacing:.1em;text-transform:uppercase;color:var(--mute)">Vector layers</span>
              ${layers.map((l) => `<button class="eid-chip-btn ${state.layers[l.k] ? "is-on" : ""}" data-action="toggle-layer" data-key="${l.k}"><span style="width:8px;height:8px;border-radius:2px;background:${l.dot}"></span>${l.label}</button>`).join("")}
              <span style="margin-left:auto;font-size:10px;color:var(--mute)">EPSG:4326 · Leaflet</span>
            </div>
            <div class="eid-map-canvas" id="eidMap"></div>
          </section>
        </main>
        <aside class="eid-scroll" style="min-height:0;overflow-y:auto;display:flex;flex-direction:column;gap:12px">
          <section class="eid-card">
            <div style="display:flex;align-items:center;gap:8px;padding:12px 14px;border-bottom:1px solid var(--border)"><span style="width:8px;height:8px;border-radius:50%;background:var(--live);animation:eidblink 1.6s infinite"></span><h2 style="margin:0;font-size:13px;font-weight:600">Live elections</h2></div>
            <div style="padding:8px 9px;display:flex;flex-direction:column;gap:8px">
              ${D.LIVE.map((e) => `
                <a class="eid-feed-item" href="${hrefFor("ng", "Live Results")}">
                  <div style="display:flex;align-items:center;gap:7px;margin-bottom:9px"><span style="font-size:9.5px;font-weight:600;color:var(--dim);border:1px solid var(--border);border-radius:5px;padding:2px 5px">${e.code}</span><span style="font-size:12.5px;font-weight:500">${esc(e.name)}</span><span class="eid-live-badge" style="margin-left:auto">LIVE</span></div>
                  <div style="display:flex;justify-content:space-between;font-size:10.5px;color:var(--mute);margin-bottom:5px"><span>Reporting ${e.reporting}</span><span>${e.updated}</span></div>
                  <div class="eid-bar" style="margin-bottom:11px"><span style="width:${e.width}%;background:var(--live)"></span></div>
                  ${e.cands.map((c) => `<div style="display:flex;align-items:center;gap:8px;margin-bottom:6px"><span style="width:8px;height:8px;border-radius:2px;background:${c.color}"></span><span style="font-size:12px">${esc(c.name)}</span><span style="font-size:10.5px;color:var(--mute)">${esc(c.party)}</span><span style="margin-left:auto;font-size:12.5px;font-weight:600">${c.pct}</span></div>`).join("")}
                </a>`).join("")}
            </div>
          </section>
          <section class="eid-card">
            <div style="display:flex;align-items:center;gap:8px;padding:12px 14px;border-bottom:1px solid var(--border)">${icon("event_upcoming", 16)}<h2 style="margin:0;font-size:13px;font-weight:600">Upcoming</h2></div>
            <div style="padding:5px 7px">
              ${D.UPCOMING.map((u) => `<a class="eid-upcoming" href="${hrefFor("global", "Elections")}"><div class="eid-cal"><div class="d">${u.day}</div><div class="m">${u.mon}</div></div><div style="min-width:0"><div style="font-size:12.5px;font-weight:500">${esc(u.name)}</div><div style="font-size:11px;color:var(--mute)">${esc(u.country)} · ${esc(u.type)}</div></div><span style="margin-left:auto;font-size:10.5px;color:var(--dim)">${u.left}</span></a>`).join("")}
            </div>
          </section>
          <section class="eid-card">
            <div style="display:flex;align-items:center;gap:8px;padding:12px 14px;border-bottom:1px solid var(--border)">${icon("history", 16)}<h2 style="margin:0;font-size:13px;font-weight:600">Recent results</h2></div>
            <div style="padding:5px 7px">
              ${D.RECENT.map((r) => `<a class="eid-upcoming" href="${hrefFor("global", "Elections")}" style="display:block"><div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;width:100%"><span style="font-size:9.5px;font-weight:600;color:var(--dim);border:1px solid var(--border);border-radius:5px;padding:1px 5px">${r.code}</span><span style="font-size:12px;font-weight:500">${esc(r.name)}</span><span style="margin-left:auto;font-size:10.5px;color:var(--mute)">${r.date}</span></div><div style="display:flex;align-items:center;gap:8px;width:100%"><span style="width:8px;height:8px;border-radius:2px;background:${r.color}"></span><span style="font-size:11.5px">${esc(r.winner)}</span><span style="font-size:10.5px;color:var(--mute)">${esc(r.party)}</span><span style="margin-left:auto;font-size:11px;color:var(--dim)">${r.turnout}</span></div></a>`).join("")}
            </div>
          </section>
        </aside>
      </div>`;
  }

  function ngSelects() {
    const states = Object.keys(D.NG_STATES);
    const lgas = state.ngState ? Object.keys(D.NG_STATES[state.ngState].lgas) : [];
    const wards = state.ngState && state.ngLga ? D.NG_STATES[state.ngState].lgas[state.ngLga] : [];
    const pus = state.ngWard ? [`${state.ngWard} PU 001`, `${state.ngWard} PU 002`, `${state.ngWard} PU 003`] : [];
    const sel = `class="eid-select"`;
    return `
      <section style="border:1px solid var(--border2);border-radius:11px;overflow:hidden;background:var(--surface2)">
        <div style="display:flex;align-items:center;gap:7px;padding:10px 11px;border-bottom:1px solid var(--border)">${icon("where_to_vote", 16)}<div style="font-size:12px;font-weight:600">Find your polling unit</div></div>
        <div style="padding:11px;display:flex;flex-direction:column;gap:11px">
          <div><div style="font-size:9.5px;letter-spacing:.06em;text-transform:uppercase;color:var(--mute);margin-bottom:6px">Step 1 · State</div>
            <select ${sel} data-action="ng-state"><option value="">Select a state…</option>${states.map((s) => `<option ${s === state.ngState ? "selected" : ""}>${esc(s)}</option>`).join("")}</select></div>
          ${state.ngState ? `<div><div style="font-size:9.5px;letter-spacing:.06em;text-transform:uppercase;color:var(--mute);margin-bottom:6px">Step 2 · LGA</div>
            <select ${sel} data-action="ng-lga"><option value="">Select an LGA…</option>${lgas.map((s) => `<option ${s === state.ngLga ? "selected" : ""}>${esc(s)}</option>`).join("")}</select></div>` : ""}
          ${state.ngLga ? `<div><div style="font-size:9.5px;letter-spacing:.06em;text-transform:uppercase;color:var(--mute);margin-bottom:6px">Step 3 · Ward</div>
            <select ${sel} data-action="ng-ward"><option value="">Select a ward…</option>${wards.map((s) => `<option ${s === state.ngWard ? "selected" : ""}>${esc(s)}</option>`).join("")}</select></div>` : ""}
          ${state.ngWard ? `<div><div style="font-size:9.5px;letter-spacing:.06em;text-transform:uppercase;color:var(--mute);margin-bottom:6px">Step 4 · Polling unit</div>
            <select ${sel} data-action="ng-pu"><option value="">Select a polling unit…</option>${pus.map((s) => `<option ${s === state.ngPU ? "selected" : ""}>${esc(s)}</option>`).join("")}</select></div>` : ""}
        </div>
      </section>
      <section style="border:1px solid var(--border2);border-radius:11px;overflow:hidden;background:var(--surface2)">
        <div style="display:flex;align-items:center;gap:7px;padding:10px 11px;border-bottom:1px solid var(--border)">${icon("near_me", 16)}<div style="font-size:12px;font-weight:600">Closest to me</div></div>
        <div style="padding:11px">
          <button class="eid-btn eid-btn-ghost" data-action="locate" style="width:100%;height:36px;border-color:var(--primary);background:var(--primary-soft);color:var(--primary)">${icon("my_location", 16)}${state.nearLabel ? "Update my location" : "Use my location"}</button>
          ${state.nearLabel ? `<div style="margin-top:10px;font-size:12px;color:var(--dim)">${esc(state.nearLabel)}</div>` : ""}
        </div>
      </section>`;
  }

  function renderCountryOverview() {
    const c = country();
    if (!c) return renderGlobalOverview();
    const isNg = c.code === "ng";
    const years = c.timeline;
    const elec = years[state.ovElec] || years[0];
    const pres = isNg ? D.NG_PRES["2023"] : c.parties.map((p, i) => [p.name, p.name, p.w, i === 0]);
    return `
      <div style="height:100%;display:flex;flex-direction:column;overflow:hidden">
        <div class="eid-country-head">
          <img class="eid-flag" src="${D.flagSrc(c.code)}" alt="" width="60" height="40">
          <div style="flex:1;min-width:0">
            <div style="display:flex;align-items:center;gap:9px;margin-bottom:4px"><span class="eid-kicker" style="letter-spacing:.12em">Country overview</span><span style="width:4px;height:4px;border-radius:50%;background:var(--mute)"></span><span style="font-size:11.5px;color:var(--mute)">${esc(c.region)}</span></div>
            <h1>${esc(c.name)}</h1>
          </div>
          <div style="display:flex;align-items:center;gap:9px;flex-wrap:wrap">
            ${isNg ? `<button class="eid-btn eid-btn-ghost" data-action="locate" style="height:32px">${icon("my_location", 16)}Find closest polling unit</button>` : ""}
            <span style="display:inline-flex;align-items:center;gap:8px;height:32px;padding:0 12px;border:1px solid var(--border);border-radius:8px;font-size:12px;color:var(--dim)">${icon("event_upcoming", 15)}<span style="color:var(--mute)">Next:</span><strong style="color:var(--text)">${esc(c.next.countdown)}</strong><span style="color:var(--mute)">· ${esc(c.next.date)}</span></span>
            <span style="display:inline-flex;align-items:center;gap:7px;height:32px;padding:0 12px;border:1px solid var(--border);border-radius:8px;font-size:12px">${`<span style="width:7px;height:7px;border-radius:50%;background:${D.STATUS[c.status].color}"></span>`}${D.STATUS[c.status].label}</span>
          </div>
        </div>
        <div style="flex:none;padding:12px 12px 0">${kpisHtml(c.kpis)}</div>
        <div class="eid-country-work eid-scroll">
          <aside class="eid-panel" style="overflow:visible">
            ${isNg ? ngSelects() : ""}
            <div style="display:flex;flex-direction:column;gap:8px">
              <div style="font-size:10px;letter-spacing:.1em;text-transform:uppercase;color:var(--mute)">Election history</div>
              <select class="eid-select" data-action="ov-elec">${years.map((t, i) => `<option value="${i}" ${i === state.ovElec ? "selected" : ""}>${esc(t.year)} · ${esc(t.name)}</option>`).join("")}</select>
              <div style="border:1px solid var(--border);border-radius:10px;padding:11px;background:var(--surface2)">
                <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px"><span style="font-size:15px;font-weight:600">${esc(elec.year)}</span><span style="font-size:9px;letter-spacing:.05em;text-transform:uppercase;color:var(--primary-ink);background:${elec.status === "Upcoming" ? "var(--up)" : "var(--primary)"};border-radius:4px;padding:2px 6px">${esc(elec.status)}</span></div>
                <div style="font-size:12.5px;margin-bottom:5px">${esc(elec.name)}</div>
                <div style="display:flex;align-items:center;gap:7px;font-size:11px;color:var(--mute)">${icon(elec.icon, 14)}${esc(elec.meta)}</div>
              </div>
            </div>
            <section style="background:var(--surface2);border:1px solid var(--border);border-radius:11px;padding:12px 13px">
              <div style="display:flex;align-items:center;gap:7px;margin-bottom:10px">${icon("groups", 15)}<h2 style="margin:0;font-size:12px;font-weight:600">Major parties</h2></div>
              ${c.parties.map((p) => `<div style="display:flex;align-items:center;gap:8px;margin-bottom:8px"><span style="width:9px;height:9px;border-radius:3px;background:${p.color}"></span><span style="font-size:12px;font-weight:500">${esc(p.name)}</span><span style="flex:1;height:5px;border-radius:3px;background:var(--surface3);overflow:hidden"><span style="display:block;height:100%;width:${p.w}%;background:${p.color}"></span></span><span style="font-size:12px;font-weight:600">${p.share}</span></div>`).join("")}
            </section>
          </aside>
          <main class="eid-map-card" style="min-height:320px">
            <div class="eid-map-toolbar">${icon("map", 18)}<h2>Electoral geography</h2><span style="margin-left:auto;font-size:10px;color:var(--mute)">${esc(c.geoLabel)}</span></div>
            <div class="eid-map-canvas" id="eidMap"></div>
          </main>
          <aside class="eid-scroll" style="display:flex;flex-direction:column;gap:12px">
            <section class="eid-card" style="overflow:hidden">
              <div style="display:flex;align-items:center;gap:8px;padding:12px 14px;border-bottom:1px solid var(--border)">${icon("how_to_vote", 16)}<div><h2 style="margin:0;font-size:13px;font-weight:600">${esc(elec.year)} · ${isNg ? "Presidential" : esc(elec.name)}</h2><div style="font-size:10px;color:var(--mute)">Official result</div></div></div>
              <div style="padding:11px 14px;display:flex;flex-direction:column;gap:11px">
                ${pres.map((row) => {
                  const [name, party, share, won] = row;
                  const color = D.PARTY_COLOR[party] || c.parties[0]?.color || "#8b939d";
                  return `<div>
                    <div style="display:flex;align-items:center;gap:8px;margin-bottom:5px"><span style="width:9px;height:9px;border-radius:2px;background:${color}"></span><span style="font-size:12px;font-weight:500">${esc(name)}</span><span style="font-size:10.5px;color:var(--mute)">${esc(party)}</span>${won ? icon("check_circle", 15) : ""}<span style="margin-left:auto;font-size:12px;font-weight:600">${share}%</span></div>
                    <div class="eid-bar"><span style="width:${share}%;background:${color}"></span></div>
                  </div>`;
                }).join("")}
              </div>
            </section>
          </aside>
        </div>
      </div>`;
  }

  function renderSectionPlaceholder(title) {
    const info = D.SECTIONS[title] || { icon: "dashboard", desc: "" };
    const c = country();
    return `
      <div class="eid-placeholder">
        <div class="eid-grid-bg"></div>
        <div class="eid-grid-bg coarse"></div>
        <div class="eid-placeholder-copy">
          <div style="display:inline-flex;align-items:center;gap:9px;margin-bottom:18px;padding:5px 12px 5px 6px;border:1px solid var(--border);background:var(--surface);border-radius:20px">
            ${c ? `<img class="eid-flag" src="${D.flagSrc(c.code)}" width="22" height="15" alt="">` : icon("public", 17)}
            <span style="font-size:12px;font-weight:500">${c ? esc(c.name) : "Global"}</span>
            ${icon("chevron_right", 15)}
            <span style="font-size:12px;color:var(--dim)">${esc(title)}</span>
          </div>
          <div class="eid-icon-box">${icon(info.icon, 30)}</div>
          <h1>${esc(title)}<span style="color:var(--dim);font-weight:400"> · ${c ? esc(c.name) : "Global"}</span></h1>
          <p>${esc(info.desc)}</p>
        </div>
      </div>`;
  }

  function renderMap() {
    const c = country();
    const hierarchy = (c ? c.geoUnits : "Country → Region → District → Voting unit").split(" → ");
    const layers = [
      { k: "boundaries", label: "Boundaries", dot: "var(--dim)" },
      { k: "results", label: "Results", dot: "var(--primary)" },
      { k: "turnout", label: "Turnout", dot: "var(--up)" },
      { k: "live", label: "Live feed", dot: "var(--live)" },
    ];
    return `
      <div class="eid-map-layout">
        <aside class="eid-panel eid-scroll">
          <div style="display:flex;flex-direction:column;gap:7px">
            <span style="font-size:10px;letter-spacing:.09em;text-transform:uppercase;color:var(--mute)">Basemap</span>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px">
              ${["dark", "satellite", "terrain", "streets"].map((k) => `<button class="eid-btn eid-btn-ghost" style="height:30px;${state.basemap === k ? "background:var(--surface3);color:var(--text);border-color:var(--border2)" : ""}" data-action="basemap" data-map="${k}">${k[0].toUpperCase() + k.slice(1)}</button>`).join("")}
            </div>
          </div>
          <div style="display:flex;flex-direction:column;gap:7px">
            <span style="font-size:10px;letter-spacing:.09em;text-transform:uppercase;color:var(--mute)">Layers</span>
            ${layers.map((l) => `<button class="eid-chip-btn ${state.layers[l.k] ? "is-on" : ""}" style="height:32px;justify-content:flex-start" data-action="toggle-layer" data-key="${l.k}"><span style="width:8px;height:8px;border-radius:2px;background:${l.dot}"></span>${l.label}</button>`).join("")}
          </div>
          <div style="display:flex;flex-direction:column;gap:7px">
            <span style="font-size:10px;letter-spacing:.09em;text-transform:uppercase;color:var(--mute)">Hierarchy</span>
            ${hierarchy.map((level, i) => `<div style="display:flex;align-items:center;gap:9px;padding:7px 9px;border:1px solid var(--border);border-radius:8px;font-size:12px"><span style="font-size:10px;color:var(--primary-ink);background:var(--primary);border-radius:4px;width:17px;height:17px;display:grid;place-items:center">${i + 1}</span>${esc(level)}</div>`).join("")}
          </div>
        </aside>
        <main class="eid-map-card">
          <div class="eid-map-toolbar">${icon("travel_explore", 17)}<h2>Interactive election map</h2><span style="margin-left:auto;font-size:10px;color:var(--mute)">click a feature · EPSG:4326</span></div>
          <div class="eid-map-canvas" id="eidMap"></div>
        </main>
        <aside class="eid-panel eid-scroll">
          ${(() => {
            const parties = c ? c.parties : D.COUNTRIES.ng.parties;
            const selName = state.mapSel || (c ? c.regions[0].label : "Nigeria");
            const info = D.featInfo(selName, parties);
            return `
              <div style="padding:4px 2px 10px;background:var(--primary-soft);border-radius:10px;padding:12px">
                <div style="font-size:10px;letter-spacing:.1em;text-transform:uppercase;color:var(--primary);margin-bottom:4px">Selected feature</div>
                <div style="font-size:17px;font-weight:600">${esc(info.name)}</div>
              </div>
              ${[["Population", info.population], ["Registered voters", info.registered], ["Turnout", info.turnout], ["Vote share", info.share], ["Margin", info.margin]].map(([l, v]) => `<div style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid var(--border)"><span style="color:var(--mute)">${l}</span><strong>${v}</strong></div>`).join("")}
              <div style="display:flex;justify-content:space-between;padding:9px 0"><span style="color:var(--mute)">Winning party</span><span style="display:inline-flex;align-items:center;gap:7px;font-weight:600"><span style="width:10px;height:10px;border-radius:3px;background:${info.partyColor}"></span>${esc(info.party)}</span></div>
              <div style="font-size:10px;letter-spacing:.09em;text-transform:uppercase;color:var(--mute);margin:8px 0">Vote breakdown</div>
              ${info.breakdown.map((b) => `<div style="margin-bottom:10px"><div style="display:flex;gap:8px;margin-bottom:5px"><span style="width:9px;height:9px;border-radius:2px;background:${b.color}"></span><span>${esc(b.name)}</span><span style="margin-left:auto;font-weight:600">${b.share}</span></div><div class="eid-bar"><span style="width:${b.w}%;background:${b.color}"></span></div></div>`).join("")}
            `;
          })()}
        </aside>
      </div>`;
  }

  function renderElections() {
    const c = country();
    const types = ["All", "Presidential", "Parliamentary", "Regional"];
    let rows;
    if (c) {
      rows = c.timeline.map((t) => ({
        name: `${t.year} ${t.name}`,
        type: (t.meta.split("·")[1] || t.name).trim(),
        date: t.year,
        detail: t.meta,
        status: t.status,
      }));
    } else {
      rows = [
        { name: "2027 General Election", type: "Presidential", date: "2027", detail: "Nigeria", status: "Upcoming" },
        { name: "2028 Presidential", type: "Presidential", date: "2028", detail: "United States", status: "Upcoming" },
        { name: "2026 General Election", type: "Presidential", date: "2026", detail: "Brazil", status: "Upcoming" },
        { name: "2024 General Election", type: "Parliamentary", date: "2024", detail: "United Kingdom · Labour", status: "Result" },
        { name: "2024 Lok Sabha", type: "Parliamentary", date: "2024", detail: "India · NDA", status: "Result" },
        { name: "2024 Presidential", type: "Presidential", date: "2024", detail: "Ghana · NDC", status: "Result" },
        { name: "2023 General Election", type: "Presidential", date: "2023", detail: "Nigeria · APC", status: "Result" },
      ];
    }
    if (state.elecType !== "All") rows = rows.filter((r) => r.type.toLowerCase().includes(state.elecType.toLowerCase()) || (state.elecType === "Regional" && /state|regional|govern/i.test(r.type + r.name)));
    return `
      <div class="eid-page eid-scroll">
        <div style="max-width:1040px;margin:0 auto">
          <div style="display:flex;align-items:flex-end;justify-content:space-between;gap:14px;margin-bottom:16px;flex-wrap:wrap">
            <div><div class="eid-kicker">${esc(scopeLabel())} · Elections</div><h1 style="margin:6px 0 0;font-size:22px;letter-spacing:-.02em">Elections</h1></div>
            <div style="display:flex;gap:7px;flex-wrap:wrap">${types.map((t) => `<button class="eid-btn eid-btn-ghost" data-action="elec-type" data-type="${t}" style="height:30px;${state.elecType === t ? "background:var(--surface3);color:var(--text);border-color:var(--border2)" : ""}">${t}</button>`).join("")}</div>
          </div>
          <div class="eid-table">
            <div class="eid-row" style="grid-template-columns:2.2fr 1.2fr .8fr 1fr;font-size:10.5px;letter-spacing:.05em;text-transform:uppercase;color:var(--mute)"><span>Election</span><span>Type</span><span>Year</span><span>Status</span></div>
            ${rows.map((e) => `<button data-action="open-live" class="eid-row" style="width:100%;grid-template-columns:2.2fr 1.2fr .8fr 1fr;background:transparent;border:none;border-bottom:1px solid var(--border);color:inherit;text-align:left;cursor:pointer;border-radius:0">
              <div><div style="font-size:13.5px;font-weight:500">${esc(e.name)}</div><div style="font-size:11px;color:var(--mute)">${esc(e.detail)}</div></div>
              <span style="color:var(--dim)">${esc(e.type)}</span>
              <span>${esc(e.date)}</span>
              <span style="display:inline-flex;align-items:center;gap:7px"><span style="width:8px;height:8px;border-radius:50%;background:${e.status === "Upcoming" ? "var(--up)" : "var(--primary)"}"></span>${esc(e.status)}</span>
            </button>`).join("")}
          </div>
        </div>
      </div>`;
  }

  function renderLive() {
    const c = country();
    const isNg = !c || c.code === "ng";
    const live = D.LIVE[0];
    const feat = {
      title: c && c.status !== "live" ? c.next.name : live.name,
      country: c ? c.name : "Nigeria",
      reporting: c && c.status !== "live" ? "0%" : live.reporting,
      cands: c && c.status !== "live" ? c.parties.slice(0, 3).map((p) => ({ name: p.name, party: p.name, pct: p.share, color: p.color, w: p.w })) : live.cands.map((x) => ({ ...x, w: parseFloat(x.pct) })),
    };
    const states = Object.keys(D.NG_STATES);
    const lgas = state.subState ? Object.keys(D.NG_STATES[state.subState].lgas) : [];
    const wards = state.subState && state.subLga ? D.NG_STATES[state.subState].lgas[state.subLga] : [];
    const pus = state.subWard ? [`${state.subWard} PU 001`, `${state.subWard} PU 002`] : [];
    return `
      <div class="eid-page eid-scroll">
        <div class="eid-live-grid" style="max-width:1220px;margin:0 auto;display:grid;grid-template-columns:minmax(300px,360px) minmax(0,1fr);gap:14px">
          <aside style="display:flex;flex-direction:column;gap:14px">
            ${isNg ? `
            <section class="eid-card" style="overflow:hidden">
              <div style="display:flex;align-items:center;gap:10px;padding:14px 16px;border-bottom:1px solid var(--border)">${icon("upload_file", 19)}<div><div style="font-weight:600">Submit your result</div><div style="font-size:11px;color:var(--mute)">GPS-verified · reviewed before publish</div></div></div>
              <div style="padding:15px 16px;display:flex;flex-direction:column;gap:11px">
                <div style="font-size:10px;letter-spacing:.08em;text-transform:uppercase;color:var(--mute)">1 · Identify your polling unit</div>
                <select class="eid-select" data-action="sub-state"><option value="">Select state…</option>${states.map((s) => `<option ${s === state.subState ? "selected" : ""}>${esc(s)}</option>`).join("")}</select>
                ${state.subState ? `<select class="eid-select" data-action="sub-lga"><option value="">Select LGA…</option>${lgas.map((s) => `<option ${s === state.subLga ? "selected" : ""}>${esc(s)}</option>`).join("")}</select>` : ""}
                ${state.subLga ? `<select class="eid-select" data-action="sub-ward"><option value="">Select ward…</option>${wards.map((s) => `<option ${s === state.subWard ? "selected" : ""}>${esc(s)}</option>`).join("")}</select>` : ""}
                ${state.subWard ? `<select class="eid-select" data-action="sub-pu"><option value="">Select polling unit…</option>${pus.map((s) => `<option ${s === state.subPU ? "selected" : ""}>${esc(s)}</option>`).join("")}</select>` : ""}
                <div style="height:1px;background:var(--border)"></div>
                <div style="font-size:10px;letter-spacing:.08em;text-transform:uppercase;color:var(--mute)">2 · Verify location &amp; attach</div>
                <button class="eid-btn eid-btn-ghost" data-action="locate" style="height:40px">${icon("my_location", 17)}${state.nearLabel ? "Location captured" : "Capture GPS"}</button>
                ${state.nearLabel ? `<div style="font-size:11px;color:var(--good)">${esc(state.nearLabel)}</div>` : ""}
                <label style="border:1px dashed var(--border2);border-radius:9px;padding:14px;text-align:center;cursor:pointer">
                  ${icon("add_photo_alternate", 22)}
                  <div style="font-size:12px;margin-top:6px">${state.subFile ? esc(state.subFile) : "Photo of the signed EC8A sheet"}</div>
                  <input type="file" accept="image/*" data-action="sub-file" style="display:none">
                </label>
                <button class="eid-btn eid-btn-primary" data-action="sub-send" style="height:40px">${icon("send", 17)}Submit result</button>
              </div>
              ${state.submissions.length ? `<div style="border-top:1px solid var(--border);padding:13px 16px">${state.submissions.map((r) => `<div style="display:flex;gap:10px;padding:9px 11px;border:1px solid var(--border);border-radius:10px;margin-bottom:8px">${icon("hourglass_top", 18)}<div style="min-width:0"><div style="font-weight:500">${esc(r.pu)}</div><div style="font-size:10px;color:var(--mute)">${esc(r.state)} · ${esc(r.file)}</div></div><span style="margin-left:auto;font-size:9.5px;color:var(--up);border:1px solid var(--up);border-radius:20px;padding:2px 8px">${esc(r.status)}</span></div>`).join("")}</div>` : ""}
            </section>` : `<section class="eid-card" style="padding:16px"><div style="font-weight:600;margin-bottom:6px">Citizen submission</div><p style="margin:0;color:var(--dim);font-size:13px">Polling-unit result upload is enabled for Nigeria. Switch scope to Nigeria to submit a sheet.</p></section>`}
          </aside>
          <div style="display:flex;flex-direction:column;gap:14px">
            <section class="eid-card" style="overflow:hidden">
              <div style="display:flex;align-items:center;gap:10px;padding:15px 18px;border-bottom:1px solid var(--border)"><span style="width:9px;height:9px;border-radius:50%;background:var(--live);animation:eidblink 1.6s infinite"></span><span class="eid-live-badge">LIVE</span><div><div style="font-size:16px;font-weight:600">${esc(feat.title)}</div><div style="font-size:12px;color:var(--mute)">${esc(feat.country)} · reporting ${feat.reporting}</div></div></div>
              <div style="padding:18px">
                <div style="display:flex;align-items:center;gap:10px;margin-bottom:16px"><span style="font-size:11px;color:var(--mute)">Reporting progress</span><div class="eid-bar" style="flex:1;height:8px"><span style="width:${parseFloat(feat.reporting) || 0}%;background:var(--live)"></span></div><strong>${feat.reporting}</strong></div>
                ${feat.cands.map((cd) => `<div style="margin-bottom:14px"><div style="display:flex;gap:9px;margin-bottom:6px"><span style="width:11px;height:11px;border-radius:3px;background:${cd.color}"></span><span style="font-weight:500">${esc(cd.name)}</span><span style="color:var(--mute)">${esc(cd.party)}</span><span style="margin-left:auto;font-size:16px;font-weight:600">${cd.pct}</span></div><div class="eid-bar" style="height:8px"><span style="width:${cd.w}%;background:${cd.color}"></span></div></div>`).join("")}
              </div>
            </section>
            <section class="eid-map-card" style="min-height:300px">
              <div class="eid-map-toolbar">${icon("map", 18)}<h2>Result map</h2></div>
              <div class="eid-map-canvas" id="eidMap"></div>
            </section>
            <div class="eid-kpis">
              ${[{ label: "Registered voters", value: "2.4M" }, { label: "Votes counted", value: "1.1M" }, { label: "Turnout", value: feat.reporting === "0%" ? "—" : "46.1%" }, { label: "Units reporting", value: feat.reporting }].map((s) => `<div class="eid-kpi"><div class="label">${esc(s.label)}</div><div class="value">${esc(s.value)}</div></div>`).join("")}
            </div>
          </div>
        </div>
      </div>`;
  }

  function renderData() {
    return `
      <div class="eid-page eid-scroll">
        <div style="max-width:1080px;margin:0 auto">
          <div class="eid-kicker">${state.scope === "global" ? "Global" : esc(country().name)} · Data</div>
          <h1 style="margin:6px 0 14px;font-size:24px;letter-spacing:-.02em">Datasets</h1>
          <div class="eid-table">
            <div class="eid-row" style="grid-template-columns:2fr 1fr 1.2fr 1fr auto;font-size:10px;letter-spacing:.08em;text-transform:uppercase;color:var(--mute)">
              <span>Dataset</span><span>Type</span><span>Format</span><span>Updated</span><span></span>
            </div>
            ${D.DATASETS.map((d) => `
              <div class="eid-row" style="grid-template-columns:2fr 1fr 1.2fr 1fr auto">
                <div style="display:flex;align-items:center;gap:10px">${icon(d.icon, 19)}<div><div style="font-weight:500">${esc(d.name)}</div><div style="font-size:11px;color:var(--mute)">${esc(d.coverage)} · ${esc(d.source)}</div></div></div>
                <span style="color:var(--dim)">${esc(d.type)}</span>
                <span style="color:var(--dim)">${esc(d.fmt)}</span>
                <span style="color:var(--mute)">${esc(d.updated)}</span>
                <button class="eid-btn eid-btn-ghost" style="height:32px" type="button">${icon("download", 16)}Export</button>
              </div>`).join("")}
          </div>
        </div>
      </div>`;
  }

  function renderAbout() {
    return `
      <div class="eid-page eid-scroll">
        <div style="max-width:820px;margin:0 auto">
          <div class="eid-kicker">${state.scope === "global" ? "Global" : esc(country().name)} · About</div>
          <h1 style="margin:6px 0 10px;font-size:24px;letter-spacing:-.02em">A global election intelligence platform</h1>
          <p style="margin:0 0 22px;font-size:14.5px;color:var(--dim);line-height:1.6">The dashboard models elections across different electoral systems — presidential, parliamentary, governorship and regional — using a configurable geographic hierarchy so each country keeps its own administrative and electoral structure rather than a single fixed template.</p>
          <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(230px,1fr));gap:12px">
            ${D.ABOUT.map((a) => `<div class="eid-card" style="padding:15px">${icon(a.icon, 22)}<h2 style="margin:9px 0 6px;font-size:14px">${esc(a.title)}</h2><p style="margin:0;font-size:12.5px;color:var(--dim);line-height:1.5">${esc(a.body)}</p></div>`).join("")}
          </div>
        </div>
      </div>`;
  }

  function renderAnalysis() {
    const c = country();
    const key = scopeLabel();
    const aseed = D.seedNum(key);
    const names = state.scope === "global" ? D.WORLD_MARKERS.map((m) => D.COUNTRIES[m.code].name) : (c ? c.regions.map((r) => r.label) : []);
    const metrics = [
      { icon: "swap_vert", label: "Avg vote swing", value: `${2 + (aseed % 7)}.${aseed % 9}`, unit: "pts", color: "var(--up)" },
      { icon: "trending_up", label: "Turnout change", value: `${aseed % 2 ? "+" : "−"}${1 + (aseed % 5)}.${aseed % 9}`, unit: "pts", color: "var(--good)" },
      { icon: "balance", label: "Competitive districts", value: `${8 + (aseed % 40)}`, unit: "", color: "var(--primary)" },
      { icon: "flag", label: "Strongholds", value: `${12 + (aseed % 60)}`, unit: "", color: "var(--dim)" },
    ];
    return `
      <div class="eid-page eid-scroll">
        <div style="max-width:1040px;margin:0 auto">
          <div class="eid-kicker">${esc(key)} · Analysis</div>
          <h1 style="margin:6px 0 16px;font-size:22px">Electoral analysis</h1>
          <div class="eid-kpis" style="margin-bottom:14px">${metrics.map((m) => `<div class="eid-kpi"><div class="label" style="color:var(--mute)">${icon(m.icon, 17)} ${esc(m.label)}</div><div><span class="value">${m.value}</span><span class="unit">${esc(m.unit)}</span></div></div>`).join("")}</div>
          <div class="eid-table">
            <div class="eid-row" style="grid-template-columns:2fr 1fr 1fr;font-size:10.5px;letter-spacing:.05em;text-transform:uppercase;color:var(--mute)"><span>Area</span><span>Swing</span><span>Margin</span></div>
            ${names.slice(0, 5).map((nm) => {
              const s = D.seedNum(nm);
              return `<div class="eid-row" style="grid-template-columns:2fr 1fr 1fr"><span>${esc(nm)}</span><span style="color:${s % 2 ? "var(--up)" : "var(--primary)"}">${s % 2 ? "+" : "−"}${1 + (s % 9)}.${s % 9} pts</span><span style="color:var(--dim)">${1 + (s % 14)}.${s % 9}%</span></div>`;
            }).join("")}
          </div>
        </div>
      </div>`;
  }

  function renderCandidates() {
    const c = country();
    const isNg = c && c.code === "ng";
    let cards;
    if (isNg) {
      cards = D.INEC_PARTIES.map((p) => {
        const hit = (D.PRES_BEARERS[p.abbr] || []).find((r) => r[0] === state.candYear);
        const name = hit ? hit[1] : D.NG_NAMES[D.seedNum(p.abbr + state.candYear) % D.NG_NAMES.length];
        return { initials: p.abbr.slice(0, 2), name, abbr: p.abbr, party: p.name, color: p.color, note: hit ? hit[2] : "Fielded candidate" };
      });
    } else {
      const src = c
        ? c.parties.map((p, i) => ({ name: (D.LEADS[c.code] || [])[i] || p.name, party: p.name, color: p.color, country: c.name, share: p.share }))
        : [
            { name: "B. Tinubu", party: "APC", color: "#2f6fed", country: "Nigeria", share: "36.6%" },
            { name: "K. Harris", party: "Democratic", color: "#2f6fed", country: "United States", share: "51.3%" },
            { name: "K. Starmer", party: "Labour", color: "#cf3a4e", country: "United Kingdom", share: "33.7%" },
            { name: "N. Modi", party: "NDA", color: "#ff9933", country: "India", share: "43.3%" },
            { name: "L. da Silva", party: "PT", color: "#cf3a4e", country: "Brazil", share: "50.9%" },
            { name: "J. Mahama", party: "NDC", color: "#2f6fed", country: "Ghana", share: "56.6%" },
          ];
      cards = src.filter((x) => x.name !== "—");
    }
    return `
      <div class="eid-page eid-scroll">
        <div style="max-width:1040px;margin:0 auto">
          <div style="display:flex;align-items:flex-end;justify-content:space-between;gap:14px;margin-bottom:16px;flex-wrap:wrap">
            <div><div class="eid-kicker">${esc(scopeLabel())} · Candidates</div><h1 style="margin:6px 0 0;font-size:22px">Candidates</h1></div>
            ${isNg ? `<div style="display:flex;gap:8px"><select class="eid-select" data-action="cand-year">${["2023", "2019", "2015"].map((y) => `<option value="${y}" ${y === state.candYear ? "selected" : ""}>${y} election</option>`).join("")}</select>
            <select class="eid-select" data-action="cand-office">${D.NG_OFFICES.map((o) => `<option value="${o.v}" ${o.v === state.candOffice ? "selected" : ""}>${esc(o.l)}</option>`).join("")}</select></div>` : ""}
          </div>
          ${isNg ? `<div style="font-size:11.5px;color:var(--mute);margin-bottom:12px">${state.candYear} · ${cards.length} parties fielded a candidate</div>
          <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(230px,1fr));gap:12px">
            ${cards.map((cd) => `<div class="eid-card" style="display:flex;align-items:center;gap:12px;padding:12px 13px"><span style="width:42px;height:42px;border-radius:10px;background:${cd.color};display:grid;place-items:center;color:#fff;font-weight:600">${esc(cd.initials)}</span><div style="min-width:0"><div style="font-weight:600">${esc(cd.name)}</div><div style="font-size:11px;color:var(--mute)">${esc(cd.abbr)} · ${esc(cd.party)}</div><div style="font-size:10.5px;color:var(--dim)">${esc(cd.note)}</div></div></div>`).join("")}
          </div>` : `<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(210px,1fr));gap:14px">
            ${cards.map((cd) => `<div class="eid-card" style="overflow:hidden"><div style="height:118px;background:repeating-linear-gradient(45deg,var(--surface3) 0 9px,var(--surface2) 9px 18px);position:relative"><span style="position:absolute;left:10px;top:10px;width:12px;height:12px;border-radius:3px;background:${cd.color}"></span></div><div style="padding:12px 13px"><div style="font-weight:600">${esc(cd.name)}</div><div style="font-size:11.5px;color:var(--mute);margin-bottom:9px">${esc(cd.party)} · ${esc(cd.country)}</div><div style="display:flex;justify-content:space-between"><span style="font-size:10.5px;text-transform:uppercase;color:var(--mute)">Vote share</span><strong>${cd.share}</strong></div></div></div>`).join("")}
          </div>`}
        </div>
      </div>`;
  }

  function renderParties() {
    const c = country();
    const isNg = c && c.code === "ng";
    if (isNg) {
      const sel = D.INEC_PARTIES.find((p) => p.abbr === state.selParty);
      const bearers = sel ? (D.PRES_BEARERS[sel.abbr] || [["2023", D.NG_NAMES[D.seedNum(sel.abbr) % D.NG_NAMES.length], "Contested", "#69727f"]]).map((r) => ({ year: r[0], name: r[1], outcome: r[2], color: r[3] })) : [];
      return `
        <div class="eid-page eid-scroll">
          <div style="max-width:1040px;margin:0 auto">
            <div class="eid-kicker">${esc(scopeLabel())} · Parties</div>
            <h1 style="margin:6px 0 8px;font-size:22px">Political parties</h1>
            <div style="font-size:11.5px;color:var(--mute);margin-bottom:12px">${D.INEC_PARTIES.length} parties registered with INEC · select a party to see its flag bearers</div>
            <div style="display:grid;grid-template-columns:minmax(0,1fr) minmax(300px,360px);gap:14px">
              <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(210px,1fr));gap:12px">
                ${D.INEC_PARTIES.map((p) => `<button data-action="sel-party" data-abbr="${p.abbr}" class="eid-card" style="padding:0;overflow:hidden;text-align:left;cursor:pointer;color:inherit;font-family:inherit;border:1px solid ${state.selParty === p.abbr ? "var(--primary)" : "var(--border)"};background:var(--surface)"><div style="height:4px;background:${p.color}"></div><div style="display:flex;gap:11px;padding:12px 13px"><span style="width:40px;height:40px;border-radius:9px;background:${p.color};display:grid;place-items:center;color:#fff;font-weight:600">${esc(p.abbr)}</span><div style="min-width:0"><div style="font-weight:600">${esc(p.abbr)}</div><div style="font-size:10.5px;color:var(--mute)">${esc(p.name)}</div><div style="font-size:10px;color:var(--dim)">Est. ${p.founded}</div></div></div></button>`).join("")}
              </div>
              <aside>
                ${sel ? `<section class="eid-card" style="overflow:hidden"><div style="height:5px;background:${sel.color}"></div><div style="display:flex;gap:11px;padding:14px 15px;border-bottom:1px solid var(--border)"><span style="width:44px;height:44px;border-radius:10px;background:${sel.color};display:grid;place-items:center;color:#fff;font-weight:600">${esc(sel.abbr)}</span><div style="flex:1"><div style="font-weight:600">${esc(sel.abbr)}</div><div style="font-size:11px;color:var(--mute)">${esc(sel.name)}</div></div><button class="eid-btn eid-btn-icon" data-action="sel-party" data-abbr="" style="width:28px;height:28px">${icon("close", 16)}</button></div>
                <div style="padding:9px 15px 4px;font-size:10px;letter-spacing:.06em;text-transform:uppercase;color:var(--mute)">Presidential flag bearers</div>
                <div style="padding:6px 15px 15px">${bearers.map((b) => `<div style="display:flex;gap:11px;padding:10px 0;border-bottom:1px solid var(--border)"><span style="font-weight:600;color:var(--dim);min-width:38px">${b.year}</span><div style="flex:1;font-weight:500">${esc(b.name)}</div><span style="font-size:10.5px;font-weight:600;color:${b.color}">${esc(b.outcome)}</span></div>`).join("")}</div></section>` : `<div style="border:1px dashed var(--border2);border-radius:13px;padding:30px 18px;text-align:center">${icon("touch_app", 30)}<div style="font-size:12.5px;color:var(--dim);margin-top:8px">Select a party to view its presidential flag bearers from past to present.</div></div>`}
              </aside>
            </div>
          </div>
        </div>`;
    }
    const list = (c ? c.parties.map((p, i) => ({ ...p, lead: (D.LEADS[c.code] || [])[i] || "—", country: c.name, seats: Math.round(p.w * 4.6), abbr: p.name.split(/[\s/]+/).map((w) => w[0]).join("").slice(0, 4).toUpperCase() })) : [
      { name: "APC", color: "#2f6fed", share: "36.6%", w: 36.6, lead: "B. Tinubu", country: "Nigeria", seats: 168, abbr: "APC" },
      { name: "Labour", color: "#cf3a4e", share: "33.7%", w: 33.7, lead: "K. Starmer", country: "United Kingdom", seats: 155, abbr: "L" },
      { name: "Democratic", color: "#2f6fed", share: "51.3%", w: 51.3, lead: "K. Harris", country: "United States", seats: 236, abbr: "D" },
      { name: "NDA", color: "#ff9933", share: "43.3%", w: 43.3, lead: "N. Modi", country: "India", seats: 199, abbr: "NDA" },
    ]);
    return `
      <div class="eid-page eid-scroll">
        <div style="max-width:1040px;margin:0 auto">
          <div class="eid-kicker">${esc(scopeLabel())} · Parties</div>
          <h1 style="margin:6px 0 16px;font-size:22px">Political parties</h1>
          <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:14px">
            ${list.map((p) => `<div class="eid-card" style="overflow:hidden"><div style="height:5px;background:${p.color}"></div><div style="padding:14px 15px"><div style="display:flex;gap:10px;margin-bottom:12px"><span style="width:34px;height:34px;border-radius:8px;background:${p.color};display:grid;place-items:center;color:#fff;font-size:11px;font-weight:600">${esc(p.abbr)}</span><div><div style="font-weight:600">${esc(p.name)}</div><div style="font-size:11px;color:var(--mute)">${esc(p.country)} · ${esc(p.lead)}</div></div></div><div style="display:flex;gap:10px;margin-bottom:11px"><div style="flex:1;border:1px solid var(--border);border-radius:8px;padding:8px 10px"><div style="font-size:9.5px;text-transform:uppercase;color:var(--mute)">Vote share</div><div style="font-size:16px;font-weight:600">${p.share}</div></div><div style="flex:1;border:1px solid var(--border);border-radius:8px;padding:8px 10px"><div style="font-size:9.5px;text-transform:uppercase;color:var(--mute)">Seats (est.)</div><div style="font-size:16px;font-weight:600">${p.seats}</div></div></div><div class="eid-bar"><span style="width:${p.w}%;background:${p.color}"></span></div></div></div>`).join("")}
          </div>
        </div>
      </div>`;
  }

  function afterRender() {
    const needsMap = document.getElementById("eidMap");
    if (!needsMap) {
      destroyMap();
      return;
    }
    const c = country();
    const markers = state.scope === "global"
      ? D.WORLD_MARKERS.map((m) => ({ ...m, name: D.COUNTRIES[m.code].name }))
      : [];
    mountMap("eidMap", {
      center: c ? c.center : [18, 12],
      zoom: c ? c.zoom : 2,
      markers,
    });
    const zoomIn = document.querySelector("[data-action='zoom-in']");
    const zoomOut = document.querySelector("[data-action='zoom-out']");
    if (zoomIn) zoomIn.onclick = () => mapInstance && mapInstance.zoomIn();
    if (zoomOut) zoomOut.onclick = () => mapInstance && mapInstance.zoomOut();
  }

  function renderStage() {
    if (state.section === "Overview") {
      return state.scope === "global" ? renderGlobalOverview() : renderCountryOverview();
    }
    if (state.section === "Map") return renderMap();
    if (state.section === "Elections") return renderElections();
    if (state.section === "Live Results") return renderLive();
    if (state.section === "Candidates") return renderCandidates();
    if (state.section === "Parties") return renderParties();
    if (state.section === "Analysis") return renderAnalysis();
    if (state.section === "Data") return renderData();
    if (state.section === "About") return renderAbout();
    return renderSectionPlaceholder(state.section);
  }

  function render() {
    applyTheme();
    if (state.view === "welcome") {
      destroyMap();
      app.innerHTML = renderWelcome();
      return;
    }
    app.innerHTML = `<div class="eid-shell">${renderHeader()}<div class="eid-stage">${renderStage()}</div></div>`;
    afterRender();
  }

  app.addEventListener("click", (event) => {
    const t = event.target.closest("[data-action], [data-nav]");
    if (!t) return;
    if (t.dataset.nav) {
      event.preventDefault();
      navigate(state.scope, t.dataset.nav);
      return;
    }
    const action = t.dataset.action;
    if (action === "theme") {
      state.theme = state.theme === "dark" ? "light" : "dark";
      if (state.basemap === "dark" || state.basemap === "light") state.basemap = state.theme === "light" ? "light" : "dark";
      render();
    } else if (action === "open-global") {
      navigate("global", "Overview");
    } else if (action === "open-country") {
      navigate(t.dataset.code, "Overview");
    } else if (action === "home") {
      state.view = "welcome";
      location.hash = "/welcome";
      render();
    } else if (action === "toggle-switcher") {
      state.switcherOpen = !state.switcherOpen;
      render();
    } else if (action === "close-switcher") {
      state.switcherOpen = false;
      render();
    } else if (action === "set-scope") {
      navigate(t.dataset.code, "Overview");
    } else if (action === "toggle-status") {
      state.statuses[t.dataset.key] = !state.statuses[t.dataset.key];
      render();
    } else if (action === "toggle-layer") {
      state.layers[t.dataset.key] = !state.layers[t.dataset.key];
      render();
    } else if (action === "reset-filters") {
      state.statuses = { live: true, upcoming: true, recent: true, nodata: false };
      render();
    } else if (action === "basemap") {
      state.basemap = t.dataset.map;
      render();
    } else if (action === "locate") {
      if (!navigator.geolocation) {
        state.nearLabel = "Location unavailable — nearest sample unit: FCT · Garki PU 001";
        render();
        return;
      }
      state.nearLabel = "Finding your location…";
      render();
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          state.nearLabel = `±${Math.round(pos.coords.accuracy)} m · nearest sample: FCT · Abuja Municipal · Garki PU 001`;
          state.ngState = "FCT";
          state.ngLga = "Abuja Municipal";
          state.ngWard = "Garki";
          state.ngPU = "Garki PU 001";
          render();
        },
        () => {
          state.nearLabel = "Location denied — nearest sample unit: FCT · Garki PU 001";
          render();
        }
      );
    } else if (action === "elec-type") {
      state.elecType = t.dataset.type;
      render();
    } else if (action === "open-live") {
      navigate(state.scope === "global" ? "ng" : state.scope, "Live Results");
    } else if (action === "sel-party") {
      state.selParty = t.dataset.abbr || null;
      render();
    } else if (action === "sub-send") {
      const pu = state.subPU || state.subWard;
      if (!pu) return;
      state.submissions.unshift({ pu, state: state.subState, file: state.subFile || "EC8A sheet", status: "Pending review" });
      render();
    }
  });

  app.addEventListener("input", (event) => {
    if (event.target.id === "countrySearch") {
      state.countryQuery = event.target.value;
      const active = document.activeElement === event.target;
      const pos = event.target.selectionStart;
      render();
      if (active) {
        const next = document.getElementById("countrySearch");
        if (next) {
          next.focus();
          next.setSelectionRange(pos, pos);
        }
      }
    }
  });

  app.addEventListener("change", (event) => {
    const el = event.target;
    if (el.matches("input[type=file]")) {
      state.subFile = el.files && el.files[0] ? el.files[0].name : "";
      render();
      return;
    }
    const action = el.dataset.action;
    if (action === "ng-state") {
      state.ngState = el.value;
      state.ngLga = "";
      state.ngWard = "";
      state.ngPU = "";
      render();
    } else if (action === "ng-lga") {
      state.ngLga = el.value;
      state.ngWard = "";
      state.ngPU = "";
      render();
    } else if (action === "ng-ward") {
      state.ngWard = el.value;
      state.ngPU = "";
      render();
    } else if (action === "ng-pu") {
      state.ngPU = el.value;
      render();
    } else if (action === "ov-elec") {
      state.ovElec = Number(el.value) || 0;
      render();
    } else if (action === "sub-state") {
      state.subState = el.value;
      state.subLga = "";
      state.subWard = "";
      state.subPU = "";
      render();
    } else if (action === "sub-lga") {
      state.subLga = el.value;
      state.subWard = "";
      state.subPU = "";
      render();
    } else if (action === "sub-ward") {
      state.subWard = el.value;
      state.subPU = "";
      render();
    } else if (action === "sub-pu") {
      state.subPU = el.value;
      render();
    } else if (action === "cand-year") {
      state.candYear = el.value;
      render();
    } else if (action === "cand-office") {
      state.candOffice = el.value;
      render();
    }
  });

  window.addEventListener("hashchange", () => {
    parseHash();
    render();
  });

  parseHash();
  if (!location.hash) location.hash = "/welcome";
  render();
})();
