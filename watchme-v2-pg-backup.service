# Pro V2 Scale Framework

## Goal

Pro V2 should be comfortable at roughly 1000 servers without another rewrite.

Current implementation checkpoint:
- `docs/pro-v2-build-checkpoint.md`

That means:
- server growth is mostly a queue and worker problem
- no single bot process owns all polling, posting, and billing logic
- provider failures stay local instead of poisoning the whole product

## Core operating model

### API
- owns sessions, dashboard writes, billing state, and entitlement checks
- never owns platform polling loops
- enqueues work instead of doing provider-heavy actions inline where possible

### Workers
- own webhook renewals, provider polling, dedupe, fan-out, and retries
- can be scaled independently by queue
- can pause one provider without stopping the rest of the product

### Database
- Postgres is the source of truth
- queue state, dedupe state, entitlement state, and posting history live in durable tables
- restarts should not erase or silently mutate product state

## Queue split

Use separate queues so load stays understandable:
- `platform_ingest`
- `platform_subscription`
- `live_post`
- `social_post`
- `maintenance`
- `entitlement_sync`

Each queue should be observable on its own:
- pending depth
- oldest available job
- retry count
- last error rate
- worker lease age

## Dedupe rules

- provider events dedupe globally by provider object, not by guild
- the same source should be processed once, then fanned out to every subscribed guild
- posting history stays per guild so one live event can safely post to many guilds
- social dispatch dedupe should not share keys with live alert dedupe

## Entitlement rules

Every Pro-only action should be gated by explicit entitlement state:
- `active`
- `grace_period`
- `inactive`
- `manual_test`
- `manual_free`

Rules:
- `active`, `manual_test`, and `manual_free` can run full Pro work
- `grace_period` should warn but not immediately hard-cut
- `inactive` blocks Pro-only jobs and routes
- when Pro is inactive, the guild falls back to Lite-safe behavior instead of losing the bot install

## Posting model

### Live alerts
- one provider event enters the ingest table
- one processing job resolves affected guilds
- one or more live-post jobs handle Discord fan-out

### Social posting
- outbound social work stays in its own queue
- slow or fragile providers cannot block Discord live alerts
- provider-specific failures must include enough context to retry or disable safely
- outbound social posts must create durable origin receipts so future inbound social grab never re-ingests WatchMe-authored posts
- Facebook and Instagram should be treated as separate providers with separate login and token paths
- Instagram must not depend on a linked Facebook Page in V2
- the detailed loop-prevention plan lives in `docs/social-loop-prevention.md`
- Meta connector separation notes live in `docs/meta-social-v2-connectors.md`

## Connector policy

- Twitch and YouTube should remain the primary stable connectors
- higher-risk connectors should be isolated behind separate worker code paths
- every connector should be pausable with a flag or queue stop
- no connector should require web-process restarts to recover
- connector-specific rollout notes for YouTube and Kick live in `docs/youtube-kick-v2-connectors.md`

## 1000-server readiness checklist

- durable queue claims with lease expiry
- bounded retries with backoff
- visible queue lag per queue
- visible provider error rate per connector
- entitlement gating before expensive provider work
- per-guild posting history
- global provider dedupe
- safe connector pause controls
- billing cancellation disables Pro-only behavior cleanly

## Non-goals

- supporting every historical edge case before the worker split is stable
- turning every connector on at once
- keeping unpaid guilds on unrestricted Pro behavior
