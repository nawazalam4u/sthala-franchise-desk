// Sthala decision engine — pure functions, no DOM. Same input + same config => same output.
// Hard rules from the brief are enforced here in code; everything else is a labelled, editable assumption.

export const CITIES = {
  'Bengaluru': { prefix: '560', tier: 'Tier 1' },
  'Mysuru': { prefix: '570', tier: 'Tier 2' },
  'Mangaluru': { prefix: '575', tier: 'Tier 2' },
  'Hubballi-Dharwad': { prefix: '580', tier: 'Tier 2' },
  'Belagavi': { prefix: '590', tier: 'Tier 2' },
  'Tumakuru': { prefix: '572', tier: 'Tier 3' },
  'Davanagere': { prefix: '577', tier: 'Tier 3' },
};
const CITY_ALIASES = {
  bengaluru: 'Bengaluru', bangalore: 'Bengaluru', blr: 'Bengaluru',
  mysuru: 'Mysuru', mysore: 'Mysuru',
  mangaluru: 'Mangaluru', mangalore: 'Mangaluru',
  'hubballi-dharwad': 'Hubballi-Dharwad', hubballi: 'Hubballi-Dharwad', hubli: 'Hubballi-Dharwad', dharwad: 'Hubballi-Dharwad', 'hubli-dharwad': 'Hubballi-Dharwad',
  belagavi: 'Belagavi', belgaum: 'Belagavi',
  tumakuru: 'Tumakuru', tumkur: 'Tumakuru',
  davanagere: 'Davanagere', davangere: 'Davanagere',
};

export const FIXED_STORES = [
  ['ST-01', 'Bengaluru', '560001', 2019], ['ST-02', 'Bengaluru', '560034', 2020], ['ST-03', 'Bengaluru', '560038', 2021],
  ['ST-04', 'Bengaluru', '560066', 2022], ['ST-05', 'Bengaluru', '560076', 2023], ['ST-06', 'Mysuru', '570009', 2021],
  ['ST-07', 'Mysuru', '570017', 2024], ['ST-08', 'Mangaluru', '575001', 2022], ['ST-09', 'Hubballi-Dharwad', '580020', 2023],
  ['ST-10', 'Belagavi', '590001', 2024],
].map(([id, city, pin, year]) => ({ id, city, pin, year }));

// Every number here is an assumption, shown and editable in the Assumptions screen.
export const DEFAULT_CONFIG = {
  weights: { capital: 35, experience: 30, site: 20, launch: 15 },
  budgetByTier: { 'Tier 1': 40, 'Tier 2': 30, 'Tier 3': 25 }, // ₹ lakh, indicative all-in setup cost
  fundingHoldRatio: 0.5, // stated capital below this share of the indicative budget => funding proof before a slot
  minSqft: 250,
  idealSqft: [400, 1200],
  qualityBar: 40, // composite below this => no slot even if one is free (a bad franchisee costs more than an empty slot)
  leadMonths: { siteReady: 3, noSite: 5 },
  overlapKm: 1.5,
  conditionalDays: 14,
  hardMinInvestment: null, // brand policy; off by default because the brief gives none
};

export const OUTCOMES = {
  SHORTLIST: { label: 'Provisionally shortlisted', tone: 'go', rank: 1 },
  SHORTLIST_CONDITIONAL: { label: 'Shortlisted — conditional', tone: 'go', rank: 2 },
  PREQUALIFIED: { label: 'Pre-qualified — find a site', tone: 'info', rank: 3 },
  WAITLIST: { label: 'Waitlisted', tone: 'wait', rank: 4 },
  RELOCATE: { label: 'Relocate — pin unavailable', tone: 'warn', rank: 5 },
  HOLD: { label: 'On hold — info needed', tone: 'hold', rank: 6 },
  OUT_OF_PLAN: { label: 'Outside expansion map', tone: 'muted', rank: 7 },
  NOT_PROCEEDING: { label: 'Not proceeding', tone: 'stop', rank: 8 },
  WITHDRAWN: { label: 'Withdrawn', tone: 'muted', rank: 9 },
};

// ---------- normalisation ----------
const s = v => (v === null || v === undefined ? '' : String(v)).trim();
const low = v => s(v).toLowerCase();

export function normPin(v) {
  if (v === null || v === undefined || v === '') return { pin: null, raw: '' };
  let t = typeof v === 'number' ? String(Math.round(v)) : s(v).replace(/\.0+$/, '').replace(/[\s-]/g, '');
  return { pin: /^\d{6}$/.test(t) ? t : null, raw: s(v) };
}

export function normNum(v) {
  if (v === null || v === undefined || s(v) === '') return { value: null, raw: '' };
  if (typeof v === 'number') return { value: Number.isFinite(v) ? v : NaN, raw: String(v) };
  let t = low(v).replace(/[₹,]/g, '').replace(/\brs\.?/g, '').trim();
  const m = t.match(/-?\d+(\.\d+)?/);
  if (!m) {
    const w = t.match(/\b(zero|nil|none|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|fifteen|twenty)\b/);
    if (!w) return { value: NaN, raw: s(v) };
    const n = { zero: 0, nil: 0, none: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, fifteen: 15, twenty: 20 }[w[1]];
    return { value: /crore/.test(t) ? n * 100 : n, raw: s(v) };
  }
  let n = parseFloat(m[0]);
  if (/crore|cr\b/.test(t)) n *= 100;
  return { value: n, raw: s(v) };
}

export function normCity(v) {
  const k = low(v).replace(/\s+/g, ' ');
  if (!k) return null;
  if (CITY_ALIASES[k]) return CITY_ALIASES[k];
  for (const [a, c] of Object.entries(CITY_ALIASES)) if (k.includes(a)) return c;
  return null;
}

