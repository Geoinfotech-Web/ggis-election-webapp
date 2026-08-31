window.EID_DATA = (function () {
  const STATUS = {
    live: { label: "Live now", color: "var(--live)" },
    upcoming: { label: "Upcoming", color: "var(--up)" },
    recent: { label: "Recent result", color: "var(--primary)" },
  };

  const SECTIONS = {
    Overview: { icon: "dashboard", desc: "Country and global election intelligence at a glance." },
    Elections: {
      icon: "how_to_vote",
      desc: "Browse every election — filter by type, year and status, then open any contest for full results, candidates and geography.",
    },
    "Live Results": {
      icon: "sensors",
      desc: "Real-time reporting progress, candidate standings, seat totals and a live result map as counts come in — with a clear data-source and last-updated indicator.",
    },
    Map: {
      icon: "travel_explore",
      desc: "Full-screen geospatial intelligence: basemaps, vector layers, hierarchy drill-down (region → district → voting unit) and result-styled choropleths.",
    },
    Candidates: {
      icon: "person",
      desc: "Candidate profiles with party, position contested, historical performance, vote share and geographic strongholds — plus side-by-side comparison.",
    },
    Parties: {
      icon: "groups",
      desc: "Party intelligence: participation, seats won, historical vote share and a geographic strength map across every tracked election.",
    },
    Analysis: {
      icon: "insights",
      desc: "Vote swing, turnout anomalies, competitive districts and battlegrounds — complex electoral statistics made legible through maps and visualization.",
    },
    Data: {
      icon: "database",
      desc: "Explore and download datasets — results, boundaries, voting locations, candidates and voter statistics — each with source, coverage and update date.",
    },
    About: {
      icon: "info",
      desc: "How the platform models elections across different electoral systems, its data sources, methodology and the PostGIS / GeoServer spatial backend.",
    },
  };

  const NAV = ["Overview", "Elections", "Live Results", "Map", "Candidates", "Parties", "Analysis", "Data", "About"];

  const COUNTRIES = {
    ng: {
      code: "ng",
      name: "Nigeria",
      region: "West Africa",
      flag: "#008751",
      elections: 9,
      status: "live",
      kpis: [
        { icon: "groups", label: "Registered", value: "93.5", unit: "M" },
        { icon: "how_to_vote", label: "Turnout 2023", value: "27.1", unit: "%" },
        { icon: "ballot", label: "Elections", value: "9", unit: "" },
        { icon: "groups", label: "Parties", value: "18", unit: "" },
      ],
      geoLabel: "36 states + FCT",
      geoUnits: "State → LGA → Ward → Polling Unit",
      regions: [
        { label: "Lagos", x: 34, y: 70, c: "#2f6fed" },
        { label: "Kano", x: 52, y: 26, c: "#cf3a4e" },
        { label: "Rivers", x: 52, y: 82, c: "#cf3a4e" },
        { label: "FCT", x: 52, y: 52, c: "#2f6fed" },
        { label: "Kaduna", x: 50, y: 38, c: "#2f6fed" },
      ],
      parties: [
        { name: "APC", color: "#2f6fed", share: "36.6%", w: 36.6 },
        { name: "PDP", color: "#cf3a4e", share: "29.1%", w: 29.1 },
        { name: "Labour Party", color: "#2fa84f", share: "25.4%", w: 25.4 },
      ],
      timeline: [
        { year: "2027", name: "General Election", status: "Upcoming", icon: "event", meta: "Feb 2027 · Presidential" },
        { year: "2023", name: "General Election", status: "Result", icon: "check_circle", meta: "B. Tinubu · APC" },
        { year: "2019", name: "General Election", status: "Result", icon: "check_circle", meta: "M. Buhari · APC" },
        { year: "2015", name: "General Election", status: "Result", icon: "check_circle", meta: "M. Buhari · APC" },
      ],
      next: { name: "2027 General Election", type: "Presidential", date: "Feb 2027", countdown: "~540 days" },
      center: [9.08, 8.68],
      zoom: 6,
    },
    us: {
      code: "us",
      name: "United States",
      region: "North America",
      flag: "#3c3b6e",
      elections: 12,
      status: "upcoming",
      kpis: [
        { icon: "groups", label: "Registered", value: "161", unit: "M" },
        { icon: "how_to_vote", label: "Turnout 2020", value: "66.8", unit: "%" },
        { icon: "ballot", label: "Elections", value: "12", unit: "" },
        { icon: "groups", label: "Parties", value: "2", unit: "major" },
      ],
      geoLabel: "50 states",
      geoUnits: "State → County → Precinct",
      regions: [
        { label: "CA", x: 16, y: 52, c: "#2f6fed" },
        { label: "TX", x: 42, y: 72, c: "#cf3a4e" },
        { label: "NY", x: 80, y: 38, c: "#2f6fed" },
        { label: "FL", x: 74, y: 82, c: "#cf3a4e" },
        { label: "OH", x: 66, y: 46, c: "#cf3a4e" },
      ],
      parties: [
        { name: "Democratic", color: "#2f6fed", share: "51.3%", w: 51.3 },
        { name: "Republican", color: "#cf3a4e", share: "46.8%", w: 46.8 },
        { name: "Other", color: "#8b939d", share: "1.9%", w: 1.9 },
      ],
      timeline: [
        { year: "2028", name: "Presidential Election", status: "Upcoming", icon: "event", meta: "Nov 2028 · Presidential" },
        { year: "2024", name: "Presidential Election", status: "Result", icon: "check_circle", meta: "Nov 2024" },
        { year: "2020", name: "Presidential Election", status: "Result", icon: "check_circle", meta: "J. Biden · Dem" },
      ],
      next: { name: "2028 Presidential", type: "Presidential", date: "Nov 2028", countdown: "~830 days" },
      center: [39.8, -98.5],
      zoom: 4,
    },
    gb: {
      code: "gb",
      name: "United Kingdom",
      region: "Northern Europe",
      flag: "#012169",
      elections: 8,
      status: "recent",
      kpis: [
        { icon: "groups", label: "Registered", value: "48.2", unit: "M" },
        { icon: "how_to_vote", label: "Turnout 2024", value: "59.7", unit: "%" },
        { icon: "ballot", label: "Elections", value: "8", unit: "" },
        { icon: "groups", label: "Parties", value: "9", unit: "" },
      ],
      geoLabel: "650 constituencies",
      geoUnits: "Nation → Region → Constituency",
      regions: [
        { label: "London", x: 56, y: 74, c: "#cf3a4e" },
        { label: "Scotland", x: 46, y: 20, c: "#f6c14a" },
        { label: "Wales", x: 38, y: 66, c: "#cf3a4e" },
        { label: "N. England", x: 50, y: 44, c: "#cf3a4e" },
      ],
      parties: [
        { name: "Labour", color: "#cf3a4e", share: "33.7%", w: 33.7 },
        { name: "Conservative", color: "#2f6fed", share: "23.7%", w: 23.7 },
        { name: "Reform / Lib Dem", color: "#f6a11a", share: "26.1%", w: 26.1 },
      ],
      timeline: [
        { year: "2024", name: "General Election", status: "Result", icon: "check_circle", meta: "Labour majority" },
        { year: "2019", name: "General Election", status: "Result", icon: "check_circle", meta: "Conservative" },
      ],
      next: { name: "Next General Election", type: "Parliamentary", date: "by 2029", countdown: "~4 years" },
      center: [54.5, -3.4],
      zoom: 6,
    },
    gh: {
      code: "gh",
      name: "Ghana",
      region: "West Africa",
      flag: "#ce1126",
      elections: 6,
      status: "recent",
      kpis: [
        { icon: "groups", label: "Registered", value: "18.7", unit: "M" },
        { icon: "how_to_vote", label: "Turnout 2024", value: "60.9", unit: "%" },
        { icon: "ballot", label: "Elections", value: "6", unit: "" },
        { icon: "groups", label: "Parties", value: "4", unit: "" },
      ],
      geoLabel: "16 regions",
      geoUnits: "Region → District → Constituency",
      regions: [
        { label: "Greater Accra", x: 48, y: 78, c: "#2f6fed" },
        { label: "Ashanti", x: 42, y: 56, c: "#cf3a4e" },
        { label: "Northern", x: 48, y: 26, c: "#2f6fed" },
      ],
      parties: [
        { name: "NDC", color: "#2f6fed", share: "56.6%", w: 56.6 },
        { name: "NPP", color: "#cf3a4e", share: "41.6%", w: 41.6 },
        { name: "Other", color: "#8b939d", share: "1.8%", w: 1.8 },
      ],
      timeline: [{ year: "2024", name: "General Election", status: "Result", icon: "check_circle", meta: "J. Mahama · NDC" }],
      next: { name: "2028 General Election", type: "Presidential", date: "Dec 2028", countdown: "~2.4 years" },
      center: [7.95, -1.02],
      zoom: 7,
    },
    ke: {
      code: "ke",
      name: "Kenya",
      region: "East Africa",
      flag: "#006600",
      elections: 5,
      status: "upcoming",
      kpis: [
        { icon: "groups", label: "Registered", value: "22.1", unit: "M" },
        { icon: "how_to_vote", label: "Turnout 2022", value: "64.8", unit: "%" },
        { icon: "ballot", label: "Elections", value: "5", unit: "" },
        { icon: "groups", label: "Parties", value: "7", unit: "" },
      ],
      geoLabel: "47 counties",
      geoUnits: "County → Constituency → Ward",
      regions: [
        { label: "Nairobi", x: 56, y: 56, c: "#7a53d1" },
        { label: "Mombasa", x: 70, y: 78, c: "#f6a11a" },
        { label: "Kisumu", x: 34, y: 52, c: "#f6a11a" },
      ],
      parties: [
        { name: "Kenya Kwanza", color: "#f6a11a", share: "50.5%", w: 50.5 },
        { name: "Azimio", color: "#7a53d1", share: "48.8%", w: 48.8 },
      ],
      timeline: [{ year: "2022", name: "General Election", status: "Result", icon: "check_circle", meta: "W. Ruto" }],
      next: { name: "2027 General Election", type: "Presidential", date: "Aug 2027", countdown: "~730 days" },
      center: [0.02, 37.9],
      zoom: 6,
    },
    in: {
      code: "in",
      name: "India",
      region: "South Asia",
      flag: "#ff9933",
      elections: 7,
      status: "recent",
      kpis: [
        { icon: "groups", label: "Registered", value: "968", unit: "M" },
        { icon: "how_to_vote", label: "Turnout 2024", value: "65.8", unit: "%" },
        { icon: "ballot", label: "Elections", value: "7", unit: "" },
        { icon: "groups", label: "Parties", value: "40+", unit: "" },
      ],
      geoLabel: "543 constituencies",
      geoUnits: "State → District → Constituency",
      regions: [
        { label: "Delhi", x: 38, y: 30, c: "#f6a11a" },
        { label: "Maharashtra", x: 34, y: 58, c: "#2fa84f" },
        { label: "UP", x: 50, y: 36, c: "#f6a11a" },
      ],
      parties: [
        { name: "NDA", color: "#f6a11a", share: "43.3%", w: 43.3 },
        { name: "INDIA bloc", color: "#2fa84f", share: "41.6%", w: 41.6 },
      ],
      timeline: [{ year: "2024", name: "Lok Sabha Election", status: "Result", icon: "check_circle", meta: "NDA coalition" }],
      next: { name: "2029 Lok Sabha", type: "Parliamentary", date: "2029", countdown: "~3.6 years" },
      center: [22.5, 79],
      zoom: 5,
    },
    de: {
      code: "de",
      name: "Germany",
      region: "Central Europe",
      flag: "#dd0000",
      elections: 6,
      status: "recent",
      kpis: [
        { icon: "groups", label: "Registered", value: "59.2", unit: "M" },
        { icon: "how_to_vote", label: "Turnout 2025", value: "82.5", unit: "%" },
        { icon: "ballot", label: "Elections", value: "6", unit: "" },
        { icon: "groups", label: "Parties", value: "6", unit: "" },
      ],
      geoLabel: "299 constituencies",
      geoUnits: "Land → District → Wahlkreis",
      regions: [
        { label: "Bavaria", x: 48, y: 74, c: "#111111" },
        { label: "Berlin", x: 64, y: 34, c: "#cf3a4e" },
        { label: "NRW", x: 30, y: 48, c: "#cf3a4e" },
      ],
      parties: [
        { name: "CDU/CSU", color: "#111111", share: "28.6%", w: 28.6 },
        { name: "AfD", color: "#2f6fed", share: "20.8%", w: 20.8 },
        { name: "SPD", color: "#cf3a4e", share: "16.4%", w: 16.4 },
      ],
      timeline: [{ year: "2025", name: "Federal Election", status: "Result", icon: "check_circle", meta: "CDU/CSU led" }],
      next: { name: "2029 Federal Election", type: "Parliamentary", date: "2029", countdown: "~3.5 years" },
      center: [51.16, 10.45],
      zoom: 6,
    },
    fr: {
      code: "fr",
      name: "France",
      region: "Western Europe",
      flag: "#0055a4",
      elections: 6,
      status: "recent",
      kpis: [
        { icon: "groups", label: "Registered", value: "49.3", unit: "M" },
        { icon: "how_to_vote", label: "Turnout 2022", value: "71.9", unit: "%" },
        { icon: "ballot", label: "Elections", value: "6", unit: "" },
        { icon: "groups", label: "Parties", value: "8", unit: "" },
      ],
      geoLabel: "577 constituencies",
      geoUnits: "Région → Département → Circonscription",
      regions: [
        { label: "Île-de-France", x: 50, y: 34, c: "#cf3a4e" },
        { label: "PACA", x: 62, y: 74, c: "#7a53d1" },
      ],
      parties: [
        { name: "Ensemble", color: "#f6a11a", share: "34.1%", w: 34.1 },
        { name: "RN", color: "#2b3a67", share: "37.1%", w: 37.1 },
        { name: "NFP", color: "#cf3a4e", share: "28.8%", w: 28.8 },
      ],
      timeline: [{ year: "2022", name: "Presidential Election", status: "Result", icon: "check_circle", meta: "E. Macron" }],
      next: { name: "2027 Presidential", type: "Presidential", date: "Apr 2027", countdown: "~600 days" },
      center: [46.2, 2.2],
      zoom: 6,
    },
    br: {
      code: "br",
      name: "Brazil",
      region: "South America",
      flag: "#009c3b",
      elections: 7,
      status: "recent",
      kpis: [
        { icon: "groups", label: "Registered", value: "156", unit: "M" },
        { icon: "how_to_vote", label: "Turnout 2022", value: "79.1", unit: "%" },
        { icon: "ballot", label: "Elections", value: "7", unit: "" },
        { icon: "groups", label: "Parties", value: "30+", unit: "" },
      ],
      geoLabel: "27 states",
      geoUnits: "State → Municipality → Zone",
      regions: [
        { label: "São Paulo", x: 52, y: 70, c: "#2f6fed" },
        { label: "Rio", x: 60, y: 72, c: "#2f6fed" },
        { label: "Bahia", x: 64, y: 48, c: "#cf3a4e" },
      ],
      parties: [
        { name: "PT (Lula)", color: "#cf3a4e", share: "50.9%", w: 50.9 },
        { name: "PL (Bolsonaro)", color: "#2f6fed", share: "49.1%", w: 49.1 },
      ],
      timeline: [{ year: "2022", name: "General Election", status: "Result", icon: "check_circle", meta: "L. Lula da Silva" }],
      next: { name: "2026 General Election", type: "Presidential", date: "Oct 2026", countdown: "~410 days" },
      center: [-14.2, -51.9],
      zoom: 4,
    },
    za: {
      code: "za",
      name: "South Africa",
      region: "Southern Africa",
      flag: "#007749",
      elections: 6,
      status: "recent",
      kpis: [
        { icon: "groups", label: "Registered", value: "27.8", unit: "M" },
        { icon: "how_to_vote", label: "Turnout 2024", value: "58.6", unit: "%" },
        { icon: "ballot", label: "Elections", value: "6", unit: "" },
        { icon: "groups", label: "Parties", value: "14", unit: "" },
      ],
      geoLabel: "9 provinces",
      geoUnits: "Province → District → Ward",
      regions: [
        { label: "Gauteng", x: 56, y: 40, c: "#111111" },
        { label: "W. Cape", x: 26, y: 84, c: "#2f6fed" },
        { label: "KZN", x: 64, y: 64, c: "#f6a11a" },
      ],
      parties: [
        { name: "ANC", color: "#007749", share: "40.2%", w: 40.2 },
        { name: "DA", color: "#2f6fed", share: "21.8%", w: 21.8 },
        { name: "MK / EFF", color: "#111111", share: "24.3%", w: 24.3 },
      ],
      timeline: [{ year: "2024", name: "General Election", status: "Result", icon: "check_circle", meta: "ANC (coalition)" }],
      next: { name: "2029 General Election", type: "Parliamentary", date: "2029", countdown: "~3.5 years" },
      center: [-30.5, 24.7],
      zoom: 5,
    },
  };

  const ORDER = ["ng", "us", "gb", "gh", "ke", "in", "de", "fr", "br", "za"];

  const WORLD_MARKERS = [
    { code: "ng", label: "NG", x: 52, y: 60, live: true, lat: 9.08, lng: 8.68 },
    { code: "us", label: "US", x: 22, y: 41, live: false, lat: 39.8, lng: -98.5 },
    { code: "gb", label: "UK", x: 47, y: 32, live: false, lat: 54.5, lng: -3.4 },
    { code: "gh", label: "GH", x: 48.5, y: 61, live: false, lat: 7.95, lng: -1.02 },
    { code: "ke", label: "KE", x: 57.5, y: 65, live: false, lat: 0.02, lng: 37.9 },
    { code: "in", label: "IN", x: 69, y: 52, live: false, lat: 22.5, lng: 79 },
    { code: "br", label: "BR", x: 33, y: 72, live: false, lat: -14.2, lng: -51.9 },
  ];

  const NG_STATES = {
    Lagos: { lgas: { Ikeja: ["Alausa", "Oregun", "Ojodu"], "Eti-Osa": ["Victoria Island", "Lekki Phase I", "Ikoyi"] } },
    Kano: { lgas: { Nassarawa: ["Gyadi-Gyadi", "Tudun Wada"], Fagge: ["Fagge A", "Sabon Gari"] } },
    FCT: { lgas: { "Abuja Municipal": ["Garki", "Wuse", "Asokoro"], Bwari: ["Bwari Central", "Kubwa"] } },
    Rivers: { lgas: { "Port Harcourt": ["Diobu", "Township"], "Obio-Akpor": ["Rumuokoro", "Rumuola"] } },
    Kaduna: { lgas: { "Kaduna North": ["Unguwan Sarki", "Kabala"], Chikun: ["Sabon Tasha", "Narayi"] } },
  };

  const NG_PRES = {
    2023: [
      ["B. Tinubu", "APC", 37.0, true],
      ["A. Abubakar", "PDP", 29.1],
      ["P. Obi", "LP", 25.4],
      ["R. Kwankwaso", "NNPP", 6.4],
    ],
    2019: [
      ["M. Buhari", "APC", 55.6, true],
      ["A. Abubakar", "PDP", 41.2],
    ],
    2015: [
      ["M. Buhari", "APC", 53.9, true],
      ["G. Jonathan", "PDP", 44.9],
    ],
  };

  const PARTY_COLOR = { APC: "#2f6fed", PDP: "#cf3a4e", LP: "#2fa84f", NNPP: "#7a53d1" };

  const INEC_PARTIES = [
    { abbr: "APC", name: "All Progressives Congress", color: "#2f6fed", founded: 2013 },
    { abbr: "PDP", name: "Peoples Democratic Party", color: "#cf3a4e", founded: 1998 },
    { abbr: "LP", name: "Labour Party", color: "#2fa84f", founded: 2002 },
    { abbr: "NNPP", name: "New Nigeria Peoples Party", color: "#e0872f", founded: 2002 },
    { abbr: "APGA", name: "All Progressives Grand Alliance", color: "#1f9e8a", founded: 2002 },
    { abbr: "ADC", name: "African Democratic Congress", color: "#6f8f2f", founded: 2005 },
    { abbr: "SDP", name: "Social Democratic Party", color: "#3f6f9e", founded: 1990 },
    { abbr: "YPP", name: "Young Progressives Party", color: "#b5482f", founded: 2017 },
    { abbr: "ADP", name: "Action Democratic Party", color: "#8a5fbf", founded: 2016 },
    { abbr: "AA", name: "Action Alliance", color: "#bf9a2f", founded: 2005 },
    { abbr: "AAC", name: "African Action Congress", color: "#c0392f", founded: 2018 },
    { abbr: "APM", name: "Allied Peoples Movement", color: "#2f8fbf", founded: 2017 },
    { abbr: "APP", name: "Action Peoples Party", color: "#5f9e6f", founded: 2018 },
    { abbr: "BP", name: "Boot Party", color: "#7f6f4f", founded: 2018 },
    { abbr: "NRM", name: "National Rescue Movement", color: "#4f8f8f", founded: 2018 },
    { abbr: "PRP", name: "Peoples Redemption Party", color: "#9e2f6f", founded: 1978 },
    { abbr: "ZLP", name: "Zenith Labour Party", color: "#2f6f5f", founded: 2018 },
    { abbr: "A", name: "Accord", color: "#8f7f2f", founded: 2006 },
  ];

  const PRES_BEARERS = {
    APC: [["2023", "Bola Ahmed Tinubu", "Won", "#43a86a"], ["2019", "Muhammadu Buhari", "Won", "#43a86a"], ["2015", "Muhammadu Buhari", "Won", "#43a86a"]],
    PDP: [["2023", "Atiku Abubakar", "Runner-up", "#d69a34"], ["2019", "Atiku Abubakar", "Runner-up", "#d69a34"], ["2015", "Goodluck Jonathan", "Lost (incumbent)", "#e0564f"]],
    LP: [["2023", "Peter Obi", "3rd place", "#69727f"]],
    NNPP: [["2023", "Rabiu Kwankwaso", "4th place", "#69727f"]],
  };

  const NG_NAMES = ["A. Bello", "C. Okafor", "M. Sani", "T. Adeyemi", "I. Musa", "F. Eze", "K. Danjuma", "O. Balogun"];
  const NG_OFFICES = [
    { v: "pres", l: "Presidential" },
    { v: "sen", l: "Senatorial" },
    { v: "reps", l: "House of Representatives" },
    { v: "gov", l: "Gubernatorial" },
    { v: "assembly", l: "State House of Assembly" },
    { v: "lga", l: "LGA Chairman" },
  ];

  const LEADS = {
    ng: ["B. Tinubu", "A. Abubakar", "P. Obi"],
    us: ["K. Harris", "D. Trump", "—"],
    gb: ["K. Starmer", "R. Sunak", "N. Farage"],
    gh: ["J. Mahama", "M. Bawumia", "—"],
    ke: ["W. Ruto", "R. Odinga", "—"],
    in: ["N. Modi", "R. Gandhi", "—"],
    de: ["F. Merz", "A. Weidel", "O. Scholz"],
    fr: ["G. Attal", "M. Le Pen", "J. Mélenchon"],
    br: ["L. da Silva", "J. Bolsonaro", "—"],
    za: ["C. Ramaphosa", "J. Steenhuisen", "J. Zuma"],
  };

  function seedNum(str) {
    let s = 0;
    for (const ch of String(str)) s = (s * 31 + ch.charCodeAt(0)) % 99991;
    return s;
  }

  function featInfo(name, parties) {
    const s = seedNum(name);
    return {
      name,
      population: `${(1.2 + (s % 80) / 10).toFixed(1)}M`,
      registered: `${(0.6 + (s % 50) / 10).toFixed(1)}M`,
      turnout: `${40 + (s % 35)}%`,
      share: parties[0]?.share || "—",
      margin: `${1 + (s % 12)}%`,
      party: parties[0]?.name || "—",
      partyColor: parties[0]?.color || "#8b939d",
      breakdown: (parties || []).slice(0, 4).map((p) => ({ name: p.name, color: p.color, share: p.share, w: p.w })),
    };
  }

  const LIVE = [
    {
      code: "NG",
      name: "Ekiti Governorship",
      reporting: "68%",
      updated: "42s ago",
      width: 68,
      cands: [
        { name: "A. Oyebanji", party: "APC", pct: "52.3%", color: "#2f6fed" },
        { name: "B. Kolawole", party: "PDP", pct: "41.1%", color: "#cf3a4e" },
      ],
    },
    {
      code: "US",
      name: "Special — OH-6",
      reporting: "54%",
      updated: "1m ago",
      width: 54,
      cands: [
        { name: "Candidate D", party: "Dem", pct: "49.6%", color: "#2f6fed" },
        { name: "Candidate R", party: "Rep", pct: "48.8%", color: "#cf3a4e" },
      ],
    },
  ];

  const UPCOMING = [
    { day: "23", mon: "Sep", name: "General Election", country: "Nigeria", type: "Presidential", left: "40d" },
    { day: "05", mon: "Nov", name: "Presidential", country: "United States", type: "Presidential", left: "83d" },
    { day: "12", mon: "Aug", name: "General Election", country: "Kenya", type: "Parliamentary", left: "8d" },
    { day: "02", mon: "Dec", name: "Regional", country: "India", type: "State assembly", left: "110d" },
  ];

  const RECENT = [
    { code: "GB", name: "UK General", date: "Jul 2024", winner: "Labour", party: "Majority", turnout: "59.7%", color: "#cf3a4e" },
    { code: "GH", name: "Ghana Presidential", date: "Dec 2024", winner: "J. Mahama", party: "NDC", turnout: "60.9%", color: "#2f6fed" },
    { code: "IN", name: "India Lok Sabha", date: "Jun 2024", winner: "NDA", party: "Coalition", turnout: "65.8%", color: "#d69a34" },
    { code: "NG", name: "Nigeria General", date: "Feb 2023", winner: "B. Tinubu", party: "APC", turnout: "27.1%", color: "#2f6fed" },
  ];

  const DATASETS = [
    { name: "Official results", coverage: "National contests", source: "Electoral commissions", type: "Tabular", fmt: "CSV / JSON", updated: "2026-02", icon: "how_to_vote" },
    { name: "Administrative boundaries", coverage: "ADM0–ADM3", source: "GADM / INEC", type: "Vector", fmt: "GeoJSON / SHP", updated: "2025-11", icon: "map" },
    { name: "Polling unit locations", coverage: "Nigeria", source: "INEC CSV", type: "Points", fmt: "CSV / GeoJSON", updated: "2025-08", icon: "where_to_vote" },
    { name: "Population & PVC", coverage: "States & LGAs", source: "Dashboard store", type: "Tabular", fmt: "JSON", updated: "2026-01", icon: "groups" },
    { name: "Parties", coverage: "Tracked countries", source: "Curated", type: "Tabular", fmt: "JSON", updated: "2026-03", icon: "flag" },
  ];

  const ABOUT = [
    { icon: "public", title: "Configurable geography", body: "Each country keeps its own administrative and electoral hierarchy rather than a single fixed template." },
    { icon: "database", title: "Sourced datasets", body: "Results, boundaries and voting locations carry source, coverage and last-updated metadata." },
    { icon: "layers", title: "Spatial backend", body: "Maps are designed for PostGIS / GeoServer WMS and vector tiles, with Leaflet as the current client." },
    { icon: "verified", title: "Verified publication", body: "Citizen-submitted polling-unit sheets can be geofenced and approved in Admin before they go live." },
  ];

  function flagSrc(code) {
    return `https://flagcdn.com/w160/${code}.png`;
  }

  return {
    STATUS,
    SECTIONS,
    NAV,
    COUNTRIES,
    ORDER,
    WORLD_MARKERS,
    NG_STATES,
    NG_PRES,
    PARTY_COLOR,
    INEC_PARTIES,
    PRES_BEARERS,
    NG_NAMES,
    NG_OFFICES,
    LEADS,
    seedNum,
    featInfo,
    LIVE,
    UPCOMING,
    RECENT,
    DATASETS,
    ABOUT,
    flagSrc,
  };
})();
