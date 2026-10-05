(function (global) {
  const GOOGLE = {
    maxZoom: 20,
    subdomains: ["mt0", "mt1", "mt2", "mt3"],
    attribution: "Map data &copy; Google",
  };

  const TILES = {
    hybrid: { url: "https://{s}.google.com/vt/lyrs=y&x={x}&y={y}&z={z}", options: GOOGLE },
    satellite: { url: "https://{s}.google.com/vt/lyrs=s&x={x}&y={y}&z={z}", options: GOOGLE },
    streets: { url: "https://{s}.google.com/vt/lyrs=m&x={x}&y={y}&z={z}", options: GOOGLE },
    terrain: { url: "https://{s}.google.com/vt/lyrs=p&x={x}&y={y}&z={z}", options: GOOGLE },
    osm: {
      url: "https://{s}.tile.openstreetmap.fr/osmfr/{z}/{x}/{y}.png",
      options: {
        maxZoom: 20,
        subdomains: "abc",
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors, Tiles <a href="https://www.openstreetmap.fr/">OpenStreetMap France</a>',
      },
    },
    dark: {
      url: "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png",
      options: { maxZoom: 20, subdomains: "abcd", attribution: "&copy; OpenStreetMap &copy; CARTO" },
    },
    light: {
      url: "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png",
      options: { maxZoom: 20, subdomains: "abcd", attribution: "&copy; OpenStreetMap &copy; CARTO" },
    },
  };

  const GEO = {
    global: { center: [9.08, 8.68], zoom: 6 },
    ng: { center: [9.08, 8.68], zoom: 6 },
    us: { center: [39.83, -98.58], zoom: 4 },
    gb: { center: [54.5, -3.4], zoom: 5 },
    gh: { center: [7.95, -1.02], zoom: 7 },
    ke: { center: [0.02, 37.91], zoom: 6 },
    in: { center: [22.97, 79.59], zoom: 5 },
    de: { center: [51.16, 10.45], zoom: 6 },
    fr: { center: [46.23, 2.21], zoom: 6 },
    br: { center: [-14.24, -51.93], zoom: 4 },
    za: { center: [-30.56, 22.94], zoom: 5 },
    ekiti: { center: [7.67, 5.31], zoom: 9 },
  };

  function pollingUnitIcon(opts) {
    const focus = !!(opts && opts.focus);
    const size = focus ? 28 : 22;
    return global.L.divIcon({
      className: "eid-pu-marker",
      html: '<div class="eid-pu-pin' + (focus ? " is-focus" : "") + '"><span class="msi">where_to_vote</span></div>',
      iconSize: [size, size],
      iconAnchor: [size / 2, size / 2],
      popupAnchor: [0, -(size / 2)],
    });
  }

  const MARKER_LL = {
    ng: [9.08, 8.68],
    us: [39.83, -98.58],
    gb: [54.5, -3.4],
    gh: [7.95, -1.02],
    ke: [0.02, 37.91],
    in: [22.97, 79.59],
    br: [-14.24, -51.93],
  };

  const GRID3 = {
    state: "/api/grid3/state",
    lga: "/api/grid3/lga",
    ward: "/api/grid3/ward",
    health: "/api/grid3/health",
    polling: "/api/polling-unit-points",
  };

  const LOCAL_BOUNDARIES = {
    state: "/api/boundaries/state",
    lga: "/api/boundaries/lga",
    ward: "/api/boundaries/ward",
  };

  const GRID3_DIRECT = {
    state: "https://services3.arcgis.com/BU6Aadhn6tbBEdyk/arcgis/rest/services/NGA_State_Boundaries_V2/FeatureServer/0",
    lga: "https://services3.arcgis.com/BU6Aadhn6tbBEdyk/arcgis/rest/services/NGA_LGA_Boundaries_2/FeatureServer/0",
    ward: "https://services3.arcgis.com/BU6Aadhn6tbBEdyk/arcgis/rest/services/NGA_Ward_Boundaries/FeatureServer/0",
    health: "https://services3.arcgis.com/BU6Aadhn6tbBEdyk/arcgis/rest/services/GRID3_NGA_health_facilities_v2_0/FeatureServer/0",
  };

  const STYLES = {
    state: { color: "#111111", weight: 2, fillColor: "#000000", fillOpacity: 0, opacity: 1 },
    lga: { color: "#52525b", weight: 1.1, fillColor: "#000000", fillOpacity: 0, opacity: 0.9, dashArray: "5 4" },
    ward: { color: "#71717a", weight: 0.9, fillColor: "#000000", fillOpacity: 0, opacity: 0.75, dashArray: "2 3" },
  };

  const store = new WeakMap();
  const jsonCache = new Map();
  const stateBoundsSync = new Map();

  function themeSig(theme) {
    if (!theme || !theme.units) return '';
    const units = theme.units;
    const names = Object.keys(units);
    let hash = names.length;
    const step = Math.max(1, Math.floor(names.length / 32));
    for (let i = 0; i < names.length; i += step) {
      const u = units[names[i]] || {};
      const s = names[i] + '|' + (u.party || '') + '|' + (u.color || '') + '|' + (u.fillOpacity != null ? u.fillOpacity : '');
      for (let j = 0; j < s.length; j++) hash = (hash * 33 + s.charCodeAt(j)) | 0;
    }
    return [
      theme.key || '',
      theme.office || '',
      theme.year || theme.electionYear || '',
      theme.level || '',
      theme.state || '',
      theme.mapMode || '',
      hash,
    ].join('|');
  }

  function pickProp(props, keys) {
    if (!props) return "";
    for (let i = 0; i < keys.length; i++) {
      const value = props[keys[i]];
      if (value != null && String(value).trim()) return String(value).trim();
    }
    return "";
  }

  function featureLabel(id, props) {
    const state = pickProp(props, ["statename", "state"]);
    const lga = pickProp(props, ["lganame", "lga"]);
    const ward = pickProp(props, ["wardname", "ward"]);
    const unit = pickProp(props, ["pollingUnit", "name", "facility_name"]);
    let parts = [];
    if (id === "state") parts = [state];
    else if (id === "lga") parts = [state, lga];
    else if (id === "ward") parts = [state, lga, ward];
    else if (id === "polling") parts = [unit || "Polling unit", pickProp(props, ["address"]), ward, lga, state];
    else if (id === "health") parts = [unit, lga, state];
    else parts = [state, lga, ward, unit];
    return parts.filter(Boolean).join(" · ");
  }

  function ensure(el) {
    if (!el || !global.L) return null;
    let inst = store.get(el);
    if (inst) return inst;
    const map = global.L.map(el, {
      zoomControl: false,
      attributionControl: true,
      preferCanvas: true,
      fadeAnimation: false,
      markerZoomAnimation: false,
    });
    map.createPane("stateFill");
    const stateFillPane = map.getPane("stateFill");
    stateFillPane.style.zIndex = 445;
    stateFillPane.style.pointerEvents = "none";
    map.createPane("grid3");
    map.getPane("grid3").style.zIndex = 450;
    map.createPane("stateLines");
    const stateLinesPane = map.getPane("stateLines");
    stateLinesPane.style.zIndex = 470;
    stateLinesPane.style.pointerEvents = "none";
    map.createPane("official");
    map.getPane("official").style.zIndex = 455;
    map.createPane("citizen");
    map.getPane("citizen").style.zIndex = 460;
    inst = {
      map,
      tile: null,
      markers: global.L.layerGroup().addTo(map),
      route: global.L.layerGroup().addTo(map),
      points: global.L.layerGroup().addTo(map),
      citizenMarkers: global.L.layerGroup().addTo(map),
      overlays: {},
      cfg: {},
      comparePct: 50,
    };
    store.set(el, inst);
    if (typeof ResizeObserver !== "undefined") {
      const ro = new ResizeObserver(() => {
        const w = el.clientWidth, h = el.clientHeight;
        map.invalidateSize({ animate: false });
        if (inst.lastW === w && inst.lastH === h) return;
        inst.lastW = w;
        inst.lastH = h;
        if (inst._needsPaint || !inst.overlayKey) refreshOverlays(el);
      });
      ro.observe(el);
      inst.ro = ro;
    }
    global.addEventListener("resize", () => map.invalidateSize());
    let timer = null;
    map.on("moveend", () => {
      clearTimeout(timer);
      timer = setTimeout(() => refreshOverlays(el), 320);
    });
    return inst;
  }

  function paintRoute(inst, route) {
    inst.route.clearLayers();
    if (!route || !Array.isArray(route.coords) || route.coords.length < 2) {
      inst.routeKey = null;
      return;
    }
    const coords = route.coords
      .map((point) => [Number(point[0]), Number(point[1])])
      .filter((point) => point.every(Number.isFinite));
    if (coords.length < 2) return;
    const halo = global.L.polyline(coords, {
      color: "#ffffff",
      weight: 8,
      opacity: 0.9,
      lineCap: "round",
      lineJoin: "round",
      interactive: false,
    }).addTo(inst.route);
    const line = global.L.polyline(coords, {
      color: "#2563eb",
      weight: 4,
      opacity: 0.95,
      lineCap: "round",
      lineJoin: "round",
    }).addTo(inst.route);
    if (route.label) {
      line.bindTooltip(String(route.label), {
        permanent: true,
        direction: "center",
        className: "eid-route-label",
        opacity: 1,
      }).openTooltip();
    }
    if (Array.isArray(route.origin)) {
      global.L.circleMarker(route.origin, {
        radius: 7,
        color: "#ffffff",
        weight: 3,
        fillColor: "#2563eb",
        fillOpacity: 1,
      }).bindTooltip("Route origin").addTo(inst.route);
    }
    const routeKey = String(route.key || coords.length);
    if (inst.routeKey !== routeKey) {
      inst.routeKey = routeKey;
      inst.map.stop();
      inst.map.fitBounds(halo.getBounds(), { padding: [42, 42], maxZoom: 15 });
    }
  }

  function setBasemap(el, key) {
    const inst = ensure(el);
    if (!inst) return;
    const spec = TILES[key] || TILES.streets;
    const resolved = TILES[key] ? key : 'streets';
    if (inst.basemap === resolved && inst.tile) return;
    if (inst.tile) inst.map.removeLayer(inst.tile);
    inst.tile = global.L.tileLayer(spec.url, spec.options).addTo(inst.map);
    inst.basemap = resolved;
  }

  function clearOverlay(inst, id) {
    if (inst.overlays[id]) {
      inst.map.removeLayer(inst.overlays[id]);
      inst.overlays[id] = null;
    }
  }

  function themeStateMatches(theme, featureState) {
    if (!theme || !theme.state) return true;
    return adminNamesMatch(theme.state, featureState);
  }

  function resolveResultUnit(theme, layerId, props) {
    if (!theme || !theme.units) return null;
    const state = pickProp(props, ['statename', 'state']);
    const lga = pickProp(props, ['lganame', 'lga']);
    if (theme.level === 'lga' && layerId === 'lga') {
      // Shared LGA names exist across states (e.g. Bassa in Plateau and Kogi).
      // Never apply another state's result to a foreign polygon.
      if (!themeStateMatches(theme, state)) return null;
      const canonical = canonicalLgaName(lga);
      return theme.units[canonical]
        || theme.units[matchKey(canonical)]
        || theme.units[matchKey(lga)]
        || null;
    }
    if (theme.level === 'state' && layerId === 'state') {
      const canonical = canonicalStateName(state);
      return theme.units[canonical] || theme.units[matchKey(canonical)] || null;
    }
    return null;
  }

  function matchKey(value) {
    return String(value || '')
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/gi, '')
      .toLowerCase();
  }

  function resultKey(layerId, props, theme) {
    if (!theme || !theme.units) return '';
    const state = pickProp(props, ['statename', 'state']);
    const lga = pickProp(props, ['lganame', 'lga']);
    if (theme.level === 'lga' && layerId === 'lga') return canonicalLgaName(lga);
    if (theme.level === 'state' && layerId === 'state') return canonicalStateName(state);
    return '';
  }

  function canonicalStateName(name) {
    const key = normalizeAdminKey(name);
    if (key === 'federal capital territory' || key === 'abuja' || key === 'fct') return 'FCT';
    if (!name) return '';
    return String(name).trim();
  }

  function canonicalLgaName(name) {
    const key = matchKey(name);
    const aliases = {
      'ado ekiti': 'Ado',
      'ado': 'Ado',
      'ekiti south west': 'Ekiti South West',
      'ekiti southwest': 'Ekiti South West',
      'efun': 'Efon',
      'efon': 'Efon',
      'ido osi': 'Ido/Osi',
      'ido/osi': 'Ido/Osi',
      'ise orun': 'Ise/Orun',
      'ise/orun': 'Ise/Orun',
      'irepodun ifelodun': 'Irepodun/Ifelodun',
      'irepodun/ifelodun': 'Irepodun/Ifelodun',
      'ayekire': 'Gbonyin',
      'gbonyin': 'Gbonyin',
      'ayekire gbonyin': 'Gbonyin',
      shomolu: 'Somolu',
      somolu: 'Somolu',
      amuwoodofin: 'Amuwo-Odofin',
      ibejulekki: 'Ibeju/Lekki',
      ifakoijaye: 'Ifako-Ijaye',
      oturkpo: 'Otukpo',
      calabarmunicipal: 'Calabar Municipality',
      oorelope: 'Oorelope',
      orelope: 'Oorelope',
      dambatta: 'Danbata',
      dawakinkudu: 'Dawaki Kudu',
      dawakintofa: 'Dawaki Tofa',
      nassarawa: 'Nasarawa',
      abuaodual: 'Abua-Odual',
      emuoha: 'Emohua',
      ogubolo: 'Ogu/Bolo',
      omumma: 'Omuma',
      opobonkoro: 'Opobo/Nekoro',
      ogbomoshonorth: 'Ogbomoso North',
      ogbomoshosouth: 'Ogbomoso South',
      atakunmosaeast: 'Atakumosa East',
      atakunmosawest: 'Atakumosa West',
      ayedade: 'Ayedaade',
      // GRID3 boundary name ↔ Electoral Commission result spelling.
      // Boundary polygons whose names differ from the result LGA key, so the
      // vote colour lands on the right LGA instead of a neutral "no data" fill.
      obinwga: 'Obingwa', // Abia
      osisiomangwa: 'Osisioma', // Abia
      girei: 'Gire 1', // Adamawa
      ihiala: 'Ihala', // Anambra
      yenegoa: 'Yenagoa', // Bayelsa
      maiduguri: 'Maiduguri M. C.', // Borno
      iguegben: 'Igueben', // Edo
      uhunmwonde: 'Uhunmwode', // Edo
      adoekiti: 'Ado', // Ekiti
      shomgom: 'Shongom', // Gombe
      yamaltudeba: 'Yalmaltu/ Deba', // Gombe
      ezinihitte: 'Ezinihitte Mbaise', // Imo
      mbatoli: 'Mbaitoli', // Imo
      biriniwa: 'Birniwa', // Jigawa
      kirikasama: 'Kirika Samma', // Jigawa
      malumfashi: 'Malufashi', // Katsina
      aleiro: 'Aliero', // Kebbi
      bagudu: 'Bagudo', // Kebbi
      arewadandi: 'Arewa', // Kebbi
      kogi: 'Kogi . K. K.', // Kogi
      mopamuro: 'Mopa Moro', // Kogi
      ogorimagongo: 'Ogori Mangogo', // Kogi
      pategi: 'Patigi', // Kwara
      nasarawaegon: 'Nasarawa Eggon', // Nasarawa
      edati: 'Edatti', // Niger
      shagamu: 'Sagamu', // Ogun
      yewanorth: 'Egbado North', // Ogun
      yewasouth: 'Egbado South', // Ogun
      ileshaeast: 'Ilesa East', // Osun
      ileshawest: 'Ilesa West', // Osun
      barkinladi: 'Barikin Ladi', // Plateau
      sabonbirni: 'S/Birni', // Sokoto
      birninmagajikiyaw: 'Birnin Magaji', // Zamfara
    };
    if (aliases[key]) return aliases[key];
    return String(name || '').trim();
  }

  function normalizeAdminKey(value) {
    return String(value || '')
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/\bcentre\b/gi, 'center')
      .replace(/[^a-z0-9]+/gi, ' ')
      .trim()
      .toLowerCase();
  }

  function canonicalAdminState(name) {
    const key = normalizeAdminKey(name).replace(/\s+/g, '');
    if (!key) return '';
    if (key === 'fct' || key === 'abuja' || key === 'fctabuja' || key === 'federalcapitalterritory') return 'FCT';
    return String(name || '').trim();
  }

  // Directory / INEC short names ↔ GRID3 / ArcGIS long names.
  function adminNameAliasKeys(name) {
    const key = normalizeAdminKey(name);
    if (!key) return [];
    const compact = key.replace(/\s+/g, '');
    const groups = [
      ['municipal', 'municipal area council', 'abuja municipal', 'amac'],
      ['fct', 'abuja', 'federal capital territory', 'fct abuja'],
    ];
    for (let i = 0; i < groups.length; i++) {
      const group = groups[i];
      if (group.some((g) => g === key || g.replace(/\s+/g, '') === compact)) {
        return group.slice();
      }
    }
    return [key];
  }

  function adminNamesMatch(a, b) {
    const left = normalizeAdminKey(a);
    const right = normalizeAdminKey(b);
    if (!left || !right) return false;
    if (left === right) return true;

    const leftAliases = adminNameAliasKeys(left);
    const rightAliases = adminNameAliasKeys(right);
    if (leftAliases.some((l) => rightAliases.includes(l))) return true;

    // "Garki" ↔ "Garki 1" / "Garki II" without matching "Garkida".
    const stripTrailingCode = (s) =>
      s
        .replace(/\b(?:\d+|i|ii|iii|iv|v|a|b|c)\b/gi, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    const leftBase = stripTrailingCode(left);
    const rightBase = stripTrailingCode(right);
    if (leftBase && rightBase && leftBase === rightBase) return true;

    const leftTokens = left.split(/\s+/).filter(Boolean);
    const rightTokens = right.split(/\s+/).filter(Boolean);
    if (leftTokens.length === 1 && rightTokens.includes(left)) return true;
    if (rightTokens.length === 1 && leftTokens.includes(right)) return true;

    // Shorter multi-token name fully contained as tokens (Municipal ⊂ Municipal Area Council).
    const shortTokens = leftTokens.length <= rightTokens.length ? leftTokens : rightTokens;
    const longTokens = leftTokens.length <= rightTokens.length ? rightTokens : leftTokens;
    if (shortTokens.length > 1 && shortTokens.every((t) => longTokens.includes(t))) return true;

    return false;
  }

  function adminNamesMatchLoose(a, b) {
    if (adminNamesMatch(a, b)) return true;
    // Directory wards like "Anifowoshe/Ikeja" ↔ ArcGIS "Anifowoshe"
    const partsA = String(a || '')
      .split(/[\/|,]+/)
      .map((t) => t.trim())
      .filter(Boolean);
    const partsB = String(b || '')
      .split(/[\/|,]+/)
      .map((t) => t.trim())
      .filter(Boolean);
    if (partsA.length <= 1 && partsB.length <= 1) return false;
    return partsA.some((pa) => partsB.some((pb) => adminNamesMatch(pa, pb)) || adminNamesMatch(pa, b))
      || partsB.some((pb) => adminNamesMatch(a, pb));
  }

  function featureMatchesState(props, state) {
    if (!state) return true;
    const name = pickProp(props, ['statename', 'state', 'STATE']);
    return adminNamesMatch(name, state) || adminNamesMatch(name, canonicalAdminState(state));
  }

  function featureMatchesLga(props, lga) {
    if (!lga) return true;
    const name = pickProp(props, ['lganame', 'lga', 'LGA']);
    return adminNamesMatch(name, lga);
  }

  function pickAdminFeatures(data, field, target, scope) {
    const features = (data && data.features) || [];
    const scoped = features.filter((feat) => {
      if (!feat || !feat.properties) return false;
      if (scope && scope.state && !featureMatchesState(feat.properties, scope.state)) return false;
      if (scope && scope.lga && !featureMatchesLga(feat.properties, scope.lga)) return false;
      return true;
    });
    if (!target) return scoped;
    const tokens = String(target || '')
      .split(/[\/|,]+/)
      .map((t) => t.trim())
      .filter(Boolean);
    return scoped.filter((feat) => {
      const name = pickProp(feat.properties, [field, field.toUpperCase(), 'wardname', 'ward', 'lganame', 'lga', 'statename', 'state']);
      if (adminNamesMatchLoose(name, target)) return true;
      return tokens.some((tok) => adminNamesMatchLoose(name, tok));
    });
  }

  function buildAdminWhere(state, lga, ward) {
    const stateName = canonicalAdminState(state) || String(state || '').trim();
    let where = "UPPER(statename)='" + escWhere(stateName).toUpperCase() + "'";
    if (lga) {
      const aliases = adminNameAliasKeys(lga)
        .map((a) => a.toUpperCase())
        .filter((v, i, arr) => arr.indexOf(v) === i);
      const raw = normalizeAdminKey(lga).toUpperCase();
      if (raw && !aliases.includes(raw)) aliases.push(raw);
      if (aliases.length === 1) {
        where += " AND UPPER(lganame)='" + escWhere(aliases[0]) + "'";
      } else {
        where +=
          ' AND (' +
          aliases.map((a) => "UPPER(lganame)='" + escWhere(a) + "'").join(' OR ') +
          ')';
      }
    }
    if (ward) {
      const wardKey = normalizeAdminKey(ward);
      const firstToken = (wardKey.split(/\s+/)[0] || wardKey).toUpperCase();
      if (firstToken) {
        where +=
          " AND (UPPER(wardname)='" +
          escWhere(wardKey.toUpperCase()) +
          "' OR UPPER(wardname) LIKE '" +
          escWhere(firstToken) +
          " %' OR UPPER(wardname) LIKE '% " +
          escWhere(firstToken) +
          "' OR UPPER(wardname) LIKE '% " +
          escWhere(firstToken) +
          " %')";
      }
    }
    return where;
  }

  function styleForFeature(layerId, props, cfg, themeOverride) {
    const theme = themeOverride || (cfg && cfg.resultTheme);
    const base = STYLES[layerId] || STYLES.state;
    let style = base;
    if (theme && theme.units) {
      const hit = resolveResultUnit(theme, layerId, props);
      if (hit && hit.color) {
        style = {
          color: '#ffffff',
          weight: layerId === 'state' ? 1.4 : 1.1,
          fillColor: hit.color,
          fillOpacity: hit.fillOpacity != null ? hit.fillOpacity : (theme.level === layerId ? 0.78 : 0),
          opacity: 0.95,
        };
      } else if (theme.level === layerId) {
        // No result for this unit (e.g. an LGA with no vote count): fill it a
        // visible neutral grey so the parent state reads as complete instead of
        // showing transparent gaps, while staying distinct from party colors.
        style = { ...base, fillColor: '#94a3b8', fillOpacity: 0.72, opacity: 0.95, weight: base.weight };
      }
    }
    // State strokes live on one shared line layer so adjacent polygons are not drawn twice.
    if (layerId === 'state') return { ...style, stroke: false, weight: 0, opacity: 0 };
    return style;
  }

  function coordKey(coord) {
    return Number(coord[0]).toFixed(5) + ',' + Number(coord[1]).toFixed(5);
  }

  function uniqueBoundaryFeature(data) {
    if (!data || !data.features) return { type: 'FeatureCollection', features: [] };
    if (data._eidLines) return data._eidLines;
    const seen = new Set();
    const lines = [];
    const addRing = (ring) => {
      if (!ring || ring.length < 2) return;
      for (let i = 0; i < ring.length - 1; i++) {
        const a = ring[i];
        const b = ring[i + 1];
        if (!a || !b || a.length < 2 || b.length < 2) continue;
        const ak = coordKey(a);
        const bk = coordKey(b);
        if (ak === bk) continue;
        const key = ak < bk ? ak + '|' + bk : bk + '|' + ak;
        if (seen.has(key)) continue;
        seen.add(key);
        lines.push([a, b]);
      }
    };
    data.features.forEach((feat) => {
      const geom = feat && feat.geometry;
      if (!geom) return;
      const polys = geom.type === 'Polygon' ? [geom.coordinates] : geom.type === 'MultiPolygon' ? geom.coordinates : [];
      polys.forEach((poly) => { if (poly) poly.forEach(addRing); });
    });
    data._eidLines = {
      type: 'FeatureCollection',
      features: lines.length
        ? [{ type: 'Feature', properties: {}, geometry: { type: 'MultiLineString', coordinates: lines } }]
        : [],
    };
    return data._eidLines;
  }

  function stateLineStyle(themed) {
    return themed
      ? { color: '#ffffff', weight: 1.25, opacity: 0.95, lineJoin: 'round', lineCap: 'round' }
      : { color: '#111111', weight: 1.6, opacity: 1, lineJoin: 'round', lineCap: 'round' };
  }

  function activeStateSource(inst) {
    const src = inst && inst.overlaySource;
    const drawn = inst && inst.overlays;
    if (!src || !drawn) return null;
    if (drawn.state && src.state) return src.state;
    if (drawn['official-state'] && src['official-state']) return src['official-state'];
    if (drawn['citizen-state'] && src['citizen-state']) return src['citizen-state'];
    return null;
  }

  function paintStateOutline(inst) {
    if (!inst || !inst.map) return;
    const src = activeStateSource(inst);
    if (!src || !src.features || !src.features.length) {
      clearOverlay(inst, 'state-lines');
      inst._stateLineSig = null;
      inst._stateLineData = null;
      return;
    }
    const cfg = inst.cfg || {};
    const themed = !!(
      (cfg.resultTheme && cfg.resultTheme.units) ||
      (cfg.citizenTheme && cfg.citizenTheme.units)
    );
    const lines = uniqueBoundaryFeature(src);
    const count = (lines.features[0] && lines.features[0].geometry.coordinates.length) || 0;
    const sig = (themed ? 't' : 'b') + ':' + count;
    const existing = inst.overlays['state-lines'];
    if (existing && inst._stateLineData === lines) {
      if (inst._stateLineSig !== sig && typeof existing.setStyle === 'function') existing.setStyle(stateLineStyle(themed));
      inst._stateLineSig = sig;
      return;
    }
    clearOverlay(inst, 'state-lines');
    if (!count) {
      inst._stateLineSig = sig;
      inst._stateLineData = lines;
      return;
    }
    if (!inst.map.getPane('stateLines')) {
      inst.map.createPane('stateLines');
      const pane = inst.map.getPane('stateLines');
      pane.style.zIndex = 470;
      pane.style.pointerEvents = 'none';
    }
    const layer = global.L.geoJSON(lines, {
      pane: 'stateLines',
      interactive: false,
      smoothFactor: 0,
      style: stateLineStyle(themed),
    });
    layer.addTo(inst.map);
    inst.overlays['state-lines'] = layer;
    inst._stateLineSig = sig;
    inst._stateLineData = lines;
  }

  function popupForFeature(layerId, props, cfg, themeOverride) {
    const label = featureLabel(layerId, props);
    const theme = themeOverride || (cfg && cfg.resultTheme);
    const hit = theme && theme.units ? resolveResultUnit(theme, layerId, props) : null;
    if (!hit) return '<strong>' + label.replace(/</g, '&lt;') + '</strong>';
    if (hit.pending != null || hit.approved != null || (hit.count != null && (hit.party === 'Citizen' || hit.party === 'Pending'))) {
      const bits = [];
      if (hit.approved) bits.push(hit.approved + ' approved');
      if (hit.pending) bits.push(hit.pending + ' pending');
      if (!bits.length && hit.count != null) bits.push(hit.count + ' public returns');
      return '<strong>' + label.replace(/</g, '&lt;') + '</strong><br>Public: ' + bits.join(' · ');
    }
    // Only governorship archive picker (coverage===true / mapMode). Choropleth uses coverage as a level string.
    if (theme && (theme.mapMode === 'gov-coverage' || theme.coverage === true)) {
      const tip = hit.coverage
        ? ('Archive · ' + String(hit.winner || '').replace(/</g, '&lt;') + ' · click to open')
        : 'No archive yet · click to select';
      return '<strong>' + label.replace(/</g, '&lt;') + '</strong><br>' + tip;
    }
    const share = hit.share != null ? `<br>${Number(hit.share).toFixed(1)}%` : '';
    return [
      '<strong>' + label.replace(/</g, '&lt;') + '</strong>',
      hit.winner ? hit.winner.replace(/</g, '&lt;') + ' · ' + hit.party : hit.party,
      share,
    ].filter(Boolean).join('<br>');
  }

  function overlayKind(id) {
    return String(id || '').replace(/^citizen-/, '').replace(/^official-/, '');
  }

  function liveTheme(inst, fallback) {
    return (inst && inst.cfg && inst.cfg.resultTheme) || fallback || null;
  }

  function restyleOverlay(inst, id, theme) {
    const group = inst.overlays && inst.overlays[id];
    if (!group || typeof group.eachLayer !== 'function') return false;
    const cfg = inst.cfg || {};
    const kind = overlayKind(id);
    group.eachLayer((layer) => {
      const props = layer.feature && layer.feature.properties;
      if (!props || typeof layer.setStyle !== 'function') return;
      layer.setStyle(styleForFeature(kind, props, cfg, theme));
      if (typeof layer.setPopupContent === 'function' && layer.getPopup && layer.getPopup()) {
        layer.setPopupContent(popupForFeature(kind, props, cfg, theme));
      }
    });
    return true;
  }

  function putGeoJson(inst, id, data, isPoint, opts) {
    if (!data || !data.features || !data.features.length) {
      clearOverlay(inst, id);
      if (inst.overlaySource) inst.overlaySource[id] = null;
      return;
    }
    const cfg = inst.cfg || {};
    const options = opts || {};
    const pane = options.pane || 'grid3';
    const theme = options.theme || cfg.resultTheme;
    const kind = overlayKind(id);
    const layer = global.L.geoJSON(data, {
      pane,
      smoothFactor: 0,
      style: (feat) => styleForFeature(kind, feat.properties, cfg, liveTheme(inst, theme)),
      pointToLayer: isPoint
        ? (feat, latlng) => {
            if (id === 'polling' || id.indexOf('polling') >= 0) {
              return global.L.marker(latlng, {
                pane,
                icon: pollingUnitIcon(),
                keyboard: false,
              });
            }
            return global.L.circleMarker(latlng, {
              pane,
              radius: 5,
              color: '#ffffff',
              weight: 1,
              fillColor: '#be123c',
              fillOpacity: 0.9,
            });
          }
        : undefined,
      onEachFeature: (feat, lyr) => {
        const label = featureLabel(kind, feat.properties);
        if (label) {
          lyr.bindTooltip(label, { sticky: true, direction: 'top' });
          lyr.bindPopup(() => popupForFeature(kind, feat.properties, inst.cfg || cfg, liveTheme(inst, theme)));
        }
        if (cfg.onResultUnitClick && !options.skipClick) {
          lyr.on('click', () => {
            const current = liveTheme(inst, theme);
            if (!current || !current.units) return;
            const hit = resolveResultUnit(current, kind, feat.properties);
            const hitKey = (hit && hit._canonicalKey) || resultKey(kind, feat.properties, current);
            const click = inst.cfg && inst.cfg.onResultUnitClick;
            if (hitKey && hit && click) click(hitKey, hit, kind);
          });
        }
      },
    });
    const prev = inst.overlays[id];
    layer.addTo(inst.map);
    inst.overlays[id] = layer;
    if (prev) inst.map.removeLayer(prev);
    inst.overlaySource = inst.overlaySource || {};
    inst.overlaySource[id] = data;
  }

  function paintOverlay(inst, id, data, isPoint, opts) {
    const theme = (opts && opts.theme) || (inst.cfg && inst.cfg.resultTheme) || null;
    const sig = themeSig(theme) + '|' + ((opts && opts.pane) || '') + '|' + (opts && opts.skipClick ? '1' : '0');
    inst.overlayStyleSig = inst.overlayStyleSig || {};
    inst.overlaySource = inst.overlaySource || {};
    if (
      data &&
      inst.overlaySource[id] === data &&
      inst.overlays[id] &&
      inst.overlayStyleSig[id] === sig
    ) return;
    if (data && inst.overlaySource[id] === data && inst.overlays[id] && !isPoint) {
      restyleOverlay(inst, id, theme);
      inst.overlayStyleSig[id] = sig;
      return;
    }
    putGeoJson(inst, id, data, isPoint, opts);
    inst.overlayStyleSig[id] = sig;
  }

  function bboxOf(map) {
    const b = map.getBounds();
    return [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()].map((n) => n.toFixed(4)).join(",");
  }

  async function loadJson(url) {
    if (jsonCache.has(url)) {
      try { return await jsonCache.get(url); } catch (e) { jsonCache.delete(url); }
    }
    const pending = (async () => {
      const res = await fetch(url);
      if (!res.ok) return null;
      const data = await res.json();
      if (data && data.error) return null;
      return data;
    })();
    jsonCache.set(url, pending);
    try {
      const data = await pending;
      if (data == null) jsonCache.delete(url);
      else maybeIndexStateBounds(url, data);
      return data;
    } catch (e) {
      jsonCache.delete(url);
      return null;
    }
  }

  function grid3Query(layerId, bbox) {
    const params = new URLSearchParams({
      f: "geojson",
      where: "1=1",
      outFields: "*",
      outSR: "4326",
      returnGeometry: "true",
      resultRecordCount: "1500",
      geometry: bbox,
      geometryType: "esriGeometryEnvelope",
      inSR: "4326",
      spatialRel: "esriSpatialRelIntersects",
    });
    return GRID3_DIRECT[layerId].replace(/\/$/, "") + "/query?" + params.toString();
  }

  async function loadLayer(layerId, bbox, preferLocalOnly) {
    if (layerId === 'state') {
      const all = await loadJson(LOCAL_BOUNDARIES.state);
      if (all && all.features && all.features.length) return all;
    }
    if (LOCAL_BOUNDARIES[layerId]) {
      const local = await loadJson(LOCAL_BOUNDARIES[layerId] + "?bbox=" + encodeURIComponent(bbox));
      if (local && local.features && local.features.length) return local;
      if (preferLocalOnly) return local;
    }
    if (preferLocalOnly && layerId !== "health" && layerId !== "polling") return null;
    const proxied = await loadJson(GRID3[layerId] + "?bbox=" + encodeURIComponent(bbox));
    if (proxied && (proxied.features || proxied.points)) return proxied;
    if (GRID3_DIRECT[layerId]) return loadJson(grid3Query(layerId, bbox));
    return null;
  }

  async function queryLocalAdmin(layerId, state, lga, ward) {
    const params = new URLSearchParams();
    if (state) params.set("state", state);
    if (lga) params.set("lga", lga);
    if (ward) params.set("ward", ward);
    const url = LOCAL_BOUNDARIES[layerId] + "?" + params.toString();
    return loadJson(url);
  }

  function hasDrawnOverlay(inst) {
    const o = inst && inst.overlays;
    if (!o) return false;
    return !!(o.state || o.lga || o['official-state'] || o['citizen-state'] || o.ward);
  }

  function restyleDrawn(inst) {
    const cfg = inst.cfg || {};
    if (inst.overlays.state) restyleOverlay(inst, 'state', cfg.resultTheme || null);
    if (inst.overlays['official-state']) restyleOverlay(inst, 'official-state', cfg.resultTheme || null);
    if (inst.overlays['citizen-state']) restyleOverlay(inst, 'citizen-state', cfg.citizenTheme || null);
    if (inst.overlays.lga) restyleOverlay(inst, 'lga', cfg.resultTheme || null);
    const sig = themeSig(cfg.resultTheme) + '||' + themeSig(cfg.citizenTheme);
    inst.overlayStyleSig = inst.overlayStyleSig || {};
    ['state', 'official-state', 'citizen-state', 'lga'].forEach((id) => {
      if (inst.overlays[id]) inst.overlayStyleSig[id] = sig + '|' + id;
    });
    paintStateOutline(inst);
  }

  function lgaCollectionForState(data, state) {
    if (!data || !data.features) return data;
    const bag = data._eidByState || (data._eidByState = {});
    const key = String(state || '');
    if (!bag[key]) {
      bag[key] = {
        type: 'FeatureCollection',
        features: pickAdminFeatures(data, 'statename', state),
      };
    }
    return bag[key];
  }

  function ghanaRegionName(props) {
    const raw = (props && (props.shapeName || props.name)) || "";
    return String(raw).replace(/\s+region$/i, "").trim();
  }

  function paintGhanaRegions(inst, data, selected, theme) {
    clearOverlay(inst, "ghana");
    if (!data || !data.features || !data.features.length) return;
    const want = String(selected || "").toLowerCase();
    const units = (theme && theme.ok && theme.units) || {};
    const layer = global.L.geoJSON(data, {
      pane: "grid3",
      style: (feat) => {
        const name = ghanaRegionName(feat.properties);
        const on = !!(want && name.toLowerCase() === want);
        const unit = units[name];
        if (!unit) {
          return {
            stroke: true,
            color: on ? "#0f766e" : "#155e75",
            weight: on ? 2.6 : 1.15,
            fill: true,
            fillColor: on ? "#5eead4" : "#ccfbf1",
            fillOpacity: on ? 0.62 : 0.35,
          };
        }
        return {
          stroke: true,
          color: on ? "#0f172a" : "#ffffff",
          weight: on ? 2.6 : 1.1,
          fill: true,
          fillColor: unit.color || "#94a3b8",
          fillOpacity: on ? 0.92 : 0.78,
        };
      },
      onEachFeature: (feat, lyr) => {
        const name = ghanaRegionName(feat.properties);
        const unit = units[name];
        const tip = unit
          ? (name + " — " + (unit.party || "result") + " plurality" + (unit.winner ? " · " + unit.winner : ""))
          : name;
        lyr.bindTooltip(tip, { sticky: true, direction: "top" });
        lyr.on("click", () => {
          const cb = inst.cfg && inst.cfg.onGhanaRegion;
          if (typeof cb === "function") cb(name);
        });
      },
    });
    layer.addTo(inst.map);
    inst.overlays.ghana = layer;
    inst.overlaySource = inst.overlaySource || {};
    inst.overlaySource.ghana = data;
  }

  function ghanaThemeKey(theme) {
    if (!theme || !theme.ok || !theme.units) return "empty";
    return Object.keys(theme.units).map((name) => name + ":" + (theme.units[name].party || "")).join(",");
  }

  async function refreshGhanaOverlays(el, inst) {
    const region = (inst.cfg && inst.cfg.ghanaRegion) || "";
    const year = (inst.cfg && inst.cfg.ghanaYear) || "";
    const contest = (inst.cfg && inst.cfg.ghanaContest) || "";
    const theme = inst.cfg && inst.cfg.ghanaTheme;
    const key = "gh|" + region + "|" + contest + "|" + year + "|" + ghanaThemeKey(theme);
    if (inst.overlayKey === key && inst.overlays.ghana && !inst._needsPaint) return;
    inst.overlayKey = key;
    inst._geomKey = key;
    inst._needsPaint = false;
    ["state", "official-state", "citizen-state", "lga", "ward", "health", "polling", "state-lines"].forEach((id) => {
      clearOverlay(inst, id);
    });
    const data = await loadJson("/data/ghana-regions.geojson");
    if (!inst.map || inst.overlayKey !== key) return;
    paintGhanaRegions(inst, data, region, theme);
    if (!inst._ghanaAttrib && inst.map.attributionControl) {
      inst.map.attributionControl.addAttribution('Regions &copy; <a href="https://www.geoboundaries.org">geoBoundaries</a> / OpenStreetMap (CC BY-SA)');
      inst._ghanaAttrib = true;
    }
    if (!inst._ghanaFitted && data && data.features) {
      const bounds = boundsFromFeatures(data);
      if (bounds) {
        inst._ghanaFitted = true;
        inst.map.fitBounds(bounds, { padding: [28, 28], animate: false });
      }
    }
  }

  async function refreshOverlays(el) {
    const inst = store.get(el);
    if (!inst || !inst.map) return;
    if (el.clientWidth < 40 || el.clientHeight < 40) {
      inst._needsPaint = true;
      return;
    }
    if (inst.cfg && inst.cfg.scope === "gh") {
      return refreshGhanaOverlays(el, inst);
    }
    if (inst.overlays && inst.overlays.ghana) clearOverlay(inst, "ghana");
    const layers = inst.cfg.layers || {};
    const preferLocalOnly = !!inst.cfg.preferLocalOnly;
    const zoom = inst.map.getZoom();
    const bbox = bboxOf(inst.map);
    const compareMode = inst.cfg.compareMode === 'compare' ? 'compare' : 'overlay';
    const showOfficial = inst.cfg.showOfficial !== false;
    const showCitizen = inst.cfg.showCitizen !== false;
    const isLive = !!inst.cfg.live;
    const theme = inst.cfg.resultTheme;
    const zoomBand = zoom < 5 ? 0 : zoom < 8 ? 1 : zoom < 9 ? 2 : 3;
    const lgaThemeState = theme && theme.level === 'lga' && theme.state ? String(theme.state) : '';
    const lgaStale = !!(lgaThemeState && inst._framedState && stateBoundsKey(lgaThemeState) !== inst._framedState);
    const lgaState = lgaStale ? '' : lgaThemeState;
    const styleKey = themeSig(theme) + '||' + themeSig(inst.cfg.citizenTheme);
    const geomKey = JSON.stringify({
      layers, preferLocalOnly, zoomBand,
      bbox: zoomBand >= 2 ? bbox : '',
      lgaState, compareMode, showOfficial, showCitizen, isLive,
    });
    const key = geomKey + '||' + styleKey;
    if (inst.overlayKey === key && !inst._needsPaint) {
      if (isLive && compareMode === 'compare') {
        applyCompareClip(inst, inst.comparePct != null ? inst.comparePct : (inst.cfg.comparePct || 50));
      }
      return;
    }
    const styleOnly = inst._geomKey === geomKey && !inst._needsPaint && hasDrawnOverlay(inst);
    inst._geomKey = geomKey;
    inst.overlayKey = key;
    inst._needsPaint = false;
    if (styleOnly) {
      restyleDrawn(inst);
      // Geometry is unchanged (e.g. a year switch) but the winning party and so
      // the gap-fill colour may differ — repaint the void fill to match.
      if (inst._stateGapFill && lgaState && theme && theme.level === 'lga') {
        const lgaSource = inst.overlaySource && inst.overlaySource.lga;
        if (lgaSource) {
          const stateFc = await queryLocalAdmin('state', lgaState);
          if (inst.overlayKey !== key) return;
          if (stateFc && stateFc.features && stateFc.features.length) paintStateGapFill(inst, stateFc, lgaSource, theme);
        }
      } else if (!lgaState || !theme || theme.level !== 'lga') {
        clearStateGapFill(inst);
      }
      if (isLive && compareMode === 'compare') {
        applyCompareClip(inst, inst.comparePct != null ? inst.comparePct : (inst.cfg.comparePct || 50));
      } else if (isLive) clearCompareClip(inst);
      if (isLive) paintCitizenMarkers(inst);
      paintStateOutline(inst);
      return;
    }

    const officialPane = isLive && compareMode === 'compare' ? 'official' : 'grid3';
    const citizenPane = isLive && compareMode === 'compare' ? 'citizen' : 'grid3';
    const needState = !!(layers.state || (isLive && (showOfficial || showCitizen)));
    const needLga = !!(layers.lga && zoom >= 5 && !lgaStale);
    const needWard = !!(layers.ward && zoom >= 8);
    const needHealth = !!(layers.health && zoom >= 8);
    const needPolling = !!(layers.polling && zoom >= 9);

    const stateData = needState ? await loadLayer('state', bbox, preferLocalOnly) : null;
    if (inst.overlayKey !== key) return;

    let lgaData = null;
    if (needLga) {
      if (lgaState) {
        const stateWhere = "UPPER(statename)='" + escWhere(lgaState).toUpperCase() + "'";
        lgaData = await queryLocalAdmin('lga', lgaState);
        if (!lgaData || !lgaData.features || !lgaData.features.length) {
          lgaData = await queryAdmin('lga', stateWhere, 200);
        }
        if (lgaData && lgaData.features && lgaData.features.length) {
          lgaData = lgaCollectionForState(lgaData, lgaState);
        }
      } else {
        lgaData = await loadLayer('lga', bbox, preferLocalOnly);
      }
      if (inst.overlayKey !== key) return;
    }

    const wardData = needWard ? await loadLayer('ward', bbox, preferLocalOnly) : null;
    if (inst.overlayKey !== key) return;
    const healthData = needHealth ? await loadLayer('health', bbox, preferLocalOnly) : null;
    if (inst.overlayKey !== key) return;
    let pollingFc = null;
    if (needPolling) {
      const data = await loadJson('/api/polling-unit-points?bbox=' + encodeURIComponent(bbox));
      if (inst.overlayKey !== key) return;
      pollingFc = {
        type: 'FeatureCollection',
        features: (data?.points || []).slice(0, 800).map((p) => ({
          type: 'Feature',
          geometry: { type: 'Point', coordinates: [p.longitude, p.latitude] },
          properties: { name: p.pollingUnit, address: p.address || p.name, code: p.code, ward: p.ward, lga: p.lga, state: p.state },
        })),
      };
    }
    if (inst.overlayKey !== key) return;

    if (needState && stateData) {
      if (isLive) {
        if (compareMode === 'compare') {
          if (showOfficial) {
            paintOverlay(inst, 'official-state', stateData, false, {
              pane: officialPane,
              theme: (inst.cfg.resultTheme && inst.cfg.resultTheme.ok) ? inst.cfg.resultTheme : null,
              skipClick: true,
            });
          } else clearOverlay(inst, 'official-state');
          if (showCitizen) {
            paintOverlay(inst, 'citizen-state', stateData, false, {
              pane: citizenPane,
              theme: (inst.cfg.citizenTheme && inst.cfg.citizenTheme.ok) ? inst.cfg.citizenTheme : null,
              skipClick: true,
            });
          } else clearOverlay(inst, 'citizen-state');
          clearOverlay(inst, 'state');
          applyCompareClip(inst, inst.comparePct != null ? inst.comparePct : (inst.cfg.comparePct || 50));
        } else {
          if (showOfficial && inst.cfg.resultTheme && inst.cfg.resultTheme.ok) {
            paintOverlay(inst, 'official-state', stateData, false, { pane: 'grid3', theme: inst.cfg.resultTheme });
            clearOverlay(inst, 'state');
          } else if (layers.state) {
            paintOverlay(inst, 'state', stateData, false, { pane: 'grid3', theme: null });
            clearOverlay(inst, 'official-state');
          } else {
            clearOverlay(inst, 'state');
            clearOverlay(inst, 'official-state');
          }
          if (showCitizen && inst.cfg.citizenTheme && inst.cfg.citizenTheme.ok) {
            paintOverlay(inst, 'citizen-state', stateData, false, {
              pane: 'citizen',
              theme: inst.cfg.citizenTheme,
              skipClick: true,
            });
          } else clearOverlay(inst, 'citizen-state');
          clearCompareClip(inst);
        }
      } else if (layers.state) {
        paintOverlay(inst, 'state', stateData, false);
        clearOverlay(inst, 'official-state');
        clearOverlay(inst, 'citizen-state');
      }
    } else {
      clearOverlay(inst, 'state');
      clearOverlay(inst, 'official-state');
      clearOverlay(inst, 'citizen-state');
    }

    if (needLga && lgaState) {
      paintStateLga(inst, lgaState, lgaData, theme);
      // Back the LGA choropleth with a gap fill so interior voids (e.g. the
      // Lagos Lagoon) take the surrounding party colour instead of showing the
      // basemap through a hole in the state.
      if (theme && theme.level === 'lga' && lgaData && lgaData.features && lgaData.features.length) {
        let stateFc = await queryLocalAdmin('state', lgaState);
        if (inst.overlayKey !== key) return;
        if (stateFc && stateFc.features && stateFc.features.length) paintStateGapFill(inst, stateFc, lgaData, theme);
        else clearStateGapFill(inst);
      } else clearStateGapFill(inst);
    } else if (needLga) {
      paintOverlay(inst, 'lga', lgaData, false);
      clearStateGapFill(inst);
    } else {
      clearOverlay(inst, 'lga');
      clearStateGapFill(inst);
    }

    if (needWard) paintOverlay(inst, 'ward', wardData, false);
    else clearOverlay(inst, 'ward');

    if (needHealth) paintOverlay(inst, 'health', healthData, true);
    else clearOverlay(inst, 'health');

    if (needPolling) paintOverlay(inst, 'polling', pollingFc, true);
    else if (!inst.cfg.keepLocalPoints) clearOverlay(inst, 'polling');

    if (isLive) paintCitizenMarkers(inst);
    paintStateOutline(inst);
  }

  function applyCompareClip(inst, pct) {
    const p = Math.max(5, Math.min(95, Number(pct) || 50));
    inst.comparePct = p;
    const leftPane = inst.map.getPane('official');
    const rightPane = inst.map.getPane('citizen');
    if (leftPane) leftPane.style.clipPath = 'inset(0 ' + (100 - p) + '% 0 0)';
    if (rightPane) rightPane.style.clipPath = 'inset(0 0 0 ' + p + '%)';
    syncCompareHandle(inst);
  }

  function clearCompareClip(inst) {
    const leftPane = inst.map.getPane('official');
    const rightPane = inst.map.getPane('citizen');
    if (leftPane) leftPane.style.clipPath = '';
    if (rightPane) rightPane.style.clipPath = '';
    if (inst.compareUi) {
      inst.compareUi.style.display = 'none';
    }
  }

  function syncCompareHandle(inst) {
    if (!inst || !inst.compareUi) return;
    const cfg = inst.cfg || {};
    if (cfg.compareMode !== 'compare') {
      inst.compareUi.style.display = 'none';
      return;
    }
    inst.compareUi.style.display = 'block';
    const p = inst.comparePct != null ? inst.comparePct : 50;
    const handle = inst.compareUi.querySelector('.eid-compare-handle');
    if (handle) handle.style.left = p + '%';
    const leftCap = inst.compareUi.querySelector('.eid-compare-cap-left');
    const rightCap = inst.compareUi.querySelector('.eid-compare-cap-right');
    if (leftCap) {
      leftCap.textContent = (cfg.resultTheme && cfg.resultTheme.ok) ? 'Official' : 'Official (awaiting)';
    }
    if (rightCap) rightCap.textContent = 'Public';
  }

  function ensureCompareUi(inst, el) {
    if (inst.compareUi) return inst.compareUi;
    const wrap = document.createElement('div');
    wrap.className = 'eid-compare-ui';
    wrap.style.cssText = 'position:absolute;inset:0;z-index:650;pointer-events:none;display:none';
    wrap.innerHTML =
      '<div class="eid-compare-cap-left" style="position:absolute;top:10px;left:10px;pointer-events:none;font:600 10px/1 IBM Plex Sans,sans-serif;letter-spacing:.08em;text-transform:uppercase;color:#fff;background:rgba(22,27,34,.72);padding:5px 8px;border-radius:6px">Official</div>' +
      '<div class="eid-compare-cap-right" style="position:absolute;top:10px;right:10px;pointer-events:none;font:600 10px/1 IBM Plex Sans,sans-serif;letter-spacing:.08em;text-transform:uppercase;color:#fff;background:rgba(22,27,34,.72);padding:5px 8px;border-radius:6px">Public</div>' +
      '<div class="eid-compare-handle" style="position:absolute;top:0;bottom:0;width:28px;margin-left:-14px;left:50%;pointer-events:auto;cursor:ew-resize">' +
      '<div style="position:absolute;left:50%;top:0;bottom:0;width:2px;margin-left:-1px;background:rgba(255,255,255,.92);box-shadow:0 0 0 1px rgba(0,0,0,.25)"></div>' +
      '<div style="position:absolute;left:50%;top:50%;width:28px;height:28px;margin:-14px 0 0 -14px;border-radius:50%;background:#1c8f86;border:2px solid #fff;box-shadow:0 2px 8px rgba(0,0,0,.35);display:grid;place-items:center;color:#fff;font-size:14px;line-height:1">⇔</div>' +
      '</div>';
    const host = el.parentElement || el;
    if (getComputedStyle(host).position === 'static') host.style.position = 'relative';
    host.appendChild(wrap);
    const handle = wrap.querySelector('.eid-compare-handle');
    let dragging = false;
    const setFromClientX = (clientX) => {
      const rect = host.getBoundingClientRect();
      if (!rect.width) return;
      const pct = ((clientX - rect.left) / rect.width) * 100;
      applyCompareClip(inst, pct);
      if (typeof inst.cfg.onComparePct === 'function') inst.cfg.onComparePct(inst.comparePct);
    };
    const onMove = (e) => {
      if (!dragging) return;
      const clientX = e.touches ? e.touches[0].clientX : e.clientX;
      setFromClientX(clientX);
      e.preventDefault();
    };
    const onUp = () => {
      dragging = false;
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      document.removeEventListener('touchmove', onMove);
      document.removeEventListener('touchend', onUp);
    };
    handle.addEventListener('mousedown', (e) => {
      dragging = true;
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
      e.preventDefault();
      e.stopPropagation();
    });
    handle.addEventListener('touchstart', (e) => {
      dragging = true;
      document.addEventListener('touchmove', onMove, { passive: false });
      document.addEventListener('touchend', onUp);
      e.preventDefault();
      e.stopPropagation();
    }, { passive: false });
    inst.compareUi = wrap;
    return wrap;
  }

  function paintCitizenMarkers(inst) {
    if (!inst.citizenMarkers) {
      inst.citizenMarkers = global.L.layerGroup();
      inst.citizenMarkers.addTo(inst.map);
    }
    inst.citizenMarkers.clearLayers();
    const cfg = inst.cfg || {};
    if (!cfg.live || cfg.showCitizen === false) return;
    const paneName = 'citizen';
    const list = cfg.citizenMarkers || [];
    list.forEach((m) => {
      if (m.lat == null || m.lng == null) return;
      const approved = /approved/i.test(String(m.status || ''));
      const color = approved ? '#2f9150' : '#d69a34';
      const marker = global.L.circleMarker([Number(m.lat), Number(m.lng)], {
        pane: paneName,
        radius: approved ? 8 : 7,
        color: '#ffffff',
        weight: 2,
        fillColor: color,
        fillOpacity: 0.95,
        interactive: true,
      });
      const tip = [m.pu || 'Citizen return', m.state, m.status].filter(Boolean).join(' · ');
      marker.bindTooltip(tip, { direction: 'top' });
      marker.bindPopup(
        '<strong>' + String(m.pu || 'Citizen return').replace(/</g, '&lt;') + '</strong><br>' +
        String([m.state, m.lga, m.ward].filter(Boolean).join(' · ')).replace(/</g, '&lt;') +
        '<br>' + String(m.status || '').replace(/</g, '&lt;')
      );
      inst.citizenMarkers.addLayer(marker);
    });
    if (cfg.compareMode === 'compare') applyCompareClip(inst, inst.comparePct != null ? inst.comparePct : (cfg.comparePct || 50));
  }

  function adminViewKey(admin) {
    if (!admin || !admin.state) return null;
    return "admin:" + [admin.state, admin.lga || "", admin.ward || ""].join("|");
  }

  function beginNav(inst) {
    if (!inst) return 0;
    inst.navToken = (inst.navToken || 0) + 1;
    try {
      if (inst.map && typeof inst.map.stop === 'function') inst.map.stop();
    } catch (_) {
      /* ignore */
    }
    return inst.navToken;
  }

  function isNavCurrent(inst, token) {
    return !!(inst && token && inst.navToken === token);
  }

  function goToPoint(inst, lat, lng, zoom) {
    if (!inst || !inst.map) return;
    const z = zoom || 16;
    beginNav(inst);
    // setView is reliable; flyTo was getting cancelled by late async admin flies.
    inst.map.setView([Number(lat), Number(lng)], z, { animate: true, duration: 0.6 });
  }

  function goToBounds(inst, bounds, opts) {
    if (!inst || !inst.map || !bounds) return;
    // Caller should already hold the current nav token; stop any leftover pan only.
    try {
      if (typeof inst.map.stop === 'function') inst.map.stop();
    } catch (_) {
      /* ignore */
    }
    const o = Object.assign({ padding: [28, 28], maxZoom: 14, animate: true }, opts || {});
    inst.map.fitBounds(bounds, o);
  }

  function stateBoundsKey(name) {
    return normalizeAdminKey(canonicalAdminState(name));
  }

  function maybeIndexStateBounds(url, data) {
    const path = String(url || '').split('?')[0];
    if (!path.endsWith('/api/boundaries/state')) return;
    indexStateBounds(data);
  }

  function indexStateBounds(data) {
    if (!data || !data.features || data._eidStateBounds) return;
    data._eidStateBounds = true;
    data.features.forEach((feat) => {
      const name = pickProp(feat.properties, ['statename', 'state']);
      if (!name) return;
      const pair = boundsFromFeatures([feat]);
      if (!pair) return;
      stateBoundsSync.set(stateBoundsKey(name), global.L.latLngBounds(pair[0], pair[1]));
    });
  }

  function asLatLngBounds(bounds) {
    if (!bounds) return null;
    if (typeof bounds.getSouthWest === 'function') return bounds;
    try { return global.L.latLngBounds(bounds[0], bounds[1]); } catch (_) { return null; }
  }

  function boundsForState(inst, stateName) {
    const key = stateBoundsKey(stateName);
    if (!key) return null;
    if (stateBoundsSync.has(key)) return stateBoundsSync.get(key);
    const group = inst && inst.overlays && inst.overlays.state;
    if (!group || typeof group.eachLayer !== 'function') return null;
    let found = null;
    group.eachLayer((layer) => {
      if (found) return;
      const props = layer.feature && layer.feature.properties;
      const name = pickProp(props, ['statename', 'state']);
      if (!name || stateBoundsKey(name) !== key) return;
      if (typeof layer.getBounds === 'function') found = layer.getBounds();
    });
    if (found) stateBoundsSync.set(key, found);
    return found;
  }

  function dropGovBlur(el) {
    let node = el;
    while (node) {
      if (node.classList && node.classList.contains('is-gov-blur')) node.classList.remove('is-gov-blur');
      node = node.parentElement;
    }
  }

  function parkLgaIfOtherState(inst, stateName) {
    const key = stateBoundsKey(stateName);
    if (!inst || !inst._lgaDrawnKey || inst._lgaDrawnKey === key) return;
    const group = inst.overlays && inst.overlays.lga;
    inst._lgaLayers = inst._lgaLayers || new Map();
    if (group) {
      inst._lgaLayers.set(inst._lgaDrawnKey, group);
      if (inst.map && inst.map.hasLayer(group)) inst.map.removeLayer(group);
    }
    if (inst.overlays) inst.overlays.lga = null;
    if (inst.overlaySource) inst.overlaySource.lga = null;
    inst._lgaDrawnKey = null;
    inst.overlayKey = null;
    inst._geomKey = null;
  }

  // Outer rings of a polygon/multipolygon geometry.
  function outerRingsOf(geom) {
    const rings = [];
    if (!geom) return rings;
    if (geom.type === 'Polygon') {
      if (geom.coordinates && geom.coordinates[0] && geom.coordinates[0].length) rings.push(geom.coordinates[0]);
    } else if (geom.type === 'MultiPolygon') {
      (geom.coordinates || []).forEach((poly) => {
        if (poly && poly[0] && poly[0].length) rings.push(poly[0]);
      });
    }
    return rings;
  }

  // Colour that covers the most LGAs in the theme — used to fill interior voids
  // (lagoons, inter-LGA gaps) with the party that surrounds them.
  function dominantUnitColor(theme) {
    if (!theme || !theme.units) return null;
    const tally = {};
    Object.keys(theme.units).forEach((k) => {
      const u = theme.units[k];
      if (u && u.color) tally[u.color] = (tally[u.color] || 0) + 1;
    });
    let best = null;
    let max = -1;
    Object.keys(tally).forEach((c) => { if (tally[c] > max) { max = tally[c]; best = c; } });
    return best;
  }

  function clearStateGapFill(inst) {
    if (inst && inst._stateGapFill) {
      try { inst.map.removeLayer(inst._stateGapFill); } catch (e) { /* noop */ }
      inst._stateGapFill = null;
    }
  }

  // Fill the voids inside a state that no LGA polygon covers — chiefly open
  // water such as the Lagos Lagoon — so the state reads as one solid body.
  // One multi-ring polygon (state outline + every LGA ring) drawn with the
  // even-odd fill rule fills only the gaps: a point inside the state but inside
  // no LGA is covered by an odd number of rings, while a point inside an LGA is
  // covered by an even number and stays clear, so the LGA colours are untouched.
  function paintStateGapFill(inst, stateFc, lgaData, theme) {
    clearStateGapFill(inst);
    if (!inst || !inst.map) return;
    if (!theme || theme.level !== 'lga') return;
    if (!stateFc || !stateFc.features || !stateFc.features.length) return;
    if (!lgaData || !lgaData.features || !lgaData.features.length) return;
    const rings = [];
    stateFc.features.forEach((f) => outerRingsOf(f.geometry).forEach((r) => rings.push(r)));
    if (!rings.length) return;
    lgaData.features.forEach((f) => outerRingsOf(f.geometry).forEach((r) => rings.push(r)));
    const feature = {
      type: 'Feature',
      properties: {},
      geometry: { type: 'MultiPolygon', coordinates: rings.map((r) => [r]) },
    };
    const color = dominantUnitColor(theme) || '#94a3b8';
    const layer = global.L.geoJSON(feature, {
      pane: 'stateFill',
      interactive: false,
      style: { stroke: false, weight: 0, fill: true, fillColor: color, fillOpacity: 0.72, fillRule: 'evenodd' },
    });
    layer.addTo(inst.map);
    inst._stateGapFill = layer;
  }

  function paintStateLga(inst, stateName, data, theme) {
    if (!data || !data.features || !data.features.length) {
      clearOverlay(inst, 'lga');
      inst._lgaDrawnKey = null;
      return;
    }
    const key = stateBoundsKey(stateName);
    const sig = themeSig(theme);
    inst._lgaLayers = inst._lgaLayers || new Map();
    const cached = inst._lgaLayers.get(key);
    if (cached && cached._eidData === data) {
      const current = inst.overlays && inst.overlays.lga;
      if (current && current !== cached && inst.map.hasLayer(current)) inst.map.removeLayer(current);
      if (!inst.map.hasLayer(cached)) cached.addTo(inst.map);
      inst.overlays.lga = cached;
      inst.overlaySource = inst.overlaySource || {};
      inst.overlaySource.lga = data;
      inst._lgaDrawnKey = key;
      if (cached._eidStyle !== sig) {
        restyleOverlay(inst, 'lga', theme);
        cached._eidStyle = sig;
      }
      inst.overlayStyleSig = inst.overlayStyleSig || {};
      inst.overlayStyleSig.lga = sig;
      return;
    }
    paintOverlay(inst, 'lga', data, false, { theme });
    const layer = inst.overlays && inst.overlays.lga;
    if (layer) {
      layer._eidData = data;
      layer._eidStyle = sig;
      inst._lgaLayers.set(key, layer);
      inst._lgaDrawnKey = key;
    }
  }

  function frameBounds(inst, bounds, opts) {
    const box = asLatLngBounds(bounds);
    if (!inst || !inst.map || !box || !box.isValid()) return;
    const o = Object.assign({ padding: [36, 36], maxZoom: 9, duration: 0.32 }, opts || {});
    let center = null;
    let zoom = null;
    try {
      if (typeof inst.map._getBoundsCenterZoom === 'function') {
        const target = inst.map._getBoundsCenterZoom(box, { padding: o.padding, maxZoom: o.maxZoom });
        center = target.center;
        zoom = target.zoom;
      }
    } catch (_) {
      center = null;
    }
    if (center && zoom != null && typeof inst.map.flyTo === 'function') {
      const sameFlight = inst._flyTargetKey && inst._flyTargetKey === inst._frameReq && inst.map._flyToFrame;
      if (sameFlight) return;
      const here = inst.map.getCenter();
      const close = here && typeof here.distanceTo === 'function'
        && here.distanceTo(center) < 1200
        && Math.abs(inst.map.getZoom() - zoom) < 0.35;
      if (close) return;
      beginNav(inst);
      inst._flyTargetKey = inst._frameReq || null;
      inst.map.flyTo(center, zoom, { duration: o.duration, easeLinearity: 0.25 });
      return;
    }
    beginNav(inst);
    inst.map.fitBounds(box, { padding: o.padding, maxZoom: o.maxZoom, animate: false });
  }

  function prefetchStateLga(stateName) {
    if (!stateName) return;
    queryLocalAdmin('lga', stateName, null, null);
  }

  function flyToNamedState(el, stateName) {
    const inst = ensure(el);
    if (!inst || !stateName) return false;
    dropGovBlur(el);
    const key = stateBoundsKey(stateName);
    inst._frameReq = key;
    inst._framedState = key;
    parkLgaIfOtherState(inst, stateName);
    prefetchStateLga(stateName);
    const bounds = boundsForState(inst, stateName);
    if (bounds) {
      frameBounds(inst, bounds, { padding: [36, 36], maxZoom: 9, duration: 0.32 });
      return true;
    }
    const pending = jsonCache.get(LOCAL_BOUNDARIES.state);
    const apply = () => {
      if (!inst.map || inst._frameReq !== key) return;
      const next = boundsForState(inst, stateName);
      if (next) frameBounds(inst, next, { padding: [36, 36], maxZoom: 9, duration: 0.32 });
    };
    if (pending && typeof pending.then === 'function') pending.then(apply);
    else loadJson(LOCAL_BOUNDARIES.state).then(apply);
    return false;
  }

  function attach(el, cfg) {
    const inst = ensure(el);
    if (!inst) return;
    inst.cfg = cfg || {};
    if (cfg.comparePct != null) inst.comparePct = Number(cfg.comparePct);
    if (!inst.map.getPane('official')) {
      inst.map.createPane('official');
      inst.map.getPane('official').style.zIndex = 455;
    }
    if (!inst.map.getPane('citizen')) {
      inst.map.createPane('citizen');
      inst.map.getPane('citizen').style.zIndex = 460;
    }
    if (!inst.citizenMarkers) {
      inst.citizenMarkers = global.L.layerGroup().addTo(inst.map);
    }
    const view = GEO[cfg.scope] || GEO.global;
    const studioCenter = Array.isArray(cfg.center) && cfg.center.length >= 2
      ? [Number(cfg.center[0]), Number(cfg.center[1])]
      : null;
    const defaultCenter = (studioCenter && studioCenter.every(Number.isFinite)) ? studioCenter : view.center;
    const defaultZoom = Number.isFinite(Number(cfg.zoom)) ? Number(cfg.zoom) : view.zoom;
    setBasemap(el, cfg.basemap || "streets");
    const user = cfg.user && cfg.user.lat != null ? cfg.user : null;
    const focus = cfg.focus && cfg.focus.lat != null ? cfg.focus : null;
    const admin = cfg.adminFocus && cfg.adminFocus.state ? cfg.adminFocus : null;
    const viewKey = focus
      ? "focus:" + Number(focus.lat).toFixed(5) + "," + Number(focus.lng).toFixed(5)
      : admin
        ? adminViewKey(admin)
        : user
          ? "user:" + user.lat.toFixed(4) + "," + user.lng.toFixed(4)
          : (cfg.scope || "global") + ":" + defaultZoom + ":" + defaultCenter.join(",");
    if (inst.viewKey !== viewKey) {
      inst.viewKey = viewKey;
      if (focus) goToPoint(inst, focus.lat, focus.lng, cfg.focusZoom || 16);
      else if (admin && !cfg.skipAdminFly) {
        // Re-fly after DOM remounts so LGA/ward drill is not lost on re-render.
        flyToAdmin(el, Object.assign({}, admin, { preserveLayers: true, skipViewKey: true }));
      } else if (!admin && user) {
        beginNav(inst);
        inst.map.setView([user.lat, user.lng], 13);
      } else if (!admin && !focus) {
        beginNav(inst);
        inst.map.setView(defaultCenter, defaultZoom);
      }
    }
    const markerSig = [
      user ? user.lat.toFixed(5) + ',' + user.lng.toFixed(5) : '',
      (cfg.markers || []).map((m) => (m.code || '') + (m.live ? '!' : '')).join(','),
      (cfg.points || []).slice(0, 800).map((p) => (p.code || p.name || '') + '@' + p.lat + ',' + p.lng).join(';'),
      focus ? Number(focus.lat).toFixed(5) + ',' + Number(focus.lng).toFixed(5) + ',' + (focus.name || '') : '',
      cfg.route ? String(cfg.route.key || (cfg.route.coords && cfg.route.coords.length) || '') : '',
    ].join('|');
    if (inst.markerSig !== markerSig) {
      inst.markerSig = markerSig;
      inst.markers.clearLayers();
      inst.points.clearLayers();

      if (user) {
        inst.markers.addLayer(
          global.L.circleMarker([user.lat, user.lng], {
            radius: 8,
            color: "#ffffff",
            weight: 2,
            fillColor: "#cf3f36",
            fillOpacity: 1,
          }).bindTooltip("You are here")
        );
      }

      (cfg.markers || []).forEach((m) => {
        const ll = MARKER_LL[m.code];
        if (!ll) return;
        const marker = global.L.circleMarker(ll, {
          radius: m.live ? 8 : 6,
          color: "#ffffff",
          weight: 2,
          fillColor: m.live ? "#e0564f" : "#1c8f86",
          fillOpacity: 0.95,
        });
        marker.bindTooltip(m.title || m.label, { direction: "top" });
        if (typeof m.onClick === "function") marker.on("click", m.onClick);
        inst.markers.addLayer(marker);
      });

      (cfg.points || []).slice(0, 800).forEach((p) => {
        if (p.lat == null || p.lng == null) return;
        const tip = [p.code, p.address || p.name, p.place].filter(Boolean).join(" · ");
        const marker = global.L.marker([p.lat, p.lng], {
          icon: pollingUnitIcon(),
          keyboard: false,
        }).bindPopup("<strong>" + String(p.name || "Polling unit").replace(/</g, "&lt;") + "</strong><br>" + String(tip).replace(/</g, "&lt;"));
        if (typeof p.onClick === "function") marker.on("click", p.onClick);
        inst.points.addLayer(marker);
      });

      paintFocus(inst, focus);
      paintRoute(inst, cfg.route);
    }

    if (cfg.live) {
      ensureCompareUi(inst, el);
      if (cfg.compareMode === 'compare') {
        applyCompareClip(inst, inst.comparePct != null ? inst.comparePct : (cfg.comparePct || 50));
      } else {
        clearCompareClip(inst);
      }
    } else if (inst.compareUi) {
      inst.compareUi.style.display = 'none';
    }

    refreshOverlays(el);
    requestAnimationFrame(() => {
      if (inst.map) inst.map.invalidateSize({ animate: false });
    });
  }

  function paintFocus(inst, focus) {
    if (inst.focusMarker) {
      inst.map.removeLayer(inst.focusMarker);
      inst.focusMarker = null;
    }
    if (inst.focusHalo) {
      inst.map.removeLayer(inst.focusHalo);
      inst.focusHalo = null;
    }
    if (!focus || focus.lat == null || focus.lng == null) return;
    const title = String(focus.name || "Polling unit").replace(/</g, "&lt;");
    const addr = String(focus.address || "").replace(/</g, "&lt;");
    const place = [focus.ward, focus.lga, focus.state].filter(Boolean).join(" · ").replace(/</g, "&lt;");
    const html = "<strong>" + title + "</strong>" + (addr ? "<br>" + addr : "") + (place ? "<br>" + place : "");
    inst.focusHalo = global.L.circleMarker([Number(focus.lat), Number(focus.lng)], {
      radius: 18,
      color: "#cf3f36",
      weight: 3,
      opacity: 0.9,
      fillColor: "#cf3f36",
      fillOpacity: 0.18,
      interactive: false,
    }).addTo(inst.map);
    inst.focusMarker = global.L.marker([Number(focus.lat), Number(focus.lng)], {
      icon: pollingUnitIcon({ focus: true }),
      zIndexOffset: 800,
      keyboard: false,
    })
      .bindPopup(html)
      .addTo(inst.map);
    inst.focusMarker.openPopup();
  }

  function focusPoint(el, lat, lng, zoom, name) {
    const inst = ensure(el);
    if (!inst || lat == null || lng == null) return;
    const focus = { lat: Number(lat), lng: Number(lng), name: name || "Polling unit" };
    inst.cfg = inst.cfg || {};
    inst.cfg.focus = focus;
    inst.viewKey = "focus:" + focus.lat.toFixed(5) + "," + focus.lng.toFixed(5);
    paintFocus(inst, focus);
    goToPoint(inst, focus.lat, focus.lng, zoom || 16);
  }

  function resetView(el, scope) {
    const inst = store.get(el);
    if (!inst) return;
    if (inst.cfg) inst.cfg.focus = null;
    inst.viewKey = null;
    paintFocus(inst, null);
    const view = GEO[scope] || GEO.ng || GEO.global;
    beginNav(inst);
    inst.map.setView(view.center, view.zoom, { animate: true });
  }

  function zoomIn(el) {
    const inst = store.get(el);
    if (inst) inst.map.zoomIn();
  }

  function zoomOut(el) {
    const inst = store.get(el);
    if (inst) inst.map.zoomOut();
  }

  function escWhere(val) {
    return String(val || "").replace(/'/g, "''");
  }

  function boundsFromFeatures(features) {
    const list = Array.isArray(features)
      ? features
      : (features && Array.isArray(features.features) ? features.features : []);
    let minLat = 90;
    let maxLat = -90;
    let minLng = 180;
    let maxLng = -180;
    function walk(coords) {
      if (!coords || !coords.length) return;
      if (typeof coords[0] === "number") {
        const lng = coords[0];
        const lat = coords[1];
        if (lat < minLat) minLat = lat;
        if (lat > maxLat) maxLat = lat;
        if (lng < minLng) minLng = lng;
        if (lng > maxLng) maxLng = lng;
        return;
      }
      coords.forEach(walk);
    }
    list.forEach((feat) => {
      if (feat && feat.geometry && feat.geometry.coordinates) walk(feat.geometry.coordinates);
    });
    if (minLat > maxLat) return null;
    return [[minLat, minLng], [maxLat, maxLng]];
  }

  async function queryAdmin(layerId, where, recordCount) {
    const base = GRID3_DIRECT[layerId];
    if (!base || !where) return null;
    const params = new URLSearchParams({
      f: "geojson",
      where,
      outFields: "*",
      outSR: "4326",
      returnGeometry: "true",
      resultRecordCount: String(recordCount || 8),
    });
    return loadJson(base.replace(/\/$/, "") + "/query?" + params.toString());
  }

  async function boundsFromPollingUnits(state, lga, ward) {
    const qs = new URLSearchParams();
    if (state) qs.set('state', state);
    if (lga) qs.set('lga', lga);
    if (ward) qs.set('ward', ward);
    const data = await loadJson('/api/polling-unit-points?' + qs.toString());
    const pts = (data && data.points) || [];
    const coords = pts
      .filter((p) => p.latitude != null && p.longitude != null)
      .map((p) => ({ geometry: { type: 'Point', coordinates: [Number(p.longitude), Number(p.latitude)] } }));
    return boundsFromFeatures(coords);
  }

  function applyAdminLayers(inst, opts, state, lga, ward) {
    if (opts && opts.preserveLayers) return;
    inst.cfg = inst.cfg || {};
    inst.cfg.layers = Object.assign({}, inst.cfg.layers || {}, {
      state: true,
      lga: true,
      ward: !!(lga || ward),
      polling: !!(lga || ward),
    });
  }

  async function resolveAdminFeatures(layerId, state, lga, ward, recordCount) {
    const scope = { state, lga: layerId === 'state' ? null : lga };
    let data = await queryLocalAdmin(layerId, state, lga, layerId === 'ward' ? ward : null);
    if (!data || !data.features || !data.features.length) {
      const where = buildAdminWhere(state, layerId === 'state' ? null : lga, layerId === 'ward' ? ward : null);
      data = await queryAdmin(layerId, where, recordCount || (layerId === 'ward' ? 200 : 50));
    }
    if (!data || !data.features || !data.features.length) {
      // Broader ArcGIS pull for the state (+ LGA aliases), then match locally.
      const where = buildAdminWhere(state, layerId === 'state' ? null : lga, null);
      data = await queryAdmin(layerId, where, recordCount || (layerId === 'ward' ? 500 : 80));
    }
    const field = layerId === 'state' ? 'statename' : layerId === 'lga' ? 'lganame' : 'wardname';
    const target = layerId === 'state' ? state : layerId === 'lga' ? lga : ward;
    const matched = pickAdminFeatures(data, field, target, scope);
    if (matched.length) return matched;
    // If we asked for a ward and only LGA scope matched, keep LGA-scoped wards empty
    // rather than leaking other states.
    if (layerId === 'ward' && ward) return [];
    return pickAdminFeatures(data, field, null, scope);
  }

  async function flyToAdmin(el, opts) {
    const inst = ensure(el);
    if (!inst || !opts) return;
    const state = opts.state;
    const lga = opts.lga;
    const ward = opts.ward;
    if (!state) return;

    const viewKey = adminViewKey({ state, lga, ward });
    if (opts.force) inst.viewKey = null;
    if (!opts.skipViewKey) inst.viewKey = viewKey;

    applyAdminLayers(inst, opts, state, lga, ward);
    const token = beginNav(inst);

    if (ward && lga) {
      const matched = await resolveAdminFeatures('ward', state, lga, ward, 200);
      if (!isNavCurrent(inst, token)) return;
      let bounds = boundsFromFeatures(matched);
      if (!bounds) bounds = await boundsFromPollingUnits(state, lga, ward);
      if (!isNavCurrent(inst, token)) return;
      // Never search wards by name alone — fall back to the parent LGA in this state.
      if (!bounds) {
        const lgaFeats = await resolveAdminFeatures('lga', state, lga, null, 40);
        if (!isNavCurrent(inst, token)) return;
        bounds = boundsFromFeatures(lgaFeats) || (await boundsFromPollingUnits(state, lga, null));
        if (!isNavCurrent(inst, token)) return;
      }
      if (bounds) {
        goToBounds(inst, bounds, { maxZoom: 14 });
        refreshOverlays(el);
        return;
      }
    } else if (lga) {
      const matched = await resolveAdminFeatures('lga', state, lga, null, 40);
      if (!isNavCurrent(inst, token)) return;
      let bounds = boundsFromFeatures(matched) || (await boundsFromPollingUnits(state, lga, null));
      if (!isNavCurrent(inst, token)) return;
      if (bounds) {
        goToBounds(inst, bounds, { maxZoom: 12 });
        refreshOverlays(el);
        return;
      }
    }

    const stateFeats = await resolveAdminFeatures('state', state, null, null, 8);
    if (!isNavCurrent(inst, token)) return;
    let bounds = boundsFromFeatures(stateFeats);
    if (!bounds && (lga || ward)) bounds = await boundsFromPollingUnits(state, lga, ward);
    if (!isNavCurrent(inst, token)) return;
    if (bounds) {
      goToBounds(inst, bounds, { maxZoom: lga ? 10 : 8 });
      refreshOverlays(el);
      return;
    }

    const fallback = GEO.ng || GEO.global;
    beginNav(inst);
    inst.map.setView(fallback.center, 8, { animate: true });
    refreshOverlays(el);
  }

  async function flyToResultScope(el, theme) {
    const inst = ensure(el);
    if (!inst || !theme) return;
    inst.cfg = inst.cfg || {};
    inst.cfg.resultTheme = theme;
    inst.cfg.layers = Object.assign({}, inst.cfg.layers || {}, {
      state: true,
      lga: theme.level === 'lga',
      ward: false,
      polling: false,
      health: false,
    });

    const stateName = theme.state || null;
    if (stateName && (theme.level === 'lga' || theme.level === 'state')) {
      const key = stateBoundsKey(stateName);
      if (theme.level === 'lga') prefetchStateLga(stateName);
      if (inst._framedState === key && boundsForState(inst, stateName)) {
        refreshOverlays(el);
        return;
      }
      dropGovBlur(el);
      parkLgaIfOtherState(inst, stateName);
      let bounds = boundsForState(inst, stateName);
      if (!bounds) {
        const stateFeats = await queryLocalAdmin('state', stateName, null, null);
        if (inst._frameReq && inst._frameReq !== key) return;
        const pair = boundsFromFeatures(stateFeats);
        if (pair) {
          bounds = global.L.latLngBounds(pair[0], pair[1]);
          stateBoundsSync.set(key, bounds);
        } else {
          const all = await loadJson(LOCAL_BOUNDARIES.state);
          if (inst._frameReq && inst._frameReq !== key) return;
          indexStateBounds(all);
          bounds = boundsForState(inst, stateName);
        }
      }
      if (bounds) {
        inst._frameReq = key;
        inst._framedState = key;
        frameBounds(inst, bounds, {
          padding: [36, 36],
          maxZoom: theme.level === 'lga' ? 9 : 8,
          duration: 0.32,
        });
        refreshOverlays(el);
        return;
      }
      await flyToAdmin(el, { state: stateName, preserveLayers: true });
      return;
    }

    inst._framedState = null;
    inst._frameReq = null;
    const view = GEO.ng || GEO.global;
    beginNav(inst);
    if (typeof inst.map.flyTo === 'function') {
      inst.map.flyTo(view.center, view.zoom, { duration: 0.35, easeLinearity: 0.25 });
    } else {
      inst.map.setView(view.center, view.zoom, { animate: false });
    }
    refreshOverlays(el);
  }

  global.EIDMaps = {
    attach,
    setBasemap,
    zoomIn,
    zoomOut,
    focusPoint,
    resetView,
    flyToAdmin,
    flyToResultScope,
    flyToNamedState,
    prefetchStateLga,
    dropGovBlur,
    GEO,
    BASEMAPS: Object.keys(TILES),
    LAYER_IDS: ["state", "lga", "ward", "polling", "health"],
  };
})(window);