export function normSpace(v) {
  const k = low(v);
  if (!k) return null;
  if (/not|no |none|yet|search|looking|^no$/.test(k)) return 'Not yet identified';
  if (/own/.test(k)) return 'Owned';
  if (/rent|lease/.test(k)) return 'Rented';
  if (/identified|found/.test(k)) return 'Identified';
  return 'Unrecognised';
}

export function normFloor(v) {
  const k = low(v);
  if (!k) return null;
  if (/not known|unknown|n\/a|^na$|tbd|not sure/.test(k)) return 'Not known';
  if (/mall/.test(k)) return 'Mall unit';
  if (/ground|^g$|gf|street/.test(k)) return 'Ground';
  if (/upper|first|1st|second|2nd|third|basement|floor/.test(k)) return 'Upper';
  return 'Not known';
}

export function normLang(v) {
  const k = low(v);
  if (!k) return null;
  if (/kannada|ಕನ್ನಡ/.test(k)) return 'Kannada';
  if (/hindi|हिं/.test(k)) return 'Hindi';
  if (/english/.test(k)) return 'English';
  return null;
}

const SAMPLE_APP = { id: 'APP-001', name: 'ravi kumar', pin: '570001', notes: 'wants to open before diwali' };
const SAMPLE_TER = { id: 'TER-01', pins: '570001,570002,570008', slots: 3 };

export function isSampleApp(r) {
  return s(r.id).toUpperCase() === SAMPLE_APP.id && low(r.name) === SAMPLE_APP.name &&
    normPin(r.pin).pin === SAMPLE_APP.pin && low(r.notes) === SAMPLE_APP.notes;
}
export function isSampleTerritory(r) {
  return s(r.id).toUpperCase() === SAMPLE_TER.id && s(r.pins).replace(/\s/g, '') === SAMPLE_TER.pins &&
    normNum(r.slots).value === SAMPLE_TER.slots && low(r.city) === 'mysuru';
}

export function normaliseApplication(r) {
  const pin = normPin(r.pin), inv = normNum(r.investment), exp = normNum(r.experience),
    size = normNum(r.size), launch = normNum(r.launch);
  return {
    id: s(r.id).toUpperCase() || `ROW-${r.row ?? '?'}`, idMissing: !s(r.id), name: s(r.name), row: r.row,
    cityRaw: s(r.city), city: normCity(r.city), stateRaw: s(r.state),
    pin: pin.pin, pinRaw: pin.raw,
    investment: inv.value, investmentRaw: inv.raw,
    experience: exp.value, experienceRaw: exp.raw,
    business: s(r.business), spaceRaw: s(r.space), space: normSpace(r.space),
    size: size.value, sizeRaw: size.raw, floorRaw: s(r.floor), floor: normFloor(r.floor),
    launch: launch.value, launchRaw: launch.raw, langRaw: s(r.language), language: normLang(r.language),
    notes: s(r.notes), withdrawn: !!r.withdrawn,
  };
}

export function normaliseTerritory(r) {
  const slots = normNum(r.slots);
  const parts = s(r.pins).split(/[,;\n/|]+|\s{1,}/).map(x => x.trim()).filter(Boolean);
  const pins = [], badPins = [];
  for (const p of parts) { const n = normPin(p).pin; n ? (pins.includes(n) || pins.push(n)) : badPins.push(p); }
  const pr = low(r.priority);
  return {
    id: s(r.id).toUpperCase(), row: r.row, cityRaw: s(r.city), city: normCity(r.city), state: s(r.state),
    pins, badPins, tierRaw: s(r.tier), tier: /1/.test(r.tier) ? 'Tier 1' : /2/.test(r.tier) ? 'Tier 2' : /3/.test(r.tier) ? 'Tier 3' : null,
    slots: Number.isFinite(slots.value) ? Math.max(0, Math.floor(slots.value)) : null, slotsRaw: slots.raw,
    priority: pr.startsWith('h') ? 'High' : pr.startsWith('m') ? 'Medium' : pr.startsWith('l') ? 'Low' : null,
  };
}

// ---------- geography (optional) ----------
export function haversineKm(a, b) {
  const R = 6371, rad = x => x * Math.PI / 180;
  const dLat = rad(b.lat - a.lat), dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

// ---------- notes reading (applicant-stated, never treated as fact) ----------
const NOTE_SIGNALS = [
  { re: /loan|bank|financ|emi|borrow|mudra/i, key: 'funding_dependency', text: 'Funding may depend on a loan — ask for a sanction letter.' },
  { re: /partner|brother|sister|father|mother|wife|husband|family|cousin|friend|co-?invest/i, key: 'co_investor', text: 'Mentions another person — confirm who signs and who runs the store day to day.' },
  { re: /(negotiat|finali[sz]|talking to|looking (for|at)|will find|searching|shortlist(ed)?|token).{0,40}\b(shop|space|site|premises|place|unit)s?\b|\b(shop|space|site)\b.{0,25}(negotiat|not final|tentative)/i, key: 'space_not_secured', text: 'Space may not be secured yet — confirm lease/ownership status.' },
  { re: /diwali|dasara|dussehra|ugadi|festival|navratri|christmas|ramzan|eid|sankranti/i, key: 'festive_timing', text: 'Wants to hit a festive season — check if the timeline is realistic.' },
  { re: /other brand|another brand|franchise of|already (a )?franchis|dealer of|distributor/i, key: 'other_franchise', text: 'Has another brand/franchise — check exclusivity and conflict of interest.' },
  { re: /part[- ]?time|full[- ]?time job|working (in|at)|employ(ed|ee)|salar|it job|software/i, key: 'owner_bandwidth', text: 'May not run the store full-time — confirm who will manage it daily.' },
  { re: /relocat|moving|shift(ing)? to|transfer/i, key: 'commitment', text: 'Talks about moving — confirm long-term commitment to this location.' },
  { re: /multiple|more than one|2 stores|two stores|second store|another store/i, key: 'multi_unit', text: 'Interested in more than one store — possible multi-unit partner.' },
  { re: /urgent|asap|immediately|quick/i, key: 'urgency', text: 'Wants to move fast — keen, but do not skip diligence.' },
  { re: /not sure|maybe|unsure|might|tentative|thinking/i, key: 'uncertain', text: 'Sounds tentative — confirm intent before investing team time.' },
  { re: /ground|upper|first floor|mall|sq ?ft|square/i, key: 'site_mentioned', text: 'Notes mention site details — cross-check against the structured fields.' },
];
const RELATED_RETAIL = /optic|eyewear|spectacle|footwear|shoe|apparel|garment|cloth|fashion|textile|saree|mobile|electronic|retail|store|shop|showroom|boutique|watch|jewel|cosmetic|pharma|supermarket|kirana|franchise/i;

export function readNotes(app) {
  const text = `${app.business} ${app.notes}`.trim();
  const signals = NOTE_SIGNALS.filter(x => x.re.test(app.notes) || (x.key !== 'site_mentioned' && x.re.test(app.business)))
    .map(x => ({ key: x.key, text: x.text }));
  return { signals, relatedRetail: RELATED_RETAIL.test(app.business), hasText: !!text };
}

// ---------- scoring (relative shortlist aid, not a profitability forecast) ----------
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));

