import { evaluate, normaliseApplication, normaliseTerritory, DEFAULT_CONFIG, OUTCOMES, CITIES } from './engine.js';
import { parseWorkbook } from './workbook.js';
import { interpret, diff, diffHtml, evLabel } from './copilot.js';
import { buildPlan, partnerMessage } from './plan.js';

const $ = s => document.querySelector(s);
const esc = x => String(x ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const chip = o => `<span class="pill t-${OUTCOMES[o]?.tone}">${OUTCOMES[o]?.label || o}</span>`;
const fmt = v => (v === null || v === undefined || Number.isNaN(v)) ? '—' : String(Math.round(v * 10) / 10);
const toneColor = { go: '#23905c', info: '#2f6fb8', wait: '#d18f12', warn: '#e8693f', hold: '#7d5bd0', stop: '#a31f2a', muted: '#8a8f86' };
const AV = ['#2c6a4d', '#e8693f', '#7d5bd0', '#3c86c9', '#c58a12', '#d9547a', '#1f8a8a', '#8a5a3c'];
const avColor = s => AV[[...String(s)].reduce((a, c) => a + c.charCodeAt(0), 0) % AV.length];
const initials = n => (n || '?').split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]).join('').toUpperCase();
const avatar = (a, cls = '') => `<span class="av ${cls}" style="background:${avColor(a.name || a.id)}">${esc(initials(a.name))}</span>`;
const STAMP = { SHORTLIST: 'GO', SHORTLIST_CONDITIONAL: 'GO*', PREQUALIFIED: 'FIND SITE', WAITLIST: 'QUEUE', RELOCATE: 'MOVE PIN', HOLD: 'HOLD', OUT_OF_PLAN: 'OUTSIDE', NOT_PROCEEDING: 'NO', WITHDRAWN: 'OUT' };

