// Vercel serverless function — shared content storage for the admin panel.
//
// Requires two things set in the Vercel project:
//   1. A Redis database connected to the project: Storage tab -> Marketplace
//      Database Providers -> Upstash -> create a database, connect it to this
//      project. That auto-injects the REST URL/token env vars below —
//      nothing to copy by hand.
//   2. ADMIN_SECRET (Settings -> Environment Variables) — any string you
//      choose. Use the SAME value as the password you set in the admin panel
//      the first time you log in, so saves can authenticate.
//
// If either is missing, this endpoint degrades gracefully: GET reports
// { backend: false } and the site falls back to browser-local storage;
// POST returns 503 instead of saving.

// The Upstash-via-Vercel-Marketplace integration has used a couple of
// different env var prefixes over time, so check both.
const REST_URL = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const REST_TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;

let redis = null;
try {
  if (REST_URL && REST_TOKEN) {
    const { Redis } = require('@upstash/redis');
    redis = new Redis({ url: REST_URL, token: REST_TOKEN });
  }
} catch (e) {
  redis = null;
}

const CONTENT_KEY = 'oe_content';

module.exports = async (req, res) => {
  if (req.method === 'GET') {
    if (!redis) {
      res.status(200).json({ content: null, backend: false });
      return;
    }
    try {
      const content = await redis.get(CONTENT_KEY);
      res.status(200).json({ content: content || null, backend: true });
    } catch (e) {
      res.status(200).json({ content: null, backend: false, error: 'redis_unavailable' });
    }
    return;
  }

  if (req.method === 'POST') {
    if (!redis || !process.env.ADMIN_SECRET) {
      res.status(503).json({ ok: false, error: 'backend_not_configured' });
      return;
    }
    const auth = req.headers.authorization || '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
    if (token !== process.env.ADMIN_SECRET) {
      res.status(401).json({ ok: false, error: 'unauthorized' });
      return;
    }
    let body = req.body;
    if (typeof body === 'string') {
      try { body = JSON.parse(body); } catch (e) { body = null; }
    }
    if (!body || typeof body !== 'object') {
      res.status(400).json({ ok: false, error: 'invalid_body' });
      return;
    }
    try {
      await redis.set(CONTENT_KEY, body);
      res.status(200).json({ ok: true });
    } catch (e) {
      res.status(500).json({ ok: false, error: 'redis_write_failed' });
    }
    return;
  }

  res.setHeader('Allow', 'GET, POST');
  res.status(405).json({ ok: false, error: 'method_not_allowed' });
};
