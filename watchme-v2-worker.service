# V2 Validation And Soak

## Purpose

Every connector slice in WatchMe V2 should now clear three levels of validation:

1. unit and helper tests
2. local smoke run through the real worker path
3. local or VPS stress run at target fan-out

This is the minimum standard before we call a connector "ready for rollout planning".

## Latest VPS Lite proof

Recorded on April 8, 2026 against the DigitalOcean VPS:

- `lite.v2` staged preflight passed against the VPS API using V1-style fallback auth:
  - `npm run preflight`
  - disposable protected write cycle passed with `LITE_PREFLIGHT_ALLOW_WRITES=1`
  - result: `add=1`, `cleanup=0`
  - guild used: `vps-preflight-guild-20260408`

- `npm run smoke:lite` passed on the VPS:
  - `1` guild x `1` event
  - `1` posted alert
  - `0` failed jobs
  - `0` failed posts
- `npm run smoke:lite:batch` passed on the VPS:
  - `25` guilds x `1` event
  - `25` posted alerts in `2469ms`
  - about `10.13 deliveries/sec`
  - `0` failed jobs
  - `0` failed posts
  - `21` YouTube hub subscribe calls after canonical lease convergence
- the proof database returned to zero rows afterward for:
  - `job_queue`
  - `event_ingest`
  - `platform_subscriptions`
  - `post_history`
  - `live_sessions`
  - `guild_config`
  - `guilds`
  - `lite_creators`
  - `worker_heartbeats`

Notes:
- the first VPS batch failure was a harness issue, not a worker failure: the script assumed one hub renewal per guild, but the current worker correctly converges later Lite guilds onto an already-healthy canonical YouTube lease
- the Lite proof harness cleanup now deletes `lite_creators` and its run-specific `worker_heartbeats`, so proof runs no longer leave VPS test rows behind

## Extended VPS Lite scale sheet

Further DigitalOcean VPS runs on April 8, 2026:

- `100` guilds x `1` event:
  - `100` posted alerts in `12.10s`
  - about `8.27 deliveries/sec`
  - `0` failed jobs
  - `0` failed posts
- `250` guilds x `1` event:
  - `250` posted alerts in `38.34s`
  - about `6.52 deliveries/sec`
  - `0` failed jobs
  - `0` failed posts
- `500` guilds x `1` event:
  - `500` posted alerts in `77.63s`
  - about `6.44 deliveries/sec`
  - `0` failed jobs
  - `0` failed posts
- `1000` guilds x `1` event:
  - `1000` posted alerts in `199.85s`
  - about `5.00 deliveries/sec`
  - `0` failed jobs
  - `0` failed posts
- `1000` guilds x `3` events:
  - earlier pass: `3000` posted alerts in `223.03s`
  - about `13.45 deliveries/sec`
  - `0` failed jobs
  - `0` failed posts
- `2000` guilds x `1` event:
  - `2000` posted alerts in `380.19s`
  - about `5.26 deliveries/sec`
  - `0` failed jobs
  - `0` failed posts
- `2000` guilds x `3` events:
  - `6000` posted alerts in `476.76s`
  - about `12.58 deliveries/sec`
  - `0` failed jobs
  - `0` failed posts
- `3000` guilds x `3` events:
  - `9000` posted alerts in `840.06s`
  - about `10.71 deliveries/sec`
  - `0` failed jobs
  - `0` failed posts

Latest dedicated Lite backend stress on April 9, 2026:

- `1000` guilds x `3` events:
  - `3000` posted alerts in `209455ms`
  - about `14.32 deliveries/sec`
  - `0` failed jobs
  - `0` failed posts
  - `0` runtime failures
  - `240` hub subscribe calls
  - `1` YouTube lookup and `3` video lookups
  - `3000` Discord message sends
  - peak worker memory about `144.3 MB RSS` and `57.8 MB heap`

Current ceiling findings on the present VPS:

