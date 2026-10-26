import { evaluate } from '../js/engine.js';
import { parseWorkbook } from '../js/workbook.js';
for (const f of ['devil1_other_industry', 'devil2_one_pin_40_ties', 'devil3_1500_rows', 'devil4_hostile_territories', 'devil5_unicode_xss']) {
  print(`\n===== ${f}`);
  let wb;
  try { wb = parseWorkbook(XLSX, readFile(`data/devil/${f}.xlsx`, 'binary')); } catch (e) { print('PARSE ERROR: ' + e.message); continue; }
  print(`apps ${wb.applications.length} terrs ${wb.territories.length} stores ${wb.stores.length} found ${JSON.stringify(wb.report.found)} warn ${JSON.stringify(wb.report.warnings)}`);
  const t0 = Date.now(); const res = evaluate(wb); const ms = Date.now() - t0;
  const c = {}; res.recs.forEach(r => c[r.outcome] = (c[r.outcome] || 0) + 1);
  print(`${ms} ms · invariants ${res.invariants.ok} · ${JSON.stringify(c)}`);
  res.dataIssues.slice(0, 8).forEach(d => print('  DATA ' + d.ref + ': ' + d.text));
  if (res.recs.length <= 12) res.recs.forEach(r => print(`  ${r.app.id} inv=${r.app.investment} exp=${r.app.experience} pin=${r.app.pin} floor=${r.app.floor} size=${r.app.size} launch=${r.app.launch} → ${r.outcome} | ${r.decision.headline.slice(0, 110)}`));
}
