# Pro V2 Build Checkpoint

Snapshot date: April 3, 2026

## Rollout gates (**Pro V1** guild count — Pro V2 only)

**Lite V2** (Lite V1 replacement, `apps/lite-v2`) is **its own product** and **its own** planned Lite update when ready—not covered by these gates.

- **~30 guilds on Pro V1** → put **Pro V2** on **its own VPS** and begin **production-like testing** (Pro V1 still serves users).
- **~50 guilds on Pro V1** → **target end of that testing window** for **Pro V1 → Pro V2 cutover** once checks pass (50 is the milestone for go-live decision, not the day you buy the VPS).

## Purpose

This file is the re-entry note for ongoing Pro V2 work.

Use it to answer:
- what is already real
- what has been verified locally
- what is still intentionally unfinished
- where to resume next without re-discovering context

For a direct tool-to-tool handoff, also read:
- `docs/cursor-pro-handoff.md`

At the **~30 Pro V1 guild** gate, provision the **Pro V2** server and follow **`docs/vps-deploy.md`**. Before that, **local dev only** is fine for Pro.

Repo is **VPS-ready** in the sense of: schema file, systemd unit templates, env split, backup timer, TLS/webhook notes, and Node version pin (`.nvmrc`, `package.json` `engines`).

Repo root for this checkpoint:
- `C:\Users\yid19\OneDrive\Desktop\WatchMe project\pro.v2`

## Current verified state

The V2 core is no longer just planning.

Built and locally verified:
- durable `job_queue` worker loop with retries, stale-lock recovery, and bounded concurrency
- durable `event_ingest` path for platform live events
- entitlement-aware guild fan-out
- Twitch EventSub reconcile plus signed webhook ingest
- YouTube push renew plus Atom ingest plus live enrichment
- Kick signed webhook ingest plus live enrichment
- real Discord live-post dispatch from worker jobs
- multi-worker crash recovery checks against the same queue/database
- local soak coverage for repeated worker batches
- durable `social_post_publications` ledger for outbound social identity
- real outbound Facebook provider path
- real outbound Instagram provider path with separate Instagram token path
- shared inbound WatchMe-origin rejection route at `POST /api/internal/social-events/evaluate`
- first Discord socials-feed worker path from accepted social ingest to posted Discord message
- social-specific ops summary and warnings for social backlog, failed ingest, and failed delivery
- durable pager incidents and delivery audit through `ops_pager_incidents` and `ops_pager_deliveries`
- internal pager routes at `GET /api/internal/ops/paging` and `POST /api/internal/ops/paging/run`
- Discord webhook page and recovery delivery with cooldown and reminder logic
- durable `worker_heartbeats` telemetry with API warnings for missing workers, stale heartbeats, high RSS, and high heap usage
- systemd unit template at `infra/systemd/watchme-v2-pager.service` for running `scripts/ops-pager-loop.js` on a VPS (install steps in `docs/paging-and-alerting.md`)
- pager escalation warnings: `worker_restart_storm`, `pager_webhook_delivery_failures`, `worker_heartbeat_stale_persistent`, `worker_heartbeat_missing_persistent` (thresholds in `.env.example`)
- `npm run dev:stack` runs API + worker + pager for burn-in; `npm run soak:stack` / `soak:stack:1h` add timed soak + `/api/health` sampling; systemd templates for all three under `infra/systemd/`; API graceful shutdown on SIGINT/SIGTERM (HTTP close + pool end)
- `npm run pg:backup` / `npm run pg:restore-drill` plus systemd `watchme-v2-pg-backup.service` + `.timer` for scheduled dumps (`docs/validation-and-soak.md`)

## Local validation status

These passed on April 3, 2026:
- `npm run check`
- `npm test`
- `npm run smoke:twitch`
- `npm run stress:twitch`
- `npm run smoke:youtube`
- `npm run stress:youtube`
- `npm run smoke:kick`
- `npm run stress:kick`
- `npm run smoke:multi-worker`
- `npm run stress:multi-worker`
- `npm run stress:multi-worker:4`
- `npm run soak:multi-worker`
- `npm run smoke:facebook-social`
- `npm run smoke:instagram-inbound`
- `npm run smoke:instagram-social`
- `npm run smoke:paging`
- `npm run smoke:worker-heartbeat`
- `npm run smoke:social-origin`
- `npm run smoke:social-loop`
- `npm run smoke:social-feed`
- `npm run stress:social-feed`

Last strong local fan-out proofs recorded:
- YouTube local stress: 1000 guilds x 3 events = 3000 delivered posts
- Kick local stress: 1000 guilds x 3 events = 3000 delivered posts
- Twitch local stress: 1000 guilds x 3 events = 3000 delivered posts
- Socials-feed local stress: 1000 guilds x 3 events = 3000 delivered posts
- Multi-worker crash recovery passed with forced worker death and no duplicate posts

