# YouTube and Kick V2 Connectors

## Purpose

This document defines how YouTube and Kick should work in WatchMe Pro V2 after the Twitch worker slice.

The goal is not just feature parity with V1.
The goal is connector behavior that still feels predictable when Pro is serving around 1000 servers and a very large number of creators.

## Design rules

- one source event should be accepted once, then fanned out to many guilds
- source subscriptions should be tracked globally where possible, not duplicated per guild
- provider-specific failures should stay inside that connector
- all heavy provider work should run in workers, never in the web process
- Pro-only work must be checked against entitlement state before Discord fan-out
- fallback behavior must be explicit, observable, and easy to pause

## YouTube

### What YouTube gives us

The official YouTube push notifications flow is still the right base for V2:

- YouTube Data API push notifications use PubSubHubbub / WebSub-style webhooks
- subscriptions are made against a channel feed topic URL
- notifications arrive as Atom feeds
- notifications are sent when a channel uploads a video or updates a video's title or description
- the feed includes `yt:videoId` and `yt:channelId`

This means the webhook itself is only a hint that "something changed for this channel/video".
It is not a trustworthy live-start event on its own.

### Core V2 model

1. Admin or creator saves a YouTube URL in V2.
2. API resolves and stores the canonical YouTube channel ID once.
3. API syncs a `platform_subscriptions` row using a global topic key like `youtube:CHANNEL_ID`.
4. `platform_subscription` workers keep the Google hub subscription alive and record lease/verification state.
5. Worker webhook receiver accepts Atom notifications and writes one `event_ingest` row per channel/video update.
6. `platform_ingest` worker enriches that event using YouTube API reads before deciding whether it is a real live alert.
7. If the event represents an active live broadcast, the worker fans out `live_post` jobs per entitled guild target.
8. `live_post` workers handle Discord delivery and per-guild post history.

### Recommended event decision flow

When a YouTube webhook notification arrives:

- parse `yt:videoId` and `yt:channelId`
- dedupe globally by channel ID plus video ID plus event timestamp if present
- fetch `videos.list` for that specific video
- request `snippet` and `liveStreamingDetails`
- treat the video as live only when the returned resource still shows active live state
- build the session key from the video ID, not just the channel ID

This matters because the webhook can also fire for:

- a normal upload
- a title edit
- a description edit
- changes after a live stream has already been posted

### Quota strategy

Quota discipline matters on YouTube.
The official docs show:

- `search.list` costs `100`
- `videos.list` costs `1`
- the default project quota is `10,000` units per day

So V2 should avoid using `search.list` in the hot path.

Preferred pattern:

- use URL resolution and channel ID caching during setup time
- use push notifications as the primary trigger
- use `videos.list` for event enrichment
- reserve `search.list` for exceptional setup fallbacks only

### Worker responsibilities

`platform_subscription`

- resolve channel IDs from saved URLs when missing
- subscribe and renew the Google hub topic
- store callback URL, lease expiry, and last verification time
- retry renewals with bounded backoff

`platform_ingest`

- parse Atom payloads
- create one durable ingest row per notified video
- enrich the video state through `videos.list`
- decide live / ignore / update
- enqueue one `process_live_event` flow for accepted live sessions

`live_post`

- send Discord alert
- prevent reposts for the same guild and video ID
- support cleanup when the session is known to be over if cleanup rules are enabled later

### Data expectations

`platform_subscriptions.metadata_json` should hold:

- original saved URL
- resolved channel ID
- lease expiry details
- last verification timestamp
- last successful renew timestamp

`event_ingest.payload_json` should hold:

- raw Atom entry fields
- resolved video ID
- resolved channel ID
- enrichment snapshot from `videos.list`

### Failure strategy

- if the webhook fails, renewals must not silently continue as if delivery is healthy
- if enrichment fails temporarily, retry the ingest job instead of dropping it
- if quota pressure rises, reduce non-essential refresh work before live-event work
- if YouTube is degraded, pause only the YouTube queue path and keep Twitch and Discord delivery healthy

### Rollout shape

- V2 YouTube should go live only after the worker webhook path is proven with Twitch
- start with team and creator subscriptions using canonical channel IDs only
- add richer cleanup and stream-end behavior after stable live-start fan-out is working

## Kick

### What Kick gives us now

Kick has moved beyond the older unofficial-only shape that V1 had to work around.
The current Kick docs show:

- a public Channels API
- a public Livestreams API
- an Events API with webhook subscriptions
- a public key endpoint for verifying webhook signatures
- livestream webhook events including `livestream.status.updated` and `livestream.metadata.updated`
- a subscription limit of `10,000` per event type for one app
- webhook delivery can be disabled if an app keeps failing events for over a day

That changes the V2 design.
Kick should be webhook-first in V2, with polling as a guarded fallback, not the default engine.

### Core V2 model