- the current droplet has about `961 MB` RAM and no swap
- `5000` guilds x `3` events first pass delivered `15000` posts but the worker recorded transient `dispatch_live_post` fetch failures, so it was not a clean pass
- the Discord sender was then hardened to retry raw network `fetch` failures inside the request loop instead of only retrying `429`/`5xx` HTTP responses
- the Lite proof harness was tightened to fail if the worker runtime records transient job failures, even if all rows eventually drain
- `5000` guilds x `3` events rerun then hit a hard VPS limit:
  - Linux OOM killer terminated the `node` process
  - kernel log:
    - `oom-kill ... task=node`
    - `Out of memory: Killed process ... (node)`
  - partial Lite proof rows were cleaned manually and the database was returned to zero rows afterward

Interpretation:

- the current Lite-through-V2 path is comfortably proven beyond the launch target on this VPS
- the first practical instability on this exact box appears around the `5000 x 3` range
- if we want comfortable headroom above that, a bigger VPS or swap-backed memory budget is the right next move rather than more code churn first

## Staged Lite V2 protected API proof

Recorded on April 8, 2026 against the DigitalOcean VPS:

- synced the latest `pro.v2` API and worker config changes into `/opt/watchme-v2`
- added `SESSION_SECRET` and `DISCORD_TOKEN` into the staged V2 `.env` from the existing Pro V1 env so V1-style fallback names are present on the box
- started a manual staged `pro.v2` API process on the VPS
- opened a local SSH tunnel to the VPS API
- ran the real Lite V2 API client against the protected Lite routes using `SESSION_SECRET` fallback auth

Proved through the real client:

- backend smoke before writes returned `0` creators
- alert channel save succeeded
- Lite creator add succeeded
- guild config read reflected the saved alert channel
- Lite creators read returned the saved creator
- capacity read returned `1` creator used
- Lite creator delete succeeded
- backend smoke after cleanup returned `0` creators again

Important boundary:

- this proved the protected Lite client-to-API contract on the staged VPS
- it did not yet prove a live Discord `/wme` interaction or a live Discord test alert on the VPS, because Lite V2 is not yet running there as a real Discord bot process
- running Lite V2 with the current Lite V1 Discord token would be a separate cutover-risk step, not a safe background smoke

## Staged Lite V2 preflight proof

Recorded on April 8, 2026 against the DigitalOcean VPS:

- the staged `pro.v2` API was reachable through an SSH tunnel on the local machine
- Lite V2 `npm run preflight` passed using V1-style fallback env names:
  - `DISCORD_TOKEN`
  - `SESSION_SECRET`
- the optional disposable protected write cycle also passed with `LITE_PREFLIGHT_ALLOW_WRITES=1`
- the staged preflight guild started with `0` creators and no alert channel, completed the temporary add/save/remove path, and ended back at `0` creators with no alert channel shown

Interpretation:

- the Lite V2 cutover gate is now real, not just checklist text
- V1-style fallback auth is confirmed on the staged path we plan to use on update day
- the remaining cutover gap is the live Discord token switch itself, not staged API reachability or protected Lite writes

## Current commands

Run the fast checks first:

- `npm run check`
- `npm test`

What `npm run check` now enforces:

- API: production requires dedicated internal/public/lite/mobile secrets plus `MOBILE_SESSION_SECRET` and `MOBILE_SESSION_REQUIRED=true`
- worker: production requires `INTERNAL_API_TOKEN`, `DISCORD_BOT_TOKEN`, Twitch secret enforcement, and a non-default `YOUTUBE_WEBHOOK_PATH` when YouTube webhooks are enabled
- this command is no longer a no-op readiness badge

Run the Lite-through-V2 smoke path:

- `npm run smoke:lite`

Run the Lite-through-V2 bounded batch path:

- `npm run smoke:lite:batch`

Run the Lite V2 protected client-to-API smoke path from the Lite client repo:

- `cd ../lite.v2 && npm run smoke:backend`

Long-run burn-in (API + worker + pager, one terminal):

- `npm run dev:stack`
- `npm run soak:stack` (health sampling) or `npm run soak:stack:1h` (1-hour timed soak)

Postgres (requires client tools on `PATH`):

- `npm run pg:backup`
- `npm run pg:restore-drill -- --backup=path/to/file.dump --confirm`

Run the pager smoke path:

- `npm run smoke:paging`

