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
    });
    map.createPane("grid3");
    map.getPane("grid3").style.zIndex = 450;
    inst = {
      map,
      tile: null,
      markers: global.L.layerGroup().addTo(map),
      route: global.L.layerGroup().addTo(map),
      points: global.L.layerGroup().addTo(map),
      overlays: {},
      cfg: {},
    };
    store.set(el, inst);
    if (typeof ResizeObserver !== "undefined") {
      const ro = new ResizeObserver(() => {
        const w = el.clientWidth, h = el.clientHeight;
        map.invalidateSize();
        if (inst.lastW !== w || inst.lastH !== h) {
          inst.lastW = w;
          inst.lastH = h;
          inst.overlayKey = null;
          refreshOverlays(el);
        }
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
    if (inst.tile) inst.map.removeLayer(inst.tile);
    inst.tile = global.L.tileLayer(spec.url, spec.options).addTo(inst.map);
    inst.basemap = key;
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

  function styleForFeature(layerId, props, cfg) {
    const theme = cfg && cfg.resultTheme;
    const base = STYLES[layerId] || STYLES.state;
    if (!theme || !theme.units) return base;
    const hitKey = resultKey(layerId, props, theme);
    const hit = resolveResultUnit(theme, layerId, props);
    if (hit && hit.color) {
      return {
        color: '#ffffff',
        weight: layerId === 'state' ? 1.4 : 1.1,
        fillColor: hit.color,
        fillOpacity: theme.level === layerId ? 0.78 : 0,
        opacity: 0.95,
      };
    }
    if (theme.level === layerId) {
      return { ...base, fillOpacity: 0.06, fillColor: '#94a3b8' };
    }
    return base;
  }

  function popupForFeature(layerId, props, cfg) {
    const label = featureLabel(layerId, props);
    const theme = cfg && cfg.resultTheme;
    const hit = theme && theme.units ? resolveResultUnit(theme, layerId, props) : null;
    if (!hit) return '<strong>' + label.replace(/</g, '&lt;') + '</strong>';
    const share = hit.share != null ? `<br>${Number(hit.share).toFixed(1)}%` : '';
    return [
      '<strong>' + label.replace(/</g, '&lt;') + '</strong>',
      hit.winner ? hit.winner.replace(/</g, '&lt;') + ' · ' + hit.party : hit.party,
      share,
    ].filter(Boolean).join('<br>');
  }

  function putGeoJson(inst, id, data, isPoint) {
    clearOverlay(inst, id);
    if (!data || !data.features || !data.features.length) return;
    const cfg = inst.cfg || {};
    inst.overlays[id] = global.L.geoJSON(data, {
      pane: 'grid3',
      style: (feat) => styleForFeature(id, feat.properties, cfg),
      pointToLayer: isPoint
        ? (feat, latlng) => {
            if (id === 'polling') {
              return global.L.marker(latlng, {
                pane: 'grid3',
                icon: pollingUnitIcon(),
                keyboard: false,
              });
            }
            return global.L.circleMarker(latlng, {
              pane: 'grid3',
              radius: 5,
              color: '#ffffff',
              weight: 1,
              fillColor: '#be123c',
              fillOpacity: 0.9,
            });
          }
        : undefined,
      onEachFeature: (feat, layer) => {
        const label = featureLabel(id, feat.properties);
        if (label) {
          layer.bindTooltip(label, { sticky: true, direction: 'top' });
          layer.bindPopup(popupForFeature(id, feat.properties, cfg));
        }
        const theme = cfg && cfg.resultTheme;
        if (theme && theme.units && cfg.onResultUnitClick) {
          layer.on('click', () => {
            const hit = resolveResultUnit(theme, id, feat.properties);
            const hitKey = (hit && hit._canonicalKey) || resultKey(id, feat.properties, theme);
            if (hitKey && hit) cfg.onResultUnitClick(hitKey, hit, id);
          });
        }
      },
    }).addTo(inst.map);
  }

  function bboxOf(map) {
    const b = map.getBounds();
    return [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()].map((n) => n.toFixed(4)).join(",");
  }

  async function loadJson(url) {
    try {
      const res = await fetch(url);
      if (!res.ok) return null;
      const data = await res.json();
      if (data && data.error) return null;
      return data;
    } catch (e) {
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

  async function loadLayer(layerId, bbox) {
    if (LOCAL_BOUNDARIES[layerId]) {
      const local = await loadJson(LOCAL_BOUNDARIES[layerId] + "?bbox=" + encodeURIComponent(bbox));
      if (local && local.features && local.features.length) return local;
    }
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

  async function refreshOverlays(el) {
    const inst = store.get(el);
    if (!inst || !inst.map) return;
    if (el.clientWidth < 40 || el.clientHeight < 40) {
      inst.overlayKey = null;
      return;
    }
    const layers = inst.cfg.layers || {};
    const zoom = inst.map.getZoom();
    const bbox = bboxOf(inst.map);
    const themeKey = inst.cfg.resultTheme && inst.cfg.resultTheme.key ? inst.cfg.resultTheme.key : '';
    const key = JSON.stringify({ layers, zoom: Math.floor(zoom), bbox, themeKey });
    if (inst.overlayKey === key) return;
    inst.overlayKey = key;

    if (layers.state) {
      const data = await loadLayer("state", bbox);
      if (inst.overlayKey === key) putGeoJson(inst, "state", data);
    } else clearOverlay(inst, "state");

    if (layers.lga && zoom >= 5) {
      const theme = inst.cfg.resultTheme;
      let data = null;
      // Governorship LGA choropleth: only draw the selected state's LGAs so
      // neighbouring states (and shared names like Bassa) never bleed through.
      if (theme && theme.level === 'lga' && theme.state) {
        const stateWhere = "UPPER(statename)='" + escWhere(theme.state).toUpperCase() + "'";
        data = await queryLocalAdmin('lga', theme.state);
        if (!data || !data.features || !data.features.length) {
          data = await queryAdmin('lga', stateWhere, 200);
        }
        if (data && data.features && data.features.length) {
          data = {
            type: 'FeatureCollection',
            features: pickAdminFeatures(data, 'statename', theme.state),
          };
        }
      } else {
        data = await loadLayer("lga", bbox);
      }
      if (inst.overlayKey === key) putGeoJson(inst, "lga", data);
    } else clearOverlay(inst, "lga");

    if (layers.ward && zoom >= 8) {
      const data = await loadLayer("ward", bbox);
      if (inst.overlayKey === key) putGeoJson(inst, "ward", data);
    } else clearOverlay(inst, "ward");

    if (layers.health && zoom >= 8) {
      const data = await loadLayer("health", bbox);
      if (inst.overlayKey === key) putGeoJson(inst, "health", data, true);
    } else clearOverlay(inst, "health");

    if (layers.polling && zoom >= 9) {
      const data = await loadJson("/api/polling-unit-points?bbox=" + encodeURIComponent(bbox));
      const fc = {
        type: "FeatureCollection",
        features: (data?.points || []).slice(0, 800).map((p) => ({
          type: "Feature",
          geometry: { type: "Point", coordinates: [p.longitude, p.latitude] },
          properties: { name: p.pollingUnit, address: p.address || p.name, code: p.code, ward: p.ward, lga: p.lga, state: p.state },
        })),
      };
      if (inst.overlayKey === key) putGeoJson(inst, "polling", fc, true);
    } else if (!inst.cfg.keepLocalPoints) {
      clearOverlay(inst, "polling");
    }
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

  function attach(el, cfg) {
    const inst = ensure(el);
    if (!inst) return;
    inst.cfg = cfg || {};
    const view = GEO[cfg.scope] || GEO.global;
    const liveView = cfg.live ? GEO.ekiti : view;
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
          : (cfg.live ? "ekiti" : cfg.scope) + ":" + (cfg.zoom || liveView.zoom);
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
        inst.map.setView(liveView.center, cfg.zoom || liveView.zoom);
      }
    }
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

    // Paint selection last so its red pin and halo remain above ordinary markers.
    paintFocus(inst, focus);
    paintRoute(inst, cfg.route);
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
    inst.overlayKey = null;
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
    inst.overlayKey = null;

    if (theme.level === 'lga' && theme.state) {
      const stateWhere = "UPPER(statename)='" + escWhere(theme.state).toUpperCase() + "'";
      const data = await queryAdmin('lga', stateWhere, 200);
      const bounds = boundsFromFeatures(data && data.features);
      if (bounds) {
        goToBounds(inst, bounds, { padding: [32, 32], maxZoom: 10 });
        refreshOverlays(el);
        return;
      }
      await flyToAdmin(el, { state: theme.state, preserveLayers: true });
      return;
    }

    if (theme.level === 'state' && theme.state) {
      await flyToAdmin(el, { state: theme.state, preserveLayers: true });
      return;
    }

    const view = GEO.ng || GEO.global;
    beginNav(inst);
    inst.map.setView(view.center, view.zoom, { animate: true });
    refreshOverlays(el);
  }

  global.EIDMaps = { attach, setBasemap, zoomIn, zoomOut, focusPoint, resetView, flyToAdmin, flyToResultScope, GEO };
})(window);
