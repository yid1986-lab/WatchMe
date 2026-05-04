# WatchMe Launch Board

Last updated: April 9, 2026

This is the living launch board for the current WatchMe projects.

## Project snapshot

| Project | Role | Estimated completion | Current confidence |
|---|---|---:|---|
| `lite-bot` | Lite V1 live bridge until Lite V2 is ready | `~82-85%` | stable on targeted fixes, now rehearsed cleanly at `30` and `50` guilds |
| `lite.v2` | Lite V2 standalone Discord client | `~78-80%` | cleaner and review-safer, with staged preflight and VPS-backed backend proof through and beyond the `1000+` target |
| `pro-bot` | Pro V1 live product | `~70-75%` overall | solid where auth is not blocked |
| `pro.v2` | V2 backend, queue, workers, runtime | `~88-90%` implementation | `~78-80%` cutover confidence |

## lite-bot

Goal:
- keep Lite V1 smooth and safe until roughly the `30-50` server range

Now:
- Twitch webhook verification was hardened to fail closed in [twitch.js](C:/Users/yid19/OneDrive/Desktop/WatchMe%20project/lite-bot/twitch.js)
- creator removal now avoids tearing down shared Twitch subscriptions too aggressively in [commands.js](C:/Users/yid19/OneDrive/Desktop/WatchMe%20project/lite-bot/commands.js)
- stale live suppression now recovers using Twitch `started_at` session boundaries in [twitch.js](C:/Users/yid19/OneDrive/Desktop/WatchMe%20project/lite-bot/twitch.js)
- focused regression coverage exists in [tests/lite-function.js](C:/Users/yid19/OneDrive/Desktop/WatchMe%20project/lite-bot/tests/lite-function.js)
- reviewer-facing panel, modal, and test-alert copy is now smoke-locked in [tests/lite-smoke.js](C:/Users/yid19/OneDrive/Desktop/WatchMe%20project/lite-bot/tests/lite-smoke.js)
- a mixed Twitch plus YouTube rehearsal harness now exists in [tests/lite-rehearsal.js](C:/Users/yid19/OneDrive/Desktop/WatchMe%20project/lite-bot/tests/lite-rehearsal.js)

Next:
- fix the "missed offline event leaves live state stuck" risk in [twitch.js](C:/Users/yid19/OneDrive/Desktop/WatchMe%20project/lite-bot/twitch.js)
- keep coexistence rules clean so Lite V1 and Lite V2 do not share DB, callback URL, or command registration by accident
- keep Lite V1 changes narrow and launch-safe while the weight shifts back onto Lite V2

Blocked:
- no hard external blocker right now

Open issues:
- stale alert recovery still depends on Twitch providing `started_at`
- subscription cleanup still has a small async race window if one guild removes a creator while another adds the same broadcaster
- rehearsal confidence is good for the `30-50` bridge target, but this is still not a long-run unattended soak proof

Stress status:
- targeted test coverage plus a real local rehearsal sheet
- `30` guilds mixed rehearsal = `60` YouTube alerts and `60` Twitch alerts with duplicate suppression holding cleanly
- `50` guilds mixed rehearsal = `100` YouTube alerts and `100` Twitch alerts with duplicate suppression holding cleanly

Latest validation:
- `npm test`
- `npm run rehearsal:30`
- `npm run rehearsal:50`

## lite.v2

Goal:
- finish Lite V2 as the long-run replacement that can take `1000+` servers with the correct Twitch and YouTube runtime path behind it