export function factorScores(app, tier, cfg, siteKnown) {
  const budget = cfg.budgetByTier[tier] ?? cfg.budgetByTier['Tier 2'];
  const ratio = Number.isFinite(app.investment) ? app.investment / budget : null;
  const capital = ratio === null ? null : Math.round(clamp(ratio, 0, 1.25) / 1.25 * 100);
  const experience = Number.isFinite(app.experience) ? Math.round(100 * (1 - Math.exp(-Math.max(0, app.experience) / 3))) : null;

  let site = null, siteParts = null;
  if (siteKnown) {
    const floor = { 'Ground': 100, 'Mall unit': 85, 'Upper': 40 }[app.floor] ?? 50;
    let size = 50;
    if (Number.isFinite(app.size) && app.size > 0) {
      const [lo, hi] = cfg.idealSqft;
      size = app.size < cfg.minSqft ? 20 : app.size < lo ? Math.round(60 + 40 * (app.size - cfg.minSqft) / Math.max(1, lo - cfg.minSqft))
        : app.size <= hi ? 100 : 90;
    }
    const tenure = app.space === 'Owned' ? 100 : app.space === 'Rented' ? 80 : 60;
    site = Math.round(0.5 * floor + 0.3 * size + 0.2 * tenure);
    siteParts = { floor, size, tenure };
  }

  const lead = siteKnown ? cfg.leadMonths.siteReady : cfg.leadMonths.noSite;
  let launch = 50;
  if (Number.isFinite(app.launch) && app.launch >= 0) {
    if (app.launch < lead) launch = 60;
    else launch = Math.round(clamp(100 - 10 * Math.max(0, app.launch - lead - 1), 30, 100));
  }
  return { capital, experience, site, launch, ratio, budget, lead, siteParts };
}

export function composite(f, cfg) {
  const w = cfg.weights, parts = [['capital', f.capital], ['experience', f.experience], ['site', f.site ?? 50], ['launch', f.launch]];
  let tot = 0, wsum = 0;
  for (const [k, v] of parts) { if (v === null || v === undefined) continue; tot += w[k] * v; wsum += w[k]; }
  return wsum ? Math.round(tot / wsum * 10) / 10 : 0;
}

