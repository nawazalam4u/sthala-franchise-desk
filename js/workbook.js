// Reads the judges' workbook as-is: finds sheets and header rows by their column names, not by position.
import { isSampleApp, isSampleTerritory } from './engine.js';

// Column names vary across brands and industries, so each field accepts the common synonyms.
const APP_COLS = {
  id: /(application|app|applicant|lead|partner|enquiry|form)\s*\.?\s*(id|no\.?|#|number|ref|code)|^id$/i, name: /(applicant|full|partner|owner)?\s*name/i, city: /^city|city\s*·|^location$|^town/i, state: /^state$/i,
  pin: /pin\s*code|pincode|^pin$|postal|zip/i, investment: /invest|budget|capital|funds?\b|corpus/i, experience: /experience|years?\s*(in|of)\s*retail|retail\s*years/i, business: /business|background|occupation|profession/i,
  space: /space\s*avail|^space$|premises|property|shop\s*status/i, size: /size|sq\.?\s*ft|carpet|area/i, floor: /floor|level/i, launch: /launch|open(ing)?\s*in|timeline|start/i, language: /language|lang\b/i, notes: /notes?|remarks?|comments?/i,
};
const TER_COLS = { id: /(territory|zone|cluster|region|area)\s*(id|code|no\.?)/i, city: /^city|^location/i, state: /^state$/i, pins: /pin\s*codes?|pincodes|pins?\s*covered|postal/i, tier: /tier/i, slots: /slot|capacity|openings/i, priority: /priority/i };
const STORE_COLS = { id: /(store|outlet|shop)\s*(id|code)/i, city: /city/i, pin: /pin|postal/i, year: /open|year/i };
// a header row must match at least this many field patterns
const MIN_HITS = { app: 5, ter: 3, store: 3 };

function findHeader(rows, mustHave, spec, minHits) {
  for (let i = 0; i < Math.min(rows.length, 15); i++) {
    const cells = (rows[i] || []).map(c => String(c ?? '').trim()).filter(Boolean);
    if (!cells.some(c => mustHave.test(c))) continue;
    const hits = Object.values(spec).filter(re => cells.some(c => re.test(c))).length;
    if (hits >= minHits) return i;
  }
  return -1;
}

function mapColumns(header, spec) {
  const map = {}, used = new Set();
  for (const [key, re] of Object.entries(spec)) {
    const idx = header.findIndex((h, i) => !used.has(i) && re.test(String(h ?? '').trim()));
    if (idx >= 0) { map[key] = idx; used.add(idx); }
  }
  return map;
}

function readTable(rows, spec, mustHave, minHits) {
  const h = findHeader(rows, mustHave, spec, minHits);
  if (h < 0) return null;
  const header = rows[h];
  const map = mapColumns(header, spec);
  const out = [];
  for (let i = h + 1; i < rows.length; i++) {
    const row = rows[i] || [];
    if (!row.some(c => String(c ?? '').trim() !== '')) continue;
    const rec = { row: i + 1 };
    for (const [k, idx] of Object.entries(map)) rec[k] = row[idx] ?? '';
    // combined "City · State · Pin code" style column
    if (rec.city && /·/.test(String(rec.city)) && !map.pin) {
      const parts = String(rec.city).split('·').map(x => x.trim());
      rec.city = parts[0]; rec.state = parts[1] || rec.state; rec.pin = parts[2] || rec.pin;
    } else if (rec.city && /·/.test(String(rec.city))) {
      const parts = String(rec.city).split('·').map(x => x.trim());
      rec.city = parts[0]; rec.state = rec.state || parts[1];
    }
    out.push(rec);
  }
  return { headerRow: h + 1, columns: Object.keys(map), missing: Object.keys(spec).filter(k => !(k in map)), records: out };
}

export function parseWorkbook(XLSX, data, { includeSamples = false } = {}) {
  const wb = XLSX.read(data, { type: 'array' });
  const report = { sheets: wb.SheetNames, found: {}, warnings: [], samplesExcluded: [] };
  let apps = null, terrs = null, stores = null;
  for (const name of wb.SheetNames) {
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, raw: true, defval: '' });
    if (!apps) { const t = readTable(rows, APP_COLS, APP_COLS.id, MIN_HITS.app); if (t) { apps = t; report.found.applications = name; continue; } }
    if (!terrs) { const t = readTable(rows, TER_COLS, TER_COLS.id, MIN_HITS.ter); if (t) { terrs = t; report.found.territories = name; continue; } }
    if (!stores) { const t = readTable(rows, STORE_COLS, STORE_COLS.id, MIN_HITS.store); if (t) { stores = t; report.found.stores = name; continue; } }
  }
  if (!apps) throw new Error('Could not find an Applications sheet (a header row with an application ID, pin code, investment and similar columns).');
  if (!terrs) throw new Error('Could not find a Territories sheet (a header row with a territory ID, pin codes covered and open slots).');
  { const crit = apps.missing.filter(k => ['id', 'pin', 'investment', 'experience', 'space'].includes(k)); if (crit.length) report.warnings.push(`Applications sheet has no column for: ${crit.join(', ')} — those checks will hold applications.`); }
  { const crit = terrs.missing.filter(k => ['id', 'pins', 'slots'].includes(k)); if (crit.length) report.warnings.push(`Territories sheet has no column for: ${crit.join(', ')}.`); }
  if (!stores) report.warnings.push('No Existing stores sheet found — using the fixed list of 10 stores from the brief.');

  let a = apps.records, t = terrs.records;
  if (!includeSamples) {
    const sa = a.filter(isSampleApp), st = t.filter(isSampleTerritory);
    if (sa.length) report.samplesExcluded.push(...sa.map(x => `Applications row ${x.row} (template example ${x.id})`));
    if (st.length) report.samplesExcluded.push(...st.map(x => `Territories row ${x.row} (template example ${x.id})`));
    a = a.filter(x => !isSampleApp(x)); t = t.filter(x => !isSampleTerritory(x));
  }
  const s = stores ? stores.records.filter(x => String(x.id ?? '').trim()) : [];
  return { applications: a, territories: t, stores: s, report };
}
