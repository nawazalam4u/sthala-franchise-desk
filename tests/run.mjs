// Run: jsc -m tests/run.mjs   (macOS JavaScriptCore; no Node needed). Also runs in-browser via tests.html.
import { evaluate, normPin, checkInvariants, normaliseApplication } from '../js/engine.js';
import { parseWorkbook } from '../js/workbook.js';
import { interpret, diff } from '../js/copilot.js';
import { buildPlan } from '../js/plan.js';

const out = []; let pass = 0, fail = 0;
const ok = (cond, name, extra = '') => { cond ? pass++ : fail++; out.push(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond ? '' : '  ' + extra}`); };
const T = (id, city, pins, slots, priority = 'High', tier) => ({ id, city, state: 'Karnataka', pins, tier: tier || 'Tier 2', slots, priority });
const A = (id, city, pin, o = {}) => ({ id, name: id, city, state: 'Karnataka', pin, investment: 30, experience: 4, business: 'shop', space: 'Rented', size: 500, floor: 'Ground', launch: 3, language: 'Kannada', notes: '', ...o });
const run = (apps, terrs, cfg) => evaluate({ applications: apps, territories: terrs, stores: [] }, cfg);
const out1 = (res, id) => res.recs.find(r => r.app.id === id).outcome;

// normalisation
ok(normPin(570001.0).pin === '570001', 'float pin normalised');
ok(normPin('57000').pin === null, 'short pin rejected');
ok(normaliseApplication({ investment: '25 lakhs', experience: '4 yrs' }).investment === 25, 'investment text parsed');

// territory matching
let r = run([A('A1', 'Mysuru', 570001)], [T('T1', 'Mysuru', '570001, 570002', 1)]);
ok(out1(r, 'A1') === 'SHORTLIST', 'exact pin match → shortlist');
r = run([A('A1', 'Mysuru', 570005)], [T('T1', 'Mysuru', '570001', 1)]);
ok(out1(r, 'A1') === 'OUT_OF_PLAN', 'no territory match → out of plan');
r = run([A('A1', 'Mysuru', 570001)], [T('T1', 'Mysuru', '570001', 1), T('T2', 'Mysuru', '570001', 1)]);
ok(out1(r, 'A1') === 'HOLD', 'pin in two territories → hold');
r = run([A('A1', 'Mysuru', 575001)], [T('T1', 'Mangaluru', '575001', 1)]);
ok(out1(r, 'A1') === 'HOLD', 'city/pin mismatch → hold');
// existing store
r = run([A('A1', 'Mysuru', 570009)], [T('T1', 'Mysuru', '570009, 570001', 1)]);
ok(out1(r, 'A1') === 'RELOCATE', 'existing-store pin → relocate');
ok(r.recs[0].alternatives.some(x => x.pin === '570001'), 'relocate suggests free pin');
// same pin
r = run([A('A1', 'Mysuru', 570001, { investment: 40 }), A('A2', 'Mysuru', 570001)], [T('T1', 'Mysuru', '570001, 570002', 2)]);
ok(out1(r, 'A1') === 'SHORTLIST' && out1(r, 'A2') === 'RELOCATE', 'same pin → one winner, other relocated');
// capacity
r = run([A('A1', 'Mysuru', 570001, { investment: 40 }), A('A2', 'Mysuru', 570002), A('A3', 'Mysuru', 570008, { investment: 20 })], [T('T1', 'Mysuru', '570001, 570002, 570008', 2)]);
ok(r.recs.filter(x => x.outcome.startsWith('SHORTLIST')).length === 2 && out1(r, 'A3') === 'WAITLIST', 'more candidates than slots → waitlist');
r = run([A('A1', 'Mysuru', 570001)], [T('T1', 'Mysuru', '570001', 0)]);
ok(out1(r, 'A1') === 'WAITLIST' && r.recs[0].waitReason === 'ZERO_SLOTS', 'zero slots → nobody selected');
// gaps
const terr = [T('T1', 'Mysuru', '570001', 1)];
ok(out1(run([A('A1', 'Mysuru', 570001, { investment: '' })], terr), 'A1') === 'HOLD', 'missing investment → hold');
ok(out1(run([A('A1', 'Mysuru', 570001, { experience: '' })], terr), 'A1') === 'HOLD', 'missing experience → hold');
ok(out1(run([A('A1', 'Mysuru', 570001, { experience: 0 })], terr), 'A1') !== 'HOLD', 'zero experience is valid');
ok(out1(run([A('A1', 'Mysuru', 570001, { launch: '' })], terr), 'A1') === 'SHORTLIST', 'missing optional launch does not block');
ok(out1(run([A('A1', 'Mysuru', 570001, { space: 'Not yet identified', size: '', floor: 'Not known' })], terr), 'A1') === 'PREQUALIFIED', 'no site → pre-qualified, no slot');
ok(out1(run([A('A1', 'Mysuru', 570001, { size: '' })], terr), 'A1') === 'SHORTLIST_CONDITIONAL', 'blank size → conditional');
ok(out1(run([A('A1', 'Mysuru', 570001, { size: '', floor: 'Not known' })], terr), 'A1') === 'HOLD', 'blank size + unknown floor → hold');
const contra = run([A('A1', 'Mysuru', 570001, { space: 'Not yet identified', size: 400, floor: 'Ground' })], terr);
ok(contra.recs[0].issues.some(i => i.code === 'SPACE_CONTRADICTION'), 'contradictory space fields flagged');
ok(out1(run([A('A1', 'Mysuru', 570001, { investment: 5 })], terr), 'A1') === 'HOLD', 'funding far below budget → hold for proof');
ok(out1(run([A('A1', 'Mysuru', 570001, { investment: 15, experience: 0, floor: 'Upper', size: 200, launch: 12 })], terr), 'A1') === 'WAITLIST', 'weak fit below bar → slot kept open');

// invariants
const bad = checkInvariants([{ outcome: 'SHORTLIST', app: { pin: '1' }, territory: { id: 'T' } }, { outcome: 'SHORTLIST', app: { pin: '1' }, territory: { id: 'T' } }], [{ id: 'T', slots: 1 }], []);
ok(!bad.ok && bad.errors.length === 2, 'invariant checker catches duplicate pin + over-capacity');

// demo workbook end to end
const bytes = readFile('data/demo.xlsx', 'binary');
const wb = parseWorkbook(XLSX, bytes);
ok(wb.applications.length === 24 && wb.territories.length === 9, `demo parsed (${wb.applications.length} apps, ${wb.territories.length} terrs)`);
ok(wb.report.samplesExcluded.length === 2, 'template example rows excluded');
const res = evaluate(wb);
ok(res.invariants.ok, 'demo invariants hold', res.invariants.errors.join('; '));
const o = id => out1(res, id);
const expect = { 'APP-003': 'RELOCATE', 'APP-007': 'HOLD', 'APP-010': 'RELOCATE', 'APP-012': 'PREQUALIFIED', 'APP-015': 'WAITLIST', 'APP-016': 'HOLD', 'APP-017': 'HOLD', 'APP-018': 'SHORTLIST_CONDITIONAL', 'APP-019': 'OUT_OF_PLAN', 'APP-024': 'HOLD', 'APP-021': 'WAITLIST' };
for (const [id, want] of Object.entries(expect)) ok(o(id) === want, `${id} → ${want}`, `got ${o(id)}`);

// copilot
const why = interpret('Why is APP-007 on hold?', res);
ok(why.kind === 'answer' && /Investment capacity is missing/.test(why.html), 'why-question cites the real reason');
const up = interpret('APP-012 has now found a ground-floor space', res);
ok(up.kind === 'update' && up.patch.floor === 'Ground' && up.patch.space === 'Identified' && !('size' in up.patch), 'update parsed without inventing size');
const apps2 = res.recs.map(x => x.app.id === 'APP-012' ? { ...x.app, ...up.patch } : x.app);
const res2 = evaluate({ applications: apps2, territories: res.territories, stores: res.stores });
const d = diff(res, res2, 'APP-012');
ok(out1(res2, 'APP-012') === 'SHORTLIST_CONDITIONAL', 'APP-012 moves to conditional shortlist', out1(res2, 'APP-012'));
ok(d.some(c => c.id === 'APP-013' && c.from !== c.to), 'knock-on: APP-013 displaced from TER-05 slot');
ok(res2.invariants.ok, 'invariants hold after update');
const wd = interpret('APP-004 has withdrawn', res);
ok(wd.kind === 'update' && wd.patch.withdrawn, 'withdrawal parsed');
const inv = interpret('APP-007 can now invest 40 lakh', res);
ok(inv.patch?.investment === 40, 'investment update parsed');
ok(interpret('TER-06 now has 2 slots', res).patch?.slots === 2, 'territory slot update parsed');
ok(/TER-05/.test(interpret('Which high-priority territories still have slots?', res).html), 'priority question answered');
ok(/APP-007|APP-023/.test(interpret('Who is competing for 570002?', res).html), 'pin competition answered');
const plan = buildPlan(res.recs.find(x => x.app.id === 'APP-001') || res.recs[0]);
ok(!plan || plan.tasks.length > 8, 'onboarding plan built');

// trap workbook: renamed sheets, messy text, duplicates, ties
const tw = parseWorkbook(XLSX, readFile('data/tricky.xlsx', 'binary'));
const tr = evaluate(tw);
const to = id => tr.recs.find(r => r.app.id === id)?.outcome;
ok(tw.applications.length === 13 && tw.territories.length === 4, 'trap workbook parsed despite renamed/reordered sheets');
ok(tr.invariants.ok, 'trap workbook invariants hold');
ok(tr.recs.find(r => r.app.id === 'APP-102').app.investment === 120, '"1.2 crore" read as 120 lakh');
ok(tr.recs.find(r => r.app.id === 'APP-101').app.pin === '570001', '"570 001" read as a pin');
ok(to('APP-104') === 'HOLD' && to('APP-109') === 'HOLD', 'implausible experience / 5-digit pin held');
ok(tr.recs.filter(r => r.app.id === 'APP-105').every(r => r.issues.some(i => i.code === 'DUP_ID')), 'duplicate IDs flagged on both rows');
ok(tr.recs.some(r => r.app.id.startsWith('ROW-') && r.outcome === 'HOLD'), 'row without ID held, not dropped');
ok(to('APP-107') === 'WAITLIST', 'zero-slot territory selects nobody');
ok(tr.dataIssues.some(d => /more than one territory/.test(d.text)), 'pin listed in two territories reported');
// devil's-advocate workbooks
const d1 = evaluate(parseWorkbook(XLSX, readFile('data/devil/devil1_other_industry.xlsx', 'binary')));
ok(d1.recs.length === 5 && d1.recs.find(r => r.app.id === 'PH-1').app.investment === 25 && d1.recs.find(r => r.app.id === 'PH-1').app.pin === '560043', 'other-industry headers, ₹ in rupees and "PIN-560043" read');
ok(d1.recs.find(r => r.app.id === 'PH-3').app.investment === 100 && d1.recs.find(r => r.app.id === 'PH-3').app.launch < 12, '"1 Cr" and "Jan 2027" read correctly');
const d2 = evaluate(parseWorkbook(XLSX, readFile('data/devil/devil2_one_pin_40_ties.xlsx', 'binary')));
ok(d2.recs.filter(r => r.outcome.startsWith('SHORTLIST')).length === 1 && d2.invariants.ok, '40 tied applicants on one pin → exactly one store');
const d4 = evaluate(parseWorkbook(XLSX, readFile('data/devil/devil4_hostile_territories.xlsx', 'binary')));
ok(d4.invariants.ok && d4.dataIssues.some(d => /used twice/.test(d.text)) && d4.dataIssues.some(d => /no pin codes/.test(d.text)), 'hostile territory sheet reported, rules hold');
const d5 = evaluate(parseWorkbook(XLSX, readFile('data/devil/devil5_unicode_xss.xlsx', 'binary')));
ok(d5.recs.find(r => r.app.id === 'APP-003').flags.length + d5.recs.find(r => r.app.id === 'APP-003').notes.signals.filter(x => x.key === 'injection').length > 0, 'prompt-injection note flagged');
print(out.join('\n'));
print(`\n${pass} passed, ${fail} failed`);
for (const x of res.recs) print(`${x.app.id.padEnd(8)} ${x.outcome.padEnd(22)} ${String(x.score).padStart(5)}  ${x.decision.headline}`);
