import { evaluate, normaliseApplication, normaliseTerritory, DEFAULT_CONFIG, OUTCOMES, CITIES, normPin } from './engine.js';
import { parseWorkbook } from './workbook.js';
import { interpret, diff, diffHtml, evLabel } from './copilot.js';
import { buildPlan, partnerMessage } from './plan.js';

const $ = s => document.querySelector(s);
const esc = x => String(x ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const chip = o => `<span class="pill t-${OUTCOMES[o]?.tone}">${OUTCOMES[o]?.label || o}</span>`;
const fmt = v => (v === null || v === undefined || Number.isNaN(v)) ? '—' : String(Math.round(v * 10) / 10);
const toneColor = { go: '#1f7a4d', info: '#2556a8', wait: '#c08a1a', warn: '#c4501f', hold: '#5b4fa3', stop: '#9b1c1c', muted: '#8a8d96' };

const S = {
  base: null, report: null, fileName: '', patches: [], cfg: structuredClone(DEFAULT_CONFIG), res: null,
  geo: {}, tab: 'overview', filter: 'ALL', q: '', sort: { k: 'rank', dir: 1 }, focus: null, map: null, mapCity: 'All', chatHistory: [],
};

// ---------- data pipeline ----------
function currentInput() {
  const apps = S.base.applications.map(a => ({ ...a }));
  const terrs = S.base.territories.map(t => ({ ...t, pins: [...t.pins] }));
  for (const p of S.patches) {
    if (p.type === 'app') { const i = apps.findIndex(a => a.id === p.id); if (i >= 0) apps[i] = { ...apps[i], ...p.patch }; }
    if (p.type === 'ter') {
      const t = terrs.find(x => x.id === p.id); if (!t) continue;
      if ('slots' in p.patch) t.slots = p.patch.slots;
      if ('priority' in p.patch) t.priority = p.patch.priority;
      if (p.patch.addPins) for (const n of p.patch.addPins) if (!t.pins.includes(n)) t.pins.push(n);
    }
  }
  return { applications: apps, territories: terrs, stores: S.base.stores };
}
function recompute() { S.res = evaluate(currentInput(), S.cfg, S.geo); return S.res; }

async function loadBytes(bytes, name) {
  try {
    let wb = parseWorkbook(XLSX, bytes);
    if (!wb.applications.length && wb.report.samplesExcluded.length) { wb = parseWorkbook(XLSX, bytes, { includeSamples: true }); wb.report.warnings.push('Only the template example rows were found, so they were included as real data.'); }
    S.base = { applications: wb.applications.map(normaliseApplication), territories: wb.territories.map(normaliseTerritory), stores: wb.stores };
    S.report = wb.report; S.fileName = name; S.patches = []; S.focus = null;
    recompute();
    $('#fileName').hidden = false; $('#fileName').textContent = `${name} · ${S.base.applications.length} applications`;
    $('#btnExport').hidden = false;
    S.tab = 'overview'; render();
    $('#cpLog').innerHTML = '';
    say('ai', `Read <b>${esc(name)}</b>: ${S.base.applications.length} applications, ${S.base.territories.length} territories, ${S.res.stores.length} existing stores.${S.report.samplesExcluded.length ? ` Skipped the grey template example row(s).` : ''} ${S.res.invariants.ok ? '✓ All three hard rules hold.' : '⚠ Rule check failed — see Data check.'}<br><br>${helpChips()}`);
    fillGeo();
  } catch (e) {
    console.error(e);
    toast(`Couldn't read that file: ${e.message}`);
    if (!S.base) renderLanding(e.message);
  }
}

async function loadDemo() {
  const buf = await (await fetch('data/demo.xlsx')).arrayBuffer();
  loadBytes(new Uint8Array(buf), 'Demo workbook (24 applicants)');
}

// geocode pins we don't have yet (OpenStreetMap Nominatim, 1 req/s, cached in the browser)
async function fillGeo() {
  let cache = {};
  try { cache = JSON.parse(localStorage.getItem('sthala-geo') || '{}'); } catch { }
  Object.assign(S.geo, cache);
  const pins = new Set();
  S.base.applications.forEach(a => a.pin && pins.add(a.pin));
  S.base.territories.forEach(t => t.pins.forEach(p => pins.add(p)));
  S.res.stores.forEach(s => s.pin && pins.add(s.pin));
  const missing = [...pins].filter(p => !S.geo[p]).slice(0, 40);
  let added = 0;
  for (const p of missing) {
    try {
      const r = await fetch(`https://nominatim.openstreetmap.org/search?postalcode=${p}&country=India&format=json&limit=1`);
      const d = await r.json();
      if (d[0]) { S.geo[p] = { lat: +d[0].lat, lng: +d[0].lon, area: '' }; cache[p] = S.geo[p]; added++; }
    } catch { break; }
    await new Promise(r => setTimeout(r, 1100));
  }
  if (added) { try { localStorage.setItem('sthala-geo', JSON.stringify(cache)); } catch { } recompute(); render(); }
}

// ---------- rendering ----------
function render() {
  if (!S.base) return renderLanding();
  const c = counts();
  const tabs = [['overview', 'Overview'], ['applicants', 'Applicants', S.res.recs.length], ['map', 'Map'], ['territories', 'Territories', S.res.territories.length], ['assumptions', 'Assumptions'], ['data', 'Data check', S.res.dataIssues.length + S.res.recs.filter(r => r.issues.some(i => i.gate === 'data')).length || '']];
  $('#main').innerHTML = `<nav class="tabs">${tabs.map(([k, l, n]) => `<button class="tab ${S.tab === k ? 'on' : ''}" data-tab="${k}">${l}${n !== undefined && n !== '' ? `<span class="n">${n}</span>` : ''}</button>`).join('')}</nav><div id="view"></div>`;
  const v = $('#view');
  ({ overview: viewOverview, applicants: viewApplicants, map: viewMap, territories: viewTerritories, assumptions: viewAssumptions, data: viewData })[S.tab](v, c);
}

function counts() { const c = {}; S.res.recs.forEach(r => c[r.outcome] = (c[r.outcome] || 0) + 1); return c; }

function renderLanding(err) {
  $('#main').innerHTML = `<section class="hero">
    <span class="eyebrow">Case 1 · Franchise partner acquisition, geo-selection & onboarding</span>
    <h1>From application to <em>open, trained store</em> — decided, explained, scheduled.</h1>
    <p class="lead">Drop in the Applications + Territories workbook. Sthala checks every partner, matches pins to territories, enforces one store per pin, ranks competing partners, maps catchment overlap, and builds each partner's onboarding plan in their own language.</p>
    <div class="drop" id="drop">
      <div class="big">Drop your .xlsx here</div>
      <div class="muted">Use the official template as-is — no renaming, no reformatting.</div>
      ${err ? `<div class="banner bad" style="margin-top:12px">${esc(err)}</div>` : ''}
      <div class="row"><button class="btn primary" id="lpUpload">Upload workbook</button><button class="btn" id="lpDemo">Try the demo data →</button></div>
    </div>
    <div class="steps">
      <div class="step"><span class="k">01 · READ</span><b>Accepts the template as-is</b><p>Finds sheets by their headers, skips the grey example row, cleans pins like 570001.0.</p></div>
      <div class="step"><span class="k">02 · CHECK</span><b>Three gates, not one score</b><p>Location, partner and site are judged separately — a good partner with a bad pin is relocated, not rejected.</p></div>
      <div class="step"><span class="k">03 · ALLOCATE</span><b>Hard rules in code</b><p>One store per pin, never on an existing store's pin, never over a territory's open slots.</p></div>
      <div class="step"><span class="k">04 · ONBOARD</span><b>Plan + message</b><p>Week-by-week path to opening day, training track by experience, WhatsApp note in Kannada, Hindi or English.</p></div>
    </div></section>`;
  $('#lpUpload').onclick = () => $('#fileInput').click();
  $('#lpDemo').onclick = loadDemo;
  const d = $('#drop');
  d.ondragover = e => { e.preventDefault(); d.classList.add('over'); };
  d.ondragleave = () => d.classList.remove('over');
  d.ondrop = e => { e.preventDefault(); d.classList.remove('over'); const f = e.dataTransfer.files[0]; if (f) readFile(f); };
  if (!$('#cpLog').innerHTML) say('ai', `Hi! Upload a workbook (or try the demo) and I'll explain every decision. You can also give me new facts and I'll re-run the allocation for everyone.`);
}

function viewOverview(v, c) {
  const res = S.res;
  const kp = [['ALL', 'Applications', res.recs.length, '#1b1f2a'], ['SHORTLIST', 'Shortlisted', (c.SHORTLIST || 0), toneColor.go], ['SHORTLIST_CONDITIONAL', 'Conditional', c.SHORTLIST_CONDITIONAL || 0, '#4c9a72'],
    ['PREQUALIFIED', 'Pre-qualified', c.PREQUALIFIED || 0, toneColor.info], ['WAITLIST', 'Waitlisted', c.WAITLIST || 0, toneColor.wait], ['RELOCATE', 'Relocate', c.RELOCATE || 0, toneColor.warn],
    ['HOLD', 'On hold', c.HOLD || 0, toneColor.hold], ['OUT_OF_PLAN', 'Outside map', (c.OUT_OF_PLAN || 0) + (c.NOT_PROCEEDING || 0) + (c.WITHDRAWN || 0), toneColor.muted]];
  const totalSlots = Object.values(res.territoryState).reduce((a, s) => a + (s.territory.slots ?? 0), 0);
  const used = Object.values(res.territoryState).reduce((a, s) => a + s.used, 0);
  const prOrder = { High: 0, Medium: 1, Low: 2 };
  const terrs = Object.values(res.territoryState).sort((a, b) => (prOrder[a.territory.priority] ?? 3) - (prOrder[b.territory.priority] ?? 3) || a.territory.id.localeCompare(b.territory.id));
  v.innerHTML = `
    ${res.invariants.ok ? `<div class="banner ok">✓ <b>Hard rules verified after every change:</b> ${res.invariants.checks.join(' · ')}.</div>` : `<div class="banner bad">⚠ ${res.invariants.errors.map(esc).join(' ')}</div>`}
    ${S.patches.length ? `<div class="banner note">✎ ${S.patches.length} update(s) from the copilot are layered on top of the workbook. <a href="#" id="resetAll">Reset to workbook</a></div>` : ''}
    <div class="kpis">${kp.map(([k, l, n, col]) => `<div class="kpi" data-filter="${k}"><div class="v">${n}</div><div class="l">${l}</div><div class="bar" style="background:${col};width:${res.recs.length ? Math.max(8, n / res.recs.length * 100) : 0}%"></div></div>`).join('')}</div>
    <div class="sec-title"><h2>Territory board</h2><span class="sub">${used} of ${totalSlots} open slots filled · ordered by brand priority</span></div>
    <div class="grid g3">${terrs.map(terrCard).join('')}</div>
    <div class="sec-title"><h2>Team action queue</h2><span class="sub">What the expansion team does next, highest-priority territory first</span></div>
    <div class="card">${actionQueue()}</div>`;
  v.querySelectorAll('.kpi').forEach(k => k.onclick = () => { S.filter = k.dataset.filter; S.tab = 'applicants'; render(); });
  const ra = $('#resetAll'); if (ra) ra.onclick = e => { e.preventDefault(); S.patches = []; recompute(); render(); say('ai', 'Reset — back to the workbook as uploaded.'); };
}

function terrCard(st) {
  const t = st.territory, res = S.res;
  const storePins = new Set(res.stores.map(s => s.pin));
  const taken = new Map(st.shortlisted.map(r => [r.app.pin, r]));
  const contested = new Set(res.recs.filter(r => r.lostPinTo).map(r => r.app.pin));
  const amb = new Set(res.recs.filter(r => r.issues.some(i => i.code === 'PIN_IN_MULTIPLE_TERRITORIES')).map(r => r.app.pin));
  const slots = (t.slots ?? 0) === 0 ? '<span class="slot zero">0 open slots</span>' :
    Array.from({ length: t.slots }, (_, i) => { const r = st.shortlisted[i]; return r ? `<span class="slot ${r.outcome === 'SHORTLIST_CONDITIONAL' ? 'c' : 'f'}" title="${r.app.id}">${r.app.id.replace(/\D/g, '').slice(-3)}</span>` : '<span class="slot" title="open"></span>'; }).join('');
  const line = (lbl, arr, f = r => r.app.id) => arr.length ? `<div class="queue-line">${lbl}: ${arr.map(r => `<a href="#" data-app="${r.app.id}">${f(r)}</a>`).join(', ')}</div>` : '';
  return `<div class="card terr"><div class="hd"><div><h3>${t.id} · ${esc(t.city || t.cityRaw)}</h3><span class="muted">${t.tier || '—'} · ${st.used}/${t.slots ?? 0} filled</span></div><span class="tagp prio-${t.priority}">${t.priority || '—'}</span></div>
    <div class="slots">${slots}</div>
    <div class="pins">${t.pins.map(p => `<span class="pinchip ${storePins.has(p) ? 'store' : amb.has(p) ? 'amb' : taken.has(p) ? 'taken' : contested.has(p) ? 'contested' : ''}" title="${storePins.has(p) ? 'Existing store' : taken.has(p) ? 'Shortlisted: ' + taken.get(p).app.id : ''}">${p}</span>`).join('')}</div>
    ${line('Shortlisted', st.shortlisted)}${line('Waitlist (backfill order)', st.waitlist)}${line('Pre-qualified', st.prequalified)}${line('On hold', st.held)}${line('Relocate', st.relocate)}</div>`;
}

function actionQueue() {
  const pr = { High: 0, Medium: 1, Low: 2 };
  const rank = { SHORTLIST: 0, SHORTLIST_CONDITIONAL: 1, HOLD: 2, PREQUALIFIED: 3, RELOCATE: 4, WAITLIST: 5, OUT_OF_PLAN: 6 };
  const rs = S.res.recs.filter(r => r.outcome in rank).sort((a, b) => (pr[a.territory?.priority] ?? 3) - (pr[b.territory?.priority] ?? 3) || rank[a.outcome] - rank[b.outcome] || b.score - a.score).slice(0, 14);
  return `<table class="tbl"><thead><tr><th>Priority</th><th>Application</th><th>Status</th><th>Next action</th><th>Owner</th></tr></thead><tbody>${rs.map(r => `<tr data-app="${r.app.id}"><td>${r.territory ? `<span class="tagp prio-${r.territory.priority}">${r.territory.priority}</span>` : '<span class="tagp">—</span>'}</td><td><span class="id">${r.app.id}</span> ${esc(r.app.name)}</td><td>${chip(r.outcome)}</td><td class="nx">${esc(r.decision.next[0] || '')}</td><td class="muted">${owner(r)}</td></tr>`).join('')}</tbody></table>`;
}
const owner = r => ({ SHORTLIST: 'Expansion manager', SHORTLIST_CONDITIONAL: 'Expansion manager', HOLD: r.issues.some(i => i.code === 'PIN_IN_MULTIPLE_TERRITORIES') ? 'Expansion lead (master data)' : 'Partner desk', PREQUALIFIED: 'Partner + site scout', RELOCATE: 'Site scout', WAITLIST: 'Partner desk', OUT_OF_PLAN: 'Partner desk' })[r.outcome] || '—';

function viewApplicants(v) {
  const res = S.res;
  const filters = ['ALL', 'SHORTLIST', 'SHORTLIST_CONDITIONAL', 'PREQUALIFIED', 'WAITLIST', 'RELOCATE', 'HOLD', 'OUT_OF_PLAN', 'WITHDRAWN'].filter(f => f === 'ALL' || res.recs.some(r => r.outcome === f));
  v.innerHTML = `<div class="toolbar"><input class="search" id="q" placeholder="Search ID, name, city, pin, territory…" value="${esc(S.q)}">
    ${filters.map(f => `<button class="fchip ${S.filter === f ? 'on' : ''}" data-f="${f}">${f === 'ALL' ? 'All' : OUTCOMES[f].label}</button>`).join('')}</div>
    <div class="tbl-wrap"><table class="tbl"><thead><tr>${[['id', 'ID'], ['name', 'Applicant'], ['city', 'City · Pin'], ['terr', 'Territory'], ['inv', '₹ lakh'], ['exp', 'Yrs'], ['space', 'Space'], ['score', 'Score'], ['rank', 'Decision'], ['next', 'Next action']].map(([k, l]) => `<th data-k="${k}">${l}${S.sort.k === k ? (S.sort.dir > 0 ? ' ↑' : ' ↓') : ''}</th>`).join('')}</tr></thead><tbody id="tb"></tbody></table></div>
    <p class="muted" style="font-size:12px;margin-top:8px">Score compares partners within a territory (capital ${S.cfg.weights.capital}% · experience ${S.cfg.weights.experience}% · site ${S.cfg.weights.site}% · launch ${S.cfg.weights.launch}%). It is not a profit forecast. Click any row for the full reasoning and onboarding plan.</p>`;
  const draw = () => {
    const q = S.q.toLowerCase();
    let rs = res.recs.filter(r => (S.filter === 'ALL' || r.outcome === S.filter) && (!q || [r.app.id, r.app.name, r.app.city, r.app.pin, r.territory?.id, r.app.business, r.app.notes].join(' ').toLowerCase().includes(q)));
    const key = { id: r => r.app.id, name: r => r.app.name, city: r => (r.app.city || '') + r.app.pin, terr: r => r.territory?.id || 'zz', inv: r => r.app.investment ?? -1, exp: r => r.app.experience ?? -1, space: r => r.app.space || '', score: r => r.score, rank: r => OUTCOMES[r.outcome].rank * 1000 - r.score, next: r => r.decision.next[0] || '' }[S.sort.k];
    rs = rs.slice().sort((a, b) => { const x = key(a), y = key(b); return (x > y ? 1 : x < y ? -1 : 0) * S.sort.dir; });
    $('#tb').innerHTML = rs.map(r => `<tr data-app="${r.app.id}"><td class="id">${r.app.id}</td><td>${esc(r.app.name)}${r.flags.some(f => f.code === 'POSSIBLE_DUPLICATE') ? ' <span class="tagp" title="Possible duplicate">dup?</span>' : ''}${S.patches.some(p => p.id === r.app.id) ? ' <span class="tagp" title="Updated via copilot">✎</span>' : ''}</td>
      <td>${esc(r.app.city || r.app.cityRaw)}<br><span class="muted">${r.app.pin || esc(r.app.pinRaw) || '—'}</span></td><td>${r.territory ? `${r.territory.id}<br><span class="tagp prio-${r.territory.priority}">${r.territory.priority}</span>` : '<span class="muted">—</span>'}</td>
      <td>${fmt(r.app.investment)}</td><td>${fmt(r.app.experience)}</td><td>${esc(r.app.space || '—')}${r.app.floor ? `<br><span class="muted">${esc(r.app.floor)}${r.app.size ? ' · ' + r.app.size + ' ft²' : ''}</span>` : ''}</td>
      <td><div class="scorebar"><i style="width:${Math.max(4, r.score * .5)}px"></i>${r.score}</div></td><td>${chip(r.outcome)}</td><td class="nx">${esc(r.decision.headline)}</td></tr>`).join('') || '<tr><td colspan="10" class="muted">No matches.</td></tr>';
  };
  draw();
  $('#q').oninput = e => { S.q = e.target.value; draw(); };
  v.querySelectorAll('.fchip').forEach(b => b.onclick = () => { S.filter = b.dataset.f; render(); });
  v.querySelectorAll('th[data-k]').forEach(th => th.onclick = () => { S.sort = { k: th.dataset.k, dir: S.sort.k === th.dataset.k ? -S.sort.dir : 1 }; render(); });
}

// ---------- detail drawer ----------
function openDetail(id) {
  const r = S.res.recs.find(x => x.app.id === id);
  if (!r) return;
  S.focus = id;
  const a = r.app, f = r.factors, w = S.cfg.weights;
  const gate = (k, val, map) => { const [cls, label] = map[val] || ['na', val]; return `<div class="gate ${cls}"><div class="gk">${k}</div><div class="gv">${label}</div></div>`; };
  const loc = gate('Location', r.gates.location, { ok: ['ok', `✓ ${r.territory?.id || ''}`], blocked: ['bad', '✕ Pin taken'], outside: ['warn', 'Outside map'], hold: ['bad', '? Unclear'] });
  const par = gate('Partner', r.gates.partner, { ok: ['ok', '✓ Screen-ready'], hold: ['bad', '? Info missing'], review: ['warn', '! Funding proof'], fail: ['bad', '✕ Policy'] });
  const sit = gate('Site', r.gates.site, { ok: ['ok', '✓ Site ready'], conditional: ['warn', '~ Conditional'], none: ['warn', 'No site yet'], hold: ['bad', '? Details missing'] });
  const slotV = r.outcome.startsWith('SHORTLIST') ? ['ok', `✓ Slot ${r.territoryRank}/${r.territory.slots}`] : r.outcome === 'WAITLIST' ? ['warn', r.waitReason === 'BAR' ? 'Below bar' : `#${r.territoryRank} in queue`] : r.outcome === 'RELOCATE' && r.lostPinTo ? ['bad', `Lost to ${r.lostPinTo}`] : ['na', 'Not yet'];
  const slot = `<div class="gate ${slotV[0]}"><div class="gk">Slot</div><div class="gv">${slotV[1]}</div></div>`;
  const factor = (label, key, val, raw) => `<div class="factor"><div>${label}<small>${raw}</small></div><div class="tr"><i style="width:${val ?? 0}%"></i></div><div><b>${val ?? '—'}</b><small>×${w[key]}%</small></div></div>`;
  const plan = buildPlan(r);
  const msg = ['WITHDRAWN', 'NOT_PROCEEDING'].includes(r.outcome) ? null : partnerMessage(r);
  const audit = S.patches.filter(p => p.id === id);
  const maxW = plan ? plan.totalWeeks + 12 : 1;
  $('#drawer').innerHTML = `<div class="dr-head"><button class="x" id="drX">×</button>
      <div class="muted" style="font-size:12px">${a.id} · row ${a.row ?? '—'} · ${esc(a.city || a.cityRaw)} ${a.pin || ''}</div>
      <h2>${esc(a.name || '(no name)')}</h2><div style="margin-top:6px;display:flex;gap:8px;align-items:center;flex-wrap:wrap">${chip(r.outcome)}<span class="muted">score ${r.score}</span>${r.territory ? `<span class="tagp prio-${r.territory.priority}">${r.territory.id} · ${r.territory.priority}</span>` : ''}</div></div>
    <div class="dr-body">
      <div class="card"><div class="headline">${esc(r.decision.headline)}</div></div>
      <div class="gates">${loc}${par}${sit}${slot}</div>
      <div class="card"><div class="sec-title" style="margin-top:0"><h2>Why</h2><span class="sub">every line tagged by where it comes from</span></div>
        <ul class="evlist">${r.decision.evidence.map(e => `<li><span class="ev ev-${e.kind}">${evLabel[e.kind]}</span><span>${esc(e.text)}</span></li>`).join('')}</ul></div>
      <div class="grid g2">
        <div class="card"><h3 style="font-size:16px;margin-bottom:8px">Next steps</h3><ol style="margin:0;padding-left:18px">${r.decision.next.map(n => `<li>${esc(n)}</li>`).join('')}</ol>
          ${r.decision.change.length ? `<h3 style="font-size:16px;margin:14px 0 8px">What would change this</h3><ul style="margin:0;padding-left:18px">${r.decision.change.map(n => `<li>${esc(n)}</li>`).join('')}</ul>` : ''}</div>
        <div class="card"><h3 style="font-size:16px;margin-bottom:4px">Score breakdown</h3><div class="muted" style="font-size:11.5px;margin-bottom:6px">Compares partners in ${r.territory?.id || 'the territory'} — not a profit forecast</div>
          ${factor('Capital', 'capital', f.capital, f.ratio !== null ? `₹${fmt(a.investment)}L vs ~₹${f.budget}L budget` : 'missing')}
          ${factor('Experience', 'experience', f.experience, `${fmt(a.experience)} yrs`)}
          ${factor('Site', 'site', f.site, f.siteParts ? `floor ${f.siteParts.floor} · size ${f.siteParts.size} · tenure ${f.siteParts.tenure}` : 'no site — neutral 50')}
          ${factor('Launch', 'launch', f.launch, `${fmt(a.launch)} mo vs ~${f.lead} mo min`)}
          <div style="text-align:right;font-family:var(--serif);font-size:20px;margin-top:6px">${r.score}</div></div>
      </div>
      ${r.alternatives?.length ? `<div class="card"><h3 style="font-size:16px;margin-bottom:8px">Free pins to offer</h3><div class="alt">${r.alternatives.map(x => `<div class="a"><b>${x.pin}</b> ${x.area ? esc(x.area) + ' · ' : ''}${x.territory} · ${x.priority}<br><span class="muted">${x.km !== null ? `~${x.km} km from requested pin` : ''}${x.nearestStoreKm !== null ? ` · nearest store ~${x.nearestStoreKm} km` : ''} · ${x.remaining} slot(s) open</span></div>`).join('')}</div></div>` : ''}
      <div class="card"><h3 style="font-size:16px;margin-bottom:8px">Applicant's own words <span class="ev ev-claim" style="margin-left:6px">unverified</span></h3>
        <dl class="kv"><dt>Business</dt><dd>${esc(a.business) || '—'}</dd><dt>Notes</dt><dd>${esc(a.notes) || '—'}</dd><dt>Training language</dt><dd>${a.language || 'English (default)'}</dd>
        <dt>Competing</dt><dd>${r.competitors.samePin.length ? `Same pin: ${r.competitors.samePin.map(x => `<a href="#" data-app="${x}">${x}</a>`).join(', ')}<br>` : ''}${r.competitors.sameTerritory.length ? `Same territory: ${r.competitors.sameTerritory.map(x => `<a href="#" data-app="${x}">${x}</a>`).join(', ')}` : '—'}</dd>
        ${r.nearestStore ? `<dt>Nearest store</dt><dd>${r.nearestStore.store.id} (${r.nearestStore.store.pin}) ~${r.nearestStore.km} km</dd>` : ''}</dl></div>
      ${plan ? `<div class="card"><div class="sec-title" style="margin-top:0"><h2>Onboarding plan</h2><span class="sub">${plan.provisional ? 'provisional · ' : ''}~${plan.totalWeeks} weeks · opens ~${plan.openDate}</span></div>
        <p style="margin:0 0 10px">${plan.feasibility.startsWith('target') ? `<span class="pill t-warn">${esc(plan.feasibility)}</span>` : `<span class="pill t-go">${esc(plan.feasibility)}</span>`} &nbsp;Training: <b>${plan.track.name}</b> in <b>${plan.language}</b> — ${esc(plan.track.why)}</p>
        <div class="gantt" style="--wk:${100 / maxW}%">${plan.tasks.map(t => `<div class="gr"><div class="gl" title="${esc(t.task)} — ${esc(t.why)} (owner: ${esc(t.owner)})"><b style="color:var(--ink-3);font-weight:600">${t.stage}</b> · ${esc(t.task)}</div><div class="gt"><span class="gb st-${t.stage.split(' ')[0]}" style="left:${t.start / maxW * 100}%;width:${Math.max(1.2, t.weeks / maxW * 100)}%"></span></div></div>`).join('')}</div>
        <details style="margin-top:10px"><summary>Training modules & task owners</summary><ul class="mods">${plan.track.modules.map(m => `<li>${esc(m)}</li>`).join('')}</ul>
        <table class="cmp" style="margin-top:8px"><tr><th>Task</th><th>Owner</th><th>Done when</th></tr>${plan.tasks.map(t => `<tr><td>${esc(t.task)}</td><td>${esc(t.owner)}</td><td>${esc(t.evidence)}</td></tr>`).join('')}</table></details></div>` : ''}
      ${msg ? `<div class="card"><h3 style="font-size:16px;margin-bottom:8px">Message to partner · ${msg.lang}</h3><div class="msg" style="font-family:${msg.lang === 'Kannada' ? "'Noto Sans Kannada'," : msg.lang === 'Hindi' ? "'Noto Sans Devanagari'," : ''}var(--sans)">${esc(msg.text)}</div>
        <div style="display:flex;gap:8px;margin-top:10px"><button class="btn sm" id="copyMsg">Copy</button><a class="btn sm" target="_blank" rel="noopener" href="https://wa.me/?text=${encodeURIComponent(msg.text)}">Open in WhatsApp</a></div>
        ${msg.lang !== 'English' ? `<details style="margin-top:8px"><summary class="muted">English version</summary><p class="muted">${esc(msg.english)}</p></details>` : ''}</div>` : ''}
      ${audit.length ? `<div class="card"><h3 style="font-size:16px;margin-bottom:8px">Update history</h3><ul class="audit">${audit.map(p => `<li><b>${new Date(p.ts).toLocaleTimeString()}</b> — "${esc(p.text)}" → ${esc(p.said.join(', '))}</li>`).join('')}</ul><p class="muted" style="font-size:12px">Workbook row ${a.row} is unchanged; updates are layered on top.</p></div>` : ''}
      <div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn sm" data-ask="Why is ${a.id} ${r.outcome === 'HOLD' ? 'on hold' : 'in this status'}?">Ask copilot why</button><button class="btn sm" data-ask="What would it take for ${a.id} to advance?">What would it take?</button></div>
    </div>`;
  $('#drawer').classList.add('on'); $('#drawerBg').classList.add('on');
  $('#drX').onclick = closeDetail;
  const cm = $('#copyMsg'); if (cm) cm.onclick = () => { navigator.clipboard?.writeText(msg.text); toast('Message copied'); };
}
function closeDetail() { $('#drawer').classList.remove('on'); $('#drawerBg').classList.remove('on'); }

// ---------- map ----------
function viewMap(v) {
  const cities = ['All', ...Object.keys(CITIES).filter(c => S.res.territories.some(t => t.city === c) || S.res.recs.some(r => r.city === c))];
  v.innerHTML = `<div class="map-bar">${cities.map(c => `<button class="fchip ${S.mapCity === c ? 'on' : ''}" data-city="${c}">${c}</button>`).join('')}<span class="muted" style="margin-left:auto;font-size:12px">Pin positions are OpenStreetMap pin-code centroids — approximate, for catchment screening only.</span></div>
    <div id="map"></div>
    <div class="legend"><span><i style="background:#1b1f2a;border-radius:3px"></i>Existing store (${S.cfg.overlapKm} km ring)</span>${['SHORTLIST', 'SHORTLIST_CONDITIONAL', 'PREQUALIFIED', 'WAITLIST', 'RELOCATE', 'HOLD', 'OUT_OF_PLAN'].map(o => `<span><i style="background:${toneColor[OUTCOMES[o].tone]}"></i>${OUTCOMES[o].label}</span>`).join('')}<span><i style="border:2px dashed #7a1f2b;background:transparent"></i>Free pin in an open territory</span></div>`;
  v.querySelectorAll('[data-city]').forEach(b => b.onclick = () => { S.mapCity = b.dataset.city; render(); });
  if (S.map) { S.map.remove(); S.map = null; }
  const map = L.map('map', { scrollWheelZoom: true });
  S.map = map;
  L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}', { attribution: 'Tiles © Esri — Esri, HERE, Garmin, © OpenStreetMap contributors', maxZoom: 16 }).addTo(map);
  L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Reference/MapServer/tile/{z}/{y}/{x}', { maxZoom: 16 }).addTo(map);
  const pts = [];
  const g = S.geo, inCity = c => S.mapCity === 'All' || c === S.mapCity;
  for (const s of S.res.stores) {
    const p = g[s.pin]; if (!p || !inCity(s.city)) continue;
    L.circle([p.lat, p.lng], { radius: S.cfg.overlapKm * 1000, color: '#1b1f2a', weight: 1, dashArray: '4 4', fillOpacity: .05 }).addTo(map);
    L.marker([p.lat, p.lng], { icon: L.divIcon({ className: 'store-ic', html: s.id.replace('ST-', ''), iconSize: [22, 22] }) }).bindPopup(`<b>${s.id}</b> · existing store<br>${s.city} ${s.pin} · opened ${s.year}`).addTo(map);
    pts.push([p.lat, p.lng]);
  }
  const claimed = new Set(S.res.recs.map(r => r.app.pin));
  const storePins = new Set(S.res.stores.map(s => s.pin));
  for (const st of Object.values(S.res.territoryState)) {
    if (!inCity(st.territory.city) || st.remaining <= 0) continue;
    for (const pin of st.territory.pins) {
      const p = g[pin]; if (!p || claimed.has(pin) || storePins.has(pin)) continue;
      L.circleMarker([p.lat, p.lng], { radius: 7, color: '#7a1f2b', weight: 1.5, dashArray: '3 3', fillOpacity: 0 }).bindPopup(`<b>${pin}</b> ${p.area ? '· ' + esc(p.area) : ''}<br>Free pin in ${st.territory.id} (${st.remaining} slot open)`).addTo(map);
      pts.push([p.lat, p.lng]);
    }
  }
  const byPin = {};
  for (const r of S.res.recs) { if (!r.app.pin || !g[r.app.pin] || !inCity(r.city)) continue; (byPin[r.app.pin] ||= []).push(r); }
  for (const [pin, rs] of Object.entries(byPin)) {
    const p = g[pin];
    rs.forEach((r, i) => {
      const off = rs.length > 1 ? (i - (rs.length - 1) / 2) * 0.0025 : 0;
      const col = toneColor[OUTCOMES[r.outcome].tone];
      const m = L.circleMarker([p.lat + off, p.lng + off], { radius: r.outcome.startsWith('SHORTLIST') ? 10 : 8, color: '#fff', weight: 2, fillColor: col, fillOpacity: .95 }).addTo(map);
      m.bindPopup(`<b>${r.app.id}</b> · ${esc(r.app.name)}<br>${chip(r.outcome)}<br><span style="font-size:12px">${esc(r.decision.headline)}</span><br>${r.nearestStore ? `<span class="muted">Nearest store ${r.nearestStore.store.id} ~${r.nearestStore.km} km</span><br>` : ''}<a href="#" data-app="${r.app.id}">Open details →</a>`);
      pts.push([p.lat, p.lng]);
    });
  }
  if (pts.length) map.fitBounds(pts, { padding: [30, 30], maxZoom: 13 }); else map.setView([14.2, 76.2], 7);
}