const S = {
  base: null, report: null, fileName: '', patches: [], cfg: structuredClone(DEFAULT_CONFIG), res: null,
  geo: {}, tab: 'overview', filter: 'ALL', q: '', view: 'wall', sort: { k: 'rank', dir: 1 }, focus: null, map: null, mapCity: 'All',
  chatHistory: [], ai: false, portalReady: false, links: {}, missions: {},
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

function loadBytes(bytes, name) {
  try {
    let wb = parseWorkbook(XLSX, bytes);
    if (!wb.applications.length && wb.report.samplesExcluded.length) { wb = parseWorkbook(XLSX, bytes, { includeSamples: true }); wb.report.warnings.push('Only the template example rows were found, so they were included as real data.'); }
    const apps = wb.applications.map(normaliseApplication), seen = {};
    for (const a of apps) { seen[a.id] = (seen[a.id] || 0) + 1; if (seen[a.id] > 1) { a.idOriginal = a.id; a.id = `${a.id}·R${a.row}`; } }
    S.base = { applications: apps, territories: wb.territories.map(normaliseTerritory), stores: wb.stores };
    S.report = wb.report; S.fileName = name; S.patches = []; S.focus = null; S.links = {};
    try { S.missions = JSON.parse(localStorage.getItem('sthala-m-' + name) || '{}'); } catch { S.missions = {}; }
    recompute();
    $('#fileName').hidden = false; $('#fileName').textContent = `${name} · ${S.base.applications.length} applications`;
    $('#btnExport').hidden = false;
    S.tab = 'overview'; render();
    $('#cpLog').innerHTML = '';
    say('ai', `<div class="ans-head">Workbook read ✓</div><b>${esc(name)}</b>: ${S.base.applications.length} applications, ${S.base.territories.length} territories, ${S.res.stores.length} existing stores.${S.report.samplesExcluded.length ? ' Skipped the grey template example row(s).' : ''} ${S.res.invariants.ok ? '<br>🛡 All three hard rules hold.' : '<br>⚠ Rule check failed — see Data check.'}<br><br>${helpChips()}`);
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

// ---------- gamification ----------
function progress() {
  const st = Object.values(S.res.territoryState);
  const slots = st.reduce((a, s) => a + (s.territory.slots ?? 0), 0);
  const used = st.reduce((a, s) => a + s.used, 0);
  const pct = slots ? Math.round(used / slots * 100) : 0;
  const level = pct >= 100 ? ['LVL 5', 'Expansion Legend'] : pct >= 75 ? ['LVL 4', 'Network Architect'] : pct >= 50 ? ['LVL 3', 'Regional Builder'] : pct >= 25 ? ['LVL 2', 'Pathfinder'] : ['LVL 1', 'Scout'];
  const c = counts();
  const high = st.filter(s => s.territory.priority === 'High');
  const badges = [
    ['🛡', 'Rulekeeper', 'All three hard rules verified on the current allocation.', S.res.invariants.ok],
    ['🎯', 'Half the map', 'At least half of all open slots have a provisional partner.', pct >= 50],
    ['🔥', 'Priority first', 'Every High-priority territory with a ready candidate has its slots filled.', high.length > 0 && high.every(s => s.remaining === 0 || !S.res.recs.some(r => r.territory?.id === s.territory.id && r.outcome === 'WAITLIST' && r.waitReason !== 'BAR'))],
    ['🔁', 'Second chances', 'A partner who lost their pin was offered free alternative pins instead of a rejection.', S.res.recs.some(r => r.outcome === 'RELOCATE' && r.alternatives?.length)],
    ['🧹', 'Clean ledger', 'No application is on hold for missing information.', !c.HOLD],
    ['✍️', 'Live intel', 'A new fact was applied and the whole allocation re-ran.', S.patches.length > 0],
    ['📬', 'Partner replied', 'A partner fixed their own application through the self-service link.', S.patches.some(p => p.source === 'portal')],
  ];
  const missionsDone = Object.values(S.missions).filter(Boolean).length;
  const xp = used * 50 + missionsDone * 10 + badges.filter(b => b[3]).length * 25;
  return { slots, used, pct, level, badges, xp };
}

function confetti(n = 140) {
  const cv = $('#confetti'), ctx = cv.getContext('2d');
  cv.width = innerWidth; cv.height = innerHeight;
  const cols = ['#e6a93a', '#f3c66b', '#3f8f68', '#e8693f', '#7d5bd0', '#f4ead2'];
  const ps = Array.from({ length: n }, () => ({ x: innerWidth / 2 + (Math.random() - .5) * 200, y: innerHeight / 3, vx: (Math.random() - .5) * 14, vy: -Math.random() * 14 - 4, s: 4 + Math.random() * 6, c: cols[Math.random() * cols.length | 0], r: Math.random() * 6, vr: (Math.random() - .5) * .3 }));
  let f = 0;
  (function tick() {
    ctx.clearRect(0, 0, cv.width, cv.height);
    for (const p of ps) { p.vy += .35; p.x += p.vx; p.y += p.vy; p.r += p.vr; ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.r); ctx.fillStyle = p.c; ctx.fillRect(-p.s / 2, -p.s / 2, p.s, p.s * .6); ctx.restore(); }
    if (++f < 140) requestAnimationFrame(tick); else ctx.clearRect(0, 0, cv.width, cv.height);
  })();
}
function countUp(root) {
  root.querySelectorAll('[data-count]').forEach(el => {
    const to = +el.dataset.count, t0 = performance.now();
    const step = t => { const k = Math.min(1, (t - t0) / 700); el.textContent = Math.round(to * (1 - Math.pow(1 - k, 3))); if (k < 1) requestAnimationFrame(step); };
    requestAnimationFrame(step);
  });
}
function ring(pct, size = 112, stroke = 10) {
  const r = (size - stroke) / 2, c = 2 * Math.PI * r;
  return `<svg width="${size}" height="${size}"><defs><linearGradient id="gr"><stop offset="0" stop-color="#e6a93a"/><stop offset="1" stop-color="#e8693f"/></linearGradient></defs>
    <circle cx="${size / 2}" cy="${size / 2}" r="${r}" stroke="rgba(244,234,210,.12)" stroke-width="${stroke}" fill="none"/>
    <circle cx="${size / 2}" cy="${size / 2}" r="${r}" stroke="url(#gr)" stroke-width="${stroke}" fill="none" stroke-linecap="round" stroke-dasharray="${c}" stroke-dashoffset="${c * (1 - pct / 100)}" style="transition:stroke-dashoffset 1.2s cubic-bezier(.2,.8,.2,1)"/></svg>`;
}
const scoreRing = (v, tone) => { const r = 19, c = 2 * Math.PI * r; return `<span class="sring"><svg width="46" height="46"><circle cx="23" cy="23" r="${r}" stroke="#e6e1d2" stroke-width="5" fill="none"/><circle cx="23" cy="23" r="${r}" stroke="${toneColor[tone]}" stroke-width="5" fill="none" stroke-linecap="round" stroke-dasharray="${c}" stroke-dashoffset="${c * (1 - Math.min(100, v) / 100)}"/></svg><b>${Math.round(v)}</b></span>`; };

// ---------- rendering ----------
function render() {
  if (!S.base) return renderLanding();
  const tabs = [['overview', '🏁 Mission'], ['applicants', '🧑‍💼 Partners', S.res.recs.length], ['map', '🗺 Map'], ['territories', '🧩 Territories', S.res.territories.length], ['assumptions', '🎛 Assumptions'], ['data', '🔎 Data check', S.res.dataIssues.length || '']];
  $('#main').innerHTML = `<nav class="tabs">${tabs.map(([k, l, n]) => `<button class="tab ${S.tab === k ? 'on' : ''}" data-tab="${k}">${l}${n ? `<span class="n">${n}</span>` : ''}</button>`).join('')}</nav><div id="view"></div>`;
  const v = $('#view');
  ({ overview: viewOverview, applicants: viewApplicants, map: viewMap, territories: viewTerritories, assumptions: viewAssumptions, data: viewData })[S.tab](v);
  countUp(v);
}
function counts() { const c = {}; S.res.recs.forEach(r => c[r.outcome] = (c[r.outcome] || 0) + 1); return c; }

function renderLanding(err) {
  $('#main').innerHTML = `<section class="hero">
    <div class="float-stack"><div class="fcard"><b>APP-012 · Sanjay</b>Found a ground-floor shop → <span class="pill t-go">Shortlisted</span></div>
      <div class="fcard"><b>Pin 570009</b>Existing store ST-06 → <span class="pill t-warn">Move pin</span></div>
      <div class="fcard"><b>TER-03 · Mysuru</b>2 of 3 slots filled · 🔥 High</div></div>
    <span class="eyebrow">● Case 1 · Franchise partner acquisition, geo-selection & onboarding</span>
    <h1>Turn a pile of applications into <em>open, trained stores.</em></h1>
    <p class="lead">Drop in the workbook. Sthala screens every partner, matches pins to territories, never puts two stores in one pin, ranks competing partners, maps catchment overlap — and hands each partner a plan in their own language.</p>
    <div class="hero-cta"><button class="btn primary pulse" id="lpDemo">▶ Play the demo</button><button class="btn ghost-d" id="lpUpload">Upload your workbook</button></div>
    <div class="drop" id="drop"><div class="ic">📥</div><div><b>Or drop the .xlsx here</b><span>Official template as-is — no renaming, no reformatting.</span></div></div>
    ${err ? `<div class="banner bad" style="margin-top:12px">${esc(err)}</div>` : ''}
  </section>
  <div class="levels">
    <div class="lvl l1"><span class="k">LEVEL 01 · READ</span><b>Accepts the template as-is</b><p>Finds sheets by header, skips the grey example row, cleans pins like 570001.0.</p><span class="emoji">📄</span></div>
    <div class="lvl l2"><span class="k">LEVEL 02 · CHECK</span><b>Three gates, not one score</b><p>Location, partner and site judged separately — a good partner with a taken pin is relocated, not rejected.</p><span class="emoji">🚦</span></div>
    <div class="lvl l3"><span class="k">LEVEL 03 · ALLOCATE</span><b>Hard rules live in code</b><p>One store per pin. Never on an existing store's pin. Never over a territory's slots.</p><span class="emoji">🧩</span></div>
    <div class="lvl l4"><span class="k">LEVEL 04 · ONBOARD</span><b>Plan, message & self-service</b><p>Week-by-week path to opening, training by experience, a fix-it link in Kannada, Hindi or English.</p><span class="emoji">🚀</span></div>
  </div>`;
  $('#lpUpload').onclick = () => $('#fileInput').click();
  $('#lpDemo').onclick = loadDemo;
  const d = $('#drop');
  d.ondragover = e => { e.preventDefault(); d.classList.add('over'); };
  d.ondragleave = () => d.classList.remove('over');
  d.ondrop = e => { e.preventDefault(); d.classList.remove('over'); const f = e.dataTransfer.files[0]; if (f) readFile(f); };
  if (!$('#cpLog').innerHTML) say('ai', `<div class="ans-head">Namaskara 👋</div>Load a workbook (or press <b>Play the demo</b>) and I'll explain every decision. Tell me new facts — typed or spoken — and I'll re-run the whole allocation.`);
}

function viewOverview(v) {
  const res = S.res, c = counts(), pg = progress();
  const tiles = [['ALL', 'Applications', res.recs.length, 'all', '📚'], ['SHORTLIST', 'Shortlisted', c.SHORTLIST || 0, 'c-go', '✅'], ['SHORTLIST_CONDITIONAL', 'Conditional', c.SHORTLIST_CONDITIONAL || 0, 'c-go2', '⏳'],
    ['PREQUALIFIED', 'Find a site', c.PREQUALIFIED || 0, 'c-info', '🔍'], ['WAITLIST', 'Waitlisted', c.WAITLIST || 0, 'c-wait', '🪑'], ['RELOCATE', 'Move pin', c.RELOCATE || 0, 'c-warn', '🔁'],
    ['HOLD', 'On hold', c.HOLD || 0, 'c-hold', '✋'], ['OUT_OF_PLAN', 'Outside / out', (c.OUT_OF_PLAN || 0) + (c.NOT_PROCEEDING || 0) + (c.WITHDRAWN || 0), 'c-muted', '🧭']];
  const n = res.recs.length || 1;
  const screened = res.recs.filter(r => r.gates.partner === 'ok').length, site = res.recs.filter(r => ['ok', 'conditional'].includes(r.gates.site)).length;
  const slotted = (c.SHORTLIST || 0) + (c.SHORTLIST_CONDITIONAL || 0), plans = res.recs.filter(r => buildPlan(r)).length;
  const river = [['Applied', res.recs.length], ['Partner screen-ready', screened], ['Site ready', site], ['Holding a slot', slotted], ['Onboarding plans', plans]];
  const pr = { High: 0, Medium: 1, Low: 2 };
  const terrs = Object.values(res.territoryState).sort((a, b) => (pr[a.territory.priority] ?? 3) - (pr[b.territory.priority] ?? 3) || a.territory.id.localeCompare(b.territory.id));
  v.innerHTML = `
    <section class="quest">
      <div class="ring">${ring(pg.pct)}<div class="v"><div><b data-count="${pg.pct}">0</b><small>% slots</small></div></div></div>
      <div><span class="lvlname">${pg.level[0]} · ${pg.level[1].toUpperCase()}</span><h2>Expansion quest: <em>${pg.used} of ${pg.slots} stores</em> lined up</h2>
        <div class="xp"><i style="width:${Math.min(100, pg.xp / 10)}%"></i></div>
        <div class="rules">${res.invariants.ok ? '<b>✓ Hard rules verified</b> — one store per pin · none on an existing store · no territory over its slots' : `⚠ ${res.invariants.errors.map(esc).join(' ')}`} · <b style="color:var(--gold-2)">${pg.xp} XP</b></div></div>
      <div class="badges">${pg.badges.map(([e, name, tip, on]) => `<span class="badge ${on ? 'on' : ''}" data-tip="${on ? '🏆 ' : '🔒 '}${name}: ${tip}">${e}</span>`).join('')}</div>
    </section>
    ${S.patches.length ? `<div class="banner note" style="margin-top:12px">✎ ${S.patches.length} update(s) layered on top of the workbook. <a href="#" id="resetAll">Reset to workbook</a></div>` : ''}
    <div class="tiles">${tiles.map(([k, l, num, cls, e]) => `<div class="tile ${cls}" data-filter="${k}"><span class="e">${e}</span><div class="v" data-count="${num}">0</div><div class="l">${l}</div></div>`).join('')}</div>
    <div class="river">${river.map(([l, x]) => `<div class="st"><b data-count="${x}">0</b><span>${l}</span><i style="width:${x / n * 100}%"></i></div>`).join('')}</div>
    <div class="sec-title"><h2>Territory <em>board</em></h2><span class="sub">Each circle is a store slot. Priority (🔥) decides the order the team works in — never the slot limit.</span></div>
    <div class="grid g3">${terrs.map(terrCard).join('')}</div>
    <div class="sec-title"><h2>Today's <em>missions</em></h2><span class="sub">Highest-priority territory first · tick to earn XP</span></div>
    <div class="missions">${missions()}</div>`;
  v.querySelectorAll('.tile').forEach(k => k.onclick = () => { S.filter = k.dataset.filter; S.tab = 'applicants'; render(); });
  v.querySelectorAll('.mission input').forEach(cb => cb.onchange = () => {
    S.missions[cb.dataset.m] = cb.checked;
    try { localStorage.setItem('sthala-m-' + S.fileName, JSON.stringify(S.missions)); } catch { }
    if (cb.checked) toast('+10 XP · mission complete');
    render();
  });
  const ra = $('#resetAll'); if (ra) ra.onclick = e => { e.preventDefault(); S.patches = []; recompute(); render(); say('ai', 'Reset — back to the workbook as uploaded.'); };
}

function terrCard(st) {
  const t = st.territory, res = S.res;
  const storePins = new Set(res.stores.map(s => s.pin));
  const taken = new Map(st.shortlisted.map(r => [r.app.pin, r]));
  const contested = new Set(res.recs.filter(r => r.lostPinTo).map(r => r.app.pin));
  const amb = new Set(res.recs.filter(r => r.issues.some(i => i.code === 'PIN_IN_MULTIPLE_TERRITORIES')).map(r => r.app.pin));
  const slots = (t.slots ?? 0) === 0 ? '<span class="slot zero">0 open slots — not expanding here now</span>' :
    Array.from({ length: t.slots }, (_, i) => { const r = st.shortlisted[i]; return r ? `<span class="slot ${r.outcome === 'SHORTLIST_CONDITIONAL' ? 'c' : 'f'}" style="${r.outcome === 'SHORTLIST_CONDITIONAL' ? 'color:var(--go)' : `background:${avColor(r.app.name || r.app.id)}`};animation-delay:${i * .12}s" title="${esc(r.app.id + ' · ' + r.app.name)}" data-app="${r.app.id}">${esc(initials(r.app.name))}</span>` : '<span class="slot empty" title="Open slot"></span>'; }).join('');
  const line = (lbl, arr) => arr.length ? `<div class="queue-line"><b>${lbl}:</b> ${arr.map(r => `<a href="#" data-app="${r.app.id}">${r.app.id}</a>`).join(', ')}</div>` : '';
  const fire = { High: '🔥🔥🔥', Medium: '🔥🔥', Low: '🔥' }[t.priority] || '';
  return `<div class="card terr"><div class="hd"><div><h3>${t.id} <span class="city">${esc(t.city || t.cityRaw)}</span></h3><span class="muted">${t.tier || '—'} · ${st.used}/${t.slots ?? 0} filled</span></div><span class="tagp prio-${t.priority}"><span class="fire">${fire}</span> ${t.priority || '—'}</span></div>
    <div class="slots">${slots}</div>
    <div class="pins">${t.pins.map(p => `<span class="pinchip ${storePins.has(p) ? 'store' : amb.has(p) ? 'amb' : taken.has(p) ? 'taken' : contested.has(p) ? 'contested' : ''}" title="${storePins.has(p) ? 'Existing store' : taken.has(p) ? 'Shortlisted: ' + taken.get(p).app.id : amb.has(p) ? 'Listed in two territories' : 'Free pin'}">${p}</span>`).join('')}</div>
    ${line('Waitlist', st.waitlist)}${line('Find a site', st.prequalified)}${line('On hold', st.held)}${line('Move pin', st.relocate)}</div>`;
}

function missions() {
  const pr = { High: 0, Medium: 1, Low: 2 };
  const rank = { SHORTLIST: 0, SHORTLIST_CONDITIONAL: 1, HOLD: 2, PREQUALIFIED: 3, RELOCATE: 4, WAITLIST: 5, OUT_OF_PLAN: 6 };
  const rs = S.res.recs.filter(r => r.outcome in rank).sort((a, b) => (pr[a.territory?.priority] ?? 3) - (pr[b.territory?.priority] ?? 3) || rank[a.outcome] - rank[b.outcome] || b.score - a.score).slice(0, 12);
  const verb = { SHORTLIST: 'Start due diligence with', SHORTLIST_CONDITIONAL: 'Confirm site details with', HOLD: 'Clarify with', PREQUALIFIED: 'Help find a site for', RELOCATE: 'Offer new pins to', WAITLIST: 'Keep warm:', OUT_OF_PLAN: 'Redirect' };
  return rs.map(r => { const k = r.app.id + ':' + r.outcome; const done = !!S.missions[k];
    return `<label class="mission ${done ? 'done' : ''}"><input type="checkbox" data-m="${k}" ${done ? 'checked' : ''}>${avatar(r.app)}<div class="mt">${verb[r.outcome]} <b>${esc(r.app.name)}</b> <a href="#" data-app="${r.app.id}">${r.app.id}</a> ${r.territory ? `<span class="tagp prio-${r.territory.priority}">${r.territory.id}</span>` : ''}<br><span class="muted">${esc(r.decision.next[0] || '')}</span></div><span class="xpt">+10 XP</span></label>`; }).join('');
}

function viewApplicants(v) {
  const res = S.res;
  const filters = ['ALL', 'SHORTLIST', 'SHORTLIST_CONDITIONAL', 'PREQUALIFIED', 'WAITLIST', 'RELOCATE', 'HOLD', 'OUT_OF_PLAN', 'WITHDRAWN'].filter(f => f === 'ALL' || res.recs.some(r => r.outcome === f));
  v.innerHTML = `<div class="toolbar"><input class="search" id="q" placeholder="🔎 Search name, ID, city, pin, territory, notes…" value="${esc(S.q)}"><span class="seg"><button data-view="wall" class="${S.view === 'wall' ? 'on' : ''}">▦ Cards</button><button data-view="table" class="${S.view === 'table' ? 'on' : ''}">☰ Table</button></span></div>
    <div class="toolbar">${filters.map(f => `<button class="fchip ${S.filter === f ? 'on' : ''}" data-f="${f}">${f === 'ALL' ? 'All' : OUTCOMES[f].label}</button>`).join('')}</div>
    <div id="list"></div>
    <p class="muted" style="font-size:12px;margin-top:10px">Score compares partners inside one territory (capital ${S.cfg.weights.capital}% · experience ${S.cfg.weights.experience}% · site ${S.cfg.weights.site}% · launch ${S.cfg.weights.launch}%). It is not a profit forecast.</p>`;
  const draw = () => {
    const q = S.q.toLowerCase();
    let rs = res.recs.filter(r => (S.filter === 'ALL' || r.outcome === S.filter) && (!q || [r.app.id, r.app.name, r.app.city, r.app.pin, r.territory?.id, r.app.business, r.app.notes].join(' ').toLowerCase().includes(q)));
    if (S.view === 'wall') {
      rs = rs.slice().sort((a, b) => OUTCOMES[a.outcome].rank - OUTCOMES[b.outcome].rank || b.score - a.score);
      const dot = x => ({ ok: 'ok', conditional: 'warn', review: 'warn', none: 'warn', outside: 'warn', blocked: 'bad', hold: 'bad', fail: 'bad' }[x] || '');
      $('#list').innerHTML = `<div class="wall">${rs.map((r, i) => { const tone = OUTCOMES[r.outcome].tone; const g = r.gates;
        return `<article class="pcard" data-app="${r.app.id}" style="animation-delay:${Math.min(i, 20) * .03}s"><span class="band" style="background:${toneColor[tone]}"></span><span class="stamp" style="color:${toneColor[tone]}">${STAMP[r.outcome]}</span>
          <div class="top-row">${avatar(r.app)}<div style="min-width:0"><h3>${esc(r.app.name || '(no name)')}</h3><div class="meta mono">${r.app.id} · ${esc(r.app.city || r.app.cityRaw || '—')} ${r.app.pin || ''}</div></div></div>
          <p class="hl">${esc(r.decision.headline)}</p>
          <div class="row">${scoreRing(r.score, tone)}${chip(r.outcome)}${r.territory ? `<span class="tagp prio-${r.territory.priority}">${r.territory.id}</span>` : ''}${r.app.language ? `<span class="tagp">🗣 ${r.app.language}</span>` : ''}${r.flags.some(f => f.code === 'CATCHMENT_OVERLAP') ? '<span class="tagp" title="Close to an existing store">📍 overlap</span>' : ''}${S.patches.some(p => p.id === r.app.id) ? '<span class="tagp">✎ updated</span>' : ''}</div>
          <div class="gdots" title="Location · Partner · Site · Slot"><span class="${dot(g.location)}"></span><span class="${dot(g.partner)}"></span><span class="${dot(g.site)}"></span><span class="${r.outcome.startsWith('SHORTLIST') ? 'ok' : r.outcome === 'WAITLIST' ? 'warn' : ''}"></span></div></article>`; }).join('') || '<p class="muted">No matches.</p>'}</div>`;
    } else {
      const key = { id: r => r.app.id, name: r => r.app.name, city: r => (r.app.city || '') + r.app.pin, terr: r => r.territory?.id || 'zz', inv: r => r.app.investment ?? -1, exp: r => r.app.experience ?? -1, space: r => r.app.space || '', score: r => r.score, rank: r => OUTCOMES[r.outcome].rank * 1000 - r.score }[S.sort.k];
      rs = rs.slice().sort((a, b) => { const x = key(a), y = key(b); return (x > y ? 1 : x < y ? -1 : 0) * S.sort.dir; });
      $('#list').innerHTML = `<div class="tbl-wrap"><table class="tbl"><thead><tr>${[['id', 'ID'], ['name', 'Applicant'], ['city', 'City · Pin'], ['terr', 'Territory'], ['inv', '₹ lakh'], ['exp', 'Yrs'], ['space', 'Space'], ['score', 'Score'], ['rank', 'Decision']].map(([k, l]) => `<th data-k="${k}">${l}${S.sort.k === k ? (S.sort.dir > 0 ? ' ↑' : ' ↓') : ''}</th>`).join('')}<th>Why</th></tr></thead><tbody>
        ${rs.map(r => `<tr data-app="${r.app.id}"><td class="id">${r.app.id}</td><td>${esc(r.app.name)}</td><td>${esc(r.app.city || r.app.cityRaw)}<br><span class="muted mono">${r.app.pin || esc(r.app.pinRaw) || '—'}</span></td><td>${r.territory ? r.territory.id : '—'}</td><td>${fmt(r.app.investment)}</td><td>${fmt(r.app.experience)}</td><td>${esc(r.app.space || '—')}${r.app.floor ? `<br><span class="muted">${esc(r.app.floor)}${r.app.size ? ' · ' + r.app.size + ' ft²' : ''}</span>` : ''}</td><td><b>${r.score}</b></td><td>${chip(r.outcome)}</td><td class="nx">${esc(r.decision.headline)}</td></tr>`).join('')}</tbody></table></div>`;
      $('#list').querySelectorAll('th[data-k]').forEach(th => th.onclick = () => { S.sort = { k: th.dataset.k, dir: S.sort.k === th.dataset.k ? -S.sort.dir : 1 }; draw(); });
    }
  };
  draw();
  $('#q').oninput = e => { S.q = e.target.value; draw(); };
  v.querySelectorAll('.fchip').forEach(b => b.onclick = () => { S.filter = b.dataset.f; render(); });
  v.querySelectorAll('[data-view]').forEach(b => b.onclick = () => { S.view = b.dataset.view; render(); });
}

// ---------- detail drawer ----------
const ASK_FIELDS = {
  NO_INVESTMENT: ['investment'], BAD_INVESTMENT: ['investment'], ZERO_INVESTMENT: ['investment', 'note'], FUNDING_GAP: ['investment', 'note'],
  NO_EXPERIENCE: ['experience'], BAD_EXPERIENCE: ['experience'], IMPLAUSIBLE_EXPERIENCE: ['experience'],
  NO_SPACE_STATUS: ['space', 'size', 'floor'], NO_SITE: ['space', 'pin', 'size', 'floor'], SITE_DETAILS_MISSING: ['size', 'floor'], NO_SIZE: ['size'], BAD_SIZE: ['size'], FLOOR_UNKNOWN: ['floor'], TENURE_UNKNOWN: ['space'], SPACE_CONTRADICTION: ['space', 'size', 'floor'],
  NO_PIN: ['pin'], BAD_PIN: ['pin'], CITY_PIN_MISMATCH: ['city', 'pin'], TERRITORY_CITY_MISMATCH: ['city', 'pin'], EXISTING_STORE_PIN: ['pin', 'space', 'size', 'floor'], LOST_PIN_CONTEST: ['pin', 'space', 'size', 'floor'], NO_TERRITORY: ['pin'],
  NO_LAUNCH: ['launch'], BAD_LAUNCH: ['launch'], NO_LANGUAGE: ['language'], LANG_UNKNOWN: ['language'],
};
function asksFor(r) {
  const f = new Set();
  for (const i of r.issues) for (const k of ASK_FIELDS[i.code] || []) f.add(k);
  return [...f];
}

function openDetail(id) {
  const r = S.res.recs.find(x => x.app.id === id);
  if (!r) return;
  S.focus = id;
  const a = r.app, f = r.factors, w = S.cfg.weights, o = r.outcome;
  const gate = (k, val, map) => { const [cls, label] = map[val] || ['na', val]; return `<div class="gate ${cls}"><div class="gk">${k}</div><div class="gv">${label}</div></div>`; };
  const loc = gate('Location', r.gates.location, { ok: ['ok', `✓ ${r.territory?.id || ''}`], blocked: ['bad', '✕ Pin taken'], outside: ['warn', 'Outside map'], hold: ['bad', '? Unclear'] });
  const par = gate('Partner', r.gates.partner, { ok: ['ok', '✓ Screen-ready'], hold: ['bad', '? Info missing'], review: ['warn', '! Funding proof'], fail: ['bad', '✕ Policy'] });
  const sit = gate('Site', r.gates.site, { ok: ['ok', '✓ Site ready'], conditional: ['warn', '~ Conditional'], none: ['warn', 'No site yet'], hold: ['bad', '? Details missing'] });
  const slotV = o.startsWith('SHORTLIST') ? ['ok', `✓ Slot ${r.territoryRank}/${r.territory.slots}`] : o === 'WAITLIST' ? ['warn', r.waitReason === 'BAR' ? 'Below bar' : `#${r.territoryRank} in queue`] : o === 'RELOCATE' && r.lostPinTo ? ['bad', `Lost to ${r.lostPinTo}`] : ['na', 'Not yet'];
  const slot = `<div class="gate ${slotV[0]}"><div class="gk">Slot</div><div class="gv">${slotV[1]}</div></div>`;
  const J = ['Applied', 'Screened', 'Site', 'Slot', 'Onboard', 'Open'];
  const stage = o === 'WITHDRAWN' ? -1 : r.gates.partner !== 'ok' || r.gates.location === 'hold' ? 1 : !['ok', 'conditional'].includes(r.gates.site) ? 2 : !o.startsWith('SHORTLIST') ? 3 : 4;
  const blocked = ['HOLD', 'RELOCATE', 'OUT_OF_PLAN', 'NOT_PROCEEDING'].includes(o);
  const journey = `<div class="journey">${J.map((l, i) => `<div class="js ${i < stage ? 'done' : i === stage ? (blocked ? 'block' : 'now') : ''}"><i>${i < stage ? '✓' : ['📝', '🧑‍💼', '🏬', '🎯', '🎓', '🎉'][i]}</i>${l}</div>`).join('')}</div>`;
  const factor = (label, key, val, raw) => `<div class="factor"><div>${label}<small>${raw}</small></div><div class="tr"><i style="width:${val ?? 0}%"></i></div><div><b>${val ?? '—'}</b><small>×${w[key]}%</small></div></div>`;
  const plan = buildPlan(r);
  const msg = ['WITHDRAWN', 'NOT_PROCEEDING'].includes(o) ? null : partnerMessage(r);
  const audit = S.patches.filter(p => p.id === id);
  const maxW = plan ? plan.totalWeeks + 12 : 1;
  const g = a.pin && S.geo[a.pin];
  const gmaps = a.pin ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${a.pin} ${a.city || ''} Karnataka`)}` : null;
  const street = g ? `https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${g.lat},${g.lng}` : null;
  const asks = asksFor(r);
  const link = S.links[id];
  $('#drawer').innerHTML = `<div class="dr-head"><button class="x" id="drX" aria-label="Close">×</button>
      <div class="who">${avatar(a, 'lg')}<div><div class="meta mono">${a.id} · row ${a.row ?? '—'} · ${esc(a.city || a.cityRaw)} ${a.pin || ''}</div><h2>${esc(a.name || '(no name)')}</h2>
      <div style="margin-top:6px;display:flex;gap:8px;align-items:center;flex-wrap:wrap">${chip(o)}<span class="tagp" style="background:rgba(244,234,210,.12);color:var(--cream)">score ${r.score}</span>${r.territory ? `<span class="tagp prio-${r.territory.priority}">${r.territory.id} · ${r.territory.priority}</span>` : ''}</div></div></div>
      ${journey}</div>
    <div class="dr-body">
      <div class="card"><div class="headline">${esc(r.decision.headline)}</div></div>
      <div class="gates">${loc}${par}${sit}${slot}</div>
      ${asks.length && !['WITHDRAWN', 'NOT_PROCEEDING'].includes(o) ? `<div class="portal" id="portalBox">${portalHtml(r, asks, link)}</div>` : ''}
      <div class="card"><div class="sec-title" style="margin-top:0"><h2>Why <em>— the evidence</em></h2><span class="sub">every line tagged by where it comes from</span></div>
        <ul class="evlist">${r.decision.evidence.map(e => `<li><span class="ev ev-${e.kind}">${evLabel[e.kind]}</span><span>${esc(e.text)}</span></li>`).join('')}</ul></div>
      <div class="grid g2">
        <div class="card"><h3 style="font-size:17px;margin-bottom:8px">Next steps</h3><ol style="margin:0;padding-left:18px">${r.decision.next.map(n => `<li>${esc(n)}</li>`).join('')}</ol>
          ${r.decision.change.length ? `<h3 style="font-size:17px;margin:14px 0 8px">What would change this</h3><ul style="margin:0;padding-left:18px">${r.decision.change.map(n => `<li>${esc(n)}</li>`).join('')}</ul>` : ''}</div>
        <div class="card"><h3 style="font-size:17px;margin-bottom:2px">Score breakdown</h3><div class="muted" style="font-size:11.5px;margin-bottom:6px">Compares partners in ${r.territory?.id || 'the territory'} — not a profit forecast</div>
          ${factor('💰 Capital', 'capital', f.capital, f.ratio !== null ? `₹${fmt(a.investment)}L vs ~₹${f.budget}L budget` : 'missing')}
          ${factor('🧑‍💼 Experience', 'experience', f.experience, `${fmt(a.experience)} yrs`)}
          ${factor('🏬 Site', 'site', f.site, f.siteParts ? `floor ${f.siteParts.floor} · size ${f.siteParts.size} · tenure ${f.siteParts.tenure}` : 'no site — neutral 50')}
          ${factor('🚀 Launch', 'launch', f.launch, `${fmt(a.launch)} mo vs ~${f.lead} mo min`)}
          <div style="text-align:right;font:800 26px var(--display);margin-top:6px">${r.score}</div></div>
      </div>
      ${r.alternatives?.length ? `<div class="card"><h3 style="font-size:17px;margin-bottom:8px">🔁 Free pins to offer</h3><div class="alt">${r.alternatives.map(x => `<div class="a"><b>${x.pin}</b> ${x.area ? esc(x.area) + ' · ' : ''}${x.territory} · ${x.priority}<br><span class="muted">${x.km !== null ? `~${x.km} km from requested pin` : ''}${x.nearestStoreKm !== null ? ` · nearest store ~${x.nearestStoreKm} km` : ''} · ${x.remaining} slot(s) open</span></div>`).join('')}</div></div>` : ''}
      <div class="card"><h3 style="font-size:17px;margin-bottom:8px">In their own words <span class="ev ev-claim" style="margin-left:6px">unverified</span></h3>
        <dl class="kv"><dt>Business</dt><dd>${esc(a.business) || '—'}</dd><dt>Notes</dt><dd>${esc(a.notes) || '—'}</dd><dt>Training language</dt><dd>${a.language || 'English (default)'}</dd>
        <dt>Competing</dt><dd>${r.competitors.samePin.length ? `Same pin: ${r.competitors.samePin.map(x => `<a href="#" data-app="${x}">${x}</a>`).join(', ')}<br>` : ''}${r.competitors.sameTerritory.length ? `Same territory: ${r.competitors.sameTerritory.map(x => `<a href="#" data-app="${x}">${x}</a>`).join(', ')}` : '—'}</dd>
        ${r.nearestStore ? `<dt>Nearest store</dt><dd>${r.nearestStore.store.id} (${r.nearestStore.store.pin}) ~${r.nearestStore.km} km</dd>` : ''}</dl>
        ${gmaps ? `<div style="display:flex;gap:8px;margin-top:12px;flex-wrap:wrap"><a class="btn sm" target="_blank" rel="noopener" href="${gmaps}">📍 Open pin in Google Maps</a>${street ? `<a class="btn sm" target="_blank" rel="noopener" href="${street}">👀 Street View</a>` : ''}</div>` : ''}</div>
      ${plan ? `<div class="card"><div class="sec-title" style="margin-top:0"><h2>Onboarding <em>plan</em></h2><span class="sub">${plan.provisional ? 'provisional · ' : ''}~${plan.totalWeeks} weeks · opens ~${plan.openDate}</span></div>
        <p style="margin:0 0 10px">${plan.feasibility.startsWith('target') ? `<span class="pill t-warn">${esc(plan.feasibility)}</span>` : `<span class="pill t-go">${esc(plan.feasibility)}</span>`} &nbsp;🎓 <b>${plan.track.name}</b> in <b>${plan.language}</b> — ${esc(plan.track.why)}</p>
        <div class="gantt" style="--wk:${100 / maxW}%">${plan.tasks.map((t, i) => `<div class="gr"><div class="gl" title="${esc(t.task)} — ${esc(t.why)} (owner: ${esc(t.owner)})"><b style="color:var(--ink-3);font-weight:700">${t.stage}</b> · ${esc(t.task)}</div><div class="gt"><span class="gb st-${t.stage.split(' ')[0]}" style="left:${t.start / maxW * 100}%;width:${Math.max(1.2, t.weeks / maxW * 100)}%;animation-delay:${i * .04}s"></span></div></div>`).join('')}</div>
        <details style="margin-top:10px"><summary>Training modules & task owners</summary><ul class="mods">${plan.track.modules.map(m => `<li>${esc(m)}</li>`).join('')}</ul>
        <table class="cmp" style="margin-top:8px"><tr><th>Task</th><th>Owner</th><th>Done when</th></tr>${plan.tasks.map(t => `<tr><td>${esc(t.task)}</td><td>${esc(t.owner)}</td><td>${esc(t.evidence)}</td></tr>`).join('')}</table></details></div>` : ''}
      ${msg ? `<div class="card"><h3 style="font-size:17px;margin-bottom:8px">💬 Message to partner · ${msg.lang}</h3><div class="msg" style="font-family:${msg.lang === 'Kannada' ? "'Noto Sans Kannada'," : msg.lang === 'Hindi' ? "'Noto Sans Devanagari'," : ''}var(--sans)">${esc(msg.text)}</div>
        <div style="display:flex;gap:8px;margin-top:10px"><button class="btn sm" id="copyMsg">Copy</button><a class="btn sm" target="_blank" rel="noopener" href="https://wa.me/?text=${encodeURIComponent(msg.text)}">Open in WhatsApp</a></div>
        ${msg.lang !== 'English' ? `<details style="margin-top:8px"><summary class="muted">English version</summary><p class="muted">${esc(msg.english)}</p></details>` : ''}</div>` : ''}
      ${audit.length ? `<div class="card"><h3 style="font-size:17px;margin-bottom:8px">Update history</h3><ul class="audit">${audit.map(p => `<li><b>${new Date(p.ts).toLocaleTimeString()}</b> · ${p.source === 'portal' ? '📬 partner link' : p.source === 'ai' ? '✦ AI-parsed' : '⌨ desk'} — "${esc(p.text)}" → ${esc(p.said.join(', '))}</li>`).join('')}</ul><p class="muted" style="font-size:12px">Workbook row ${a.row} is unchanged; updates are layered on top.</p></div>` : ''}
      <div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn sm" data-ask="Why is ${a.id} ${o === 'HOLD' ? 'on hold' : 'in this status'}?">Ask copilot why</button><button class="btn sm" data-ask="What would it take for ${a.id} to advance?">What would it take?</button></div>
    </div>`;
  $('#drawer').classList.add('on'); $('#drawerBg').classList.add('on'); $('#drawer').scrollTop = 0;
  $('#drX').onclick = closeDetail;
  const cm = $('#copyMsg'); if (cm) cm.onclick = () => { navigator.clipboard?.writeText(msg.text); toast('Message copied'); };
  wirePortal(r, asks);
}
function closeDetail() { $('#drawer').classList.remove('on'); $('#drawerBg').classList.remove('on'); }

// ---------- partner self-service link (Neon) ----------
const FIELD_LABEL = { investment: 'investment (₹ lakh)', experience: 'retail experience', space: 'owned / rented', size: 'shop size', floor: 'floor', pin: 'pin code', city: 'city', launch: 'target launch', language: 'training language', note: 'financing note' };
function portalHtml(r, asks, link) {
  const first = esc((r.app.name || 'them').split(' ')[0]);
  if (link?.status === 'answered') return `<div><h3>📬 ${first} replied</h3><p>Their answers were applied and the allocation re-ran. See the update history below.</p></div><div style="font-size:42px">✅</div>`;
  if (link) {
    const url = `${location.origin}/partner?id=${link.id}`;
    return `<div><h3>⏳ Waiting for ${first}…</h3><p>Fix-it link sent for: ${asks.map(k => FIELD_LABEL[k]).join(', ')}. The moment they submit, this decision re-runs automatically.</p>
      <input readonly value="${url}" onclick="this.select()"><div style="display:flex;gap:8px;margin-top:10px;flex-wrap:wrap"><a class="btn sm primary" target="_blank" rel="noopener" href="${url}">Open as partner ↗</a><a class="btn sm ghost-d" target="_blank" rel="noopener" href="https://wa.me/?text=${encodeURIComponent(partnerMessage(r).text + '\n' + url)}">Send on WhatsApp</a></div></div>
      <div class="qr">${qrSvg(url)}</div>`;
  }
  return `<div><h3>🔗 Let the partner fix it themselves</h3><p>Send ${first} a link (in ${r.app.language || 'English'}) asking only for: <b>${asks.map(k => FIELD_LABEL[k]).join(', ')}</b>. Their answer flows straight back here and the engine re-decides — no calls, no spreadsheets.</p>
    <button class="btn primary" id="mkLink">Create fix-it link</button>${S.portalReady ? '' : ' <span style="font-size:12px;color:rgba(244,234,210,.6)">(needs the Neon database on the live site)</span>'}</div><div style="font-size:46px">📲</div>`;
}
function qrSvg(text) {
  try { const q = qrcode(0, 'M'); q.addData(text); q.make(); return q.createSvgTag({ cellSize: 3, margin: 0, scalable: true }); } catch { return ''; }
}
function wirePortal(r, asks) {
  const b = $('#mkLink'); if (!b) return;
  b.onclick = async () => {
    b.disabled = true; b.textContent = 'Creating…';
    try {
      const resp = await fetch('/api/clarify', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ app: { id: r.app.id, name: r.app.name, language: r.app.language }, asks, context: { headline: r.decision.headline, city: r.app.city, pin: r.app.pin, space: r.app.space } }) });
      if (!resp.ok) throw new Error(resp.status === 503 ? 'The partner portal database is not connected yet.' : 'Could not create the link.');
      const { id } = await resp.json();
      S.links[r.app.id] = { id, status: 'sent', asks };
      $('#portalBox').innerHTML = portalHtml(r, asks, S.links[r.app.id]);
      say('ai', `🔗 Fix-it link created for <a href="#" data-app="${r.app.id}">${r.app.id}</a>. I'll apply their answer the moment they submit.`);
    } catch (e) { toast(e.message); b.disabled = false; b.textContent = 'Create fix-it link'; }
  };
}
async function pollLinks() {
  const open = Object.entries(S.links).filter(([, l]) => l.status === 'sent');
  for (const [appId, l] of open) {
    try {
      const d = await (await fetch(`/api/clarify?id=${l.id}`)).json();
      if (d.status !== 'answered' || !d.answer) continue;
      l.status = 'answered';
      const patch = {}, said = [], A = d.answer;
      if ('investment' in A) { patch.investment = A.investment; patch.investmentRaw = String(A.investment); said.push(`investment = ₹${A.investment} lakh`); }
      if ('experience' in A) { patch.experience = A.experience; patch.experienceRaw = String(A.experience); said.push(`experience = ${A.experience} yrs`); }
      if (A.space) { patch.space = A.space; said.push(`space = ${A.space}`); }
      if ('size' in A) { patch.size = A.size; patch.sizeRaw = String(A.size); said.push(`size = ${A.size} sq ft`); }
      if (A.floor) { patch.floor = A.floor; said.push(`floor = ${A.floor}`); }
      if (A.pin) { patch.pin = A.pin; patch.pinRaw = A.pin; said.push(`pin = ${A.pin}`); const city = Object.keys(CITIES).find(c => A.pin.startsWith(CITIES[c].prefix)); if (city) patch.city = city; }
      if (A.city && !patch.city) { patch.city = A.city; said.push(`city = ${A.city}`); }
      if ('launch' in A) { patch.launch = A.launch; patch.launchRaw = String(A.launch); said.push(`launch = ${A.launch} months`); }
      if (A.language) { patch.language = A.language; said.push(`language = ${A.language}`); }
      if (A.note) patch.notes = `${S.res.recs.find(x => x.app.id === appId)?.app.notes || ''} | Partner: ${A.note}`.slice(0, 600);
      applyUpdate({ type: 'app', id: appId, patch, said: said.length ? said : ['partner replied (no changes)'], text: 'Partner answered the fix-it link', source: 'portal' }, `📬 ${appId} answered their fix-it link`);
    } catch { }
  }
}
setInterval(() => { if (S.base && Object.values(S.links).some(l => l.status === 'sent')) pollLinks(); }, 4000);

