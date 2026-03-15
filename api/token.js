// api/token.js — Vercel Serverless Function
// Génère un token Ably côté serveur pour ne pas exposer la clé API dans le HTML
// Env var requise : ABLY_API_KEY

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const apiKey = process.env.ABLY_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'ABLY_API_KEY not set' });

  const [keyId, keySecret] = apiKey.split(':');
  const clientId = req.query.clientId || 'anon-' + Math.random().toString(36).slice(2);

  // Ably Token Request (signed server-side)
  const tokenRequest = {
    keyName:    keyId,
    clientId,
    timestamp:  Date.now(),
    nonce:      Math.random().toString(36).slice(2),
    capability: JSON.stringify({ 'mots-doux-*': ['publish', 'subscribe', 'presence'] }),
    ttl:        3600000, // 1h
  };

  // Sign with HMAC-SHA256
  const signStr = [
    tokenRequest.keyName,
    tokenRequest.ttl,
    tokenRequest.capability,
    tokenRequest.clientId,
    tokenRequest.timestamp,
    tokenRequest.nonce,
    '',
  ].join('\n');

  const encoder = new TextEncoder();
  const keyData = encoder.encode(keySecret);
  const msgData = encoder.encode(signStr);
  const cryptoKey = await crypto.subtle.importKey('raw', keyData, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', cryptoKey, msgData);
  tokenRequest.mac = btoa(String.fromCharCode(...new Uint8Array(sig)));

  res.status(200).json(tokenRequest);
}
