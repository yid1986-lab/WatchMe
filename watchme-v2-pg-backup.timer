# V2 Social Loop Prevention

## Goal

WatchMe-authored outbound social posts must never come back through a future inbound social grab as if they were creator-originated content.

This is a hard V2 rule:
- outbound social posts created by WatchMe are not valid inbound creator events
- inbound social grab must reject WatchMe-authored posts before they enter `event_ingest`
- no social connector is considered production-ready until this loop-prevention path is in place

## Why this matters

Without a loop guard, WatchMe can create a bad cycle:
- creator publishes through WatchMe
- WatchMe posts that content to a social platform
- the future social grab sees the new post on that same platform
- WatchMe treats its own outbound post as fresh inbound content
- duplicate Discord/social fan-out or repeat processing begins

At 1000+ servers this is not a small bug. It can become a noisy feedback loop and queue amplifier.

## Core design

V2 should use a two-layer identity model for outbound social posts:

1. Durable outbound receipt in Postgres
- every outbound social publication gets a stable `origin_key`
- every provider response is recorded in a durable publication ledger
- inbound social grab checks that ledger before creating any ingest row

2. Provider-visible fallback marker when useful
- if a provider gives back reliable post IDs and app/source metadata, that is the primary match path
- if a provider is weak or inconsistent, WatchMe also stamps a fallback fingerprint into the post metadata or payload where possible
- the fallback marker exists to catch cases where provider post IDs are delayed, missing, or hard to reconcile

## Required data model

Outbound social posting should not stop at `creator_post_dispatches`.

`creator_post_dispatches` is the user intent.
We also need one durable row per actual platform publication attempt.

Use `social_post_publications` for that ledger.

Each row should capture:
- `dispatch_id`
- `discord_user_id`
- `platform`
- `connection_id`
- `status`
- `origin_key`
- `origin_fingerprint`
- `external_account_id`
- `external_post_id`
- `external_parent_post_id`
- `external_app_id`
- `external_url`
- `external_created_at`
- `payload_json`
- `marker_json`
- `error_json`

## Outbound flow

Before WatchMe sends anything to a social provider:
- create a stable `origin_key`
- insert a `social_post_publications` row with status `queued`
- attach marker details to `marker_json`

After provider success:
- store `external_post_id`
- store `external_account_id`
- store `external_app_id` when available
- store the returned post URL
- move the row to `posted`

After provider failure:
- keep the row
- record the failure in `error_json`
- never lose the `origin_key`

## Inbound social grab rule

Future social-grab code must normalize each candidate post into:
- `platform`
- `external_post_id`
- `external_account_id`
- `external_app_id`
- `external_parent_post_id`
- `published_at`
- normalized text and URLs

Then it must run the candidate through a self-origin rejection gate before `event_ingest`.

Reject the candidate when any of these are true:
- `platform + external_post_id` matches a `social_post_publications` row
- `external_app_id` matches a known WatchMe app/client identity for that platform
- normalized content or metadata contains the saved `origin_key` or `origin_fingerprint`
- the candidate is a repost, quote, or share of a known WatchMe-authored publication

Only if the candidate survives those checks can it enter `event_ingest`.

## Matching order

Use this order for accuracy and cost:

1. Exact provider post ID match
- safest and cheapest

2. Provider app/source match
- use when the provider exposes application ownership or source app metadata

3. Embedded marker match
- use when provider APIs are weak or delayed

4. Repost/share ancestry match
- catch quote-post and repost cases that reference an already known WatchMe post

Do not reject inbound content just because the author account is a connected creator account.
Creators still need to be able to publish manually outside WatchMe without being hidden.

## Marker policy

Markers should be boring, stable, and invisible to normal users where possible.

Good options:
- provider source app ID
- provider-returned post ID stored in the receipt ledger
- a short WatchMe origin token in platform metadata
- a URL parameter or hidden reference that can be normalized on ingest

Bad options:
- filtering only by author account
- fuzzy text matching alone
- visible public hashtags that look messy or can be copied by users

## Retention policy

The minimal publication receipt should be kept much longer than normal transient queue data.

Rule:
- keep provider IDs, origin keys, account IDs, and timestamps for at least 400 days
- full payload snapshots can be pruned earlier if needed
- the loop-prevention identity data should outlive any realistic social backfill window

The reason is simple:
- a late backfill or re-sync must still recognize an old WatchMe post as self-authored

## Worker responsibilities

`social_post`
- create and update `social_post_publications`
- persist origin keys before the provider call
- record final provider IDs after success

future `platform_ingest` social path
- normalize inbound social candidates
- call the self-origin rejection gate
- only accepted candidates may become `event_ingest` rows

## Rollout order

1. Add `social_post_publications` to schema.
2. Generate `origin_key` for every outbound social publication.
3. Store provider IDs and app/source metadata on successful publish.
   Current state: Facebook outbound now does this in V2.
4. Build one shared `isWatchMeOrigin` guard for inbound social connectors.
   Current state: `POST /api/internal/social-events/evaluate` now rejects known WatchMe-origin candidates before ingest.
5. Add accepted social ingest storage without enabling full worker fan-out yet.
   Current state: `POST /api/internal/social-events` now stores accepted candidates in `event_ingest` and enqueues worker processing.
6. Wire the first provider-shaped inbound adapter through the same guard.
   Current state: `POST /api/internal/social-adapters/instagram/media` now normalizes Instagram media payloads, rejects known WatchMe-origin posts before ingest, and forwards accepted posts into the worker socials-feed path.
7. Require loopback tests before enabling any social grab in production.

## Validation requirements

Every social connector should prove:
- WatchMe can publish outward and record a durable receipt
- the provider post ID is stored and searchable
- the same post, when seen by inbound grab, is skipped before `event_ingest`
- reposts of known WatchMe posts are skipped when policy says they should be
- manually authored creator posts are still accepted

Current smoke coverage:
- `npm run smoke:social-origin` for outbound receipt creation
- `npm run smoke:social-ingest` for accepted manual social ingest plus queue creation
- `npm run smoke:social-feed` for Discord socials-feed delivery
- `npm run smoke:social-loop` for inbound WatchMe-origin rejection
- `npm run smoke:instagram-inbound` for the first provider-shaped inbound adapter using the same rejection guard

This should be tested before deeper social work is turned on.