// ---------- map ----------
function viewMap(v) {
  const cities = ['All', ...Object.keys(CITIES).filter(c => S.res.territories.some(t => t.city === c) || S.res.recs.some(r => r.city === c))];
  v.innerHTML = `<div class="map-bar">${cities.map(c => `<button class="fchip ${S.mapCity === c ? 'on' : ''}" data-city="${c}">${c}</button>`).join('')}<span class="muted" style="margin-left:auto;font-size:12px">Pin positions = OpenStreetMap pin-code centroids (approximate). Click a marker → details, Google Maps & Street View.</span></div>
    <div id="map"></div>
    <div class="legend"><span><i style="background:#0d2b20;border:2px solid #e6a93a;border-radius:4px"></i>Existing store + ${S.cfg.overlapKm} km catchment</span>${['SHORTLIST', 'SHORTLIST_CONDITIONAL', 'PREQUALIFIED', 'WAITLIST', 'RELOCATE', 'HOLD', 'OUT_OF_PLAN'].map(o => `<span><i style="background:${toneColor[OUTCOMES[o].tone]}"></i>${OUTCOMES[o].label}</span>`).join('')}<span><i style="border:2px dashed #e6a93a;background:transparent"></i>Free pin in an open territory</span></div>`;
  v.querySelectorAll('[data-city]').forEach(b => b.onclick = () => { S.mapCity = b.dataset.city; render(); });
  if (S.map) { S.map.remove(); S.map = null; }
  const map = L.map('map', { scrollWheelZoom: true });
  S.map = map;
  L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}', { attribution: 'Tiles © Esri — Esri, HERE, Garmin, © OpenStreetMap contributors', maxZoom: 16 }).addTo(map);
  L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Reference/MapServer/tile/{z}/{y}/{x}', { maxZoom: 16 }).addTo(map);
  const pts = [], g = S.geo, inCity = c => S.mapCity === 'All' || c === S.mapCity;
  for (const s of S.res.stores) {
    const p = g[s.pin]; if (!p || !inCity(s.city)) continue;
    L.circle([p.lat, p.lng], { radius: S.cfg.overlapKm * 1000, color: '#e6a93a', weight: 1.5, dashArray: '5 5', fillColor: '#e6a93a', fillOpacity: .08 }).addTo(map);
    L.marker([p.lat, p.lng], { icon: L.divIcon({ className: 'store-ic', html: s.id.replace('ST-', ''), iconSize: [26, 26] }) }).bindPopup(`<b>${s.id}</b> · existing store<br>${s.city} ${s.pin} · opened ${s.year}<br><a target="_blank" rel="noopener" href="https://www.google.com/maps/search/?api=1&query=${s.pin}+${encodeURIComponent(s.city)}">Google Maps ↗</a>`).addTo(map);
    pts.push([p.lat, p.lng]);
  }
  const claimed = new Set(S.res.recs.map(r => r.app.pin)), storePins = new Set(S.res.stores.map(s => s.pin));
  for (const st of Object.values(S.res.territoryState)) {
    if (!inCity(st.territory.city) || st.remaining <= 0) continue;
    for (const pin of st.territory.pins) {
      const p = g[pin]; if (!p || claimed.has(pin) || storePins.has(pin)) continue;
      L.circleMarker([p.lat, p.lng], { radius: 8, color: '#e6a93a', weight: 2, dashArray: '3 3', fillOpacity: 0 }).bindPopup(`<b>${pin}</b> ${p.area ? '· ' + esc(p.area) : ''}<br>Free pin in ${st.territory.id} (${st.remaining} slot open)`).addTo(map);
      pts.push([p.lat, p.lng]);
    }
  }
  const byPin = {};
  for (const r of S.res.recs) { if (!r.app.pin || !g[r.app.pin] || !inCity(r.city)) continue; (byPin[r.app.pin] ||= []).push(r); }
  for (const [pin, rs] of Object.entries(byPin)) {
    const p = g[pin];
    rs.forEach((r, i) => {
      const off = rs.length > 1 ? (i - (rs.length - 1) / 2) * 0.003 : 0;
      const col = toneColor[OUTCOMES[r.outcome].tone], sl = r.outcome.startsWith('SHORTLIST'), sz = sl ? 30 : 24;
      L.marker([p.lat + off, p.lng + off], { icon: L.divIcon({ className: `app-ic ${sl ? 'sl' : ''}`, html: `<span style="display:grid;place-items:center;width:100%;height:100%;border-radius:50%;background:${col}">${initials(r.app.name)}</span>`, iconSize: [sz, sz] }), zIndexOffset: sl ? 500 : 0 }).addTo(map)
        .bindPopup(`<b>${r.app.id}</b> · ${esc(r.app.name)}<br>${chip(r.outcome)}<br><span style="font-size:12px">${esc(r.decision.headline)}</span><br>${r.nearestStore ? `<span class="muted">Nearest store ${r.nearestStore.store.id} ~${r.nearestStore.km} km</span><br>` : ''}<a href="#" data-app="${r.app.id}">Open details →</a>`);
      pts.push([p.lat, p.lng]);
    });
  }
  if (pts.length) map.fitBounds(pts, { padding: [40, 40], maxZoom: 13 }); else map.setView([14.2, 76.2], 7);
}

