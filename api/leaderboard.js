// api/leaderboard.js — Vercel Serverless Function
// Requires: Upstash Redis (free tier)
// Env vars needed: UPSTASH_REDIS_REST_URL, UPSTASH_REDIS_REST_TOKEN, ADMIN_SECRET
//
// Setup: vercel env add UPSTASH_REDIS_REST_URL
//        vercel env add UPSTASH_REDIS_REST_TOKEN
//        vercel env add ADMIN_SECRET   (mot de passe admin de votre choix)

const REDIS_URL   = process.env.UPSTASH_REDIS_REST_URL;
const REDIS_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;
const ADMIN_SECRET = process.env.ADMIN_SECRET || 'changeme';

// Liste de mots bannis (insensible à la casse, sans accents)
const BANLIST = [
  // Ajoutez ici les mots/pseudos à bannir
  'admin','test','fuck','merde','putain','connard','salope','bite','con',
  'fdp','pute','enculé','encule','nazi','hitler','nigger','nword',
];

function norm(s) {
  return s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
}

function isBanned(name) {
  const n = norm(name);
  return BANLIST.some(banned => n.includes(norm(banned)));
}

async function redis(command, ...args) {
  const res = await fetch(`${REDIS_URL}/${command}/${args.map(encodeURIComponent).join('/')}`, {
    headers: { Authorization: `Bearer ${REDIS_TOKEN}` },
  });
  if (!res.ok) throw new Error(`Redis error: ${res.status}`);
  const json = await res.json();
  return json.result;
}

async function redisPost(command, body) {
  const res = await fetch(`${REDIS_URL}/${command}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${REDIS_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Redis error: ${res.status}`);
  const json = await res.json();
  return json.result;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');

  if (req.method === 'OPTIONS') return res.status(200).end();

  const today = new Date().toISOString().slice(0, 10);
  const key   = `lb:${today}`;

  // ── GET /api/leaderboard?date=YYYY-MM-DD ──────────────────────────────
  if (req.method === 'GET') {
    try {
      const date = req.query.date || today;
      const raw  = await redis('GET', `lb:${date}`);
      const scores = raw ? JSON.parse(raw) : [];
      return res.status(200).json({ scores });
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  }

  // ── POST /api/leaderboard  { name, score, game } ──────────────────────
  if (req.method === 'POST') {
    try {
      const { name, score, game } = req.body || {};
      if (!name || score == null || !game) {
        return res.status(400).json({ error: 'Missing fields' });
      }
      if (isBanned(name)) {
        return res.status(403).json({ error: 'Pseudo non autorisé' });
      }
      const cleanName = String(name).slice(0, 20).trim();
      if (!cleanName) return res.status(400).json({ error: 'Pseudo vide' });

      const raw    = await redis('GET', key);
      const scores = raw ? JSON.parse(raw) : [];

      // Empêche plusieurs soumissions du même pseudo pour le même jeu aujourd'hui
      const existing = scores.findIndex(
        s => norm(s.name) === norm(cleanName) && s.game === game
      );
      const entry = { name: cleanName, score: Number(score), game, ts: Date.now() };
      if (existing >= 0) {
        // Met à jour seulement si le nouveau score est meilleur
        if (Number(score) > scores[existing].score) scores[existing] = entry;
      } else {
        scores.push(entry);
      }

      // Expire à minuit + 1 jour (86400s)
      await redisPost('set', [key, JSON.stringify(scores), 'EX', 90000]);
      return res.status(200).json({ ok: true });
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  }

  // ── DELETE /api/leaderboard  { name, game, date?, adminSecret } ────────
  if (req.method === 'DELETE') {
    try {
      const { name, game, date, adminSecret } = req.body || {};
      if (adminSecret !== ADMIN_SECRET) {
        return res.status(401).json({ error: 'Non autorisé' });
      }
      const targetKey = `lb:${date || today}`;
      const raw       = await redis('GET', targetKey);
      if (!raw) return res.status(404).json({ error: 'Aucun score pour cette date' });
      let scores = JSON.parse(raw);
      const before = scores.length;
      scores = scores.filter(s => !(norm(s.name) === norm(name) && s.game === game));
      if (scores.length === before) return res.status(404).json({ error: 'Score introuvable' });
      await redisPost('set', [targetKey, JSON.stringify(scores), 'EX', 90000]);
      return res.status(200).json({ ok: true, removed: before - scores.length });
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
