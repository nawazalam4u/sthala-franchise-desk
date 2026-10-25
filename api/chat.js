// Optional AI layer for open-ended questions. Decisions and hard rules stay in the browser engine;
// this only explains the current session's records in plain language. Needs ANTHROPIC_API_KEY on Vercel.
import Anthropic from '@anthropic-ai/sdk';

const SYSTEM = `You are the expansion copilot for a retail brand's franchise team in Karnataka.
Answer ONLY from the JSON decision records and territories you are given. If the answer is not in them, say what is missing.
Never invent numbers, policies, revenue, payback or distances. Hard rules (one store per pin, never on an existing store's pin, never over a territory's open slots) are enforced by code; you explain them, you never change decisions.
If the user is giving new facts about an applicant, tell them to phrase it like "APP-012 has found a 500 sq ft ground-floor rented shop" so the engine can apply it.
Be concise: under 120 words, plain text, cite application IDs.`;

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  if (!process.env.ANTHROPIC_API_KEY) return res.status(503).json({ error: 'AI not configured' });
  try {
    const { question, records, territories, config, history } = req.body || {};
    if (!question || String(question).length > 1000) return res.status(400).json({ error: 'Bad question' });
    const client = new Anthropic();
    const context = JSON.stringify({ records, territories, assumptions: config }).slice(0, 120000);
    const msgs = [];
    for (const h of (history || []).slice(-4)) msgs.push({ role: 'user', content: h.q }, { role: 'assistant', content: h.a });
    msgs.push({ role: 'user', content: `Current session data:\n${context}\n\nQuestion: ${question}` });
    const r = await client.beta.messages.create({
      model: 'claude-opus-5-5',
      max_tokens: 2000,
      system: SYSTEM,
      output_config: { effort: 'low' },
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      messages: msgs,
    });
    if (r.stop_reason === 'refusal') return res.status(200).json({ answer: null });
    const answer = r.content.filter(b => b.type === 'text').map(b => b.text).join('\n').trim();
    return res.status(200).json({ answer });
  } catch (e) {
    return res.status(502).json({ error: 'AI unavailable' });
  }
}