// ---------- territories ----------
function viewTerritories(v) {
  const res = S.res;
  v.innerHTML = `<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Territory</th><th>City</th><th>Tier</th><th>Priority</th><th>Pins</th><th>Slots</th><th>Shortlisted</th><th>Waitlist (backfill order)</th><th>Other</th></tr></thead><tbody>
    ${Object.values(res.territoryState).map(st => { const t = st.territory; return `<tr><td class="id">${t.id}</td><td>${esc(t.city || t.cityRaw)}</td><td>${t.tier || '—'}</td><td><span class="tagp prio-${t.priority}">${t.priority || '—'}</span></td><td class="mono" style="font-size:12px">${t.pins.join(', ')}</td><td><b>${st.used}</b>/${t.slots ?? 0}</td>
      <td>${st.shortlisted.map(r => `<a href="#" data-app="${r.app.id}">${r.app.id}</a> (${r.score})`).join('<br>') || '—'}</td><td>${st.waitlist.map((r, i) => `${i + 1}. <a href="#" data-app="${r.app.id}">${r.app.id}</a> (${r.score})`).join('<br>') || '—'}</td>
      <td class="muted">${[...st.prequalified.map(r => r.app.id + ' find site'), ...st.held.map(r => r.app.id + ' hold'), ...st.relocate.map(r => r.app.id + ' move pin')].join('<br>') || '—'}</td></tr>`; }).join('')}</tbody></table></div>
    <div class="sec-title"><h2>Existing <em>stores</em></h2><span class="sub">Fixed sheet — the one-store-per-pin rule is checked against these</span></div>
    <div class="pins">${res.stores.map(s => `<span class="pinchip store" title="${s.city}, opened ${s.year}">${s.id} · ${s.pin} · ${s.city}</span>`).join('')}</div>`;
}