// ---------- territories ----------
function viewTerritories(v) {
  const res = S.res;
  v.innerHTML = `<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Territory</th><th>City</th><th>Tier</th><th>Priority</th><th>Pins</th><th>Slots</th><th>Shortlisted</th><th>Waitlist (backfill order)</th><th>Other</th></tr></thead><tbody>
    ${Object.values(res.territoryState).map(st => { const t = st.territory; return `<tr><td class="id">${t.id}</td><td>${esc(t.city || t.cityRaw)}</td><td>${t.tier || '—'}</td><td><span class="tagp prio-${t.priority}">${t.priority || '—'}</span></td><td style="font-family:ui-monospace,monospace;font-size:12px">${t.pins.join(', ')}</td><td><b>${st.used}</b>/${t.slots ?? 0}</td>
      <td>${st.shortlisted.map(r => `<a href="#" data-app="${r.app.id}">${r.app.id}</a> (${r.score})`).join('<br>') || '—'}</td><td>${st.waitlist.map((r, i) => `${i + 1}. <a href="#" data-app="${r.app.id}">${r.app.id}</a> (${r.score})`).join('<br>') || '—'}</td>
      <td class="muted">${[...st.prequalified.map(r => r.app.id + ' pre-qual'), ...st.held.map(r => r.app.id + ' hold'), ...st.relocate.map(r => r.app.id + ' relocate')].join('<br>') || '—'}</td></tr>`; }).join('')}</tbody></table></div>
    <div class="sec-title"><h2>Existing stores</h2><span class="sub">Fixed sheet — used for the one-store-per-pin rule</span></div>
    <div class="pins">${res.stores.map(s => `<span class="pinchip store" title="${s.city}, opened ${s.year}">${s.id} · ${s.pin}</span>`).join('')}</div>`;
}