Run the worker heartbeat smoke path:

- `npm run smoke:worker-heartbeat`

Run the outbound social origin receipt smoke path:

- `npm run smoke:social-origin`

Run the accepted social ingest smoke path:

- `npm run smoke:social-ingest`

Run the Discord socials-feed pipeline smoke path:

- `npm run smoke:social-feed`

Run the Discord socials-feed fan-out stress path:

- `npm run stress:social-feed`

Run the inbound social loop guard smoke path:

- `npm run smoke:social-loop`

Run the Facebook outbound social publish smoke path:

- `npm run smoke:facebook-social`

Run the Instagram outbound social publish smoke path:

- `npm run smoke:instagram-social`

Run the Instagram inbound adapter smoke path:

- `npm run smoke:instagram-inbound`

Run the Twitch smoke path:

- `npm run smoke:twitch`

Run the Twitch fan-out stress path:

- `npm run stress:twitch`

Run the YouTube smoke path:

- `npm run smoke:youtube`

Run the YouTube fan-out stress path:

- `npm run stress:youtube`

Run the Kick smoke path:

- `npm run smoke:kick`

Run the Kick fan-out stress path:

- `npm run stress:kick`

Run the multi-worker crash recovery smoke path:

- `npm run smoke:multi-worker`

Run the multi-worker crash recovery stress path:

- `npm run stress:multi-worker`

Run the 4-worker crash recovery stress path:

- `npm run stress:multi-worker:4`

Run the repeated multi-worker soak path:

- `npm run soak:multi-worker`

## What the smoke and stress scripts do

The script at `scripts/twitch-pipeline-check.js`:

- starts a local stub server for Twitch auth, Helix, EventSub, and Discord delivery
- starts the real V2 worker server and queue runner
- seeds many guild subscriptions into Postgres
- enqueues a real `renew_platform_subscription` job
- verifies Twitch EventSub callback verification through the real webhook route
- posts signed `stream.online` notifications into the real webhook route
- verifies `stream.offline` cleanup in smoke mode
- waits until `post_history` shows the expected delivered live alerts
- fails if jobs or posts end in a failed state

The script at `scripts/youtube-pipeline-check.js`:

- starts a local stub server for YouTube API, hub renewal, and Discord delivery
- starts the real V2 worker server and queue runner
- seeds many guild subscriptions into Postgres
- enqueues a real `renew_platform_subscription` job
- verifies the worker's YouTube webhook callback flow
- posts one or more Atom notifications into the real webhook route
- waits until `post_history` shows the expected delivered live alerts
- fails if jobs or posts end in a failed state

That means it exercises:

- durable queue claim/complete/retry behavior
- worker webhook handling
- YouTube live enrichment logic
- entitlement-aware fan-out
- Discord dispatch through the live-post worker path

The script at `scripts/kick-pipeline-check.js` does the same for the Kick live path, including:

- app-token bootstrap
- event subscription reconcile
- signed Kick webhook delivery
- live enrichment against the Kick API

The script at `scripts/multi-worker-check.js` focuses on queue safety instead of a single connector:

- starts two real worker processes against the same Postgres database
- points both workers at the same YouTube webhook callback target
- sends one live event, then force-kills one worker while it still owns `live_post` jobs
- waits for the surviving worker to release stale locks and finish delivery without duplicates
- sends another live event after the crash to prove the queue keeps moving
- in `soak` mode, keeps workers alive for a timed run, sends repeated batches, and records runtime memory peaks

The script at `scripts/social-origin-check.js` validates social loop prevention basics:

- ensures the `social_post_publications` schema exists locally
- creates one active creator social connection
- creates one creator dispatch with a duplicate requested target and one missing target
- runs the real `social_post` worker handler
- verifies exactly one durable origin receipt is stored for the connected platform
- verifies the dispatch outcome stays `partial` because the missing connection is still blocked

The script at `scripts/social-ingest-check.js` validates accepted social ingest storage:

- starts the real API server with internal auth enabled
- sends one accepted manual social candidate through `POST /api/internal/social-events`
- verifies one `event_ingest` row is stored with `processing_state = 'received'`
- verifies one queue job is created for the accepted social event
- sends one WatchMe-origin candidate through the same route
- verifies the blocked candidate is rejected before ingest

