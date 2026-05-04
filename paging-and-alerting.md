# Jobs and Workers

## Why V2 needs this

The old stack mixed:
- dashboard writes
- platform polling
- webhook renewal
- posting

inside a few long-running processes.

It also blurred:
- admin website actions
- user Discord submissions
- entitlement ownership
- guild-bound Pro access

That makes scaling and debugging painful.

V2 uses durable tables for:
- inbound platform events
- queued work
- subscription renewal
- posting

## Core tables

### `event_ingest`
- raw provider events
- durable audit trail
- dedupe before worker processing

### `job_queue`
- worker-facing queue
- retry state
- priority
- delayed availability
- dedupe keys

### `platform_subscriptions`
- provider subscription metadata
- lease expiry
- verification state

## Early queue names

- `platform_ingest`
- `platform_subscription`
- `live_post`
- `social_feed`
- `social_post`
- `maintenance`
- `entitlement_sync`

## Early job types

- `ingest_platform_event`
- `renew_platform_subscription`
- `process_live_event`
- `dispatch_live_post`
- `process_social_event`
- `dispatch_social_feed_post`
- `dispatch_social_post`
- `reconcile_entitlement`

## Scale intent

This structure is meant to support:
- around 1000 servers comfortably in V2
- a path toward much larger worker counts later

The key is that jobs become durable records, not in-memory loops inside the web server.

## Worker rules

- workers claim jobs with leases, not permanent locks
- stalled jobs must become visible again after lease expiry
- retries should back off and stop at bounded limits
- platform-specific failures should stay isolated to that platform queue
- worker logs should always include queue name, provider, guild, and source identifiers where available

## Dedupe model

- provider events should dedupe globally by a stable provider key
- guild fan-out should happen after the provider event is accepted once
- post history remains per guild so the same source can be posted to many guilds safely
- social post dispatches should dedupe separately from live event ingest
- outbound social publications must persist a durable origin receipt before provider send
- future social ingest must reject WatchMe-authored posts before creating `event_ingest`

## Entitlement tie-in

- `active`, `manual_test`, and `manual_free` can enqueue Pro-only jobs
- `grace_period` can warn and complete safe work, but should be visible in logs and UI
- `inactive` should block Pro-only job creation and execution
- expired guilds should fall back to Lite-safe posting rules instead of running unrestricted Pro jobs

## Access model tie-in

- website-triggered jobs should only come from guild admins/mods
- creator submission jobs should come from Discord-side user actions
- Pro server-bound entitlements should determine whether a guild can enqueue Pro-only jobs
- public connector state should be inspectable before large rollout pushes

## Connector follow-ups

- Twitch is the first implemented real worker slice
- YouTube should use webhook-first ingest with low-quota enrichment reads
- Kick should use webhook-first ingest with guarded polling only as fallback
- the detailed YouTube and Kick plan lives in `docs/youtube-kick-v2-connectors.md`
- the outbound/inbound social loop-prevention plan lives in `docs/social-loop-prevention.md`