// ---------- assumptions ----------
function viewAssumptions(v) {
  const c = S.cfg;
  const ctl = (path, label, sub, min, max, step, val) => `<div class="ctl"><div>${label}<small>${sub}</small></div><input type="range" data-path="${path}" min="${min}" max="${max}" step="${step}" value="${val ?? 0}"><output>${val ?? 'off'}</output></div>`;
  v.innerHTML = `<div class="banner note">Everything on this page is an <b>assumption</b> — the brief gives no investment minimum, store size or payback rule. Move a slider and every decision re-runs instantly; the hard rules never change.</div>
  <div class="grid g2">
    <div class="card"><h3>Ranking weights</h3><p class="muted" style="font-size:12.5px">Used only to compare decision-ready partners competing for the same territory.</p>
      ${ctl('weights.capital', 'Capital', 'Investment vs indicative setup budget', 0, 60, 5, c.weights.capital)}
      ${ctl('weights.experience', 'Retail experience', 'Diminishing returns after ~6 years', 0, 60, 5, c.weights.experience)}
      ${ctl('weights.site', 'Site quality', 'Floor (ground > mall > upper), size, owned vs rented', 0, 60, 5, c.weights.site)}
      ${ctl('weights.launch', 'Launch readiness', 'Realistic & soon beats unrealistic or distant', 0, 60, 5, c.weights.launch)}
      ${ctl('qualityBar', 'Quality bar', 'Below this, keep the slot open rather than fill it', 0, 80, 5, c.qualityBar)}
    </div>
    <div class="card"><h3>Money & site</h3><p class="muted" style="font-size:12.5px">Indicative all-in setup budgets (₹ lakh) — replace with the brand's real numbers.</p>
      ${ctl('budgetByTier.Tier 1', 'Tier 1 budget', 'Bengaluru', 10, 100, 5, c.budgetByTier['Tier 1'])}
      ${ctl('budgetByTier.Tier 2', 'Tier 2 budget', 'Mysuru, Mangaluru, Hubballi-Dharwad, Belagavi', 10, 100, 5, c.budgetByTier['Tier 2'])}
      ${ctl('budgetByTier.Tier 3', 'Tier 3 budget', 'Tumakuru, Davanagere', 10, 100, 5, c.budgetByTier['Tier 3'])}
      ${ctl('fundingHoldRatio', 'Funding-proof trigger', 'Ask for loan/co-investor proof below this share of budget', 0, 1, .05, c.fundingHoldRatio)}
      ${ctl('hardMinInvestment', 'Hard minimum (brand policy)', '0 = off. Only set if the brand confirms a minimum', 0, 60, 5, c.hardMinInvestment || 0)}
      ${ctl('minSqft', 'Smallest workable shop (sq ft)', 'Below this we flag format fit', 100, 600, 25, c.minSqft)}
      ${ctl('overlapKm', 'Catchment overlap radius (km)', 'Closer than this to our store → cannibalisation review', .5, 5, .5, c.overlapKm)}
    </div>
  </div>
  <div class="grid g2" style="margin-top:14px">
    <div class="card"><h3>Hard rules (never editable)</h3>
      <div class="rule"><span class="rk">Rule 1</span><span>The brand never opens two stores in one pin code — so no new store on an existing store's pin, and only one new applicant per pin.</span></div>
      <div class="rule"><span class="rk">Rule 2</span><span>No territory gets more shortlisted partners than its open slots. Zero slots means nobody is shortlisted there.</span></div>
      <div class="rule"><span class="rk">Rule 3</span><span>Applicants link to territories only by exact pin code. City or prefix alone never assigns a territory.</span></div>
      <div class="rule"><span class="rk">Rule 4</span><span>Missing or contradictory facts → hold with a specific question. Never a silent rejection, never an invented value.</span></div>
      <div class="rule"><span class="rk">Rule 5</span><span>Priority orders the team's work; it never overrides slots. Tier is context, not demand.</span></div></div>
    <div class="card"><h3>What this data can't tell us</h3><ul style="padding-left:18px;color:var(--ink-2)">
      <li>Sales, footfall or demand around a pin — so no revenue or profit forecast.</li><li>Payback period — needs setup cost, rent, margins and sales.</li>
      <li>True catchment — pin centroids are approximate; we screen distance, then a site visit decides.</li><li>Whether stated capital is real — every number is verified in due diligence.</li>
      <li>Rent, lease terms, frontage, competitor stores — collected at the site visit.</li></ul>
      <button class="btn sm" id="resetCfg">Reset assumptions</button></div>
  </div>`;
  v.querySelectorAll('input[type=range]').forEach(inp => inp.oninput = () => {
    const [a, b] = inp.dataset.path.split('.');
    let val = +inp.value;
    if (a === 'hardMinInvestment' && val === 0) val = null;
    if (b) S.cfg[a][b] = val; else S.cfg[a] = val;
    inp.nextElementSibling.textContent = val ?? 'off';
    recompute();
  });
  $('#resetCfg').onclick = () => { S.cfg = structuredClone(DEFAULT_CONFIG); recompute(); render(); };
}

