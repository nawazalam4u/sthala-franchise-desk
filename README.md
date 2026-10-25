# Sthala — Franchise Expansion Desk (Ops Hackathon, Case 1)

Upload the judges' workbook (Applications + Territories + fixed Existing stores) and get, for every applicant:
a decision, the evidence behind it, what would change it, a personalised onboarding plan, and a message in the partner's language.

## How it decides
1. **Read as-is** — sheets and header rows found by column names; the grey template example row is skipped; pins like `570001.0` cleaned.
2. **Three gates** — Location (exact pin → territory, existing-store pin, city/pin mismatch, ambiguous territory map), Partner (investment, experience, funding proof), Site (owned/rented/not identified, size, floor, contradictions).
3. **Allocation (hard rules in code)** — one store per pin, never on an existing store's pin, never over a territory's open slots; best per pin, then best per territory; the rest waitlisted in backfill order; below the quality bar the slot stays open.
4. **Outcomes** — Shortlisted · Shortlisted (conditional, 14 days) · Pre-qualified (no site yet) · Waitlisted · Relocate (with free pins) · On hold (specific questions) · Outside expansion map.
5. **Copilot** — answers "why", "who competes for 570001", "slots left", "compare", and applies new facts ("APP-012 has now found a ground-floor space") as an audited overlay, re-running the whole allocation and showing the knock-on effects. `undo` reverts.

All weights, budgets and thresholds are assumptions on the Assumptions tab and re-run decisions live.

## Run / test
- Static site: serve the folder (`python3 -m http.server`) and open `/?demo`.
- Engine tests (macOS, no Node): `/System/Library/Frameworks/JavaScriptCore.framework/Versions/Current/Helpers/jsc tests/prelude.js -m tests/run.mjs`
- Optional AI answers for open questions: deploy on Vercel and set `ANTHROPIC_API_KEY`. Without it everything still works deterministically.

Map: Leaflet + Esri light basemap; pin centroids from OpenStreetMap Nominatim (`data/pins.json`, approximate).