// ---------- assumptions ----------
function viewAssumptions(v) {
  const c = S.cfg;
  const ctl = (path, label, sub, min, max, step, val) => `<div class="ctl"><div>${label}<small>${sub}</small></div><input type="range" data-path="${path}" min="${min}" max="${max}" step="${step}" value="${val ?? 0}"><output>${val ?? 'off'}</output></div>`;
  v.innerHTML = `<div class="banner note">🎛 Everything here is an <b>assumption</b> — the brief gives no investment minimum, store size or payback rule. Move a slider and every decision re-runs live; the hard rules never move.</div>
  <div class="grid g2">
    <div class="card"><h3>Ranking weights</h3><p class="muted" style="font-size:12.5px">Used only to compare decision-ready partners competing in one territory.</p>
      ${ctl('weights.capital', '💰 Capital', 'Investment vs indicative setup budget', 0, 60, 5, c.weights.capital)}
      ${ctl('weights.experience', '🧑‍💼 Retail experience', 'Diminishing returns after ~6 years', 0, 60, 5, c.weights.experience)}
      ${ctl('weights.site', '🏬 Site quality', 'Floor (ground > mall > upper), size, owned vs rented', 0, 60, 5, c.weights.site)}
      ${ctl('weights.launch', '🚀 Launch readiness', 'Realistic & soon beats unrealistic or distant', 0, 60, 5, c.weights.launch)}
      ${ctl('qualityBar', '🚧 Quality bar', 'Below this, keep the slot open rather than fill it', 0, 80, 5, c.qualityBar)}
      <div id="live" style="font-size:12.5px;margin-top:12px;display:flex;gap:6px;flex-wrap:wrap;align-items:center"></div>
    </div>
    <div class="card"><h3>Money & site</h3><p class="muted" style="font-size:12.5px">Indicative all-in setup budgets (₹ lakh) — swap in the brand's real numbers.</p>
      ${ctl('budgetByTier.Tier 1', 'Tier 1 budget', 'Bengaluru', 10, 100, 5, c.budgetByTier['Tier 1'])}
      ${ctl('budgetByTier.Tier 2', 'Tier 2 budget', 'Mysuru, Mangaluru, Hubballi-Dharwad, Belagavi', 10, 100, 5, c.budgetByTier['Tier 2'])}
      ${ctl('budgetByTier.Tier 3', 'Tier 3 budget', 'Tumakuru, Davanagere', 10, 100, 5, c.budgetByTier['Tier 3'])}
      ${ctl('fundingHoldRatio', 'Funding-proof trigger', 'Ask for loan/co-investor proof below this share of budget', 0, 1, .05, c.fundingHoldRatio)}
      ${ctl('hardMinInvestment', 'Hard minimum (brand policy)', '0 = off. Only set if the brand confirms one', 0, 60, 5, c.hardMinInvestment || 0)}
      ${ctl('minSqft', 'Smallest workable shop (sq ft)', 'Below this we flag format fit', 100, 600, 25, c.minSqft)}
      ${ctl('overlapKm', 'Catchment radius (km)', 'Closer than this to our store → cannibalisation review', .5, 5, .5, c.overlapKm)}
    </div>
  </div>
  <div class="grid g2" style="margin-top:14px">
    <div class="card"><h3>Hard rules <em style="font-family:var(--serif);font-weight:400;color:var(--coral)">(never editable)</em></h3>
      <div class="rule"><span class="rk">Rule 1</span><span>The brand never opens two stores in one pin code — no new store on an existing store's pin, and one new applicant per pin.</span></div>
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
  const live = () => { const c2 = counts(); $('#live').innerHTML = `<b>Live:</b> ${['SHORTLIST', 'SHORTLIST_CONDITIONAL', 'WAITLIST', 'HOLD'].map(o => `${chip(o)} ${c2[o] || 0}`).join(' ')}`; };
  live();
  v.querySelectorAll('input[type=range]').forEach(inp => inp.oninput = () => {
    const [a, b] = inp.dataset.path.split('.');
    let val = +inp.value;
    if (a === 'hardMinInvestment' && val === 0) val = null;
    if (b) S.cfg[a][b] = val; else S.cfg[a] = val;
    inp.nextElementSibling.textContent = val ?? 'off';
    recompute(); live();
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
    <div class="sec-title"><h2>Territory <em>master data</em></h2><span class="sub">Issues in the brand's own sheet</span></div>
    <div class="card">${res.dataIssues.length ? `<ul class="evlist">${res.dataIssues.map(d => `<li><span class="ev ${d.sev === 'high' ? 'ev-gap' : 'ev-assumption'}">${d.sev}</span><span><b>${esc(d.ref)}</b> — ${esc(d.text)}</span></li>`).join('')}</ul>` : '<span class="muted">No issues.</span>'}</div>
    <div class="sec-title"><h2>Application <em>data gaps</em></h2><span class="sub">${rowIssues.length} item(s) to clarify</span></div>
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
  const hold = res.recs.find(r => r.outcome === 'HOLD'), pre = res.recs.find(r => r.outcome === 'PREQUALIFIED'), pin = res.recs.find(r => r.competitors.samePin.length), sl = res.recs.find(r => r.outcome === 'SHORTLIST');
  const ex = [hold && `Why is ${hold.app.id} on hold?`, pre && `${pre.app.id} has now found a ground-floor space`, pin && `Who is competing for ${pin.app.pin}?`, 'Which high-priority territories still have slots?', sl && `What is the onboarding plan for ${sl.app.id}?`, 'How do you decide?'].filter(Boolean);
  return `Try: <div class="sugg">${ex.map(e => `<button class="sg" data-q="${esc(e)}">${esc(e)}</button>`).join('')}</div>`;
}

function applyUpdate(patch, title) {
  const prev = S.res;
  patch.ts = Date.now();
  S.patches.push(patch);
  recompute();
  const ch = diff(prev, S.res, patch.id);
  const improved = ch.some(c => c.id === patch.id && c.to.startsWith('SHORTLIST') && !c.from.startsWith('SHORTLIST'));
  let html = diffHtml(ch, patch.said, patch.id, patch.whatIf);
  if (title) html = `<div class="ans-head">${title}</div>` + html.replace(/^<div class="ans-head">.*?<\/div>/, '');
  say('ai', html + (S.res.invariants.ok ? '<div class="src">🛡 Hard rules re-verified after the change</div>' : `<div class="banner bad">${S.res.invariants.errors.join(' ')}</div>`));
  if (improved) { confetti(); toast(`🎉 ${patch.id} moved into a slot!`); }
  render();
  if ($('#drawer').classList.contains('on') && S.focus) openDetail(S.focus);
}

async function ask(text) {
  if (!text.trim()) return;
  say('me', esc(text));
  if (!S.base) { say('ai', 'Please load a workbook first (or press “Play the demo”).'); return; }
  const out = interpret(text, S.res, { focus: S.focus });
  if (out.focus) S.focus = out.focus;
  if (out.kind === 'undo') {
    const p = S.patches.pop();
    if (!p) return say('ai', 'Nothing to undo.');
    const prev = S.res; recompute();
    const ch = diff(prev, S.res, p.id).filter(c => c.from !== c.to);
    say('ai', `<div class="ans-head">↩ Undid “${esc(p.text)}”</div>${ch.length ? `<table class="cmp diff">${ch.map(c => `<tr><td><a href="#" data-app="${c.id}">${c.id}</a></td><td>${chip(c.from)}</td><td>→</td><td>${chip(c.to)}</td></tr>`).join('')}</table>` : '<p class="muted">No decision changed.</p>'}`);
    return render();
  }
  if (out.kind === 'reset') { S.patches = []; recompute(); render(); return say('ai', 'Reset — every update removed, back to the workbook.'); }
  if (out.kind === 'update') return applyUpdate({ type: out.app ? 'app' : 'ter', id: out.app || out.territory, patch: out.patch, said: out.said, text, whatIf: out.whatIf, source: 'desk' });
  if (out.kind === 'nofact' || out.kind === 'fallback') {
    const bub = say('ai', '<span class="typing">Thinking</span>');
    if (S.ai) {
      const parsed = out.question ? null : await aiParse(text);
      if (parsed?.ambiguous) { bub.remove(); return; }
      if (parsed) { bub.remove(); return applyUpdate(parsed, `✦ AI matched this to ${esc(parsed.who)} — check it's the right person (undo if not)`); }
      if (out.kind === 'fallback') {
        const ans = await aiAnswer(text);
        if (ans) { bub.innerHTML = `${ans}<div class="src">✦ Gemini, grounded in this session's records · rules are enforced in code, not by the AI</div>`; return; }
      }
    }
    bub.innerHTML = out.html;
    return;
  }
  say('ai', out.html + '<div class="src">From this session\'s decision records</div>');
}

