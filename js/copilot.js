// Copilot: deterministic language layer. Understands questions and new facts, turns facts into
// auditable patches, and answers only from the current decision records — never from guesses.
import { OUTCOMES, CITIES, normCity } from './engine.js';
import { buildPlan } from './plan.js';

const esc = x => String(x ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const chip = o => `<span class="pill t-${OUTCOMES[o]?.tone}">${OUTCOMES[o]?.label || o}</span>`;
const appLink = id => `<a href="#" data-app="${id}">${id}</a>`;
const ids = text => [...new Set((text.match(/\b(?:app)[\s-]?0*(\d{1,4})\b/gi) || []).map(m => m.replace(/\D/g, '')))];

export function resolveIds(text, res) {
  const nums = ids(text);
  const known = res.recs.map(r => r.app.id);
  const found = nums.map(n => known.find(k => k.replace(/\D/g, '').replace(/^0+/, '') === n.replace(/^0+/, '')) || `APP-${n.padStart(3, '0')}`);
  if (found.length) return found;
  // fall back to names: "Priya now has 30 lakh" — full name first, then a first name that is unique
  const t = ' ' + text.toLowerCase().replace(/[^a-z\u0080-\uffff ]/g, ' ') + ' ';
  const full = res.recs.filter(r => r.app.name && t.includes(' ' + r.app.name.toLowerCase() + ' '));
  if (full.length === 1) return [full[0].app.id];
  const first = res.recs.filter(r => { const f = (r.app.name || '').toLowerCase().split(' ')[0]; return f.length > 2 && t.includes(' ' + f + ' '); });
  const uniq = [...new Set(first.map(r => (r.app.name || '').toLowerCase().split(' ')[0]))];
  return first.length && uniq.length === 1 && first.length === 1 ? [first[0].app.id] : [];
}
const terIds = (text, res) => [...new Set((text.match(/\bter[\s-]?0*(\d{1,3})\b/gi) || []).map(m => m.replace(/\D/g, '').replace(/^0+/, '')))]
  .map(n => res.territories.find(t => t.id.replace(/\D/g, '').replace(/^0+/, '') === n)?.id).filter(Boolean);

// ---------- fact extraction ----------
export function extractAppPatch(text, current) {
  const t = text.toLowerCase(), patch = {}, said = [];
  if (/withdr|drop(ped)? out|no longer interested|backed out|pulled out|not interested any ?more|cancel/.test(t)) { patch.withdrawn = true; said.push('withdrawn'); return { patch, said }; }
  if (/reinstat|back in the race|re-?apply|wants to continue/.test(t)) { patch.withdrawn = false; said.push('reinstated'); }

  const space = /\b(space|shop|premises|store|unit|location|site|place|property)\b/.test(t);
  if (/\bown(s|ed)?\b|bought|purchased/.test(t) && space) { patch.space = 'Owned'; said.push('space = Owned'); }
  else if (/rent|lease/.test(t) && space) { patch.space = 'Rented'; said.push('space = Rented'); }
  else if (/(found|identified|secured|got|located|finali[sz]ed|signed|has)\b.*\b(space|shop|premises|unit|site|place|property)/.test(t) || /(space|shop|site)\b.*\b(found|identified|secured|finali[sz]ed)/.test(t)) {
    if (!current || !['Owned', 'Rented'].includes(current.space)) { patch.space = 'Identified'; said.push('space found (owned vs rented not stated)'); }
  }
  if (/no longer has|lost (the|their)? ?(space|shop)|space fell through|deal fell/.test(t)) { patch.space = 'Not yet identified'; patch.size = null; patch.floor = null; said.push('space no longer available'); }

  if (/ground[- ]?floor|\bground\b/.test(t)) { patch.floor = 'Ground'; said.push('floor = Ground'); }
  else if (/\bmall\b/.test(t)) { patch.floor = 'Mall unit'; said.push('floor = Mall unit'); }
  else if (/upper|first[- ]floor|1st[- ]floor|second[- ]floor|2nd[- ]floor|top floor/.test(t)) { patch.floor = 'Upper'; said.push('floor = Upper'); }

  const sq = t.match(/(\d[\d,]*)\s*(sq\.?\s*ft|sqft|sft|square\s*f(ee|oo)t|sq\.?\s*feet)/);
  if (sq) { patch.size = +sq[1].replace(/,/g, ''); said.push(`size = ${patch.size} sq ft`); }

  const pinM = t.match(/\b(5\d{5})\b/);
  if (pinM && !/\bter/.test(t.slice(Math.max(0, pinM.index - 12), pinM.index))) {
    patch.pin = pinM[1]; patch.pinRaw = pinM[1]; said.push(`pin = ${pinM[1]}`);
    const city = Object.keys(CITIES).find(c => pinM[1].startsWith(CITIES[c].prefix));
    if (city && current && current.city !== city) { patch.city = city; said.push(`city = ${city}`); }
  }
  const cityWord = (t.match(/\b(?:to|in|at)\s+(bengaluru|bangalore|mysuru|mysore|mangaluru|mangalore|hubballi|hubli|dharwad|belagavi|belgaum|tumakuru|tumkur|davanagere|davangere)\b/) || [])[1];
  if (cityWord && !patch.city) { patch.city = normCity(cityWord); said.push(`city = ${patch.city}`); }

  const inv = t.match(/(?:₹|rs\.?\s*|inr\s*)?(\d+(?:\.\d+)?)\s*(lakh|lakhs|lac|lacs|l\b|crore|cr\b)/) || t.match(/invest\w*\s+(?:capacity\s+)?(?:is\s+|of\s+|to\s+|up to\s+|now\s+)*(?:₹|rs\.?\s*)?(\d+(?:\.\d+)?)/);
  if (inv) { patch.investment = +inv[1] * (/crore|cr/.test(inv[2] || '') ? 100 : 1); patch.investmentRaw = String(patch.investment); said.push(`investment = ₹${patch.investment} lakh`); }

  const exp = t.match(/(\d+(?:\.\d+)?)\s*(?:\+\s*)?(?:years?|yrs?)\b(?![^.]*\b(?:to open|launch)\b)/);
  if (exp && /experience|retail|running|ran|managed|managing|shop|store|business/.test(t)) { patch.experience = +exp[1]; patch.experienceRaw = exp[1]; said.push(`retail experience = ${patch.experience} yrs`); }
  else if (/no (retail )?experience|zero experience/.test(t)) { patch.experience = 0; patch.experienceRaw = '0'; said.push('retail experience = 0'); }

  const mo = t.match(/(\d+(?:\.\d+)?)\s*months?/);
  if (mo) { patch.launch = +mo[1]; patch.launchRaw = mo[1]; said.push(`target launch = ${patch.launch} months`); }
  const lg = t.match(/\b(kannada|hindi|english)\b/);
  if (lg && /language|train|speak|prefer/.test(t)) { patch.language = lg[1][0].toUpperCase() + lg[1].slice(1); said.push(`language = ${patch.language}`); }
  return { patch, said };
}

export function extractTerritoryPatch(text) {
  const t = text.toLowerCase(), patch = {}, said = [];
  const sl = t.match(/(\d+)\s*(?:open\s*)?slots?/) || t.match(/slots?\s*(?:to|=|is|are|now)?\s*(\d+)/);
  if (sl) { patch.slots = +sl[1]; said.push(`open slots = ${patch.slots}`); }
  const pr = t.match(/\b(high|medium|low)\b\s*priority|priority\s*(?:to|is|=)?\s*\b(high|medium|low)\b/);
  if (pr) { const p = pr[1] || pr[2]; patch.priority = p[0].toUpperCase() + p.slice(1); said.push(`priority = ${patch.priority}`); }
  const pins = t.match(/\b5\d{5}\b/g);
  if (pins && /add/.test(t)) { patch.addPins = pins; said.push(`add pins ${pins.join(', ')}`); }
  return { patch, said };
}

// ---------- main entry ----------
export function interpret(text, res, ctx = {}) {
  const q = text.trim(), t = q.toLowerCase();
  if (!q) return { kind: 'answer', html: help() };
  if (/^\s*(undo|revert)\b/.test(t)) return { kind: 'undo' };
  if (/^\s*reset\b/.test(t)) return { kind: 'reset' };
  if (/^(help|\?|what can you do)/.test(t)) return { kind: 'answer', html: help() };

  let appIds = resolveIds(q, res);
  const tIds = terIds(q, res);
  const isQuestion = /\?\s*$/.test(q) || /^(why|what|which|who|how|when|where|is|are|does|do|can|should|show|list|explain|tell|compare|give)\b/.test(t);
  const whatIf = /^what if\b/.test(t);

  // Territory updates
  if (tIds.length && !isQuestion) {
    const { patch, said } = extractTerritoryPatch(q);
    if (said.length) return { kind: 'update', territory: tIds[0], patch, said, whatIf };
  }
  // Applicant updates
  if (!appIds.length && ctx.focus && !isQuestion && /\b(they|he|she|this applicant|the applicant|partner)\b/.test(t)) appIds = [ctx.focus];
  if (appIds.length === 1 && (!isQuestion || whatIf)) {
    const rec = res.recs.find(r => r.app.id === appIds[0]);
    if (!rec) return { kind: 'answer', html: `I can't find <b>${esc(appIds[0])}</b> in this workbook.` };
    const { patch, said } = extractAppPatch(q, rec.app);
    if (said.length) return { kind: 'update', app: appIds[0], patch, said, whatIf };
    if (!isQuestion) return { kind: 'nofact', app: appIds[0], html: `I understood this is about ${appLink(appIds[0])} but couldn't pick out a specific fact. Try e.g. <i>"${appIds[0]} has found a 500 sq ft ground-floor rented shop"</i> or <i>"${appIds[0]} can now invest 35 lakh"</i>.` };
  }

  // A statement that sounds like new information but names no ID ("the Hubli lady got her loan, 32 lakh") goes to the AI parser;
  // the rule-based reading stays as the fallback.
  if (!isQuestion && !appIds.length && !tIds.length && !ctx.noJudge && /\d|\bnow\b|found|sanction|withdr|moved|signed|\bgot\b|lost|dropp|backed out|agreed/.test(t)) {
    const det = interpret(text, res, { ...ctx, noJudge: true });
    return { kind: 'fallback', html: det.html, question: false };
  }
  // Judgement questions ("riskiest", "should we", "recommend") go to the AI first; the rule answer is the fallback.
  const judge = /\b(risk|risky|riskiest|safest|best|worst|should|recommend|strongest|weakest|advice|concern|worr|trade-?off|which one|would you|opinion|suggest)\w*/.test(t);
  if (judge && isQuestion && !ctx.noJudge) {
    const det = interpret(text, res, { ...ctx, noJudge: true });
    return { kind: 'fallback', html: det.html, focus: det.focus, question: true };
  }
  if (/cannibal|overlap|catchment|too close|near(by)? (an |our )?(existing )?store/.test(t)) return { kind: 'answer', html: overlapAnswer(res) };

  // Questions
  if (appIds.length >= 2 && /compar|vs|versus|between|better/.test(t)) return { kind: 'answer', html: compare(appIds, res) };
  if (appIds.length) {
    const rec = res.recs.find(r => r.app.id === appIds[0]);
    if (!rec) return { kind: 'answer', html: `I can't find <b>${esc(appIds[0])}</b> in this workbook.` };
    if (/next|onboard|plan|train|prepare|timeline|open(ing)? date|when .* open/.test(t)) return { kind: 'answer', html: planAnswer(rec), focus: rec.app.id };
    if (/what (would|needs|has) to change|how can .* (advance|get|move)|what would it take|to advance/.test(t)) return { kind: 'answer', html: changeAnswer(rec), focus: rec.app.id };
    if (/compet|rival|against|same pin/.test(t)) return { kind: 'answer', html: competitorAnswer(rec, res), focus: rec.app.id };
    return { kind: 'answer', html: why(rec), focus: rec.app.id };
  }
  const pinQ = q.match(/\b(5\d{5})\b/);
  if (pinQ) return { kind: 'answer', html: pinAnswer(pinQ[1], res) };
  if (tIds.length) return { kind: 'answer', html: territoryAnswer(res.territoryState[tIds[0]], res) };
  const cityQ = Object.keys(CITIES).find(c => t.includes(c.toLowerCase()) || t.includes(c.toLowerCase().split('-')[0])) || normCity((t.match(/\b(bangalore|mysore|mangalore|hubli|belgaum|tumkur|davangere)\b/) || [])[1] || '');
  if (/slot|capacity|remaining|left|available/.test(t) && !cityQ) return { kind: 'answer', html: slotsAnswer(res, /high/.test(t)) };
  if (cityQ) {
    const ts = res.territories.filter(x => x.city === cityQ);
    if (!ts.length) return { kind: 'answer', html: `No territories in ${cityQ} in this workbook.` };
    return { kind: 'answer', html: ts.map(x => territoryAnswer(res.territoryState[x.id], res)).join('<hr>') };
  }
  const listMap = [[/shortlist|selected|approved|moving forward|go ahead/, ['SHORTLIST', 'SHORTLIST_CONDITIONAL']], [/wait/, ['WAITLIST']], [/hold|incomplete|missing|pending/, ['HOLD']],
    [/relocat|blocked|existing store|same pin|clash|conflict/, ['RELOCATE']], [/pre-?qual|no site|without (a )?(site|space)|find (a )?site/, ['PREQUALIFIED']], [/outside|out of plan|no territory/, ['OUT_OF_PLAN']], [/withdr/, ['WITHDRAWN']]];
  for (const [re, outs] of listMap) if (re.test(t)) return { kind: 'answer', html: listAnswer(outs, res) };
  if (/high[- ]priority|priority/.test(t)) return { kind: 'answer', html: slotsAnswer(res, true) };
  if (/score|weight|rank|how do you (decide|choose)|method|logic|assum/.test(t)) return { kind: 'answer', html: methodAnswer(res) };
  if (/summary|overview|status|how many|total/.test(t)) return { kind: 'answer', html: summary(res) };
  if (/data|issue|error|quality|problem/.test(t)) return { kind: 'answer', html: dataAnswer(res) };
  return { kind: 'fallback', html: `I'm not sure what you mean. ${help(true)}`, question: isQuestion };
}

// ---------- answers ----------
function why(r) {
  const d = r.decision;
  const ev = d.evidence.map(e => `<li><span class="ev ev-${e.kind}">${evLabel[e.kind]}</span> ${esc(e.text)}</li>`).join('');
  return `<div class="ans-head">${appLink(r.app.id)} · ${esc(r.app.name)} ${chip(r.outcome)}</div>
  <p><b>${esc(d.headline)}</b></p>
  <div class="ans-sub">Why — evidence</div><ul class="evlist">${ev}</ul>
  <div class="ans-sub">Next steps</div><ol>${d.next.map(n => `<li>${esc(n)}</li>`).join('')}</ol>
  ${d.change.length ? `<div class="ans-sub">What would change this</div><ul>${d.change.map(n => `<li>${esc(n)}</li>`).join('')}</ul>` : ''}`;
}
export const evLabel = { fact: 'Workbook', derived: 'Computed', assumption: 'Assumption', claim: 'Applicant says', gap: 'Missing / unclear' };

function changeAnswer(r) {
  return `<div class="ans-head">${appLink(r.app.id)} ${chip(r.outcome)}</div><p>${esc(r.decision.headline)}</p>
  <div class="ans-sub">To move forward</div><ul>${(r.decision.change.length ? r.decision.change : ['Nothing — already moving forward.']).map(x => `<li>${esc(x)}</li>`).join('')}</ul>
  ${r.hypothetical ? `<p class="muted">If cleared at today's values: score ${r.hypothetical.score}, rank ~#${r.hypothetical.rank} for ${r.hypothetical.slots} slot(s).</p>` : ''}`;
}

function planAnswer(r) {
  const p = buildPlan(r);
  if (!p) return `${appLink(r.app.id)} ${chip(r.outcome)} isn't moving forward yet, so there's no onboarding plan. First: <ul>${r.decision.next.map(x => `<li>${esc(x)}</li>`).join('')}</ul>`;
  const stages = [...new Set(p.tasks.map(x => x.stage))];
  return `<div class="ans-head">${appLink(r.app.id)} onboarding ${chip(r.outcome)}</div>
  <p>${p.provisional ? '<b>Provisional</b> — runs once conditions clear. ' : ''}~${p.totalWeeks} weeks · estimated opening <b>${p.openDate}</b> (${esc(p.feasibility)}).</p>
  <p>Training: <b>${p.track.name}</b> in <b>${p.language}</b> — ${esc(p.track.why)}</p>
  <ul>${stages.map(s => `<li><b>${s}:</b> ${p.tasks.filter(x => x.stage === s).map(x => esc(x.task)).join(' · ')}</li>`).join('')}</ul>`;
}

function competitorAnswer(r, res) {
  const sp = r.competitors.samePin.map(id => res.recs.find(x => x.app.id === id));
  const st = r.competitors.sameTerritory.map(id => res.recs.find(x => x.app.id === id));
  return `<div class="ans-head">${appLink(r.app.id)} competition</div>
  <p><b>Same pin ${r.app.pin}:</b> ${sp.length ? sp.map(x => `${appLink(x.app.id)} ${chip(x.outcome)}`).join(' ') : 'none'}</p>
  <p><b>Same territory ${r.territory?.id || '—'}:</b> ${st.length ? st.map(x => `${appLink(x.app.id)} (${x.score})`).join(', ') : 'none'}</p>`;
}

function compare(list, res) {
  const rs = list.map(id => res.recs.find(r => r.app.id === id)).filter(Boolean);
  if (rs.length < 2) return 'I need two valid application IDs to compare.';
  const rows = [['Outcome', r => chip(r.outcome)], ['Territory', r => r.territory?.id || '—'], ['Pin', r => r.app.pin || '—'], ['Score', r => r.score],
    ['Capital', r => `₹${r.app.investment ?? '—'}L → ${r.factors.capital ?? '—'}`], ['Experience', r => `${r.app.experience ?? '—'} yrs → ${r.factors.experience ?? '—'}`],
    ['Site', r => `${r.app.space || '—'}${r.app.floor ? ', ' + r.app.floor : ''}${r.app.size ? ', ' + r.app.size + ' sq ft' : ''} → ${r.factors.site ?? 'n/a'}`], ['Launch', r => `${r.app.launch ?? '—'} mo → ${r.factors.launch}`]];
  const winner = rs.slice().sort((a, b) => b.score - a.score)[0];
  return `<table class="cmp"><tr><th></th>${rs.map(r => `<th>${appLink(r.app.id)}</th>`).join('')}</tr>${rows.map(([l, f]) => `<tr><td>${l}</td>${rs.map(r => `<td>${f(r)}</td>`).join('')}</tr>`).join('')}</table>
  <p>${appLink(winner.app.id)} scores highest. Scores compare partners — they are not a forecast of profit.</p>`;
}

function pinAnswer(pin, res) {
  const rs = res.recs.filter(r => r.app.pin === pin);
  const store = res.stores.find(s => s.pin === pin);
  const ts = res.territories.filter(t => t.pins.includes(pin));
  return `<div class="ans-head">Pin ${pin}</div>
  <p>Territory: ${ts.length ? ts.map(t => t.id).join(', ') : '<b>none</b>'}${store ? ` · <b>existing store ${store.id}</b> (no new store possible)` : ''}</p>
  <p>Applicants: ${rs.length ? rs.map(r => `${appLink(r.app.id)} ${chip(r.outcome)} <span class="muted">${r.score}</span>`).join('<br>') : 'none'}</p>
  ${rs.length > 1 ? '<p class="muted">Only one store per pin — the highest-scoring decision-ready applicant gets it; others are offered alternative pins.</p>' : ''}`;
}

function territoryAnswer(st, res) {
  if (!st) return 'Territory not found.';
  const t = st.territory;
  const line = (label, arr) => `<p><b>${label}:</b> ${arr.length ? arr.map(r => `${appLink(r.app.id)} <span class="muted">(${r.score})</span>`).join(', ') : '—'}</p>`;
  return `<div class="ans-head">${t.id} · ${t.city} · ${t.tier} · ${t.priority || '—'} priority</div>
  <p>${st.used}/${t.slots ?? 0} slots filled · ${st.remaining} open · pins ${t.pins.join(', ')}</p>
  ${line('Shortlisted', st.shortlisted)}${line('Waitlist (in order)', st.waitlist)}${line('Pre-qualified, no site', st.prequalified)}${line('On hold', st.held)}${line('Relocate', st.relocate)}`;
}

function slotsAnswer(res, highOnly) {
  const order = { High: 0, Medium: 1, Low: 2 };
  const rows = Object.values(res.territoryState).filter(s => !highOnly || s.territory.priority === 'High')
    .sort((a, b) => (order[a.territory.priority] ?? 3) - (order[b.territory.priority] ?? 3));
  return `<table class="cmp"><tr><th>Territory</th><th>City</th><th>Priority</th><th>Slots</th><th>Filled</th><th>Open</th></tr>
  ${rows.map(s => `<tr><td>${s.territory.id}</td><td>${s.territory.city}</td><td>${s.territory.priority || '—'}</td><td>${s.territory.slots ?? 0}</td><td>${s.used}</td><td><b>${s.remaining}</b></td></tr>`).join('')}</table>
  ${highOnly ? '<p class="muted">Priority sets the order the team works in; it never overrides the slot limit.</p>' : ''}`;
}

function listAnswer(outs, res) {
  const rs = res.recs.filter(r => outs.includes(r.outcome));
  return `<div class="ans-head">${outs.map(o => OUTCOMES[o].label).join(' / ')} — ${rs.length}</div>
  ${rs.length ? `<ul>${rs.map(r => `<li>${appLink(r.app.id)} ${esc(r.app.name)} — ${esc(r.decision.headline)}</li>`).join('')}</ul>` : '<p>None.</p>'}`;
}

function overlapAnswer(res) {
  const rs = res.recs.filter(r => r.flags.some(f => /OVERLAP|CATCHMENT_UNKNOWN/.test(f.code)));
  const close = rs.filter(r => r.flags.some(f => f.code === 'CATCHMENT_OVERLAP' || f.code === 'NEW_STORE_OVERLAP'));
  const near = res.recs.filter(r => r.nearestStore && !close.includes(r)).sort((a, b) => a.nearestStore.km - b.nearestStore.km).slice(0, 4);
  return `<div class="ans-head">Cannibalisation check (${res.config.overlapKm} km screen)</div>
  ${close.length ? `<ul>${close.map(r => `<li>${appLink(r.app.id)} ${chip(r.outcome)} — ${esc(r.flags.find(f => /OVERLAP/.test(f.code)).text)}</li>`).join('')}</ul>` : `<p>No applicant is within ${res.config.overlapKm} km of an existing store or another shortlisted store.</p>`}
  ${near.length ? `<p><b>Closest others:</b> ${near.map(r => `${appLink(r.app.id)} ~${r.nearestStore.km} km from ${r.nearestStore.store.id}`).join(' · ')}</p>` : ''}
  <p class="muted">Distances use approximate pin-code centroids — a flag means "do a catchment visit before the LOI", not "reject". Same-pin cases are already blocked by the hard rule.</p>`;
}

function summary(res) {
  const c = {}; res.recs.forEach(r => c[r.outcome] = (c[r.outcome] || 0) + 1);
  const slots = Object.values(res.territoryState).reduce((a, s) => a + (s.territory.slots ?? 0), 0);
  const used = Object.values(res.territoryState).reduce((a, s) => a + s.used, 0);
  return `<div class="ans-head">${res.recs.length} applications · ${used}/${slots} slots filled</div>
  <ul>${Object.keys(OUTCOMES).filter(o => c[o]).map(o => `<li>${chip(o)} ${c[o]}</li>`).join('')}</ul>`;
}

function methodAnswer(res) {
  const w = res.config.weights;
  return `<div class="ans-head">How decisions are made</div>
  <ol><li><b>Hard rules (code):</b> one store per pin, never on an existing-store pin, never more than a territory's open slots. Match by exact pin only.</li>
  <li><b>Gates:</b> location → partner (investment, experience) → site (space, size, floor). Missing or contradictory facts put an application on hold — never a silent rejection.</li>
  <li><b>Score (only to compare):</b> capital ${w.capital}% · experience ${w.experience}% · site ${w.site}% · launch readiness ${w.launch}%. Below ${res.config.qualityBar} we keep the slot open.</li>
  <li><b>Allocation:</b> best per pin, then best per territory up to its slots. Rest are waitlisted in order and auto-promoted.</li></ol>
  <p class="muted">Every number above is an editable assumption (Assumptions tab).</p>`;
}

function dataAnswer(res) {
  if (!res.dataIssues.length) return 'No master-data issues found in the territories sheet.';
  return `<ul>${res.dataIssues.map(d => `<li><b>${esc(d.ref)}</b>: ${esc(d.text)}</li>`).join('')}</ul>`;
}

function help(short) {
  const ex = ['Why is APP-007 on hold?', 'APP-012 has now found a ground-floor space', 'Who is competing for 570001?', 'Which high-priority territories still have slots?', 'Compare APP-003 and APP-005', 'What is the onboarding plan for APP-002?', 'TER-02 now has 3 slots', 'APP-004 has withdrawn', 'undo'];
  return `${short ? 'Try' : 'Ask about any decision, or tell me something new and I\'ll re-run the allocation. Try'}: <div class="sugg">${ex.map(e => `<button class="sg" data-q="${esc(e)}">${esc(e)}</button>`).join('')}</div>`;
}

// ---------- before/after ----------
export function diff(prev, next, focusId) {
  const changes = [];
  for (const r of next.recs) {
    const p = prev.recs.find(x => x.app.id === r.app.id);
    if (!p) continue;
    if (p.outcome !== r.outcome || Math.abs(p.score - r.score) >= 0.1 || r.app.id === focusId)
      changes.push({ id: r.app.id, from: p.outcome, to: r.outcome, s0: p.score, s1: r.score, focus: r.app.id === focusId, headline: r.decision.headline });
  }
  return changes.sort((a, b) => (b.focus - a.focus) || a.id.localeCompare(b.id));
}

export function diffHtml(changes, said, target, whatIf) {
  const rows = changes.map(c => `<tr class="${c.focus ? 'focus' : ''}"><td>${appLink(c.id)}</td><td>${chip(c.from)}</td><td>→</td><td>${chip(c.to)}</td><td class="muted">${c.s0} → ${c.s1}</td></tr>`).join('');
  const ripple = changes.filter(c => !c.focus && c.from !== c.to);
  return `<div class="ans-head">${whatIf ? 'What-if applied' : 'Update applied'} to ${target}</div>
  <p>Understood: <b>${said.map(esc).join(', ')}</b>. Workbook values are kept; this is logged as an update on top. Nothing else was assumed.</p>
  <table class="cmp diff">${rows}</table>
  ${ripple.length ? `<p><b>Knock-on effect:</b> ${ripple.length} other application(s) changed because the allocation was re-run for everyone.</p>` : '<p class="muted">No other application changed.</p>'}
  ${changes.find(c => c.focus) ? `<p>${esc(changes.find(c => c.focus).headline)}</p>` : ''}
  <p class="muted">Type <b>undo</b> to revert.</p>`;
}
