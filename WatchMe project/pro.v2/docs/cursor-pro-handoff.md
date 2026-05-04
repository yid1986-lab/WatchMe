# Cursor Pro Handoff

Snapshot date: April 8, 2026

## Start here

This project is the Pro-bot V2 rebuild in:
- `C:\Users\yid19\OneDrive\Desktop\WatchMe project\pro.v2`

Read these first:
1. `docs/pro-v2-build-checkpoint.md`
2. `docs/paging-and-alerting.md`
3. `docs/social-loop-prevention.md`
4. `docs/validation-and-soak.md`
5. `docs/vps-deploy.md`

## Repo scope

This repo is the Pro-focused V2 layout.

Present here:
- `apps/api`
- `apps/worker`
- `packages/shared`
- `docs`
- `scripts`
- `tests`

Not present here:
- `apps/lite-v2`
- `apps/mobile`
- `apps/web`

If you need the older wider V2 snapshot, that is still in:
- `C:\Users\yid19\OneDrive\Desktop\WatchMe project\watchme-v2`

For active Pro V2 work, use this `pro.v2` root.

## Rollout gates

These gates are for Pro V1 to Pro V2 only.

- Around `30` live Pro V1 guilds:
  Put Pro V2 on its own VPS and begin production-like testing while Pro V1 still serves users.

- Around `50` live Pro V1 guilds:
  Treat that as the target point for the cutover decision after testing is acceptable.

Lite V2 is separate and is not gated by this table.

## Mission

Keep building Pro V2 as the future replacement path for Pro V1.

Priority:
- reliability first
- observability second
- safe cutover path from V1
- no shallow connector sprawl

## What is already real

Built and locally verified:
- durable queue and worker architecture
- Twitch, YouTube, and Kick live-event worker slices
- durable Discord live-post dispatch
- multi-worker crash recovery and soak checks
- outbound Facebook and Instagram social posting
- inbound WatchMe-origin social loop guard
- first inbound Instagram-shaped adapter
- Discord socials-feed worker path
- socials-feed local stress at `1000` guilds x `3` events
- pager incidents and delivery audit
- Discord webhook paging with cooldown and recovery
- worker heartbeats with stale-heartbeat and memory warnings
- pager escalation rules for restart storms, repeated pager delivery failures, and persistent worker health incidents
- VPS deploy notes, systemd units, and Postgres backup scripts

## Immediate next build order

1. Run the pager loop under real VPS supervision.
   Use the systemd units in `infra/systemd` and the steps in `docs/vps-deploy.md`.

2. Keep long-run reliability moving.
   Use `npm run dev:stack`, `npm run soak:stack`, and `npm run soak:stack:1h`.

3. Harden restart-storm and repeated stale-worker behavior if soak exposes noise or edge cases.

4. Only after the above is boring, widen inbound social adapters.

5. After Meta business auth approval, run live Facebook and Instagram credential smokes.

## Non-goals for now

Do not do these yet unless the core is already stable:
- wide social collector rollout
- shallow connector pile-up
- anything that bypasses the shared social loop guard
- Instagram through a Facebook Page dependency

## Guardrails

Keep these rules:
- Instagram must stay separate from Facebook login and publish logic
- every outbound social publish must write durable origin receipts
- inbound social work must use the shared pre-ingest guard
- live alerts and socials-feed posting must stay queue-isolated
- no connector should require a web-process restart to recover
- always leave smoke coverage behind with each new slice

## Best files to work from

Pager and ops:
- `apps/api/src/paging.js`
- `apps/api/src/queries.js`
- `apps/api/src/server.js`
- `apps/worker/src/runner.js`
- `apps/worker/src/store.js`
- `docs/paging-and-alerting.md`

Social ingest and loop prevention:
- `apps/api/src/social-adapters.js`
- `apps/api/src/server.js`
- `apps/api/src/queries.js`
- `packages/shared/src/index.js`
- `docs/social-loop-prevention.md`

Worker and runtime:
- `apps/worker/src/runtime.js`
- `apps/worker/src/runner.js`
- `apps/worker/src/server.js`
- `apps/worker/src/store.js`

## Validation baseline

Run this before continuing:
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

## Current honest status

Roughly:
- planning and architecture: about `90%`
- durable implementation: about `84-85%`
- production cutover confidence: about `65-70%`

The biggest remaining gap is unattended operational confidence, not basic feature shape.

## Failsafe backup

Keep a timestamped archive in:
- `.local/backups/`

After any major restructuring, refresh that archive before more work continues.

## Final note

Do not restart from first principles.
The current Pro V2 already has real queue, worker, social, and paging foundations.
Build forward from the checkpoint files above.
