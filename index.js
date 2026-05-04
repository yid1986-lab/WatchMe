# WatchMe V2 API

This is the first real V2 backend slice.

Current endpoints:
- `GET /api/health`
- `GET /api/guilds/:guildId/config`
- `PUT|POST /api/guilds/:guildId/config`
- `GET /api/guilds/:guildId/creators`
- `GET /api/lite/guilds/:guildId/capacity`
- `GET /api/lite/guilds/:guildId/creators`
- `PUT|POST /api/lite/guilds/:guildId/channel`
- `PUT|POST /api/lite/guilds/:guildId/creators`
- `DELETE /api/lite/guilds/:guildId/creators/:liteCreatorId`
- `PUT|POST /api/guilds/:guildId/creators/:discordUserId/profile`
- `PUT|POST /api/guilds/:guildId/creators/:discordUserId/access`
- `POST /api/internal/platform-events`
- `POST /api/internal/mobile-sessions`
- `POST /api/internal/social-adapters/instagram/media`
- `POST /api/internal/social-events`
- `POST /api/internal/social-events/evaluate`
- `GET /api/internal/ops/queues`
- `GET /api/internal/ops/health`
- `GET /api/internal/ops/paging`
- `POST /api/internal/ops/paging/run`

Notes:
- routes intentionally accept both `PUT` and `POST` on the save endpoints to avoid the old V1 style route mismatch pain
- this app expects Postgres through `DATABASE_URL`
- creator approval states are `pending`, `approved`, or `disabled`
- when `INTERNAL_API_TOKEN` is set, internal routes require `x-internal-token` or `Authorization: Bearer ...`
- guild and user rows are now auto-created before dependent records are written
- guild and creator live sources now sync into durable `platform_subscriptions`
- Lite creator mutations return the refreshed capacity snapshot alongside the synced subscriptions so the Discord panel can stay quiet and deterministic
- internal ops routes now return warnings for stale locks, queue backlog, failed jobs, and risky subscription leases
- internal ops routes now also expose `queueBreakdown`, `summary.socialFeed`, `summary.workers`, and `recentWorkers` so the socials-feed and worker-health paths have their own backlog, delivery, heartbeat, and memory view
- internal paging routes now persist incidents and delivery audit in Postgres, then send Discord webhook pages and recoveries when configured
- `POST /api/internal/ops/paging/run` accepts `warning_overrides` only outside production so local pager smoke runs do not need real queue failures
- Lite guild mutations can use `LITE_API_WRITE_TOKEN`, while creator/mobile post-builder routes can use `MOBILE_API_WRITE_TOKEN`; both fall back through `PUBLIC_API_WRITE_TOKEN` to `SESSION_SECRET`
- creator/mobile post-builder routes can also accept a signed user session token; when `MOBILE_SESSION_REQUIRED=true`, the signed user session becomes mandatory and the route user id must match the signed `discord_user_id`
- `POST /api/internal/mobile-sessions` lets a trusted internal service mint a signed creator/mobile session after its own login or identity checks
- `POST /api/internal/social-adapters/instagram/media` is the first provider-shaped inbound social adapter and reuses the guarded social ingest path
- `POST /api/internal/social-events` stores accepted social candidates in `event_ingest` and enqueues worker processing
- `POST /api/internal/social-events/evaluate` is the shared pre-ingest WatchMe-origin guard for future social grab connectors

Before running for real:
1. bring up Postgres with [docker-compose.yml](C:\Users\yid19\OneDrive\Desktop\WatchMe project\watchme-v2\infra\docker-compose.yml)
2. install dependencies in `watchme-v2`
3. copy `.env.example` to a real `.env`
