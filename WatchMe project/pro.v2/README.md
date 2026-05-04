# Pro V2

This folder is the current Pro-bot V2 workspace.

Path:
- `C:\Users\yid19\OneDrive\Desktop\WatchMe project\pro.v2`

This is a Pro-focused repo shape now, not the older wider V2 workspace.

What is in this repo:
- `apps/api`
- `apps/worker`
- `packages/shared`
- `docs`
- `scripts`
- `tests`
- `infra`

What is not in this repo:
- `apps/lite-v2`
- `apps/mobile`
- `apps/web`

Those wider V2 experiments still exist in the older `watchme-v2` folder, but this `pro.v2` folder is the one to use for Pro V2 work if you want the cleaned-up Pro-only layout.

## Current status

Built and locally validated:
- durable queue and worker architecture
- Twitch, YouTube, and Kick live-event worker slices
- Discord live-post dispatch
- guild-level live automation controls for filters, role routing, threads, and stream-end follow-ups
- outbound Facebook and Instagram social posting
- inbound social loop guard
- Discord socials-feed worker path
- paging with durable incidents and delivery audit
- worker heartbeats with stale-heartbeat and memory-pressure warnings
- local smoke and stress coverage for the core Pro paths

## Key docs

Read these first:
- `docs/cursor-pro-handoff.md`
- `docs/mobile-session-integration.md`
- `docs/pro-v2-build-checkpoint.md`
- `docs/paging-and-alerting.md`
- `docs/social-loop-prevention.md`
- `docs/validation-and-soak.md`
- `docs/vps-deploy.md`

## Main commands

Validation:
- `npm run check`
- `npm test`
- `npm run smoke:paging`
- `npm run smoke:worker-heartbeat`
- `npm run smoke:social-feed`
- `npm run stress:social-feed`
- `npm run smoke:facebook-social`
- `npm run smoke:instagram-social`
- `npm run smoke:instagram-inbound`
- `npm run smoke:lite`
- `npm run smoke:lite:batch`

Local runtime:
- `npm run dev:api`
- `npm run dev:worker`
- `npm run dev:pager`
- `npm run dev:stack`
- `npm run soak:stack`
- `npm run soak:stack:1h`

Ops and backup:
- `npm run pager:once`
- `npm run pg:backup`
- `npm run pg:restore-drill`

## Env compatibility

To reduce rollout friction, Pro V2 accepts the existing V1 env names as fallbacks:
- `DISCORD_BOT_TOKEN` falls back to `DISCORD_TOKEN`
- `INTERNAL_API_TOKEN` falls back to `SESSION_SECRET`
- `PUBLIC_API_WRITE_TOKEN` falls back to `SESSION_SECRET`
- `LITE_API_WRITE_TOKEN` falls back to `PUBLIC_API_WRITE_TOKEN`, then `SESSION_SECRET`
- `MOBILE_API_WRITE_TOKEN` falls back to `PUBLIC_API_WRITE_TOKEN`, then `SESSION_SECRET`
- `MOBILE_SESSION_SECRET` falls back to `SESSION_SECRET`

Production note:
- do not rely on the `SESSION_SECRET` fallbacks in production
- set dedicated values for `INTERNAL_API_TOKEN`, `PUBLIC_API_WRITE_TOKEN`, `LITE_API_WRITE_TOKEN`, `MOBILE_API_WRITE_TOKEN`, and `MOBILE_SESSION_SECRET`
- keep `MOBILE_SESSION_REQUIRED=true` in production so user-scoped mobile routes require signed sessions

Creator/mobile auth mode:
- mobile creator post-builder routes can use `MOBILE_API_WRITE_TOKEN` as a rollout fallback
- when `MOBILE_SESSION_REQUIRED=true`, those routes require a signed user session instead
- internal trusted services can mint a signed user session through `POST /api/internal/mobile-sessions`

## Important routes

API:
- `GET /api/internal/ops/queues`
- `GET /api/internal/ops/health`
- `GET /api/internal/ops/paging`
- `POST /api/internal/ops/paging/run`
- `POST /api/internal/social-events`
- `POST /api/internal/social-events/evaluate`
- `POST /api/internal/social-adapters/instagram/media`

Worker:
- `GET /ops/runtime`

## Immediate next work

1. Run the pager loop under real VPS supervision.
2. Add restart-storm and repeated stale-worker escalation hardening.
3. Keep long-run soak and unattended reliability moving.
4. Hold broad outbound/inbound platform expansion until the Discord-first live automation slice proves demand.
5. After Meta business auth approval, run live Facebook and Instagram credential smokes.