Important note:
- these numbers are local stub-provider and stub-Discord proofs
- they validate queue, dedupe, fan-out, and recovery behavior
- they do not replace live external rate-limit proof

## Social loop prevention state

What is already real:
- outbound social publications write durable origin receipts into `social_post_publications`
- Facebook and Instagram provider responses store provider post IDs and app IDs
- the internal API route `POST /api/internal/social-events/evaluate` rejects candidates by:
  - exact external post ID
  - external app ID
  - embedded `origin_key`
  - embedded `origin_fingerprint`
  - repost or share ancestry
- the internal API route `POST /api/internal/social-events` stores accepted manual social candidates in `event_ingest` and enqueues worker processing
- the social worker path can now process accepted social events and post them into `guild_config.socials_feed_channel_id`
- the first provider-shaped inbound adapter is now live at `POST /api/internal/social-adapters/instagram/media`
- the Instagram inbound adapter now proves one blocked WatchMe-origin post and one accepted creator post through the real worker path
- accepted Instagram inbound events now preserve account handle plus content-type metadata through to Discord socials-feed
- unrelated manual creator posts still pass the guard

What is not done yet:
- no external provider poller or webhook collector is live yet
- only the first Instagram-shaped inbound adapter is implemented; the wider inbound social connector set is still not live yet
- no second escalation target exists beyond the Discord webhook pager path

This is intentional.
The guard exists first so future inbound social work cannot accidentally create loops.

## Meta state

Current position:
- Facebook outbound publish is real in V2
- Instagram outbound publish is real in V2
- Instagram is separate from Facebook and must stay that way
- live end-to-end Meta auth proof is blocked on business auth approval

When business auth is approved:
1. test real Instagram login/connect
2. test real Facebook login/connect
3. run live outbound publish smokes
4. verify returned provider IDs and app metadata match what the loop guard expects

## What is intentionally paused

Do not go deep on extra social connectors until the current core stays boring and reliable.

That means:
- no rush into wide social-grab rollout
- no shallow connector pile-up
- no bypass around the shared WatchMe-origin guard

Priority stays:
- reliability
- observability
- safe cutover path from V1

## Exact next re-entry steps

Next recommended build order:

1. Wire the first inbound social connector adapter.
   Current state: the first Instagram-shaped adapter is now live at `POST /api/internal/social-adapters/instagram/media`.

2. Promote the first inbound social connector adapter to use `POST /api/internal/social-events`.
   Current state: the Instagram adapter already does this through the shared guarded ingest path.

3. Define the downstream social event shape.
   Current baseline is `social.post.created` plus Discord socials-feed delivery through `process_social_event` and `dispatch_social_feed_post`.
   Next step is widening provider adapters only after pager and reliability stay boring.

4. ~~Run the pager loop as a supervised VPS process beside API and worker.~~ Use `infra/systemd/watchme-v2-pager.service` and `docs/paging-and-alerting.md`.

5. ~~Add restart-storm and repeated-stale-worker escalation rules.~~ (env-tunable; see paging doc.)

6. After business auth approval, run real Meta credential smoke tests.

7. Keep long-run soak and live provider validation moving in parallel.

## Best starting files next time

For inbound social evaluation:
- `apps/api/src/server.js`
- `apps/api/src/queries.js`
- `apps/api/src/paging.js`
- `packages/shared/src/index.js`
- `docs/social-loop-prevention.md`
- `docs/paging-and-alerting.md`

For outbound social provider behavior:
- `apps/worker/src/handlers.js`
- `apps/worker/src/facebook.js`
- `apps/worker/src/instagram.js`
- `apps/worker/src/store.js`

For queue and reliability work:
- `apps/worker/src/runner.js`
- `apps/worker/src/runtime.js`
- `apps/worker/src/store.js`
- `apps/worker/src/server.js`
- `apps/api/src/paging.js`
- `apps/api/src/queries.js`
- `docs/validation-and-soak.md`

## Guardrails

Keep these rules in place:
- Instagram must not depend on a linked Facebook Page path
- every outbound social publish must keep writing durable origin receipts
- future inbound social code must use the shared pre-ingest guard
- live alerts and social posting must stay queue-isolated
- no connector should require a web-process restart to recover
- always leave smoke coverage behind when adding a new connector slice

## If returning after a break

Use this short restart sequence:

1. read this file
2. read `docs/social-loop-prevention.md`
3. read `docs/paging-and-alerting.md`
4. run:
   - `npm run check`
   - `npm test`
   - `npm run smoke:paging`
   - `npm run smoke:worker-heartbeat`
   - `npm run smoke:social-loop`
   - `npm run smoke:social-feed`
   - `npm run smoke:instagram-inbound`
   - `npm run stress:social-feed`
   - `npm run smoke:facebook-social`
   - `npm run smoke:instagram-social`
5. then continue either pager hardening or the next inbound social adapter slice