const APP_FIELDS = { investment: 'number', experience: 'number', size: 'number', launch: 'number', space: ['Owned', 'Rented', 'Identified', 'Not yet identified'], floor: ['Ground', 'Upper', 'Mall unit', 'Not known'], language: ['Kannada', 'English', 'Hindi'], pin: 'pin', city: 'city', withdrawn: 'bool' };
async function aiParse(text) {
  try {
    const r = await fetch('/api/ai', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ mode: 'parse', question: text, ids: [...S.res.recs.map(r => `${r.app.id} = ${r.app.name}, ${r.app.city || r.app.cityRaw || '?'} ${r.app.pin || ''}, business: ${(r.app.business || '—').slice(0, 60)}`), ...S.res.territories.map(t => `${t.id} = territory in ${t.city}`)] }) });
    if (!r.ok) return null;
    const p = (await r.json()).parsed;
    if (!p?.target || !p.fields || p.ambiguous) { if (p?.ambiguous) { say('ai', `🤔 ${esc(p.ambiguous)}`); return { ambiguous: true }; } return null; }
    const target = String(p.target).toUpperCase();
    const isTer = /^TER/.test(target);
    const rec = S.res.recs.find(x => x.app.id === target);
    if (isTer ? !S.res.territories.some(t => t.id === target) : !rec) return null;
    // Guardrail: if the message names a city, the matched applicant must be in that city.
    const low = text.toLowerCase();
    const named = Object.keys(CITIES).filter(c => [c, ...({ Bengaluru: ['bangalore'], Mysuru: ['mysore'], Mangaluru: ['mangalore'], 'Hubballi-Dharwad': ['hubli', 'hubballi', 'dharwad'], Belagavi: ['belgaum'], Tumakuru: ['tumkur'], Davanagere: ['davangere'] }[c] || [])].some(w => low.includes(w.toLowerCase())));
    if (rec && named.length && !named.includes(rec.app.city) && !p.fields.city) { say('ai', `🛡 The AI matched this to ${rec.app.id} (${esc(rec.app.name)}, ${esc(rec.app.city)}), but you mentioned ${named.join('/')}. Not applied — please name the application ID.`); return { ambiguous: true }; }
    const patch = {}, said = [], rejected = [];
    // Guardrail: the AI may not invent numbers. Every number it returns must appear in the message itself
    // (crore values may appear ×100 as lakh).
    const seen = new Set();
    for (const m of text.toLowerCase().matchAll(/(\d+(?:\.\d+)?)\s*(crore|cr\b)?/g)) { seen.add(+m[1]); if (m[2]) seen.add(+m[1] * 100); }
    for (const [k, v] of Object.entries(p.fields)) {
      if ((APP_FIELDS[k] === 'number' || k === 'slots') && !seen.has(+v)) { rejected.push(`${k} = ${v}`); continue; }
      if (isTer) { if (k === 'slots' && Number.isInteger(+v) && +v >= 0) { patch.slots = +v; said.push(`open slots = ${v}`); } if (k === 'priority' && ['High', 'Medium', 'Low'].includes(v)) { patch.priority = v; said.push(`priority = ${v}`); } continue; }
      const rule = APP_FIELDS[k]; if (!rule) continue;
      if (rule === 'number' && v !== null && v !== '' && Number.isFinite(+v) && +v >= 0) { patch[k] = +v; patch[k + 'Raw'] = String(v); said.push(`${k} = ${v}`); }
      else if (Array.isArray(rule) && rule.includes(v)) { patch[k] = v; said.push(`${k} = ${v}`); }
      else if (rule === 'pin' && /^\d{6}$/.test(String(v))) { patch.pin = String(v); patch.pinRaw = String(v); said.push(`pin = ${v}`); }
      else if (rule === 'city' && CITIES[v]) { patch.city = v; said.push(`city = ${v}`); }
      else if (rule === 'bool' && typeof v === 'boolean') { patch.withdrawn = v; said.push(v ? 'withdrawn' : 'reinstated'); }
    }
    if (rejected.length) say('ai', `🛡 Ignored AI-extracted value(s) not found in your message: <b>${esc(rejected.join(', '))}</b>. Numbers are only accepted if you actually said them.`);
    if (!said.length) return null;
    return { type: isTer ? 'ter' : 'app', id: target, patch, said, text, source: 'ai', who: rec ? `${rec.app.id} · ${rec.app.name} (${rec.app.city || '—'}, ${rec.app.business || 'business not stated'})` : target };
  } catch { return null; }
}
async function aiAnswer(question) {
  try {
    const compact = S.res.recs.map(r => ({ id: r.app.id, name: r.app.name, city: r.app.city, pin: r.app.pin, territory: r.territory?.id, investment: r.app.investment, experience: r.app.experience, space: r.app.space, floor: r.app.floor, size: r.app.size, launch: r.app.launch, outcome: OUTCOMES[r.outcome].label, score: r.score, headline: r.decision.headline, next: r.decision.next, issues: r.issues.map(i => i.text), flags: r.flags.map(f => f.text), notes: r.app.notes }));
    const terr = Object.values(S.res.territoryState).map(s => ({ id: s.territory.id, city: s.territory.city, priority: s.territory.priority, slots: s.territory.slots, filled: s.used, pins: s.territory.pins, shortlisted: s.shortlisted.map(r => r.app.id), waitlist: s.waitlist.map(r => r.app.id) }));
    const r = await fetch('/api/ai', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ mode: 'answer', question, records: compact, territories: terr, config: S.cfg }) });
    if (!r.ok) return null;
    const d = await r.json();
    return d.answer ? esc(d.answer).replace(/\b(APP-\d+)\b/g, '<a href="#" data-app="$1">$1</a>').replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/\n/g, '<br>') : null;
  } catch { return null; }
}