Now:
- standalone Lite V2 root exists at [lite.v2](C:/Users/yid19/OneDrive/Desktop/WatchMe%20project/lite.v2)
- degraded backend reads now show a warning state instead of a fake empty panel in [discord-runtime.js](C:/Users/yid19/OneDrive/Desktop/WatchMe%20project/lite.v2/src/discord-runtime.js)
- readiness validation now exists in [validation.js](C:/Users/yid19/OneDrive/Desktop/WatchMe%20project/lite.v2/src/validation.js) with tests in [lite-validation.test.js](C:/Users/yid19/OneDrive/Desktop/WatchMe%20project/lite.v2/test/lite-validation.test.js)
- interaction smoke coverage now exists in [lite-interaction-smoke.test.js](C:/Users/yid19/OneDrive/Desktop/WatchMe%20project/lite.v2/test/lite-interaction-smoke.test.js)
- user-facing prompt, CTA, and safe error behavior were tightened in [prompts.js](C:/Users/yid19/OneDrive/Desktop/WatchMe%20project/lite.v2/src/prompts.js) and [discord-runtime.js](C:/Users/yid19/OneDrive/Desktop/WatchMe%20project/lite.v2/src/discord-runtime.js)
- offline smoke mode now exists in [smoke.js](C:/Users/yid19/OneDrive/Desktop/WatchMe%20project/lite.v2/src/smoke.js) and runs through `npm run smoke`
- the backend/runtime ownership contract is pinned in [lite-v2-backend-contract.md](C:/Users/yid19/OneDrive/Desktop/WatchMe%20project/lite.v2/docs/lite-v2-backend-contract.md)
- the Lite-through-V2 path now has a real VPS proof through [pro.v2/scripts/lite-pipeline-check.js](C:/Users/yid19/OneDrive/Desktop/WatchMe%20project/pro.v2/scripts/lite-pipeline-check.js)
- Lite V2 now owns a product-level backend stress entrypoint at [src/backend-stress.js](C:/Users/yid19/OneDrive/Desktop/WatchMe%20project/lite.v2/src/backend-stress.js) via `npm run stress:backend`, while still reusing the proven [pro.v2/scripts/lite-pipeline-check.js](C:/Users/yid19/OneDrive/Desktop/WatchMe%20project/pro.v2/scripts/lite-pipeline-check.js) harness underneath
- the cutover path now has a dedicated Lite V2 preflight in [cutover-preflight.js](C:/Users/yid19/OneDrive/Desktop/WatchMe%20project/lite.v2/src/cutover-preflight.js), including an optional disposable protected write cycle for staging
- Lite V2 now has a repeatable cutover gate in [cutover-rehearsal.js](C:/Users/yid19/OneDrive/Desktop/WatchMe%20project/lite.v2/src/cutover-rehearsal.js) through `npm run rehearsal`
- staged Lite V2 cutover rehearsal has now passed against the VPS API using V1-style fallback auth, including the disposable protected write cycle
- Lite prompt encoding is now clean and locked by [lite-validation.test.js](C:/Users/yid19/OneDrive/Desktop/WatchMe%20project/lite.v2/test/lite-validation.test.js) and [lite-interaction-smoke.test.js](C:/Users/yid19/OneDrive/Desktop/WatchMe%20project/lite.v2/test/lite-interaction-smoke.test.js)
- staged Lite V2 preflight has now passed against the VPS API using V1-style fallback auth, including the disposable protected write cycle

Next:
- keep the scheduled Lite V1 -> Lite V2 switch pack current in [lite-cutover-checklist.md](C:/Users/yid19/OneDrive/Desktop/WatchMe%20project/lite.v2/docs/lite-cutover-checklist.md)
- use `npm run preflight` and optional `LITE_PREFLIGHT_ALLOW_WRITES=1 npm run preflight` as the standard staged cutover gate
- run the real Discord-token cutover only in a scheduled window
- keep the Lite-specific backend stress command in active use against the V2 backend path at `1000+` guild scale
- audit the client UX and permission failure paths end to end

Blocked:
- full launch proof depends on the Lite-facing backend path in [pro.v2](C:/Users/yid19/OneDrive/Desktop/WatchMe%20project/pro.v2)

Open issues:
- degraded state is intentionally conservative and may disable too much when only one backend endpoint is having trouble
- no live Discord bot-process cutover proof exists yet on the staged VPS