// ---------- main evaluation ----------
export function evaluate(input, cfgIn = {}, geo = {}) {
  const cfg = { ...DEFAULT_CONFIG, ...cfgIn, weights: { ...DEFAULT_CONFIG.weights, ...(cfgIn.weights || {}) },
    budgetByTier: { ...DEFAULT_CONFIG.budgetByTier, ...(cfgIn.budgetByTier || {}) },
    leadMonths: { ...DEFAULT_CONFIG.leadMonths, ...(cfgIn.leadMonths || {}) } };
  const apps = input.applications.map(a => a.id !== undefined && a.investment !== undefined && 'investmentRaw' in a ? a : normaliseApplication(a));
  const terrs = input.territories.map(t => 'badPins' in t ? t : normaliseTerritory(t));
  const stores = (input.stores && input.stores.length ? input.stores : FIXED_STORES).map(x => ({ ...x, pin: normPin(x.pin).pin, city: normCity(x.city) || x.city }));
  const dataIssues = [];

  // master-data checks
  const storeByPin = new Map(stores.map(x => [x.pin, x]));
  const pinToTerr = new Map();
  const seenTid = new Set();
  for (const t of terrs) {
    if (!t.id) dataIssues.push({ sev: 'high', scope: 'territory', ref: `row ${t.row}`, text: 'Territory row has no Territory ID.' });
    if (seenTid.has(t.id)) dataIssues.push({ sev: 'high', scope: 'territory', ref: t.id, text: `Duplicate Territory ID ${t.id}.` });
    seenTid.add(t.id);
    if (t.badPins.length) dataIssues.push({ sev: 'medium', scope: 'territory', ref: t.id, text: `Malformed pin code(s) ignored: ${t.badPins.join(', ')}.` });
    if (t.slots === null) dataIssues.push({ sev: 'high', scope: 'territory', ref: t.id, text: `Open slots "${t.slotsRaw}" is not a number — treated as 0 until fixed.` });
    if (!t.priority) dataIssues.push({ sev: 'low', scope: 'territory', ref: t.id, text: 'Priority missing/unrecognised — treated as Low.' });
    const exp = t.city && CITIES[t.city];
    if (exp && t.tier && exp.tier !== t.tier) dataIssues.push({ sev: 'low', scope: 'territory', ref: t.id, text: `Tier ${t.tier} differs from the standard ${exp.tier} for ${t.city}.` });
    for (const p of t.pins) {
      if (exp && !p.startsWith(exp.prefix)) dataIssues.push({ sev: 'medium', scope: 'territory', ref: t.id, text: `Pin ${p} does not start with ${exp.prefix}, the prefix for ${t.city}.` });
      if (!pinToTerr.has(p)) pinToTerr.set(p, []);
      pinToTerr.get(p).push(t);
      if (storeByPin.has(p)) dataIssues.push({ sev: 'info', scope: 'territory', ref: t.id, text: `Pin ${p} already has existing store ${storeByPin.get(p).id} — no new store can open there.` });
    }
  }
  for (const [p, ts] of pinToTerr) if (ts.length > 1)
    dataIssues.push({ sev: 'high', scope: 'territory', ref: ts.map(t => t.id).join(' & '), text: `Pin ${p} is listed in more than one territory — applications there are held until the brand fixes the territory map.` });

  const idCount = {};
  const baseId = a => a.idOriginal || a.id;
  apps.forEach(a => { if (!a.idMissing) idCount[baseId(a)] = (idCount[baseId(a)] || 0) + 1; });
  const nameKey = a => `${low(a.name)}|${a.pin}`;
  const nameCount = {};
  apps.forEach(a => { if (a.name) nameCount[nameKey(a)] = (nameCount[nameKey(a)] || 0) + 1; });

  // per-application gates
  const recs = apps.map((a, idx) => {
    const r = { app: a, idx, issues: [], facts: [], flags: [], notes: readNotes(a), gates: {}, territory: null, store: null };
    const add = (gate, sev, code, text, ask) => r.issues.push({ gate, sev, code, text, ask });
    if (a.withdrawn) { r.outcome = 'WITHDRAWN'; r.gates = { location: 'n/a', partner: 'n/a', site: 'n/a' }; return r; }
    if (a.idMissing) add('data', 'block', 'NO_ID', `Row ${a.row} has no Application ID (shown here as ${a.id}).`, 'Assign an Application ID.');
    if (!a.idMissing && idCount[baseId(a)] > 1) add('data', 'block', 'DUP_ID', `Application ID ${baseId(a)} appears ${idCount[baseId(a)]} times (this is row ${a.row}).`, 'Confirm which row is current; remove the duplicate.');
    if (a.name && a.pin && nameCount[nameKey(a)] > 1) r.flags.push({ code: 'POSSIBLE_DUPLICATE', text: `Another application has the same name and pin (${a.name}, ${a.pin}) — possible duplicate submission.` });

    // Location gate
    let loc = 'ok';
    if (!a.pin) { loc = 'hold'; add('location', 'block', a.pinRaw ? 'BAD_PIN' : 'NO_PIN', a.pinRaw ? `Pin code "${a.pinRaw}" is not a valid 6-digit pin.` : 'Pin code is missing.', 'Ask for the exact 6-digit pin code of the proposed shop.'); }
    if (!a.city) { if (a.cityRaw) add('location', 'warn', 'CITY_UNKNOWN', `City "${a.cityRaw}" is not one of the 7 expansion cities.`, 'Confirm the city.'); }
    if (a.pin && a.city && !a.pin.startsWith(CITIES[a.city].prefix)) {
      loc = 'hold'; add('location', 'block', 'CITY_PIN_MISMATCH', `City is ${a.city} (pins start ${CITIES[a.city].prefix}) but pin ${a.pin} belongs elsewhere.`, `Ask which is correct: the city (${a.city}) or the pin (${a.pin}).`);
    }
    if (a.stateRaw && !/karnataka/i.test(a.stateRaw)) add('location', 'warn', 'STATE', `State "${a.stateRaw}" — all expansion cities are in Karnataka.`, 'Confirm the state.');
    const city = a.city || (a.pin && Object.keys(CITIES).find(c => a.pin.startsWith(CITIES[c].prefix))) || null;
    r.city = city;
    if (a.pin) {
      const st = storeByPin.get(a.pin);
      if (st) { r.store = st; if (loc === 'ok') loc = 'blocked'; add('location', 'block', 'EXISTING_STORE_PIN', `Pin ${a.pin} already has our store ${st.id} (opened ${st.year}). The brand never opens two stores in one pin code.`, 'Ask the partner for an alternative site in a different pin code.'); }
      const ts = pinToTerr.get(a.pin) || [];
      if (ts.length === 1) {
        r.territory = ts[0];
        if (a.city && ts[0].city && ts[0].city !== a.city) { loc = 'hold'; add('location', 'block', 'TERRITORY_CITY_MISMATCH', `Pin ${a.pin} sits in ${ts[0].id} (${ts[0].city}) but the application says ${a.city}.`, 'Confirm the city and pin code.'); }
      } else if (ts.length > 1) {
        loc = 'hold'; add('location', 'block', 'PIN_IN_MULTIPLE_TERRITORIES', `Pin ${a.pin} is listed in ${ts.map(t => t.id).join(' and ')} — territory is ambiguous.`, 'Expansion team to fix the territory map (internal, not the applicant).');
      } else if (loc === 'ok') {
        loc = 'outside'; add('location', 'block', 'NO_TERRITORY', `Pin ${a.pin} is not in any territory the brand is currently opening in.`, 'Offer a site in an open territory, or keep on file for future expansion.');
      }
    }
    r.gates.location = loc;

    // Partner gate
    let partner = 'ok';
    if (a.investment === null) { partner = 'hold'; add('partner', 'block', 'NO_INVESTMENT', 'Investment capacity is missing — it is a required field.', 'Ask how much (₹ lakh) the partner can invest, with proof of funds.'); }
    else if (!Number.isFinite(a.investment) || a.investment < 0) { partner = 'hold'; add('partner', 'block', 'BAD_INVESTMENT', `Investment capacity "${a.investmentRaw}" is not a usable number.`, 'Ask for the amount in ₹ lakh.'); }
    else if (a.investment === 0) { partner = 'hold'; add('partner', 'block', 'ZERO_INVESTMENT', 'Investment capacity is 0 — the partner cannot fund a store as stated.', 'Confirm the amount; ask about financing or co-investors.'); }
    if (a.experience === null) { partner = 'hold'; add('partner', 'block', 'NO_EXPERIENCE', 'Retail experience is missing (should be 0 if none).', 'Ask for years spent running or managing a shop (0 is fine).'); }
    else if (!Number.isFinite(a.experience) || a.experience < 0) { partner = 'hold'; add('partner', 'block', 'BAD_EXPERIENCE', `Retail experience "${a.experienceRaw}" is not a usable number.`, 'Ask for years of retail experience.'); }
    else if (a.experience > 50) { partner = 'hold'; add('partner', 'block', 'IMPLAUSIBLE_EXPERIENCE', `Retail experience of ${a.experience} years looks like a typo.`, 'Confirm years of experience.'); }
    const tier = r.territory?.tier || (city && CITIES[city].tier) || 'Tier 2';
    r.tier = tier;
    if (partner === 'ok' && cfg.hardMinInvestment && a.investment < cfg.hardMinInvestment) {
      partner = 'fail'; add('partner', 'block', 'BELOW_POLICY_MIN', `₹${a.investment} lakh is below the brand's minimum of ₹${cfg.hardMinInvestment} lakh (brand policy set in Assumptions).`, 'Decline politely or ask about a co-investor.');
    } else if (partner === 'ok') {
      const ratio = a.investment / (cfg.budgetByTier[tier] ?? 30);
      if (ratio < cfg.fundingHoldRatio) { partner = 'review'; add('partner', 'block', 'FUNDING_GAP', `₹${a.investment} lakh covers only ${Math.round(ratio * 100)}% of the indicative ₹${cfg.budgetByTier[tier]} lakh setup budget for a ${tier} store (assumption).`, 'Ask for a loan sanction letter or co-investor details before a slot is held.'); }
    }
    r.gates.partner = partner;

    // Site gate
    let site;
    const sizeKnown = Number.isFinite(a.size) && a.size > 0;
    const floorKnown = a.floor && a.floor !== 'Not known';
    if (!a.space || a.space === 'Unrecognised') {
      site = 'hold'; add('site', 'block', 'NO_SPACE_STATUS', a.spaceRaw ? `Space available "${a.spaceRaw}" is not Owned / Rented / Not yet identified.` : 'Space available is blank.', 'Ask whether the partner owns, rents, or has not yet found a space.');
    } else if (a.space === 'Not yet identified') {
      site = 'none';
      add('site', 'block', 'NO_SITE', 'No shop space identified yet, so there is no site to approve or allocate a slot to.', 'Partner can start due diligence now; share the free pin codes in this territory to search in.');
      if (sizeKnown || floorKnown) add('site', 'warn', 'SPACE_CONTRADICTION', `Says "Not yet identified" but also gives ${sizeKnown ? a.size + ' sq ft' : ''}${sizeKnown && floorKnown ? ', ' : ''}${floorKnown ? a.floor + ' floor' : ''}.`, 'Ask: is there a specific shop under consideration?');
    } else {
      if (!sizeKnown && !floorKnown) { site = 'hold'; add('site', 'block', 'SITE_DETAILS_MISSING', `Has a space (${a.space}) but both size and floor are unknown — nothing to assess.`, 'Ask for the shop size (sq ft) and floor.'); }
      else if (!sizeKnown || !floorKnown) {
        site = 'conditional';
        if (!sizeKnown) add('site', 'cond', a.sizeRaw ? 'BAD_SIZE' : 'NO_SIZE', a.sizeRaw ? `Space size "${a.sizeRaw}" is not a usable number.` : 'Space size is blank although a space is available.', 'Confirm carpet area (sq ft) at the site visit.');
        if (!floorKnown) add('site', 'cond', 'FLOOR_UNKNOWN', 'Floor is "Not known".', 'Confirm the floor (ground floor strongly preferred for walk-ins).');
      } else site = 'ok';
      if (a.space === 'Identified') add('site', 'cond', 'TENURE_UNKNOWN', 'Space found, but owned vs rented is not yet confirmed.', 'Collect title deed or lease draft.');
      if (sizeKnown && a.size < cfg.minSqft) r.flags.push({ code: 'SMALL_SITE', text: `${a.size} sq ft is below the ${cfg.minSqft} sq ft working minimum (assumption) — check the store format fits.` });
      if (a.floor === 'Upper') r.flags.push({ code: 'UPPER_FLOOR', text: 'Upper-floor shops get less walk-in traffic — needs a signage and access plan.' });
    }
    if (site === 'ok' && a.space === 'Identified') site = 'conditional';
    r.gates.site = site;

    // Launch / language (non-blocking: optional fields)
    if (a.launch === null) add('launch', 'warn', 'NO_LAUNCH', 'Target launch is blank — scored neutral.', 'Ask when the partner wants to open.');
    else if (!Number.isFinite(a.launch) || a.launch < 0) add('launch', 'warn', 'BAD_LAUNCH', `Target launch "${a.launchRaw}" is not a usable number — scored neutral.`, 'Ask for target launch in months.');
    if (!a.language) add('onboarding', 'warn', a.langRaw ? 'LANG_UNKNOWN' : 'NO_LANGUAGE', a.langRaw ? `Language "${a.langRaw}" not offered — training defaults to English.` : 'Preferred language blank — training defaults to English.', 'Confirm training language (Kannada / English / Hindi).');

    const siteKnown = site === 'ok' || site === 'conditional';
    r.factors = factorScores(a, tier, cfg, siteKnown);
    r.score = composite(r.factors, cfg);
    if (Number.isFinite(a.launch) && a.launch < r.factors.lead) r.flags.push({ code: 'AGGRESSIVE_TIMELINE', text: `Wants to open in ${a.launch} month(s); a realistic minimum is ~${r.factors.lead} months ${siteKnown ? 'with a site in hand' : 'when the site still has to be found'} (assumption).` });

    // geography
    const g = a.pin && geo[a.pin];
    if (g) {
      let best = null;
      for (const st of stores) { const sg = geo[st.pin]; if (!sg || st.pin === a.pin) continue; const d = haversineKm(g, sg); if (!best || d < best.km) best = { store: st, km: Math.round(d * 10) / 10 }; }
      r.nearestStore = best;
      if (best && best.km < cfg.overlapKm) r.flags.push({ code: 'CATCHMENT_OVERLAP', text: `~${best.km} km from existing store ${best.store.id} (${best.store.pin}) — catchments likely overlap; cannibalisation review before LOI.` });
    } else if (city) {
      const same = stores.filter(st => st.city === city && st.pin !== a.pin);
      if (same.length) r.flags.push({ code: 'CATCHMENT_UNKNOWN', text: `${same.length} existing store(s) in ${city}; exact distance not available — manual catchment check.` });
    }
    return r;
  });

  // ---------- allocation ----------
  const tie = (x, y) => (y.score - x.score) || ((y.app.investment || 0) - (x.app.investment || 0)) ||
    ((y.app.experience || 0) - (x.app.experience || 0)) || ((x.app.launch ?? 99) - (y.app.launch ?? 99)) || x.app.id.localeCompare(y.app.id);
  const blocking = r => r.issues.filter(i => i.sev === 'block');
  const eligible = r => !r.outcome && blocking(r).length === 0 && r.gates.location === 'ok' && r.gates.partner === 'ok' && (r.gates.site === 'ok' || r.gates.site === 'conditional');

  const territoryState = {};
  for (const t of terrs) territoryState[t.id] = { territory: t, shortlisted: [], waitlist: [], prequalified: [], held: [], relocate: [], slots: t.slots ?? 0 };

  // pin contests (among allocation-eligible applicants)
  const byPin = new Map();
  for (const r of recs) if (eligible(r)) { if (!byPin.has(r.app.pin)) byPin.set(r.app.pin, []); byPin.get(r.app.pin).push(r); }
  const pinWinners = [];
  for (const [pin, group] of byPin) {
    group.sort(tie);
    pinWinners.push(group[0]);
    for (const loser of group.slice(1)) {
      loser.outcome = 'RELOCATE';
      loser.lostPinTo = group[0].app.id;
      loser.issues.push({ gate: 'allocation', sev: 'block', code: 'LOST_PIN_CONTEST', text: `${group.length} decision-ready applicants want pin ${pin}; only one store per pin. ${group[0].app.id} scored higher (${group[0].score} vs ${loser.score}).`, ask: 'Offer this partner a different pin in the same territory.' });
    }
  }

  // slots per territory
  for (const t of terrs) {
    const st = territoryState[t.id];
    const cands = pinWinners.filter(r => r.territory?.id === t.id).sort(tie);
    let used = 0;
    cands.forEach((r, i) => {
      r.territoryRank = i + 1; r.territoryField = cands.length;
      if (r.score < cfg.qualityBar) {
        r.outcome = 'WAITLIST'; r.waitReason = 'BAR';
        r.issues.push({ gate: 'allocation', sev: 'block', code: 'BELOW_BAR', text: `Score ${r.score} is below the quality bar of ${cfg.qualityBar} (assumption) — we keep the slot open rather than fill it with a weak fit.`, ask: 'Revisit if capital, experience or site improves.' });
      } else if (used < (t.slots ?? 0)) {
        used++;
        r.outcome = r.gates.site === 'conditional' ? 'SHORTLIST_CONDITIONAL' : 'SHORTLIST';
        st.shortlisted.push(r);
      } else {
        r.outcome = 'WAITLIST'; r.waitReason = (t.slots ?? 0) === 0 ? 'ZERO_SLOTS' : 'NO_SLOT';
        r.issues.push({ gate: 'allocation', sev: 'block', code: r.waitReason, text: (t.slots ?? 0) === 0 ? `${t.id} has 0 open slots — the brand is not opening here right now.` : `${t.id} has ${t.slots} slot(s); this application ranks #${i + 1} of ${cands.length}.`, ask: 'Keep warm; auto-promote if a shortlisted partner drops out.' });
      }
      if (r.outcome === 'WAITLIST') st.waitlist.push(r);
    });
    st.used = used;
    st.remaining = Math.max(0, (t.slots ?? 0) - used);
  }

  // non-eligible outcomes
  const claimedPins = new Set(recs.filter(r => r.outcome?.startsWith('SHORTLIST')).map(r => r.app.pin));
  for (const r of recs) {
    if (r.outcome) continue;
    const b = blocking(r);
    const codes = new Set(b.map(i => i.code));
    if (r.gates.partner === 'fail') r.outcome = 'NOT_PROCEEDING';
    else if (b.some(i => i.gate === 'data') || r.gates.location === 'hold') r.outcome = 'HOLD';
    else if (r.gates.location === 'blocked') r.outcome = 'RELOCATE';
    else if (r.gates.location === 'outside') r.outcome = 'OUT_OF_PLAN';
    else if (r.gates.partner !== 'ok') r.outcome = 'HOLD';
    else if (r.gates.site === 'hold') r.outcome = 'HOLD';
    else if (r.gates.site === 'none') r.outcome = 'PREQUALIFIED';
    else r.outcome = 'HOLD';
    r.primaryCode = [...codes][0];
    const st = r.territory && territoryState[r.territory.id];
    if (st) (r.outcome === 'PREQUALIFIED' ? st.prequalified : r.outcome === 'RELOCATE' ? st.relocate : st.held).push(r);
  }

  // hypothetical rank: where would this partner land if its blockers were cleared?
  for (const r of recs) {
    if (!r.territory || r.outcome?.startsWith('SHORTLIST') || r.outcome === 'WITHDRAWN') continue;
    const st = territoryState[r.territory.id];
    if (!st) continue;
    const field = st.shortlisted.concat(st.waitlist.filter(w => w.waitReason !== 'BAR'));
    const hypoScore = r.outcome === 'PREQUALIFIED' ? composite({ ...r.factors, site: 70 }, cfg) : r.score;
    const better = field.filter(x => x !== r && x.score > hypoScore).length;
    r.hypothetical = { score: hypoScore, rank: better + 1, slots: r.territory.slots ?? 0, wouldGetSlot: better < (r.territory.slots ?? 0) && hypoScore >= cfg.qualityBar };
  }

  // relocation suggestions: free pins in same city, open territories first
  const allClaimed = new Set([...claimedPins, ...recs.filter(r => ['SHORTLIST_CONDITIONAL', 'WAITLIST'].includes(r.outcome)).map(r => r.app.pin)]);
  const prRank = { High: 0, Medium: 1, Low: 2 };
  for (const r of recs) {
    if (!['RELOCATE', 'OUT_OF_PLAN', 'PREQUALIFIED'].includes(r.outcome)) continue;
    const city = r.city;
    const opts = [];
    for (const t of terrs) {
      const open = r.outcome === 'PREQUALIFIED' && r.hypothetical?.wouldGetSlot ? (t.slots ?? 0) > 0 : (territoryState[t.id]?.remaining ?? 0) > 0;
      if (t.city !== city || !open) continue;
      for (const p of t.pins) {
        if (storeByPin.has(p) || allClaimed.has(p) || p === r.app.pin || (pinToTerr.get(p) || []).length > 1) continue;
        const km = geo[p] && geo[r.app.pin] ? Math.round(haversineKm(geo[p], geo[r.app.pin]) * 10) / 10 : null;
        let nearKm = null;
        if (geo[p]) for (const s2 of stores) if (geo[s2.pin]) { const d = haversineKm(geo[p], geo[s2.pin]); if (nearKm === null || d < nearKm) nearKm = Math.round(d * 10) / 10; }
        opts.push({ pin: p, territory: t.id, priority: t.priority, remaining: territoryState[t.id].remaining, km, nearestStoreKm: nearKm, area: geo[p]?.area || '' });
      }
    }
    opts.sort((x, y) => (prRank[x.priority] ?? 3) - (prRank[y.priority] ?? 3) || ((x.km ?? 999) - (y.km ?? 999)) || x.pin.localeCompare(y.pin));
    r.alternatives = opts.slice(0, 4);
  }

  // competitors
  for (const r of recs) {
    if (!r.app.pin) { r.competitors = { samePin: [], sameTerritory: [] }; continue; }
    r.competitors = {
      samePin: recs.filter(x => x !== r && x.app.pin === r.app.pin && x.outcome !== 'WITHDRAWN').map(x => x.app.id),
      sameTerritory: r.territory ? recs.filter(x => x !== r && x.territory?.id === r.territory.id && x.outcome !== 'WITHDRAWN').map(x => x.app.id) : [],
    };
  }

  // new-vs-new overlap among shortlisted
  if (Object.keys(geo).length) {
    const sl = recs.filter(r => r.outcome?.startsWith('SHORTLIST') && geo[r.app.pin]);
    for (let i = 0; i < sl.length; i++) for (let j = i + 1; j < sl.length; j++) {
      const d = haversineKm(geo[sl[i].app.pin], geo[sl[j].app.pin]);
      if (d < cfg.overlapKm) for (const [a, b] of [[sl[i], sl[j]], [sl[j], sl[i]]])
        a.flags.push({ code: 'NEW_STORE_OVERLAP', text: `~${Math.round(d * 10) / 10} km from fellow shortlisted ${b.app.id} (${b.app.pin}) — sequence openings or review catchments.` });
    }
  }

  for (const r of recs) { r.decision = explain(r, cfg); }

  const invariants = checkInvariants(recs, terrs, stores);
  return { recs, territories: terrs, stores, territoryState, dataIssues, invariants, config: cfg };
}

