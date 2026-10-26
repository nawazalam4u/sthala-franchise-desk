// Property-based stress test: hundreds of generated workbooks through the real parser + engine.
import { evaluate, OUTCOMES, normaliseApplication, normaliseTerritory } from '../js/engine.js';
import { parseWorkbook } from '../js/workbook.js';
import { generate, toWorkbook } from '../js/scenarios.js';
import { interpret } from '../js/copilot.js';
import { buildPlan } from '../js/plan.js';

const fails = []; let runs = 0, apps = 0;
const fail = (seed, mess, msg) => { if (fails.length < 25) fails.push(`seed ${seed} mess ${mess}: ${msg}`); };
const sig = res => res.recs.map(r => `${r.app.id}|${r.app.row}:${r.outcome}`).sort().join(',');
const outcomesById = res => Object.fromEntries(res.recs.map(r => [r.app.id + '@' + r.app.pin + '@' + r.app.name, r.outcome]));

for (let seed = 1; seed <= 300; seed++) for (const mess of [0, 1, 2]) {
  runs++;
  const sc = generate(seed, { apps: 10 + (seed % 50), territories: 3 + (seed % 9), mess });
  let wb;
  try { wb = parseWorkbook(XLSX, new Uint8Array(XLSX.write(toWorkbook(XLSX, sc), { type: 'array', bookType: 'xlsx' }))); }
  catch (e) { fail(seed, mess, 'parse crash ' + e.message); continue; }
  if (wb.applications.length !== sc.applications.length) fail(seed, mess, `row count ${wb.applications.length} != ${sc.applications.length} (sample row handling)`);
  let res;
  try { res = evaluate(wb); } catch (e) { fail(seed, mess, 'engine crash ' + e.stack); continue; }
  apps += res.recs.length;
  if (!res.invariants.ok) fail(seed, mess, 'invariant ' + res.invariants.errors.join(';'));
  const storePins = new Set(res.stores.map(s => s.pin));
  for (const r of res.recs) {
    if (!OUTCOMES[r.outcome]) fail(seed, mess, `${r.app.id} no outcome`);
    if (!r.decision.headline || (!r.decision.next.length && r.outcome !== 'WITHDRAWN')) fail(seed, mess, `${r.app.id} missing explanation`);
    if (r.outcome.startsWith('SHORTLIST')) {
      if (storePins.has(r.app.pin)) fail(seed, mess, `${r.app.id} shortlisted on store pin`);
      if (r.issues.some(i => i.sev === 'block')) fail(seed, mess, `${r.app.id} shortlisted with blocker ${r.issues.find(i => i.sev === 'block').code}`);
      if (!r.territory || res.territories.filter(t => t.pins.includes(r.app.pin)).length !== 1) fail(seed, mess, `${r.app.id} shortlisted without unique territory`);
      if (r.gates.partner !== 'ok' || !['ok', 'conditional'].includes(r.gates.site)) fail(seed, mess, `${r.app.id} shortlisted with gates ${JSON.stringify(r.gates)}`);
    }
    if (r.outcome === 'WAITLIST' && r.waitReason === 'NO_SLOT' && res.territoryState[r.territory.id].remaining > 0) fail(seed, mess, `${r.app.id} waitlisted while ${r.territory.id} has a free slot`);
    if (r.outcome === 'PREQUALIFIED' && r.app.space !== 'Not yet identified') fail(seed, mess, `${r.app.id} prequalified with space ${r.app.space}`);
    try { const p = buildPlan(r); if (p && !p.tasks.length) fail(seed, mess, 'empty plan'); } catch (e) { fail(seed, mess, 'plan crash ' + e.message); }
  }
  // determinism + row-order independence (skip hostile files with duplicate IDs)
  const res2 = evaluate(wb);
  if (sig(res) !== sig(res2)) fail(seed, mess, 'non-deterministic');
  if (mess < 2) {
    const shuffled = { ...wb, applications: wb.applications.slice().reverse() };
    const a = outcomesById(res), b = outcomesById(evaluate(shuffled));
    for (const k in a) if (a[k] !== b[k]) { fail(seed, mess, `row order changed ${k}: ${a[k]} vs ${b[k]}`); break; }
  }
  // notes (incl. prompt-injection text) must never change an outcome
  const noNotes = evaluate({ ...wb, applications: wb.applications.map(x => ({ ...x, notes: '', business: '' })) });
  { const a = outcomesById(res), b = outcomesById(noNotes); for (const k in a) if (a[k] !== b[k]) { fail(seed, mess, `notes changed outcome ${k}`); break; } }
  // random update keeps invariants
  const norm = res.recs.map(r => r.app);
  const target = norm[seed % norm.length];
  const patched = norm.map(x => x === target ? { ...x, space: 'Rented', size: 500, floor: 'Ground', investment: 45, investmentRaw: '45' } : x);
  const res3 = evaluate({ applications: patched, territories: res.territories, stores: res.stores });
  if (!res3.invariants.ok) fail(seed, mess, 'invariant after update');
  // copilot answers "why" for a random applicant from real data
  const q = interpret(`Why is ${target.id} ${'in this status'}?`, res);
  if (target.id && !target.idMissing && !(q.html || '').includes(target.id)) fail(seed, mess, `why-answer missing ${target.id}`);
}
print(`${runs} workbooks, ${apps} applications evaluated`);
print(fails.length ? `FAILURES (${fails.length}):\n` + fails.join('\n') : 'ALL PROPERTIES HOLD');