// ---------- data check ----------
function viewData(v) {
  const rp = S.report, res = S.res;
  const rowIssues = res.recs.flatMap(r => r.issues.filter(i => ['block', 'cond', 'warn'].includes(i.sev) && i.gate !== 'allocation').map(i => ({ id: r.app.id, row: r.app.row, ...i })));
  v.innerHTML = `<div class="grid g2"><div class="card"><h3>Workbook read</h3><dl class="kv" style="margin-top:8px">
      <dt>Sheets</dt><dd>${rp.sheets.map(esc).join(', ')}</dd><dt>Applications</dt><dd>${esc(rp.found.applications)} · ${S.base.applications.length} rows</dd>
      <dt>Territories</dt><dd>${esc(rp.found.territories)} · ${S.base.territories.length} rows</dd><dt>Existing stores</dt><dd>${esc(rp.found.stores || 'fixed list (sheet not found)')} · ${res.stores.length}</dd>
      <dt>Skipped</dt><dd>${rp.samplesExcluded.map(esc).join('<br>') || 'nothing'}</dd></dl>
      ${rp.warnings.map(w => `<div class="banner note" style="margin-top:8px">${esc(w)}</div>`).join('')}</div>
    <div class="card"><h3>Rule check</h3>${res.invariants.checks.map(c => `<div class="rule"><span class="rk" style="color:${res.invariants.ok ? 'var(--go)' : 'var(--stop)'}">${res.invariants.ok ? '✓ Pass' : '✕'}</span><span>${c}</span></div>`).join('')}
      ${res.invariants.errors.map(e => `<div class="banner bad">${esc(e)}</div>`).join('')}</div></div>
    <div class="sec-title"><h2>Territory master-data</h2><span class="sub">Issues in the brand's own sheet</span></div>
    <div class="card">${res.dataIssues.length ? `<ul class="evlist">${res.dataIssues.map(d => `<li><span class="ev ${d.sev === 'high' ? 'ev-gap' : 'ev-assumption'}">${d.sev}</span><span><b>${esc(d.ref)}</b> — ${esc(d.text)}</span></li>`).join('')}</ul>` : '<span class="muted">No issues.</span>'}</div>
    <div class="sec-title"><h2>Application data gaps</h2><span class="sub">${rowIssues.length} item(s) to clarify</span></div>
    <div class="tbl-wrap"><table class="tbl"><thead><tr><th>ID</th><th>Row</th><th>Gate</th><th>Issue</th><th>Ask</th></tr></thead><tbody>${rowIssues.map(i => `<tr data-app="${i.id}"><td class="id">${i.id}</td><td>${i.row}</td><td>${i.gate}</td><td>${esc(i.text)}</td><td class="nx">${esc(i.ask)}</td></tr>`).join('')}</tbody></table></div>`;
}

