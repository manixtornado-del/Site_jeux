// api/token.js — Vercel Serverless Function (CommonJS)
// Génère un token Ably côté serveur
// Env var requise : ABLY_API_KEY

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const apiKey = process.env.ABLY_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'ABLY_API_KEY not set' });

  const [keyName, keySecret] = apiKey.split(':');
  if (!keyName || !keySecret) return res.status(500).json({ error: 'ABLY_API_KEY format invalide (attendu: keyName:keySecret)' });

  const clientId = req.query?.clientId || 'anon-' + Math.random().toString(36).slice(2);

  const tokenRequest = {
    keyName,
    clientId,
    timestamp:  Date.now(),
    nonce:      Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2),
    capability: JSON.stringify({ '*': ['publish', 'subscribe', 'presence'] }),
    ttl:        3600000,
  };

  // Signe avec HMAC-SHA256
  const signStr = [
    tokenRequest.keyName,
    tokenRequest.ttl,
    tokenRequest.capability,
    tokenRequest.clientId,
    tokenRequest.timestamp,
    tokenRequest.nonce,
    '',
  ].join('\n');

  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw', enc.encode(keySecret),
    { name: 'HMAC', hash: 'SHA-256' },
    false, ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(signStr));
  tokenRequest.mac = Buffer.from(sig).toString('base64');

  return res.status(200).json(tokenRequest);
};
