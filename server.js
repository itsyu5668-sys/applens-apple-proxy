// AppLens Apple proxy — tiny Node service for Render (free tier).
// Purpose: fetch public Apple iTunes Search + reviews RSS data so the
// requests come from Render's IPs, not Cloudflare's shared egress IPs
// (Apple 429s Cloudflare egress). Only serves public Apple data.
// Auth: every request except /health must send header
// x-applens-proxy-key matching env APPLE_PROXY_KEY, else 401.
// Tiny in-memory cache: 5 minutes per URL.
const http = require('http');

const PORT = process.env.PORT || 3000;
const PROXY_KEY = process.env.APPLE_PROXY_KEY || '';
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

const cache = new Map(); // url -> {at, status, body}
const CACHE_MS = 5 * 60 * 1000;

function cachedFetch(url) {
  const hit = cache.get(url);
  if (hit && Date.now() - hit.at < CACHE_MS) return Promise.resolve(hit);
  return fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' } })
    .then(async (res) => {
      const body = await res.text();
      const entry = { at: Date.now(), status: res.status, body };
      if (res.ok) cache.set(url, entry);
      return entry;
    });
}

function send(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(body);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname === '/health') return send(res, 200, { ok: true });
  if (req.method !== 'GET') return send(res, 405, { error: 'method not allowed' });
  if (!PROXY_KEY || req.headers['x-applens-proxy-key'] !== PROXY_KEY) {
    return send(res, 401, { error: 'unauthorized' });
  }
  try {
    if (url.pathname === '/lookup') {
      const term = (url.searchParams.get('term') || '').trim();
      const country = (url.searchParams.get('country') || 'US').toUpperCase();
      if (!term) return send(res, 400, { error: 'term is required' });
      const apple = `https://itunes.apple.com/search?term=${encodeURIComponent(term)}&entity=software&country=${encodeURIComponent(country)}&limit=10`;
      const r = await cachedFetch(apple);
      if (r.status !== 200) return send(res, r.status, { error: `Apple API ${r.status} for iTunes search` });
      return send(res, 200, JSON.parse(r.body));
    }
    if (url.pathname === '/rank') {
      const trackId = (url.searchParams.get('track_id') || '').trim();
      const keyword = (url.searchParams.get('keyword') || '').trim();
      const country = (url.searchParams.get('country') || 'US').toUpperCase();
      if (!trackId || !keyword) return send(res, 400, { error: 'track_id and keyword are required' });
      const apple = `https://itunes.apple.com/search?term=${encodeURIComponent(keyword)}&entity=software&country=${encodeURIComponent(country)}&limit=50`;
      const r = await cachedFetch(apple);
      if (r.status !== 200) return send(res, r.status, { error: `Apple API ${r.status} for iTunes search` });
      const data = JSON.parse(r.body);
      const items = data.results || [];
      let rank = null;
      for (let i = 0; i < items.length; i++) {
        if (String(items[i].trackId) === trackId) { rank = i + 1; break; }
      }
      return send(res, 200, {
        keyword,
        rank,
        top: items.slice(0, 3).map((it) => ({ trackId: it.trackId, trackName: it.trackName })),
        checked_top_n: 50,
      });
    }
    if (url.pathname === '/reviews') {
      const trackId = (url.searchParams.get('track_id') || '').trim();
      const country = (url.searchParams.get('country') || 'us').toLowerCase();
      if (!trackId) return send(res, 400, { error: 'track_id is required' });
      const apple = `https://itunes.apple.com/${encodeURIComponent(country)}/rss/customerreviews/id=${encodeURIComponent(trackId)}/sortBy=mostRecent/json`;
      const r = await cachedFetch(apple);
      if (r.status !== 200) return send(res, r.status, { error: `Apple API ${r.status} for reviews RSS` });
      return send(res, 200, JSON.parse(r.body));
    }
    return send(res, 404, { error: 'not found' });
  } catch (e) {
    return send(res, 502, { error: 'proxy fetch failed: ' + (e.message || 'unknown') });
  }
});

server.listen(PORT, '0.0.0.0', () => console.log(`applens-apple-proxy listening on ${PORT}`));