// ---------- copilot ----------
function say(who, html) {
  const d = document.createElement('div');
  d.className = `bub ${who}`; d.innerHTML = html;
  $('#cpLog').appendChild(d); $('#cpLog').scrollTop = 1e9;
  return d;
}
function helpChips() {
  const res = S.res;
  const hold = res.recs.find(r => r.outcome === 'HOLD'), pre = res.recs.find(r => r.outcome === 'PREQUALIFIED'), pin = res.recs.find(r => r.competitors.samePin.length);
  const ex = [hold && `Why is ${hold.app.id} on hold?`, pre && `${pre.app.id} has now found a ground-floor space`, pin && `Who is competing for ${pin.app.pin}?`, 'Which high-priority territories still have slots?', res.recs[0] && `What is the onboarding plan for ${res.recs.find(r => r.outcome === 'SHORTLIST')?.app.id || res.recs[0].app.id}?`, 'How do you decide?'].filter(Boolean);
  return `Try: <div class="sugg">${ex.map(e => `<button class="sg" data-q="${esc(e)}">${esc(e)}</button>`).join('')}</div>`;
}

async function ask(text) {
  if (!text.trim()) return;
  say('me', esc(text));
  if (!S.base) { say('ai', 'Please upload a workbook first (or click “Try the demo data”).'); return; }
  const out = interpret(text, S.res, { focus: S.focus });
  if (out.focus) S.focus = out.focus;
  if (out.kind === 'undo') {
    const p = S.patches.pop();
    if (!p) return say('ai', 'Nothing to undo.');
    const prev = S.res; recompute();
    const ch = diff(prev, S.res, p.id).filter(c => c.from !== c.to);
    say('ai', `<div class="ans-head">Undid “${esc(p.text)}”</div>${ch.length ? `<table class="cmp diff">${ch.map(c => `<tr><td><a href="#" data-app="${c.id}">${c.id}</a></td><td>${chip(c.from)}</td><td>→</td><td>${chip(c.to)}</td></tr>`).join('')}</table>` : '<p class="muted">No decision changed.</p>'}`);
    return render();
  }
  if (out.kind === 'reset') { S.patches = []; recompute(); render(); return say('ai', 'Reset — every update removed, back to the workbook.'); }
  if (out.kind === 'update') {
    const prev = S.res;
    const patch = { type: out.app ? 'app' : 'ter', id: out.app || out.territory, patch: out.patch, said: out.said, text, ts: Date.now(), whatIf: out.whatIf };
    S.patches.push(patch);
    recompute();
    const ch = diff(prev, S.res, patch.id);
    say('ai', diffHtml(ch, out.said, patch.id, out.whatIf) + (S.res.invariants.ok ? '<div class="src">✓ Hard rules re-verified</div>' : `<div class="banner bad">${S.res.invariants.errors.join(' ')}</div>`));
    S.focus = out.app || S.focus;
    render();
    if (out.app && $('#drawer').classList.contains('on')) openDetail(out.app);
    return;
  }
  if (out.kind === 'fallback') {
    const bub = say('ai', '<span class="typing">Thinking…</span>');
    const llm = await askLLM(text);
    bub.innerHTML = llm ? `${llm}<div class="src">AI answer grounded in this session's decisions · rules are enforced in code, not by the AI</div>` : out.html;
    return;
  }
  say('ai', out.html + '<div class="src">From this session\'s decision records</div>');
}

