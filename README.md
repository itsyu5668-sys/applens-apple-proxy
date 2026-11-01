# AppLens Apple proxy

Tiny Node service for Render (free tier). It fetches public Apple iTunes
Search and reviews RSS data so the requests come from Render's IPs instead
of Cloudflare's shared egress IPs, which Apple rate-limits (429).

Endpoints (all GET, all JSON):
- `/health` -> `{ok:true}` (no auth)
- `/lookup?term=&country=US` -> Apple iTunes search, `entity=software`, limit 10
- `/rank?track_id=&keyword=&country=US` -> `{keyword, rank, top, checked_top_n:50}`
- `/reviews?track_id=&country=us` -> Apple reviews RSS JSON feed

All endpoints except `/health` require header `x-applens-proxy-key`
matching env `APPLE_PROXY_KEY`, else 401. Responses are cached in memory
for 5 minutes per URL.
