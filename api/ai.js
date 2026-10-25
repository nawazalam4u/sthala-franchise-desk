// Free AI layer (Google Gemini). Two jobs: answer open questions from the session's records, and turn
// messy plain-language updates into a structured patch. The browser engine validates every patch
// and enforces the hard rules — the model never makes the decision.
const MODEL = process.env.GEMINI_MODEL || 'gemini-3.5-flash-lite';

const ANSWER = `You are the expansion copilot for a retail brand's franchise team in Karnataka, India.
Answer ONLY from the JSON decision records, territories and assumptions provided. If something is not in them, say what is missing.
Never invent numbers, policies, revenue, payback or distances. Hard rules (one store per pin, never on an existing store's pin, never more stores than a territory's open slots) are enforced by code; you explain, you never override.
Plain text, under 120 words, cite application IDs like APP-007.`;

const PARSE = `Convert a franchise expansion team's message into a JSON update. Output ONLY JSON, no prose:
{"target":"APP-xxx or TER-xx or null","fields":{...},"understood":"short English summary","ambiguous":"question to ask, or null"}
Allowed application fields: investment (number in ₹ LAKH exactly as stated — "32 lakh" => 32, "1.5 crore" => 150; never convert lakh to thousands), experience (years), space ("Owned"|"Rented"|"Identified"|"Not yet identified"), size (sq ft), floor ("Ground"|"Upper"|"Mall unit"|"Not known"), pin (6-digit string), city, launch (months), language ("Kannada"|"English"|"Hindi"), withdrawn (true/false).
Allowed territory fields: slots (integer), priority ("High"|"Medium"|"Low").
Include ONLY facts explicitly stated. Never guess size, tenure or pin. "found a shop" without owned/rented => space "Identified".`;

async function gemini(input) {
  const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 25000);
  try {
    const r = await fetch('https://generativelanguage.googleapis.com/v1beta/interactions', {
      method: 'POST', signal: ctl.signal,
      headers: { 'content-type': 'application/json', 'x-goog-api-key': process.env.GEMINI_API_KEY },
      body: JSON.stringify({ model: MODEL, input }),
    });
    if (!r.ok) return null;
    const d = await r.json();
    const out = (d.steps || []).filter(s => s.type === 'model_output').flatMap(s => s.content || []).map(c => c.text || '').join('\n').trim();
    return out || null;
  } catch { return null; } finally { clearTimeout(t); }
}

export default async function handler(req, res) {
  if (req.method === 'GET') return res.status(200).json({ ready: !!process.env.GEMINI_API_KEY, model: MODEL });
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  if (!process.env.GEMINI_API_KEY) return res.status(503).json({ error: 'AI not configured' });
  const { mode, question, records, territories, config, ids } = req.body || {};
  if (!question || String(question).length > 1500) return res.status(400).json({ error: 'Bad question' });
  if (mode === 'parse') {
    const out = await gemini(`${PARSE}\n\nKnown IDs: ${(ids || []).slice(0, 400).join(', ')}\n\nMessage: ${question}`);
    if (!out) return res.status(502).json({ error: 'AI unavailable' });
    const m = out.match(/\{[\s\S]*\}/);
    try { return res.status(200).json({ parsed: JSON.parse(m[0]) }); } catch { return res.status(200).json({ parsed: null }); }
  }
  const ctx = JSON.stringify({ records, territories, assumptions: config }).slice(0, 150000);
  const out = await gemini(`${ANSWER}\n\nSession data:\n${ctx}\n\nQuestion: ${question}`);
  if (!out) return res.status(502).json({ error: 'AI unavailable' });
  return res.status(200).json({ answer: out });
}