The script at `scripts/social-feed-check.js` validates the first Discord socials-feed path:

- starts the real API server plus a local Discord API stub
- seeds one approved creator with an active Instagram connection in one Pro guild
- sends one accepted manual social candidate through `POST /api/internal/social-events`
- runs the real worker handlers for ingest, social processing, and socials-feed dispatch
- verifies one Discord socials-feed message is sent to `guild_config.socials_feed_channel_id`
- verifies one posted `post_history` row is stored for the social session

The script at `scripts/social-feed-stress.js` validates socials-feed fan-out and ops visibility:

- starts the real API server, the real worker server, the real queue runner, and a local Discord API stub
- seeds one approved creator with one active Instagram connection across `1000` Pro guilds
- sends `3` accepted manual social candidates through `POST /api/internal/social-events`
- verifies the API ops route reports social ingest backlog before the worker starts
- verifies all expected `dispatch_social_feed_post` jobs drain and all expected `post_history` rows are posted
- verifies `GET /api/internal/ops/queues` reports zero socials-feed backlog at the end of the run
- captures `GET /ops/runtime` so worker throughput and memory stay visible in the final summary

The script at `scripts/social-loop-check.js` validates the inbound WatchMe-origin rejection guard:

- starts the real API server with internal auth enabled
- seeds one known WatchMe social publication receipt
- sends internal social candidate evaluations through the API route
- verifies direct post-id, app-id, marker, and repost ancestry matches are rejected
- verifies a manual unrelated creator post is still accepted
- verifies the evaluation route does not write to `event_ingest` yet

The script at `scripts/facebook-social-check.js` validates the first real outbound social provider path:

- starts a local stub Graph API server
- creates one active creator Facebook connection with a page token
- creates one creator dispatch that targets Facebook
- runs the real `social_post` worker handler
- verifies one outbound provider request is made
- verifies `social_post_publications` stores a real provider post id and app id
- verifies the dispatch status moves to `completed`

The script at `scripts/instagram-social-check.js` validates the separate Instagram provider path:

- starts a local stub Instagram Graph API server
- creates one active creator Instagram connection with its own Instagram token
- creates one creator dispatch that targets Instagram with a public image URL
- runs the real `social_post` worker handler
- verifies one `/media` container request and one `/media_publish` request are made
- verifies `social_post_publications` stores a real Instagram media id, container id, and app id
- verifies the dispatch status moves to `completed`

The script at `scripts/instagram-inbound-check.js` validates the first inbound social adapter:

- starts the real API server, worker server, queue runner, and a local Discord API stub
- seeds one approved creator with one active Instagram connection in one Pro guild
- seeds one known WatchMe-origin publication receipt for Instagram
- sends one blocked Instagram media payload through `POST /api/internal/social-adapters/instagram/media`
- verifies the known WatchMe-origin post is rejected before `event_ingest`
- sends one accepted Instagram media payload through the same adapter route
- verifies the accepted event keeps Instagram handle and content-type metadata intact
- verifies the accepted post reaches `event_ingest`, worker processing, and Discord socials-feed delivery

The script at `scripts/paging-check.js` validates the pager path:

- starts the real API server and a local pager webhook stub
- sends one synthetic high-severity pager warning through `POST /api/internal/ops/paging/run`
- verifies the first sweep sends one page and stores one active incident
- reruns the same warning immediately and verifies cooldown suppression
- clears the warning and verifies one recovery is sent
- verifies pager incident and delivery audit rows are visible through `GET /api/internal/ops/paging`

The script at `scripts/worker-heartbeat-check.js` validates worker-health telemetry:

- starts the real API server and the real worker runner
- waits for a live `worker_heartbeats` row to appear through `GET /api/internal/ops/health`
- verifies the API exposes `summary.workers` and `recentWorkers`
- verifies low RSS and heap thresholds raise worker memory warnings
- stops the runner, ages the heartbeat row, and verifies `worker_heartbeat_stale` is raised

The script at `scripts/lite-pipeline-check.js` validates the Lite-through-V2 runtime path:

- starts the real API server, worker server, queue runner, and a local Discord API stub
- saves Lite alert channels and Lite creators through the real `/api/lite/guilds/:guildId/channel` and `/creators` routes
- waits for durable Lite `platform_subscriptions` to be created and canonicalized with `metadata_json.scope = 'lite'`
- drives the YouTube worker path with a real webhook-style event
- verifies Discord delivery for Lite guilds through the shared worker fan-out path
- in batch mode, repeats that flow across multiple Lite guilds for bounded fan-out proof

The Lite-side test at `../lite.v2/test/lite-protected-backend-smoke.test.js` validates the protected client contract:

- boots a mocked `pro.v2` API server with write auth enabled
- uses real Lite V2 API client calls for reads and writes
- proves Lite V2 can rely on V1-style fallback env names (`SESSION_SECRET`) for write auth during rollout
- verifies channel save, creator add, creator remove, and backend smoke all succeed through the protected routes

## Local requirements

The smoke and stress scripts need a reachable Postgres database.

Expected default:

- `DATABASE_URL=postgres://watchme:watchme@127.0.0.1:5432/watchme_v2`

Recommended local setup:

- start Postgres from `infra/docker-compose.yml`

If Docker is not installed, point `DATABASE_URL` at another local or VPS Postgres instance before running the scripts.

First-time **Linux VPS** install (clone, Postgres schema, systemd, TLS): **`docs/vps-deploy.md`**.

## Current target

For YouTube, the target stress profile is:

- `1000` guild subscriptions
- `3` live events
- zero failed jobs
- zero failed posts
- all expected `post_history` rows delivered

For socials-feed, the target stress profile is:

- `1000` approved guild targets for one creator social connection
- `3` social post events
- zero failed jobs
- zero failed posts
- all expected Discord socials-feed posts delivered
- API ops ending with zero social backlog

This is not a year-long soak test yet.
It is the repeatable pre-soak gate.

For the current local soak path, "pass" means:

- all expected alerts are posted
- `discordMessages` matches posted alerts exactly
- zero failed jobs
- zero failed posts
- queue drains cleanly at the end
- runtime snapshots keep reporting healthy workers through the run

## Year-long / 1000-guild solo run (target bar)

“Faultless for a year or until ~1000 guilds” is not a single test — it is **process discipline + Postgres hygiene + paging that works when you are not looking**. The stack is designed for that; you still have to operate it.

### Clean cutover checklist (before **Pro V1** user traffic moves to **Pro V2**)

Use this before **Pro V1 → Pro V2 cutover** (target decision window when **Pro V1 is around ~50 guilds**, after **Pro V2** has lived on its **own VPS** since **~30 Pro V1 guilds** — see `docs/cursor-pro-handoff.md` *Rollout gates*). **Lite V1 → Lite V2** is a **separate** checklist when you ship Lite V2.

1. **Evidence** — `npm run check` and `npm test` green; run the smoke/stress matrix your connectors use (see sections above).
2. **Postgres** — durable volume; **daily logical backups** and a **restore drill** on a throwaway database before cutover (see **Postgres backup and restore drill** below).
3. **Secrets** — `INTERNAL_API_TOKEN` set and identical for API, worker, and pager loop; Discord and provider tokens only in env files (`chmod 600`), not in shell history.
4. **Three processes** — API, worker, and pager must all run under a supervisor (systemd on Linux). Templates: `infra/systemd/watchme-v2-api.service`, `watchme-v2-worker.service`, `watchme-v2-pager.service` (install paths in `docs/paging-and-alerting.md` for pager; same pattern for API/worker with `/etc/watchme-v2/api.env` and `worker.env`).
5. **Health** — uptime monitor on `GET /api/health` (or TCP on `API_PORT`). Pager does not replace this; it complements it for queue/worker incidents.
6. **Discord pager** — `OPS_PAGER_DISCORD_WEBHOOK_URL` set in API env; pager env has `INTERNAL_API_TOKEN` + `API_BASE_URL` if not localhost.
7. **Order on boot** — start API first, then worker, then pager (pager calls the API).
8. **First week** — watch `GET /api/internal/ops/paging` (internal auth) or DB tables `ops_pager_incidents`, `worker_heartbeats`, `job_queue` until boring.