// Optional Claude layer (Vercel function). If it is missing or slow, the deterministic copilot still answers.
async function askLLM(question) {
  try {
    const ctl = new AbortController(); const tm = setTimeout(() => ctl.abort(), 15000);
    const compact = S.res.recs.map(r => ({ id: r.app.id, name: r.app.name, city: r.app.city, pin: r.app.pin, territory: r.territory?.id, outcome: r.outcome, score: r.score, headline: r.decision.headline, next: r.decision.next, issues: r.issues.map(i => i.text), flags: r.flags.map(f => f.text) }));
    const terr = Object.values(S.res.territoryState).map(s => ({ id: s.territory.id, city: s.territory.city, priority: s.territory.priority, slots: s.territory.slots, filled: s.used, shortlisted: s.shortlisted.map(r => r.app.id), waitlist: s.waitlist.map(r => r.app.id) }));
    const r = await fetch('/api/chat', { method: 'POST', headers: { 'content-type': 'application/json' }, signal: ctl.signal, body: JSON.stringify({ question, records: compact, territories: terr, config: S.cfg, history: S.chatHistory.slice(-6) }) });
    clearTimeout(tm);
    if (!r.ok) return null;
    const d = await r.json();
    if (!d.answer) return null;
    S.chatHistory.push({ q: question, a: d.answer });
    return esc(d.answer).replace(/\b(APP-\d+)\b/g, '<a href="#" data-app="$1">$1</a>').replace(/\n/g, '<br>');
  } catch { return null; }
}

