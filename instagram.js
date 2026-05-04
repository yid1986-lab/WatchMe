# WatchMe V2 Worker

This is the first real V2 worker slice.

Current behavior:
- releases stale job locks
- claims pending jobs from `job_queue`
- dispatches jobs by `job_type`
- marks jobs completed or retries them
- can be pinned to named queues with `WORKER_QUEUES`
- processes claimed jobs with bounded worker concurrency
- sweeps due or revoked platform subscriptions and requeues renewals automatically
- writes durable worker heartbeat telemetry into Postgres on a separate interval

Current live handlers:
- `renew_platform_subscription`
- `ingest_platform_event`
- `process_live_event`
- `process_social_event`
- `dispatch_live_post`
- `dispatch_social_feed_post`
- `dispatch_social_post`

What the worker now does:
- turns internal platform events into durable ingest records
- fans one accepted provider event out to all subscribed guild targets
- applies entitlement gating before per-guild Pro-only fan-out
- runs a real Twitch EventSub slice with webhook verification and reconciliation
- runs a real YouTube push slice with hub renewal, feed ingest, and `videos.list` live enrichment
- runs a real Kick webhook slice with signed event intake, subscription reconciliation, and live enrichment
- sends real Discord live alerts from `live_post` jobs
- retries Discord rate limits and transient 5xx delivery errors with backoff
- records per-guild live dispatch history in `live_sessions` and `post_history`
- handles Twitch offline cleanup for guilds that enable `auto_cleanup`
- handles Kick offline cleanup for guilds that enable `auto_cleanup`
- writes durable social origin receipts for all social dispatch targets
- publishes real Facebook page posts for connected creator Facebook accounts
- publishes real Instagram media posts for connected creator Instagram accounts through a separate Instagram token path
- turns accepted inbound social events into Discord socials-feed posts for approved creators in Pro guilds
- keeps non-Facebook/non-Instagram social dispatch rows moving while their provider-specific posting code is still placeholder

Worker HTTP routes:
- `GET /health`
- `GET /ops/runtime` for internal worker runtime state, including memory samples and peak RSS/heap
- `POST /webhooks/twitch` by default, override with `TWITCH_WEBHOOK_PATH`
- `GET /webhooks/youtube` by default for hub verification, override with `YOUTUBE_WEBHOOK_PATH`
- `POST /webhooks/youtube` by default for feed notifications, override with `YOUTUBE_WEBHOOK_PATH`
- `POST /webhooks/kick` by default for signed Kick events, override with `KICK_WEBHOOK_PATH`

Important env for the current live slices:
- `WORKER_PORT`
- `WORKER_CONCURRENCY`
- `WORKER_HEARTBEAT_INTERVAL_MS`
- `INTERNAL_API_TOKEN`
- `DISCORD_BOT_TOKEN`
- `DISCORD_API_BASE_URL`
- `DISCORD_MAX_RETRIES`
- `DISCORD_RETRY_BASE_MS`
- `FACEBOOK_APP_ID`
- `FACEBOOK_API_BASE_URL`
- `FACEBOOK_GRAPH_VERSION`
- `INSTAGRAM_APP_ID`
- `INSTAGRAM_API_BASE_URL`
- `INSTAGRAM_GRAPH_VERSION`
- `TWITCH_CLIENT_ID`
- `TWITCH_CLIENT_SECRET`
- `TWITCH_AUTH_URL`
- `TWITCH_API_BASE_URL`
- `TWITCH_WEBHOOK_BASE_URL`
- `TWITCH_WEBHOOK_SECRET`
- `YOUTUBE_API_KEY`
- `YOUTUBE_API_BASE_URL`
- `YOUTUBE_WEBHOOK_BASE_URL`
- `YOUTUBE_WEBHOOK_PATH`
- `YOUTUBE_WEBHOOK_HUB_URL`
- `YOUTUBE_WEBHOOK_LEASE_SECONDS`
- `KICK_CLIENT_ID`
- `KICK_CLIENT_SECRET`
- `KICK_API_BASE_URL`
- `KICK_TOKEN_URL`
- `KICK_PUBLIC_KEY_URL`
- `KICK_WEBHOOK_BASE_URL`
- `KICK_WEBHOOK_PATH`

Local validation commands:
- `npm run smoke:worker-heartbeat`
- `npm run smoke:facebook-social`
- `npm run smoke:instagram-social`
- `npm run smoke:social-feed`
- `npm run smoke:social-ingest`
- `npm run smoke:social-origin`
- `npm run smoke:twitch`
- `npm run stress:twitch`
- `npm run smoke:multi-worker`
- `npm run stress:multi-worker`
- `npm run stress:multi-worker:4`
- `npm run soak:multi-worker`
- `npm run smoke:youtube`
- `npm run stress:youtube`
- `npm run smoke:kick`
- `npm run stress:kick`

Those commands expect a reachable local Postgres database, usually from `infra/docker-compose.yml`.
They spin a local YouTube + Discord stub, run the real worker, and verify that the queue fans one live event out across many guild subscriptions.

The worker runtime route uses the same `INTERNAL_API_TOKEN` pattern as the API.
When that token is set, use `x-internal-token` or `Authorization: Bearer ...` for `/ops/runtime`.

The worker also persists heartbeat rows into `worker_heartbeats`.
Those rows feed API ops warnings for:
- stale worker heartbeats
- missing workers
- high RSS memory
- high heap memory

That is intentional:
- queue flow first
- platform implementation second

This keeps V2 honest about scale and isolation from the beginning.