### Postgres backup and restore drill

**Tools:** PostgreSQL client binaries `pg_dump` and `pg_restore` on `PATH`, ideally the **same major version** as the server.

**Manual backup (any host):**

- `npm run pg:backup` — reads `DATABASE_URL`, writes a **custom-format** dump under `.local/backups/pg/` (ignored by git via `.gitignore`).
- Optional: `node scripts/pg-backup.js --outDir=/path/to/dir --database-url=...`

**Restore drill (proves you can recover before you need it):**

- `npm run pg:restore-drill -- --backup=.local/backups/pg/watchme-v2-YYYYMMDD-HHMMSS.dump --confirm`
- Creates a temporary database `watchme_v2_drill_<timestamp>`, restores the dump, checks for `public` tables and a `guilds` table, then **drops** the temp DB (`DROP ... WITH (FORCE)` on Postgres 13+).
- `--keep-db` — skip the drop so you can inspect manually (drop the DB yourself when done).
- The `DATABASE_URL` role must be allowed to **CREATE DATABASE** (superuser or `CREATEDB`). On managed clouds, run the drill from a maintenance user or a staging instance.

**Docker Compose Postgres** (if you use `infra/docker-compose.yml` and do not have local `pg_dump`):

```bash
docker compose -f infra/docker-compose.yml exec -T postgres \
  pg_dump -U watchme -Fc watchme_v2 > watchme-v2.dump
```

**Automated daily backup on a VPS (systemd):**

1. Create the output directory, e.g. `sudo mkdir -p /var/backups/watchme-v2/pg && sudo chown watchme:watchme /var/backups/watchme-v2/pg`.
2. Install unit files `infra/systemd/watchme-v2-pg-backup.service` and `watchme-v2-pg-backup.timer` into `/etc/systemd/system/`.
3. Create `/etc/watchme-v2/backup.env` (`chmod 600`) with `DATABASE_URL=...` (same database you protect in production).
4. `sudo systemctl daemon-reload && sudo systemctl enable --now watchme-v2-pg-backup.timer`
5. Check with `systemctl list-timers` and `journalctl -u watchme-v2-pg-backup.service`.

Copy dumps **off the VPS** periodically (object storage, second region, or another machine). A backup that only lives on the same disk as Postgres is not a full disaster plan.

### Local burn-in (same shape as production)

- `npm run dev:stack` — starts API, worker, and pager in one terminal (prefixed logs). Use for multi-hour soak on a laptop or staging box with real `DATABASE_URL`.
- `npm run soak:stack` — same processes, plus a JSON health sample to `/api/health` every **60s** (override with `--healthIntervalSec=30`). Run until Ctrl+C, or set a bounded burn-in:
  - `npm run soak:stack:1h` — stop automatically after **1 hour**
  - `npm run soak:stack -- --durationSec=28800` — **8 hours**
- Env: `API_PORT` (default `3101`) or `SOAK_API_BASE_URL` / `API_BASE_URL` if the API is not on localhost.
- Stop with Ctrl+C; the soak runner stops the stack, which sends **SIGTERM** to the three children (API closes HTTP + pool; worker and pager shut down as already implemented).

### Longer confidence tests (before you call it “done”)

- 1+ hour burn-in with `dev:stack` or systemd trio, real or stub providers as appropriate
- overnight or weekend run if you can, watching disk and Postgres size
- stale-lock and multi-worker recovery (`npm run soak:multi-worker`, stress scripts)
- disk growth checks for `event_ingest`, `job_queue`, `post_history`, `ops_pager_deliveries`, logs
- confirm escalation paths fire when forced (see `docs/paging-and-alerting.md`)

### What we are not promising

- No software is “faultless” without monitoring and backups. This repo gives **durable queues, heartbeats, pager, escalation, and graceful API shutdown** so a solo operator can sleep; you still need **Postgres backups** and occasional **log/incident review**.

## Rule going forward

Any new connector or major queue change should ship with:

- one smoke command
- one stress command
- one short doc section describing what "pass" means