// ---------- export ----------
function exportXlsx() {
  const rows = S.res.recs.map(r => ({ 'Application ID': r.app.id, 'Applicant': r.app.name, 'City': r.app.city, 'Pin': r.app.pin, 'Territory': r.territory?.id || '', 'Priority': r.territory?.priority || '',
    'Decision': OUTCOMES[r.outcome].label, 'Score': r.score, 'Location gate': r.gates.location, 'Partner gate': r.gates.partner, 'Site gate': r.gates.site,
    'Why': r.decision.headline, 'Evidence': r.decision.evidence.map(e => `[${evLabel[e.kind]}] ${e.text}`).join(' | '), 'Next steps': r.decision.next.join(' | '), 'What would change it': r.decision.change.join(' | '),
    'Alternative pins': (r.alternatives || []).map(a => a.pin).join(', '), 'Training language': r.app.language || 'English' }));
  const tasks = S.res.recs.flatMap(r => { const p = buildPlan(r); return p ? p.tasks.map(t => ({ 'Application ID': r.app.id, Stage: t.stage, Task: t.task, Owner: t.owner, 'Start week': t.start, Weeks: t.weeks, 'Done when': t.evidence, Why: t.why })) : []; });
  const terr = Object.values(S.res.territoryState).map(s => ({ Territory: s.territory.id, City: s.territory.city, Priority: s.territory.priority, Slots: s.territory.slots, Filled: s.used, Shortlisted: s.shortlisted.map(r => r.app.id).join(', '), 'Waitlist order': s.waitlist.map(r => r.app.id).join(', ') }));
  const audit = S.patches.map(p => ({ Time: new Date(p.ts).toISOString(), Target: p.id, Message: p.text, Applied: p.said.join(', ') }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), 'Decisions');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(terr), 'Territories');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(tasks), 'Onboarding tasks');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(audit.length ? audit : [{ Note: 'No updates' }]), 'Update log');
  XLSX.writeFile(wb, 'sthala-decisions.xlsx');
}

