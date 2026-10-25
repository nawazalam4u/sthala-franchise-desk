// Reads the judges' workbook as-is: finds sheets and header rows by their column names, not by position.
import { isSampleApp, isSampleTerritory } from './engine.js';

const APP_COLS = {
  id: /application\s*id|app(lication)?\s*(no|#|ref)/i, name: /applicant\s*name|^name$/i, city: /^city$|city\s*·|^city\b/i, state: /^state$/i,
  pin: /pin\s*code|pincode|^pin$/i, investment: /invest/i, experience: /experience/i, business: /business/i,
  space: /space\s*avail|^space$/i, size: /size|sq\s*ft/i, floor: /floor/i, launch: /launch/i, language: /language/i, notes: /notes?/i,
};
const TER_COLS = { id: /territory\s*id/i, city: /^city/i, state: /^state$/i, pins: /pin\s*codes?\s*covered|pin/i, tier: /tier/i, slots: /slot/i, priority: /priority/i };
const STORE_COLS = { id: /store\s*id/i, city: /city/i, pin: /pin/i, year: /open|year/i };

function findHeader(rows, mustHave) {
  for (let i = 0; i < Math.min(rows.length, 15); i++) {
    const cells = (rows[i] || []).map(c => String(c ?? '').trim());
    if (cells.some(c => mustHave.test(c))) return i;
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

function readTable(rows, spec, mustHave) {
  const h = findHeader(rows, mustHave);
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
    if (!apps) { const t = readTable(rows, APP_COLS, /application\s*id/i); if (t) { apps = t; report.found.applications = name; continue; } }
    if (!terrs) { const t = readTable(rows, TER_COLS, /territory\s*id/i); if (t) { terrs = t; report.found.territories = name; continue; } }
    if (!stores) { const t = readTable(rows, STORE_COLS, /store\s*id/i); if (t) { stores = t; report.found.stores = name; continue; } }
  }
  if (!apps) throw new Error('Could not find an Applications sheet (a header row containing "Application ID").');
  if (!terrs) throw new Error('Could not find a Territories sheet (a header row containing "Territory ID").');
  if (apps.missing.length) report.warnings.push(`Applications sheet is missing column(s): ${apps.missing.join(', ')}.`);
  if (terrs.missing.length) report.warnings.push(`Territories sheet is missing column(s): ${terrs.missing.join(', ')}.`);
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