export function checkInvariants(recs, terrs, stores) {
  const errors = [];
  const sel = recs.filter(r => r.outcome?.startsWith('SHORTLIST'));
  const pins = new Set();
  const storePins = new Set(stores.map(s => s.pin));
  for (const r of sel) {
    if (pins.has(r.app.pin)) errors.push(`Two shortlisted applications share pin ${r.app.pin}.`);
    pins.add(r.app.pin);
    if (storePins.has(r.app.pin)) errors.push(`${r.app.id} shortlisted on existing-store pin ${r.app.pin}.`);
  }
  for (const t of terrs) {
    const n = sel.filter(r => r.territory?.id === t.id).length;
    if (n > (t.slots ?? 0)) errors.push(`${t.id} has ${n} shortlisted but only ${t.slots} slots.`);
  }
  return { ok: errors.length === 0, errors, checks: ['One store per pin among new stores', 'No new store on an existing-store pin', 'No territory over its open slots'] };
}

// ---------- explanation ----------
export function explain(r, cfg) {
  const a = r.app, t = r.territory, o = r.outcome;
  const lines = [];
  const tag = (kind, text) => lines.push({ kind, text });
  const block = r.issues.filter(i => i.sev === 'block');
  const cond = r.issues.filter(i => i.sev === 'cond');
  let headline = '', next = [];

  switch (o) {
    case 'SHORTLIST':
      headline = `Provisionally shortlisted for ${t.id} (${t.city}) — ranked #${r.territoryRank} of ${r.territoryField} for ${t.slots} slot(s).`;
      next = ['Start partner due diligence (KYC, proof of funds)', 'Site visit and catchment check', 'Issue Letter of Intent after both pass']; break;
    case 'SHORTLIST_CONDITIONAL':
      headline = `Shortlisted for ${t.id} on condition: ${cond.map(c => c.ask.replace(/\.$/, '')).join('; ')} within ${cfg.conditionalDays} days, or the slot passes to the next waitlisted partner.`;
      next = cond.map(c => c.ask).concat(['Then proceed to due diligence and LOI']); break;
    case 'WAITLIST':
      headline = r.waitReason === 'BAR' ? `Waitlisted — score ${r.score} is below the ${cfg.qualityBar} quality bar.`
        : r.waitReason === 'ZERO_SLOTS' ? `Waitlisted — ${t.id} has no open slots right now.`
          : `Waitlisted — #${r.territoryRank} of ${r.territoryField} in ${t.id}, which has ${t.slots} slot(s).`;
      next = r.waitReason === 'BAR' ? ['Share feedback on what would strengthen the application', 'Re-score if capital/experience/site improve']
        : ['Keep warm with a monthly update', 'Auto-promote if a shortlisted partner drops out or more slots open']; break;
    case 'PREQUALIFIED':
      headline = `Partner looks ${r.hypothetical?.wouldGetSlot && r.hypothetical.score >= 70 ? 'strong' : 'viable'} but has no shop yet — start due diligence; no slot is held until a site is approved.`;
      next = ['Start partner due diligence now (runs in parallel with site search)', r.alternatives?.length ? `Search in free pins: ${r.alternatives.map(x => x.pin).join(', ')}` : 'Search for a site inside an open territory', 'Submit pin, size, floor and lease/ownership for approval']; break;
    case 'RELOCATE':
      headline = r.lostPinTo ? `Lost pin ${a.pin} to ${r.lostPinTo} (one store per pin) — partner is still viable at another pin.`
        : `Pin ${a.pin} already has store ${r.store?.id} — the partner can proceed only with a different site.`;
      next = [r.alternatives?.length ? `Offer free pins: ${r.alternatives.map(x => `${x.pin} (${x.territory})`).join(', ')}` : 'No free pins in open territories of this city — waitlist for future expansion', 'Re-run once a new site is submitted', ...block.filter(i => i.gate !== 'location' && i.gate !== 'allocation').map(i => i.ask)]; break;
    case 'OUT_OF_PLAN':
      headline = `Pin ${a.pin} is outside every territory the brand is opening in now.`;
      next = [r.alternatives?.length ? `Offer pins in open territories: ${r.alternatives.map(x => `${x.pin} (${x.territory})`).join(', ')}` : 'Keep on file for when the brand opens this area', 'Share demand signal with the expansion team']; break;
    case 'HOLD':
      headline = `On hold — ${block.length} thing(s) to clarify before a fair decision.`;
      next = [...new Set(block.map(i => i.ask))]; break;
    case 'NOT_PROCEEDING':
      headline = 'Not proceeding under the brand policy set in Assumptions.'; next = block.map(i => i.ask); break;
    case 'WITHDRAWN':
      headline = 'Withdrawn by update — slot released and allocation re-run.'; next = ['Close the file']; break;
  }

  // evidence
  tag('fact', `${a.city || a.cityRaw || '—'} · pin ${a.pin || a.pinRaw || '—'} · ₹${fmt(a.investment)} lakh · ${fmt(a.experience)} yrs retail · space ${a.space || '—'}${a.size ? `, ${a.size} sq ft` : ''}${a.floor ? `, ${a.floor}` : ''} · launch ${fmt(a.launch)} mo`);
  if (t) tag('derived', `Pin ${a.pin} → ${t.id} (${t.city}, ${t.tier}, ${t.priority} priority, ${t.slots} open slot(s)).`);
  if (r.store) tag('fact', `Existing store ${r.store.id} at pin ${r.store.pin} (opened ${r.store.year}).`);
  for (const i of block) tag(i.gate === 'allocation' ? 'derived' : i.code === 'FUNDING_GAP' || i.code === 'BELOW_BAR' ? 'assumption' : 'gap', i.text);
  for (const i of cond) tag('gap', i.text);
  for (const i of r.issues.filter(i => i.sev === 'warn')) tag('gap', i.text);
  for (const f of r.flags) tag(f.code === 'CATCHMENT_OVERLAP' || f.code === 'NEW_STORE_OVERLAP' ? 'derived' : 'assumption', f.text);
  for (const sgn of r.notes.signals) tag('claim', sgn.text);

  const change = [];
  if (o === 'WAITLIST' && r.waitReason !== 'BAR') change.push('A shortlisted partner in this territory drops out, or the brand adds slots.');
  if (o === 'WAITLIST' && r.waitReason === 'BAR') change.push(`Score rises above ${cfg.qualityBar} (more capital, experience, or a ground-floor site).`);
  if (o === 'PREQUALIFIED' && r.hypothetical) change.push(`A valid site is submitted — with a typical site this partner would rank ~#${r.hypothetical.rank} for ${r.hypothetical.slots} slot(s)${r.hypothetical.wouldGetSlot ? ' and would likely get one' : ''}.`);
  if (o === 'HOLD' || o === 'RELOCATE') for (const i of block) change.push(i.ask);
  if (o === 'HOLD' && r.hypothetical && r.gates.location === 'ok') change.push(`If cleared at current values, would rank ~#${r.hypothetical.rank} in ${t.id}${r.hypothetical.wouldGetSlot ? ' — within the slots' : ''}.`);
  if (o?.startsWith('SHORTLIST')) change.push('Due diligence fails, site is rejected at the visit, or a higher-scoring partner clears their hold in the same territory.');

  return { headline, next, evidence: lines, change: [...new Set(change)] };
}

const fmt = v => (v === null || v === undefined || Number.isNaN(v)) ? '—' : String(Math.round(v * 10) / 10);

// ---------- updates (overlay; workbook values are never overwritten) ----------
export function applyPatch(app, patch) {
  const next = { ...app };
  for (const [k, v] of Object.entries(patch)) next[k] = v;
  return next;
}