Stress status:
- Lite V2 now has its own product-level backend stress entrypoint through `npm run stress:backend`
- real VPS Lite scale sheet now exists:
  - smoke: `1` guild x `1` event = `1` posted alert, `0` failed jobs, `0` failed posts
  - bounded batch: `25` guilds x `1` event = `25` posted alerts in `2.47s`, about `10.13/sec`, `0` failed jobs, `0` failed posts
- VPS scale sheet now goes further:
  - `100` guilds x `1` event = `100` posted alerts in `12.10s`, about `8.27/sec`, `0` failed jobs, `0` failed posts
  - `250` guilds x `1` event = `250` posted alerts in `38.34s`, about `6.52/sec`, `0` failed jobs, `0` failed posts
  - `500` guilds x `1` event = `500` posted alerts in `77.63s`, about `6.44/sec`, `0` failed jobs, `0` failed posts
  - `1000` guilds x `1` event = `1000` posted alerts in `199.85s`, about `5.00/sec`, `0` failed jobs, `0` failed posts
  - latest dedicated Lite backend stress on April 9: `1000` guilds x `3` events = `3000` posted alerts in `209.46s`, about `14.32/sec`, `0` failed jobs, `0` failed posts, `0` runtime failures, peak worker memory about `144.3 MB RSS` and `57.8 MB heap`
  - `2000` guilds x `1` event = `2000` posted alerts in `380.19s`, about `5.26/sec`, `0` failed jobs, `0` failed posts
  - `2000` guilds x `3` events = `6000` posted alerts in `476.76s`, about `12.58/sec`, `0` failed jobs, `0` failed posts
  - `3000` guilds x `3` events = `9000` posted alerts in `840.06s`, about `10.71/sec`, `0` failed jobs, `0` failed posts
- staged protected-client proof now exists:
  - real Lite V2 API client calls succeeded against the protected `pro.v2` Lite routes on the VPS using V1-style `SESSION_SECRET` fallback auth
  - verified read, save-channel, add-creator, remove-creator, and post-cleanup read flow
- first ceiling signs on the current `961 MB` / no-swap VPS:
  - `5000` guilds x `3` events first pass delivered `15000` posts but recorded transient `dispatch_live_post` fetch failures
  - `5000` guilds x `3` events rerun was killed by the Linux OOM killer before completion
- current remaining gap is large-scale Lite product proof, not basic end-to-end viability

Latest validation:
- `npm run check`
- `npm test`
- `npm run smoke`
- `npm run smoke:backend`
- staged VPS: `npm run preflight` with `LITE_PREFLIGHT_ALLOW_WRITES=1`
- staged VPS: `npm run rehearsal -- --with-writes --guild=staged-cutover-rehearsal-20260409`

## pro-bot

Goal:
- finish all auth-independent Pro V1 work while external auth approval is still pending

Now:
- live YouTube runtime remains correctly in [services/youtube-runtime.js](C:/Users/yid19/OneDrive/Desktop/WatchMe%20project/pro-bot/services/youtube-runtime.js)
- active helper layer remains correctly in [youtube.js](C:/Users/yid19/OneDrive/Desktop/WatchMe%20project/pro-bot/youtube.js)
- active poster remains correctly in [services/poster.js](C:/Users/yid19/OneDrive/Desktop/WatchMe%20project/pro-bot/services/poster.js)

Next:
- clean dead or misleading leftovers safely
- keep auth-independent live behavior tidy and verified
- avoid dragging any more V2 or Lite direction into Pro V1

Blocked:
- some remaining completion work is blocked by external auth approval

Open issues:
- stale hotfix scripts and dead artifacts are still present and can mislead future edits
- cleanup must stay conservative because Pro V1 is still live
- auth-dependent items cannot be fully completed yet