// voice input (free, built into Chrome/Edge)
function setupVoice() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition, b = $('#micBtn');
  if (!SR) { b.title = 'Voice input needs Chrome or Edge'; b.style.opacity = .4; return; }
  let rec = null;
  b.onclick = () => {
    if (rec) { rec.stop(); return; }
    rec = new SR(); rec.lang = 'en-IN'; rec.interimResults = true;
    b.classList.add('rec');
    rec.onresult = e => { $('#cpText').value = [...e.results].map(x => x[0].transcript).join(' '); };
    rec.onend = () => { b.classList.remove('rec'); rec = null; const t = $('#cpText').value.trim(); if (t) { $('#cpText').value = ''; ask(t); } };
    rec.onerror = () => { b.classList.remove('rec'); rec = null; toast('Voice not available — type instead'); };
    rec.start();
  };
}

// ---------- export ----------
function exportXlsx() {
  const rows = S.res.recs.map(r => ({ 'Application ID': r.app.id, 'Applicant': r.app.name, 'City': r.app.city, 'Pin': r.app.pin, 'Territory': r.territory?.id || '', 'Priority': r.territory?.priority || '',
    'Decision': OUTCOMES[r.outcome].label, 'Score': r.score, 'Location gate': r.gates.location, 'Partner gate': r.gates.partner, 'Site gate': r.gates.site,
    'Why': r.decision.headline, 'Evidence': r.decision.evidence.map(e => `[${evLabel[e.kind]}] ${e.text}`).join(' | '), 'Next steps': r.decision.next.join(' | '), 'What would change it': r.decision.change.join(' | '),
    'Alternative pins': (r.alternatives || []).map(a => a.pin).join(', '), 'Training language': r.app.language || 'English' }));
  const tasks = S.res.recs.flatMap(r => { const p = buildPlan(r); return p ? p.tasks.map(t => ({ 'Application ID': r.app.id, Stage: t.stage, Task: t.task, Owner: t.owner, 'Start week': t.start, Weeks: t.weeks, 'Done when': t.evidence, Why: t.why })) : []; });
  const terr = Object.values(S.res.territoryState).map(s => ({ Territory: s.territory.id, City: s.territory.city, Priority: s.territory.priority, Slots: s.territory.slots, Filled: s.used, Shortlisted: s.shortlisted.map(r => r.app.id).join(', '), 'Waitlist order': s.waitlist.map(r => r.app.id).join(', ') }));
  const audit = S.patches.map(p => ({ Time: new Date(p.ts).toISOString(), Target: p.id, Source: p.source || 'desk', Message: p.text, Applied: p.said.join(', ') }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), 'Decisions');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(terr), 'Territories');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(tasks), 'Onboarding tasks');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(audit.length ? audit : [{ Note: 'No updates' }]), 'Update log');
  XLSX.writeFile(wb, 'sthala-decisions.xlsx');
}

