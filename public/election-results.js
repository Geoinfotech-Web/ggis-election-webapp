const numberFormat = new Intl.NumberFormat('en-NG');
const results = { date: document.getElementById('resultDate'), winner: document.getElementById('winnerHeading'), party: document.getElementById('winnerParty'), votes: document.getElementById('winnerVotes'), lgas: document.getElementById('lgasWon'), accredited: document.getElementById('accreditedVoters'), valid: document.getElementById('validVotes'), rejected: document.getElementById('rejectedVotes'), candidates: document.getElementById('candidateResults'), count: document.getElementById('candidateCount'), sources: document.getElementById('resultSources'), news: document.getElementById('newsFeed'), refresh: document.getElementById('refreshResultsButton') };
const stateDetails = document.getElementById('stateMapDetails');
const resetMapButton = document.getElementById('resetElectionMap');
let selectedState = 'Ekiti'; let electionMap; let electionLayer;
const escapeHtml = (value) => String(value || '').replace(/[&<>'"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[character]);
const stateKey = (value) => String(value || '').trim().toLowerCase().replace(/\s+state$/, '');
const formatDate = (value) => new Date(`${value}T12:00:00`).toLocaleDateString('en-NG', { dateStyle: 'long' });

function render(result, news = []) {
  const candidates = [...result.candidates].sort((a, b) => b.votes - a.votes); const maxVotes = candidates[0]?.votes || 1;
  results.date.textContent = `Election held ${formatDate(result.electionDate)} • Declared ${formatDate(result.declaredDate)}`;
  results.winner.textContent = result.winner.name; results.party.textContent = result.winner.party; results.votes.textContent = numberFormat.format(result.winner.votes);
  results.lgas.textContent = result.totals.lgAsWon == null ? '—' : numberFormat.format(result.totals.lgAsWon); results.accredited.textContent = numberFormat.format(result.totals.accreditedVoters); results.valid.textContent = numberFormat.format(result.totals.validVotes); results.rejected.textContent = numberFormat.format(result.totals.rejectedVotes); results.count.textContent = `${candidates.length} candidates`;
  results.candidates.innerHTML = candidates.map((candidate, index) => `<div class="candidate-row ${index === 0 ? 'is-winner' : ''}"><span class="candidate-rank">${index + 1}</span><div class="candidate-info"><strong>${escapeHtml(candidate.name)}</strong><span>${escapeHtml(candidate.party)}</span><div class="vote-bar"><i style="width:${Math.max(1.5, candidate.votes / maxVotes * 100)}%"></i></div></div><strong class="candidate-votes">${numberFormat.format(candidate.votes)}</strong></div>`).join('');
  results.sources.innerHTML = result.sources.map((source) => `<a href="${escapeHtml(source.url)}" target="_blank" rel="noopener noreferrer"><strong>${escapeHtml(source.publisher)}</strong><span>${escapeHtml(source.title)}</span><b>Read source ↗</b></a>`).join('');
  results.news.innerHTML = news.length ? news.map((article) => `<a href="${escapeHtml(article.url)}" target="_blank" rel="noopener noreferrer"><strong>${escapeHtml(article.title)}</strong><span>${escapeHtml(article.source || 'News source')}</span></a>`).join('') : '<p class="loading-copy">No fresh headlines returned right now. The verified result sources above remain available.</p>';
}

function renderStateDetails(payload) {
  const records = [payload.latest, ...(payload.history || [])].filter(Boolean);
  if (!records.length) { stateDetails.innerHTML = `<p class="page-kicker">Selected state</p><h3>${escapeHtml(payload.state)}</h3><span class="state-status pending">Archive being added</span><p>No declared vote table is curated for this state yet. The live news lookup has been refreshed for its election coverage.</p>`; return; }
  const latest = records[0];
  stateDetails.innerHTML = `<p class="page-kicker">Selected state</p><h3>${escapeHtml(payload.state)}</h3><span class="state-status completed">${records.length} election records</span><p><strong>${escapeHtml(latest.winner.name)}</strong> (${escapeHtml(latest.winner.party)}) won the latest recorded election with <strong>${numberFormat.format(latest.winner.votes)}</strong> votes.</p><div class="state-history"><h4>Election history</h4>${records.map((record, index) => `<button class="history-result" data-record-index="${index}" type="button"><strong>${escapeHtml(record.election)}</strong><span>${escapeHtml(record.winner.name)} (${escapeHtml(record.winner.party)}) · ${numberFormat.format(record.winner.votes)} votes</span></button>`).join('')}</div><button id="viewStateResult" type="button">View selected result details</button>`;
  stateDetails.querySelectorAll('.history-result').forEach((button) => button.addEventListener('click', () => { render(records[Number(button.dataset.recordIndex)], payload.news || []); document.getElementById('resultDetails').scrollIntoView({ behavior: 'smooth', block: 'start' }); }));
  document.getElementById('viewStateResult').addEventListener('click', () => document.getElementById('resultDetails').scrollIntoView({ behavior: 'smooth', block: 'start' }));
}

async function loadState(stateName) {
  selectedState = stateName; stateDetails.innerHTML = `<p class="page-kicker">Selected state</p><h3>${escapeHtml(stateName)}</h3><p>Loading election records and recent coverage…</p>`;
  try { const response = await fetch(`/api/election-results?state=${encodeURIComponent(stateName)}`, { cache: 'no-store' }); if (!response.ok) throw new Error('Unable to load state election history.'); const payload = await response.json(); if (payload.latest) render(payload.latest, payload.news || []); renderStateDetails(payload); } catch (error) { stateDetails.innerHTML = `<p class="page-kicker">Selected state</p><h3>${escapeHtml(stateName)}</h3><p>${escapeHtml(error.message)}</p>`; }
}

async function initialiseElectionMap() {
  try { const response = await fetch('data/boundaries/adm1.zip'); if (!response.ok) throw new Error('State boundaries could not be loaded.'); const boundaryData = await shp(await response.arrayBuffer()); electionMap = L.map('electionResultsMap', { scrollWheelZoom: false, preferCanvas: true }).setView([9.08, 8.68], 6); L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', { maxZoom: 18, attribution: '&copy; OpenStreetMap &copy; CARTO' }).addTo(electionMap);
    electionLayer = L.geoJSON(boundaryData, { filter: (feature) => stateKey(feature.properties?.NAME_1) !== 'water body', style: { color: '#294857', weight: 1.2, fillColor: '#25a96d', fillOpacity: .82 }, onEachFeature: (feature, layer) => { const name = feature.properties?.NAME_1 || 'State'; layer.bindTooltip(`${name}: view election results and history`, { sticky: true }); layer.on({ click: () => { electionLayer.resetStyle(); layer.setStyle({ weight: 3, color: '#f6c453' }); electionMap.fitBounds(layer.getBounds(), { padding: [24, 24], maxZoom: 8 }); loadState(name); }, mouseover: () => layer.setStyle({ weight: 2, fillOpacity: 1 }), mouseout: () => electionLayer.resetStyle(layer) }); } }).addTo(electionMap);
    electionMap.fitBounds(electionLayer.getBounds(), { padding: [12, 12] }); resetMapButton.addEventListener('click', () => { electionMap.fitBounds(electionLayer.getBounds(), { padding: [12, 12] }); loadState(selectedState); }); window.requestAnimationFrame(() => electionMap.invalidateSize());
  } catch (error) { stateDetails.innerHTML = `<p class="page-kicker">Map unavailable</p><h3>Unable to load state boundaries</h3><p>${escapeHtml(error.message)}</p>`; }
}
async function loadResults() { results.refresh.disabled = true; results.refresh.textContent = 'Refreshing…'; await loadState(selectedState); results.refresh.disabled = false; results.refresh.textContent = 'Refresh results'; }
results.refresh.addEventListener('click', loadResults); initialiseElectionMap(); loadResults();
