// api/leaderboard.js — Vercel Serverless Function (CommonJS)
// Env vars: UPSTASH_REDIS_REST_URL, UPSTASH_REDIS_REST_TOKEN, ADMIN_SECRET

const REDIS_URL    = process.env.UPSTASH_REDIS_REST_URL;
const REDIS_TOKEN  = process.env.UPSTASH_REDIS_REST_TOKEN;
const ADMIN_SECRET = process.env.ADMIN_SECRET || 'changeme';

const BANLIST = [
  'admin','fuck','merde','putain','connard','salope','bite','fdp',
  'pute','enculé','encule','nazi','hitler','nigger','nword',
];

function norm(s) {
  return s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
}
function isBanned(name) {
  const n = norm(name);
  return BANLIST.some(b => n.includes(norm(b)));
}

// Upstash REST API — simple GET/SET via fetch
async function kv(method, ...parts) {
  const url = `${REDIS_URL}/${parts.map(encodeURIComponent).join('/')}`;
  const r = await fetch(url, {
    method: method === 'GET' ? 'GET' : 'POST',
    headers: { Authorization: `Bearer ${REDIS_TOKEN}` },
  });
  if (!r.ok) throw new Error(`Redis ${r.status}: ${await r.text()}`);
  const j = await r.json();
  return j.result;
}

async function kvSet(key, value, ex) {
  const url = ex
    ? `${REDIS_URL}/set/${encodeURIComponent(key)}/${encodeURIComponent(value)}/EX/${ex}`
    : `${REDIS_URL}/set/${encodeURIComponent(key)}/${encodeURIComponent(value)}`;
  const r = await fetch(url, {
    headers: { Authorization: `Bearer ${REDIS_TOKEN}` },
  });
  if (!r.ok) throw new Error(`Redis SET ${r.status}: ${await r.text()}`);
  return (await r.json()).result;
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (!REDIS_URL || !REDIS_TOKEN) {
    return res.status(500).json({ error: 'UPSTASH_REDIS_REST_URL ou UPSTASH_REDIS_REST_TOKEN manquant' });
  }

  const today = new Date().toISOString().slice(0, 10);
  const date  = (req.query && req.query.date) || today;
  const key   = `lb:${date}`;

  // ── GET ──────────────────────────────────────────────────────────────────
  if (req.method === 'GET') {
    try {
      const raw = await kv('GET', 'get', key);
      const scores = raw ? JSON.parse(raw) : [];
      return res.status(200).json({ scores });
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  }

  // ── POST ─────────────────────────────────────────────────────────────────
  if (req.method === 'POST') {
    try {
      const { name, score, game } = req.body || {};
      if (!name || score == null || !game) {
        return res.status(400).json({ error: 'Champs manquants: name, score, game' });
      }
      if (isBanned(name)) {
        return res.status(403).json({ error: 'Pseudo non autorisé' });
      }
      const cleanName = String(name).slice(0, 20).trim();
      const raw    = await kv('GET', 'get', key);
      let scores   = raw ? JSON.parse(raw) : [];
      const idx    = scores.findIndex(s => norm(s.name) === norm(cleanName) && s.game === game);
      const entry  = { name: cleanName, score: Number(score), game, ts: Date.now() };
      if (idx >= 0) {
        if (Number(score) > scores[idx].score) scores[idx] = entry;
      } else {
        scores.push(entry);
      }
      await kvSet(key, JSON.stringify(scores), 90000);
      return res.status(200).json({ ok: true });
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  }

  // ── DELETE ────────────────────────────────────────────────────────────────
  if (req.method === 'DELETE') {
    try {
      const { name, game, date: d, adminSecret } = req.body || {};
      if (adminSecret !== ADMIN_SECRET) {
        return res.status(401).json({ error: 'Non autorisé' });
      }
      const targetKey = `lb:${d || today}`;
      const raw = await kv('GET', 'get', targetKey);
      if (!raw) return res.status(404).json({ error: 'Aucun score' });
      let scores = JSON.parse(raw);
      const before = scores.length;
      scores = scores.filter(s => !(norm(s.name) === norm(name) && s.game === game));
      if (scores.length === before) return res.status(404).json({ error: 'Score introuvable' });
      await kvSet(targetKey, JSON.stringify(scores), 90000);
      return res.status(200).json({ ok: true });
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
};