1. Admin or creator saves a Kick slug or URL.
2. API resolves and stores the canonical broadcaster user ID plus slug.
3. API syncs a `platform_subscriptions` row with a global topic key like `kick:BROADCASTER_USER_ID`.
4. `platform_subscription` workers reconcile Kick event subscriptions for that broadcaster.
5. Worker webhook receiver verifies the signature using Kick headers and Kick's public key.
6. `platform_ingest` worker accepts `livestream.status.updated` as the primary live-start or live-end source.
7. Worker enriches live-start events with `GET /public/v1/livestreams` or `GET /public/v1/channels`.
8. Accepted live sessions fan out to entitled guilds through `live_post`.
9. Live-end events mark sessions inactive and trigger cleanup for guilds that enabled cleanup.

### Recommended event set

For live alerts, the first Kick V2 slice should focus on:

- `livestream.status.updated`
- `livestream.metadata.updated`

Reason:

- `livestream.status.updated` is the cleanest source for started / ended state
- `livestream.metadata.updated` helps refresh title, category, and thumbnail when the stream changes after start

Other Kick events can be added later without disturbing the live-alert pipeline.

### Signature and webhook rules

Kick webhook validation should follow the official docs:

- use `Kick-Event-Message-Id` as the idempotency key
- use `Kick-Event-Signature` to verify the sender
- use `Kick-Event-Message-Timestamp` for freshness checks
- verify the concatenated string `message_id.timestamp.raw_body`
- fetch the public key from Kick's public-key endpoint and cache it

The webhook path must ack quickly and defer all heavy work to durable jobs.

### Subscription strategy

Kick allows app access tokens to subscribe to channel events when you provide the broadcaster user ID.
That is a strong fit for Pro V2.

Important scale rule:

- subscribe once per unique broadcaster user ID
- do not create duplicate event subscriptions per guild

This keeps us safely under Kick's per-app event limits even when many guilds track the same creator.

### Polling fallback

V1 used polling because the webhook path was not ready.
V2 should keep a fallback polling mode, but it should be:

- disabled by default
- guarded by a feature flag
- used only when webhook delivery is unavailable or Kick has an outage
- batched by broadcaster user IDs
- rate-limited and observable

If fallback polling is enabled:

- poll `GET /public/v1/livestreams`
- batch broadcaster IDs where possible
- never let fallback polling monopolize worker capacity

### Worker responsibilities

`platform_subscription`

- resolve slug to broadcaster user ID through Kick channels API
- create and reconcile event subscriptions
- store webhook subscription IDs
- resubscribe when Kick disables subscriptions after repeated failures

`platform_ingest`

- verify and ingest webhook events
- dedupe by Kick message ID and broadcaster user ID
- enrich live-start payloads with livestream data
- classify started / ended / metadata-update flows

`live_post`

- send Discord alerts for started events
- suppress duplicates for the same broadcaster and live session
- clear old messages on end events when cleanup is enabled

### Data expectations

`platform_subscriptions.metadata_json` should hold:

- original slug or URL
- canonical broadcaster user ID
- canonical slug
- provider subscription IDs by event type
- last public-key verification timestamp
- last successful reconcile timestamp

`event_ingest.payload_json` should hold:

- raw Kick webhook body
- normalized broadcaster data
- livestream enrichment snapshot if fetched

### Operational risks

- Kick event subscriptions can be disabled if webhook processing fails for too long
- Kick docs and payloads are newer and may shift faster than Twitch or YouTube
- Kick fallback polling should stay behind flags so it does not quietly become permanent technical debt

Because of that, V2 should ship:

- visible webhook failure rate
- visible last successful webhook timestamp
- visible last successful subscription reconcile timestamp
- one-click connector pause for Kick queues

## Build order

Recommended order after the Twitch slice:

1. YouTube subscription renewal and webhook receiver
2. YouTube ingest enrichment with `videos.list`
3. YouTube Discord fan-out and dedupe hardening
4. Kick subscription reconcile and webhook verification
5. Kick live-start / live-end ingest flow
6. Kick guarded fallback polling

## Done means

YouTube is "done enough" for V2 rollout planning when:

- setup resolves and stores channel IDs cleanly
- renewals are durable and observable
- webhook delivery is stable
- one live video posts once per guild
- title edits do not repost live alerts
- quota use stays predictable

Kick is "done enough" for V2 rollout planning when:

- setup resolves broadcaster IDs cleanly
- webhook signatures verify correctly
- event subscriptions reconcile automatically
- start and end events update session state correctly
- cleanup is safe when enabled
- fallback polling exists but is not required for normal operation

## Recommendation

YouTube should be the next production connector after Twitch.
Kick should follow immediately after, but with stricter guardrails and stronger observability because it is the riskier connector.

That gives Pro V2:

- Twitch as the first fully real connector
- YouTube as the second stable connector
- Kick as the first higher-risk connector with proper isolation

That is the right sequence for a future cutover when V1 starts to bend.

## Reference links

- YouTube push notifications: https://developers.google.com/youtube/v3/guides/push_notifications
- YouTube quota costs: https://developers.google.com/youtube/v3/determine_quota_cost
- YouTube `search.list`: https://developers.google.com/youtube/v3/docs/search/list
- YouTube `videos.list`: https://developers.google.com/youtube/v3/docs/videos/list
- Kick channels API: https://docs.kick.com/apis/channels
- Kick public key API: https://docs.kick.com/apis/public-key
- Kick webhook payloads: https://docs.kick.com/events/event-types