// ---------- wiring ----------
function toast(t) { const el = $('#toast'); el.textContent = t; el.classList.add('on'); clearTimeout(toast.t); toast.t = setTimeout(() => el.classList.remove('on'), 2600); }
function readFile(f) { const rd = new FileReader(); rd.onload = () => loadBytes(new Uint8Array(rd.result), f.name); rd.readAsArrayBuffer(f); }

document.addEventListener('click', e => {
  const a = e.target.closest('[data-app]'); if (a && !e.target.closest('input')) { e.preventDefault(); openDetail(a.dataset.app); return; }
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
if (matchMedia('(max-width: 1020px)').matches) $('#cpClose').hidden = false;
setupVoice();

fetch('/api/ai').then(r => r.ok ? r.json() : null).then(d => { S.ai = !!d?.ready; const c = $('#aiChip'); c.textContent = S.ai ? 'AI: Gemini ✓' : 'AI: rules only'; c.classList.toggle('on', S.ai); }).catch(() => { $('#aiChip').textContent = 'AI: rules only'; });
fetch('/api/clarify').then(r => { S.portalReady = r.ok; }).catch(() => { });
fetch('data/pins.json').then(r => r.json()).then(d => { Object.assign(S.geo, d); if (S.base) { recompute(); render(); } }).catch(() => { });
render();
if (new URLSearchParams(location.search).has('demo')) loadDemo();
