/* Ghana election workspace.
   Regional colours come only from public/data/ghana/packs.json.
   Years without a pack stay uncoloured. */
(function (global) {
  const REGIONS = [
    { name: "Ahafo", capital: "Goaso" },
    { name: "Ashanti", capital: "Kumasi" },
    { name: "Bono", capital: "Sunyani" },
    { name: "Bono East", capital: "Techiman" },
    { name: "Central", capital: "Cape Coast" },
    { name: "Eastern", capital: "Koforidua" },
    { name: "Greater Accra", capital: "Accra" },
    { name: "North East", capital: "Nalerigu" },
    { name: "Northern", capital: "Tamale" },
    { name: "Oti", capital: "Dambai" },
    { name: "Savannah", capital: "Damongo" },
    { name: "Upper East", capital: "Bolgatanga" },
    { name: "Upper West", capital: "Wa" },
    { name: "Volta", capital: "Ho" },
    { name: "Western", capital: "Sekondi-Takoradi" },
    { name: "Western North", capital: "Sefwi Wiawso" },
  ];

  const CONTESTS = [
    {
      id: "pres",
      label: "Presidential",
      kicker: "Two-round",
      rule: "Majoritarian. A winner needs more than half of the valid votes. If nobody reaches that, the top two meet in a run-off.",
    },
    {
      id: "parl",
      label: "Parliamentary",
      kicker: "First-past-the-post",
      rule: "One Member of Parliament from each single-member constituency. The candidate with the most valid votes wins the seat.",
    },
    {
      id: "local",
      label: "Local assemblies",
      kicker: "Non-partisan",
      rule: "District Assembly and Unit Committee elections are non-partisan, and they are not held on the same day as the presidential and parliamentary polls.",
    },
  ];

  const YEARS = {
    pres: ["2024", "2020", "2016"],
    parl: ["2024", "2020"],
    local: [],
  };

  const PARTIES = [
    { abbr: "NPP", name: "New Patriotic Party", symbol: "Elephant", color: "#003DA5" },
    { abbr: "NDC", name: "National Democratic Congress", symbol: "Umbrella", color: "#067647" },
  ];

  const PARTY_COLOR = { NPP: "#003DA5", NDC: "#067647", IND: "#64748b" };

  const SOURCES = [
    {
      label: "Electoral Commission of Ghana",
      body: "Presidential two-round system, parliamentary first-past-the-post, same-day national polls, non-partisan local elections, and the Commission’s 16 regional offices.",
      url: "https://ec.gov.gh/electoral-system/",
      linkLabel: "ec.gov.gh/electoral-system",
      hasUrl: true,
    },
    {
      label: "2024 presidential declaration",
      body: "Regional rows in this dashboard add up to the national totals the EC chair announced: 11,191,422 valid votes, John Dramani Mahama 6,328,397 (56.55%), Mahamudu Bawumia 4,657,304 (41.61%). The declaration used 267 of 276 constituencies.",
      url: "https://dailyguidenetwork.com/mahama-wins-2024-polls-with-56-55-ec/",
      linkLabel: "Daily Guide Network, 10 Dec 2024",
      hasUrl: true,
    },
    {
      label: "Regional table",
      body: "The 16-region presidential sheet is the Wikipedia compilation of that EC declaration. Map colour is the plurality in each region. The national winner is the declared field in the pack, not a guess from the map.",
      url: "https://en.wikipedia.org/wiki/2024_Ghanaian_general_election",
      linkLabel: "2024 Ghanaian general election",
      hasUrl: true,
    },
    {
      label: "Constituency demarcation",
      body: "Parliament sits 276 members after the Guan constituency was added for the 2024 general election. Constituency winners are not painted on the map.",
      url: "https://www.ifes.org/sites/default/files/2024-12/Election%20FAQs%20Ghana_Dec.%202024_4.pdf",
      linkLabel: "IFES Election FAQs, Dec 2024",
      hasUrl: true,
    },
    {
      label: "Region boundaries",
      body: "The map uses geoBoundaries Ghana ADM1 (16 regions). Licence: CC BY-SA. Only a year with a regional pack is coloured.",
      url: "https://www.geoboundaries.org/api/current/gbOpen/GHA/ADM1/",
      linkLabel: "geoBoundaries GHA ADM1",
      hasUrl: true,
    },
  ];

  let PACKS = null;
  let PACKS_PROMISE = null;

  function load() {
    if (PACKS) return Promise.resolve(PACKS);
    if (!PACKS_PROMISE) {
      PACKS_PROMISE = fetch("/data/ghana/packs.json", { cache: "no-store" })
        .then((res) => (res.ok ? res.json() : null))
        .then((data) => {
          PACKS = data || { pres: {}, parl: {} };
          return PACKS;
        })
        .catch(() => {
          PACKS = { pres: {}, parl: {} };
          return PACKS;
        });
    }
    return PACKS_PROMISE;
  }

  function partyColor(code) {
    const key = String(code || "").toUpperCase();
    return PARTY_COLOR[key] || "#94a3b8";
  }

  function fmt(n) {
    const v = Number(n);
    if (!Number.isFinite(v)) return "—";
    return v.toLocaleString("en-GB");
  }

  function pct(part, whole) {
    const p = Number(part);
    const w = Number(whole);
    if (!Number.isFinite(p) || !Number.isFinite(w) || w <= 0) return "—";
    return (100 * p / w).toFixed(2) + "%";
  }

  function btnStyle(on) {
    return "height:32px;padding:0 11px;border:1px solid " + (on ? "var(--primary)" : "var(--border)")
      + ";background:" + (on ? "var(--primary-soft)" : "transparent")
      + ";color:" + (on ? "var(--text)" : "var(--dim)")
      + ";border-radius:8px;font-family:inherit;font-size:12px;font-weight:" + (on ? "600" : "500")
      + ";cursor:pointer";
  }

  function packFor(contest, year) {
    if (!PACKS || !PACKS[contest]) return null;
    return PACKS[contest][String(year)] || null;
  }

  function unitVotes(unit) {
    const votes = (unit && unit.votes) || {};
    return Object.keys(votes).reduce((sum, key) => sum + (Number(votes[key]) || 0), 0);
  }

  function theme(contest, year) {
    const id = CONTESTS.some((c) => c.id === contest) ? contest : "pres";
    const pack = packFor(id, year);
    const meta = (pack && pack.meta) || {};
    const unitsIn = (pack && pack.units) || {};
    const names = Object.keys(unitsIn);
    const emptyMessage = meta.message
      || (id === "local"
        ? "District assembly results are not loaded. These elections are non-partisan and are held apart from the general election."
        : (id === "parl"
          ? "Parliamentary seats are national. No regional pack is loaded, so the map is not coloured."
          : "No regional results are loaded for this year."));
    if (!names.length || meta.empty || meta.emptyMap) {
      return { ok: false, year: String(year || ""), office: id, message: emptyMessage, units: {} };
    }
    const units = {};
    names.forEach((name) => {
      const unit = unitsIn[name] || {};
      if (!unit.party) return;
      units[name] = {
        party: unit.party || "",
        winner: unit.winner || "",
        color: partyColor(unit.party),
        votes: unit.votes || {},
        parent: unit.parent || "",
        note: unit.note || "",
      };
    });
    if (!Object.keys(units).length) {
      return { ok: false, year: String(year || ""), office: id, message: emptyMessage, units: {} };
    }
    return { ok: true, year: String(year || ""), office: id, message: "", units };
  }

  function candidateBars(votes, limit) {
    const rows = Object.keys(votes || {}).map((key) => ({
      key,
      votes: Number(votes[key]) || 0,
      party: key.indexOf("IND") === 0 ? "IND" : key,
    })).sort((a, b) => b.votes - a.votes);
    const total = rows.reduce((sum, row) => sum + row.votes, 0);
    const max = rows.length ? rows[0].votes : 1;
    const shown = rows.slice(0, limit || 4);
    const rest = rows.slice(shown.length).reduce((sum, row) => sum + row.votes, 0);
    const bars = shown.map((row) => ({
      label: row.party,
      votes: fmt(row.votes),
      share: pct(row.votes, total),
      width: Math.max(4, Math.round(100 * row.votes / (max || 1))) + "%",
      color: partyColor(row.party),
    }));
    if (rest > 0) {
      bars.push({
        label: "Others",
        votes: fmt(rest),
        share: pct(rest, total),
        width: Math.max(4, Math.round(100 * rest / (max || 1))) + "%",
        color: "#94a3b8",
      });
    }
    return bars;
  }

  function snapYear(contest, year) {
    const list = YEARS[contest] || [];
    const cur = String(year || "");
    if (list.indexOf(cur) >= 0) return cur;
    return list[0] || "";
  }

  function view(app) {
    const state = (app && app.state) || {};
    const contestId = CONTESTS.some((c) => c.id === state.ghContest) ? state.ghContest : "pres";
    const contest = CONTESTS.find((c) => c.id === contestId);
    const year = snapYear(contestId, state.ghYear || "2024");
    const regionName = REGIONS.some((r) => r.name === state.ghRegion) ? state.ghRegion : "";
    const region = REGIONS.find((r) => r.name === regionName) || null;
    const section = state.section || "Overview";
    const mapTheme = theme(contestId, year);
    const pack = packFor(contestId, year);
    const meta = (pack && pack.meta) || {};
    const unit = region && mapTheme.units[region.name] ? mapTheme.units[region.name] : null;
    const pres2024 = packFor("pres", "2024");
    const parl2024 = packFor("parl", "2024");
    const yearList = YEARS[contestId] || [];
    const candidates = (pack && Array.isArray(pack.candidates)) ? pack.candidates.slice() : [];
    const validVotes = Number(meta.validVotes) || candidates.reduce((sum, row) => sum + (Number(row.votes) || 0), 0);
    const seats = (pack && Array.isArray(pack.seats)) ? pack.seats : [];
    const seatTotal = Number(pack && pack.totalSeats) || seats.reduce((sum, row) => sum + (Number(row.seats) || 0), 0);

    const setContest = (id) => {
      app.setState({ ghContest: id, ghYear: snapYear(id, state.ghYear), ghRegion: state.ghRegion || "" });
    };

    let statusLabel = "No results for " + (year || "this contest");
    let statusColor = "var(--mute)";
    if (mapTheme.ok) {
      statusLabel = year + " · plurality map";
      statusColor = "var(--up)";
    } else if (seats.length) {
      statusLabel = year + " · national seats";
      statusColor = "var(--primary)";
    }

    const declaredCand = candidates.find((c) => c.party === meta.declaredParty) || null;
    const kpis = contestId === "pres" && mapTheme.ok
      ? [
        { icon: "how_to_vote", label: meta.validVotes ? "Valid votes" : "Leading two", value: fmt(meta.validVotes || meta.leadingTwo), unit: year, caption: meta.validVotes ? "Presidential declaration" : "NPP and NDC regional sheet" },
        { icon: "emoji_events", label: "Declared", value: meta.declaredParty || "—", unit: (meta.validVotes && declaredCand) ? pct(declaredCand.votes, meta.validVotes) : "", caption: meta.declaredWinner || "National returning officer" },
        { icon: "groups", label: "Turnout", value: (meta.cast && meta.register) ? pct(meta.cast, meta.register).replace(/(\.\d)\d%$/, "$1%") : "—", unit: "", caption: "Ballots cast ÷ register" },
        { icon: "map", label: "Regions", value: "16", unit: "", caption: year === "2016" ? "Painted from the former regions" : "Coloured by plurality" },
      ]
      : contestId === "parl" && seats.length
        ? [
          { icon: "account_balance", label: "Seats", value: String(seatTotal || "—"), unit: year, caption: "National total" },
          { icon: "emoji_events", label: seats[0].party, value: String(seats[0].seats), unit: "seats", caption: "Largest caucus" },
          { icon: "groups", label: seats[1] ? seats[1].party : "—", value: seats[1] ? String(seats[1].seats) : "—", unit: "seats", caption: "Second caucus" },
          { icon: "map", label: "Map", value: mapTheme.ok ? "16" : "—", unit: "", caption: mapTheme.ok ? "Coloured by seat plurality" : "Regional seats not loaded" },
        ]
        : [
          { icon: "map", label: "Regions", value: "16", unit: "", caption: "Current regional boundaries" },
          { icon: "account_balance", label: "Parliament", value: "276", unit: "seats", caption: "2024 constituencies" },
          { icon: "how_to_vote", label: "Presidency", value: "50%+", unit: "", caption: "More than half of valid votes" },
          { icon: "inventory_2", label: "This year", value: year || "—", unit: "", caption: "No pack loaded" },
        ];

    const turnout = kpis[2] && kpis[2].label === "Turnout" && meta.cast && meta.register
      ? (Math.round(1000 * meta.cast / meta.register) / 10).toFixed(1) + "%"
      : null;
    if (turnout) kpis[2].value = turnout;

    return {
      isOverview: section === "Overview",
      isParties: section === "Parties",
      isAbout: section === "About",
      isLive: section === "Live Results",
      isCandidates: section === "Candidates",
      isAnalysis: section === "Analysis",
      isPres: contestId === "pres",
      isParl: contestId === "parl",
      isLocal: contestId === "local",
      hasRegion: !!region,
      noRegion: !region,
      hasMapResults: mapTheme.ok,
      noMapResults: !mapTheme.ok,
      hasSeats: seats.length > 0,
      noSeats: seats.length === 0,
      hasCandidates: candidates.length > 0,
      noCandidates: candidates.length === 0,
      hasYears: yearList.length > 0,
      noYears: yearList.length === 0,
      regionName: region ? region.name : "",
      regionCapital: region ? region.capital : "",
      regionParty: unit ? unit.party : "",
      regionWinner: unit ? unit.winner : "",
      regionLead: unit ? (contestId === "parl" ? "Plurality of published seats" : (unit.note ? "Former region total" : "Plurality of valid votes")) : "",
      contestVal: contestId,
      onContest: (e) => setContest(e && e.target ? e.target.value : e),
      offices: [
        { v: "pres", l: "Presidential Election" },
        { v: "parl", l: "Parliamentary Election" },
        { v: "local", l: "Local Assemblies Election" },
      ],
      contestLabel: contest.label,
      contestKicker: contest.kicker,
      contestRule: contest.rule,
      yearLabel: year || "—",
      statusLabel,
      statusColor,
      emptyMessage: mapTheme.message,
      panelTitle: mapTheme.ok
        ? (meta.declaredWinner ? meta.declaredWinner : (year + " results"))
        : (seats.length ? (year + " parliamentary seats") : "No results loaded"),
      panelBody: (unit && unit.note)
        ? (unit.note + (unit.party ? (" " + unit.party + " plurality · " + unit.winner + ".") : ""))
        : (mapTheme.ok
          ? (contestId === "parl"
            ? "Regions are coloured by plurality of the published seat table. North East is uncoloured where that table is tied. The national seat declaration is a separate figure."
            : (meta.declaredParty
              ? meta.declaredParty + " declared nationally. The map colours each region by plurality, which is not the same field as the national declaration."
              : "Regions are coloured by the plurality of valid votes."))
          : mapTheme.message),
      sourceLine: meta.attribution || "",
      sourceUrl: meta.declarationUrl || meta.sourceUrl || "",
      sourceLabel: meta.declarationUrl ? "Declaration report" : (meta.sourceUrl ? "Source" : ""),
      hasSource: !!(meta.declarationUrl || meta.sourceUrl),
      kpis,
      contests: CONTESTS.map((c) => ({
        label: c.label,
        onClick: () => setContest(c.id),
        style: btnStyle(c.id === contestId),
      })),
      years: yearList.map((y) => ({
        label: y,
        onClick: () => app.setState({ ghYear: y }),
        style: btnStyle(y === year),
      })),
      legendTitle: mapTheme.ok
        ? (contestId === "parl" ? "Plurality of published seats" : (year === "2016" ? "Plurality · former regions" : "Plurality of valid votes"))
        : (seats.length ? "National seats" : "Regions · no results"),
      legendNote: mapTheme.ok ? (year + " " + contest.label.toLowerCase()) : mapTheme.message,
      regions: REGIONS.map((r) => {
        const on = r.name === regionName;
        const painted = mapTheme.units[r.name];
        return {
          name: r.name,
          capital: painted ? (r.capital + " · " + painted.party) : r.capital,
          party: painted ? painted.party : "",
          hasParty: !!painted,
          swatch: painted ? painted.color : "transparent",
          onClick: () => app.setState({ ghRegion: on ? "" : r.name }),
          rowStyle: "display:flex;align-items:center;gap:8px;width:100%;text-align:left;padding:7px 8px;margin:0 0 4px;border:1px solid "
            + (on ? "var(--primary)" : "var(--border)")
            + ";background:" + (on ? "var(--primary-soft)" : "var(--surface)")
            + ";color:var(--text);border-radius:8px;font-family:inherit;cursor:pointer",
        };
      }),
      bars: unit ? candidateBars(unit.votes, 4) : [],
      hasBars: !!(unit && unit.votes),
      rounds: contestId === "pres" && mapTheme.ok && meta.declaredWinner
        ? [
          { label: "First ballot · " + year, body: meta.declaredWinner + " (" + (meta.declaredParty || "") + ") was declared. The published share is above half of valid votes, so this pack has no run-off." },
          { label: "Run-off", body: "A run-off is required only when no candidate has more than half of the valid votes. None is loaded for " + year + "." },
        ]
        : [
          { label: "First ballot", body: "Declared only if one candidate has more than half of the valid votes." },
          { label: "Run-off", body: "Held when the first ballot has no majority. No run-off sheet is loaded." },
        ],
      steps: contestId === "local"
        ? [
          { label: "Electoral area", body: "District Assembly members are chosen from electoral areas." },
          { label: "Unit committee", body: "The unit is the lowest local-government tier." },
          { label: "Timing", body: "Local polls are at least six months away from parliamentary elections." },
        ]
        : [
          { label: "Polling station", body: "Ballots are counted at the station. Coordinates are not in this app." },
          { label: "Constituency", body: "Parliamentary winners are declared by the constituency returning officer." },
          { label: "Region", body: "Presidential figures are collated through the 16 regional offices." },
          { label: "National", body: "The Commission chairperson is the presidential returning officer." },
        ],
      parties: PARTIES.map((p) => {
        const cand = pres2024 && Array.isArray(pres2024.candidates)
          ? pres2024.candidates.find((c) => c.party === p.abbr)
          : null;
        const seat = parl2024 && Array.isArray(parl2024.seats)
          ? parl2024.seats.find((s) => s.party === p.abbr)
          : null;
        const valid = pres2024 && pres2024.meta && pres2024.meta.validVotes;
        return {
          abbr: p.abbr,
          name: p.name,
          symbol: p.symbol,
          color: p.color,
          voteShare: cand && valid ? pct(cand.votes, valid) : "—",
          seats: seat ? String(seat.seats) : "—",
          voteCaption: cand ? "2024 presidential" : "Not loaded",
          seatCaption: seat ? "2024 Parliament" : "Not loaded",
          note: p.abbr + " contests the presidency and Parliament. Local assembly candidates do not run on a party ticket.",
        };
      }),
      candidates: candidates
        .slice()
        .sort((a, b) => (Number(b.votes) || 0) - (Number(a.votes) || 0))
        .map((c) => ({
          name: c.name,
          party: c.party,
          votes: fmt(c.votes),
          share: pct(c.votes, validVotes),
          color: partyColor(c.party),
          width: validVotes ? Math.max(2, (100 * (Number(c.votes) || 0) / validVotes)).toFixed(1) + "%" : "0%",
        })),
      seats: seats.map((row) => ({
        party: row.party === "IND" ? "Independent" : row.party,
        seats: fmt(row.seats),
        share: pct(row.seats, seatTotal),
        color: partyColor(row.party),
        width: seatTotal ? Math.max(4, Math.round(100 * row.seats / seatTotal)) + "%" : "0%",
      })),
      seatTotalLabel: seatTotal ? fmt(seatTotal) + " seats" : "",
      analysisRows: mapTheme.ok
        ? REGIONS.filter((r) => mapTheme.units[r.name]).map((r) => {
          const painted = mapTheme.units[r.name];
          const votes = painted.votes || {};
          const total = unitVotes(painted);
          const ndc = Number(votes.NDC) || 0;
          const npp = Number(votes.NPP) || 0;
          const on = r.name === regionName;
          return {
            name: r.name,
            party: painted.party,
            winner: painted.winner,
            ndcShare: pct(ndc, total),
            nppShare: pct(npp, total),
            ndcWidth: total ? (100 * ndc / total).toFixed(1) + "%" : "0%",
            nppWidth: total ? (100 * npp / total).toFixed(1) + "%" : "0%",
            lead: pct(Math.abs(ndc - npp), total),
            onClick: () => app.setState({ ghRegion: on ? "" : r.name }),
            rowStyle: "display:grid;grid-template-columns:minmax(108px,1.1fr) minmax(0,1.4fr) 64px;gap:10px;align-items:center;width:100%;text-align:left;padding:8px 10px;margin:0 0 6px;border:1px solid "
              + (on ? "var(--primary)" : "var(--border)")
              + ";background:" + (on ? "var(--primary-soft)" : "var(--surface)")
              + ";border-radius:8px;font-family:inherit;color:var(--text);cursor:pointer",
          };
        })
        : [],
      declaration: mapTheme.ok && meta.declaredWinner ? {
        winner: meta.declaredWinner,
        party: meta.declaredParty || "",
        votes: fmt((candidates.find((c) => c.party === meta.declaredParty) || {}).votes),
        share: pct((candidates.find((c) => c.party === meta.declaredParty) || {}).votes, meta.validVotes),
        valid: fmt(meta.validVotes),
        rejected: fmt(meta.rejected),
        cast: fmt(meta.cast),
        register: fmt(meta.register),
        turnout: (meta.cast && meta.register) ? (Math.round(1000 * meta.cast / meta.register) / 10).toFixed(1) + "%" : "—",
        constituencies: (meta.constituenciesInDeclaration && meta.constituenciesTotal)
          ? (meta.constituenciesInDeclaration + " of " + meta.constituenciesTotal)
          : "—",
        date: meta.date || year,
      } : null,
      hasDeclaration: !!(mapTheme.ok && meta.declaredWinner),
      sources: SOURCES,
      aboutCards: [
        { icon: "balance", title: "Electoral Commission", body: "The Commission runs public elections and referenda. Article 46 of the 1992 Constitution says it is not subject to the direction of any other authority, except as the Constitution allows." },
        { icon: "flag", title: "Fourth Republic calendar", body: "Presidential and parliamentary elections are held together every four years. The next cycle on that calendar is December 2028." },
        { icon: "account_tree", title: "Not a Nigeria clone", body: "Ghana uses 16 regions, constituencies and polling stations. It does not use states, LGAs, senatorial districts or INEC polling units." },
        { icon: "fact_check", title: "What is loaded", body: "Presidential results are loaded for 2024, 2020 and 2016. The 2016 sheet uses the ten regions of that election, painted onto the areas those regions became. Parliamentary 2024 uses a published regional seat table. Parliamentary 2020 is national seats only. Local assembly vote totals are not archived." },
      ],
    };
  }

  const PARTY_NAME = {
    NPP: "New Patriotic Party",
    NDC: "National Democratic Congress",
    GUM: "Ghana Union Movement",
    CPP: "Convention People's Party",
    GFP: "Ghana Freedom Party",
    GCPP: "Great Consolidated Popular Party",
    APC: "All People's Congress",
    LPG: "Liberal Party of Ghana",
    PNC: "People's National Convention",
    PPP: "Progressive People's Party",
    NDP: "National Democratic Party",
    IND: "Independent",
  };

  function partyName(code) {
    return PARTY_NAME[code] || code || "";
  }

  function sharePct(votes, valid) {
    const v = Number(votes);
    const w = Number(valid);
    if (!Number.isFinite(v) || !Number.isFinite(w) || w <= 0) return null;
    return Math.round((1000 * v) / w) / 10;
  }

  function presBallots() {
    const rows = [];
    YEARS.pres.forEach((year) => {
      const pack = packFor("pres", year);
      if (!pack || !Array.isArray(pack.candidates)) return;
      const meta = pack.meta || {};
      const valid = Number(meta.validVotes) || 0;
      const ranked = pack.candidates.slice().sort((a, b) => (Number(b.votes) || 0) - (Number(a.votes) || 0));
      const runner = ranked[1] && ranked[1].name;
      pack.candidates.forEach((c) => {
        const declared = !!(meta.declaredWinner && c.name === meta.declaredWinner);
        rows.push({
          year: year,
          name: c.name,
          abbr: c.party,
          party: partyName(c.party),
          votes: Number(c.votes) || 0,
          valid: valid,
          note: declared ? "Won" : (c.name === runner ? "Runner-up" : "Contested"),
          color: partyColor(c.party),
        });
      });
    });
    return rows;
  }

  function candidatePage(app) {
    const state = (app && app.state) || {};
    const offices = [
      { v: "pres", l: "Presidential" },
      { v: "parl", l: "Parliamentary" },
      { v: "local", l: "Local assemblies" },
    ];
    let co = offices.some((o) => o.v === state.candOffice) ? state.candOffice : "pres";
    const yearList = (YEARS[co] || []).slice();
    let cy = String(state.candYear || yearList[0] || "");
    if (yearList.indexOf(cy) < 0) cy = yearList[0] || "";
    const officeLabel = (offices.find((o) => o.v === co) || offices[0]).l;
    const outcomeFilter = state.candOutcome || null;
    const partyFilter = state.candParty || null;
    const all = co === "pres" ? presBallots().filter((row) => row.year === cy) : [];
    const partyOptions = [];
    const seen = {};
    all.forEach((row) => {
      if (!row.abbr || seen[row.abbr]) return;
      seen[row.abbr] = true;
      partyOptions.push({ v: row.abbr, l: row.abbr + " · " + row.party });
    });
    partyOptions.sort((a, b) => a.v.localeCompare(b.v));
    let shown = all.slice();
    if (outcomeFilter) shown = shown.filter((row) => row.note.toLowerCase() === outcomeFilter || (outcomeFilter === "won" && row.note === "Won") || (outcomeFilter === "runner-up" && row.note === "Runner-up") || (outcomeFilter === "contested" && row.note === "Contested"));
    if (partyFilter) shown = shown.filter((row) => row.abbr === partyFilter);
    const sel = state.selCandidate;
    const emptyHint = co === "parl"
      ? "Parliamentary candidate names are not in this pack. Regional seat counts for 2024 are on the overview map."
      : (co === "local"
        ? "Local assembly elections are non-partisan. No party candidate list is loaded."
        : "No presidential candidates are loaded for this year.");
    const ngCandidates = {
      years: yearList,
      yearVal: cy,
      onYear: (e) => app.setState({ candYear: e.target.value, candParty: null, selCandidate: null }),
      offices: offices,
      officeVal: co,
      onOffice: (e) => {
        const next = e.target.value;
        const years = YEARS[next] || [];
        const nextYear = years.indexOf(String(state.candYear)) >= 0 ? String(state.candYear) : (years[0] || "");
        app.setState({ candOffice: next, candYear: nextYear, candOutcome: null, candParty: null, selCandidate: null });
      },
      showStateFilter: false,
      showDistrictFilter: false,
      showPartyFilter: partyOptions.length > 0,
      outcomeVal: outcomeFilter || "",
      outcomeOptions: [
        { v: "", l: "All outcomes" },
        { v: "won", l: "Winners" },
        { v: "runner-up", l: "Runner-up" },
        { v: "contested", l: "Contested" },
      ],
      onOutcome: (e) => app.setState({ candOutcome: e.target.value || null, selCandidate: null }),
      partyVal: partyFilter || "",
      partyOptions: partyOptions,
      onParty: (e) => app.setState({ candParty: e.target.value || null, selCandidate: null }),
      resetFilters: () => app.setState({ candYear: "2024", candOffice: "pres", candOutcome: null, candParty: null, selCandidate: null }),
      title: [cy, officeLabel, outcomeFilter, partyFilter].filter(Boolean).join(" · "),
      count: shown.length,
      empty: all.length === 0,
      hasList: all.length > 0,
      emptyHint: emptyHint,
      filterEmpty: all.length > 0 && shown.length === 0,
      needPick: shown.length > 0 && !sel,
      list: shown.map((row) => {
        const active = !!(sel && sel.name === row.name && sel.party === row.abbr);
        return {
          name: row.name,
          abbr: row.abbr,
          party: row.party,
          note: row.note,
          color: row.color,
          subtitle: "",
          initials: row.name.split(/\s+/).map((w) => w[0]).filter(Boolean).slice(0, 2).join("").toUpperCase(),
          hasPhoto: false,
          noPhoto: true,
          onClick: () => app.selectCandidate({ name: row.name, abbr: row.abbr, party: row.abbr, year: row.year }),
          cardStyle: "display:block;width:100%;background:var(--surface);border:1px solid " + (active ? "var(--primary)" : "var(--border)") + ";border-radius:12px;padding:0;cursor:pointer;font-family:inherit;text-align:left;box-shadow:" + (active ? "0 0 0 1px var(--primary)" : "none"),
        };
      }),
    };
    let ngCandidateDetail = null;
    if (sel && co === "pres" && all.length) {
      const entry = all.find((row) => row.name === sel.name && row.abbr === (sel.party || sel.abbr)) || null;
      if (entry) {
        const history = presBallots().filter((row) => row.name === entry.name).map((row) => ({
          year: row.year,
          title: row.abbr + " · Presidential",
          detail: fmt(row.votes) + " votes" + (row.note === "Won" ? " · declared winner" : ""),
        }));
        const share = entry.valid ? sharePct(entry.votes, entry.valid) : null;
        ngCandidateDetail = {
          name: entry.name,
          fullName: entry.name,
          initials: entry.name.split(/\s+/).map((w) => w[0]).filter(Boolean).slice(0, 2).join("").toUpperCase(),
          color: entry.color,
          partyLabel: entry.abbr + " · " + entry.party,
          year: entry.year,
          outcome: entry.note,
          runningMate: null,
          summary: entry.name + " was the " + entry.party + " presidential candidate in " + entry.year + ".",
          biography: [{ text: "The loaded result pack records " + fmt(entry.votes) + " votes" + (entry.valid ? (" out of " + fmt(entry.valid) + " valid votes") : " on the two-candidate regional sheet") + ". No further biography is stored." }],
          hasBio: true,
          history: history,
          hasHistory: history.length > 0,
          roles: [],
          hasRoles: false,
          hasPhoto: false,
          noPhoto: true,
          photo: null,
          wiki: null,
          hasShare: entry.votes != null,
          shareLabel: (share != null ? (share.toFixed(1) + "% · ") : "") + fmt(entry.votes) + " votes",
          close: () => app.selectCandidate(null),
          footer: "Profiles summarise the loaded Ghana result packs. No photograph is stored for these candidates.",
        };
      }
    }
    return { ngCandidates: ngCandidates, ngCandidateDetail: ngCandidateDetail };
  }

  function unitShare(unit, party) {
    const total = unitVotes(unit);
    if (!total) return null;
    return (100 * (Number((unit.votes || {})[party]) || 0)) / total;
  }

  function topTwoMargin(unit) {
    const rows = Object.keys(unit.votes || {}).map((key) => Number(unit.votes[key]) || 0).sort((a, b) => b - a);
    const total = unitVotes(unit);
    if (rows.length < 2 || !total) return null;
    return (100 * (rows[0] - rows[1])) / total;
  }

  function geoRows(contest, year) {
    const painted = theme(contest, year);
    const seen = {};
    const rows = [];
    REGIONS.forEach((region) => {
      const unit = painted.units[region.name];
      if (!unit) return;
      const key = unit.parent || region.name;
      if (seen[key]) return;
      seen[key] = true;
      rows.push({ name: key, unit: unit });
    });
    return rows;
  }

  function nationalRows(pack) {
    if (!pack) return [];
    if (Array.isArray(pack.candidates) && pack.candidates.length) {
      const valid = Number(pack.meta && pack.meta.validVotes) || pack.candidates.reduce((sum, row) => sum + (Number(row.votes) || 0), 0);
      return pack.candidates.map((row) => ({
        party: row.party,
        share: valid ? (100 * (Number(row.votes) || 0)) / valid : null,
        votes: Number(row.votes) || 0,
      }));
    }
    if (Array.isArray(pack.seats) && pack.seats.length) {
      const total = Number(pack.totalSeats) || pack.seats.reduce((sum, row) => sum + (Number(row.seats) || 0), 0);
      return pack.seats.map((row) => ({
        party: row.party,
        share: total ? (100 * (Number(row.seats) || 0)) / total : null,
        seats: Number(row.seats) || 0,
      }));
    }
    return [];
  }

  function analysisBundle(state) {
    if (!PACKS) return { ok: false };
    const offices = [
      { id: "pres", label: "Presidential", years: YEARS.pres.slice() },
      { id: "parl", label: "Parliamentary", years: YEARS.parl.slice() },
      { id: "local", label: "Local assemblies", years: YEARS.local.slice() },
    ];
    let office = offices.some((row) => row.id === state.anaOffice) ? state.anaOffice : "pres";
    const years = (YEARS[office] || []).slice();
    let year = String(state.anaYear || years[0] || "");
    if (years.indexOf(year) < 0) year = years[0] || "";
    let compare = state.anaCompare == null ? "" : String(state.anaCompare);
    if (!compare && state.anaCompare == null) {
      const older = years.filter((y) => Number(y) < Number(year));
      compare = older[0] || "";
    }
    if (compare === year || years.indexOf(compare) < 0) compare = "";
    const partyFilter = state.anaParty && state.anaParty !== "all" ? state.anaParty : "";
    const regionFilter = state.anaRegion && state.anaRegion !== "all" ? state.anaRegion : "";
    const pack = packFor(office, year);
    const prevPack = compare ? packFor(office, compare) : null;
    const current = nationalRows(pack);
    const previous = nationalRows(prevPack);
    const prevByParty = {};
    previous.forEach((row) => { prevByParty[row.party] = row.share; });
    const seatPack = packFor("parl", year);
    const seatByParty = {};
    nationalRows(seatPack).forEach((row) => { seatByParty[row.party] = row.share; });
    const voteShare = current.map((row) => {
      const previousShare = prevByParty[row.party] != null ? Math.round(prevByParty[row.party] * 10) / 10 : null;
      const currentShare = row.share != null ? Math.round(row.share * 10) / 10 : null;
      return {
        party: row.party,
        color: partyColor(row.party),
        currentShare: office === "parl" ? null : currentShare,
        previousShare: office === "parl" ? null : previousShare,
        seatShare: seatByParty[row.party] != null ? Math.round(seatByParty[row.party] * 10) / 10 : (office === "parl" ? currentShare : null),
        deltaShare: (currentShare != null && previousShare != null) ? Math.round((currentShare - previousShare) * 10) / 10 : null,
      };
    });
    const seatVsVote = ["NDC", "NPP"].map((party) => {
      const votes = voteShare.find((row) => row.party === party);
      const seats = seatByParty[party];
      if (!votes || votes.currentShare == null || seats == null) return null;
      return { party: party, color: partyColor(party), voteShare: votes.currentShare, seatShare: Math.round(seats * 10) / 10 };
    }).filter(Boolean);
    const meta = (pack && pack.meta) || {};
    const focusParty = partyFilter || meta.declaredParty || (voteShare[0] && voteShare[0].party) || "NDC";
    let units = geoRows(office, year);
    if (regionFilter) units = units.filter((row) => row.name === regionFilter);
    const prevUnits = compare ? geoRows(office, compare) : [];
    const prevUnitByName = {};
    prevUnits.forEach((row) => { prevUnitByName[row.name] = row.unit; });
    const geographicUnits = units.map((row) => {
      const share = unitShare(row.unit, focusParty);
      const prevUnit = prevUnitByName[row.name];
      const prevShare = prevUnit ? unitShare(prevUnit, focusParty) : null;
      const swing = (share != null && prevShare != null) ? Math.round((share - prevShare) * 10) / 10 : null;
      const margin = topTwoMargin(row.unit);
      return {
        state: row.name,
        name: row.name,
        region: row.name,
        winner: row.unit.winner,
        winnerParty: row.unit.party,
        previousWinner: prevUnit ? prevUnit.party : null,
        marginPct: margin != null ? Math.round(margin * 10) / 10 : null,
        swings: swing != null ? { [focusParty]: swing } : {},
        flipped: !!(prevUnit && prevUnit.party && prevUnit.party !== row.unit.party),
        focusShare: share != null ? Math.round(share * 10) / 10 : null,
      };
    });
    const ranked = geographicUnits.filter((row) => row.focusShare != null).slice().sort((a, b) => b.focusShare - a.focusShare);
    const declared = meta.declaredWinner ? (meta.declaredWinner + " (" + (meta.declaredParty || "") + ") is the declared winner for " + year + ".") : "";
    const narrative = office === "local"
      ? "Local assembly results are not archived. These elections are non-partisan."
      : (office === "parl"
        ? (year + " parliamentary figures use the loaded seat pack. " + (meta.source || ""))
        : (declared + " Regional colour is plurality of valid votes. " + (year === "2016" ? "The 2016 sheet is the ten regions of that election." : "")));
    const trendYears = (YEARS.pres || []).slice().sort();
    const trendParties = ["NDC", "NPP"];
    const voteShareTrend = trendParties.map((party) => ({
      party: party,
      color: partyColor(party),
      values: trendYears.map((y) => {
        const hit = nationalRows(packFor("pres", y)).find((row) => row.party === party);
        return hit && hit.share != null ? Math.round(hit.share * 10) / 10 : null;
      }),
    }));
    const seatShareTrend = trendParties.map((party) => ({
      party: party,
      color: partyColor(party),
      values: trendYears.map((y) => {
        const hit = nationalRows(packFor("parl", y)).find((row) => row.party === party);
        return hit && hit.share != null ? Math.round(hit.share * 10) / 10 : null;
      }),
    }));
    return {
      ok: true,
      generatedAt: String(state.ghPacksReady || year),
      filters: { office: office, year: year, compare: compare, party: partyFilter || "all", region: regionFilter || "all" },
      offices: offices,
      regions: REGIONS.map((region) => region.name),
      partyColors: { NPP: "#003DA5", NDC: "#067647", IND: "#64748b" },
      summary: { narrative: narrative },
      drivers: [
        { icon: "emoji_events", title: "Declared", text: meta.declaredWinner || "No national declaration in this pack", value: meta.declaredParty || "—", unit: "" },
        { icon: "map", title: "Units in view", text: regionFilter || "All regions", value: String(geographicUnits.length), unit: "" },
      ],
      performance: {
        focusParty: focusParty,
        voteShare: voteShare,
        seatVsVote: seatVsVote,
        strongest: ranked.slice(0, 5).map((row) => ({ state: row.state, share: row.focusShare })),
        weakest: ranked.slice().reverse().slice(0, 5).map((row) => ({ state: row.state, share: row.focusShare })),
        incumbent: { note: meta.attribution || "" },
      },
      geographic: {
        mode: "region",
        focusParty: focusParty,
        hasLga: false,
        units: geographicUnits,
        regions: geographicUnits.map((row) => ({ region: row.state, wins: row.winnerParty === focusParty ? 1 : 0, voteShare: row.focusShare })),
        mapHint: "Choropleth stays on the Ghana overview. These charts use the same regional packs.",
        gained: geographicUnits.filter((row) => row.flipped && row.winnerParty === focusParty),
        lost: geographicUnits.filter((row) => row.flipped && row.previousWinner === focusParty),
      },
      turnout: {
        current: (meta.cast && meta.register) ? Math.round((1000 * meta.cast) / meta.register) / 10 : null,
        note: (meta.cast && meta.register) ? "National turnout from the declaration pack." : "Regional turnout is not in this pack.",
        byUnit: [],
      },
      competitiveness: {
        distribution: geographicUnits.map((row) => row.marginPct).filter((value) => value != null),
      },
      history: {
        years: trendYears,
        voteShareTrend: voteShareTrend,
        seatShareTrend: seatShareTrend,
        turnout: [],
      },
      demographics: { available: false },
      prediction: {},
      sources: [
        { office: "pres", years: YEARS.pres.slice() },
        { office: "parl", years: YEARS.parl.slice(), seatsLatest: 276 },
      ],
      availability: { turnoutNational: !!(meta.cast && meta.register) },
    };
  }

  global.EIDGhana = { REGIONS, CONTESTS, PARTIES, YEARS, load, theme, partyColor, view, candidatePage, analysisBundle };
})(window);