Safe cleanup targets:
- [service/poster.js](C:/Users/yid19/OneDrive/Desktop/WatchMe%20project/pro-bot/service/poster.js)
- [scripts/vps-youtube-live-hotfix.js](C:/Users/yid19/OneDrive/Desktop/WatchMe%20project/pro-bot/scripts/vps-youtube-live-hotfix.js)
- [scripts/vps-x-poll-cooldown-hotfix.js](C:/Users/yid19/OneDrive/Desktop/WatchMe%20project/pro-bot/scripts/vps-x-poll-cooldown-hotfix.js)
- [packet.json](C:/Users/yid19/OneDrive/Desktop/WatchMe%20project/pro-bot/packet.json)
- [pyproject.toml](C:/Users/yid19/OneDrive/Desktop/WatchMe%20project/pro-bot/pyproject.toml)

Stress status:
- no fresh scale stress rerun recorded in this pass
- existing smoke behavior remains the main confidence source for now

Latest validation:
- no new full stress sheet in this pass

## pro.v2

Goal:
- continue the V2 runtime hardening path and become the trusted backend replacement path

Now:
- durable queue, worker, paging, socials, Twitch, YouTube, and Kick runtime are real
- Lite-facing backend routes are live inside [apps/api/src/server.js](C:/Users/yid19/OneDrive/Desktop/WatchMe%20project/pro.v2/apps/api/src/server.js)
- Lite durable subscription sync is live in [apps/api/src/queries.js](C:/Users/yid19/OneDrive/Desktop/WatchMe%20project/pro.v2/apps/api/src/queries.js)
- Lite route validation was tightened and smoke-covered in [tests/lite-routes.test.js](C:/Users/yid19/OneDrive/Desktop/WatchMe%20project/pro.v2/tests/lite-routes.test.js)
- Lite mutation responses now return fresh post-write capacity state in [apps/api/src/server.js](C:/Users/yid19/OneDrive/Desktop/WatchMe%20project/pro.v2/apps/api/src/server.js)
- Lite subscription sync now dedupes repeated topic keys before rebuild in [apps/api/src/queries.js](C:/Users/yid19/OneDrive/Desktop/WatchMe%20project/pro.v2/apps/api/src/queries.js)
- Lite-specific end-to-end pipeline harness now exists in [scripts/lite-pipeline-check.js](C:/Users/yid19/OneDrive/Desktop/WatchMe%20project/pro.v2/scripts/lite-pipeline-check.js) with `smoke:lite` and `smoke:lite:batch`
- first real VPS Lite-through-V2 smoke and bounded batch proof are now recorded through [scripts/lite-pipeline-check.js](C:/Users/yid19/OneDrive/Desktop/WatchMe%20project/pro.v2/scripts/lite-pipeline-check.js)
- current DigitalOcean VPS now has a documented Lite ceiling: clean through `3000 x 3`, unstable by `5000 x 3` on the present memory budget
- production now fails closed if internal or public-write tokens are missing, while keeping V1-style `SESSION_SECRET` fallback available for staged cutover
- Lite write routes and broader public write routes now honor separate tokens, so Lite mutation auth no longer implies broader guild-write access
- mobile creator post-builder routes now honor their own `MOBILE_API_WRITE_TOKEN` scope, and the post-builder read route no longer sits open when a token is configured
- creator/mobile routes now also support signed per-user sessions plus an internal session-issue endpoint, so they can move off shared app tokens when the website/mobile layer is ready

Next:
- finish wiring the website/mobile layer onto signed per-user sessions, then tighten token rotation and expiry policy around the remaining app-token fallbacks
- keep unattended soak and VPS-supervised runtime hardening moving
- run real provider smoke where approvals and credentials exist
- decide longer-term ownership boundaries for Lite-facing backend, mobile-facing routes, and inbound social adapters

Blocked:
- some live external proofs are blocked by auth or provider-side approval
- full production confidence still depends on unattended VPS soak, not just local stubs