// ---------- wiring ----------
function toast(t) { const el = $('#toast'); el.textContent = t; el.classList.add('on'); setTimeout(() => el.classList.remove('on'), 2600); }
function readFile(f) { const rd = new FileReader(); rd.onload = () => loadBytes(new Uint8Array(rd.result), f.name); rd.readAsArrayBuffer(f); }

document.addEventListener('click', e => {
  const a = e.target.closest('[data-app]'); if (a) { e.preventDefault(); openDetail(a.dataset.app); return; }
  const t = e.target.closest('[data-tab]'); if (t) { S.tab = t.dataset.tab; render(); return; }
  const q = e.target.closest('[data-q]'); if (q) { ask(q.dataset.q); return; }
  const k = e.target.closest('[data-ask]'); if (k) { closeDetail(); $('#copilot').classList.add('on'); ask(k.dataset.ask); }
});
$('#drawerBg').onclick = closeDetail;
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeDetail(); });
$('#btnUpload').onclick = () => $('#fileInput').click();
$('#fileInput').onchange = e => { const f = e.target.files[0]; if (f) readFile(f); e.target.value = ''; };
$('#btnExport').onclick = exportXlsx;
$('#btnTemplate').onclick = () => { const a = document.createElement('a'); a.href = 'data/template.xlsx'; a.download = 'Case1_Franchise_Test_Data_Format.xlsx'; a.click(); };
$('#cpForm').onsubmit = e => { e.preventDefault(); const t = $('#cpText').value; $('#cpText').value = ''; ask(t); };
$('#cpText').onkeydown = e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); $('#cpForm').requestSubmit(); } };
$('#cpToggle').onclick = () => $('#copilot').classList.toggle('on');
$('#cpClose').onclick = () => $('#copilot').classList.remove('on');
if (matchMedia('(max-width: 980px)').matches) $('#cpClose').hidden = false;

fetch('data/pins.json').then(r => r.json()).then(d => { Object.assign(S.geo, d); if (S.base) { recompute(); render(); } }).catch(() => { });
render();
if (new URLSearchParams(location.search).has('demo')) loadDemo();
