// Partner self-service: the desk creates a clarification link; the partner answers on their phone in their
// language; the desk pulls the answer back and the engine re-decides. Storage: Neon Postgres (DATABASE_URL).
import { neon } from '@neondatabase/serverless';

let ready = false;
async function db() {
  const sql = neon(process.env.DATABASE_URL);
  if (!ready) {
    await sql`CREATE TABLE IF NOT EXISTS clarifications (
      id text PRIMARY KEY, created_at timestamptz DEFAULT now(), app_id text, app_name text, lang text,
      asks jsonb, context jsonb, status text DEFAULT 'sent', answer jsonb, answered_at timestamptz)`;
    ready = true;
  }
  return sql;
}
const newId = () => Array.from(crypto.getRandomValues(new Uint8Array(12)), b => b.toString(36).padStart(2, '0')).join('').slice(0, 16);
const clean = (v, n = 300) => (v === null || v === undefined) ? null : String(v).slice(0, n);

export default async function handler(req, res) {
  if (!process.env.DATABASE_URL) return res.status(503).json({ error: 'Portal not configured' });
  try {
    const sql = await db();
    if (req.method === 'POST') {
      const { app, asks, context } = req.body || {};
      if (!app?.id || !Array.isArray(asks)) return res.status(400).json({ error: 'Bad request' });
      const id = newId();
      await sql`INSERT INTO clarifications (id, app_id, app_name, lang, asks, context)
        VALUES (${id}, ${clean(app.id, 40)}, ${clean(app.name, 120)}, ${clean(app.language || 'English', 20)}, ${JSON.stringify(asks.slice(0, 10))}, ${JSON.stringify(context || {})})`;
      return res.status(200).json({ id });
    }
    const id = clean(req.query.id || req.body?.id, 40);
    if (!id && req.method === 'GET') return res.status(200).json({ ready: true });
    if (!id) return res.status(400).json({ error: 'Missing id' });
    if (req.method === 'GET') {
      const rows = await sql`SELECT id, app_id, app_name, lang, asks, context, status, answer, answered_at FROM clarifications WHERE id = ${id}`;
      return rows[0] ? res.status(200).json(rows[0]) : res.status(404).json({ error: 'Not found' });
    }
    if (req.method === 'PUT') {
      const a = req.body?.answer || {};
      const answer = {};
      for (const k of ['investment', 'experience', 'size', 'launch']) if (a[k] !== undefined && a[k] !== '' && Number.isFinite(+a[k]) && +a[k] >= 0) answer[k] = +a[k];
      for (const k of ['space', 'floor', 'language', 'city']) if (a[k]) answer[k] = clean(a[k], 40);
      if (a.pin && /^\d{6}$/.test(String(a.pin))) answer.pin = String(a.pin);
      if (a.note) answer.note = clean(a.note, 500);
      await sql`UPDATE clarifications SET answer = ${JSON.stringify(answer)}, status = 'answered', answered_at = now() WHERE id = ${id}`;
      return res.status(200).json({ ok: true });
    }
    return res.status(405).json({ error: 'Method not allowed' });
  } catch (e) {
    return res.status(500).json({ error: 'Storage error' });
  }
}
