# Franchise Radar — franchise expansion engine for Karnataka (Ops Hackathon · Case 1)

**Live:** https://franchise-radar.vercel.app (also https://sthala-franchise-desk.vercel.app) · add `/?demo` to load the case demo.

Upload the Applications + Territories workbook. Every applicant gets a decision, the evidence behind it, what would change it,
a store slot or a better pin code, and a week-by-week onboarding plan — explained in Kannada, Hindi or English.

## How it decides
1. **Read as-is** — sheets and header rows found by what the columns mean (works with other brands' headers: "App ID", "Pincode", "Budget (₹)"…); grey example row skipped; "570 001", "₹25,00,000", "1.2 crore", "Jan 2027", "PIN-560043" all understood and shown as evidence.
2. **Three gates** — location (exact pin → one territory, existing-store pin, city/pin mismatch, pin in two territories), partner (investment, experience, funding proof), site (owned/rented/none, size, floor, contradictions).
3. **Allocation — hard rules in code** — one store per pin, never on an existing store's pin, never over a territory's slots; best per pin, then best per territory; quality bar; close calls flagged; invariants re-checked after every change.
4. **People** — manager sign-off (decline promotes the next partner), partner fix-it link (Neon), copilot (rules first, Gemini for open questions, every AI number/ID/status fact-checked by code), onboarding plans, WhatsApp messages in 3 languages.

## Tests
- `tests/run.mjs` — 62 unit/scenario tests incl. 5 attack workbooks in `data/devil/`
- `tests/fuzz.mjs` — 900 generated hostile workbooks / 31,050 applications: rules, determinism, row-order independence, notes can't change outcomes
- Run on macOS without Node: `/System/Library/Frameworks/JavaScriptCore.framework/Versions/Current/Helpers/jsc tests/prelude.js -m tests/run.mjs`
- In the app: Data check → "Run logic checks".

## Stack
Static HTML/JS (SheetJS, Leaflet, OpenStreetMap/Esri tiles) · Vercel functions: `api/ai.js` (Google Gemini, `GEMINI_API_KEY`), `api/clarify.js` (Neon Postgres, `DATABASE_URL`). No secrets in the repo; everything still works with neither configured.