Open issues:
- the remaining auth risk is now rollout discipline around signed creator/mobile sessions, token rotation, and longer-term session issuance/storage, not fail-open behavior or obvious token crossover
- Lite-facing backend is still coupled into `pro.v2`, which is acceptable for now but still a product-boundary leak
- shared SQL/schema ownership between API and worker is a future drift risk
- Lite route tests are currently in-memory/stub-backed, not Postgres concurrency proofs
- this machine currently has no Docker, no `psql`, and no local Postgres service, so the new Lite pipeline harness cannot be executed end to end here yet

Stress status:
- strongest project stress sheet in the workspace
- local stub-provider and stub-Discord proofs recorded:
  - YouTube: `1000 guilds x 3 events = 3000 delivered posts` at about `625.65/sec`
  - Kick: `1000 guilds x 3 events = 3000 delivered posts` at about `503.36/sec`
  - Twitch: `1000 guilds x 3 events = 3000 delivered posts` at about `531.91/sec`
  - socials-feed: `1000 guilds x 3 events = 3000 delivered posts` at about `740.92/sec`
  - multi-worker forced-crash stress: `2000/2000` deliveries with no duplicate posts after recovery
  - `4`-worker stress: `2000/2000` deliveries in `34.41s` at about `58.13/sec`
  - multi-worker soak: `14400/14400` deliveries, `0` failures, peak about `220.4 MB RSS` and `97.2 MB heap`
- real VPS Lite-facing proof recorded:
  - smoke: `1` guild x `1` event = `1` delivered post, `0` failed jobs, `0` failed posts
  - bounded batch: `25` guilds x `1` event = `25` delivered posts in `2.47s`, about `10.13/sec`, `21` hub subscribe calls after canonical lease convergence
  - `1000` guilds x `1` event = `1000` delivered posts in `199.85s`, about `5.00/sec`
  - latest dedicated Lite backend stress on April 9: `1000` guilds x `3` events = `3000` delivered posts in `209.46s`, about `14.32/sec`, `0` failed jobs, `0` runtime failures, peak worker memory about `144.3 MB RSS` and `57.8 MB heap`
  - `2000` guilds x `3` events = `6000` delivered posts in `476.76s`, about `12.58/sec`
  - `3000` guilds x `3` events = `9000` delivered posts in `840.06s`, about `10.71/sec`
  - `5000` guilds x `3` events first pass hit transient `dispatch_live_post` fetch failures despite eventual delivery
  - `5000` guilds x `3` events rerun was OOM-killed on a `961 MB` / no-swap VPS before completion
  - proof database now returns to zero rows for `job_queue`, `event_ingest`, `platform_subscriptions`, `post_history`, `live_sessions`, `guild_config`, `guilds`, `lite_creators`, and `worker_heartbeats`

Stress caveat:
- these prove queue, dedupe, fan-out, crash recovery, and local runtime behavior
- they do not yet replace live public API or live Discord rate-limit proof

Latest validation:
- `npm test`
- `npm run check`
- `node tests/lite-subscriptions.test.js`
- `node tests/lite-routes.test.js`
- `node --check scripts/lite-pipeline-check.js`
- VPS: `npm run smoke:lite`
- VPS: `npm run smoke:lite:batch`
- VPS: dedicated Lite backend stress pass at `1000` guilds x `3` events
- VPS: progressive Lite scale passes through `3000` guilds x `3` events
- VPS: ceiling found at `5000` guilds x `3` events on current memory

## Cross-project blockers

- external auth approval is still holding back parts of Pro V1 and live Meta proof
- Lite V2 still depends on the current V2 backend path in `pro.v2`
- we still need a proper Lite V2 end-to-end stress harness, not just separate client and backend proofs

## Best next order

1. add swap or move Lite V2/pro.v2 to the bigger VPS before chasing beyond the current `5000 x 3` ceiling
2. keep the Lite V1 -> Lite V2 scheduled cutover pack current and use it for the real switch window
3. keep Pro V2 unattended soak and auth-hardening moving
4. clean safe dead artifacts from Pro V1 while auth-blocked work waits
